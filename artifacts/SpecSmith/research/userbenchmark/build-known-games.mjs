// Research-only tool: merges every FPS-Estimates game discovered across
// ALL locally saved UserBenchmark sources parsed so far (the single-game
// page parser's output in parsed/, and the search/hub page parser's
// output in homepage/parsed/) into one deduplicated catalog. No network
// code — this only reads JSON files already produced by the other parsers
// in this directory.
//
// Run with: node research/userbenchmark/build-known-games.mjs
// (run the other parsers first if their parsed/ output is stale)
//
// Every entry is tagged with how "resolved" it is:
//   - resolved:   has a gameId + URL (reachable directly)
//   - nameOnly:   only a name is known (from the site's autocomplete list)
//     — NOT reachable without either the AJAX-only search pagination or a
//     separately saved page for that specific game.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, 'known-games.json');

async function readJsonSafe(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}
async function listJsonFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const games = new Map(); // gameId -> entry
const nameOnly = new Map(); // normalized name -> entry

function addResolved({ gameId, name, slug, url, sampleCount, source }) {
  if (!gameId) return;
  const existing = games.get(gameId);
  if (existing) {
    existing.sources.push(source);
    if (sampleCount != null && existing.sampleCount == null) existing.sampleCount = sampleCount;
    return;
  }
  games.set(gameId, { gameId, name, slug: slug ?? null, url, sampleCount: sampleCount ?? null, sources: [source] });
}
function addNameOnly(name, source) {
  const key = name.trim().toLowerCase();
  const existing = nameOnly.get(key);
  if (existing) {
    existing.sources.push(source);
    return;
  }
  nameOnly.set(key, { name: name.trim(), sources: [source] });
}

// --- 1. Single-game page parser output (parsed/*.json) ---
for (const file of await listJsonFiles(path.join(here, 'parsed'))) {
  const d = await readJsonSafe(file);
  if (!d || !d.game) continue;
  const label = `game-page:${d._meta?.sourceFile ?? path.basename(file)}`;
  addResolved({ gameId: d.game.gameId, name: d.game.name, slug: d.game.slug, url: d.game.canonicalUrl, sampleCount: d.sampleSummary?.totalSamples, source: label });
  for (const rg of d.relatedGamePages?.games ?? []) {
    addResolved({ gameId: rg.gameId, name: rg.title, url: rg.url, source: `${label}:relatedGamePages` });
  }
}

// --- 2. Search/hub page parser output (homepage/parsed/*.json) ---
for (const file of await listJsonFiles(path.join(here, 'homepage', 'parsed'))) {
  const d = await readJsonSafe(file);
  if (!d) continue;
  const label = `homepage:${d._meta?.sourceFile ?? path.basename(file)}`;
  for (const g of d.searchResultGames ?? []) {
    addResolved({ gameId: g.gameId, name: g.name, slug: g.slug, url: g.url, sampleCount: g.sampleCount, source: `${label}:searchResultGames` });
  }
  for (const g of d.carouselGames ?? []) {
    addResolved({ gameId: g.gameId, name: g.name, slug: g.slug, url: g.url, source: `${label}:carouselGames` });
  }
  for (const name of d.autocompleteCatalog?.fpsEstimatesGameNames ?? []) {
    addNameOnly(name, `${label}:autocompleteCatalog`);
  }
}

// A name-only entry is redundant if a resolved entry already has the same
// (or a matching) name — drop it from nameOnly rather than double-count.
const resolvedNameKeys = new Set([...games.values()].map((g) => g.name.trim().toLowerCase()));
for (const key of [...nameOnly.keys()]) {
  if (resolvedNameKeys.has(key)) nameOnly.delete(key);
  // Loose match: "Counter-Strike: Global Offensive" (resolved) vs
  // "Counter-Strike  Global Offensive" (autocomplete, punctuation-stripped)
  const loose = key.replace(/[^a-z0-9]+/g, ' ').trim();
  for (const rk of resolvedNameKeys) {
    if (rk.replace(/[^a-z0-9]+/g, ' ').trim() === loose) {
      nameOnly.delete(key);
      break;
    }
  }
}

const resolved = [...games.values()].sort((a, b) => a.name.localeCompare(b.name));
const unresolved = [...nameOnly.values()].sort((a, b) => a.name.localeCompare(b.name));

const output = {
  generatedAt: new Date().toISOString(),
  note: 'RESEARCH DATA — merged from every locally saved UserBenchmark source parsed so far in this directory tree (parsed/*.json and homepage/parsed/*.json). No network request was made. Re-run after adding/parsing new sources to refresh.',
  summary: {
    resolvedCount: resolved.length,
    nameOnlyCount: unresolved.length,
    totalDistinctGamesKnown: resolved.length + unresolved.length,
  },
  resolved,
  nameOnly: unresolved,
  howToResolveMore: [
    'Save the specific game\'s own FPS-Estimates page (as done for Fortnite) — that resolves one name-only entry to a full id/url/sample-count record.',
    'Save the AJAX response the "308 MORE »" button on the search page triggers, if it can be captured manually (e.g. via browser devtools Network tab) — that could resolve many at once. This tool cannot trigger that request itself.',
    'Search the site for a specific name-only game by hand and save that search result page.',
  ],
};

await fs.writeFile(outFile, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${outFile}`);
console.log(`${resolved.length} resolved (id+url), ${unresolved.length} name-only, ${resolved.length + unresolved.length} total distinct games known.`);
