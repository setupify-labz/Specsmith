// Checks a rendered banded video (bandedLayout.ts) against what it was built
// from, in sampled decoded frames.
//
// WHAT IT PROVES, PER SAMPLED FRAME
// ---------------------------------
// - Disclosure band: the pixels match the verified disclosure panel. The panel
//   was measured before it was accepted (disclosureOverlay.ts), so matching it
//   means the full disclosure is on screen, readable and unclipped at that
//   moment, from the first frame to the last.
// - Story band: the pixels match the beat's own source capture. Nothing, not
//   the disclosure and not a caption, is drawn over the product.
// - Caption band: while a cue is active, caption pixels are present there.
// - Consecutive beats show different pictures. The same capture reused across
//   a cut is caught here as well as in the storyboard review.
//
// WHAT IT DOES NOT PROVE
// ----------------------
// Whether the video looks good, whether the pacing feels right, or anything
// about the audio. It compares pixels to their sources; it has no taste.

import { spawn } from "node:child_process";
import type { BandedLayout } from "./bandedLayout.ts";

export interface BandedBeatSources {
  readonly startSecond: number;
  readonly endSecond: number;
  /** PNG files the story band may show during this beat (one per static capture). */
  readonly sources: readonly string[];
}

export interface BandedFrameExpectation {
  readonly videoPath: string;
  readonly layout: BandedLayout;
  readonly disclosurePanelPath: string;
  readonly beats: readonly BandedBeatSources[];
  readonly captionCues: readonly { readonly startSecond: number; readonly endSecond: number }[];
  /** Final video duration; the last frame is sampled just before it. */
  readonly durationSeconds: number;
}

export interface FrameSample {
  readonly atSecond: number;
  readonly beat: number;
  /** Mean absolute difference, 0-255, of each band against its reference. */
  readonly disclosureError: number;
  readonly storyError: number;
  /** Share of story pixels differing strongly from the capture. */
  readonly storyChange: number;
  readonly captionInk: number | null;
}

export interface BandedFrameReport {
  readonly ok: boolean;
  readonly samples: readonly FrameSample[];
  readonly failures: readonly string[];
}

/** Mean absolute error at or under which a band counts as its reference, after H.264. */
export const BAND_MATCH_MAX_ERROR = 6;
/**
 * Share of story-band pixels allowed to differ strongly from the capture.
 * Mean error alone is diluted by a large untouched area; a panel drawn over a
 * quarter of the story moved it only from 0.3 to 8.7. Strongly changed pixels
 * are near zero in a clean render and in the tens of percent under an overlay.
 */
export const STORY_MAX_STRONG_CHANGE = 0.002;
/** Share of bright pixels that means a caption is present in the caption band. */
export const CAPTION_INK_MIN = 0.004;
/** Share of pixels that must differ strongly between two beats for them to be different pictures. */
export const DISTINCT_PICTURE_MIN_CHANGE = 0.01;

async function run(ffmpegPath: string, args: string[]): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(out))
      : reject(new Error(`${ffmpegPath} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}

/** One decoded video frame at `atSecond`, as 8-bit grey, full frame. */
async function frameAt(ffmpegPath: string, videoPath: string, atSecond: number, layout: BandedLayout): Promise<Buffer> {
  const raw = await run(ffmpegPath, ["-v", "error", "-ss", atSecond.toFixed(3), "-i", videoPath, "-frames:v", "1",
    "-vf", "format=gray", "-f", "rawvideo", "-"]);
  if (raw.length !== layout.width * layout.height) throw new Error(`Frame at ${atSecond}s decoded to ${raw.length} bytes, not ${layout.width}x${layout.height}.`);
  return raw;
}

/** An image decoded to grey at exactly `width` x `height`, fitted as the compositor fits it. */
async function imageAt(ffmpegPath: string, path: string, width: number, height: number): Promise<Buffer> {
  const raw = await run(ffmpegPath, ["-v", "error", "-i", path, "-frames:v", "1", "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=gray`,
    "-f", "rawvideo", "-"]);
  if (raw.length !== width * height) throw new Error(`${path} decoded to ${raw.length} bytes, not ${width}x${height}.`);
  return raw;
}

const rows = (frame: Buffer, width: number, band: { y: number; height: number }) =>
  frame.subarray(band.y * width, (band.y + band.height) * width);

function meanError(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}
function strongChange(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 48) changed += 1;
  return changed / a.length;
}
function ink(band: Buffer): number {
  let bright = 0;
  for (const value of band) if (value > 200) bright += 1;
  return bright / band.length;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export async function checkBandedFrames(
  expectation: BandedFrameExpectation,
  options: { ffmpegPath?: string } = {},
): Promise<BandedFrameReport> {
  const ffmpegPath = options.ffmpegPath ?? process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";
  const { layout } = expectation;
  const failures: string[] = [];
  const panel = await imageAt(ffmpegPath, expectation.disclosurePanelPath, layout.width, layout.disclosure.height);
  if (ink(panel) < CAPTION_INK_MIN) failures.push("The disclosure panel itself has no visible text.");
  const sources = new Map<string, Buffer>();
  for (const beat of expectation.beats) {
    for (const source of beat.sources) {
      if (!sources.has(source)) sources.set(source, await imageAt(ffmpegPath, source, layout.width, layout.story.height));
    }
  }

  // Opening frame, just after every cut, each beat's middle, and the final frame.
  const last = expectation.durationSeconds - 0.05;
  const times = new Set<number>([0]);
  for (const beat of expectation.beats) {
    times.add(Math.min(beat.startSecond + 0.2, beat.endSecond));
    times.add((beat.startSecond + beat.endSecond) / 2);
  }
  times.add(last);

  const samples: FrameSample[] = [];
  const middles = new Map<number, Buffer>();
  for (const atSecond of [...times].sort((a, b) => a - b)) {
    const frame = await frameAt(ffmpegPath, expectation.videoPath, atSecond, layout);
    // The final beat holds past its planned end when narration runs long.
    const found = expectation.beats.findIndex((beat) => atSecond >= beat.startSecond && atSecond < beat.endSecond);
    const index = found === -1 ? expectation.beats.length - 1 : found;
    const beat = expectation.beats[index];

    const disclosureError = meanError(rows(frame, layout.width, layout.disclosure), panel);
    const story = rows(frame, layout.width, layout.story);
    const storyError = Math.min(...beat.sources.map((source) => meanError(story, sources.get(source)!)));
    const storyChange = Math.min(...beat.sources.map((source) => strongChange(story, sources.get(source)!)));
    const cueActive = expectation.captionCues.some((cue) => atSecond >= cue.startSecond && atSecond < cue.endSecond);
    const captionInk = cueActive ? ink(rows(frame, layout.width, layout.captions)) : null;

    if (disclosureError > BAND_MATCH_MAX_ERROR) {
      failures.push(`At ${atSecond.toFixed(2)}s the disclosure band does not show the verified disclosure panel (error ${disclosureError.toFixed(1)}).`);
    }
    if (storyError > BAND_MATCH_MAX_ERROR || storyChange > STORY_MAX_STRONG_CHANGE) {
      failures.push(`At ${atSecond.toFixed(2)}s the story band does not match beat ${index + 1}'s capture (error ${storyError.toFixed(1)}, ${(storyChange * 100).toFixed(2)}% of pixels changed): something is drawn over it, or it shows another picture.`);
    }
    if (captionInk !== null && captionInk < CAPTION_INK_MIN) {
      failures.push(`At ${atSecond.toFixed(2)}s a caption cue is active but the caption band is empty.`);
    }
    if (Math.abs(atSecond - (beat.startSecond + beat.endSecond) / 2) < 1e-6) middles.set(index, Buffer.from(story));
    samples.push({ atSecond: round(atSecond), beat: index + 1, disclosureError: round(disclosureError), storyError: round(storyError), storyChange: round(storyChange), captionInk: captionInk === null ? null : round(captionInk) });
  }

  for (let index = 1; index < expectation.beats.length; index += 1) {
    const before = middles.get(index - 1), after = middles.get(index);
    if (before && after && strongChange(before, after) < DISTINCT_PICTURE_MIN_CHANGE) {
      failures.push(`Beats ${index} and ${index + 1} show the same picture across the cut.`);
    }
  }
  return { ok: failures.length === 0, samples, failures };
}
