// Visual recognition of RDR2's "End of benchmark" screen.
// RESEARCH-ONLY PROOF OF CONCEPT. UNVALIDATED.
//
// WHY THIS EXISTS
// ---------------
// Three PresentMon-only signals were tried at RDR2's final gameplay/results
// boundary and each was falsified by the next real capture; the candidate
// ranking was falsified too. See ./RDR2-SEGMENTATION-FINDINGS.md. The
// conclusion there was to stop INFERRING that boundary from frame timings and
// instead OBSERVE it — RDR2's results screen carries a fixed title in a fixed
// place, and recognising a known string in a known position is a far more
// testable problem than inferring a regime change from statistics.
//
// This module is that proof of concept's decision logic, kept pure so it can
// be tested exhaustively without a Windows machine, a GPU, or RDR2.
//
// WHAT IT IS NOT
// --------------
// It is NOT wired into benchmark acceptance, production observations, uploads
// or collect.ts, and it must not be. It does not feed the segmentation
// analyzer. Its output is stamped `publishable: false` and `validated: false`,
// under a kind of its own that the operator-marker reader refuses, so
// human-confirmed evidence and machine-detected evidence can never be mistaken
// for one another.
//
// NO FRAME EVER REACHES THIS CODE
// -------------------------------
// The Windows sampler crops, greyscales and downsamples inside its own
// process and emits a fixed-size GRID OF NUMBERS — a 320x80 greyscale
// reduction of the title crop alone, never the desktop and never the whole
// window. That grid is the only thing that crosses the boundary: this module
// has no image decoder and no image type, holds each grid only long enough to
// score it, and writes no grid to disk. Without --debug-images no frame and no
// grid is ever persisted, and nothing derived from a frame is ever uploaded.
//
// Being honest about what the grid is: at this size it is a coarse thumbnail
// of one band of the screen, not an unrecognisable hash. It stays in memory,
// it never enters a research bundle or an observation, and the evidence file
// this module writes contains timestamps, scores and counts only.
//
// THERE IS NO BUILT-IN REFERENCE, ON PURPOSE
// -------------------------------------------
// A template invented here — text rendered with a font this file chose — would
// not be RDR2's title, and shipping one would be fabricating the very evidence
// the tool exists to gather. So the reference signature is CALIBRATED once on
// the operator's own machine, against their own resolution, UI scale and
// language. Without a calibration file the detector refuses to run.

import fs from 'node:fs';
import path from 'node:path';

export const RDR2_VISUAL_SCHEMA_VERSION = 1;

export class VisualEvidenceError extends Error {}

// ---------------------------------------------------------------------------
// The grid: the only thing that crosses the process boundary
// ---------------------------------------------------------------------------
//
// A fixed size, so a 1080p window and a 1440p window produce the SAME shape
// and the comparison below is resolution-free. Small enough that it cannot
// carry a recognisable picture of anything, large enough to hold the coarse
// structure of a line of text.

export const GRID_WIDTH = 320;
export const GRID_HEIGHT = 80;
export const GRID_CELLS = GRID_WIDTH * GRID_HEIGHT;

/**
 * The crop, as fractions of the window's client area.
 *
 * A STARTING GUESS covering a broad band across the upper-middle of the
 * screen, to be confirmed at calibration — the calibration file records
 * whatever crop was actually used, and detection refuses a calibration whose
 * crop differs from the one it was asked to use.
 */
export interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_TITLE_CROP: NormalizedCrop = { x: 0.15, y: 0.08, w: 0.7, h: 0.18 };

export function cropIsValid(c: NormalizedCrop): boolean {
  const finite = [c.x, c.y, c.w, c.h].every((v) => Number.isFinite(v));
  return finite && c.w > 0 && c.h > 0 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 && c.y + c.h <= 1;
}

export const cropsEqual = (a: NormalizedCrop, b: NormalizedCrop): boolean =>
  Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.h - b.h) < 1e-9;

// ---------------------------------------------------------------------------
// Binarisation and comparison
// ---------------------------------------------------------------------------

/**
 * Otsu's threshold: the grey level that best separates the grid into two
 * classes. Chosen because it is derived from each sample's own histogram, so
 * it follows the screen's brightness instead of encoding one.
 */
export function otsuThreshold(grid: readonly number[]): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of grid) hist[Math.max(0, Math.min(255, Math.round(v)))] += 1;
  const total = grid.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

/** Ink = the darker class. RDR2's title is light on dark, so polarity is decided per sample rather than assumed. */
export function binarize(grid: readonly number[]): Uint8Array {
  const t = otsuThreshold(grid);
  let above = 0;
  for (const v of grid) if (v > t) above += 1;
  // Whichever class is the MINORITY is the text; a title line is sparse
  // against its background either way round, so this works on a light theme
  // and a dark one without being told which it is.
  const inkIsAbove = above <= grid.length / 2;
  const bits = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i += 1) bits[i] = (grid[i] > t) === inkIsAbove ? 1 : 0;
  return bits;
}

export const inkFraction = (bits: Uint8Array): number => {
  let n = 0;
  for (const b of bits) n += b;
  return n / bits.length;
};

/**
 * Matthews correlation between two binarised grids, in [-1, 1].
 *
 * Chosen over plain agreement because a title line is mostly background: two
 * unrelated grids agree on ~90% of cells simply by both being mostly empty,
 * and a measure that rewards that would call anything a match. MCC accounts
 * for both classes and for their imbalance.
 */
export function matthewsCorrelation(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === 1 && b[i] === 1) tp += 1;
    else if (a[i] === 0 && b[i] === 0) tn += 1;
    else if (a[i] === 1) fn += 1;
    else fp += 1;
  }
  const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  if (!(denom > 0)) return 0;
  return (tp * tn - fp * fn) / denom;
}

// ---------------------------------------------------------------------------
// Bars. Deliberately wide apart, with a REFUSAL BAND between them.
// ---------------------------------------------------------------------------
//
// These are proof-of-concept starting values, not validated ones. They have
// never been measured against a real RDR2 screen, and the gap between them
// exists so that anything in the middle is refused rather than guessed at.

/**
 * At or above: the title is present. Below NO_MATCH_MAX_SCORE: absent.
 * Between the two: REFUSED as uncertain.
 *
 * Both bars are centred in the separation the fixtures actually show, rather
 * than perched at its edge. Measured across five resolutions and five
 * lookalike phrases, with the ink-block normalisation above in place:
 *
 *   correct title, 720p to 4K      0.809 - 0.972
 *   lookalike phrases at 1080p     0.066 - 0.228
 *   busy non-title screen          0.008
 *
 * So the refusal band [0.45, 0.70) sits inside a gap of roughly 0.58, leaving
 * about 0.11 of headroom above and 0.22 below. That is a deliberate choice:
 * bars at the very edge of the measured range turn ordinary variation into
 * verdict flips.
 *
 * PROVISIONAL. These numbers come from a synthetic block font, NOT from RDR2.
 * The real reference is calibrated on the operator's own screen, and these
 * bars must be re-checked against it before anyone relies on them.
 */
export const MATCH_MIN_SCORE = 0.7;
export const NO_MATCH_MAX_SCORE = 0.45;
/** Below this much ink the crop is blank or black — an invalid capture, not a negative. */
export const MIN_INK_FRACTION = 0.01;
/** Above this much ink the crop is not a line of text at all. */
export const MAX_INK_FRACTION = 0.6;

export interface VisualSignature {
  gridWidth: number;
  gridHeight: number;
  /** Row-major binarised cells, as a string of '0'/'1'. Not an image and not reversible into one. */
  bits: string;
  inkFraction: number;
}

export function signatureFromGrid(grid: readonly number[]): VisualSignature {
  if (grid.length !== GRID_CELLS) {
    throw new VisualEvidenceError(`Grid holds ${grid.length} cells; expected ${GRID_CELLS} (${GRID_WIDTH}x${GRID_HEIGHT}).`);
  }
  const bits = binarize(grid);
  const canon = normalizeInkBlock(bits);
  if (!canon) throw new VisualEvidenceError('Grid holds no ink to calibrate against; capture the results screen, not a blank one.');
  return {
    gridWidth: CANON_WIDTH,
    gridHeight: CANON_HEIGHT,
    bits: Array.from(canon).join(''),
    inkFraction: inkFraction(bits),
  };
}

const bitsOf = (sig: VisualSignature): Uint8Array => Uint8Array.from(sig.bits, (c) => (c === '1' ? 1 : 0));

/**
 * Fraction of ink mass trimmed from each edge when finding the text's extent.
 *
 * The bounding box is taken around the ink that MATTERS rather than around
 * every last cell, so one stray bright pixel in a corner cannot stretch the
 * box across the whole crop and ruin the normalisation.
 */
export const INK_EXTENT_TRIM = 0.01;

/** The canonical shape every extracted title block is resampled to before comparison. */
export const CANON_WIDTH = 320;
export const CANON_HEIGHT = 80;

interface Extent { x0: number; x1: number; y0: number; y1: number }

/** The box holding all but the outermost `INK_EXTENT_TRIM` of the ink, per axis. */
function inkExtent(bits: Uint8Array): Extent | null {
  const colSum = new Array<number>(GRID_WIDTH).fill(0);
  const rowSum = new Array<number>(GRID_HEIGHT).fill(0);
  let total = 0;
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const v = bits[y * GRID_WIDTH + x];
      if (v) {
        colSum[x] += 1;
        rowSum[y] += 1;
        total += 1;
      }
    }
  }
  if (total === 0) return null;
  const bound = (sums: number[]): [number, number] => {
    const cut = total * INK_EXTENT_TRIM;
    let acc = 0;
    let lo = 0;
    while (lo < sums.length - 1 && acc + sums[lo] <= cut) { acc += sums[lo]; lo += 1; }
    acc = 0;
    let hi = sums.length - 1;
    while (hi > lo && acc + sums[hi] <= cut) { acc += sums[hi]; hi -= 1; }
    return [lo, hi];
  };
  const [x0, x1] = bound(colSum);
  const [y0, y1] = bound(rowSum);
  return { x0, x1, y0, y1 };
}

/**
 * Extracts the title block and resamples it to a canonical shape.
 *
 * THIS is what makes recognition tolerate resolution changes. A game picks an
 * integer font size and centres it, so the same words cover a different
 * FRACTION of the crop at 1080p than at 1440p — measured in the fixtures at
 * 75.1% versus 78.9% of the band. No amount of sliding fixes a size
 * difference, and an earlier draft that only searched translations left the
 * correct screen scoring 0.73 and 0.58, inside the refusal band. Normalising
 * the ink's own bounding box removes position and size together.
 *
 * Returns null when there is no ink to bound, which the caller already treats
 * as an invalid capture.
 */
export function normalizeInkBlock(bits: Uint8Array): Uint8Array | null {
  const e = inkExtent(bits);
  if (!e) return null;
  const bw = e.x1 - e.x0 + 1;
  const bh = e.y1 - e.y0 + 1;
  if (bw <= 0 || bh <= 0) return null;
  const out = new Uint8Array(CANON_WIDTH * CANON_HEIGHT);
  for (let cy = 0; cy < CANON_HEIGHT; cy += 1) {
    const sy0 = e.y0 + Math.floor((cy * bh) / CANON_HEIGHT);
    const sy1 = e.y0 + Math.max(Math.floor((cy * bh) / CANON_HEIGHT) + 1, Math.floor(((cy + 1) * bh) / CANON_HEIGHT));
    for (let cx = 0; cx < CANON_WIDTH; cx += 1) {
      const sx0 = e.x0 + Math.floor((cx * bw) / CANON_WIDTH);
      const sx1 = e.x0 + Math.max(Math.floor((cx * bw) / CANON_WIDTH) + 1, Math.floor(((cx + 1) * bw) / CANON_WIDTH));
      let on = 0;
      let n = 0;
      for (let y = sy0; y < sy1 && y <= e.y1; y += 1) {
        for (let x = sx0; x < sx1 && x <= e.x1; x += 1) {
          on += bits[y * GRID_WIDTH + x];
          n += 1;
        }
      }
      out[cy * CANON_WIDTH + cx] = n > 0 && on / n >= 0.5 ? 1 : 0;
    }
  }
  return out;
}

/**
 * How far the comparison may slide the sample against the reference, in grid
 * cells, before scoring.
 *
 * A title does not land on identical cells at every resolution: the game picks
 * an integer font size and centres it, so the same words sit a little
 * differently at 1080p than at 1440p, and UI scale moves them again. Without
 * this the correct screen scores in the refusal band purely from being a
 * couple of cells off — measured, not assumed: alignment alone cost 0.97 -> 0.73
 * between two resolutions of the same phrase in the fixtures.
 *
 * Kept small on purpose. A wide search would let an unrelated screen find some
 * flattering offset, so this buys alignment tolerance without buying false
 * positives, and the tests check both halves of that trade.
 */
export const MAX_ALIGN_SHIFT_X = 4;
export const MAX_ALIGN_SHIFT_Y = 2;

/** Translates `bits` by (dx, dy) on the grid, filling vacated cells with background. */
function shiftBits(bits: Uint8Array, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(bits.length);
  for (let y = 0; y < CANON_HEIGHT; y += 1) {
    const sy = y - dy;
    if (sy < 0 || sy >= CANON_HEIGHT) continue;
    for (let x = 0; x < CANON_WIDTH; x += 1) {
      const sx = x - dx;
      if (sx < 0 || sx >= CANON_WIDTH) continue;
      out[y * CANON_WIDTH + x] = bits[sy * CANON_WIDTH + sx];
    }
  }
  return out;
}

export interface AlignedScore {
  score: number;
  dx: number;
  dy: number;
}

/** The best correlation over the permitted alignment window, and where it was found. */
export function bestAlignedCorrelation(sample: Uint8Array, reference: Uint8Array): AlignedScore {
  let best: AlignedScore = { score: -1, dx: 0, dy: 0 };
  for (let dy = -MAX_ALIGN_SHIFT_Y; dy <= MAX_ALIGN_SHIFT_Y; dy += 1) {
    for (let dx = -MAX_ALIGN_SHIFT_X; dx <= MAX_ALIGN_SHIFT_X; dx += 1) {
      const score = matthewsCorrelation(shiftBits(sample, dx, dy), reference);
      if (score > best.score) best = { score, dx, dy };
    }
  }
  return best;
}

export type SampleVerdict = 'positive' | 'negative' | 'refused';

export interface SampleRecognition {
  verdict: SampleVerdict;
  score: number | null;
  inkFraction: number | null;
  reason?: string;
}

/**
 * Recognises one sample against the calibrated reference.
 *
 * FAILS CLOSED. A blank or black crop, a crop too dense to be a title, a grid
 * of the wrong shape, or a score inside the refusal band all return
 * `refused` — never `negative`. That distinction matters: a refusal must not
 * be usable as the "last negative" that bounds the boundary, because it is
 * not evidence that the screen was absent.
 */
export function recognizeSample(grid: readonly number[], reference: VisualSignature): SampleRecognition {
  if (grid.length !== GRID_CELLS) {
    return { verdict: 'refused', score: null, inkFraction: null, reason: `sample holds ${grid.length} cells, expected ${GRID_CELLS}` };
  }
  if (reference.gridWidth !== CANON_WIDTH || reference.gridHeight !== CANON_HEIGHT || reference.bits.length !== CANON_WIDTH * CANON_HEIGHT) {
    return { verdict: 'refused', score: null, inkFraction: null, reason: 'calibration grid shape does not match this build' };
  }
  const bits = binarize(grid);
  const ink = inkFraction(bits);
  if (ink < MIN_INK_FRACTION) {
    return { verdict: 'refused', score: null, inkFraction: ink, reason: `crop is blank or black (ink ${ink.toFixed(4)} < ${MIN_INK_FRACTION})` };
  }
  if (ink > MAX_INK_FRACTION) {
    return { verdict: 'refused', score: null, inkFraction: ink, reason: `crop is too dense to be a title line (ink ${ink.toFixed(4)} > ${MAX_INK_FRACTION})` };
  }
  const canon = normalizeInkBlock(bits);
  if (!canon) return { verdict: 'refused', score: null, inkFraction: ink, reason: 'crop holds no ink to normalise' };
  const { score } = bestAlignedCorrelation(canon, bitsOf(reference));
  if (score >= MATCH_MIN_SCORE) return { verdict: 'positive', score, inkFraction: ink };
  if (score < NO_MATCH_MAX_SCORE) return { verdict: 'negative', score, inkFraction: ink };
  return {
    verdict: 'refused',
    score,
    inkFraction: ink,
    reason: `score ${score.toFixed(4)} sits in the refusal band [${NO_MATCH_MAX_SCORE}, ${MATCH_MIN_SCORE}) — recognition is uncertain`,
  };
}

// ---------------------------------------------------------------------------
// Turning a stream of samples into a bounded boundary
// ---------------------------------------------------------------------------

export interface VisualSample {
  /** Monotonic nanoseconds, stamped by the consumer on receipt. Decimal string; BigInt does not survive JSON. */
  atMonotonicNs: string;
  grid: readonly number[];
  /** How long the Windows side took to capture and reduce this sample. Instrumentation only. */
  captureMs: number;
  /** Set when the sampler itself refused — a minimised window, an ambiguous match, a failed PrintWindow. */
  samplerRefusal?: string;
}

export interface VisualBoundary {
  lastNegativeAtMonotonicNs: string;
  firstPositiveAtMonotonicNs: string;
  uncertaintySec: number;
  lastNegativeScore: number;
  firstPositiveScore: number;
}

export interface VisualDetectionResult {
  status: 'detected' | 'not-detected' | 'refused';
  boundary: VisualBoundary | null;
  counts: { total: number; positive: number; negative: number; refused: number };
  /** Instrumentation. Measurements, not a claim — see the note in the evidence file. */
  timing: { captureMsMin: number; captureMsMedian: number; captureMsMax: number; sampleIntervalSecMedian: number } | null;
  reasons: string[];
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Bounds the boundary between the LAST CONFIDENT NEGATIVE and the FIRST
 * CONFIDENT POSITIVE.
 *
 * Refusals are deliberately not usable as either edge. If the samples just
 * before the first positive were refused, the last confident negative is
 * further back and the reported interval is correspondingly wider — which is
 * the honest outcome, not a defect.
 *
 * REFUSES when there is no positive at all, or a positive with no confident
 * negative before it: an unbounded edge is not a boundary.
 */
export function detectBoundary(samples: readonly VisualSample[], reference: VisualSignature): VisualDetectionResult {
  const counts = { total: samples.length, positive: 0, negative: 0, refused: 0 };
  const reasons: string[] = [];

  const captureMs: number[] = [];
  const intervals: number[] = [];
  let previousNs: bigint | null = null;
  for (const s of samples) {
    if (Number.isFinite(s.captureMs)) captureMs.push(s.captureMs);
    const ns = BigInt(s.atMonotonicNs);
    if (previousNs !== null) intervals.push(Number(ns - previousNs) / 1e9);
    previousNs = ns;
  }
  const timing = captureMs.length > 0
    ? {
        captureMsMin: Math.min(...captureMs),
        captureMsMedian: median(captureMs),
        captureMsMax: Math.max(...captureMs),
        sampleIntervalSecMedian: intervals.length > 0 ? median(intervals) : Number.NaN,
      }
    : null;

  let lastNegative: { ns: string; score: number } | null = null;
  let firstPositive: { ns: string; score: number } | null = null;
  let negativeBeforeFirstPositive: { ns: string; score: number } | null = null;

  for (const s of samples) {
    if (s.samplerRefusal) {
      counts.refused += 1;
      continue;
    }
    const r = recognizeSample(s.grid, reference);
    if (r.verdict === 'refused') {
      counts.refused += 1;
      continue;
    }
    if (r.verdict === 'negative') {
      counts.negative += 1;
      lastNegative = { ns: s.atMonotonicNs, score: r.score as number };
      continue;
    }
    counts.positive += 1;
    if (firstPositive === null) {
      firstPositive = { ns: s.atMonotonicNs, score: r.score as number };
      negativeBeforeFirstPositive = lastNegative;
    }
  }

  if (firstPositive === null) {
    reasons.push(
      'The results screen was never recognised in any sample. Either it did not appear while sampling ran, or the calibrated reference does not match what was on screen.',
    );
    return { status: 'not-detected', boundary: null, counts, timing, reasons };
  }
  if (negativeBeforeFirstPositive === null) {
    reasons.push(
      'The first recognised sample had no confidently-negative sample before it, so the boundary has no lower bound. Sampling probably started with the results screen already on screen.',
    );
    return { status: 'refused', boundary: null, counts, timing, reasons };
  }

  const uncertaintySec = Number(BigInt(firstPositive.ns) - BigInt(negativeBeforeFirstPositive.ns)) / 1e9;
  if (!(uncertaintySec > 0)) {
    reasons.push('The bounding samples are not ordered in time; the sample stream is not trustworthy.');
    return { status: 'refused', boundary: null, counts, timing, reasons };
  }

  reasons.push(
    `Bounded by the last confident negative and the first confident positive. Refusals between them, if any, widen this interval rather than narrowing it. ${counts.refused} of ${counts.total} samples were refused.`,
  );
  return {
    status: 'detected',
    boundary: {
      lastNegativeAtMonotonicNs: negativeBeforeFirstPositive.ns,
      firstPositiveAtMonotonicNs: firstPositive.ns,
      uncertaintySec,
      lastNegativeScore: negativeBeforeFirstPositive.score,
      firstPositiveScore: firstPositive.score,
    },
    counts,
    timing,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Calibration and evidence files
// ---------------------------------------------------------------------------


export interface Rdr2VisualCalibrationFile {
  schemaVersion: typeof RDR2_VISUAL_SCHEMA_VERSION;
  kind: 'rdr2-results-visual-calibration';
  publishable: false;
  note: string;
  capturedAtWallClock: string;
  /** The crop this signature was taken from. Detection refuses a mismatch rather than silently comparing across crops. */
  crop: NormalizedCrop;
  /** The window size it was taken at. Recorded for the reader; the grid is resampled, so detection does not require a match. */
  sourceWindow: { width: number; height: number };
  signature: VisualSignature;
}

export interface Rdr2VisualEvidenceFile {
  schemaVersion: typeof RDR2_VISUAL_SCHEMA_VERSION;
  /** DISTINCT from the operator marker's kind, on purpose: machine-detected evidence must never be mistaken for human-confirmed evidence. */
  kind: 'rdr2-results-visual-marker';
  publishable: false;
  /** Always false here. No human looked at anything. */
  operatorConfirmed: false;
  /** Always true here, and the operator-marker reader refuses any file that says so. */
  automaticDetection: true;
  /** Always false. This detector has never been validated against ground truth on a real capture. */
  validated: false;
  note: string;
  session: { startedAtWallClock: string; endedAtWallClock: string; requestedSampleHz: number; crop: NormalizedCrop };
  detection: VisualDetectionResult;
}

/** Keys an evidence file is permitted to carry. Anything else is a bug, and a test asserts this list. */
export const EVIDENCE_TOP_LEVEL_KEYS: readonly string[] = [
  'schemaVersion', 'kind', 'publishable', 'operatorConfirmed', 'automaticDetection', 'validated', 'note', 'session', 'detection',
];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff'];

/**
 * Refuses any path that lands inside `forbiddenDir`.
 *
 * Used for BOTH the evidence file and the debug-image directory. A research
 * bundle is evidence and is never modified, and an image that lands inside one
 * would be published by the bundle writer's atomic rename along with it.
 */
export function assertOutsideBundle(target: string, forbiddenDir: string | undefined, what: string): void {
  if (!forbiddenDir) return;
  const bundle = path.resolve(forbiddenDir);
  const resolved = path.resolve(target);
  if (resolved === bundle || resolved.startsWith(bundle + path.sep)) {
    throw new VisualEvidenceError(
      `${what} "${target}" is inside the research bundle "${forbiddenDir}". Bundles are evidence and never carry images or derived files; choose a location outside it.`,
    );
  }
}

/** The notice written beside any debug images, so nobody finds a folder of screenshots without context. */
export const DEBUG_IMAGE_NOTICE = [
  '# PRIVACY: LOCAL SCREENSHOTS OF YOUR GAME WINDOW',
  '',
  'This directory holds cropped frames captured from the RDR2 window while a',
  'research detector ran. They were written ONLY because --debug-images was',
  'passed explicitly.',
  '',
  '- They are LOCAL. Nothing here is uploaded, and nothing here is part of any',
  '  research bundle, observation, or benchmark submission.',
  '- They are NOT needed after a run. Delete this directory when you are done',
  '  looking at it.',
  '- Do not copy these into a research bundle. The tooling refuses to write',
  '  them there, and that refusal exists for a reason.',
  '',
  'Without --debug-images, no frame is ever written to disk: the Windows',
  'sampler reduces each frame to a grid of numbers in its own memory and',
  'discards the image immediately.',
  '',
].join('\n');

function writeJsonAtomically(outPath: string, body: unknown, label: string): string {
  if (fs.existsSync(outPath)) throw new VisualEvidenceError(`"${outPath}" already exists. Refusing to overwrite a ${label}; choose a new path.`);
  const outDir = path.dirname(path.resolve(outPath));
  if (!fs.existsSync(outDir)) throw new VisualEvidenceError(`Directory "${outDir}" does not exist. Create it first; this tool does not create directories it was not pointed at.`);
  const tmp = path.join(outDir, `.rdr2-visual-staging-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    if (fs.existsSync(outPath)) throw new VisualEvidenceError(`"${outPath}" appeared while writing. Refusing to overwrite it.`);
    fs.renameSync(tmp, outPath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return outPath;
}

export function writeVisualEvidence(outPath: string, file: Rdr2VisualEvidenceFile, forbiddenBundleDir?: string): string {
  assertOutsideBundle(outPath, forbiddenBundleDir, 'Evidence file');
  if (IMAGE_EXTENSIONS.includes(path.extname(outPath).toLowerCase())) {
    throw new VisualEvidenceError(`"${outPath}" looks like an image path. Evidence is JSON: timestamps, scores and counts, never a picture.`);
  }
  return writeJsonAtomically(outPath, file, 'evidence file');
}

export function writeVisualCalibration(outPath: string, file: Rdr2VisualCalibrationFile, forbiddenBundleDir?: string): string {
  assertOutsideBundle(outPath, forbiddenBundleDir, 'Calibration file');
  return writeJsonAtomically(outPath, file, 'calibration file');
}

export function readVisualCalibration(calibrationPath: string): Rdr2VisualCalibrationFile {
  if (!fs.existsSync(calibrationPath)) {
    throw new VisualEvidenceError(
      `No calibration at "${calibrationPath}". This detector ships with NO built-in reference — a template invented here would not be RDR2's title. Run --calibrate once, with the results screen on display, before detecting.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(calibrationPath, 'utf-8'));
  } catch (error) {
    throw new VisualEvidenceError(`"${calibrationPath}" could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const f = parsed as Partial<Rdr2VisualCalibrationFile>;
  if (f?.kind !== 'rdr2-results-visual-calibration') throw new VisualEvidenceError(`"${calibrationPath}" is not a visual calibration (kind ${JSON.stringify(f?.kind)}).`);
  if (f.schemaVersion !== RDR2_VISUAL_SCHEMA_VERSION) throw new VisualEvidenceError(`Calibration schemaVersion is ${JSON.stringify(f.schemaVersion)}; this reader handles version ${RDR2_VISUAL_SCHEMA_VERSION}.`);
  if (!f.signature || f.signature.bits?.length !== CANON_WIDTH * CANON_HEIGHT) throw new VisualEvidenceError(`"${calibrationPath}" has no signature of the expected ${CANON_WIDTH * CANON_HEIGHT}-cell canonical shape.`);
  if (!f.crop || !cropIsValid(f.crop)) throw new VisualEvidenceError(`"${calibrationPath}" has no valid normalized crop.`);
  if (f.signature.inkFraction < MIN_INK_FRACTION || f.signature.inkFraction > MAX_INK_FRACTION) {
    throw new VisualEvidenceError(
      `Calibration ink fraction ${f.signature.inkFraction.toFixed(4)} is outside the plausible range for a title line [${MIN_INK_FRACTION}, ${MAX_INK_FRACTION}]. It was probably captured from a blank or wrong screen; re-calibrate.`,
    );
  }
  return f as Rdr2VisualCalibrationFile;
}

/** Reads an evidence file, refusing anything that is not this kind — including an operator marker. */
export function readVisualEvidence(evidencePath: string): Rdr2VisualEvidenceFile {
  if (!fs.existsSync(evidencePath)) throw new VisualEvidenceError(`No evidence file at "${evidencePath}".`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  } catch (error) {
    throw new VisualEvidenceError(`"${evidencePath}" could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const f = parsed as Partial<Rdr2VisualEvidenceFile>;
  if (f?.kind !== 'rdr2-results-visual-marker') {
    throw new VisualEvidenceError(
      `"${evidencePath}" is not visual-detection evidence (kind ${JSON.stringify(f?.kind)}). Operator-confirmed markers are a different kind and are read by rdr2ResultsMarker.ts; the two are never interchangeable.`,
    );
  }
  if (f.automaticDetection !== true || f.operatorConfirmed !== false) {
    throw new VisualEvidenceError('Visual evidence must declare automaticDetection true and operatorConfirmed false. Refusing a file that misrepresents how it was produced.');
  }
  return f as Rdr2VisualEvidenceFile;
}
