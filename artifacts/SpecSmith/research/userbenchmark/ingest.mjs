// Single-command corpus ingestion for the UserBenchmark research pipeline.
//
//   node research/userbenchmark/ingest.mjs
//
// RESEARCH-ONLY. Reads only files already saved under pages/. There is no
// network code in this file or anything it imports — nothing is fetched,
// crawled, or requested. Adding a new game to the corpus means a human saving
// one more page into pages/ and re-running this command.
//
// Pipeline: discover → parse → EFPS → normalize → dedupe → validate →
//           emit datasets → emit coverage → emit manifest → report.
//
// Deterministic: identical inputs produce byte-identical dataset files
// (record order is stable, and the only timestamps land in report metadata).
// Exit code is non-zero only on validation ERRORs (tooling faults), never on
// WARNINGs (ordinary data gaps).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGamePage } from './lib/game-page.mjs';
import { unwrapIfViewSource } from './lib/view-source.mjs';
import { normalizeAll, QUALITY } from './lib/normalize.mjs';
import { dedupe, VALUE_FIELDS, findDuplicateSourcePages } from './lib/dedupe.mjs';
import * as V from './lib/validate.mjs';
import { buildCaptureManifest, checkCatalogUrl } from './lib/capture.mjs';
import { PARSER_VERSION, EFPS_EXTRACTOR_VERSION, SOURCE_NAME } from './lib/version.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, 'pages');
const parsedDir = path.join(here, 'parsed');
const datasetDir = path.join(here, 'dataset');
const knownGamesFile = path.join(here, 'known-games.json');

const SOURCE_EXT_RE = /\.(html?|xhtml|txt)$/i;

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJsonl(file, records) {
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(file, records.length ? body + '\n' : '');
  return records.length;
}

function pct(n, d) {
  return d ? Number(((n / d) * 100).toFixed(2)) : 0;
}

async function main() {
  const startedAt = new Date().toISOString();
  await fs.mkdir(datasetDir, { recursive: true });
  await fs.mkdir(parsedDir, { recursive: true });

  // --- 1. Discover local sources -------------------------------------------
  let files = [];
  try {
    files = (await fs.readdir(pagesDir)).filter((f) => SOURCE_EXT_RE.test(f)).sort();
  } catch {
    console.error(`No pages/ directory at ${pagesDir}. Nothing to ingest — see README.md.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Discovered ${files.length} local source file(s) in pages/.`);

  // --- 2. Parse (each file read exactly once) ------------------------------
  const parsedPages = [];
  const failedSources = [];
  for (const file of files) {
    const rawFile = await fs.readFile(path.join(pagesDir, file), 'utf-8');
    // A "view source then save" capture is the browser's RENDERING of the
    // source, not the source. Unwrapped here so it reaches the one parser as
    // ordinary HTML instead of failing as an unrecognised page shape.
    const html = unwrapIfViewSource(rawFile);
    let parsed;
    try {
      parsed = parseGamePage(html, file);
    } catch (e) {
      failedSources.push({ sourceFile: file, error: String(e && e.stack ? e.stack : e) });
      console.error(`  ! ${file}: parser threw — ${e.message}`);
      continue;
    }
    parsedPages.push(parsed);
    if (parsed._meta.parsedSuccessfully) {
      // Keep the per-page JSON as the raw extraction record.
      const outName = `${(parsed.game.slug || path.basename(file, path.extname(file))).replace(/[^A-Za-z0-9-]/g, '-')}.json`;
      await fs.writeFile(path.join(parsedDir, outName), JSON.stringify(parsed, null, 2) + '\n');
      console.log(
        `  ✓ ${file} → ${parsed.game.name} (id ${parsed.game.gameId}): ` +
          `${parsed.sampleSummary.averageFps ?? '—'} avg FPS, ${parsed.gpuTable.length} GPU / ${parsed.cpuTable.length} CPU rows, ` +
          `${parsed.efps.stats.accepted} EFPS (${parsed.efps.stats.direct} direct / ${parsed.efps.stats.comparisons} cmp), ` +
          `${parsed._meta.warnings.length} warning(s)`,
      );
    } else {
      console.log(`  – ${file}: skipped (${parsed._meta.sourceKind.kind})`);
    }
  }

  const gamePages = parsedPages.filter((p) => p._meta.parsedSuccessfully);

  // --- 2b. Remove stale derived output ------------------------------------
  // parsed/ is derived data, not a source of truth. If a page is removed from
  // pages/, its JSON must go too — otherwise downstream consumers that read
  // parsed/*.json (build-known-games.mjs does) keep seeing a game whose source
  // no longer exists. This is a real contamination path: a batch of temporary
  // pages left 315 orphaned JSON files behind and silently doubled the catalog.
  const expectedOutputs = new Set(gamePages.map((p) => `${(p.game.slug || path.basename(p._meta.sourceFile, path.extname(p._meta.sourceFile))).replace(/[^A-Za-z0-9-]/g, '-')}.json`));
  expectedOutputs.add('index.json');
  let removedStale = 0;
  for (const f of await fs.readdir(parsedDir)) {
    if (!f.endsWith('.json') || expectedOutputs.has(f)) continue;
    await fs.rm(path.join(parsedDir, f));
    removedStale++;
    console.log(`  ⌫ removed stale parsed/${f} (no matching source in pages/)`);
  }
  if (removedStale > 0) console.log(`Removed ${removedStale} stale parsed output file(s).`);

  // --- 3. Normalize --------------------------------------------------------
  const acc = { games: [], gpuObservations: [], cpuObservations: [], efpsDirect: [], efpsComparisons: [], distributions: [], configurations: [], rejected: [] };
  for (const p of gamePages) {
    const n = normalizeAll(p);
    for (const k of Object.keys(acc)) acc[k].push(...n[k]);
  }

  // --- 4. Dedupe -----------------------------------------------------------
  const deduped = {};
  const allDuplicates = [];
  const allConflicts = [];
  for (const key of ['games', 'gpuObservations', 'cpuObservations', 'efpsDirect', 'efpsComparisons', 'distributions', 'configurations']) {
    const r = dedupe(acc[key], VALUE_FIELDS[key]);
    deduped[key] = r.unique;
    allDuplicates.push(...r.duplicates.map((d) => ({ ...d, dataset: key })));
    allConflicts.push(...r.conflicts.map((c) => ({ ...c, dataset: key })));
  }
  const duplicateSourcePages = findDuplicateSourcePages(gamePages);

  // --- 5. Validate ---------------------------------------------------------
  const issues = [
    ...V.validateSources(parsedPages, duplicateSourcePages),
    ...V.validateGames(deduped.games),
    ...V.validateComponentObservations(deduped.gpuObservations, 'gpu'),
    ...V.validateComponentObservations(deduped.cpuObservations, 'cpu'),
    ...V.validateEfpsDirect(deduped.efpsDirect),
    ...V.validateEfpsComparisons(deduped.efpsComparisons),
    ...V.validateDistributions(deduped.distributions),
    ...V.validateConfigurations(deduped.configurations),
  ];
  const cross = V.crossValidateEfps(deduped.efpsDirect, deduped.efpsComparisons);
  issues.push(...cross.issues);
  for (const f of failedSources) {
    issues.push({ severity: V.SEVERITY.ERROR, rule: 'source.parser-threw', message: `Parser threw on "${f.sourceFile}": ${f.error.split('\n')[0]}`, sourceFile: f.sourceFile });
  }

  // --- 6. Capture manifest -------------------------------------------------
  const known = await readJson(knownGamesFile, { resolved: [] });
  const knownGames = known.resolved ?? [];
  if (knownGames.length === 0) {
    issues.push({ severity: V.SEVERITY.WARNING, rule: 'catalog.empty', message: `No resolved games found in ${path.basename(knownGamesFile)} — capture coverage cannot be computed.` });
  }
  const manifest = buildCaptureManifest(knownGames, parsedPages, files);
  const badUrls = knownGames.map((g) => ({ g, check: checkCatalogUrl(g.url) })).filter((x) => !x.check.ok);
  for (const b of badUrls) {
    issues.push({ severity: V.SEVERITY.WARNING, rule: 'catalog.url-not-canonical', message: `Known game ${b.g.gameId} (${b.g.name}): ${b.check.reason}`, gameId: b.g.gameId });
  }
  if (manifest.summary.notCaptured > 0) {
    issues.push({
      severity: V.SEVERITY.WARNING,
      rule: 'catalog.pages-not-captured',
      message: `${manifest.summary.notCaptured} of ${manifest.summary.totalKnownGames} known games have no saved source. Every extracted count is bounded by this gap; see capture-manifest.json for the exact per-game list.`,
    });
  }
  for (const u of manifest.unlisted) {
    issues.push({ severity: V.SEVERITY.WARNING, rule: 'catalog.saved-game-not-in-catalog', message: `${u.note} (gameId ${u.gameId}, ${u.sourceFile})`, gameId: u.gameId });
  }

  // Summarize only after EVERY issue has been collected.
  const validationSummary = V.summarize(issues);

  // --- 7. Emit datasets ----------------------------------------------------
  const written = {};
  written['games.jsonl'] = await writeJsonl(path.join(datasetDir, 'games.jsonl'), deduped.games);
  written['efps.jsonl'] = await writeJsonl(path.join(datasetDir, 'efps.jsonl'), deduped.efpsDirect);
  written['efps-comparisons.jsonl'] = await writeJsonl(path.join(datasetDir, 'efps-comparisons.jsonl'), deduped.efpsComparisons);
  written['cpu-observations.jsonl'] = await writeJsonl(path.join(datasetDir, 'cpu-observations.jsonl'), deduped.cpuObservations);
  written['gpu-observations.jsonl'] = await writeJsonl(path.join(datasetDir, 'gpu-observations.jsonl'), deduped.gpuObservations);
  written['configurations.jsonl'] = await writeJsonl(path.join(datasetDir, 'configurations.jsonl'), deduped.configurations);
  written['distributions.jsonl'] = await writeJsonl(path.join(datasetDir, 'distributions.jsonl'), deduped.distributions);
  written['conflicts.jsonl'] = await writeJsonl(path.join(datasetDir, 'conflicts.jsonl'), allConflicts);
  written['duplicates.jsonl'] = await writeJsonl(path.join(datasetDir, 'duplicates.jsonl'), allDuplicates);
  written['rejected-records.jsonl'] = await writeJsonl(path.join(datasetDir, 'rejected-records.jsonl'), acc.rejected);

  // --- 8. Coverage ---------------------------------------------------------
  const perGame = manifest.rows
    .filter((r) => r.captured)
    .map((r) => ({
      gameId: r.gameId,
      name: r.name,
      parsed: r.parsed,
      averageFps: r.averageFps,
      totalSamples: r.totalSamples,
      efpsTotal: r.efpsCount,
      efpsDirect: r.efpsDirectCount,
      efpsComparisons: r.efpsComparisonCount,
      gpuRows: r.gpuRowCount,
      cpuRows: r.cpuRowCount,
      warnings: r.warningCount,
    }));

  const distByName = (n) => deduped.distributions.filter((d) => d.distribution === n && d.labelCount > 0).length;
  const coverage = {
    generatedAt: startedAt,
    source: SOURCE_NAME,
    parserVersion: PARSER_VERSION,
    efpsExtractorVersion: EFPS_EXTRACTOR_VERSION,
    researchOnly: true,
    dataQualityNote:
      'These are crowd-sourced, self-reported values extracted from a third-party aggregator. Parsing cleanly makes a record "structurally-validated" and nothing more. None of this is a SpecSmith verified benchmark record.',
    catalog: {
      totalKnownGames: manifest.summary.totalKnownGames,
      captured: manifest.summary.captured,
      notCaptured: manifest.summary.notCaptured,
      capturePercent: manifest.summary.capturePercent,
      parsed: manifest.summary.parsed,
      capturedButNotParsed: manifest.summary.capturedButNotParsed,
      unlistedSavedGames: manifest.summary.unlistedSavedGames,
    },
    sources: {
      filesDiscovered: files.length,
      parsedAsGamePages: gamePages.length,
      skippedNotGamePages: parsedPages.length - gamePages.length,
      parserThrew: failedSources.length,
    },
    records: {
      games: deduped.games.length,
      efpsDirect: deduped.efpsDirect.length,
      efpsComparisons: deduped.efpsComparisons.length,
      efpsTotal: deduped.efpsDirect.length + deduped.efpsComparisons.length,
      cpuObservations: deduped.cpuObservations.length,
      gpuObservations: deduped.gpuObservations.length,
      configurations: deduped.configurations.length,
      distributions: deduped.distributions.length,
      rejected: acc.rejected.length,
      duplicatesRemoved: allDuplicates.length,
      conflictKeys: allConflicts.length,
    },
    chartCoverage: {
      gamesWithFpsHistogram: distByName('fpsHistogram'),
      gamesWithSettingsDistribution: distByName('settings'),
      gamesWithResolutionDistribution: distByName('resolution'),
      ofGamesParsed: gamePages.length,
    },
    configurationDecoding: {
      efpsFieldsProven: ['field0=game', 'field1=GPU', 'field2=CPU'],
      efpsFieldsUnresolved: ['field3 — never populated in any saved source'],
      filterPathProven: ['position0=gpuId', 'position1=cpuId', 'position4=cpuFamilyFilter'],
      filterPathUnresolved: ['position2', 'position3'],
      efpsRecordsFullyDecoded: deduped.efpsDirect.filter((r) => r.configurationStatus === QUALITY.CONFIGURATION_DECODED).length +
        deduped.efpsComparisons.filter((r) => r.configurationStatus === QUALITY.CONFIGURATION_DECODED).length,
      efpsRecordsUnresolved: deduped.efpsDirect.filter((r) => r.configurationStatus === QUALITY.CONFIGURATION_UNRESOLVED).length +
        deduped.efpsComparisons.filter((r) => r.configurationStatus === QUALITY.CONFIGURATION_UNRESOLVED).length,
      configurationsUnresolved: deduped.configurations.filter((c) => c.configurationStatus === QUALITY.CONFIGURATION_UNRESOLVED).length,
      resolutionAndSettingsDimensions:
        'NOT present in either the EFPS URL or the game-page filter path on any saved source. Resolution/settings appear only as page-level chart aggregates, which cannot be joined to a specific (GPU, CPU) EFPS observation.',
    },
    efpsCrossValidation: cross.stats,
    validation: validationSummary,
    biggestGaps: [
      manifest.summary.notCaptured > 0
        ? `${manifest.summary.notCaptured} of ${manifest.summary.totalKnownGames} known games have no saved source (${(100 - manifest.summary.capturePercent).toFixed(2)}% of the catalog). Every extracted-record count in this report is bounded by that gap, not by the parser.`
        : null,
      'EFPS observations carry no resolution or settings dimension, so a given (GPU, CPU, FPS) triple cannot be attributed to a specific preset or resolution.',
      'Filter-path positions 2 and 3 are never populated by any link on any saved source, so their meaning remains unproven.',
      deduped.games.length < 3 ? `Only ${deduped.games.length} game page(s) parsed — too few to confirm the parser generalizes across page-template variants.` : null,
    ].filter(Boolean),
    perGame,
  };
  await fs.writeFile(path.join(datasetDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');

  // --- 9. Reports ----------------------------------------------------------
  await fs.writeFile(path.join(here, 'capture-manifest.json'), JSON.stringify({ generatedAt: startedAt, note: 'Per-game capture status across the known catalog. "captured" is true only when a real saved source exists — never inferred.', summary: manifest.summary, unlistedSavedGames: manifest.unlisted, rows: manifest.rows }, null, 2) + '\n');
  await fs.writeFile(path.join(datasetDir, 'validation-report.md'), renderValidationReport(coverage, issues, allConflicts, acc.rejected));
  await fs.writeFile(path.join(here, 'coverage-report.md'), renderCoverageReport(coverage, manifest));

  // --- 10. Console summary -------------------------------------------------
  console.log('\n' + '='.repeat(72));
  // Two different denominators, reported separately on purpose: "sources" is
  // how many local files were processed; "catalog" is how much of the known
  // 316-game catalog that covers. A saved page for a game outside the catalog
  // raises the first without moving the second.
  console.log(`Sources:    ${coverage.sources.filesDiscovered} file(s) discovered, ${coverage.sources.parsedAsGamePages} parsed as game pages, ${coverage.sources.skippedNotGamePages} skipped`);
  console.log(`Catalog:    ${coverage.catalog.captured}/${coverage.catalog.totalKnownGames} known games captured (${coverage.catalog.capturePercent}%), ${coverage.catalog.parsed} parsed${coverage.catalog.unlistedSavedGames ? `, ${coverage.catalog.unlistedSavedGames} saved game(s) not in the catalog` : ''}`);
  console.log(`EFPS:       ${coverage.records.efpsTotal} total — ${coverage.records.efpsDirect} direct, ${coverage.records.efpsComparisons} comparisons`);
  console.log(`Components: ${coverage.records.gpuObservations} GPU rows, ${coverage.records.cpuObservations} CPU rows`);
  console.log(`Dedup:      ${coverage.records.duplicatesRemoved} duplicates, ${coverage.records.conflictKeys} conflict key(s)`);
  console.log(`Rejected:   ${coverage.records.rejected}`);
  console.log(`Cross-check:${cross.stats.checked} comparison sides checked vs direct records, ${cross.stats.mismatched} mismatch(es)`);
  console.log(`Validation: ${validationSummary.errors} error(s), ${validationSummary.warnings} warning(s)`);
  console.log('='.repeat(72));
  for (const [f, n] of Object.entries(written)) console.log(`  dataset/${f}: ${n} record(s)`);
  console.log(`  dataset/coverage.json, dataset/validation-report.md`);
  console.log(`  capture-manifest.json, coverage-report.md`);

  if (validationSummary.errors > 0) {
    console.error(`\nFAILED: ${validationSummary.errors} validation error(s) — these indicate tooling faults, not data gaps.`);
    for (const i of issues.filter((x) => x.severity === V.SEVERITY.ERROR).slice(0, 20)) {
      console.error(`  [${i.rule}] ${i.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`\nOK: no validation errors. ${validationSummary.warnings} warning(s) are ordinary data gaps, not failures.`);
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
function renderValidationReport(coverage, issues, conflicts, rejected) {
  const byRule = new Map();
  for (const i of issues) {
    const k = `${i.severity}:${i.rule}`;
    let g = byRule.get(k);
    if (!g) byRule.set(k, (g = []));
    g.push(i);
  }
  const sorted = [...byRule.entries()].sort((a, b) => b[1].length - a[1].length);
  const L = [];
  L.push('# Validation Report');
  L.push('');
  L.push('> **Research-only.** Generated by `node research/userbenchmark/ingest.mjs` from');
  L.push('> locally saved page sources. Nothing here was fetched.');
  L.push('');
  L.push(`Generated: ${coverage.generatedAt}  `);
  L.push(`Parser: \`${coverage.parserVersion}\` · EFPS extractor: \`${coverage.efpsExtractorVersion}\``);
  L.push('');
  L.push('## Severity model');
  L.push('');
  L.push('| Severity | Meaning | Fails the run? |');
  L.push('|---|---|---|');
  L.push('| **error** | The pipeline produced something structurally impossible or self-contradictory — a tooling fault to fix in code. | Yes |');
  L.push('| **warning** | The source data is incomplete, odd, or unresolved. An ordinary research finding. | No |');
  L.push('');
  L.push(`**${coverage.validation.errors} error(s), ${coverage.validation.warnings} warning(s).**`);
  L.push('');
  L.push('## EFPS internal cross-validation');
  L.push('');
  L.push('Each comparison side that describes the same (game, GPU, CPU) as a standalone');
  L.push('direct record must report the same FPS. This is an independent check on the');
  L.push('field decoding, the title/value pairing, and the variant resolution all at once.');
  L.push('');
  L.push(`- Sides cross-checkable: **${coverage.efpsCrossValidation.checked}**`);
  L.push(`- Agreed exactly: **${coverage.efpsCrossValidation.agreed}**`);
  L.push(`- Mismatched: **${coverage.efpsCrossValidation.mismatched}**`);
  L.push('');
  L.push('## Issues by rule');
  L.push('');
  if (sorted.length === 0) {
    L.push('_No issues raised._');
  } else {
    L.push('| Severity | Rule | Count | Example |');
    L.push('|---|---|---:|---|');
    for (const [k, list] of sorted) {
      const [sev, ...rest] = k.split(':');
      const ex = String(list[0].message).replace(/\|/g, '\\|').slice(0, 130);
      L.push(`| ${sev} | \`${rest.join(':')}\` | ${list.length} | ${ex} |`);
    }
  }
  L.push('');
  L.push('## Conflicts');
  L.push('');
  if (conflicts.length === 0) {
    L.push('_No conflicting observations._ A conflict is the same identity key carrying');
    L.push('different values; conflicts are never collapsed, since choosing a winner would');
    L.push('invent data.');
  } else {
    L.push('| Dataset | Key | Variants | Compared fields |');
    L.push('|---|---|---:|---|');
    for (const c of conflicts.slice(0, 100)) {
      L.push(`| ${c.dataset} | \`${c.observationKey}\` | ${c.variantCount} | ${c.comparedFields.join(', ')} |`);
    }
    if (conflicts.length > 100) L.push(`| … | _${conflicts.length - 100} more in conflicts.jsonl_ | | |`);
  }
  L.push('');
  L.push('## Rejected records');
  L.push('');
  if (rejected.length === 0) {
    L.push('_No records rejected._ Malformed records are never silently discarded — any');
    L.push('that appeared would be listed here and written to `dataset/rejected-records.jsonl`.');
  } else {
    const byReason = new Map();
    for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    L.push('| Reason | Count |');
    L.push('|---|---:|');
    for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) L.push(`| \`${r}\` | ${n} |`);
  }
  L.push('');
  return L.join('\n');
}

function renderCoverageReport(c, manifest) {
  const L = [];
  L.push('# UserBenchmark Research Ingestion — Coverage Report');
  L.push('');
  L.push('> **Research-only.** Generated by `node research/userbenchmark/ingest.mjs`.');
  L.push('> Every number below comes from locally saved page sources. Nothing was fetched.');
  L.push('> These are crowd-sourced, self-reported third-party values — **not** SpecSmith');
  L.push('> verified benchmark records.');
  L.push('');
  L.push(`Generated: ${c.generatedAt}  `);
  L.push(`Parser: \`${c.parserVersion}\` · EFPS extractor: \`${c.efpsExtractorVersion}\``);
  L.push('');
  L.push('## Catalog coverage');
  L.push('');
  L.push('| Metric | Count |');
  L.push('|---|---:|');
  L.push(`| Total known games | ${c.catalog.totalKnownGames} |`);
  L.push(`| Pages actually available (captured) | ${c.catalog.captured} |`);
  L.push(`| Pages successfully parsed | ${c.catalog.parsed} |`);
  L.push(`| Captured but failed to parse | ${c.catalog.capturedButNotParsed} |`);
  L.push(`| **Not captured** | **${c.catalog.notCaptured}** |`);
  L.push(`| Capture coverage | ${c.catalog.capturePercent}% |`);
  L.push('');
  L.push(`Source files discovered: ${c.sources.filesDiscovered} · parsed as game pages: ${c.sources.parsedAsGamePages} · skipped (not game pages): ${c.sources.skippedNotGamePages} · parser threw: ${c.sources.parserThrew}`);
  L.push('');
  L.push('## Extracted records');
  L.push('');
  L.push('| Dataset | Records |');
  L.push('|---|---:|');
  L.push(`| Games | ${c.records.games} |`);
  L.push(`| EFPS — total | ${c.records.efpsTotal} |`);
  L.push(`| EFPS — direct | ${c.records.efpsDirect} |`);
  L.push(`| EFPS — comparisons | ${c.records.efpsComparisons} |`);
  L.push(`| GPU observations | ${c.records.gpuObservations} |`);
  L.push(`| CPU observations | ${c.records.cpuObservations} |`);
  L.push(`| Configurations | ${c.records.configurations} |`);
  L.push(`| Distributions | ${c.records.distributions} |`);
  L.push(`| Duplicates removed | ${c.records.duplicatesRemoved} |`);
  L.push(`| Conflict keys | ${c.records.conflictKeys} |`);
  L.push(`| Rejected | ${c.records.rejected} |`);
  L.push('');
  L.push('## Chart coverage');
  L.push('');
  L.push('| Chart | Games with data | Of parsed |');
  L.push('|---|---:|---:|');
  L.push(`| FPS histogram | ${c.chartCoverage.gamesWithFpsHistogram} | ${c.chartCoverage.ofGamesParsed} |`);
  L.push(`| Settings distribution | ${c.chartCoverage.gamesWithSettingsDistribution} | ${c.chartCoverage.ofGamesParsed} |`);
  L.push(`| Resolution distribution | ${c.chartCoverage.gamesWithResolutionDistribution} | ${c.chartCoverage.ofGamesParsed} |`);
  L.push('');
  L.push('## Configuration decoding');
  L.push('');
  L.push('Full evidence in [`efps/configuration-analysis.md`](efps/configuration-analysis.md).');
  L.push('');
  L.push('| Field | Status |');
  L.push('|---|---|');
  for (const f of c.configurationDecoding.efpsFieldsProven) L.push(`| EFPS ${f} | **proven** |`);
  for (const f of c.configurationDecoding.efpsFieldsUnresolved) L.push(`| EFPS ${f} | unresolved |`);
  for (const f of c.configurationDecoding.filterPathProven) L.push(`| Filter path ${f} | **proven** |`);
  for (const f of c.configurationDecoding.filterPathUnresolved) L.push(`| Filter path ${f} | unresolved |`);
  L.push('');
  L.push(`- EFPS records fully configuration-decoded: **${c.configurationDecoding.efpsRecordsFullyDecoded}**`);
  L.push(`- EFPS records with an unresolved field: **${c.configurationDecoding.efpsRecordsUnresolved}**`);
  L.push(`- Configurations with an unresolved position: **${c.configurationDecoding.configurationsUnresolved}**`);
  L.push('');
  L.push(`**Resolution / settings:** ${c.configurationDecoding.resolutionAndSettingsDimensions}`);
  L.push('');
  L.push('## EFPS cross-validation');
  L.push('');
  L.push(`${c.efpsCrossValidation.checked} comparison sides were checked against the direct record for the same (game, GPU, CPU): **${c.efpsCrossValidation.agreed} agreed exactly, ${c.efpsCrossValidation.mismatched} mismatched.**`);
  L.push('');
  L.push('## Validation');
  L.push('');
  L.push(`**${c.validation.errors} error(s), ${c.validation.warnings} warning(s).** Full breakdown in [dataset/validation-report.md](dataset/validation-report.md).`);
  L.push('');
  L.push('## Per-game breakdown');
  L.push('');
  if (c.perGame.length === 0) {
    L.push('_No games captured yet._');
  } else {
    L.push('| Game | ID | Avg FPS | Samples | EFPS | Direct | Cmp | GPU rows | CPU rows | Warnings |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const g of c.perGame) {
      L.push(`| ${g.name} | ${g.gameId} | ${g.averageFps ?? '—'} | ${g.totalSamples ?? '—'} | ${g.efpsTotal} | ${g.efpsDirect} | ${g.efpsComparisons} | ${g.gpuRows} | ${g.cpuRows} | ${g.warnings} |`);
    }
  }
  L.push('');
  L.push('## Biggest remaining gaps');
  L.push('');
  for (const g of c.biggestGaps) L.push(`- ${g}`);
  L.push('');
  L.push('## Uncaptured games');
  L.push('');
  const missing = manifest.rows.filter((r) => !r.captured);
  L.push(`${missing.length} of ${manifest.rows.length} known games have no saved source. Each row below is a page a human`);
  L.push('would need to save into `pages/` under the given filename. This tool cannot');
  L.push('acquire them — see the capture workflow in `README.md`.');
  L.push('');
  L.push('The full list lives in `capture-manifest.json`; the first 40 are shown here.');
  L.push('');
  if (missing.length > 0) {
    L.push('| Game | ID | Save as |');
    L.push('|---|---|---|');
    for (const m of missing.slice(0, 40)) L.push(`| ${m.name} | ${m.gameId} | \`${m.expectedFilename}\` |`);
    if (missing.length > 40) L.push(`| _…${missing.length - 40} more_ | | _see capture-manifest.json_ |`);
  }
  L.push('');
  return L.join('\n');
}

await main();
