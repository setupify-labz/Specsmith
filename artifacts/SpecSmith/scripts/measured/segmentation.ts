// Benchmark segmentation: which part of a capture is the measurement.
//
// A capture is not automatically a measurement. A real one begins before the
// game reaches its steady rendering state and ends after it leaves it, and
// those edges are not gameplay — they are the game entering and leaving
// exclusive fullscreen. Averaging them in silently mixes a compositor-paced
// startup into a figure labelled as the game's frame rate.
//
// THE SIGNAL IS THE PRESENTATION PATH, NOT THE FRAME RATE
// -------------------------------------------------------
// Segmentation here keys on PresentMon's `PresentMode` — HOW Windows put each
// frame on screen. `Hardware: Legacy Flip` (or another hardware flip mode)
// means the game owned the swap chain; `Composed: *` means the desktop
// compositor was in the path, which is what happens while the game is still
// taking the display, or has just given it back.
//
// This is deliberately NOT a frame-time heuristic. Nothing in this file reads
// an average, compares against an expected FPS, or trims until a number looks
// right — the rule is stated over a presentation-mode label that is a fact
// about how the frame was displayed, and it would produce the same cut on a
// capture whose frame rate was half or double. That property is the whole
// point: a segmentation tuned to its own result proves nothing.
//
// WHAT IS NOT EXCLUDED
// --------------------
// Isolated stalls INSIDE the steady region are retained, however large. A
// 350 ms hitch during gameplay is a real stutter and belongs in the 1% low —
// removing it would be manufacturing a smoother result than the machine
// produced. Only whole runs of frames the GPU presented through a different
// path are excluded, and every one is recorded with its reason.
//
// AMBIGUITY IS REFUSED
// --------------------
// When the capture does not have one clear steady region — no dominant path,
// two comparable candidates, or the steady frames scattered across many
// fragments — this throws instead of picking. Which fragments constitute "the
// run" is a judgement, and a wrong-but-plausible split is worse than a
// refusal because nothing downstream can detect it.

import { createHash } from 'node:crypto';

import { canonicalFrameTimeBytes } from '../../src/lib/measured/frameTimes';
import type { PresentMonFrame } from './presentmon';

/** Pinned identifier for this rule. Changing the rule must change this string. */
export const SEGMENTATION_METHOD = 'presentation-path-v1';

/**
 * The steady path must be most of the capture.
 *
 * Below this the capture is not predominantly the game rendering in its own
 * swap chain, so what it measures is not the game's steady frame rate.
 */
export const MIN_STEADY_SHARE = 0.5;

/**
 * A runner-up path this close to the leader means there is no clear winner.
 *
 * Two comparable presentation paths is the shape of a capture that spans a
 * mode change mid-run — genuinely two different rendering situations, and
 * choosing either would be arbitrary.
 */
export const AMBIGUITY_MARGIN = 0.8;

/**
 * More separate steady stretches than this and the capture is fragmented.
 *
 * One clean run yields one stretch; a couple of alt-tabs yields a few. Beyond
 * that, deciding which stretches belong to the measurement is a judgement this
 * layer refuses to make on its own.
 */
export const MAX_STEADY_RUNS = 4;

/** A hardware flip path — the game presenting directly, not via the compositor. */
const STEADY_MODE_PATTERN = /^Hardware[: ]/i;

export class AmbiguousSegmentationError extends Error {}

export interface SegmentInterval {
  /** Inclusive index into the parser's frameTimesMs / frames arrays. */
  startIndex: number;
  endIndex: number;
  frameCount: number;
  presentMode: string;
  /** From PresentMon's TimeInSeconds; null when the column was absent. */
  startTimeSec: number | null;
  endTimeSec: number | null;
}

export interface ExcludedInterval extends SegmentInterval {
  reason: string;
}

export interface SegmentationResult {
  method: typeof SEGMENTATION_METHOD;
  /** The presentation path judged to be the steady one. */
  steadyPresentMode: string;
  /** Frame times of the retained region, in capture order. */
  retainedFrameTimesMs: number[];
  included: SegmentInterval[];
  excluded: ExcludedInterval[];
  totalFrames: number;
  retainedFrames: number;
  /** SHA-256 over the retained frame times, canonicalised as the store does. */
  retainedSha256: string;
}

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** TimeInSeconds is absent in reduced captures; a gap is recorded as null, never as 0. */
const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** Maximal runs of consecutive frames sharing a presentation mode. */
function presentationRuns(frames: readonly PresentMonFrame[]): SegmentInterval[] {
  const runs: SegmentInterval[] = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i += 1) {
    if (i === frames.length || frames[i].presentMode !== frames[start].presentMode) {
      runs.push({
        startIndex: start,
        endIndex: i - 1,
        frameCount: i - start,
        presentMode: frames[start].presentMode,
        startTimeSec: finiteOrNull(frames[start].timeInSeconds),
        endTimeSec: finiteOrNull(frames[i - 1].timeInSeconds),
      });
      start = i;
    }
  }
  return runs;
}

/**
 * Splits a capture into the region that is the measurement and the regions
 * that are not.
 *
 * Deterministic: the same frames always yield the same cut, and the cut is
 * decided entirely by presentation mode. Throws AmbiguousSegmentationError
 * rather than guessing when the capture has no single clear steady region.
 */
export function segmentCapture(frames: readonly PresentMonFrame[]): SegmentationResult {
  if (frames.length === 0) throw new AmbiguousSegmentationError('Cannot segment an empty capture.');

  if (frames.some((f) => f.presentMode === '')) {
    throw new AmbiguousSegmentationError(
      'This capture has no PresentMode column, so there is no structural signal for where the game reached its steady rendering state. ' +
        'Re-capture with PresentMon\'s default columns. Segmenting on frame times alone would mean choosing a cut by how the resulting average looks, which is exactly what this layer refuses to do.',
    );
  }

  const runs = presentationRuns(frames);

  // Rank candidate paths by how much of the capture each accounts for.
  const byMode = new Map<string, number>();
  for (const r of runs) byMode.set(r.presentMode, (byMode.get(r.presentMode) ?? 0) + r.frameCount);
  const ranked = [...byMode.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const [steadyMode, steadyCount] = ranked[0];
  const share = steadyCount / frames.length;

  if (!STEADY_MODE_PATTERN.test(steadyMode)) {
    throw new AmbiguousSegmentationError(
      `The dominant presentation path is "${steadyMode}", which is not a hardware flip mode — the game never held the swap chain for most of this capture. ` +
        'That is a windowed or compositor-paced session, not a measurement of the game rendering at full rate, so it is refused rather than reported as one.',
    );
  }

  if (share < MIN_STEADY_SHARE) {
    throw new AmbiguousSegmentationError(
      `The steady path "${steadyMode}" covers only ${(share * 100).toFixed(1)}% of this capture (minimum ${(MIN_STEADY_SHARE * 100).toFixed(0)}%). ` +
        'Most of the capture is something other than the game rendering steadily, so which part is the measurement is not clear from the data.',
    );
  }

  if (ranked.length > 1 && ranked[1][1] >= steadyCount * AMBIGUITY_MARGIN) {
    throw new AmbiguousSegmentationError(
      `Two presentation paths are comparable in size — "${steadyMode}" (${steadyCount} frames) and "${ranked[1][0]}" (${ranked[1][1]} frames). ` +
        'There is no clear steady region, so choosing one would be arbitrary.',
    );
  }

  const steadyRuns = runs.filter((r) => r.presentMode === steadyMode);
  if (steadyRuns.length > MAX_STEADY_RUNS) {
    throw new AmbiguousSegmentationError(
      `The steady path is split across ${steadyRuns.length} separate stretches (maximum ${MAX_STEADY_RUNS}). ` +
        'A capture this fragmented needs a human to say which stretches are the run; stitching them automatically would invent a continuity the capture does not have.',
    );
  }

  const included: SegmentInterval[] = [];
  const excluded: ExcludedInterval[] = [];

  for (const run of runs) {
    if (run.presentMode !== steadyMode) {
      excluded.push({
        ...run,
        reason: `Presented via "${run.presentMode}" rather than the steady path "${steadyMode}" — the desktop compositor was in the path, so these frames are paced by it rather than by the game.`,
      });
      continue;
    }

    // The first frame of a run PRECEDED by another path measures the interval
    // that spans the mode change itself, not a frame rendered within this run.
    // It is dropped for the same reason the parser drops the capture's very
    // first present: there is no comparable prior frame inside this region.
    // A run starting at index 0 has no preceding mode, so nothing to drop.
    if (run.startIndex > 0) {
      excluded.push({
        startIndex: run.startIndex,
        endIndex: run.startIndex,
        frameCount: 1,
        presentMode: run.presentMode,
        startTimeSec: finiteOrNull(frames[run.startIndex].timeInSeconds),
        endTimeSec: finiteOrNull(frames[run.startIndex].timeInSeconds),
        reason: 'First frame after a presentation-path change: its interval spans the mode switch, so it times the transition rather than a frame rendered inside this region.',
      });
      if (run.startIndex + 1 > run.endIndex) continue;
      included.push({
        ...run,
        startIndex: run.startIndex + 1,
        frameCount: run.frameCount - 1,
        startTimeSec: finiteOrNull(frames[run.startIndex + 1].timeInSeconds),
      });
      continue;
    }
    included.push({ ...run });
  }

  const retainedFrameTimesMs: number[] = [];
  for (const iv of included) {
    for (let i = iv.startIndex; i <= iv.endIndex; i += 1) retainedFrameTimesMs.push(frames[i].frameTimeMs);
  }

  if (retainedFrameTimesMs.length === 0) {
    throw new AmbiguousSegmentationError('Segmentation retained no frames at all; there is nothing to measure.');
  }

  return {
    method: SEGMENTATION_METHOD,
    steadyPresentMode: steadyMode,
    retainedFrameTimesMs,
    included,
    excluded,
    totalFrames: frames.length,
    retainedFrames: retainedFrameTimesMs.length,
    retainedSha256: sha256(canonicalFrameTimeBytes(retainedFrameTimesMs)),
  };
}

/**
 * The record that travels with an observation.
 *
 * Ties a measurement to the exact bytes it came from AND the exact subset of
 * them it was computed over. `sourceSha256` pins the capture file;
 * `retainedSha256` pins the frames kept; the intervals say precisely which
 * ones and why the rest went. Anyone holding the original CSV can re-run the
 * rule and get the same answer, or see that they did not.
 */
export interface SegmentationProvenance {
  method: typeof SEGMENTATION_METHOD;
  sourceSha256: string;
  retainedSha256: string;
  steadyPresentMode: string;
  totalFrames: number;
  retainedFrames: number;
  included: SegmentInterval[];
  excluded: ExcludedInterval[];
}

/** Builds the provenance record. `csvBytes` must be the capture file verbatim. */
export function segmentationProvenance(result: SegmentationResult, csvBytes: string): SegmentationProvenance {
  return {
    method: result.method,
    sourceSha256: sha256(csvBytes),
    retainedSha256: result.retainedSha256,
    steadyPresentMode: result.steadyPresentMode,
    totalFrames: result.totalFrames,
    retainedFrames: result.retainedFrames,
    included: result.included,
    excluded: result.excluded,
  };
}
