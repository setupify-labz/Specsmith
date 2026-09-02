// Local, offline, no-credential render adapter for text-to-speech.
//
// WHY THIS FILE EXISTS
// ---------------------
// The real narration adapter this pipeline ships (elevenLabsTts.ts) requires
// a paid ElevenLabs API key. Issue #82's excluded scope forbids spending a
// paid API call without explicit approval, and its included scope explicitly
// allows "mocks or already-authorized fixtures where external credentials,
// paid generation ... are unavailable."
//
// This adapter is that fixture path for narration: it synthesizes real (if
// robotic) speech locally via espeak-ng from the exact narration text the
// storyboard already produced — no network call, no API key, no fabricated
// claim. Its artifact metadata is labeled `isFixture: true` /
// `isPaidProvider: false` so nothing downstream can mistake it for a
// production-quality render. Swap it for elevenLabsTts.ts's real adapter
// (see ../README.md) once ElevenLabs credentials and approval to spend them
// are available; nothing else needs to change, because both implement the
// exact same RenderAdapter contract.
//
// NOT included here: offlineCompositorSmoke.ts's rendered scene only needs
// deterministic-ui-render, text-to-speech, caption-render, and
// motion-compositor — it never uses "image-generation" or "music-sfx" at
// all, because it renders the same fixed 3-visual timeline
// compositorSmoke.ts already proves. Driving the FULL automatic 6-beat
// production plan (buildProductionPlanPackage's output, which does include a
// paid video-generation hook beat and an always-present music-sfx task) end
// to end would need offline fixtures for those two capabilities as well;
// that's a real next step (see the PR description's Limitations), left out
// here rather than shipped unexercised by any actual render in this change.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";
import { narrationTextFromRenderContext } from "./elevenLabsTts.ts";

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "fixture";
}

/**
 * Moves a file, falling back to copy+delete across devices.
 *
 * `/tmp` (where espeak-ng's scratch file lives, see below) is not guaranteed
 * to be the same filesystem as the caller's outputDir, and a plain `rename`
 * fails with EXDEV across devices.
 */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function runProcess(command: string, args: string[], timeoutMs = 60_000): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not launch ${command}: ${error.message}. Is it installed and on PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}. ${Buffer.concat(stderr).toString("utf8").trim().slice(-1200)}`));
        return;
      }
      resolvePromise();
    });
  });
}

// --- text-to-speech: local espeak-ng, no network, no API key -------------

export interface LocalFixtureTtsConfig {
  /** espeak-ng voice id. Default en-us. */
  voice?: string;
  /** Words per minute. Default 165 (espeak-ng's own default). */
  speedWpm?: number;
  /** 0-99. Default 50 (espeak-ng's own default). */
  pitch?: number;
  espeakPath?: string;
}

export function createLocalFixtureTtsAdapter(options: {
  config?: LocalFixtureTtsConfig;
  outputDir: string;
}): RenderAdapter {
  const voice = options.config?.voice?.trim() || "en-us";
  const speedWpm = options.config?.speedWpm ?? 165;
  const pitch = options.config?.pitch ?? 50;
  const espeakPath = options.config?.espeakPath?.trim() || process.env.SPECSMITH_ESPEAK_PATH?.trim() || "espeak-ng";

  return {
    name: "local-espeak-tts-fixture",
    capability: "text-to-speech",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const text = narrationTextFromRenderContext(context);
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.wav`);

      // espeak-ng 1.51 (as packaged for Ubuntu 24.04/noble) silently
      // TRUNCATES its `-w` output path once the full path passes ~194 bytes
      // — confirmed by direct testing, not documented behavior — and still
      // exits 0. It does not fail; it writes a *different*, wrong file next
      // to the one this task asked for, which then makes the `stat` below
      // fail with a misleading "did not produce" error, or worse, silently
      // reuse whatever partial file already sat at the truncated name. This
      // repository's own output path
      // (.../render-output/<package>/audio/<package>-<platform>-<taskId>.wav)
      // can cross that threshold on a long checkout path (a deep worktree, a
      // long CI workspace). Rather than depend on staying under an
      // undocumented, version-specific limit, espeak-ng always writes to a
      // short scratch path under the OS temp directory, and the real,
      // descriptive output path is applied by moving the file afterward.
      const scratchPath = join(tmpdir(), `espeak-${randomUUID()}.wav`);
      try {
        await runProcess(espeakPath, [
          "-v", voice,
          "-s", String(speedWpm),
          "-p", String(pitch),
          "-w", scratchPath,
          text,
        ]);
        const { size: scratchSize } = await stat(scratchPath).catch(() => {
          throw new Error(`espeak-ng did not produce ${scratchPath}.`);
        });
        if (scratchSize === 0) throw new Error(`espeak-ng produced an empty audio file for task ${context.task.taskId}.`);
        await moveFile(scratchPath, outputPath);
      } finally {
        await unlink(scratchPath).catch(() => {});
      }
      const { size } = await stat(outputPath);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-local-tts-fixture`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "local-espeak-tts-fixture",
          provider: "espeak-ng-offline-fixture",
          voice,
          speedWpm,
          bytes: size,
          textCharacters: text.length,
          isPaidProvider: false,
          isFixture: true,
        },
      }];
    },
  };
}
