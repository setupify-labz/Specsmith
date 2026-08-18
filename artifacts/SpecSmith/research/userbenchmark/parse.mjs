// Research-only tool: extracts structured data from LOCALLY SAVED
// UserBenchmark "FPS Estimates" page sources. It never fetches anything —
// it only reads .html/.htm/.xhtml/.txt files already sitting in
// research/userbenchmark/pages/, which a human saved there themselves.
// There is no network code anywhere in this file or anything it imports.
//
//   node research/userbenchmark/parse.mjs              (every file in pages/)
//   node research/userbenchmark/parse.mjs <filename>    (just one file)
//
// Output: one JSON file per source under research/userbenchmark/parsed/,
// plus an index.json.
//
// This is the single-page entry point. For the full corpus pipeline
// (normalize → dedupe → validate → datasets → coverage) use:
//
//   node research/userbenchmark/ingest.mjs
//
// The extraction logic itself lives in lib/game-page.mjs and is shared by
// this script, ingest.mjs and the test suite, so there is exactly one
// implementation to keep correct.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGamePage } from './lib/game-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, 'pages');
const outDir = path.join(here, 'parsed');

async function main() {
  const arg = process.argv[2];
  await fs.mkdir(outDir, { recursive: true });

  let files;
  try {
    files = (await fs.readdir(pagesDir)).filter((f) => /\.(html?|xhtml|txt)$/i.test(f)).sort();
  } catch {
    console.error(`No pages/ directory found at ${pagesDir} — see README.md for how to add saved page sources.`);
    process.exitCode = 1;
    return;
  }
  if (arg) files = files.filter((f) => f === arg);
  if (files.length === 0) {
    console.error(arg ? `File "${arg}" not found in ${pagesDir}` : `No .html/.htm/.xhtml/.txt files found in ${pagesDir} — see README.md.`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of files) {
    const html = await fs.readFile(path.join(pagesDir, file), 'utf-8');
    const parsed = parseGamePage(html, file);

    if (!parsed._meta.parsedSuccessfully) {
      console.log(`Skipped ${file}: not an FPS-Estimates game page (${parsed._meta.sourceKind.kind}).`);
      results.push({ sourceFile: file, skipped: true, sourceKind: parsed._meta.sourceKind.kind });
      continue;
    }

    const outName = `${(parsed.game.slug || path.basename(file, path.extname(file))).replace(/[^A-Za-z0-9-]/g, '-')}.json`;
    await fs.writeFile(path.join(outDir, outName), JSON.stringify(parsed, null, 2) + '\n');
    results.push({
      sourceFile: file,
      outputFile: outName,
      ...parsed.game,
      averageFps: parsed.sampleSummary.averageFps,
      totalSamples: parsed.sampleSummary.totalSamples,
      gpuRows: parsed.gpuTable.length,
      cpuRows: parsed.cpuTable.length,
      efpsRecords: parsed.efps.stats.accepted,
      efpsDirect: parsed.efps.stats.direct,
      efpsComparisons: parsed.efps.stats.comparisons,
      efpsRejected: parsed.efps.stats.rejected,
      warningCount: parsed._meta.warnings.length,
    });
    console.log(
      `Parsed ${file} -> ${outName} (${parsed.gpuTable.length} GPU rows, ${parsed.cpuTable.length} CPU rows, ` +
        `${parsed.efps.stats.accepted} EFPS: ${parsed.efps.stats.direct} direct / ${parsed.efps.stats.comparisons} comparisons, ` +
        `${parsed._meta.warnings.length} warning(s))`,
    );
  }

  await fs.writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), note: 'Index of all parsed UserBenchmark page sources. Research data only.', pages: results }, null, 2) + '\n',
  );
  console.log(`Wrote index.json (${results.length} page(s)).`);
}

await main();
