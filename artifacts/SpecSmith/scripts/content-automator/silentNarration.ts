// A "text-to-speech" render adapter that speaks nothing.
//
// For visual drafts rendered before any voice is approved. It writes silence
// of the planned length, so the production compositor runs exactly as it will
// with a real take, and records the planned narration with its timing beside
// it. It is labelled silent everywhere a later step could read it: the
// artifact metadata says `isSilent: true`, and no step may treat this file as
// a voice, a voice approval, or a listening review.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export interface PlannedNarrationLine {
  readonly startSecond: number;
  readonly endSecond: number;
  readonly text: string;
}

export function createSilentNarrationAdapter(options: {
  readonly outputDir: string;
  /** The planned narration, by beat. Recorded, never spoken. */
  readonly plannedLines: readonly PlannedNarrationLine[];
  readonly ffmpegPath?: string;
}): RenderAdapter {
  const ffmpegPath = options.ffmpegPath ?? process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";
  return {
    name: "silent-narration-placeholder",
    capability: "text-to-speech",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const seconds = context.targetDurationSeconds;
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("A silent narration track needs the planned duration.");
      const last = options.plannedLines.at(-1);
      if (!last || Math.abs(last.endSecond - seconds) > 0.05) {
        throw new Error(`The planned narration ends at ${last?.endSecond ?? "?"}s but the video is planned for ${seconds}s.`);
      }
      await mkdir(options.outputDir, { recursive: true });
      const path = resolve(options.outputDir, `${context.task.taskId}__silent.wav`);
      await new Promise<void>((done, fail) => {
        const child = spawn(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", seconds.toFixed(3), "-c:a", "pcm_s16le", path], { stdio: ["ignore", "ignore", "pipe"] });
        const err: Buffer[] = [];
        child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
        child.on("error", fail);
        child.on("close", (code) => code === 0 ? done() : fail(new Error(Buffer.concat(err).toString("utf8").slice(-400))));
      });
      const script = options.plannedLines.map((line) => line.text).join(" ");
      const timingPath = join(options.outputDir, `${context.task.taskId}__planned-narration.json`);
      await writeFile(timingPath, `${JSON.stringify({ label: "PLANNED NARRATION, NOT SPOKEN. The audio track is silence.", lines: options.plannedLines }, null, 2)}\n`);
      const { size } = await stat(path);
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-silent`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(path).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "silent-narration-placeholder",
          isSilent: true,
          isFixture: true,
          isPaidProvider: false,
          bytes: size,
          plannedScriptSha256: createHash("sha256").update(script).digest("hex"),
          plannedTimingPath: timingPath,
          beatTiming: "planned",
        },
      }];
    },
  };
}
