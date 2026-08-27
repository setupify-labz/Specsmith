// An OPERATOR-CONFIRMED marker for when RDR2's results screen first appears.
// RESEARCH ONLY, and deliberately not a detector.
//
// WHY THIS EXISTS
// ---------------
// The offline analyzer can rank where the results screen probably starts, but
// on real captures it cannot yet CLEAR ITS OWN BARS for that boundary. On the
// 420-second run its top-ranked candidates clustered around a neighbourhood
// that matched what a human had separately observed — encouraging, and worth
// nothing as evidence, because "the ranking looks right" is exactly the kind
// of claim that needs an independent measurement rather than a second opinion
// from the same data.
//
// So this records that independent measurement: a timestamp taken when the
// OPERATOR confirms, with their own eyes, that the results screen is on
// screen — while the PresentMon capture keeps running. It is ground truth
// supplied from outside the signal, which is the only thing that can tell us
// whether the ranking is right for the right reason.
//
// WHAT THIS IS NOT
// ----------------
// It is NOT a detector, and nothing may treat it as one. It never feeds the
// analyzer, never selects or ranks a boundary, and never relaxes a bar. The
// analyzer does not import this module; the comparison below takes an
// analysis that has ALREADY been computed, so a marker cannot influence the
// result it is being compared against even by accident. A test asserts the
// analysis is byte-identical with and without a marker present.
//
// It is also not a measurement path: it writes no observation, touches no
// observation store or frame-time archive, and its file is stamped
// `publishable: false`.
//
// THE TIME BASE
// -------------
// A human pressing a key is a slow, imprecise event, and wall clocks can be
// stepped by NTP mid-capture. So every mark carries BOTH a monotonic reading
// (`process.hrtime.bigint()`, which on Windows is backed by
// QueryPerformanceCounter — the same counter PresentMon's TimeInSeconds
// derives from) and a wall-clock reading, and alignment onto the capture
// timeline is computed TWICE, once from each, by two independent routes.
// The disagreement between them is not hidden or averaged away: it is
// reported as the alignment uncertainty, because it is exactly the thing a
// reader needs in order to know how much the comparison can be trusted.

import fs from 'node:fs';
import path from 'node:path';

import type { Rdr2AnalysisResult, TailCandidateDiagnostic } from './rdr2BenchmarkAnalysis';

export const RDR2_RESULTS_MARKER_SCHEMA_VERSION = 1;

export class MarkerError extends Error {}

export interface Rdr2ResultsMark {
  /** 1-based, in the order the operator confirmed them. */
  ordinal: number;
  label: string;
  atWallClock: string;
  /** Monotonic nanoseconds as a decimal string — BigInt does not survive JSON. */
  atMonotonicNs: string;
  sinceSessionStartSec: number;
}

export interface Rdr2ResultsMarkerFile {
  schemaVersion: typeof RDR2_RESULTS_MARKER_SCHEMA_VERSION;
  kind: 'rdr2-results-marker';
  /** Always false. An operator keypress is evidence, never a measurement. */
  publishable: false;
  /** Always true, and stated in the file so a reader cannot mistake its provenance. */
  operatorConfirmed: true;
  /** Always false. Nothing here detected anything; a human looked at a screen. */
  automaticDetection: false;
  note: string;
  session: {
    startedAtWallClock: string;
    endedAtWallClock: string;
    startedAtMonotonicNs: string;
    endedAtMonotonicNs: string;
    /**
     * Wall-clock elapsed minus monotonic elapsed across the whole session. A
     * non-trivial value means the wall clock was stepped while the capture
     * ran, and that the wall-clock anchoring below is the less trustworthy of
     * the two. Reported, never acted on.
     */
    wallClockDriftSec: number;
  };
  marks: Rdr2ResultsMark[];
}

const NS_PER_SEC = 1_000_000_000n;
const nsToSec = (ns: bigint): number => Number(ns) / 1e9;

export interface MarkerClock {
  monotonicNs: () => bigint;
  wallClock: () => Date;
}

export const systemMarkerClock: MarkerClock = {
  monotonicNs: () => process.hrtime.bigint(),
  wallClock: () => new Date(),
};

export interface MarkerSessionIo {
  /** One entry per operator input line. Empty line = mark now; "q"/"quit"/"done" = finish. */
  lines: AsyncIterable<string>;
  log: (line: string) => void;
  clock?: MarkerClock;
}

export const MARKER_INSTRUCTIONS = [
  'RDR2 results-screen marker — RESEARCH ONLY. This records nothing about the game;',
  'it records WHEN YOU SAY the results screen appeared, on a monotonic clock.',
  '',
  'Leave the PresentMon capture running. When RDR2\'s results screen first appears,',
  'press Enter here. Press Enter again for any later moment worth marking.',
  'Type a few words before Enter to label a mark. Type q then Enter to finish.',
  '',
  'Nothing you do here can change what the analyzer decides.',
].join('\n');

/**
 * Runs one marking session against injected IO, so the real CLI and the tests
 * exercise the same code with no TTY and no real waiting.
 */
export async function runMarkerSession(io: MarkerSessionIo): Promise<Rdr2ResultsMarkerFile> {
  const clock = io.clock ?? systemMarkerClock;
  const startMono = clock.monotonicNs();
  const startWall = clock.wallClock();
  io.log(MARKER_INSTRUCTIONS);

  const marks: Rdr2ResultsMark[] = [];
  for await (const raw of io.lines) {
    const text = raw.trim();
    if (/^(q|quit|done|exit)$/i.test(text)) break;
    const atMono = clock.monotonicNs();
    const atWall = clock.wallClock();
    const mark: Rdr2ResultsMark = {
      ordinal: marks.length + 1,
      label: text.length > 0 ? text : 'results screen visible',
      atWallClock: atWall.toISOString(),
      atMonotonicNs: atMono.toString(),
      sinceSessionStartSec: nsToSec(atMono - startMono),
    };
    marks.push(mark);
    io.log(`  mark ${mark.ordinal}: ${mark.label} — ${mark.sinceSessionStartSec.toFixed(3)}s into this session`);
  }

  const endMono = clock.monotonicNs();
  const endWall = clock.wallClock();
  const monotonicElapsed = nsToSec(endMono - startMono);
  const wallElapsed = (endWall.getTime() - startWall.getTime()) / 1000;

  return {
    schemaVersion: RDR2_RESULTS_MARKER_SCHEMA_VERSION,
    kind: 'rdr2-results-marker',
    publishable: false,
    operatorConfirmed: true,
    automaticDetection: false,
    note:
      'Operator-confirmed observation of RDR2\'s results screen, recorded while a PresentMon capture ran. ' +
      'Evidence for evaluating the analyzer, never an input to it, and never a benchmark measurement.',
    session: {
      startedAtWallClock: startWall.toISOString(),
      endedAtWallClock: endWall.toISOString(),
      startedAtMonotonicNs: startMono.toString(),
      endedAtMonotonicNs: endMono.toString(),
      wallClockDriftSec: wallElapsed - monotonicElapsed,
    },
    marks,
  };
}

// ---------------------------------------------------------------------------
// File IO
// ---------------------------------------------------------------------------

/**
 * Writes the marker atomically to a path that must NOT already exist, and
 * REFUSES to write inside the bundle it will be compared against.
 *
 * Same reasoning as the analysis report: a research bundle is evidence, and a
 * file that lands inside the evidence has modified it. The marker is separate
 * evidence and lives separately.
 */
export function writeMarkerFile(outPath: string, file: Rdr2ResultsMarkerFile, forbiddenDir?: string): string {
  if (fs.existsSync(outPath)) {
    throw new MarkerError(`"${outPath}" already exists. Refusing to overwrite a marker; choose a new path.`);
  }
  const outDir = path.dirname(path.resolve(outPath));
  if (forbiddenDir) {
    const bundle = path.resolve(forbiddenDir);
    if (outDir === bundle || outDir.startsWith(bundle + path.sep)) {
      throw new MarkerError(`"${outPath}" is inside the capture bundle "${forbiddenDir}". A bundle is evidence and is never modified; write the marker somewhere else.`);
    }
  }
  if (!fs.existsSync(outDir)) {
    throw new MarkerError(`Directory "${outDir}" does not exist. Create it first; this tool does not create directories it was not pointed at.`);
  }

  const tmp = path.join(outDir, `.rdr2-marker-staging-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
    if (fs.existsSync(outPath)) throw new MarkerError(`"${outPath}" appeared while the marker was being written. Refusing to overwrite it.`);
    fs.renameSync(tmp, outPath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return outPath;
}

/** Reads and validates a marker file. Throws rather than returning something half-trusted. */
export function readMarkerFile(markerPath: string): Rdr2ResultsMarkerFile {
  if (!fs.existsSync(markerPath)) throw new MarkerError(`No marker file at "${markerPath}".`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
  } catch (error) {
    throw new MarkerError(`"${markerPath}" could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const f = parsed as Partial<Rdr2ResultsMarkerFile>;
  if (f?.kind !== 'rdr2-results-marker') throw new MarkerError(`"${markerPath}" is not an RDR2 results marker (kind ${JSON.stringify(f?.kind)}).`);
  if (f.schemaVersion !== RDR2_RESULTS_MARKER_SCHEMA_VERSION) throw new MarkerError(`Marker schemaVersion is ${JSON.stringify(f.schemaVersion)}; this reader handles version ${RDR2_RESULTS_MARKER_SCHEMA_VERSION}.`);
  if (f.operatorConfirmed !== true || f.automaticDetection !== false) {
    throw new MarkerError('Marker does not declare itself operator-confirmed and non-automatic. Refusing: the whole point of this file is that a human, not an algorithm, said what it says.');
  }
  if (!Array.isArray(f.marks) || f.marks.length === 0) throw new MarkerError(`"${markerPath}" holds no marks.`);
  if (!f.session?.startedAtMonotonicNs || !f.session?.endedAtMonotonicNs) throw new MarkerError(`"${markerPath}" has no monotonic session bracket.`);
  return f as Rdr2ResultsMarkerFile;
}

// ---------------------------------------------------------------------------
// Alignment onto the capture timeline
// ---------------------------------------------------------------------------

export interface MarkerAlignment {
  ordinal: number;
  label: string;
  /**
   * Where the mark falls on the capture's OWN timeline (the same zero the
   * analyzer's offsets use), computed two independent ways.
   *
   * `wallClock` measures forward from the capture's recorded start time.
   * `monotonicFromCaptureEnd` measures backward from the capture's last frame
   * using only monotonic elapsed time, so a stepped wall clock cannot move it.
   */
  offsetSecByAnchor: { wallClock: number; monotonicFromCaptureEnd: number };
  earliestOffsetSec: number;
  latestOffsetSec: number;
  /** How far the two anchorings disagree. This IS the alignment uncertainty. */
  anchorSpreadSec: number;
  withinCapture: boolean;
}

export interface CaptureWindow {
  startedAt: string;
  endedAt: string;
  durationSec: number;
}

/**
 * Places each mark on the capture timeline under both anchorings.
 *
 * NOTHING IS AVERAGED. A single "best" offset would hide the one number a
 * reader actually needs — how far the two independent routes disagree — so
 * the result is an interval and its width, and every comparison downstream is
 * stated against that interval rather than against a point.
 */
export function alignMarksToCapture(file: Rdr2ResultsMarkerFile, capture: CaptureWindow): MarkerAlignment[] {
  const captureStartMs = Date.parse(capture.startedAt);
  if (!Number.isFinite(captureStartMs)) throw new MarkerError(`Capture start time ${JSON.stringify(capture.startedAt)} is not a parseable timestamp.`);
  const sessionEndNs = BigInt(file.session.endedAtMonotonicNs);

  return file.marks.map((m) => {
    const wall = (Date.parse(m.atWallClock) - captureStartMs) / 1000;
    const monotonic = capture.durationSec - nsToSec(sessionEndNs - BigInt(m.atMonotonicNs));
    const earliest = Math.min(wall, monotonic);
    const latest = Math.max(wall, monotonic);
    return {
      ordinal: m.ordinal,
      label: m.label,
      offsetSecByAnchor: { wallClock: wall, monotonicFromCaptureEnd: monotonic },
      earliestOffsetSec: earliest,
      latestOffsetSec: latest,
      anchorSpreadSec: latest - earliest,
      withinCapture: latest >= 0 && earliest <= capture.durationSec,
    };
  });
}

// ---------------------------------------------------------------------------
// Comparing the analyzer's RANKING against the independent marker
// ---------------------------------------------------------------------------

export interface RankedCandidateAgainstMarker {
  rank: number;
  windowIndex: number;
  offsetSec: number;
  /**
   * Signed seconds from the marker interval: negative = the candidate sits
   * before the marker, positive = after, 0 = inside it.
   */
  distanceToMarkerSec: number;
  /** Whether this candidate cleared the analyzer's own bars. Unchanged by the marker. */
  qualifies: boolean;
}

export interface Rdr2MarkerComparisonReport {
  schemaVersion: typeof RDR2_RESULTS_MARKER_SCHEMA_VERSION;
  status: 'compared';
  publishable: false;
  /** Always true, and asserted by a test: a marker never moves a bar. */
  acceptanceThresholdsUnchanged: true;
  /** The analysis verdict, restated so a reader cannot mistake this report for one. */
  analysisStatus: 'candidate' | 'unresolved';
  marker: MarkerAlignment;
  markerIntervalSec: [number, number];
  wallClockDriftSec: number;
  /** Every ranked candidate, in the analyzer's own ranking order. */
  candidates: RankedCandidateAgainstMarker[];
  /** Where the marker falls in the ranking: the rank of the closest candidate to it. */
  nearestRank: number;
  nearestOffsetSec: number;
  nearestDistanceSec: number;
  /** How far the analyzer's OWN top-ranked candidate sits from the marker. */
  topRankedOffsetSec: number;
  topRankedDistanceSec: number;
  /** Present only when the analysis resolved. Null when it did not — which is not a failure of the marker. */
  acceptedOffsetSec: number | null;
  acceptedDistanceSec: number | null;
  notes: string[];
}

export interface Rdr2MarkerComparisonRefused {
  schemaVersion: typeof RDR2_RESULTS_MARKER_SCHEMA_VERSION;
  status: 'refused';
  publishable: false;
  acceptanceThresholdsUnchanged: true;
  reasons: string[];
}

export type Rdr2MarkerComparisonResult = Rdr2MarkerComparisonReport | Rdr2MarkerComparisonRefused;

const distanceToInterval = (x: number, lo: number, hi: number): number => (x < lo ? x - lo : x > hi ? x - hi : 0);

/**
 * Measures the analyzer's ranked candidates against the independent marker.
 *
 * TAKES A FINISHED ANALYSIS. The marker is read here and nowhere else, so it
 * physically cannot reach the code that sets or applies a bar. This function
 * reports agreement; it never creates it.
 *
 * REFUSES rather than guessing when the inputs cannot support a comparison —
 * no ranked candidates (the analysis was not run with the tail diagnostic),
 * no marks, or a mark that does not land inside the capture at all.
 */
export function compareRankedCandidatesToMarker(
  analysis: Rdr2AnalysisResult,
  file: Rdr2ResultsMarkerFile,
  capture: CaptureWindow,
  markOrdinal = 1,
): Rdr2MarkerComparisonResult {
  const refuse = (reasons: string[]): Rdr2MarkerComparisonRefused => ({
    schemaVersion: RDR2_RESULTS_MARKER_SCHEMA_VERSION,
    status: 'refused',
    publishable: false,
    acceptanceThresholdsUnchanged: true,
    reasons,
  });

  const tail = analysis.tailDiagnostics;
  if (!tail) {
    return refuse([
      'This analysis carries no tail diagnostic, so it has no ranked candidates to compare the marker against. Re-run the analysis with --diagnose-tail.',
    ]);
  }
  if (tail.candidates.length === 0) {
    return refuse(['The tail search produced no candidates at all, so there is nothing for the marker to be measured against.']);
  }

  let alignments: MarkerAlignment[];
  try {
    alignments = alignMarksToCapture(file, capture);
  } catch (error) {
    return refuse([error instanceof Error ? error.message : String(error)]);
  }
  const marker = alignments.find((a) => a.ordinal === markOrdinal);
  if (!marker) return refuse([`The marker file holds no mark with ordinal ${markOrdinal} (it has ${alignments.length}).`]);
  if (!marker.withinCapture) {
    return refuse([
      `Mark ${marker.ordinal} aligns to ${marker.earliestOffsetSec.toFixed(2)}-${marker.latestOffsetSec.toFixed(2)}s, outside the capture's 0-${capture.durationSec.toFixed(2)}s. ` +
        'The marker session and the capture do not describe the same run.',
    ]);
  }

  const lo = marker.earliestOffsetSec;
  const hi = marker.latestOffsetSec;
  const candidates: RankedCandidateAgainstMarker[] = tail.candidates.map((c: TailCandidateDiagnostic, i) => ({
    rank: i + 1,
    windowIndex: c.windowIndex,
    offsetSec: c.startOffsetSec,
    distanceToMarkerSec: distanceToInterval(c.startOffsetSec, lo, hi),
    qualifies: c.stationarity.passes || c.distribution.passes,
  }));

  let nearest = candidates[0];
  for (const c of candidates) if (Math.abs(c.distanceToMarkerSec) < Math.abs(nearest.distanceToMarkerSec)) nearest = c;

  const acceptedOffsetSec = tail.accepted ? tail.accepted.stableStartOffsetSec : null;

  const notes: string[] = [
    'The marker is an operator-confirmed observation, not a detection. It was not available to the analyzer and did not influence any bar, ranking or verdict.',
    'Agreement between the ranking and the marker says the ranking points somewhere sensible. It does NOT show that the final boundary can be detected from PresentMon data alone: the acceptance bars are unchanged and are what decide that.',
    `Alignment uncertainty is ${marker.anchorSpreadSec.toFixed(3)}s — the disagreement between the wall-clock and monotonic anchorings. Every distance here is measured to the INTERVAL, not to a point.`,
  ];
  if (analysis.status === 'unresolved') {
    notes.push('The analysis remains unresolved. This report does not change that, and no candidate here is a result.');
  }
  if (Math.abs(file.session.wallClockDriftSec) > marker.anchorSpreadSec) {
    notes.push(
      `The wall clock drifted ${file.session.wallClockDriftSec.toFixed(3)}s against the monotonic clock during the session, which is more than the anchorings disagree by. Prefer the monotonic anchoring.`,
    );
  }

  return {
    schemaVersion: RDR2_RESULTS_MARKER_SCHEMA_VERSION,
    status: 'compared',
    publishable: false,
    acceptanceThresholdsUnchanged: true,
    analysisStatus: analysis.status,
    marker,
    markerIntervalSec: [lo, hi],
    wallClockDriftSec: file.session.wallClockDriftSec,
    candidates,
    nearestRank: nearest.rank,
    nearestOffsetSec: nearest.offsetSec,
    nearestDistanceSec: nearest.distanceToMarkerSec,
    topRankedOffsetSec: candidates[0].offsetSec,
    topRankedDistanceSec: candidates[0].distanceToMarkerSec,
    acceptedOffsetSec,
    acceptedDistanceSec: acceptedOffsetSec === null ? null : distanceToInterval(acceptedOffsetSec, lo, hi),
    notes,
  };
}
