// Deterministic frame-time statistics.
//
// Every figure a measured observation publishes is computed here from the raw
// frame times. The collector never reports a result — it reports frames, and
// these functions derive the numbers. That is the single biggest trust
// difference between a measured observation and a source-derived record: an
// average FPS that cannot be recomputed is a claim, not a measurement.
//
// DETERMINISM IS A REQUIREMENT, NOT A NICETY
// -------------------------------------------
// Validation re-runs these functions and compares against the stored values,
// so identical input must give bit-identical output on every machine and every
// run. Two things would break that if left implicit, and both are pinned:
//
//   1. Floating-point summation is order-dependent. Every sum here runs over a
//      deterministically ordered array (either the array as captured, or the
//      array after a total-order sort), never over an iteration order that
//      could vary.
//   2. Results are rounded through one shared helper, so a value written to a
//      record and a value recomputed from the same frames round identically.

import { PINNED_ONE_PERCENT_LOW_METHOD, type CapDetection, type FrameTimeStats } from './types';

/** Two decimal places, applied to every published figure. */
export function roundFps(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How many frames make up "the slowest 1%".
 *
 * floor(n/100) is the literal reading. The max(1, …) floor means a short run
 * still yields a defined figure rather than dividing by zero — though runs
 * that short are separately rejected by MIN_FRAME_COUNT, so in practice this
 * only matters for tests and for the 0.1% figure on smaller samples.
 */
export function slowestFrameCount(totalFrames: number, fraction: number): number {
  return Math.max(1, Math.floor(totalFrames * fraction));
}

/**
 * THE PINNED 1%-LOW CALCULATION: the mean FPS of the slowest 1% of frames.
 *
 * Slowest means longest frame time. The k longest frame times are averaged,
 * and that mean frame time is converted to FPS. Note the order — averaging the
 * frame TIMES and converting once is not the same as converting each frame to
 * an FPS and averaging those (that would be a harmonic-vs-arithmetic mix-up
 * and would read higher). This is the definition recorded as
 * `mean-slowest-1pct`.
 *
 * The alternative reading, `p99-frametime`, takes the single frame time at the
 * 99th percentile instead. It is deliberately NOT implemented here: the point
 * of pinning is that there is one calculation, and a record claiming the other
 * method is rejected rather than silently recomputed under ours.
 */
export function meanSlowestFractionFps(frameTimesMs: readonly number[], fraction: number): number {
  if (frameTimesMs.length === 0) throw new Error('cannot compute a low from zero frames');

  // Descending numeric sort on a copy — a total order, so the slice and the
  // subsequent summation are both deterministic regardless of input order.
  const descending = [...frameTimesMs].sort((a, b) => b - a);
  const k = slowestFrameCount(descending.length, fraction);

  let sum = 0;
  for (let i = 0; i < k; i += 1) sum += descending[i];
  const meanFrameTimeMs = sum / k;

  return roundFps(1000 / meanFrameTimeMs);
}

/** Total frames divided by total elapsed time. Summed in capture order. */
export function averageFps(frameTimesMs: readonly number[]): number {
  if (frameTimesMs.length === 0) throw new Error('cannot compute an average from zero frames');
  let totalMs = 0;
  for (const ms of frameTimesMs) totalMs += ms;
  return roundFps((frameTimesMs.length * 1000) / totalMs);
}

export function runDurationSec(frameTimesMs: readonly number[]): number {
  let totalMs = 0;
  for (const ms of frameTimesMs) totalMs += ms;
  return Math.round((totalMs / 1000) * 1000) / 1000;
}

/** Frame time periods of common refresh rates, in ms. */
const REFRESH_PERIODS_MS = [
  1000 / 60, 1000 / 75, 1000 / 90, 1000 / 100,
  1000 / 120, 1000 / 144, 1000 / 165, 1000 / 240,
];

/**
 * Flags a run that looks limited rather than hardware-bound.
 *
 * A capped run's average FPS measures the cap, not the hardware, so comparing
 * it against an uncapped run is meaningless. This is a HEURISTIC and is
 * reported as a WARNING, never a rejection — a genuinely stable run on
 * over-powered hardware can legitimately look tightly clustered, and throwing
 * away a real measurement would be the worse error.
 *
 * Thresholds are deliberately conservative (95% of frames within ±0.5% of the
 * median) to keep false positives rare.
 */
export function detectCap(frameTimesMs: readonly number[]): { capDetected: CapDetection; clusteredFraction: number } {
  if (frameTimesMs.length === 0) return { capDetected: 'none', clusteredFraction: 0 };

  const ascending = [...frameTimesMs].sort((a, b) => a - b);
  const median = ascending[Math.floor(ascending.length / 2)];
  if (median <= 0) return { capDetected: 'none', clusteredFraction: 0 };

  const band = median * 0.005;
  let within = 0;
  for (const ms of ascending) if (Math.abs(ms - median) <= band) within += 1;
  const clusteredFraction = within / ascending.length;

  if (clusteredFraction < 0.95) return { capDetected: 'none', clusteredFraction };

  const nearRefresh = REFRESH_PERIODS_MS.some((period) => Math.abs(median - period) <= period * 0.01);
  return { capDetected: nearRefresh ? 'vsync' : 'fps-limit', clusteredFraction };
}

/** Everything a measured observation publishes, derived in one place. */
export function computeFrameTimeStats(frameTimesMs: readonly number[]): FrameTimeStats {
  const cap = detectCap(frameTimesMs);
  return {
    averageFps: averageFps(frameTimesMs),
    onePercentLow: meanSlowestFractionFps(frameTimesMs, 0.01),
    zeroPointOnePercentLow: meanSlowestFractionFps(frameTimesMs, 0.001),
    frameCount: frameTimesMs.length,
    runDurationSec: runDurationSec(frameTimesMs),
    capDetected: cap.capDetected,
    clusteredFraction: Math.round(cap.clusteredFraction * 10000) / 10000,
  };
}

/**
 * The exact bytes hashed into FrameTimeRef.sha256.
 *
 * Pinned so the hash is reproducible anywhere and independent of how the blob
 * was compressed on disk.
 */
export function canonicalFrameTimeBytes(frameTimesMs: readonly number[]): string {
  return JSON.stringify(frameTimesMs);
}

export { PINNED_ONE_PERCENT_LOW_METHOD };
