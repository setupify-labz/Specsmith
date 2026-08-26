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
  gameVersion?: string;
  gameBuildId?: string;
  collectorBuildHash: string;
}

export interface Rdr2AnalysisCandidate {
  schemaVersion: typeof RDR2_ANALYSIS_SCHEMA_VERSION;
  status: 'candidate';
  /** Always false. A research analysis is never a publishable measurement. */
  publishable: false;
  source: Rdr2AnalysisSource;
  gameplayStartOffsetSec: number;
  resultsStartOffsetSec: number;
  boundaries: Rdr2AnalysisBoundary[];
  scenes: Rdr2CandidateScene[];
  diagnostics: Rdr2AnalysisDiagnostics;
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
export function analyzeRdr2ResearchBundle(bundleDir: string): Rdr2AnalysisResult {
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

  return analyzeFrames(frames, source);
}

/**
 * The structural analysis proper, separated from all filesystem access so it
 * can be driven directly by synthetic frames in tests.
 */
export function analyzeFrames(frames: readonly PresentMonFrame[], source: Rdr2AnalysisSource): Rdr2AnalysisResult {
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

  const fail = (reasons: string[]) => unresolved('structure', reasons, { source, diagnostics });

  // --- structural interpretation -------------------------------------------
  // The benchmark's shape: [menu/loading idle] scene1 T1 scene2 T2 scene3 T3
  // scene4 T4 scene5 [results idle]. Leading and trailing idle blocks are the
  // bookends; the idle blocks BETWEEN gameplay are the inter-scene
  // transitions. Requiring exactly four of those is not a threshold to tune —
  // it is what "five scenes" means.
  const firstBusy = sustained.findIndex((b) => !b.idle);
  if (firstBusy < 0) return fail(['No sustained GPU-busy block found; nothing in this capture looks like benchmark gameplay.']);

  const lastBlock = sustained[sustained.length - 1];
  if (!lastBlock.idle) {
    return fail([
      `The capture ends while the GPU is still rendering (last sustained block runs to ${lastBlock.endOffsetSec.toFixed(1)}s, the end of the recording). ` +
        'A complete benchmark run ends with the results screen, which this recording never reached — so the fifth scene is incomplete and its end cannot be located.',
    ]);
  }

  const gameplayBlocks = sustained.slice(firstBusy, sustained.length - 1);
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

  const resultsBlock = lastBlock;
  const gameplayStart = scenesFound[0];

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
    confidence: confidenceFor(resultsBlock),
    evidence: boundaryEvidence(resultsBlock, ['Final sustained GPU-idle block, running to the end of the recording: the benchmark stopped rendering and did not resume, which is what the results screen looks like.']),
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
    resultsStartOffsetSec: resultsBlock.startOffsetSec,
    boundaries,
    scenes,
    diagnostics,
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
