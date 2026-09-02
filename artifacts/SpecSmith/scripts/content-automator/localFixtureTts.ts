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

import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";
import { narrationTextFromRenderContext } from "./elevenLabsTts.ts";

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "fixture";
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
      await runProcess(espeakPath, [
        "-v", voice,
        "-s", String(speedWpm),
        "-p", String(pitch),
        "-w", outputPath,
        text,
      ]);
      const { size } = await stat(outputPath).catch(() => {
        throw new Error(`espeak-ng did not produce ${outputPath}.`);
      });
      if (size === 0) throw new Error(`espeak-ng produced an empty audio file for task ${context.task.taskId}.`);

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
