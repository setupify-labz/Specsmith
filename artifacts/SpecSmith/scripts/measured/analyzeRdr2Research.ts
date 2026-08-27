// CLI for the RDR2 research-bundle analyzer. READ-ONLY, RESEARCH-ONLY.
//
//   npx tsx scripts/measured/analyzeRdr2Research.ts <bundleDir> [--diagnose-tail] [--marker <path>] [--out <path>]
//   npx tsx scripts/measured/analyzeRdr2Research.ts --compare <dirA> <dirB> [...] [--out <path>]
//
// --diagnose-tail prints the full ledger of the final-boundary search: every
// tail window's stationarity, the span-matched gameplay reference both bars
// were read from, and every possible results-screen start ranked by how close
// it came, each with the specific bar it failed. It is a READING aid — it
// changes no bar and no verdict, and an analysis run with it returns exactly
// what the same analysis returns without it.
//
// --marker <path> additionally measures the analyzer's RANKED candidates
// against an operator-confirmed results-screen marker recorded during the
// capture (see markRdr2Results.ts). The marker is read AFTER the analysis is
// complete and is never passed into it, so it cannot influence a bar, a
// ranking or a verdict — it can only report how far each already-ranked
// candidate sits from what a human independently observed. It implies
// --diagnose-tail, because ranked candidates are what it compares.
//
// Deliberately thin: every decision lives in ./rdr2BenchmarkAnalysis.ts, which
// is pure of process concerns and directly testable. This file only turns
// arguments into calls and results into output.
//
// It never writes an observation, never touches measuredObservations.json or
// the frame-time archive, and never modifies the bundle it reads. --out is
// optional; without it the report goes to stdout only.
//
// EXIT CODES
// ----------
//   0  a candidate segmentation was found, or a comparison completed
//   2  the analysis was unresolved, or a comparison was refused
//   1  the CLI itself was misused, or something unexpected failed
//
// 2 is distinct from 1 on purpose: "this recording does not resolve" is a real
// answer this tool is expected to give, not a malfunction, and a script
// driving it should be able to tell the two apart.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareRankedCandidatesToMarker,
  readMarkerFile,
  MarkerError,
  type Rdr2MarkerComparisonResult,
} from './rdr2ResultsMarker';
import {
  analyzeRdr2ResearchBundle,
  STABILITY_WINDOW_FRAMES,
  compareRdr2Analyses,
  writeAnalysisReport,
  AnalysisOutputError,
  type Rdr2AnalysisResult,
  type Rdr2TailDiagnostics,
} from './rdr2BenchmarkAnalysis';

export class AnalyzeCliError extends Error {}

export interface AnalyzeCliArgs {
  mode: 'analyze' | 'compare';
  bundleDirs: string[];
  outPath?: string;
  /** Print the final-boundary search ledger. Explanatory only; never changes the result. */
  diagnoseTail: boolean;
  /** Compare ranked candidates against an operator-confirmed marker. Read after the analysis; never an input to it. */
  markerPath?: string;
}

/**
 * Parses the command line.
 *
 * Applies the same valued-flag rule the collector learned the hard way: a
 * flag's value may not itself look like another flag, so `--out --compare`
 * is refused rather than silently consuming the next switch.
 */
export function parseAnalyzeArgs(argv: readonly string[]): AnalyzeCliArgs {
  const bundleDirs: string[] = [];
  let outPath: string | undefined;
  let compare = false;
  let diagnoseTail = false;
  let markerPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--compare') {
      compare = true;
      continue;
    }
    if (a === '--diagnose-tail') {
      diagnoseTail = true;
      continue;
    }
    if (a === '--marker') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new AnalyzeCliError(`--marker needs a value (got ${v === undefined ? 'end of arguments' : JSON.stringify(v)}).`);
      }
      if (markerPath !== undefined) throw new AnalyzeCliError('--marker was given more than once.');
      markerPath = v;
      i += 1;
      continue;
    }
    if (a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new AnalyzeCliError(`--out needs a value (got ${v === undefined ? 'end of arguments' : JSON.stringify(v)}).`);
      }
      if (outPath !== undefined) throw new AnalyzeCliError('--out was given more than once.');
      outPath = v;
      i += 1;
      continue;
    }
    if (a.startsWith('--')) throw new AnalyzeCliError(`Unknown flag ${JSON.stringify(a)}.`);
    bundleDirs.push(a);
  }

  if (bundleDirs.length === 0) {
    throw new AnalyzeCliError('No bundle directory given. Usage: analyzeRdr2Research.ts <bundleDir> [--diagnose-tail] [--out <path>] | --compare <dirA> <dirB> [...]');
  }
  if (compare && bundleDirs.length < 2) {
    throw new AnalyzeCliError(`--compare needs at least two bundle directories; ${bundleDirs.length} given.`);
  }
  if (!compare && bundleDirs.length > 1) {
    throw new AnalyzeCliError(`${bundleDirs.length} bundle directories given without --compare. Analyse one, or pass --compare to compare several.`);
  }

  if (markerPath !== undefined && compare) {
    throw new AnalyzeCliError('--marker applies to a single analysis, not to --compare. Analyse each run separately with its own marker.');
  }
  // A marker comparison needs the ranked candidates, so it implies the ledger.
  // This changes what is PRINTED, never what is decided.
  return { mode: compare ? 'compare' : 'analyze', bundleDirs, outPath, diagnoseTail: diagnoseTail || markerPath !== undefined, markerPath };
}

/** Human-readable summary printed alongside the JSON, so a run is readable without piping through a parser. */
function summarize(result: Rdr2AnalysisResult): string {
  if (result.status === 'unresolved') {
    return [
      `UNRESOLVED (${result.failure})`,
      ...result.reasons.map((r) => `  - ${r}`),
      '',
      'No boundaries are reported. This analyzer does not fall back to the closest-looking timestamps.',
    ].join('\n');
  }
  const lines = [
    'CANDIDATE segmentation — RESEARCH ONLY, publishable: false',
    `  capture           ${result.diagnostics.totalFrames} frames over ${result.diagnostics.captureDurationSec.toFixed(1)}s`,
    `  derived GPU cut   ${(result.diagnostics.utilizationThreshold * 100).toFixed(1)}% (from this capture's own histogram)`,
    `  sustained floor   ${result.diagnostics.minSustainedBlockSec.toFixed(2)}s (${result.diagnostics.renderedFrameMedianMs.toFixed(2)}ms median rendered frame)`,
    `  gameplay begins   ${result.gameplayStartOffsetSec.toFixed(1)}s`,
  ];
  for (const b of result.boundaries.filter((x) => x.kind === 'transition')) {
    lines.push(`  transition ${b.ordinal}      ${b.startOffsetSec.toFixed(1)}-${b.endOffsetSec.toFixed(1)}s (${b.durationSec.toFixed(2)}s, GPU ${(b.meanGpuRatio * 100).toFixed(1)}%, confidence ${b.confidence})`);
  }
  lines.push(`  scene 5 likely end ${result.scene5LikelyEndOffsetSec.toFixed(2)}s`);
  lines.push(`  results stable at  ${result.resultsScreenStableStartOffsetSec.toFixed(2)}s`);
  lines.push(
    result.finalBoundaryUncertaintySec > 0
      ? `  final boundary    uncertain across ${result.finalBoundaryUncertaintySec.toFixed(2)}s (${result.scene5LikelyEndOffsetSec.toFixed(2)}-${result.resultsScreenStableStartOffsetSec.toFixed(2)}s) — reported as an interval, not one frame`
      : '  final boundary    drift stops and stationarity begins at the same point (no uncertainty interval)',
  );
  lines.push('  candidate scenes (RESEARCH values, not verified benchmark results):');
  for (const s of result.scenes) {
    lines.push(`    scene ${s.ordinal}  ${s.startOffsetSec.toFixed(1)}-${s.endOffsetSec.toFixed(1)}s  ${s.durationSec.toFixed(1)}s  ${s.frameCount} frames  ${s.research.meanFps.toFixed(1)} fps`);
  }
  return lines.join('\n');
}


const n4 = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '   n/a' : v.toFixed(4));

/**
 * The final-boundary ledger, in full.
 *
 * Printed verbatim from the same numbers the decision was made with, so a
 * refusal can be checked rather than taken on trust. Every possible
 * results-screen start is listed, not just the winner, because the useful
 * question after an unresolved run is "how close did anything come, and to
 * which bar".
 */
function renderTailDiagnostics(tail: Rdr2TailDiagnostics): string {
  const L: string[] = [];
  L.push('');
  L.push('=== FINAL-BOUNDARY DIAGNOSTIC (research only; changes no bar and no verdict) ===');
  L.push('UNVALIDATED RESEARCH. The ranking below has been falsified on real data: on one complete');
  L.push('run its top candidates matched a separately-observed results neighbourhood, and on the next');
  L.push('its top candidate was scene 5\'s own start. Read it as a diagnosis of why nothing qualified,');
  L.push('never as a boundary. See RDR2-SEGMENTATION-FINDINGS.md.');
  L.push(`final block        ${tail.finalBlockStartOffsetSec.toFixed(2)}-${tail.finalBlockEndOffsetSec.toFixed(2)}s, GPU ${(tail.finalBlockMeanGpuRatio * 100).toFixed(1)}%, ${tail.finalBlockIdle ? 'idle' : 'busy'}`);
  L.push(`window size        ${tail.stabilityWindowFrames} frames`);
  L.push(`comparison span    ${tail.comparisonSpanWindows} windows (both sides measured over this same length)`);
  L.push(`sustained floor    ${tail.minSustainedBlockSec.toFixed(2)}s`);
  L.push('');
  L.push('--- bars, all derived from this run\'s own identified gameplay ---');
  L.push(`gameplay calmest span      ${n4(tail.bars.gameplaySpanInstabilityFloor)}   (relative spread of window medians)`);
  L.push(`  strict stability bar     ${n4(tail.bars.strictStabilityBar)}   (= calmest / ${tail.bars.strictStabilityFactor})`);
  L.push(`  loose stability bar      ${n4(tail.bars.looseStabilityBar)}`);
  L.push(`distribution change bar    ${n4(tail.bars.distributionChangeBar)}   (largest jump gameplay makes between neighbouring stretches)`);
  if (tail.bars.distributionCohesionBarByChunkCount.length === 0) {
    L.push('cohesion bars              n/a   (no gameplay scene held two comparison chunks)');
  } else {
    for (const b of tail.bars.distributionCohesionBarByChunkCount) {
      L.push(`cohesion bar @ ${String(b.chunks).padStart(2)} chunks   ${n4(b.bar)}   (best self-agreement gameplay reaches over that many)`);
    }
  }
  L.push('');
  L.push('--- span-matched gameplay reference, per identified scene ---');
  L.push('   start      end   windows chunks   minSpan   medSpan   maxSpan   adjChunk   anyPair');
  for (const g of tail.gameplayScenes) {
    L.push(
      `${g.startOffsetSec.toFixed(2).padStart(8)} ${g.endOffsetSec.toFixed(2).padStart(8)} ${String(g.windowCount).padStart(9)} ${String(g.chunkCount).padStart(6)}` +
        `   ${n4(g.minSpanInstability)}   ${n4(g.medianSpanInstability)}   ${n4(g.maxSpanInstability)}     ${n4(g.maxAdjacentChunkDivergence)}    ${n4(g.maxAnyPairChunkDivergence)}`,
    );
  }
  L.push('');
  L.push(`--- tail windows (${tail.windows.length}) ---`);
  L.push('  idx    start      end   medianMs   gpuRatio   spanInstab   worstToEnd');
  for (const w of tail.windows) {
    L.push(
      `${String(w.index).padStart(5)} ${w.startOffsetSec.toFixed(2).padStart(8)} ${w.endOffsetSec.toFixed(2).padStart(8)}` +
        `   ${w.medianFrameTimeMs.toFixed(3).padStart(8)}   ${w.meanGpuRatio.toFixed(4).padStart(8)}   ${n4(w.spanInstability).padStart(10)}   ${n4(w.worstSpanInstabilityToEnd).padStart(10)}`,
    );
  }
  L.push('');
  L.push(`--- results-screen candidates, ranked by margin (${tail.candidates.length}) ---`);
  L.push('The CHOSEN one is the EARLIEST qualifying start, not the highest-scoring: the earliest is the longest suffix, which is the most that can honestly be claimed as results screen.');
  for (const c of tail.candidates) {
    L.push(
      `#${String(c.windowIndex).padStart(4)} at ${c.startOffsetSec.toFixed(2)}s  ${c.suffixDurationSec.toFixed(2)}s  ${c.suffixWindowCount} windows / ${c.chunkCount} chunks  score ${c.score.toFixed(3)}` +
        `${c.windowIndex === tail.accepted?.windowIndex ? '  <== CHOSEN' : c.rejectedBecause.length === 0 ? '  (qualifies)' : ''}`,
    );
    L.push(
      `        stationarity worst ${n4(c.stationarity.worstSpanInstability)} vs bar ${n4(c.stationarity.strictBar)}` +
        `   |   distinctness ${n4(c.distribution.distinctnessFromGameplay)} vs bar ${n4(c.distribution.changeBar)}` +
        `   |   self-agreement ${n4(c.distribution.cohesion)} vs bar ${n4(c.distribution.cohesionBar)}`,
    );
    for (const r of c.rejectedBecause) L.push(`        rejected: ${r}`);
  }
  if (tail.accepted) {
    L.push('');
    L.push(`ACCEPTED via ${tail.accepted.method} at window ${tail.accepted.windowIndex}: stationary/consistent from ${tail.accepted.stableStartOffsetSec.toFixed(2)}s, already unlike gameplay from ${tail.accepted.likelyEndOffsetSec.toFixed(2)}s.`);
  } else {
    L.push('');
    L.push('NOTHING ACCEPTED. Every candidate above names the bar it failed.');
  }
  for (const note of tail.notes) L.push(`note: ${note}`);
  L.push(`(window size ${STABILITY_WINDOW_FRAMES} frames is a sample size, not a threshold on the data.)`);
  return L.join('\n');
}


/**
 * The marker comparison, printed after the analysis it describes.
 *
 * Every line is a MEASUREMENT of the analyzer's existing ranking against
 * evidence the analyzer never saw. Nothing here is a boundary, a result, or a
 * reason to change one.
 */
function renderMarkerComparison(cmp: Rdr2MarkerComparisonResult): string {
  const L: string[] = [];
  L.push('');
  L.push('=== INDEPENDENT MARKER COMPARISON (research only; acceptance bars unchanged) ===');
  if (cmp.status === 'refused') {
    L.push('REFUSED');
    for (const r of cmp.reasons) L.push(`  - ${r}`);
    return L.join('\n');
  }
  const [lo, hi] = cmp.markerIntervalSec;
  L.push(`analysis verdict     ${cmp.analysisStatus.toUpperCase()} (unchanged by anything below)`);
  L.push(`mark ${cmp.marker.ordinal}              "${cmp.marker.label}"`);
  L.push(`  wall-clock anchor  ${cmp.marker.offsetSecByAnchor.wallClock.toFixed(3)}s into the capture`);
  L.push(`  monotonic anchor   ${cmp.marker.offsetSecByAnchor.monotonicFromCaptureEnd.toFixed(3)}s into the capture`);
  L.push(`  interval           ${lo.toFixed(3)}-${hi.toFixed(3)}s  (alignment uncertainty ${cmp.marker.anchorSpreadSec.toFixed(3)}s)`);
  L.push(`  wall-clock drift   ${cmp.wallClockDriftSec.toFixed(3)}s across the marker session`);
  L.push('');
  L.push(`top-ranked candidate ${cmp.topRankedOffsetSec.toFixed(3)}s  (${cmp.topRankedDistanceSec === 0 ? 'inside the marker interval' : `${cmp.topRankedDistanceSec > 0 ? '+' : ''}${cmp.topRankedDistanceSec.toFixed(3)}s from it`})`);
  L.push(`closest candidate    ${cmp.nearestOffsetSec.toFixed(3)}s at rank ${cmp.nearestRank}  (${cmp.nearestDistanceSec === 0 ? 'inside the marker interval' : `${cmp.nearestDistanceSec > 0 ? '+' : ''}${cmp.nearestDistanceSec.toFixed(3)}s from it`})`);
  L.push(
    cmp.acceptedOffsetSec === null
      ? 'accepted boundary    none — the analysis did not resolve, and the marker does not make it resolve'
      : `accepted boundary    ${cmp.acceptedOffsetSec.toFixed(3)}s  (${cmp.acceptedDistanceSec === 0 ? 'inside the marker interval' : `${(cmp.acceptedDistanceSec as number) > 0 ? '+' : ''}${(cmp.acceptedDistanceSec as number).toFixed(3)}s from it`})`,
  );
  L.push('');
  L.push('--- ranked candidates against the marker (analyzer ranking order) ---');
  L.push(' rank    offset   distance   clears bars');
  for (const c of cmp.candidates) {
    L.push(
      `${String(c.rank).padStart(5)} ${c.offsetSec.toFixed(3).padStart(9)}s ${(c.distanceToMarkerSec === 0 ? '  inside' : `${c.distanceToMarkerSec > 0 ? '+' : ''}${c.distanceToMarkerSec.toFixed(3)}`).padStart(10)}   ${c.qualifies ? 'yes' : 'no'}`,
    );
  }
  L.push('');
  for (const n of cmp.notes) L.push(`note: ${n}`);
  return L.join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseAnalyzeArgs(argv);

  if (args.mode === 'analyze') {
    const bundleDir = args.bundleDirs[0];
    const result = analyzeRdr2ResearchBundle(bundleDir, { diagnoseTail: args.diagnoseTail });
    console.log(summarize(result));
    if (args.diagnoseTail) {
      console.log(
        result.tailDiagnostics
          ? renderTailDiagnostics(result.tailDiagnostics)
          : '\n--diagnose-tail was given, but the analysis stopped before the final-boundary search ran (see the reasons above).',
      );
    }
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(result, null, 2));
    let markerComparison: Rdr2MarkerComparisonResult | undefined;
    if (args.markerPath) {
      // Read only AFTER the analysis above is complete, so a marker cannot
      // reach the code that sets or applies a bar.
      const marker = readMarkerFile(args.markerPath);
      const startedAt = result.source?.captureStartedAt;
      const durationSec = result.status === 'candidate' ? result.diagnostics.captureDurationSec : result.diagnostics?.captureDurationSec;
      markerComparison =
        startedAt === undefined || durationSec === undefined
          ? {
              schemaVersion: 1,
              status: 'refused',
              publishable: false,
              acceptanceThresholdsUnchanged: true,
              reasons: ['This analysis did not read far enough to know the capture window, so a marker cannot be placed on its timeline.'],
            }
          : compareRankedCandidatesToMarker(result, marker, {
              startedAt,
              endedAt: result.source?.captureEndedAt ?? startedAt,
              durationSec,
            });
      console.log(renderMarkerComparison(markerComparison));
    }
    if (args.outPath) {
      writeAnalysisReport(args.outPath, markerComparison ? { analysis: result, markerComparison } : result, bundleDir);
      console.log(`\nReport written to ${args.outPath}`);
    }
    // The verdict is the ANALYSIS's, never the marker comparison's.
    return result.status === 'candidate' ? 0 : 2;
  }

  const results = args.bundleDirs.map((d) => analyzeRdr2ResearchBundle(d));
  results.forEach((r, i) => {
    console.log(`\n=== ${args.bundleDirs[i]} ===`);
    console.log(summarize(r));
  });

  const comparison = compareRdr2Analyses(results);
  console.log('\n=== comparison ===');
  if (comparison.status === 'refused') {
    console.log('REFUSED');
    for (const r of comparison.reasons) console.log(`  - ${r}`);
  } else {
    console.log(`Compared ${comparison.runCount} runs. Segmentation pattern reproduces: ${comparison.reproduces ? 'YES' : 'NO'} (tolerance ${comparison.toleranceSec}s)`);
    console.log('  boundary offsets relative to each run\'s own gameplay start:');
    for (const b of comparison.boundaries) {
      const label = b.kind === 'transition' ? `transition ${b.ordinal}` : b.kind;
      console.log(`    ${label.padEnd(16)} ${b.relativeOffsetsSec.map((v) => `${v.toFixed(1)}s`).join(', ')}  (spread ${b.spreadSec.toFixed(2)}s)`);
    }
    console.log('  scene durations:');
    for (const s of comparison.scenes) {
      console.log(`    scene ${s.ordinal}          ${s.durationsSec.map((v) => `${v.toFixed(1)}s`).join(', ')}  (spread ${s.spreadSec.toFixed(2)}s)`);
    }
    for (const n of comparison.notes) console.log(`  note: ${n}`);
  }
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(comparison, null, 2));

  if (args.outPath) {
    writeAnalysisReport(args.outPath, { analyses: results, comparison });
    console.log(`\nReport written to ${args.outPath}`);
  }
  return comparison.status === 'compared' ? 0 : 2;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      // A misuse of the CLI or a refused output path is exit 1 — distinct from
      // exit 2, which means the analysis ran and honestly did not resolve.
      process.exitCode = e instanceof AnalyzeCliError || e instanceof AnalysisOutputError ? 1 : 1;
    });
}
