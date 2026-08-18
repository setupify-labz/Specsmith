// Research-only tool: scans a LOCALLY SAVED UserBenchmark JavaScript asset
// for an embedded "FPS Estimates" game catalog (name + numeric id pairs)
// and writes whatever it finds to game-catalog.json. Reads only files
// already present in research/userbenchmark/scripts/ — no network code
// anywhere in this file.
//
// Run with:
//   node research/userbenchmark/extract-game-catalog.mjs              (scans every file in scripts/)
//   node research/userbenchmark/extract-game-catalog.mjs <filename>   (scans just one file)
//
// What it looks for, in order of confidence:
//   1. Literal /PCGame/FPS-Estimates-<slug>/<id>/ URL fragments — the
//      exact shape confirmed from a real saved UserBenchmark game page
//      (see pages/FPS-Estimates-Fortnite-3954.html and parse.mjs).
//   2. The literal string "FPS Estimates" anywhere in the file, as a
//      weaker signal that game-catalog data might be nearby under a
//      different URL/array shape.
//   3. The literal substring "game" (case-insensitive) anywhere at all,
//      as the weakest possible signal that the file references games in
//      any form.
// If none of these appear, the file contains no game catalog data to
// extract — that is reported explicitly in the output, not silently
// papered over with an empty array and no explanation.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(here, 'scripts');
const outFile = path.join(here, 'game-catalog.json');

function decodeEntities(s) {
  return s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').trim();
}

/** Matches /PCGame/FPS-Estimates-<slug>/<id>/<filters> wherever it occurs
 * in the raw text, quoted or not, JS-string-escaped or not. */
function findPCGameUrls(text) {
  const re = /PCGame\\?\/FPS-Estimates-([^/"'\\]+)\\?\/(\d+)\\?\//g;
  const found = new Map(); // gameId -> {name, occurrences}
  let m;
  while ((m = re.exec(text)) !== null) {
    const slug = decodeEntities(m[1]);
    const gameId = m[2];
    const name = slug.replace(/--/g, ': ').replace(/-/g, ' ').trim();
    if (!found.has(gameId)) found.set(gameId, { gameId, slug, name, occurrences: 0 });
    found.get(gameId).occurrences += 1;
  }
  return [...found.values()];
}

async function scanFile(file) {
  const text = await fs.readFile(path.join(scriptsDir, file), 'utf-8');
  const entries = findPCGameUrls(text);
  const hasFpsEstimatesString = /FPS Estimates/i.test(text);
  const hasGameSubstring = /game/i.test(text);
  const firstBytes = text.slice(0, 120).replace(/\s+/g, ' ').trim();

  return {
    sourceFile: file,
    sourceFileSizeBytes: Buffer.byteLength(text, 'utf-8'),
    sourceFileLines: text.split('\n').length,
    firstLinePreview: firstBytes,
    gameEntriesFound: entries.length,
    entries,
    signals: {
      literalPCGameFpsEstimatesUrls: entries.length,
      literalStringFpsEstimates: hasFpsEstimatesString,
      literalSubstringGameCaseInsensitive: hasGameSubstring,
    },
    conclusion:
      entries.length > 0
        ? `Found ${entries.length} FPS-Estimates game URL(s) embedded in this file.`
        : hasFpsEstimatesString || hasGameSubstring
        ? 'No /PCGame/FPS-Estimates-<slug>/<id>/ URLs found, but the file does reference "FPS Estimates" and/or "game" elsewhere — inspect manually, this tool only extracts the confirmed URL shape.'
        : 'No game-catalog data of any kind found in this file — it contains neither the /PCGame/FPS-Estimates-.../  URL shape, the literal string "FPS Estimates", nor even the substring "game" (checked case-insensitively across the whole file). This file does not embed a searchable game catalog.',
  };
}

async function main() {
  const arg = process.argv[2];
  let files;
  try {
    files = (await fs.readdir(scriptsDir)).filter((f) => /\.(js|txt)$/i.test(f));
  } catch {
    console.error(`No scripts/ directory found at ${scriptsDir} — see README.md.`);
    process.exitCode = 1;
    return;
  }
  if (arg) files = files.filter((f) => f === arg);
  if (files.length === 0) {
    console.error(arg ? `File "${arg}" not found in ${scriptsDir}` : `No .js/.txt files found in ${scriptsDir}.`);
    process.exitCode = 1;
    return;
  }

  const perFile = [];
  const allEntries = new Map();
  for (const file of files) {
    const result = await scanFile(file);
    perFile.push(result);
    for (const e of result.entries) {
      const key = e.gameId;
      if (!allEntries.has(key)) allEntries.set(key, { ...e, foundInFiles: [] });
      allEntries.get(key).foundInFiles.push(file);
    }
    console.log(`${file}: ${result.gameEntriesFound} game entr${result.gameEntriesFound === 1 ? 'y' : 'ies'} found. ${result.conclusion}`);
  }

  // Duplicate detection: same gameId appearing more than once (across or
  // within files), and same normalized name mapped to more than one id.
  const byName = new Map();
  for (const e of allEntries.values()) {
    const key = e.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(e.gameId);
  }
  const duplicateIds = [...allEntries.values()].filter((e) => e.foundInFiles.length > 1).map((e) => ({ gameId: e.gameId, name: e.name, foundInFiles: e.foundInFiles }));
  const duplicateNames = [...byName.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([name, ids]) => ({ name, gameIds: [...new Set(ids)] }));

  const output = {
    generatedAt: new Date().toISOString(),
    note: 'RESEARCH DATA — extracted from locally saved UserBenchmark JavaScript asset(s) in scripts/. No network request was made to produce this file.',
    filesScanned: perFile.map((r) => ({ sourceFile: r.sourceFile, sourceFileSizeBytes: r.sourceFileSizeBytes, sourceFileLines: r.sourceFileLines, gameEntriesFound: r.gameEntriesFound, conclusion: r.conclusion })),
    totalGameEntries: allEntries.size,
    duplicates: {
      duplicateGameIds: duplicateIds,
      duplicateGameNames: duplicateNames,
    },
    games: [...allEntries.values()].sort((a, b) => Number(a.gameId) - Number(b.gameId)),
  };
  await fs.writeFile(outFile, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${outFile}`);
  console.log(`Total game entries: ${output.totalGameEntries}`);
  console.log(`Duplicate game IDs: ${duplicateIds.length}, duplicate game names: ${duplicateNames.length}`);
}

await main();
