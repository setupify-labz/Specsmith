// RDR2 built-in benchmark segmentation: a READ-ONLY, RESEARCH-ONLY analyzer.
//
// WHAT THIS IS FOR
// ----------------
// RDR2 ships a five-scene built-in benchmark. The open question this module
// exists to answer HONESTLY is: can those five scenes be isolated
// REPRODUCIBLY from PresentMon data alone? Not "can we produce a number that
// matches RDR2's own results screen" — that would be fitting an algorithm to
// an answer, which proves nothing. This module derives structure from the
// recording and then reports, with evidence, whether the structure it found
// is credible. When it is not, it says so and stops.
//
// WHAT THIS IS NOT
// ----------------
// It is not a measurement path. Nothing here writes an observation, touches
// measuredObservations.json or the frame-time archive, or feeds
// collect.ts. Every successful result is stamped `publishable: false` and its
// per-scene figures live under a `research` key, because gameplay inside a
// research capture is uncontrolled and a scene average computed from it would
// look exactly like a real measurement without being one.
//
// It also never modifies the bundle it reads. The CSV and manifest are opened
// for reading only; an analysis report, if one is written at all, goes to a
// caller-chosen path OUTSIDE the bundle.
//
// THE SIGNAL, AND WHY IT IS NOT FRAME RATE
// -----------------------------------------
// Reused wholesale from ./segmentation.ts, which already established it for
// the observation path: `msGPUActive / frameTimeMs` is a dimensionless
// UTILISATION RATIO carrying no frame rate at all. RDR2's inter-scene
// transitions are black screens presented at the engine's internal cap while
// the GPU renders essentially nothing — high FPS, near-zero GPU work. Real
// gameplay at the same FPS is GPU-bound. A rule stated over frame rate cannot
// tell those apart; a rule stated over utilisation can, and would produce the
// same cut on a machine half or twice as fast.
//
// The idle/busy cut is NOT a constant in this file. It is read off each
// capture's own bimodal ratio histogram by segmentation.ts's
// findUtilizationThreshold, and when that distribution is not clearly bimodal
// this module refuses rather than inventing a boundary.
//
// NO OBSERVED TIMESTAMPS ARE ENCODED HERE
// ---------------------------------------
// Real runs put gameplay start near 38s and 75s, and inter-scene transitions
// roughly 30s apart. Those numbers appear NOWHERE in this algorithm and are
// not used to select, rank, or tune any boundary. They exist only as
// after-the-fact verification that what this derives matches what a human
// observed. Likewise RDR2's own displayed min/max/average is never read here:
// RDR2 and PresentMon may not even define FPS the same way, so treating that
// display as ground truth would silently tune this to another tool's
// methodology.
//
// STRUCTURE IS THE LOAD-BEARING CLAIM
// -----------------------------------
// A benchmark run has a shape: menu/loading, then five gameplay scenes
// separated by exactly four transitions, then a results screen. This module
// requires that exact shape and refuses anything else. Four transitions is
// not a tuning parameter — it is what "five scenes" means. A capture showing
// three, or six, is either not a complete benchmark run or has a transition
// this signal cannot see, and both are reasons to stop rather than to pick
// the four best-looking candidates.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { parsePresentMonCsv, PresentMonFormatError, type PresentMonFrame } from './presentmon';
import { findUtilizationThreshold, MIN_TRANSITION_FRAME_MULTIPLE, type RatioDistribution } from './segmentation';
import type { Rdr2ResearchManifest } from './collect';

/** Bumped when the shape of an analysis result changes in a way a reader must notice. */
export const RDR2_ANALYSIS_SCHEMA_VERSION = 1;

/** The benchmark's own structure: five scenes are separated by exactly four transitions. */
export const RDR2_EXPECTED_SCENES = 5;
export const RDR2_EXPECTED_TRANSITIONS = RDR2_EXPECTED_SCENES - 1;

/**
 * Floors below which there is not enough recording to reason about structure
 * at all. Deliberately far below a real benchmark run: these exist to reject
 * a truncated or empty capture, not to encode how long RDR2's benchmark is.
 */
export const MIN_ANALYSIS_FRAMES = 1000;
export const MIN_ANALYSIS_DURATION_SEC = 30;

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Stationarity: telling scene-5 gameplay from the results screen
// ---------------------------------------------------------------------------
//
// A REAL WINDOWS RUN FALSIFIED THE FIRST DESIGN
// ----------------------------------------------
// This module originally required the capture to end with a GPU-IDLE block,
// on the assumption that a results screen renders nothing. A real 420-second
// RDR2 run disproved that: its results screen is GPU-BUSY and sits at a
// stable frame rate, and the analyzer wrongly reported that the benchmark had
// never finished — while a screenshot from that same run showed the completed
// results screen. GPU load is therefore NOT the signal at this boundary.
//
// WHAT ACTUALLY SEPARATES THEM IS STATIONARITY, NOT LOAD
// ------------------------------------------------------
// Scene-5 gameplay is DYNAMIC: the camera moves, the scene's content changes,
// and the frame-time LEVEL drifts continuously as load varies. The results
// screen is a fixed image: whatever it costs to draw, it costs the same from
// one moment to the next, so the frame-time level stops drifting. That
// difference is measurable without reference to any particular frame rate.
//
// THE MEASURE IS SCALE-FREE, AND THE BAR COMES FROM THE RUN ITSELF
// ----------------------------------------------------------------
// Stability is the RELATIVE spread of per-window medians (a MAD divided by a
// median — dimensionless, so it is identical on a machine twice as fast), and
// the bar it must clear is derived from the capture's OWN gameplay: scenes 1
// to 4 are already confidently identified by the transition detection, so
// they supply an empirical picture of what dynamic gameplay looks like on
// this machine, in this run. The results screen must be markedly more
// stationary than even the CALMEST of those scenes.
//
// Nothing here encodes a frame rate, a timestamp, a duration, or any figure
// from RDR2's own results screen. Those displayed statistics are independent
// evidence a human may compare against afterwards; they are not an
// optimisation target and are never read by this code.

/**
 * Frames per stability window.
 *
 * A sample size, not a threshold on the data: enough frames for a median and
 * a MAD to mean something, few enough that many windows fit inside one scene.
 * Expressed in frames rather than seconds so it does not import a time base.
 */
export const STABILITY_WINDOW_FRAMES = 64;

/** A regime needs at least this many windows before its spread is worth believing. */
export const MIN_STABILITY_WINDOWS = 4;

/**
 * Longest span, in windows, used when comparing a candidate regime against
 * gameplay.
 *
 * Both sides must be measured over the SAME span for the comparison to be
 * fair, and that span cannot exceed the shorter of the two. Capping it here
 * keeps a legitimately short results screen measurable: without the cap the
 * span would stretch to a whole gameplay scene, and any results screen
 * briefer than one scene could never be evaluated at all.
 */
export const MAX_COMPARISON_WINDOWS = 8;

/**
 * How much more stationary than the calmest gameplay scene a trailing regime
 * must be before it is called the results screen.
 *
 * A RATIO against a bar measured from this same run, so it carries no frame
 * rate and no absolute time. 2x is comfortably inside the gap the real data
 * shows between drifting gameplay and a fixed screen; the tests confirm the
 * boundary does not move across a range around it, so it is not a knife edge.
 */
export const STRICT_STABILITY_FACTOR = 2;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Median absolute deviation — a spread measure a few outliers cannot inflate. */
function medianAbsoluteDeviation(xs: readonly number[], centre: number): number {
  return median([...xs.map((x) => Math.abs(x - centre))].sort((a, b) => a - b));
}

/**
 * Relative spread: MAD / median. Dimensionless, so the same drifting
 * gameplay scores identically whether it ran at 60 fps or 240.
 */
function relativeSpread(xs: readonly number[]): number {
  if (xs.length === 0) return Number.POSITIVE_INFINITY;
  const centre = median([...xs].sort((a, b) => a - b));
  if (!(centre > 0)) return Number.POSITIVE_INFINITY;
  return medianAbsoluteDeviation(xs, centre) / centre;
}

interface StabilityWindow {
  startIndex: number;
  endIndex: number;
  startOffsetSec: number;
  endOffsetSec: number;
  medianFrameTimeMs: number;
  meanGpuRatio: number;
}

/** Chops a frame range into fixed-size windows and summarises each one. */
function stabilityWindows(
  frames: readonly PresentMonFrame[],
  ratios: readonly number[],
  t0: number,
  startIndex: number,
  endIndex: number,
): StabilityWindow[] {
  const out: StabilityWindow[] = [];
  for (let s = startIndex; s + STABILITY_WINDOW_FRAMES - 1 <= endIndex; s += STABILITY_WINDOW_FRAMES) {
    const e = s + STABILITY_WINDOW_FRAMES - 1;
    const times: number[] = [];
    let ratioSum = 0;
    for (let i = s; i <= e; i += 1) {
      times.push(frames[i].frameTimeMs);
      ratioSum += ratios[i];
    }
    out.push({
      startIndex: s,
      endIndex: e,
      startOffsetSec: frames[s].timeInSeconds - t0,
      endOffsetSec: frames[e].timeInSeconds - t0,
      medianFrameTimeMs: median(times.sort((a, b) => a - b)),
      meanGpuRatio: ratioSum / (e - s + 1),
    });
  }
  return out;
}

/**
 * How non-stationary a stretch of windows is: the worse of its frame-time
 * level drift and its GPU-load drift.
 *
 * Taking the worse of the two means a regime is only called stable when BOTH
 * are stable — a screen whose frame times hold steady while its GPU load
 * wanders is not the fixed image this is looking for.
 */
function regimeInstability(windows: readonly StabilityWindow[]): number {
  if (windows.length < MIN_STABILITY_WINDOWS) return Number.POSITIVE_INFINITY;
  return Math.max(
    relativeSpread(windows.map((w) => w.medianFrameTimeMs)),
    relativeSpread(windows.map((w) => w.meanGpuRatio)),
  );
}

// ---------------------------------------------------------------------------
// Distribution change: separating regimes WITHOUT requiring stillness
// ---------------------------------------------------------------------------
//
// WHY A SECOND ROUTE EXISTS
// -------------------------
// The stationarity test above asks "has the frame-time LEVEL stopped moving?".
// That is the right question for a results screen which is one frozen image.
// It is the WRONG question for one that animates — a slow camera push behind
// the numbers, a shader that cycles, a spinner — because such a screen never
// stops moving and so can never be twice as still as the calmest span of
// gameplay, no matter how obviously it is a different thing.
//
// A second real run made that concrete: the tail was correctly isolated, the
// four transitions before it were found, and the stationarity route still
// rejected every possible suffix. Rather than loosen the stationarity bar —
// which would weaken it everywhere, including on the truncated captures it
// correctly refuses — this adds an INDEPENDENT route that asks a different
// question entirely.
//
// THE DIFFERENT QUESTION
// ----------------------
// Not "is it still?" but "is it the SAME THING throughout, and a DIFFERENT
// thing from what came before?". A results screen — animated or not — draws
// the same content for its whole life, so any two equal stretches of it have
// the same frame-time DISTRIBUTION even when the level inside each stretch
// swings. Gameplay does not: a benchmark scene pans across changing terrain,
// so two stretches ten seconds apart are drawing different things and their
// distributions differ.
//
// The measure is the two-sample Kolmogorov-Smirnov statistic: the largest gap
// between two empirical CDFs. It is computed from RANKS, so it is invariant
// under any monotone rescaling of the signal — a machine twice as fast
// produces the identical number. It is bounded in [0, 1], so it imports no
// unit, no frame rate and no duration.
//
// BOTH BARS COME FROM THE RUN'S OWN GAMEPLAY, WITH NO TUNING FACTOR
// -----------------------------------------------------------------
// Scenes 1 to 4 are already confidently identified by the transition
// detection, so they say what ordinary gameplay does on this machine:
//
//   changeBar   = the LARGEST distributional jump gameplay makes between two
//                 neighbouring equal-length stretches. A real regime change
//                 must be bigger than anything gameplay does on its own.
//   cohesionBar = the SMALLEST "all parts agree with all other parts" figure
//                 gameplay manages over a run of the SAME NUMBER OF CHUNKS.
//                 A results screen must hold together better than the most
//                 self-consistent equal-length stretch of gameplay in the run.
//
// The chunk count is matched for the same reason the stability span is: a
// signal that trends always disagrees with itself more the longer you watch
// it, so a two-chunk suffix measured against a three-chunk scene is judged
// against an inflated bar. Reference takes gameplay's BEST run at that
// length, candidate is judged by its WORST — the same asymmetry the
// stationarity route uses, and for the same reason.
//
// DISTINCT FROM ALL OF GAMEPLAY, NOT MERELY FROM THE MOMENT BEFORE
// -----------------------------------------------------------------
// Comparing the candidate only against the stretch immediately before it is
// not enough, and a synthetic fixture caught that: gameplay which steadily
// gets heavier ends every scene in a state unlike the moment before, so a
// final scene that merely eased off read as a change of regime. A results
// screen is not just unlike the second before it — it is unlike EVERY part of
// the benchmark. So the candidate is compared against the preceding stretch
// AND against every equal-length stretch of every identified gameplay scene,
// and the SMALLEST of those distances must still clear changeBar. A tail that
// resembles any earlier moment of gameplay is, on this evidence, gameplay.
//
// Note there is no multiplier on either: the comparisons are strict
// inequalities against figures measured from this same recording. Unlike the
// stationarity route, this route has no constant to tune at all.
//
// FAIL-CLOSED IS PRESERVED
// ------------------------
// A capture truncated part-way through scene 5 fails BOTH routes: its tail
// keeps drifting (so it is not stationary) and its later parts keep differing
// from its earlier parts (so it is not cohesive). Proving cohesion also needs
// at least two full comparison chunks, so a trailing stretch too short to
// have any internal evidence is rejected for want of evidence rather than
// accepted for want of contradiction.

/** Sorted samples of both signals over a stretch of windows. */
interface RegimeSample {
  frameTimes: number[];
  ratios: number[];
}

function sampleWindows(
  frames: readonly PresentMonFrame[],
  ratios: readonly number[],
  windows: readonly StabilityWindow[],
): RegimeSample {
  const frameTimes: number[] = [];
  const gpu: number[] = [];
  for (const w of windows) {
    for (let i = w.startIndex; i <= w.endIndex; i += 1) {
      frameTimes.push(frames[i].frameTimeMs);
      gpu.push(ratios[i]);
    }
  }
  return { frameTimes: frameTimes.sort((a, b) => a - b), ratios: gpu.sort((a, b) => a - b) };
}

/**
 * Two-sample Kolmogorov-Smirnov statistic over two ascending-sorted samples:
 * the largest vertical gap between their empirical CDFs, in [0, 1].
 *
 * Rank-based, therefore scale-free — the same two regimes score identically
 * on hardware of any speed.
 */
export function ksStatistic(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 1;
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < a.length && j < b.length) {
    const v = Math.min(a[i], b[j]);
    while (i < a.length && a[i] <= v) i += 1;
    while (j < b.length && b[j] <= v) j += 1;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  return Math.max(d, Math.abs(i / a.length - j / b.length));
}

/**
 * How different two regimes are: the worse of their frame-time and
 * GPU-utilisation distributional distance.
 *
 * Taking the worse means two stretches count as "the same regime" only when
 * BOTH signals agree they are, which is the conservative direction: it makes
 * a change easy to see and cohesion hard to claim.
 */
function regimeDivergence(a: RegimeSample, b: RegimeSample): number {
  return Math.max(ksStatistic(a.frameTimes, b.frameTimes), ksStatistic(a.ratios, b.ratios));
}

/** All pairwise divergences among a list of equal-length pieces. */
function worstPairMatrix(pieces: readonly RegimeSample[]): number[][] {
  const m = pieces.map(() => new Array<number>(pieces.length).fill(0));
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      const d = regimeDivergence(pieces[i], pieces[j]);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

/** The largest disagreement inside the run of `k` pieces starting at `from`. */
function worstPairIn(matrix: readonly (readonly number[])[], from: number, k: number): number {
  let worst = 0;
  for (let i = from; i < from + k; i += 1) for (let j = i + 1; j < from + k; j += 1) worst = Math.max(worst, matrix[i][j]);
  return worst;
}

// ---------------------------------------------------------------------------
// The tail search, and the ledger explaining every rejection
// ---------------------------------------------------------------------------

export interface TailWindowDiagnostic {
  index: number;
  startOffsetSec: number;
  endOffsetSec: number;
  medianFrameTimeMs: number;
  meanGpuRatio: number;
  /** Instability of the comparison-length span starting here; null when no full span fits. */
  spanInstability: number | null;
  /** Worst span instability from here to the end of the recording. */
  worstSpanInstabilityToEnd: number | null;
}

export interface TailCandidateDiagnostic {
  /** Index into the tail's window list; 0 is the start of the final block. */
  windowIndex: number;
  startOffsetSec: number;
  suffixDurationSec: number;
  suffixWindowCount: number;
  chunkCount: number;
  stationarity: {
    worstSpanInstability: number | null;
    strictBar: number | null;
    looseBar: number | null;
    passes: boolean;
  };
  distribution: {
    distinctnessFromGameplay: number | null;
    changeBar: number | null;
    cohesion: number | null;
    cohesionBar: number | null;
    passes: boolean;
  };
  /** Every reason this suffix was rejected. Empty exactly when it was accepted. */
  rejectedBecause: string[];
  /** Ranking margin: >= 1 would mean every binding constraint was met. */
  score: number;
}

export interface TailGameplaySceneDiagnostic {
  startOffsetSec: number;
  endOffsetSec: number;
  windowCount: number;
  chunkCount: number;
  minSpanInstability: number | null;
  medianSpanInstability: number | null;
  maxSpanInstability: number | null;
  maxAdjacentChunkDivergence: number | null;
  maxAnyPairChunkDivergence: number | null;
}

/**
 * Everything the tail search looked at and every reason it rejected what it
 * rejected. RESEARCH DIAGNOSTIC ONLY: nothing here is a boundary, and its
 * presence never changes the analysis — it is produced from the same numbers
 * the decision used, so it explains that decision rather than re-deriving it.
 */
export interface Rdr2TailDiagnostics {
  finalBlockIdle: boolean;
  finalBlockStartOffsetSec: number;
  finalBlockEndOffsetSec: number;
  finalBlockMeanGpuRatio: number;
  stabilityWindowFrames: number;
  comparisonSpanWindows: number;
  minSustainedBlockSec: number;
  bars: {
    gameplaySpanInstabilityFloor: number | null;
    strictStabilityBar: number | null;
    looseStabilityBar: number | null;
    strictStabilityFactor: number;
    distributionChangeBar: number | null;
    /** Gameplay's best self-agreement over a run of `chunks` comparison-length pieces. */
    distributionCohesionBarByChunkCount: Array<{ chunks: number; bar: number }>;
  };
  gameplayScenes: TailGameplaySceneDiagnostic[];
  windows: TailWindowDiagnostic[];
  /** Every possible suffix start, ranked by how close it came to qualifying. */
  candidates: TailCandidateDiagnostic[];
  accepted: {
    method: 'stationarity' | 'distribution';
    windowIndex: number;
    stableStartOffsetSec: number;
    likelyEndOffsetSec: number;
  } | null;
  notes: string[];
}

export interface ResultsScreenSuffix {
  /** Which route identified this regime. Both are equally binding; they ask different questions. */
  method: 'stationarity' | 'distribution';
  /** First frame of the regime that is confidently the results screen. */
  stableStartIndex: number;
  /** First frame from which the signal had already stopped looking like gameplay; <= stableStartIndex. */
  likelyEndIndex: number;
  windowCount: number;
  instability: number | null;
  strictBar: number | null;
  looseBar: number | null;
  distinctnessFromGameplay: number | null;
  changeBar: number | null;
  cohesion: number | null;
  cohesionBar: number | null;
}

export interface ResultsScreenSearch {
  suffix: ResultsScreenSuffix | null;
  diagnostics: Rdr2TailDiagnostics;
}

const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null);

/**
 * Finds the trailing stretch of `[startIndex, endIndex]` that is the results
 * screen, or reports that none is — and either way returns the full ledger of
 * what was considered.
 *
 * TWO INDEPENDENT ROUTES, TRIED IN ORDER
 * --------------------------------------
 * 1. STATIONARITY — the level stopped moving. Cheap, strict, and correct for
 *    a frozen results screen.
 * 2. DISTRIBUTION CHANGE — the regime became internally consistent and
 *    distinct from what preceded it, whether or not it is still. Correct for
 *    an animated results screen, which route 1 cannot see.
 *
 * Route 1 is tried first so that every capture it already resolved resolves
 * identically; route 2 only ever answers cases route 1 refused.
 *
 * SPANS ARE COMPARED AT EQUAL LENGTH
 * ----------------------------------
 * A slowly drifting signal always looks calmer when you look at less of it,
 * so measuring a short candidate suffix against a whole gameplay scene is not
 * a fair test — an early draft did exactly that and happily declared the tail
 * of an ordinary drifting scene to be a results screen. Both sides are
 * measured over spans of the SAME number of windows: the stationarity
 * reference is the calmest span gameplay ever manages at that length, and the
 * candidate is judged by its WORST span at that length, so a suffix that
 * settles late but drifts early cannot pass on its tail alone.
 *
 * TWO POINTS ARE RETURNED, BECAUSE THE HONEST ANSWER IS AN INTERVAL
 * -----------------------------------------------------------------
 * `stableStartIndex` is where the regime is confidently the results screen;
 * `likelyEndIndex` is the earlier point from which it had already stopped
 * looking like gameplay. The gap between them is genuine uncertainty and is
 * reported as such rather than resolved by picking a frame.
 */
export function locateResultsScreen(
  frames: readonly PresentMonFrame[],
  ratios: readonly number[],
  t0: number,
  startIndex: number,
  endIndex: number,
  gameplayWindowsPerScene: readonly (readonly StabilityWindow[])[],
  minSustainedSec: number,
  finalBlockInfo: { idle: boolean; startOffsetSec: number; endOffsetSec: number; meanGpuRatio: number },
): ResultsScreenSearch {
  const notes: string[] = [];
  const windows = stabilityWindows(frames, ratios, t0, startIndex, endIndex);
  const n = windows.length;

  const shortestScene = Math.min(...gameplayWindowsPerScene.map((w) => w.length));
  const spanW = Math.max(MIN_STABILITY_WINDOWS, Math.min(shortestScene, MAX_COMPARISON_WINDOWS));

  const baseDiagnostics = (): Rdr2TailDiagnostics => ({
    finalBlockIdle: finalBlockInfo.idle,
    finalBlockStartOffsetSec: finalBlockInfo.startOffsetSec,
    finalBlockEndOffsetSec: finalBlockInfo.endOffsetSec,
    finalBlockMeanGpuRatio: finalBlockInfo.meanGpuRatio,
    stabilityWindowFrames: STABILITY_WINDOW_FRAMES,
    comparisonSpanWindows: spanW,
    minSustainedBlockSec: minSustainedSec,
    bars: {
      gameplaySpanInstabilityFloor: null,
      strictStabilityBar: null,
      looseStabilityBar: null,
      strictStabilityFactor: STRICT_STABILITY_FACTOR,
      distributionChangeBar: null,
      distributionCohesionBarByChunkCount: [],
    },
    gameplayScenes: [],
    windows: [],
    candidates: [],
    accepted: null,
    notes,
  });

  if (n < spanW) {
    notes.push(
      `The final block holds ${n} window${n === 1 ? '' : 's'} of ${STABILITY_WINDOW_FRAMES} frames, fewer than the ${spanW}-window comparison span. ` +
        'There is not enough of it to compare against gameplay at equal length, so no suffix could be evaluated at all.',
    );
    return { suffix: null, diagnostics: baseDiagnostics() };
  }

  // --- what identified gameplay does, at the comparison length -------------
  /** End-anchored tiling into comparison-length chunks, so the same chunk set serves every candidate. */
  const chunksOf = (ws: readonly StabilityWindow[]): StabilityWindow[][] => {
    const out: StabilityWindow[][] = [];
    for (let end = ws.length; end - spanW >= 0; end -= spanW) out.unshift(ws.slice(end - spanW, end) as StabilityWindow[]);
    return out;
  };

  const gameplayScenes: TailGameplaySceneDiagnostic[] = [];
  /** Every equal-length stretch of identified gameplay, for the distinctness test below. */
  const gameplayChunkSamples: RegimeSample[] = [];
  let gameplayFloor = Number.POSITIVE_INFINITY;
  let changeBar = Number.NEGATIVE_INFINITY;
  /** Gameplay's best self-agreement over a run of exactly k chunks, indexed by k. */
  const cohesionBarByChunkCount: number[] = [];
  let maxGameplayChunks = 0;

  for (const scene of gameplayWindowsPerScene) {
    const spans: number[] = [];
    for (let i = 0; i + spanW <= scene.length; i += 1) spans.push(regimeInstability(scene.slice(i, i + spanW)));
    for (const s of spans) gameplayFloor = Math.min(gameplayFloor, s);

    const chunks = chunksOf(scene);
    let adjacentMax: number | null = null;
    let anyPairMax: number | null = null;
    const samples = chunks.map((c) => sampleWindows(frames, ratios, c));
    gameplayChunkSamples.push(...samples);
    if (chunks.length >= 2) {
      const pair = worstPairMatrix(samples);
      adjacentMax = 0;
      anyPairMax = 0;
      for (let i = 0; i < samples.length; i += 1) {
        for (let j = i + 1; j < samples.length; j += 1) {
          anyPairMax = Math.max(anyPairMax, pair[i][j]);
          if (j === i + 1) adjacentMax = Math.max(adjacentMax as number, pair[i][j]);
        }
      }
      changeBar = Math.max(changeBar, adjacentMax);
      maxGameplayChunks = Math.max(maxGameplayChunks, samples.length);
      // Gameplay's calmest run of k consecutive chunks, for every k it can supply.
      for (let k = 2; k <= samples.length; k += 1) {
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i + k <= samples.length; i += 1) best = Math.min(best, worstPairIn(pair, i, k));
        cohesionBarByChunkCount[k] = Math.min(cohesionBarByChunkCount[k] ?? Number.POSITIVE_INFINITY, best);
      }
    }

    const sortedSpans = [...spans].sort((a, b) => a - b);
    gameplayScenes.push({
      startOffsetSec: scene[0].startOffsetSec,
      endOffsetSec: scene[scene.length - 1].endOffsetSec,
      windowCount: scene.length,
      chunkCount: chunks.length,
      minSpanInstability: sortedSpans.length > 0 ? finiteOrNull(sortedSpans[0]) : null,
      medianSpanInstability: sortedSpans.length > 0 ? finiteOrNull(median(sortedSpans)) : null,
      maxSpanInstability: sortedSpans.length > 0 ? finiteOrNull(sortedSpans[sortedSpans.length - 1]) : null,
      maxAdjacentChunkDivergence: adjacentMax,
      maxAnyPairChunkDivergence: anyPairMax,
    });
  }

  const diagnostics = baseDiagnostics();
  diagnostics.gameplayScenes = gameplayScenes;

  const haveStabilityBar = Number.isFinite(gameplayFloor);
  const strictBar = haveStabilityBar ? gameplayFloor / STRICT_STABILITY_FACTOR : null;
  const looseBar = haveStabilityBar ? gameplayFloor : null;
  const haveDistributionBars = Number.isFinite(changeBar) && maxGameplayChunks >= 2;
  /** The cohesion bar to judge a suffix of `avail` chunks by, matched to the longest run gameplay can supply. */
  const cohesionBarFor = (avail: number): { k: number; bar: number } | null => {
    const k = Math.min(avail, maxGameplayChunks);
    if (k < 2) return null;
    const bar = cohesionBarByChunkCount[k];
    return bar !== undefined && Number.isFinite(bar) ? { k, bar } : null;
  };
  diagnostics.bars = {
    gameplaySpanInstabilityFloor: haveStabilityBar ? gameplayFloor : null,
    strictStabilityBar: strictBar,
    looseStabilityBar: looseBar,
    strictStabilityFactor: STRICT_STABILITY_FACTOR,
    distributionChangeBar: haveDistributionBars ? changeBar : null,
    distributionCohesionBarByChunkCount: haveDistributionBars
      ? cohesionBarByChunkCount.map((v, k) => (Number.isFinite(v) ? { chunks: k, bar: v } : null)).filter((v): v is { chunks: number; bar: number } => v !== null)
      : [],
  };

  if (!haveStabilityBar) {
    notes.push('No identified gameplay scene yielded a comparison-length span, so neither route has a reference to judge the tail against.');
    return { suffix: null, diagnostics };
  }
  if (!haveDistributionBars) {
    notes.push(
      `No identified gameplay scene holds two full ${spanW}-window chunks (${spanW * STABILITY_WINDOW_FRAMES * 2} frames), so there is no measurement of how much ordinary gameplay's distribution moves. ` +
        'The distribution-change route is unavailable for this capture and only the stationarity route was applied.',
    );
  }

  // --- stationarity route: worst equal-length span from each start onwards --
  const lastSpanStart = n - spanW;
  const spanInstability: number[] = [];
  for (let i = 0; i <= lastSpanStart; i += 1) spanInstability[i] = regimeInstability(windows.slice(i, i + spanW));
  const worstFrom: number[] = new Array(lastSpanStart + 1);
  worstFrom[lastSpanStart] = spanInstability[lastSpanStart];
  for (let i = lastSpanStart - 1; i >= 0; i -= 1) worstFrom[i] = Math.max(spanInstability[i], worstFrom[i + 1]);

  diagnostics.windows = windows.map((w, i) => ({
    index: i,
    startOffsetSec: w.startOffsetSec,
    endOffsetSec: w.endOffsetSec,
    medianFrameTimeMs: w.medianFrameTimeMs,
    meanGpuRatio: w.meanGpuRatio,
    spanInstability: i <= lastSpanStart ? finiteOrNull(spanInstability[i]) : null,
    worstSpanInstabilityToEnd: i <= lastSpanStart ? finiteOrNull(worstFrom[i]) : null,
  }));

  // --- distribution route: end-anchored chunks, precomputed once -----------
  const tailChunks = chunksOf(windows);
  const K = tailChunks.length;
  const tailSamples = tailChunks.map((c) => sampleWindows(frames, ratios, c));
  const pairDivergence: number[][] = tailSamples.map(() => new Array(K).fill(0));
  for (let i = 0; i < K; i += 1) {
    for (let j = i + 1; j < K; j += 1) {
      const d = regimeDivergence(tailSamples[i], tailSamples[j]);
      pairDivergence[i][j] = d;
      pairDivergence[j][i] = d;
    }
  }

  /** The last gameplay scene supplies the "before" side when a candidate starts at the very first tail window. */
  const priorWindows = gameplayWindowsPerScene[gameplayWindowsPerScene.length - 1];
  const timeline = [...priorWindows, ...windows];
  const timelineOffset = priorWindows.length;

  const chunkCountFrom = (w: number): number => Math.floor((n - w) / spanW);
  const firstChunkIndexFrom = (w: number): number => K - chunkCountFrom(w);

  /**
   * How unlike ALL of this run's gameplay the stretch starting at `w` is: the
   * SMALLEST distance between it and any equal-length gameplay stretch,
   * including the one immediately preceding it. Taking the minimum is what
   * makes this a claim about the whole benchmark rather than about one moment.
   */
  const distinctnessAt = (w: number): number | null => {
    const beforeEnd = timelineOffset + w;
    const beforeStart = beforeEnd - spanW;
    if (beforeStart < 0 || w + spanW > n) return null;
    const after = sampleWindows(frames, ratios, windows.slice(w, w + spanW));
    let nearest = regimeDivergence(sampleWindows(frames, ratios, timeline.slice(beforeStart, beforeEnd)), after);
    for (const g of gameplayChunkSamples) nearest = Math.min(nearest, regimeDivergence(g, after));
    return nearest;
  };

  /**
   * How well the suffix from `w` agrees with itself, judged over runs of the
   * same number of chunks gameplay's bar was measured over.
   *
   * The candidate is scored by its WORST such run, mirroring the stationarity
   * route: a suffix that holds together late but not early must not pass on
   * its tail alone. The suffix's leading span is included as a piece of its
   * own, because the end-anchored tiling would otherwise skip past it.
   */
  const cohesionFrom = (w: number): { value: number; bar: number; k: number } | null => {
    const avail = chunkCountFrom(w);
    if (avail < 2) return null;
    const matched = cohesionBarFor(avail);
    if (!matched) return null;
    const i0 = firstChunkIndexFrom(w);
    const pieces: RegimeSample[] = [];
    if (w + spanW <= n) pieces.push(sampleWindows(frames, ratios, windows.slice(w, w + spanW)));
    for (let i = i0; i < K; i += 1) pieces.push(tailSamples[i]);
    if (pieces.length < matched.k) return null;
    const pair = worstPairMatrix(pieces);
    let worst = 0;
    for (let i = 0; i + matched.k <= pieces.length; i += 1) worst = Math.max(worst, worstPairIn(pair, i, matched.k));
    return { value: worst, bar: matched.bar, k: matched.k };
  };

  const suffixDurationSec = (w: number): number =>
    frames[windows[n - 1].endIndex].timeInSeconds - frames[windows[w].startIndex].timeInSeconds;

  // --- evaluate every possible suffix start, recording why each failed -----
  const candidates: TailCandidateDiagnostic[] = [];
  const stationarityPass: boolean[] = new Array(lastSpanStart + 1).fill(false);
  const cohesionPass: boolean[] = new Array(lastSpanStart + 1).fill(false);
  const cohesionValue: (number | null)[] = new Array(lastSpanStart + 1).fill(null);

  for (let w = 0; w <= lastSpanStart; w += 1) {
    const duration = suffixDurationSec(w);
    const longEnough = duration >= minSustainedSec;
    const chunks = chunkCountFrom(w);
    const worst = worstFrom[w];
    const external = haveDistributionBars ? distinctnessAt(w) : null;
    const cohesionResult = haveDistributionBars ? cohesionFrom(w) : null;
    const cohesion = cohesionResult ? cohesionResult.value : null;
    const cohesionBarHere = cohesionResult ? cohesionResult.bar : null;
    cohesionValue[w] = cohesion;

    const rejected: string[] = [];
    if (!longEnough) {
      rejected.push(
        `suffix lasts ${duration.toFixed(2)}s, under the ${minSustainedSec.toFixed(2)}s sustained floor this capture's own median rendered frame implies`,
      );
    }

    const stationaryOk = longEnough && Number.isFinite(worst) && strictBar !== null && worst <= strictBar;
    stationarityPass[w] = stationaryOk;
    if (!stationaryOk && longEnough) {
      rejected.push(
        `stationarity: worst ${spanW}-window relative spread from here is ${Number.isFinite(worst) ? worst.toFixed(4) : 'undefined'}, above the bar of ${strictBar === null ? 'n/a' : strictBar.toFixed(4)} ` +
          `(${STRICT_STABILITY_FACTOR}x calmer than gameplay's calmest span, ${looseBar === null ? 'n/a' : looseBar.toFixed(4)})`,
      );
    }

    let distributionOk = false;
    if (haveDistributionBars) {
      const changeOk = external !== null && external > changeBar;
      const cohereOk = cohesion !== null && cohesionBarHere !== null && cohesion < cohesionBarHere;
      distributionOk = longEnough && changeOk && cohereOk;
      if (!distributionOk && longEnough) {
        if (chunks < 2) {
          rejected.push(
            `distribution: the suffix holds ${chunks} full ${spanW}-window chunk${chunks === 1 ? '' : 's'}; at least 2 are needed before "it is one regime throughout" is a claim the data can support`,
          );
        } else {
          if (!changeOk) {
            rejected.push(
              `distribution: its nearest resemblance to an equal-length stretch of this run's gameplay is ${external === null ? 'undefined' : external.toFixed(4)}, not above the ${changeBar.toFixed(4)} that gameplay itself reaches between neighbouring stretches — so it still looks like something the benchmark already did`,
            );
          }
          if (!cohereOk) {
            rejected.push(
              `distribution: the suffix disagrees with itself by ${cohesion === null ? 'undefined' : cohesion.toFixed(4)} over ${cohesionResult ? cohesionResult.k : '?'} chunks, not below the ${cohesionBarHere === null ? 'n/a' : cohesionBarHere.toFixed(4)} that the most self-consistent equal-length stretch of gameplay manages`,
            );
          }
        }
      }
    }
    cohesionPass[w] = haveDistributionBars && cohesion !== null && cohesionBarHere !== null && cohesion < cohesionBarHere;

    const durationMargin = minSustainedSec > 0 ? duration / minSustainedSec : Number.POSITIVE_INFINITY;
    const stationarityMargin = strictBar !== null && Number.isFinite(worst) && worst > 0 ? strictBar / worst : 0;
    const distributionMargin =
      haveDistributionBars && external !== null && cohesion !== null && cohesionBarHere !== null && changeBar > 0 && cohesion > 0
        ? Math.min(external / changeBar, cohesionBarHere / cohesion)
        : 0;
    const rawScore = Math.min(durationMargin, Math.max(stationarityMargin, distributionMargin));

    candidates.push({
      windowIndex: w,
      startOffsetSec: windows[w].startOffsetSec,
      suffixDurationSec: duration,
      suffixWindowCount: n - w,
      chunkCount: chunks,
      stationarity: {
        worstSpanInstability: finiteOrNull(worst),
        strictBar,
        looseBar,
        passes: stationaryOk,
      },
      distribution: {
        distinctnessFromGameplay: external,
        changeBar: haveDistributionBars ? changeBar : null,
        cohesion,
        cohesionBar: cohesionBarHere,
        passes: distributionOk,
      },
      rejectedBecause: stationaryOk || distributionOk ? [] : rejected,
      score: Number.isFinite(rawScore) ? rawScore : 0,
    });
  }

  // Smallest w means the LONGEST suffix, so the first w that qualifies is the
  // most that can honestly be claimed. Route 1 first, so every capture the
  // stationarity test already resolved resolves identically.
  let chosen = -1;
  let method: 'stationarity' | 'distribution' = 'stationarity';
  for (let w = 0; w <= lastSpanStart; w += 1) {
    if (stationarityPass[w]) { chosen = w; method = 'stationarity'; break; }
  }
  if (chosen < 0) {
    for (let w = 0; w <= lastSpanStart; w += 1) {
      if (candidates[w].distribution.passes) { chosen = w; method = 'distribution'; break; }
    }
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  diagnostics.candidates = ranked;

  if (chosen < 0) {
    notes.push(
      `All ${candidates.length} possible suffix start${candidates.length === 1 ? '' : 's'} were rejected. ` +
        'The highest-scoring one is listed first above, with the specific bar it failed.',
    );
    return { suffix: null, diagnostics };
  }

  // Walk back under the looser condition to find where the tail had already
  // stopped looking like gameplay. That earlier point is the other edge of the
  // boundary's genuine uncertainty.
  let looseW = chosen;
  if (method === 'stationarity' && looseBar !== null) {
    while (looseW > 0 && worstFrom[looseW - 1] <= looseBar) looseW -= 1;
  } else {
    while (looseW > 0 && cohesionPass[looseW - 1]) looseW -= 1;
  }

  const suffix: ResultsScreenSuffix = {
    method,
    stableStartIndex: windows[chosen].startIndex,
    likelyEndIndex: windows[looseW].startIndex,
    windowCount: n - chosen,
    instability: finiteOrNull(worstFrom[chosen]),
    strictBar,
    looseBar,
    distinctnessFromGameplay: candidates[chosen].distribution.distinctnessFromGameplay,
    changeBar: candidates[chosen].distribution.changeBar,
    cohesion: candidates[chosen].distribution.cohesion,
    cohesionBar: candidates[chosen].distribution.cohesionBar,
  };
  diagnostics.accepted = {
    method,
    windowIndex: chosen,
    stableStartOffsetSec: windows[chosen].startOffsetSec,
    likelyEndOffsetSec: windows[looseW].startOffsetSec,
  };
  return { suffix, diagnostics };
}
/** A maximal run of frames sharing an idle/busy classification. */
interface Block {
  idle: boolean;
  startIndex: number;
  endIndex: number;
  frameCount: number;
  startOffsetSec: number;
  endOffsetSec: number;
  durationSec: number;
  meanGpuRatio: number;
  medianFrameTimeMs: number;
  meanFps: number;
  /** True when this run cleared the sustained gate — i.e. is long enough to be structure rather than noise. */
  sustained: boolean;
}

export type BoundaryKind = 'gameplay-start' | 'transition' | 'results-start';
export type Confidence = 'high' | 'medium' | 'low';

export interface Rdr2AnalysisBoundary {
  kind: BoundaryKind;
  /** 1-based ordinal among transitions; absent for the single gameplay-start and results-start boundaries. */
  ordinal?: number;
  /** Offsets are relative to the capture's own first frame, in seconds. */
  startOffsetSec: number;
  endOffsetSec: number;
  durationSec: number;
  frameCount: number;
  meanGpuRatio: number;
  medianFrameTimeMs: number;
  /** Frames per second across this block. Descriptive of the block, never a benchmark figure. */
  meanFps: number;
  confidence: Confidence;
  evidence: string[];
}

/**
 * Per-scene figures. Namespaced under `research` and never promoted: gameplay
 * inside a research capture is uncontrolled, so these describe what this one
 * recording happened to contain, not what the hardware scores.
 */
export interface Rdr2CandidateSceneResearchStats {
  meanFps: number;
  medianFrameTimeMs: number;
  minFrameTimeMs: number;
  maxFrameTimeMs: number;
  meanGpuRatio: number;
}

export interface Rdr2CandidateScene {
  ordinal: number;
  startOffsetSec: number;
  endOffsetSec: number;
  durationSec: number;
  frameCount: number;
  /** RESEARCH VALUES ONLY — not verified, not publishable, not comparable to RDR2's own results screen. */
  research: Rdr2CandidateSceneResearchStats;
}

export interface Rdr2AnalysisDiagnostics {
  totalFrames: number;
  captureDurationSec: number;
  utilizationThreshold: number;
  renderedFrameMedianMs: number;
  minSustainedBlockSec: number;
  /** Every sustained block found, in capture order — the raw structure before interpretation. */
  sustainedBlocks: Array<{ idle: boolean; startOffsetSec: number; endOffsetSec: number; durationSec: number; frameCount: number; meanGpuRatio: number }>;
  ratioHistogram: number[];
}

export interface Rdr2AnalysisSource {
  bundleDir: string;
  csvFileName: string;
  csvSha256: string;
  csvByteLength: number;
  processId: number;
  processName: string;
  /** The capture's own wall-clock window, copied from the manifest. Used only to align an independent operator marker; never read by the segmentation. */
  captureStartedAt?: string;
  captureEndedAt?: string;
  gameVersion?: string;
  gameBuildId?: string;
  collectorBuildHash: string;
}

/**
 * Caller-selected extras. RESEARCH DIAGNOSTICS ONLY: nothing here changes a
 * boundary, a bar, or a verdict — `diagnoseTail` attaches the ledger the tail
 * search already built while deciding, so a refusal can be read rather than
 * guessed at. An analysis run with and without it returns the same answer.
 */
export interface Rdr2AnalysisOptions {
  diagnoseTail?: boolean;
}

export interface Rdr2AnalysisCandidate {
  schemaVersion: typeof RDR2_ANALYSIS_SCHEMA_VERSION;
  status: 'candidate';
  /** Always false. A research analysis is never a publishable measurement. */
  publishable: false;
  source: Rdr2AnalysisSource;
  gameplayStartOffsetSec: number;
  /**
   * Where the fifth scene most likely stopped: the point from which the
   * signal had already stopped drifting like gameplay. The EARLY edge of the
   * final boundary's uncertainty.
   */
  scene5LikelyEndOffsetSec: number;
  /**
   * Where the results screen is confidently stationary. The LATE edge of the
   * same uncertainty, and the conservative choice of the two.
   */
  resultsScreenStableStartOffsetSec: number;
  /**
   * The width of that interval. Zero when drift stops and stationarity begins
   * at the same point; positive when the data genuinely cannot place the
   * boundary on one frame, which is reported rather than resolved by picking.
   */
  finalBoundaryUncertaintySec: number;
  /** Alias of resultsScreenStableStartOffsetSec — the conservative edge, kept for readers of the earlier shape. */
  resultsStartOffsetSec: number;
  boundaries: Rdr2AnalysisBoundary[];
  scenes: Rdr2CandidateScene[];
  diagnostics: Rdr2AnalysisDiagnostics;
  /** Present only when the caller asked for it. Explanatory, never load-bearing. */
  tailDiagnostics?: Rdr2TailDiagnostics;
}

export interface Rdr2AnalysisUnresolved {
  schemaVersion: typeof RDR2_ANALYSIS_SCHEMA_VERSION;
  status: 'unresolved';
  publishable: false;
  /** Which kind of check stopped this: bundle integrity, or the structure of the recording. */
  failure: 'integrity' | 'structure';
  reasons: string[];
  /** Present when the bundle read far enough to produce them; absent on integrity failure. */
  diagnostics?: Rdr2AnalysisDiagnostics;
  /** Present only when the caller asked for it AND the analysis reached the tail search. */
  tailDiagnostics?: Rdr2TailDiagnostics;
  source?: Partial<Rdr2AnalysisSource>;
}

export type Rdr2AnalysisResult = Rdr2AnalysisCandidate | Rdr2AnalysisUnresolved;

const unresolved = (failure: 'integrity' | 'structure', reasons: string[], extra: Partial<Rdr2AnalysisUnresolved> = {}): Rdr2AnalysisUnresolved => ({
  schemaVersion: RDR2_ANALYSIS_SCHEMA_VERSION,
  status: 'unresolved',
  publishable: false,
  failure,
  reasons,
  ...extra,
});

const median = (sorted: readonly number[]): number => sorted[Math.floor(sorted.length / 2)];

/**
 * Reads and integrity-checks the bundle, then analyses it.
 *
 * NEVER throws for a bad bundle or an unreadable structure — those are
 * answers, returned as `status: "unresolved"` with reasons, because a thrown
 * error invites a caller to catch and continue with a guess. It also never
 * opens anything for writing.
 */
export function analyzeRdr2ResearchBundle(bundleDir: string, options: Rdr2AnalysisOptions = {}): Rdr2AnalysisResult {
  // --- integrity -----------------------------------------------------------
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return unresolved('integrity', [`No manifest.json in "${bundleDir}" — this is not an RDR2 research bundle.`]);
  }

  let manifest: Rdr2ResearchManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Rdr2ResearchManifest;
  } catch (error) {
    return unresolved('integrity', [`manifest.json could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }

  const integrity: string[] = [];
  if (manifest.schemaVersion !== 1) integrity.push(`manifest.schemaVersion is ${JSON.stringify(manifest.schemaVersion)}; this analyzer reads version 1.`);
  if (manifest.gameId !== 'rdr2') integrity.push(`manifest.gameId is ${JSON.stringify(manifest.gameId)}; this analyzer is RDR2-only.`);
  if (!manifest.csv || manifest.csv.fileName !== 'presentmon.csv') {
    integrity.push(`manifest.csv.fileName is ${JSON.stringify(manifest.csv?.fileName)}; expected "presentmon.csv".`);
  }
  if (!manifest.capture || !Number.isInteger(manifest.capture.processId) || manifest.capture.processId <= 0) {
    integrity.push(`manifest.capture.processId is ${JSON.stringify(manifest.capture?.processId)}; a research bundle must name the exact process it captured.`);
  }
  if (!manifest.gameVersion && !manifest.gameBuildId) {
    integrity.push('manifest has neither gameVersion nor gameBuildId — nothing ties these frames to a specific game build.');
  }
  if (integrity.length > 0) return unresolved('integrity', integrity);

  const csvPath = path.join(bundleDir, manifest.csv.fileName);
  if (!fs.existsSync(csvPath)) {
    return unresolved('integrity', [`Bundle names "${manifest.csv.fileName}" but no such file exists in "${bundleDir}".`]);
  }

  const csvBytes = fs.readFileSync(csvPath);
  if (csvBytes.byteLength !== manifest.csv.byteLength) {
    return unresolved('integrity', [
      `${manifest.csv.fileName} is ${csvBytes.byteLength} bytes but the manifest records ${manifest.csv.byteLength}. The bundle has been modified since it was published.`,
    ]);
  }
  const actualSha = sha256(csvBytes);
  if (actualSha !== manifest.csv.sha256) {
    return unresolved('integrity', [
      `${manifest.csv.fileName} hashes to ${actualSha} but the manifest records ${manifest.csv.sha256}. The bundle has been modified since it was published.`,
    ]);
  }

  const source: Rdr2AnalysisSource = {
    bundleDir,
    csvFileName: manifest.csv.fileName,
    csvSha256: actualSha,
    csvByteLength: csvBytes.byteLength,
    processId: manifest.capture.processId,
    processName: manifest.capture.processName,
    captureStartedAt: manifest.capture.startedAt,
    captureEndedAt: manifest.capture.endedAt,
    gameVersion: manifest.gameVersion,
    gameBuildId: manifest.gameBuildId,
    collectorBuildHash: manifest.collectorBuildHash,
  };

  // Filtered to the EXACT pid the manifest names, never the process name: two
  // processes can share a name, and attributing another one's frames to this
  // run would be exactly the misattribution presentmonRunner refuses at
  // capture time.
  let parsed;
  try {
    parsed = parsePresentMonCsv(csvBytes.toString('utf-8'), String(manifest.capture.processId));
  } catch (error) {
    if (error instanceof PresentMonFormatError) return unresolved('integrity', [`Capture could not be parsed for pid ${manifest.capture.processId}: ${error.message}`], { source });
    throw error;
  }

  const frames = parsed.frames;
  const columnProblems: string[] = [];
  if (frames.some((f) => !Number.isFinite(f.msGpuActive))) {
    columnProblems.push('Capture has no msGPUActive column. Without evidence of GPU work there is no way to separate a black transition screen from gameplay except by frame rate, which would be fitting the segmentation to its own result.');
  }
  if (frames.some((f) => !Number.isFinite(f.timeInSeconds))) {
    columnProblems.push('Capture has no TimeInSeconds column, so no boundary can be reported as a real offset into the run.');
  }
  if (columnProblems.length > 0) return unresolved('integrity', columnProblems, { source });

  return analyzeFrames(frames, source, options);
}

/**
 * The structural analysis proper, separated from all filesystem access so it
 * can be driven directly by synthetic frames in tests.
 */
export function analyzeFrames(
  frames: readonly PresentMonFrame[],
  source: Rdr2AnalysisSource,
  options: Rdr2AnalysisOptions = {},
): Rdr2AnalysisResult {
  const t0 = frames.length > 0 ? frames[0].timeInSeconds : 0;
  const captureDurationSec = frames.length > 0 ? frames[frames.length - 1].timeInSeconds - t0 : 0;

  if (frames.length < MIN_ANALYSIS_FRAMES || captureDurationSec < MIN_ANALYSIS_DURATION_SEC) {
    return unresolved('structure', [
      `Capture holds ${frames.length} frames over ${captureDurationSec.toFixed(1)}s; below ${MIN_ANALYSIS_FRAMES} frames or ${MIN_ANALYSIS_DURATION_SEC}s there is not enough recording to reason about benchmark structure at all.`,
    ], { source });
  }

  // The cut is derived from THIS capture's own distribution — see the module
  // header, and findUtilizationThreshold's own comment in ./segmentation.ts.
  const ratios = frames.map((f) => f.msGpuActive / f.frameTimeMs);
  const distribution: RatioDistribution | null = findUtilizationThreshold(ratios);
  if (!distribution) {
    const med = median([...ratios].sort((a, b) => a - b));
    return unresolved('structure', [
      `This capture's GPU-utilisation distribution is not clearly bimodal (median ${(med * 100).toFixed(1)}%), so there is no data-derived cut between "rendering gameplay" and "presenting a transition". ` +
        'Placing one anyway would be inventing the boundary this analysis exists to find.',
    ], { source });
  }

  const idle = ratios.map((r) => r < distribution.threshold);
  const busyFrameTimes = frames.filter((_, i) => !idle[i]).map((f) => f.frameTimeMs).sort((a, b) => a - b);
  if (busyFrameTimes.length === 0) {
    return unresolved('structure', ['No frame in this capture shows the GPU rendering; there is no gameplay to segment.'], { source });
  }
  const renderedFrameMedianMs = median(busyFrameTimes);
  // Scale-invariant, exactly as ./segmentation.ts states it: a machine twice
  // as fast has frames and transitions both twice as short and must segment
  // identically, so the gate carries no absolute time.
  const minSustainedSec = (renderedFrameMedianMs * MIN_TRANSITION_FRAME_MULTIPLE) / 1000;

  const buildBlocks = (classification: readonly boolean[]): Block[] => {
    const out: Block[] = [];
    let start = 0;
    for (let i = 1; i <= frames.length; i += 1) {
      if (i === frames.length || classification[i] !== classification[start]) {
        const end = i - 1;
        const slice = frames.slice(start, i);
        const sliceRatios = ratios.slice(start, i);
        let ms = 0;
        for (const f of slice) ms += f.frameTimeMs;
        const durationSec = ms / 1000;
        out.push({
          idle: classification[start],
          startIndex: start,
          endIndex: end,
          frameCount: slice.length,
          startOffsetSec: frames[start].timeInSeconds - t0,
          endOffsetSec: frames[end].timeInSeconds - t0,
          durationSec,
          meanGpuRatio: sliceRatios.reduce((a, b) => a + b, 0) / sliceRatios.length,
          medianFrameTimeMs: median([...slice.map((f) => f.frameTimeMs)].sort((a, b) => a - b)),
          meanFps: durationSec > 0 ? slice.length / durationSec : Number.NaN,
          sustained: durationSec >= minSustainedSec,
        });
        start = i;
      }
    }
    return out;
  };

  // A run too short to be structure is NOISE, and noise belongs to the region
  // it interrupts — not to a boundary of its own. ./segmentation.ts already
  // takes this position frame-by-frame ("isolated idle frames are kept: they
  // are scheduling noise"); the structural reading needs it at block level
  // too, because a 50ms GPU hiccup inside a scene would otherwise split that
  // one scene into two and make a perfectly good five-scene run read as six.
  //
  // So each non-sustained block adopts the classification of the nearest
  // SUSTAINED block — preferring the one before it, since a blip is part of
  // whatever was already running — and the blocks are rebuilt from the
  // despeckled classification. Every surviving block is sustained by
  // construction: sustained blocks only ever absorb frames, never lose them.
  const rawBlocks = buildBlocks(idle);
  if (!rawBlocks.some((b) => b.sustained)) {
    return unresolved('structure', [
      `No block in this capture lasts the ${minSustainedSec.toFixed(2)}s needed to count as structure rather than noise. ` +
        'The recording alternates between rendering and idling too rapidly to contain benchmark scenes.',
    ], { source });
  }

  const despeckled = idle.slice();
  for (let i = 0; i < rawBlocks.length; i += 1) {
    const b = rawBlocks[i];
    if (b.sustained) continue;
    let adopt: boolean | undefined;
    for (let j = i - 1; j >= 0; j -= 1) if (rawBlocks[j].sustained) { adopt = rawBlocks[j].idle; break; }
    if (adopt === undefined) {
      for (let j = i + 1; j < rawBlocks.length; j += 1) if (rawBlocks[j].sustained) { adopt = rawBlocks[j].idle; break; }
    }
    // Guaranteed defined: the guard above proved at least one sustained block exists.
    for (let k = b.startIndex; k <= b.endIndex; k += 1) despeckled[k] = adopt as boolean;
  }

  const blocks = buildBlocks(despeckled);
  const sustained = blocks.filter((b) => b.sustained);

  /** A sub-range of an existing block, recomputed so its statistics describe only the part kept. */
  const clipBlock = (b: Block, from: number, to: number): Block => {
    const slice = frames.slice(from, to + 1);
    const sliceRatios = ratios.slice(from, to + 1);
    let ms = 0;
    for (const f of slice) ms += f.frameTimeMs;
    const durationSec = ms / 1000;
    return {
      idle: b.idle,
      startIndex: from,
      endIndex: to,
      frameCount: slice.length,
      startOffsetSec: frames[from].timeInSeconds - t0,
      endOffsetSec: frames[to].timeInSeconds - t0,
      durationSec,
      meanGpuRatio: sliceRatios.reduce((a, c) => a + c, 0) / sliceRatios.length,
      medianFrameTimeMs: median([...slice.map((f) => f.frameTimeMs)].sort((a, c) => a - c)),
      meanFps: durationSec > 0 ? slice.length / durationSec : Number.NaN,
      sustained: durationSec >= minSustainedSec,
    };
  };
  const diagnostics: Rdr2AnalysisDiagnostics = {
    totalFrames: frames.length,
    captureDurationSec,
    utilizationThreshold: distribution.threshold,
    renderedFrameMedianMs,
    minSustainedBlockSec: minSustainedSec,
    sustainedBlocks: sustained.map((b) => ({
      idle: b.idle,
      startOffsetSec: b.startOffsetSec,
      endOffsetSec: b.endOffsetSec,
      durationSec: b.durationSec,
      frameCount: b.frameCount,
      meanGpuRatio: b.meanGpuRatio,
    })),
    ratioHistogram: distribution.histogram,
  };

  const fail = (reasons: string[], tail?: Rdr2TailDiagnostics) => unresolved('structure', reasons, { source, diagnostics, tailDiagnostics: tail });

  // --- structural interpretation -------------------------------------------
  // The benchmark's shape: [menu/loading] scene1 T1 scene2 T2 scene3 T3
  // scene4 T4 scene5 [maybe a transition] results-screen.
  //
  // The results screen is located FIRST, because where it starts decides what
  // counts as the benchmark proper. It cannot be found by GPU load — a real
  // run showed RDR2's results screen is GPU-busy — so it is found by
  // locateResultsScreen's two routes: stationarity for a frozen screen, and
  // distribution change for an animated one. Only then are the transitions
  // counted, over the region that precedes it, and exactly four of those is
  // not a threshold to tune — it is what "five scenes" means.
  const firstBusy = sustained.findIndex((b) => !b.idle);
  if (firstBusy < 0) return fail(['No sustained GPU-busy block found; nothing in this capture looks like benchmark gameplay.']);

  const finalBlock = sustained[sustained.length - 1];

  // What dynamic gameplay looks like IN THIS RUN. Every sustained GPU-busy
  // block except the last one is gameplay by construction — the last is the
  // one whose nature is still in question — so they supply the bar without
  // any circularity, and the CALMEST of them is used, so the results screen
  // must out-stabilise even the least eventful scene.
  const gameplayBlocksForReference = sustained.slice(firstBusy, sustained.length - 1).filter((b) => !b.idle);
  if (gameplayBlocksForReference.length === 0) {
    return fail([
      'Only one sustained GPU-busy block exists in this capture, so there is no independently-identified gameplay to measure "dynamic" against. ' +
        'Without that reference, calling any part of it a results screen would be asserting a boundary the data does not support.',
    ]);
  }
  const gameplayWindowsPerScene = gameplayBlocksForReference
    .map((b) => stabilityWindows(frames, ratios, t0, b.startIndex, b.endIndex))
    .filter((w) => w.length >= MIN_STABILITY_WINDOWS);
  if (gameplayWindowsPerScene.length === 0) {
    return fail([
      `No identified gameplay scene holds enough frames for a stability measurement (each needs at least ${MIN_STABILITY_WINDOWS * STABILITY_WINDOW_FRAMES} frames). ` +
        'Without a reference for what dynamic gameplay looks like in this run, the end of the fifth scene cannot be located.',
    ]);
  }

  const search = locateResultsScreen(
    frames, ratios, t0, finalBlock.startIndex, finalBlock.endIndex, gameplayWindowsPerScene, minSustainedSec,
    { idle: finalBlock.idle, startOffsetSec: finalBlock.startOffsetSec, endOffsetSec: finalBlock.endOffsetSec, meanGpuRatio: finalBlock.meanGpuRatio },
  );
  const tailDiagnostics = options.diagnoseTail ? search.diagnostics : undefined;
  const stable = search.suffix;
  if (!stable) {
    // The closest any suffix came, quoted verbatim from the same ledger the
    // decision used — so the refusal names the specific bar that stopped it
    // instead of asserting an unexplained "no".
    const best = search.diagnostics.candidates[0];
    return fail([
      `The capture's final sustained block (${finalBlock.startOffsetSec.toFixed(1)}-${finalBlock.endOffsetSec.toFixed(1)}s, GPU ${(finalBlock.meanGpuRatio * 100).toFixed(1)}%) never settles into a stationary regime, ` +
        'and never becomes a distributionally distinct, internally consistent one either. ' +
        'Its frame-time and GPU-load levels keep drifting the way the gameplay scenes before it do, measured over spans of equal length so the comparison is fair. ' +
        `A results screen must either be at least ${STRICT_STABILITY_FACTOR}x more stationary than the calmest span gameplay reaches in this same run, or differ from what precedes it by more than gameplay differs from itself while agreeing with itself better than any gameplay scene does — either way sustained for at least ${minSustainedSec.toFixed(2)}s. ` +
        'This recording therefore has no convincing results-screen boundary: either it stopped before the benchmark finished, or the end is not distinguishable from gameplay in this data.',
      best
        ? `Closest candidate: a suffix starting at ${best.startOffsetSec.toFixed(2)}s (${best.suffixDurationSec.toFixed(2)}s long). Rejected because ${best.rejectedBecause.join('; ')}.`
        : 'No suffix of the final block was long enough to evaluate at all.',
      ...search.diagnostics.notes,
      'Re-run with --diagnose-tail for the window-by-window measurements, the span-matched gameplay reference, both bars, and every rejected change-point candidate ranked.',
    ], tailDiagnostics);
  }

  // Everything strictly before the stationary regime is the benchmark proper.
  // When the results screen begins PART-WAY THROUGH the final block — the real
  // case, where scene 5 runs straight into a GPU-busy results screen with no
  // transition between them — that block's prefix is scene 5 and is spliced in
  // as its own gameplay block.
  const benchmarkBlocks: Block[] = sustained.slice(firstBusy, sustained.length - 1);
  if (!finalBlock.idle && stable.likelyEndIndex > finalBlock.startIndex) {
    benchmarkBlocks.push(clipBlock(finalBlock, finalBlock.startIndex, stable.likelyEndIndex - 1));
  }
  // A transition immediately before the results screen belongs to the
  // uncertainty between them, not to the scene count.
  if (benchmarkBlocks.length > 0 && benchmarkBlocks[benchmarkBlocks.length - 1].idle) benchmarkBlocks.pop();

  const gameplayBlocks = benchmarkBlocks;
  const scenesFound = gameplayBlocks.filter((b) => !b.idle);
  const transitionsFound = gameplayBlocks.filter((b) => b.idle);

  const problems: string[] = [];
  if (transitionsFound.length !== RDR2_EXPECTED_TRANSITIONS) {
    problems.push(
      `Found ${transitionsFound.length} credible inter-scene transition${transitionsFound.length === 1 ? '' : 's'}, expected exactly ${RDR2_EXPECTED_TRANSITIONS}` +
        ` (at ${transitionsFound.map((b) => `${b.startOffsetSec.toFixed(1)}-${b.endOffsetSec.toFixed(1)}s`).join(', ') || 'none'}).` +
        ' Either this is not a complete five-scene benchmark run, or a transition is invisible to this signal; both are reasons to stop rather than to pick the best-looking four.',
    );
  }
  if (scenesFound.length !== RDR2_EXPECTED_SCENES) {
    problems.push(
      `Found ${scenesFound.length} candidate gameplay scene${scenesFound.length === 1 ? '' : 's'}, expected exactly ${RDR2_EXPECTED_SCENES}.`,
    );
  }
  // Ordering must alternate scene, transition, scene, ... — anything else means
  // the blocks do not describe a run of scenes separated by transitions.
  for (let i = 0; i < gameplayBlocks.length; i += 1) {
    const expectIdle = i % 2 === 1;
    if (gameplayBlocks[i].idle !== expectIdle) {
      problems.push(
        `Block ${i + 1} of the gameplay region starting at ${gameplayBlocks[i].startOffsetSec.toFixed(1)}s is ${gameplayBlocks[i].idle ? 'a transition' : 'gameplay'} where the alternating scene/transition structure requires ${expectIdle ? 'a transition' : 'gameplay'}. ` +
          'The recording does not have the shape of scenes separated by transitions.',
      );
      break;
    }
  }
  if (problems.length > 0) return fail(problems);

  const resultsBlock = clipBlock(finalBlock, stable.stableStartIndex, finalBlock.endIndex);
  const gameplayStart = scenesFound[0];
  const scene5LikelyEndOffsetSec = frames[stable.likelyEndIndex].timeInSeconds - t0;
  const resultsScreenStableStartOffsetSec = resultsBlock.startOffsetSec;

  const boundaryEvidence = (b: Block, extra: string[] = []): string[] => [
    `Mean GPU utilisation ${(b.meanGpuRatio * 100).toFixed(1)}% against this capture's own derived cut of ${(distribution.threshold * 100).toFixed(1)}%.`,
    `Lasted ${b.durationSec.toFixed(2)}s (${(b.durationSec / minSustainedSec).toFixed(1)}x the sustained-block floor of ${minSustainedSec.toFixed(2)}s derived from this capture's ${renderedFrameMedianMs.toFixed(2)}ms median rendered frame).`,
    `${b.frameCount} frames, median interval ${b.medianFrameTimeMs.toFixed(2)}ms (${b.meanFps.toFixed(1)} fps across the block).`,
    ...extra,
  ];

  // Confidence reflects how far a block sits from the two things that could
  // make it a false positive: a marginal utilisation ratio, or a duration
  // barely over the sustained floor.
  const confidenceFor = (b: Block): Confidence => {
    const ratioMargin = b.idle ? distribution.threshold - b.meanGpuRatio : b.meanGpuRatio - distribution.threshold;
    const durationMargin = b.durationSec / minSustainedSec;
    if (ratioMargin >= 0.25 && durationMargin >= 2) return 'high';
    if (ratioMargin >= 0.1 && durationMargin >= 1.25) return 'medium';
    return 'low';
  };

  const boundaries: Rdr2AnalysisBoundary[] = [];
  boundaries.push({
    kind: 'gameplay-start',
    startOffsetSec: gameplayStart.startOffsetSec,
    endOffsetSec: gameplayStart.startOffsetSec,
    durationSec: 0,
    frameCount: gameplayStart.frameCount,
    meanGpuRatio: gameplayStart.meanGpuRatio,
    medianFrameTimeMs: gameplayStart.medianFrameTimeMs,
    meanFps: gameplayStart.meanFps,
    confidence: confidenceFor(gameplayStart),
    evidence: boundaryEvidence(gameplayStart, ['First sustained GPU-busy block in the capture: everything before it is menu or loading, presented without the GPU doing render work.']),
  });
  transitionsFound.forEach((b, i) => {
    boundaries.push({
      kind: 'transition',
      ordinal: i + 1,
      startOffsetSec: b.startOffsetSec,
      endOffsetSec: b.endOffsetSec,
      durationSec: b.durationSec,
      frameCount: b.frameCount,
      meanGpuRatio: b.meanGpuRatio,
      medianFrameTimeMs: b.medianFrameTimeMs,
      meanFps: b.meanFps,
      confidence: confidenceFor(b),
      evidence: boundaryEvidence(b, [`Sits between candidate scene ${i + 1} and candidate scene ${i + 2}.`]),
    });
  });
  boundaries.push({
    kind: 'results-start',
    startOffsetSec: resultsBlock.startOffsetSec,
    endOffsetSec: resultsBlock.endOffsetSec,
    durationSec: resultsBlock.durationSec,
    frameCount: resultsBlock.frameCount,
    meanGpuRatio: resultsBlock.meanGpuRatio,
    medianFrameTimeMs: resultsBlock.medianFrameTimeMs,
    meanFps: resultsBlock.meanFps,
    confidence: stable.likelyEndIndex === stable.stableStartIndex ? confidenceFor(resultsBlock) : 'medium',
    evidence: boundaryEvidence(resultsBlock, [
      stable.method === 'stationarity'
        ? `Stationary to the end of the recording: relative spread ${(stable.instability ?? Number.NaN).toFixed(4)} across ${stable.windowCount} windows of ${STABILITY_WINDOW_FRAMES} frames, against a bar of ${(stable.strictBar ?? Number.NaN).toFixed(4)} — ${STRICT_STABILITY_FACTOR}x more stable than the calmest span gameplay reaches in this same run (${(stable.looseBar ?? Number.NaN).toFixed(4)}).`
        : `Distributionally distinct to the end of the recording: it is unlike every equal-length stretch of this run's gameplay, its nearest resemblance being ${(stable.distinctnessFromGameplay ?? Number.NaN).toFixed(4)} against the ${(stable.changeBar ?? Number.NaN).toFixed(4)} gameplay reaches between its own neighbouring stretches, while agreeing with itself to within ${(stable.cohesion ?? Number.NaN).toFixed(4)} — tighter than the ${(stable.cohesionBar ?? Number.NaN).toFixed(4)} of the most self-consistent gameplay scene in this run. It is NOT required to be still, so an animated results screen is visible to this test.`,
      'Located by stationarity or distribution change, NOT by GPU load: a real RDR2 run showed the results screen is GPU-busy, so "the GPU stopped working" would have been the wrong signal here.',
      stable.likelyEndIndex === stable.stableStartIndex
        ? 'Gameplay stops drifting and the screen becomes stationary at the same point, so this boundary carries no interval of uncertainty.'
        : `Drift stops at ${scene5LikelyEndOffsetSec.toFixed(2)}s but the regime is only confidently stationary from ${resultsScreenStableStartOffsetSec.toFixed(2)}s; the ${(resultsScreenStableStartOffsetSec - scene5LikelyEndOffsetSec).toFixed(2)}s between them is genuine uncertainty, not a boundary this analysis can place on one frame.`,
    ]),
  });

  const scenes: Rdr2CandidateScene[] = scenesFound.map((b, i) => {
    const slice = frames.slice(b.startIndex, b.endIndex + 1);
    const times = slice.map((f) => f.frameTimeMs).sort((a, b2) => a - b2);
    return {
      ordinal: i + 1,
      startOffsetSec: b.startOffsetSec,
      endOffsetSec: b.endOffsetSec,
      durationSec: b.durationSec,
      frameCount: b.frameCount,
      research: {
        meanFps: b.meanFps,
        medianFrameTimeMs: median(times),
        minFrameTimeMs: times[0],
        maxFrameTimeMs: times[times.length - 1],
        meanGpuRatio: b.meanGpuRatio,
      },
    };
  });

  return {
    schemaVersion: RDR2_ANALYSIS_SCHEMA_VERSION,
    status: 'candidate',
    publishable: false,
    source,
    gameplayStartOffsetSec: gameplayStart.startOffsetSec,
    scene5LikelyEndOffsetSec,
    resultsScreenStableStartOffsetSec,
    finalBoundaryUncertaintySec: resultsScreenStableStartOffsetSec - scene5LikelyEndOffsetSec,
    resultsStartOffsetSec: resultsScreenStableStartOffsetSec,
    boundaries,
    scenes,
    diagnostics,
    ...(tailDiagnostics ? { tailDiagnostics } : {}),
  };
}

// ---------------------------------------------------------------------------
// Comparison across runs
// ---------------------------------------------------------------------------
//
// The real question is REPRODUCIBILITY, and absolute offsets cannot answer it:
// two runs of the same benchmark start gameplay at different wall-clock times
// depending on how long the operator took to trigger it. What must reproduce
// is the SHAPE — how far each boundary sits from gameplay start, and how long
// each scene runs. So every offset here is normalised to gameplay start
// before anything is compared.

export interface Rdr2ComparisonBoundaryStat {
  kind: BoundaryKind;
  ordinal?: number;
  /** Offsets relative to each run's own gameplay start. */
  relativeOffsetsSec: number[];
  meanSec: number;
  spreadSec: number;
}

export interface Rdr2ComparisonSceneStat {
  ordinal: number;
  durationsSec: number[];
  meanSec: number;
  spreadSec: number;
}

export interface Rdr2ComparisonReport {
  schemaVersion: typeof RDR2_ANALYSIS_SCHEMA_VERSION;
  status: 'compared';
  publishable: false;
  runCount: number;
  sources: Array<{ bundleDir: string; csvSha256: string; gameVersion?: string; gameBuildId?: string }>;
  boundaries: Rdr2ComparisonBoundaryStat[];
  scenes: Rdr2ComparisonSceneStat[];
  /** True only when every boundary and scene duration agrees within the tolerance below. */
  reproduces: boolean;
  toleranceSec: number;
  notes: string[];
}

export interface Rdr2ComparisonRefused {
  schemaVersion: typeof RDR2_ANALYSIS_SCHEMA_VERSION;
  status: 'refused';
  publishable: false;
  reasons: string[];
}

export type Rdr2ComparisonResult = Rdr2ComparisonReport | Rdr2ComparisonRefused;

/**
 * How far two runs' corresponding boundaries may sit apart and still be called
 * the same structure.
 *
 * This is a REPORTING tolerance, not a detection threshold: it never moves a
 * boundary, it only decides whether `reproduces` is claimed. Set wide enough
 * that ordinary run-to-run variation in a real benchmark does not read as a
 * failure, and narrow enough that a genuinely different structure does.
 */
export const REPRODUCIBILITY_TOLERANCE_SEC = 5;

/**
 * Compares two or more analyses.
 *
 * REFUSES rather than averaging when any input is unresolved or the runs are
 * not structurally comparable. Averaging an unresolved run into a resolved one
 * would launder a refusal into a number.
 */
export function compareRdr2Analyses(analyses: readonly Rdr2AnalysisResult[], toleranceSec: number = REPRODUCIBILITY_TOLERANCE_SEC): Rdr2ComparisonResult {
  const refuse = (reasons: string[]): Rdr2ComparisonRefused => ({
    schemaVersion: RDR2_ANALYSIS_SCHEMA_VERSION,
    status: 'refused',
    publishable: false,
    reasons,
  });

  if (analyses.length < 2) return refuse([`Comparison needs at least two analyses; ${analyses.length} supplied.`]);

  const unresolvedIdx = analyses.map((a, i) => (a.status === 'unresolved' ? i : -1)).filter((i) => i >= 0);
  if (unresolvedIdx.length > 0) {
    return refuse([
      `Refusing to compare: ${unresolvedIdx.length} of ${analyses.length} analyses are unresolved (index ${unresolvedIdx.join(', ')}). ` +
        'An unresolved run has no boundaries to compare, and averaging it into the others would turn a refusal into a number.',
    ]);
  }

  const candidates = analyses as readonly Rdr2AnalysisCandidate[];

  const reasons: string[] = [];
  const sceneCounts = new Set(candidates.map((c) => c.scenes.length));
  if (sceneCounts.size > 1) reasons.push(`Runs disagree on scene count (${[...sceneCounts].join(' vs ')}); they do not describe the same benchmark structure.`);
  const transitionCounts = new Set(candidates.map((c) => c.boundaries.filter((b) => b.kind === 'transition').length));
  if (transitionCounts.size > 1) reasons.push(`Runs disagree on transition count (${[...transitionCounts].join(' vs ')}).`);

  const shas = candidates.map((c) => c.source.csvSha256);
  if (new Set(shas).size !== shas.length) {
    reasons.push('Two or more analyses come from the identical capture (same CSV SHA-256). Comparing a run against itself cannot demonstrate reproducibility.');
  }

  const builds = new Set(candidates.map((c) => c.source.gameBuildId ?? c.source.gameVersion ?? ''));
  const notes: string[] = [];
  if (builds.size > 1) {
    notes.push(`Runs come from different game builds (${[...builds].join(', ')}); structural differences may be the game's, not the measurement's.`);
  }

  if (reasons.length > 0) return refuse(reasons);

  const boundaries: Rdr2ComparisonBoundaryStat[] = [];
  const kinds = candidates[0].boundaries.map((b) => ({ kind: b.kind, ordinal: b.ordinal }));
  for (const k of kinds) {
    const rel = candidates.map((c) => {
      const b = c.boundaries.find((x) => x.kind === k.kind && x.ordinal === k.ordinal);
      // Structure already verified identical above, so this is present.
      return (b as Rdr2AnalysisBoundary).startOffsetSec - c.gameplayStartOffsetSec;
    });
    const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
    boundaries.push({ kind: k.kind, ordinal: k.ordinal, relativeOffsetsSec: rel, meanSec: mean, spreadSec: Math.max(...rel) - Math.min(...rel) });
  }

  const scenes: Rdr2ComparisonSceneStat[] = candidates[0].scenes.map((_, i) => {
    const durations = candidates.map((c) => c.scenes[i].durationSec);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    return { ordinal: i + 1, durationsSec: durations, meanSec: mean, spreadSec: Math.max(...durations) - Math.min(...durations) };
  });

  const reproduces = boundaries.every((b) => b.spreadSec <= toleranceSec) && scenes.every((s) => s.spreadSec <= toleranceSec);
  if (!reproduces) {
    notes.push(`At least one boundary or scene duration varies by more than ${toleranceSec}s across runs, so the segmentation pattern is NOT demonstrated to reproduce.`);
  }

  return {
    schemaVersion: RDR2_ANALYSIS_SCHEMA_VERSION,
    status: 'compared',
    publishable: false,
    runCount: candidates.length,
    sources: candidates.map((c) => ({ bundleDir: c.source.bundleDir, csvSha256: c.source.csvSha256, gameVersion: c.source.gameVersion, gameBuildId: c.source.gameBuildId })),
    boundaries,
    scenes,
    reproduces,
    toleranceSec,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

export class AnalysisOutputError extends Error {}

/**
 * Writes a report atomically to a path that must NOT already exist.
 *
 * Same stage-then-rename discipline the research-bundle writer uses: the
 * report is written to a uniquely-named temp file beside the destination (same
 * directory, so the rename is on one filesystem and therefore atomic) and
 * renamed into place only once complete. A failure removes the temp file and
 * leaves no partial report.
 *
 * Refuses to write inside `forbiddenDir` — the source bundle — because an
 * analysis that lands in the evidence it analysed has modified that evidence.
 */
export function writeAnalysisReport(outPath: string, report: unknown, forbiddenDir?: string): string {
  if (fs.existsSync(outPath)) {
    throw new AnalysisOutputError(`--out "${outPath}" already exists. Refusing to overwrite an existing report; choose a new path.`);
  }
  const outDir = path.dirname(path.resolve(outPath));
  if (forbiddenDir) {
    const bundle = path.resolve(forbiddenDir);
    if (outDir === bundle || outDir.startsWith(bundle + path.sep)) {
      throw new AnalysisOutputError(
        `--out "${outPath}" is inside the source bundle "${forbiddenDir}". A research bundle is evidence and is never modified; write the report somewhere else.`,
      );
    }
  }
  if (!fs.existsSync(outDir)) {
    throw new AnalysisOutputError(`--out directory "${outDir}" does not exist. Create it first; this analyzer does not create directories it was not pointed at.`);
  }

  const tmp = path.join(outDir, `.rdr2-analysis-staging-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
    if (fs.existsSync(outPath)) {
      throw new AnalysisOutputError(`--out "${outPath}" appeared while the report was being written. Refusing to overwrite it.`);
    }
    fs.renameSync(tmp, outPath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return outPath;
}
