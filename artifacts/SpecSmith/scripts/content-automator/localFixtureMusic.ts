// Local, offline, no-credential render adapter for music-sfx.
//
// WHY THIS FILE EXISTS
// ---------------------
// productionPlan.ts adds a music-sfx task to every generated production
// plan (see productionPlan.ts's buildTasks — it is never gated the way the
// hook's video-generation task is), and this pipeline ships no real
// music/SFX provider at all. Issue #82's excluded scope never approved
// licensed music, and issue #89's included scope explicitly allows this
// capability to be filled offline by "silence ... only when
// rights/provenance are explicit."
//
// This adapter renders exact digital silence locally via ffmpeg's anullsrc
// source — no network call, no license question, and nothing that could be
// mistaken for a real soundtrack or sound effect. motionCompositor.ts's
// muxFinal loops this clip (`-stream_loop -1`) for the master's full
// duration, so the rendered clip only needs to be a few seconds long;
// looped silence is still silence.

import { spawn } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "fixture";
}

async function runProcess(command: string, args: string[], timeoutMs = 30_000): Promise<void> {
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

export interface LocalFixtureMusicConfig {
  ffmpegPath?: string;
  /**
   * Seconds of silence to render. motionCompositor.ts loops this clip for
   * the full master duration, so this only needs to be long enough for
   * ffmpeg to encode a clean, seekable file — not the master's duration.
   */
  durationSeconds?: number;
}

const DEFAULT_DURATION_SECONDS = 3;

export function createLocalFixtureMusicAdapter(options: {
  config?: LocalFixtureMusicConfig;
  outputDir: string;
}): RenderAdapter {
  const ffmpegPath = options.config?.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";
  const durationSeconds = options.config?.durationSeconds ?? DEFAULT_DURATION_SECONDS;

  return {
    name: "local-fixture-music-silence",
    capability: "music-sfx",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.wav`);
      // Written to a temp name first, then renamed: a reader never sees a
      // half-written WAV, and a crashed render leaves no artifact claiming
      // to be complete. The temp name keeps the .wav extension (rather than
      // appending .partial after it) because ffmpeg's wav muxer selects its
      // output format from the filename extension, not content.
      const tempPath = outputPath.replace(/\.wav$/, ".partial.wav");

      await runProcess(ffmpegPath, [
        "-y",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-t", String(durationSeconds),
        "-c:a", "pcm_s16le",
        tempPath,
      ]);
      await rename(tempPath, outputPath);
      const { size } = await stat(outputPath);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-offline-silence-fixture`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "local-fixture-music-silence",
          provider: "ffmpeg-anullsrc-silence",
          durationSeconds,
          bytes: size,
          isPaidProvider: false,
          isFixture: true,
          isSilence: true,
        },
      }];
    },
  };
}
