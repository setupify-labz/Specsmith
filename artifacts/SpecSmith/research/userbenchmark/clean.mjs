// UserBenchmark data-cleaning pipeline.
//
//   node research/userbenchmark/clean.mjs
//
// RESEARCH-ONLY. Reads dataset/*.jsonl, writes clean/*. It does not touch the
// production benchmark system, src/data, or the raw dataset - every input file
// is opened read-only and the outputs live in a separate directory.
//
// WHAT "CLEANED" MEANS HERE
// -------------------------
// Not "corrected". Nothing is repaired, defaulted, or inferred. A cleaned row
// is a raw row with resolution METADATA attached: which catalog id it maps to
// (if any), what form factor it is, what is wrong with it, and what its
// numbers actually mean. Rows the pipeline is unsure about are routed to a
// review queue rather than guessed at.
//
// The original source values are copied through verbatim under `source`, so a
// cleaned record can always be checked against what UserBenchmark published.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATCH, resolveComponent } from './lib/hardware-normalize.mjs';
import { FLAG, METRIC_DEFINITIONS, findDuplicates, findOutliers, inspectRow } from './lib/clean-observations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.join(here, 'dataset');
const outDir = path.join(here, 'clean');
const appDataDir = path.join(here, '..', '..', 'src', 'data');

const readJsonl = async (file) =>
  (await fs.readFile(file, 'utf-8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const writeJsonl = async (file, rows) =>
  fs.writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

/**
 * Builds one cleaned record.
 *
 * `source` carries the publisher's own values untouched. `metricDefinitions`
 * travels with every record so a downstream reader cannot mistake a composite
 * score for a measured frame rate - the numbers here are NOT FPS.
 */
function cleanRow(row, resolution, flags) {
  return {
    recordType: 'ub-cleaned-observation',
    gameId: row.gameId,
    gameName: row.gameName,
    componentKind: row.componentKind,

    // --- resolution, not correction -------------------------------------
    canonicalId: resolution.catalogId,
    matchType: resolution.matchType,
    matchReason: resolution.reason,
    matchCandidates: resolution.candidates,
    formFactor: resolution.formFactor,

    // --- the publisher's own values, verbatim ----------------------------
    source: {
      publisher: 'UserBenchmark',
      componentName: row.componentName,
      componentRatingId: row.componentRatingId ?? null,
      componentPageUrl: row.componentPageUrl ?? null,
      samples: row.samples ?? null,
      benchPercent: row.benchPercent ?? null,
      valuePercent: row.valuePercent ?? null,
      priceUsd: row.priceUsd ?? null,
      priceStore: row.priceStore ?? null,
    },
    metricDefinitions: METRIC_DEFINITIONS,
    notFpsWarning:
      'benchPercent and valuePercent are UserBenchmark composite scores, not frames per second. This pipeline performs no conversion between them and FPS, and none is possible.',

    flags,
    provenance: row.provenance ?? null,
  };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const gpuCatalog = JSON.parse(await fs.readFile(path.join(appDataDir, 'gpus.json'), 'utf-8'));
  const cpuCatalog = JSON.parse(await fs.readFile(path.join(appDataDir, 'cpus.json'), 'utf-8'));
  const catalogs = {
    gpu: Array.isArray(gpuCatalog) ? gpuCatalog : gpuCatalog.gpus,
    cpu: Array.isArray(cpuCatalog) ? cpuCatalog : cpuCatalog.cpus,
  };

  const summary = {
    totalRawRows: 0,
    cleanedRows: 0,
    exactMatches: 0,
    fuzzyMatches: 0,
    unmatchedRows: 0,
    formFactorBlocked: 0,
    exactDuplicates: 0,
    suspiciousDuplicates: 0,
    outliers: 0,
    rowsNeedingReview: 0,
    byKind: {},
  };

  const allCleaned = [];
  const allReview = [];
  const allOutliers = [];

  for (const kind of ['gpu', 'cpu']) {
    const raw = await readJsonl(path.join(datasetDir, `${kind}-observations.jsonl`));
    summary.totalRawRows += raw.length;

    const duplicates = findDuplicates(raw);
    const outliers = findOutliers(raw, 'benchPercent');
    const exactDupIndexes = new Set(duplicates.exact.flatMap((d) => d.duplicateIndexes));
    const suspiciousIndexes = new Set(duplicates.suspicious.flatMap((d) => d.indexes));
    const outlierByIndex = new Map(outliers.map((o) => [o.index, o]));

    const kindStats = { raw: raw.length, exact: 0, fuzzy: 0, unmatched: 0, blocked: 0, review: 0 };

    for (const [index, row] of raw.entries()) {
      const flags = inspectRow(row).slice();
      const resolution = resolveComponent(row.componentName, kind, catalogs[kind]);

      if (resolution.matchType === MATCH.EXACT) { summary.exactMatches += 1; kindStats.exact += 1; }
      else if (resolution.matchType === MATCH.FUZZY_HIGH) { summary.fuzzyMatches += 1; kindStats.fuzzy += 1; }
      else if (resolution.matchType === MATCH.BLOCKED_FORM_FACTOR) {
        summary.formFactorBlocked += 1; kindStats.blocked += 1;
        flags.push({ flag: FLAG.FORM_FACTOR_BLOCKED, field: 'componentName', detail: resolution.reason });
      } else {
        summary.unmatchedRows += 1; kindStats.unmatched += 1;
        flags.push({ flag: FLAG.UNMATCHED_HARDWARE, field: 'componentName', detail: resolution.reason });
      }

      // An exact duplicate is collapsed - the kept copy carries the note, the
      // redundant copies are recorded in the duplicates report and dropped
      // from the cleaned set. Nothing is lost: the raw file is untouched.
      if (exactDupIndexes.has(index)) continue;

      if (suspiciousIndexes.has(index)) {
        flags.push({ flag: FLAG.SUSPICIOUS_DUPLICATE, field: 'componentName', detail: 'Another row shares this (game, component) but reports different values. Neither is trusted over the other.' });
      }
      const outlier = outlierByIndex.get(index);
      if (outlier) flags.push({ flag: FLAG.OUTLIER, field: outlier.field, detail: outlier.detail });

      const cleaned = cleanRow(row, resolution, flags);
      allCleaned.push(cleaned);

      // Anything the pipeline could not resolve with confidence goes to review
      // rather than into the cleaned set as though it were settled.
      if (flags.length > 0) {
        allReview.push({ ...cleaned, reviewReasons: flags.map((f) => `${f.flag}: ${f.detail}`) });
        kindStats.review += 1;
      }
    }

    summary.exactDuplicates += duplicates.exact.reduce((n, d) => n + d.duplicateIndexes.length, 0);
    summary.suspiciousDuplicates += duplicates.suspicious.length;
    summary.outliers += outliers.length;
    allOutliers.push(...outliers.map((o) => ({ ...o, componentKind: kind })));
    summary.byKind[kind] = kindStats;

    await writeJsonl(path.join(outDir, `${kind}-duplicates.jsonl`), [
      ...duplicates.exact.map((d) => ({ type: 'exact', ...d })),
      ...duplicates.suspicious.map((d) => ({ type: 'suspicious', ...d })),
    ]);
  }

  summary.cleanedRows = allCleaned.length;
  summary.rowsNeedingReview = allReview.length;

  await writeJsonl(path.join(outDir, 'cleaned-observations.jsonl'), allCleaned);
  await writeJsonl(path.join(outDir, 'review-queue.jsonl'), allReview);
  await writeJsonl(path.join(outDir, 'outliers.jsonl'), allOutliers);
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await fs.writeFile(path.join(outDir, 'summary.md'), renderSummary(summary));

  console.log(renderSummary(summary));
}

function renderSummary(s) {
  const pct = (n) => (s.totalRawRows ? `${((n / s.totalRawRows) * 100).toFixed(1)}%` : '-');
  const L = [];
  L.push('# UserBenchmark cleaning summary');
  L.push('');
  L.push('RESEARCH-ONLY. Raw data untouched; production benchmark system unchanged.');
  L.push('');
  L.push('| Metric | Count | Share of raw |');
  L.push('|---|---:|---:|');
  L.push(`| Total raw rows | ${s.totalRawRows} | 100% |`);
  L.push(`| Cleaned rows | ${s.cleanedRows} | ${pct(s.cleanedRows)} |`);
  L.push(`| Exact matches | ${s.exactMatches} | ${pct(s.exactMatches)} |`);
  L.push(`| Fuzzy matches (high confidence only) | ${s.fuzzyMatches} | ${pct(s.fuzzyMatches)} |`);
  L.push(`| Unmatched rows | ${s.unmatchedRows} | ${pct(s.unmatchedRows)} |`);
  L.push(`| Blocked on form factor (laptop / integrated) | ${s.formFactorBlocked} | ${pct(s.formFactorBlocked)} |`);
  L.push(`| Exact duplicates collapsed | ${s.exactDuplicates} | ${pct(s.exactDuplicates)} |`);
  L.push(`| Suspicious duplicate groups | ${s.suspiciousDuplicates} | - |`);
  L.push(`| Outliers reported | ${s.outliers} | ${pct(s.outliers)} |`);
  L.push(`| Rows needing review | ${s.rowsNeedingReview} | ${pct(s.rowsNeedingReview)} |`);
  L.push('');
  L.push('## By component kind');
  L.push('');
  L.push('| Kind | Raw | Exact | Fuzzy | Unmatched | Form-factor blocked | Review |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [kind, k] of Object.entries(s.byKind)) {
    L.push(`| ${kind} | ${k.raw} | ${k.exact} | ${k.fuzzy} | ${k.unmatched} | ${k.blocked} | ${k.review} |`);
  }
  L.push('');
  L.push('## What these numbers are not');
  L.push('');
  L.push('benchPercent and valuePercent are UserBenchmark composite scores, not');
  L.push('frames per second. No conversion between them and FPS is performed here,');
  L.push('and none is possible. Every cleaned record carries its metric definitions.');
  L.push('');
  return L.join('\n');
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

export { cleanRow, renderSummary };
