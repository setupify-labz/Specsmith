// CLI for the RDR2 research-bundle analyzer. READ-ONLY, RESEARCH-ONLY.
//
//   npx tsx scripts/measured/analyzeRdr2Research.ts <bundleDir> [--out <path>]
//   npx tsx scripts/measured/analyzeRdr2Research.ts --compare <dirA> <dirB> [...] [--out <path>]
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
  analyzeRdr2ResearchBundle,
  compareRdr2Analyses,
  writeAnalysisReport,
  AnalysisOutputError,
  type Rdr2AnalysisResult,
} from './rdr2BenchmarkAnalysis';

export class AnalyzeCliError extends Error {}

export interface AnalyzeCliArgs {
  mode: 'analyze' | 'compare';
  bundleDirs: string[];
  outPath?: string;
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

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--compare') {
      compare = true;
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
    throw new AnalyzeCliError('No bundle directory given. Usage: analyzeRdr2Research.ts <bundleDir> [--out <path>] | --compare <dirA> <dirB> [...]');
  }
  if (compare && bundleDirs.length < 2) {
    throw new AnalyzeCliError(`--compare needs at least two bundle directories; ${bundleDirs.length} given.`);
  }
  if (!compare && bundleDirs.length > 1) {
    throw new AnalyzeCliError(`${bundleDirs.length} bundle directories given without --compare. Analyse one, or pass --compare to compare several.`);
  }

  return { mode: compare ? 'compare' : 'analyze', bundleDirs, outPath };
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
  lines.push(`  results screen    ${result.resultsStartOffsetSec.toFixed(1)}s`);
  lines.push('  candidate scenes (RESEARCH values, not verified benchmark results):');
  for (const s of result.scenes) {
    lines.push(`    scene ${s.ordinal}  ${s.startOffsetSec.toFixed(1)}-${s.endOffsetSec.toFixed(1)}s  ${s.durationSec.toFixed(1)}s  ${s.frameCount} frames  ${s.research.meanFps.toFixed(1)} fps`);
  }
  return lines.join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseAnalyzeArgs(argv);

  if (args.mode === 'analyze') {
    const bundleDir = args.bundleDirs[0];
    const result = analyzeRdr2ResearchBundle(bundleDir);
    console.log(summarize(result));
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(result, null, 2));
    if (args.outPath) {
      writeAnalysisReport(args.outPath, result, bundleDir);
      console.log(`\nReport written to ${args.outPath}`);
    }
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
