// Local, offline, no-credential render adapters for text-to-speech,
// image-generation, and music-sfx.
//
// WHY THIS FILE EXISTS
// ---------------------
// The real adapters this pipeline ships (elevenLabsTts.ts, geminiVeoVideo.ts,
// elevenLabsVideo.ts) all require a paid provider API key. Issue #82's
// excluded scope forbids spending paid API calls without explicit approval,
// and its included scope explicitly allows "mocks or already-authorized
// fixtures where external credentials, paid generation ... are unavailable."
//
// These three adapters are that fixture path. Each is clearly labeled in its
// artifact metadata (`isFixture: true`, `isPaidProvider: false`) so nothing
// downstream can mistake fixture output for a production-quality render, and
// none of them fabricate any factual claim, benchmark number, or product
// imagery — they either synthesize real (if robotic) speech from the exact
// narration text the storyboard already produced, or draw a plain abstract
// placeholder card with no photographic or generated "product" imagery at
// all. The real SpecSmith evidence in the finished video still comes
// entirely from the deterministic UI-render adapter, not from these.
//
// Swap them for the real paid adapters (see ../README.md) once credentials
// and/or explicit approval for paid generation are available; nothing else
// in the pipeline needs to change to do that, because these implement the
// exact same RenderAdapter contract as the paid ones.

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

// --- image-generation: local ffmpeg placeholder card ----------------------
//
// Registered for "image-generation" so the orchestrator's built-in
// fallbackCapability path (video-generation -> image-generation, see
// rendering.ts) picks this up automatically for hook beats when no paid
// video-generation adapter is registered at all. Draws a flat SpecSmith-blue
// card with plain, non-claim text — never a rendering of a GPU, a
// benchmark number, or anything that could be mistaken for real product
// evidence or a real SpecSmith UI capture.

export function createLocalFixtureImageAdapter(options: {
  outputDir: string;
  ffmpegPath?: string;
  width?: number;
  height?: number;
}): RenderAdapter {
  const ffmpegPath = options.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";
  const width = options.width ?? 1080;
  const height = options.height ?? 1920;

  return {
    name: "local-ffmpeg-placeholder-image-fixture",
    capability: "image-generation",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.png`);
      const label = "SPECSMITH — SEE THE FULL COMPARISON ON THE SITE";
      const escapedLabel = label.replace(/:/g, "\\:").replace(/'/g, "\\'");
      await runProcess(ffmpegPath, [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=0x0B1220:s=${width}x${height}`,
        "-vf",
        `drawtext=text='${escapedLabel}':fontcolor=white:fontsize=48:` +
          `line_spacing=12:box=0:x=(w-text_w)/2:y=(h-text_h)/2:` +
          `fix_bounds=1`,
        "-frames:v", "1",
        outputPath,
      ]);
      const { size } = await stat(outputPath).catch(() => {
        throw new Error(`ffmpeg did not produce ${outputPath}.`);
      });

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-local-image-fixture`,
        taskId: context.task.taskId,
        kind: "image",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "image/png",
        metadata: {
          renderer: "local-ffmpeg-placeholder-image-fixture",
          provider: "offline-placeholder-fixture",
          width,
          height,
          bytes: size,
          isPaidProvider: false,
          isFixture: true,
          isAbstractPlaceholder: true,
        },
      }];
    },
  };
}

// --- music-sfx: local ffmpeg silence bed -----------------------------------
//
// productionPlan.ts always attaches a musicTaskId to the compose task's
// compositorState, so a music-sfx adapter is mandatory (no fallback exists
// for it). Rather than fabricate "royalty-free" music with no real license,
// this renders true digital silence — motionCompositor.ts mixes it under the
// narration at a fixed low volume, so playing it back changes nothing
// audible, and the metadata says exactly what it is.

export function createLocalFixtureSilentMusicAdapter(options: {
  outputDir: string;
  ffmpegPath?: string;
  durationSeconds?: number;
}): RenderAdapter {
  const ffmpegPath = options.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";
  const durationSeconds = options.durationSeconds ?? 30;

  return {
    name: "local-ffmpeg-silence-fixture",
    capability: "music-sfx",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.wav`);
      await runProcess(ffmpegPath, [
        "-y",
        "-f", "lavfi",
        "-i", `anullsrc=r=44100:cl=stereo`,
        "-t", String(durationSeconds),
        outputPath,
      ]);
      const { size } = await stat(outputPath).catch(() => {
        throw new Error(`ffmpeg did not produce ${outputPath}.`);
      });

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-local-silence-fixture`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "local-ffmpeg-silence-fixture",
          provider: "offline-silence-fixture",
          bytes: size,
          durationSeconds,
          isPaidProvider: false,
          isFixture: true,
          isSilent: true,
        },
      }];
    },
  };
}
