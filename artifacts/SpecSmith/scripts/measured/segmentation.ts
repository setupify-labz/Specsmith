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

/** Pinned identifier for the stage-1 rule. Changing the rule must change this string. */
export const SEGMENTATION_METHOD = 'presentation-path-v1';

/** Pinned identifier for the stage-2 rule. */
export const GPU_UTILIZATION_METHOD = 'gpu-utilization-v1';

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

export type SegmentationMethod = typeof SEGMENTATION_METHOD | typeof GPU_UTILIZATION_METHOD;

export interface SegmentationResult {
  method: SegmentationMethod;
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
  method: SegmentationMethod;
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

// ---------------------------------------------------------------------------
// Stage 2: GPU utilisation — internal transitions the presentation path misses
// ---------------------------------------------------------------------------
//
// WHY STAGE 1 IS NOT ENOUGH
// -------------------------
// presentation-path-v1 finds only the edges where the game takes and releases
// the display. A game's own scene-to-scene transitions happen while it still
// owns the swap chain, so PresentMode never changes and stage 1 retains them.
// In the RDR2 captures these are black screens between benchmark scenes: the
// game presents at a pinned ~3.905 ms (its 256 fps internal cap) while
// rendering essentially nothing, and averaging them in lifts the reported
// figure by roughly a quarter.
//
// THE SIGNAL IS GPU WORK, NOT FRAME RATE
// --------------------------------------
// `msGPUActive` is how long the GPU was busy producing a frame. Divided by the
// present interval it gives a UTILISATION RATIO — dimensionless, and therefore
// carrying no frame rate at all. In the captures:
//
//     gameplay     ratio median 0.98   (GPU busy essentially the whole frame)
//     transition   ratio median 0.18   (GPU idle 82% of the frame)
//
// A scene rendered at 250 fps while GPU-bound has a ratio near 1 and is KEPT;
// a black screen at 30 fps has a low ratio and is excluded. The rule is about
// whether the machine was doing the work a benchmark is meant to measure, and
// it cannot be restated as "FPS > X".
//
// THE THRESHOLD IS READ OFF THE DATA, NOT CHOSEN
// ----------------------------------------------
// The ratio histogram is strongly bimodal, so the cut is placed in the valley
// between the two modes — computed per capture from its own distribution
// rather than hardcoded. Both RDR2 captures independently put that valley in
// the same bin (0.50-0.55, holding 0.03% of frames), which is why the same
// derived cut applies to both without either being consulted about the other.
// If the distribution is NOT clearly bimodal the layer refuses rather than
// inventing a boundary.

/** Histogram resolution used to locate the valley between the two modes. */
export const RATIO_HISTOGRAM_BINS = 20;

/**
 * Each mode must hold at least this share of frames to count as a mode.
 *
 * Deliberately low. A capture whose only transition is a couple of seconds
 * inside a five-minute run has a small idle mode, and that transition is still
 * real; whether it gets excluded is then decided by the sustained-duration
 * gate, not by how much of the capture it happened to occupy. The valley-depth
 * test below is what keeps a small mode from being noise.
 */
export const MIN_MODE_SHARE = 0.01;

/** The valley must be this much emptier than the smaller mode to be a real separation. */
export const MAX_VALLEY_SHARE_OF_MODE = 0.05;

/** Modes must be at least this many bins apart; adjacent peaks are one mode. */
const MIN_MODE_SEPARATION_BINS = 4;

/**
 * How long a GPU-idle stretch must last to be a transition rather than a blip,
 * expressed as a MULTIPLE of the capture's own typical rendered frame.
 *
 * A single idle frame is GPU scheduling noise and is KEPT — excluding isolated
 * frames would be trimming the distribution rather than removing a transition.
 * A real scene change lasts orders of magnitude longer than one frame.
 *
 * Stated as a multiple, not in seconds, so that the rule carries no absolute
 * time and stays invariant under uniform scaling of the time base: the same
 * run on a machine twice as fast has frames and transitions both twice as
 * short, and must segment identically. An absolute threshold would silently
 * become a frame-rate-dependent knob, which is the failure mode this whole
 * layer exists to avoid.
 *
 * In both RDR2 captures the idle-run durations fall into two groups with the
 * widest gap between 0.4 s and 0.95 s, against a rendered-frame median near
 * 12.5 ms — a gap spanning roughly 32x to 76x. 40x sits inside it rather than
 * on either population, and the tests show the intervals are identical
 * anywhere in 32-76x, so this is not a knife edge.
 */
export const MIN_TRANSITION_FRAME_MULTIPLE = 40;

export interface RatioDistribution {
  /** Frame counts per ratio bin; the final bin also holds ratios >= 1. */
  histogram: number[];
  idleModeBin: number;
  busyModeBin: number;
  valleyBin: number;
  /** Midpoint of the valley bin — the derived cut. */
  threshold: number;
}

/**
 * Locates the valley between the GPU-idle and GPU-busy modes.
 *
 * Returns null when the distribution is not clearly bimodal, which the caller
 * must treat as "no structural evidence" rather than as "no transitions".
 */
export function findUtilizationThreshold(ratios: readonly number[]): RatioDistribution | null {
  const bins = RATIO_HISTOGRAM_BINS;
  const histogram = new Array<number>(bins).fill(0);
  for (const r of ratios) histogram[Math.min(bins - 1, Math.max(0, Math.floor(r * bins)))] += 1;

  const minMode = ratios.length * MIN_MODE_SHARE;
  const busyModeBin = histogram.indexOf(Math.max(...histogram));

  // The other mode is the tallest bin far enough away to be a separate population.
  let idleModeBin = -1;
  for (let i = 0; i < bins; i += 1) {
    if (Math.abs(i - busyModeBin) < MIN_MODE_SEPARATION_BINS) continue;
    if (histogram[i] < minMode) continue;
    if (idleModeBin < 0 || histogram[i] > histogram[idleModeBin]) idleModeBin = i;
  }
  if (idleModeBin < 0 || histogram[busyModeBin] < minMode) return null;

  const lo = Math.min(idleModeBin, busyModeBin);
  const hi = Math.max(idleModeBin, busyModeBin);
  let minCount = Infinity;
  for (let i = lo + 1; i < hi; i += 1) minCount = Math.min(minCount, histogram[i]);

  // A shallow dip between two bumps is not a separation.
  if (minCount > MAX_VALLEY_SHARE_OF_MODE * Math.min(histogram[lo], histogram[hi])) return null;

  // The valley can be several bins wide when it is genuinely empty. Take its
  // centre rather than whichever edge happened to be scanned first, so the cut
  // does not depend on iteration order.
  const floorBins: number[] = [];
  for (let i = lo + 1; i < hi; i += 1) if (histogram[i] === minCount) floorBins.push(i);
  const valleyBin = floorBins[Math.floor((floorBins.length - 1) / 2)];

  return { histogram, idleModeBin, busyModeBin, valleyBin, threshold: (valleyBin + 0.5) / bins };
}

export interface GpuUtilizationResult extends SegmentationResult {
  /** The cut derived from this capture's own ratio distribution. */
  utilizationThreshold: number;
  /** Median interval of frames the GPU rendered; the sustained gate's reference. */
  renderedFrameMedianMs: number;
  distribution: RatioDistribution;
}

/**
 * Excludes sustained GPU-idle stretches from an already presentation-path-clean
 * region.
 *
 * `frames` must already be the retained output of stage 1 (or a capture that
 * needs no stage-1 work). Indices in the result refer to THIS array.
 */
export function segmentByGpuUtilization(frames: readonly PresentMonFrame[]): GpuUtilizationResult {
  if (frames.length === 0) throw new AmbiguousSegmentationError('Cannot segment an empty capture.');

  if (frames.some((f) => !Number.isFinite(f.msGpuActive))) {
    throw new AmbiguousSegmentationError(
      'This capture has no msGPUActive column, so there is no evidence of whether the GPU was rendering. ' +
        'Internal transitions are invisible without it, and the only alternative — cutting on frame rate — would be fitting the segmentation to its own result. Re-capture with PresentMon\'s default columns.',
    );
  }

  const ratios = frames.map((f) => f.msGpuActive / f.frameTimeMs);
  const distribution = findUtilizationThreshold(ratios);
  const method = GPU_UTILIZATION_METHOD;

  if (!distribution) {
    // Not bimodal. Either the whole region was GPU-bound (nothing to exclude,
    // a legitimate answer) or it was idle throughout (not a benchmark at all).
    const median = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    if (median < 0.5) {
      throw new AmbiguousSegmentationError(
        `The GPU was idle for most of this capture (median utilisation ${(median * 100).toFixed(1)}%) and the distribution has no second mode. ` +
          'Nothing here looks like sustained rendering, so there is no benchmark region to identify.',
      );
    }
    return {
      method,
      steadyPresentMode: frames[0].presentMode,
      retainedFrameTimesMs: frames.map((f) => f.frameTimeMs),
      included: [{ startIndex: 0, endIndex: frames.length - 1, frameCount: frames.length, presentMode: frames[0].presentMode, startTimeSec: finiteOrNull(frames[0].timeInSeconds), endTimeSec: finiteOrNull(frames[frames.length - 1].timeInSeconds) }],
      excluded: [],
      totalFrames: frames.length,
      retainedFrames: frames.length,
      retainedSha256: sha256(canonicalFrameTimeBytes(frames.map((f) => f.frameTimeMs))),
      utilizationThreshold: Number.NaN,
      renderedFrameMedianMs: Number.NaN,
      distribution: { histogram: [], idleModeBin: -1, busyModeBin: -1, valleyBin: -1, threshold: Number.NaN },
    };
  }

  const idle = ratios.map((r) => r < distribution.threshold);

  // The reference frame: the median interval of frames the GPU actually
  // rendered. Everything about "long enough to be a transition" is expressed
  // against this, so no absolute time enters the rule.
  const busyFrameTimes = frames.filter((_, i) => !idle[i]).map((f) => f.frameTimeMs).sort((a, b) => a - b);
  if (busyFrameTimes.length === 0) {
    throw new AmbiguousSegmentationError('No frame in this capture shows the GPU rendering; there is no benchmark region to identify.');
  }
  const renderedFrameMedianMs = busyFrameTimes[Math.floor(busyFrameTimes.length / 2)];
  const minTransitionMs = renderedFrameMedianMs * MIN_TRANSITION_FRAME_MULTIPLE;

  // Maximal runs of same-classification frames, with their wall-clock length.
  const runs: Array<{ idle: boolean; start: number; end: number; seconds: number; ms: number }> = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i += 1) {
    if (i === frames.length || idle[i] !== idle[start]) {
      let ms = 0;
      for (let j = start; j < i; j += 1) ms += frames[j].frameTimeMs;
      runs.push({ idle: idle[start], start, end: i - 1, seconds: ms / 1000, ms });
      start = i;
    }
  }

  const included: SegmentInterval[] = [];
  const excluded: ExcludedInterval[] = [];
  const interval = (a: number, b: number): SegmentInterval => ({
    startIndex: a,
    endIndex: b,
    frameCount: b - a + 1,
    presentMode: frames[a].presentMode,
    startTimeSec: finiteOrNull(frames[a].timeInSeconds),
    endTimeSec: finiteOrNull(frames[b].timeInSeconds),
  });

  for (const run of runs) {
    // Isolated idle frames are kept: they are scheduling noise, and dropping
    // them would be trimming the distribution rather than removing a transition.
    const isTransition = run.idle && run.ms >= minTransitionMs;
    if (isTransition) {
      const meanRatio = ratios.slice(run.start, run.end + 1).reduce((a, b) => a + b, 0) / (run.end - run.start + 1);
      excluded.push({
        ...interval(run.start, run.end),
        reason: `Sustained GPU-idle stretch of ${run.seconds.toFixed(2)}s (${(run.ms / renderedFrameMedianMs).toFixed(0)}x this capture's median rendered frame): mean GPU utilisation ${(meanRatio * 100).toFixed(1)}% against a cut of ${(distribution.threshold * 100).toFixed(1)}% derived from this capture's own bimodal distribution. The GPU was presenting frames it had barely rendered, which is a transition, not gameplay.`,
      });
      continue;
    }

    // The first frame after an excluded stretch times the resumption, not a
    // frame rendered inside this region — the same boundary rule as stage 1.
    const preceded = run.start > 0 && excluded.some((e) => e.endIndex === run.start - 1);
    if (preceded) {
      excluded.push({
        ...interval(run.start, run.start),
        reason: 'First frame after a transition: its interval spans the resumption of rendering, so it times the transition ending rather than a frame rendered inside this region.',
      });
      if (run.start + 1 > run.end) continue;
      included.push(interval(run.start + 1, run.end));
      continue;
    }
    included.push(interval(run.start, run.end));
  }

  const retainedFrameTimesMs: number[] = [];
  for (const iv of included) for (let i = iv.startIndex; i <= iv.endIndex; i += 1) retainedFrameTimesMs.push(frames[i].frameTimeMs);

  if (retainedFrameTimesMs.length === 0) {
    throw new AmbiguousSegmentationError('Every frame fell inside a transition; there is nothing left to measure.');
  }

  return {
    method,
    steadyPresentMode: frames[0].presentMode,
    retainedFrameTimesMs,
    included,
    excluded,
    totalFrames: frames.length,
    retainedFrames: retainedFrameTimesMs.length,
    retainedSha256: sha256(canonicalFrameTimeBytes(retainedFrameTimesMs)),
    utilizationThreshold: distribution.threshold,
    renderedFrameMedianMs,
    distribution,
  };
}

/**
 * Both stages, in the order they must run.
 *
 * Stage 1 removes the fullscreen edges the compositor paced. Stage 2 removes
 * the game's own internal transitions from what stage 1 kept. They are
 * separate rules on separate evidence — a capture can need either, both, or
 * neither — and each records its own intervals, so a reader can see which
 * rule removed what.
 *
 * Indices in `gpuUtilization` are relative to STAGE 1's retained frames, not
 * to the original capture; `intervalsInCaptureIndices` maps them back.
 */
export interface BenchmarkSegmentation {
  presentationPath: SegmentationResult;
  gpuUtilization: GpuUtilizationResult;
  retainedFrameTimesMs: number[];
  retainedSha256: string;
  /** Included/excluded intervals from BOTH stages, in original capture indices. */
  intervalsInCaptureIndices: { included: SegmentInterval[]; excluded: ExcludedInterval[] };
}

export function segmentBenchmark(frames: readonly PresentMonFrame[]): BenchmarkSegmentation {
  const presentationPath = segmentCapture(frames);

  // Stage 1's retained frames, and the map back to original capture indices.
  const keptIndices: number[] = [];
  for (const iv of presentationPath.included) {
    for (let i = iv.startIndex; i <= iv.endIndex; i += 1) keptIndices.push(i);
  }
  const stage1Frames = keptIndices.map((i) => frames[i]);
  const gpuUtilization = segmentByGpuUtilization(stage1Frames);

  const remap = (iv: SegmentInterval): SegmentInterval => ({
    ...iv,
    startIndex: keptIndices[iv.startIndex],
    endIndex: keptIndices[iv.endIndex],
  });

  return {
    presentationPath,
    gpuUtilization,
    retainedFrameTimesMs: gpuUtilization.retainedFrameTimesMs,
    retainedSha256: gpuUtilization.retainedSha256,
    intervalsInCaptureIndices: {
      included: gpuUtilization.included.map(remap),
      excluded: [
        ...presentationPath.excluded,
        ...gpuUtilization.excluded.map((e) => ({ ...remap(e), reason: e.reason })),
      ].sort((a, b) => a.startIndex - b.startIndex),
    },
  };
}
