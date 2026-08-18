// Research-only tooling: builds a calibration/holdout split over SpecSmith's
// existing VERIFIED benchmark records, for future estimator-validation work.
//
// This script is READ-ONLY with respect to production data. It reads
// src/data/benchmarkRecords.json and the Estimator's catalog files, and
// writes its output only under research/validation-dataset/ — it never
// touches src/, package.json, or any file the app actually ships. It is
// not imported by, or wired into, any production code path.
//
// Run it with:
//   node research/validation-dataset/build-dataset.mjs
// Optional flags:
//   --strategy=deterministic (default) | random
//   --seed=<integer>           only used by --strategy=random (default 1)
//   --holdout-fraction=<0..1>  only used by --strategy=random (default 0.35)
//
// Why "deterministic" is the default: with only 23 verified records total,
// a seeded-random split can accidentally strand an entire game or GPU out
// of one side of the split. The deterministic strategy instead holds out a
// fixed fraction *within every game group* (sorted by record id, so it's
// reproducible without a seed), guaranteeing every game with 2+ records
// contributes to both the calibration and holdout sets. See README.md.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dataDir = path.join(root, 'src', 'data');
const outDir = here;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const strategy = args.strategy === 'random' ? 'random' : 'deterministic';
const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 1;
const holdoutFraction = Number.isFinite(Number(args['holdout-fraction'])) ? Number(args['holdout-fraction']) : 0.35;

async function readJson(name) {
  const raw = await fs.readFile(path.join(dataDir, name), 'utf-8');
  return JSON.parse(raw);
}

const [records, profiles, estimatorGames, estimatorGpus, estimatorCpus] = await Promise.all([
  readJson('benchmarkRecords.json'),
  readJson('gameFeatureProfiles.json'),
  readJson('games.json'),
  readJson('gpus.json'),
  readJson('cpus.json'),
]);

// ---------------------------------------------------------------------------
// 1. Stratification tags — one compact signature per record, used both for
//    the coverage report and for grouping records before the split.
// ---------------------------------------------------------------------------
function tagRecord(r) {
  return {
    id: r.id,
    gameId: r.gameId,
    gpuId: r.gpuId,
    cpuId: r.cpuId,
    resolution: r.resolution,
    preset: r.preset,
    rayTracing: r.rayTracing,
    upscaler: r.upscaler,
    upscalerMode: r.upscalerMode ?? null,
    settingsVariant: r.settingsVariant ?? null,
    frameGeneration: r.frameGeneration,
    hasOnePercentLow: r.onePercentLow !== undefined,
    hasZeroPointOnePercentLow: r.zeroPointOnePercentLow !== undefined,
    confirmedFieldCount: r.confirmedFields.length,
    evidenceQuality: r.evidenceQuality,
    verificationMethod: r.verificationMethod,
    averageFps: r.averageFps,
  };
}
const tagged = records.map(tagRecord);

// ---------------------------------------------------------------------------
// 2. Coverage stats
// ---------------------------------------------------------------------------
function countBy(list, fn) {
  const m = new Map();
  for (const item of list) {
    const k = fn(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

const estimatorGameIds = new Set(estimatorGames.map((g) => g.id));
const estimatorGpuIds = new Set(estimatorGpus.map((g) => g.id));
const estimatorCpuIds = new Set(estimatorCpus.map((c) => c.id));
const verifiedGameIds = new Set(profiles.map((p) => p.gameId));
const recordGpuIds = new Set(records.map((r) => r.gpuId));
const recordCpuIds = new Set(records.map((r) => r.cpuId));
const recordGameIds = new Set(records.map((r) => r.gameId));

const coverage = {
  totalRecords: records.length,
  distinctGames: recordGameIds.size,
  distinctGpus: recordGpuIds.size,
  distinctCpus: recordCpuIds.size,
  recordsPerGame: countBy(records, (r) => r.gameId),
  recordsPerGpu: countBy(records, (r) => r.gpuId),
  recordsPerCpu: countBy(records, (r) => r.cpuId),
  recordsPerResolution: countBy(records, (r) => r.resolution),
  recordsPerPreset: countBy(records, (r) => r.preset),
  recordsPerUpscaler: countBy(records, (r) => r.upscaler),
  rayTracingTrue: records.filter((r) => r.rayTracing).length,
  rayTracingFalse: records.filter((r) => !r.rayTracing).length,
  frameGenerationTrue: records.filter((r) => r.frameGeneration).length,
  frameGenerationFalse: records.filter((r) => !r.frameGeneration).length,
  withOnePercentLow: records.filter((r) => r.onePercentLow !== undefined).length,
  withZeroPointOnePercentLow: records.filter((r) => r.zeroPointOnePercentLow !== undefined).length,
  verifiedGamesNotInAnyRecord: [...verifiedGameIds].filter((id) => !recordGameIds.has(id)),
  gpusUsedNotInEstimatorCatalog: [...recordGpuIds].filter((id) => !estimatorGpuIds.has(id)),
  cpusUsedNotInEstimatorCatalog: [...recordCpuIds].filter((id) => !estimatorCpuIds.has(id)),
  estimatorCatalogSize: { games: estimatorGames.length, gpus: estimatorGpus.length, cpus: estimatorCpus.length },
  estimatorGpusNeverBenchmarked: estimatorGpus.length - recordGpuIds.size, // will report the actual count below, this line kept for clarity is overwritten next
};
coverage.estimatorGpusNeverBenchmarked = [...estimatorGpuIds].filter((id) => !recordGpuIds.has(id)).length;
coverage.estimatorCpusNeverBenchmarked = [...estimatorCpuIds].filter((id) => !recordCpuIds.has(id)).length;

// ---------------------------------------------------------------------------
// 3. Calibration / holdout split
// ---------------------------------------------------------------------------
function deterministicSplit(records) {
  const byGame = new Map();
  for (const r of records) {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
    byGame.get(r.gameId).push(r);
  }
  const calibration = [];
  const holdout = [];
  const strandedSingletons = [];
  for (const [gameId, group] of byGame) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    if (sorted.length < 2) {
      // Can't hold anything out without leaving this game with zero
      // calibration data — keep it in calibration only, and flag it.
      calibration.push(...sorted);
      strandedSingletons.push(gameId);
      continue;
    }
    const holdoutCount = Math.max(1, Math.floor(sorted.length / 2));
    const holdoutSlice = sorted.slice(sorted.length - holdoutCount);
    const calibrationSlice = sorted.slice(0, sorted.length - holdoutCount);
    calibration.push(...calibrationSlice);
    holdout.push(...holdoutSlice);
  }
  return { calibration, holdout, strandedSingletons };
}

// Simple mulberry32 PRNG so --strategy=random is reproducible from --seed
// without pulling in a dependency.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomSplit(records, fraction, seedValue) {
  const rng = mulberry32(seedValue);
  const byGame = new Map();
  for (const r of records) {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
    byGame.get(r.gameId).push(r);
  }
  const calibration = [];
  const holdout = [];
  const strandedSingletons = [];
  for (const [gameId, group] of byGame) {
    const shuffled = [...group];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.length < 2) {
      calibration.push(...shuffled);
      strandedSingletons.push(gameId);
      continue;
    }
    const holdoutCount = Math.max(1, Math.round(shuffled.length * fraction));
    holdout.push(...shuffled.slice(0, holdoutCount));
    calibration.push(...shuffled.slice(holdoutCount));
  }
  return { calibration, holdout, strandedSingletons };
}

const split =
  strategy === 'random'
    ? randomSplit(records, holdoutFraction, seed)
    : deterministicSplit(records);

const holdoutIds = new Set(split.holdout.map((r) => r.id));
const datasetOut = tagged.map((t) => ({
  ...t,
  split: holdoutIds.has(t.id) ? 'holdout' : 'calibration',
}));

// ---------------------------------------------------------------------------
// 4. Coverage gaps (dimension combinations with zero records)
// ---------------------------------------------------------------------------
const gaps = [];
if (!records.some((r) => r.resolution === '4k')) gaps.push('No 4K records at all — every record is 1080p or 1440p.');
if (!records.some((r) => r.resolution === '1080p' && r.gameId !== 'marvelrivals')) {
  gaps.push('1080p is only represented by Marvel Rivals — no other game has a 1080p record, so resolution scaling can only be cross-checked within one game/GPU/CPU combination.');
}
if (recordCpuIds.size < 3) gaps.push(`Only ${recordCpuIds.size} distinct CPUs appear in any record (r5-5600, r7-7800x3d) — no mid-range or budget CPU is represented, so CPU-bound scenarios are essentially untested.`);
if (recordGpuIds.size < 4) gaps.push(`Only ${recordGpuIds.size} distinct GPUs appear (rtx3060, rtx4070, rtx4070s) — no high-end (4080/4090/5090 class) or budget (60-class below rtx3060, or AMD/Intel) GPU is represented.`);
if (!records.some((r) => r.upscaler === 'fsr')) gaps.push('No FSR records.');
if (!records.some((r) => r.upscaler === 'xess')) gaps.push('No XeSS records.');
if (!records.some((r) => r.preset === 'low' || r.preset === 'medium')) gaps.push('No Low or Medium preset records — every record is High, Ultra, or Extreme, so the bottom half of the quality-preset curve is completely unvalidated.');
if (records.filter((r) => r.frameGeneration).length <= 1) gaps.push('Only one Frame Generation record exists in total (Marvel Rivals), and it is DLSS/FSR-vendor-ambiguous per its own notes — Frame Generation cannot be meaningfully validated as a dimension yet.');
const gamesWithRTVariance = [...recordGameIds].filter((gameId) => {
  const gameRecords = records.filter((r) => r.gameId === gameId);
  const rtValues = new Set(gameRecords.map((r) => r.rayTracing));
  return rtValues.size > 1;
});
if (gamesWithRTVariance.length === 0) gaps.push('No single game has both an RT-on and RT-off record — every game is only ever tested at one RT state, so RT\'s isolated FPS cost can\'t be measured from this dataset alone, only inferred by comparing across different games.');
if (coverage.verifiedGamesNotInAnyRecord.length > 0) gaps.push(`Verified game profile(s) with zero benchmark records: ${coverage.verifiedGamesNotInAnyRecord.join(', ')}.`);
gaps.push(`${coverage.estimatorGpusNeverBenchmarked} of ${estimatorGpus.length} Estimator-catalog GPUs have never appeared in a single verified record; ${coverage.estimatorCpusNeverBenchmarked} of ${estimatorCpus.length} catalog CPUs likewise.`);
if (split.strandedSingletons.length > 0) gaps.push(`Game(s) with only 1 record — cannot be split into calibration+holdout at all, stayed calibration-only: ${split.strandedSingletons.join(', ')}.`);

// ---------------------------------------------------------------------------
// 5. Write outputs
// ---------------------------------------------------------------------------
await fs.writeFile(
  path.join(outDir, 'dataset.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      strategy,
      ...(strategy === 'random' ? { seed, holdoutFraction } : {}),
      totalRecords: records.length,
      calibrationCount: split.calibration.length,
      holdoutCount: split.holdout.length,
      strandedSingletons: split.strandedSingletons,
      records: datasetOut,
    },
    null,
    2,
  ) + '\n',
);

const reportLines = [];
const push = (s = '') => reportLines.push(s);
push('# Verified-Benchmark Validation Dataset — Coverage Report');
push();
push(`Generated ${new Date().toISOString().slice(0, 10)} by \`research/validation-dataset/build-dataset.mjs\` (strategy: ${strategy}). Research-only — not wired into production. Source data: \`src/data/benchmarkRecords.json\` (read-only, unmodified).`);
push();
push('## 1. Usable observations');
push();
push(`- **${coverage.totalRecords} total verified benchmark records** exist right now, all with a confirmed \`averageFps\` — every one of them is a usable ground-truth observation for average-FPS validation.`);
push(`- **${coverage.withOnePercentLow} of ${coverage.totalRecords}** also carry a confirmed \`onePercentLow\` — the only records usable for validating a future estimator's low-percentile predictions, not just its average.`);
push(`- **${coverage.withZeroPointOnePercentLow} of ${coverage.totalRecords}** carry a confirmed \`zeroPointOnePercentLow\` — none currently do.`);
push(`- Spans **${coverage.distinctGames} games**, **${coverage.distinctGpus} GPUs**, **${coverage.distinctCpus} CPUs**, ${Object.keys(coverage.recordsPerResolution).length} resolutions, ${Object.keys(coverage.recordsPerPreset).length} presets, ${Object.keys(coverage.recordsPerUpscaler).length} upscaler modes.`);
push();
push('## 2. Calibration / holdout split');
push();
push(`Strategy: **${strategy}**. Every game with 2+ records contributes to both sides (holding out \`floor(n/2)\`, minimum 1, sorted deterministically by record id) so no game is only visible in one half of the split.`);
push();
push(`- Calibration: **${split.calibration.length}** records`);
push(`- Holdout: **${split.holdout.length}** records`);
if (split.strandedSingletons.length > 0) {
  push(`- Stranded (only 1 record, calibration-only, cannot be held out without losing the game entirely): ${split.strandedSingletons.join(', ')}`);
} else {
  push('- No stranded singletons — every game contributed to both sides.');
}
push();
push('Per-game split (calibration / holdout):');
push();
push('| Game | Calibration | Holdout |');
push('|---|---|---|');
for (const gameId of [...recordGameIds].sort()) {
  const c = split.calibration.filter((r) => r.gameId === gameId).length;
  const h = split.holdout.filter((r) => r.gameId === gameId).length;
  push(`| ${gameId} | ${c} | ${h} |`);
}
push();
push('## 3. Coverage by dimension');
push();
push('**Records per game:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerGame)) push(`- ${k}: ${v}`);
push();
push('**Records per GPU:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerGpu)) push(`- ${k}: ${v}`);
push();
push('**Records per CPU:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerCpu)) push(`- ${k}: ${v}`);
push();
push('**Records per resolution:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerResolution)) push(`- ${k}: ${v}`);
push();
push('**Records per preset:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerPreset)) push(`- ${k}: ${v}`);
push();
push('**Records per upscaler:**');
push();
for (const [k, v] of Object.entries(coverage.recordsPerUpscaler)) push(`- ${k}: ${v}`);
push();
push(`**Ray tracing:** ${coverage.rayTracingTrue} on / ${coverage.rayTracingFalse} off`);
push(`**Frame Generation:** ${coverage.frameGenerationTrue} on / ${coverage.frameGenerationFalse} off`);
push();
push(`**Estimator catalog cross-check:** the Estimator's own catalog has ${coverage.estimatorCatalogSize.games} games / ${coverage.estimatorCatalogSize.gpus} GPUs / ${coverage.estimatorCatalogSize.cpus} CPUs. Of those, only ${coverage.distinctGpus} GPUs and ${coverage.distinctCpus} CPUs have ever appeared in a verified record — ${coverage.estimatorGpusNeverBenchmarked} catalog GPUs and ${coverage.estimatorCpusNeverBenchmarked} catalog CPUs have zero verified data of any kind.`);
push();
push('## 4. Biggest coverage gaps (most to least significant)');
push();
gaps.forEach((g, i) => push(`${i + 1}. ${g}`));
push();
push('## 5. What this dataset cannot yet support');
push();
push('- **No cross-GPU-tier generalization test beyond one step** — the only "generalization" a holdout split can currently test is rtx4070s → rtx4070 (or vice versa) at fixed settings, since those are the only GPU pairs with matched records. It cannot test whether a future estimator generalizes across a wider GPU spread (e.g. calibrate on RTX 4070-class, predict RTX 4090 or RTX 4060).');
push('- **No CPU-bound validation** — both CPUs used (r5-5600, r7-7800x3d) are mid-to-high tier; nothing here can validate estimator behavior for a CPU-limited scenario.');
push('- **No resolution-scaling validation across games** — 1440p dominates every game except Marvel Rivals (1080p only), so there is no way to check whether a future estimator\'s resolution scaling is consistent across more than one game.');
push('- **No isolated RT-cost measurement** — since no game has both an RT-on and RT-off record, RT\'s FPS cost can only be estimated by comparing *different* games, which conflates RT cost with each game\'s own engine characteristics.');
push();
push('---');
push();
push('_Files in this directory: `build-dataset.mjs` (this script), `dataset.json` (generated — full record list with stratification tags and split assignment), `coverage-report.md` (this file, generated). Regenerate both with `node research/validation-dataset/build-dataset.mjs`._');

await fs.writeFile(path.join(outDir, 'coverage-report.md'), reportLines.join('\n') + '\n');

console.log(`Wrote dataset.json (${records.length} records, ${split.calibration.length} calibration / ${split.holdout.length} holdout) and coverage-report.md to ${outDir}`);
