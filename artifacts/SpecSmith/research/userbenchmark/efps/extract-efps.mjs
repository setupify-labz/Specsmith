// Research-only EFPS extractor for locally saved UserBenchmark FPS-Estimates
// pages. Reads local files only; no network.
//
//   node research/userbenchmark/efps/extract-efps.mjs <saved-page.html>
//
// ---------------------------------------------------------------------------
// This CLI is preserved; its extraction core was replaced.
// ---------------------------------------------------------------------------
// The original standalone implementation of this script had three defects that
// were found by running it against the saved Fortnite page and comparing its
// output to the page's actual contents:
//
//   1. SILENT LOSS OF EVERY COMPARISON RECORD. It did `const fps =
//      Number(fpsRaw); if (!Number.isFinite(fps)) continue;`. A comparison's
//      `p` is a string like "137 vs 108", which is NaN, so every comparison was
//      dropped by that `continue`. On the Fortnite page it reported 27 records
//      and `"warnings": []` — silently discarding 173 of 200 records (86.5%)
//      while reporting a clean run.
//
//   2. CLASSIFICATION BY GAME-NAME PREFIX. `classify()` stripped a
//      `gameName + " "` prefix from the title before looking for " vs ". The
//      EFPS token is often not the catalog name ("PUBG" vs "PlayerUnknown's
//      Battlegrounds", "CSGO" vs "Counter-Strike: Global Offensive"), so the
//      prefix does not match and classification is unreliable. Classification
//      is now structural — see lib/efps.mjs.
//
//   3. TWO-PART URL SPLIT. `parseEfpsUrl()` split the payload into `left` /
//      `right` on the first `_`. The payload actually has THREE groups of four
//      fields (variant A, variant B, base) — see
//      ./configuration-analysis.md. The two-part split cannot represent a
//      comparison's two variants.
//
// Rather than maintain two EFPS parsers, this script now delegates to
// lib/efps.mjs — the corrected, tested implementation shared by ingest.mjs,
// parse.mjs and the test suite. The CLI, the output location
// (efps/parsed/<slug>.json) and the summary shape are kept so any existing
// usage keeps working; the numbers it reports are now correct.
//
// For the full corpus pipeline (normalize → dedupe → validate → datasets →
// coverage) use:  node research/userbenchmark/ingest.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGamePage } from '../lib/game-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'parsed');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node research/userbenchmark/efps/extract-efps.mjs <saved-page.html>');
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(process.cwd(), arg);
  let html;
  try {
    html = await fs.readFile(file, 'utf8');
  } catch (e) {
    console.error(`Could not read "${arg}": ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const parsed = parseGamePage(html, path.basename(file));
  if (!parsed._meta.parsedSuccessfully) {
    console.error(`"${arg}" is not an FPS-Estimates game page (detected: ${parsed._meta.sourceKind.kind}).`);
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(outDir, { recursive: true });
  const slug = (parsed.game.slug || path.basename(file, path.extname(file))).replace(/[^A-Za-z0-9-]/g, '-');
  const outFile = path.join(outDir, `${slug}.json`);

  const output = {
    note: 'RESEARCH DATA — EFPS records extracted from a locally saved page. Not fetched. Crowd-sourced third-party values, NOT verified benchmark records. Extraction core: lib/efps.mjs.',
    game: {
      gameId: parsed.game.gameId,
      name: parsed.game.name,
      slug: parsed.game.slug,
      canonicalUrl: parsed.game.canonicalUrl,
    },
    stats: parsed.efps.stats,
    records: parsed.efps.records,
    rejected: parsed.efps.rejected,
  };
  await fs.writeFile(outFile, JSON.stringify(output, null, 2) + '\n');

  const s = parsed.efps.stats;
  console.log(
    JSON.stringify(
      {
        output: outFile,
        total: s.total,
        direct: s.direct,
        comparison: s.comparisons,
        rejected: s.rejected,
        exactDuplicates: s.exactDuplicates,
        // Every rejection carries a reason and its raw source text in
        // `rejected` — nothing is dropped without a record of it.
        rejectedReasons: parsed.efps.rejected.map((r) => r.reason),
      },
      null,
      2,
    ),
  );
}

await main();
