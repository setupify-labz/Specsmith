// The two capabilities that stopped the generated storyboard reaching a real
// render, supplied offline.
//
// WHAT WAS ACTUALLY MISSING. `buildProductionPlanPackage` turns a six-beat
// storyboard into eight tasks, and six of them already had a working offline
// adapter on `main`: five `deterministic-ui-render` beats, one
// `text-to-speech`, plus captions and compose. Exactly two did not —
//
//   - the HOOK beat, which `visualCapability()` deliberately assigns to
//     `video-generation` ("V1 spends paid generation on the hook only"), and
//   - the single `music-sfx` bed.
//
// — so a run either called a paid provider or died. That is the whole reason
// `endToEndOfflinePipeline.ts` renders a separate hand-authored timeline
// instead of the storyboard it just generated, and why its own header calls
// wiring them together "separate, tracked future work".
//
// WHY FIXTURES RATHER THAN A POLICY CHANGE. The obvious shortcut is to edit
// `visualCapability()` so the hook uses a UI capture too. That is a PRODUCT
// decision about how SpecSmith videos open, it is argued for in a comment in
// `productionPlan.ts`, and it is not mine to reverse. These adapters leave the
// plan exactly as generated and satisfy it offline, the same way
// `localFixtureTts.ts` satisfies `text-to-speech` without ElevenLabs.
//
// WHAT THEY MUST NOT DO. The generated task's own `outputRequirements` forbid
// baking in third-party logos, wordmarks, product photography or "distinctive
// product geometry", and forbid introducing factual claims absent from the
// storyboard. So the card renders TYPOGRAPHY ON A FLAT BACKGROUND and nothing
// else: no product imagery, no benchmark numbers, no price, no spec. The only
// text it draws is the beat's own on-screen text, which the storyboard already
// authored and the quality gate already reviews.
//
// Both label themselves `isFixture: true` / `isPaidProvider: false`, so
// nothing downstream can mistake either for production media.

import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

/** Vertical short-form frame. Matches the compositor's expectation. */
export const FIXTURE_WIDTH = 1080;
export const FIXTURE_HEIGHT = 1920;
export const FIXTURE_FPS = 30;

const safeFilePart = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "part";

function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${ffmpegPath} exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

/**
 * Escapes text for ffmpeg's `drawtext` filter.
 *
 * `drawtext` parses its own argument string, so a colon or apostrophe in a
 * storyboard line silently truncates the caption or fails the whole filter.
 * Storyboard hooks are written by a copywriter, not escaped by one.
 */
export function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

/** Breaks a hook into lines short enough to read on a phone. */
export function wrapForCard(value: string, maxCharsPerLine = 22): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 6);
}

function onScreenTextFor(context: RenderTaskContext): string {
  const task = context.task as { onScreenText?: unknown; purpose?: unknown };
  if (typeof task.onScreenText === "string" && task.onScreenText.trim()) return task.onScreenText.trim();
  const state = context.task.videoGenerationState as { onScreenText?: unknown; prompt?: unknown } | undefined;
  if (state && typeof state.onScreenText === "string" && state.onScreenText.trim()) return state.onScreenText.trim();
  if (state && typeof state.prompt === "string" && state.prompt.trim()) return state.prompt.trim();
  return "";
}

function beatSeconds(context: RenderTaskContext, fallback: number): number {
  const state = context.task.videoGenerationState as { durationSeconds?: unknown } | undefined;
  const raw = state?.durationSeconds;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.min(raw, 15);
  return fallback;
}

export interface OfflineCardVideoOptions {
  outputDir: string;
  ffmpegPath?: string;
  /** Flat background, as an ffmpeg colour. Deliberately not SpecSmith brand. */
  background?: string;
}

/**
 * An offline stand-in for the hook beat's `video-generation` task.
 *
 * Produces a REAL H.264 clip — not a `dry-run://` placeholder — so the
 * compositor downstream is exercised on genuine bytes. What it draws is a
 * plain typographic card: the beat's own on-screen text, centred, on a flat
 * background, at the plan's own duration.
 *
 * It is not pretending to be generated motion and it is not trying to look
 * good. It exists so the REST of the chain — the five real UI captures, the
 * narration, the captions, the compose, the review packet — can be proven on
 * a real render while the paid generation provider stays unapproved.
 */
export function createOfflineCardVideoAdapter(options: OfflineCardVideoOptions): RenderAdapter {
  const ffmpegPath = options.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";
  const background = options.background?.trim() || "black";

  return {
    name: "offline-card-video-fixture",
    capability: "video-generation",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.mp4`);
      const durationSeconds = beatSeconds(context, 4);
      const lines = wrapForCard(onScreenTextFor(context));

      // One drawtext per line, stacked around the vertical centre. Empty text
      // is fine and yields a plain card rather than an error.
      const drawText = lines.map((line, index) => {
        const offset = (index - (lines.length - 1) / 2) * 96;
        return [
          `drawtext=text='${escapeDrawText(line)}'`,
          "fontcolor=white",
          "fontsize=68",
          "x=(w-text_w)/2",
          `y=(h-text_h)/2+${offset.toFixed(0)}`,
        ].join(":");
      });
      const filters = [`scale=${FIXTURE_WIDTH}:${FIXTURE_HEIGHT}`, ...drawText].join(",");

      await runFfmpeg(ffmpegPath, [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", `color=c=${background}:s=${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}:r=${FIXTURE_FPS}:d=${durationSeconds}`,
        "-vf", filters,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
        outputPath,
      ]);

      const { size } = await stat(outputPath);
      if (size === 0) throw new Error(`Offline card video produced an empty file at ${outputPath}`);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-offline-card`,
        taskId: context.task.taskId,
        kind: "video",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "video/mp4",
        metadata: {
          renderer: "offline-card-video-fixture",
          provider: "ffmpeg-offline-fixture",
          width: FIXTURE_WIDTH,
          height: FIXTURE_HEIGHT,
          fps: FIXTURE_FPS,
          durationSeconds,
          bytes: size,
          textLines: lines.length,
          containsProductImagery: false,
          containsThirdPartyMarks: false,
          isPaidProvider: false,
          isFixture: true,
        },
      }];
    },
  };
}

export interface OfflineSilentBedOptions {
  outputDir: string;
  ffmpegPath?: string;
}

/**
 * An offline stand-in for the plan's single `music-sfx` task.
 *
 * IT RENDERS SILENCE, ON PURPOSE. Music is a rights decision before it is a
 * creative one — a bed has to be licensed, attributed and cleared, and
 * `assetRights.ts` exists precisely to gate that. Generating something
 * music-shaped here would invite a reviewer to judge a track that could never
 * ship. Silence is the honest placeholder: it satisfies the task, keeps the
 * compose step exercised on a real audio stream, and leaves the creative
 * choice open.
 *
 * The review packet reports it as silent so nobody mistakes the draft's
 * quietness for a rendering fault.
 */
export function createOfflineSilentBedAdapter(options: OfflineSilentBedOptions): RenderAdapter {
  const ffmpegPath = options.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";

  return {
    name: "offline-silent-bed-fixture",
    capability: "music-sfx",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.wav`);
      const durationSeconds = Math.max(1, Math.min(context.targetDurationSeconds || 24, 120));

      await runFfmpeg(ffmpegPath, [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", `anullsrc=channel_layout=mono:sample_rate=44100:d=${durationSeconds}`,
        "-c:a", "pcm_s16le",
        outputPath,
      ]);

      const { size } = await stat(outputPath);
      if (size === 0) throw new Error(`Offline silent bed produced an empty file at ${outputPath}`);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-offline-silent-bed`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "offline-silent-bed-fixture",
          provider: "ffmpeg-offline-fixture",
          durationSeconds,
          bytes: size,
          isSilent: true,
          requiresLicensedReplacement: true,
          isPaidProvider: false,
          isFixture: true,
        },
      }];
    },
  };
}
