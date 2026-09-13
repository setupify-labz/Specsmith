// Local, offline, no-credential render adapter for video-generation.
//
// WHY THIS FILE EXISTS
// ---------------------
// The real video adapters this pipeline ships (elevenLabsVideo.ts,
// geminiVeoVideo.ts) call a paid third-party model (Veo) and need an API
// key. Issue #82's excluded scope forbids spending a paid API call without
// explicit approval, and issue #89's included scope explicitly allows this
// capability to be filled offline by "a deterministic SpecSmith UI shot or
// clearly labeled fixture card" instead.
//
// This adapter is that fixture path: it renders one static, plainly
// labeled placeholder card locally via ffmpeg (a solid background plus
// baked-in "OFFLINE FIXTURE" text, actually visible in the frame — not just
// in metadata) from the exact prompt/timing state productionPlan.ts already
// produces for the hook beat (deriveVideoGenerationState). No network call,
// no API key, and it never claims to be generated video or real SpecSmith
// UI. Its artifact metadata is labeled `isFixture: true` / `isPaidProvider:
// false` / `presentedAsRealSpecSmithUi: false` so nothing downstream can
// mistake it for a paid Veo render or a real product capture — and
// qualityReviewer.ts's hard blocker on generated/unknown UI being presented
// as real SpecSmith UI is exactly what that last field is checked against.
//
// Swap this for elevenLabsVideo.ts's or geminiVeoVideo.ts's real adapter
// (see README.md) once a video-generation credential and approval to spend
// it are available; nothing else needs to change, because all three
// implement the exact same RenderAdapter contract and consume the exact
// same videoGenerationState shape (reused here via
// parseElevenLabsVideoGenerationState rather than duplicating that
// validation).

import { spawn } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";
import { parseElevenLabsVideoGenerationState } from "./elevenLabsVideo.ts";

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

export interface LocalFixtureVideoConfig {
  ffmpegPath?: string;
}

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
// Deliberately not SpecSmith's own UI palette, so this card never reads as a
// product screenshot at a glance, even before the baked-in label is read.
const CARD_BACKGROUND = "0x11141c";
const TITLE_TEXT = "OFFLINE FIXTURE";
const SUBTITLE_TEXT = "Not generated video. No paid provider was called.";

// font=<family> (fontconfig lookup, matching the same approach
// captionRender.ts's "Arial" already relies on via libass) rather than a
// hardcoded fontfile path, so this does not depend on one exact font
// existing at one exact filesystem location on every machine that runs it.
function drawtextFilter(): string {
  const title = `drawtext=font='DejaVu Sans Bold':text='${TITLE_TEXT}':fontcolor=white:fontsize=68:x=(w-text_w)/2:y=860`;
  const subtitle = `drawtext=font='DejaVu Sans':text='${SUBTITLE_TEXT}':fontcolor=0xaab0c0:fontsize=32:x=(w-text_w)/2:y=960`;
  return `${title},${subtitle}`;
}

export function createLocalFixtureVideoAdapter(options: {
  config?: LocalFixtureVideoConfig;
  outputDir: string;
}): RenderAdapter {
  const ffmpegPath = options.config?.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";

  return {
    name: "local-fixture-video-generation",
    capability: "video-generation",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const rawState = (context.task as { videoGenerationState?: unknown }).videoGenerationState;
      if (rawState === undefined) {
        throw new Error(
          `Task ${context.task.taskId} requests video-generation but carries no videoGenerationState. This adapter will not invent a prompt — attach a typed state or use the dry-run adapter.`,
        );
      }
      // Same validation the paid providers apply to the same field — see the
      // header comment for why reusing it here is intentional.
      const state = parseElevenLabsVideoGenerationState(rawState);

      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.png`);
      // Written to a temp name first, then renamed: a reader never sees a
      // half-written PNG, and a crashed render leaves no artifact claiming
      // to be complete. The temp name keeps the .png extension (rather than
      // appending .partial after it) because ffmpeg's image2 muxer selects
      // its output format from the filename extension, not content.
      const tempPath = outputPath.replace(/\.png$/, ".partial.png");

      await runProcess(ffmpegPath, [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=${CARD_BACKGROUND}:s=${CARD_WIDTH}x${CARD_HEIGHT}:d=1`,
        "-vf", drawtextFilter(),
        "-frames:v", "1",
        "-update", "1",
        tempPath,
      ]);
      await rename(tempPath, outputPath);
      const { size } = await stat(outputPath);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-offline-video-fixture`,
        taskId: context.task.taskId,
        kind: "image",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "image/png",
        metadata: {
          renderer: "local-fixture-video-generation",
          provider: "specsmith-offline-video-fixture",
          promptCharacters: state.prompt.length,
          requestedDurationSeconds: state.durationSeconds,
          bytes: size,
          isPaidProvider: false,
          isFixture: true,
          generated: false,
          presentedAsRealSpecSmithUi: false,
        },
      }];
    },
  };
}
