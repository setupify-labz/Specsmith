// Research-only integrity audit for the 316-game UserBenchmark catalog.
//
// This does NOT fetch anything. It cross-checks the locally captured search
// pages, the consolidated known-games.json, and the capture manifest so a
// stale/mutated catalog cannot quietly become the capture plan.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const homepageParsedDir = path.join(here, 'homepage', 'parsed');
const knownGamesPath = path.join(here, 'known-games.json');
const manifestPath = path.join(here, 'capture-manifest.json');

export function auditCatalog({ knownGames, homepagePages, manifest }) {
  const issues = [];
  const resolved = knownGames?.resolved ?? [];

  if (knownGames?.summary?.resolvedCount !== resolved.length) {
    issues.push(`known-games summary resolvedCount=${knownGames?.summary?.resolvedCount} but resolved has ${resolved.length} entries`);
  }
  if (knownGames?.summary?.nameOnlyCount !== 0) {
    issues.push(`known-games still contains ${knownGames?.summary?.nameOnlyCount} name-only entries`);
  }
  if (knownGames?.summary?.nonGameHitsCount !== 1) {
    issues.push(`expected exactly 1 non-game search hit, found ${knownGames?.summary?.nonGameHitsCount}`);
  }

  const ids = new Set();
  for (const g of resolved) {
    if (!/^\d+$/.test(String(g.gameId ?? ''))) issues.push(`non-numeric gameId: ${g.gameId}`);
    if (ids.has(g.gameId)) issues.push(`duplicate gameId: ${g.gameId}`);
    ids.add(g.gameId);
    if (!g.name) issues.push(`game ${g.gameId} has no name`);
    if (!g.url?.startsWith('https://www.userbenchmark.com/PCGame/FPS-Estimates-')) {
      issues.push(`game ${g.gameId} has non-canonical URL: ${g.url}`);
    }
    const idMatch = g.url?.match(/\/PCGame\/FPS-Estimates-[^/]+\/(\d+)\/([0-9a-zA-Z.]+)$/);
    if (!idMatch) issues.push(`game ${g.gameId} URL does not match the expected catalog shape: ${g.url}`);
    else if (idMatch[1] !== String(g.gameId)) issues.push(`game ${g.gameId} URL contains id ${idMatch[1]}`);
    if (g.caption && !/^FPS Estimates/.test(g.caption)) issues.push(`game ${g.gameId} has unexpected caption: ${g.caption}`);
    if (g.sampleCount != null && (!Number.isInteger(g.sampleCount) || g.sampleCount < 0)) {
      issues.push(`game ${g.gameId} has invalid sampleCount: ${g.sampleCount}`);
    }
    if (!Array.isArray(g.sources) || g.sources.length === 0) issues.push(`game ${g.gameId} has no provenance sources`);
  }

  const searchGames = [];
  for (const page of homepagePages) {
    for (const game of page?.searchResultGames ?? []) searchGames.push(game);
  }
  const searchIds = new Set(searchGames.map((g) => String(g.gameId)).filter(Boolean));
  if (searchIds.size !== 316) issues.push(`search pagination resolves to ${searchIds.size} unique game ids, expected 316`);
  if (searchGames.length < searchIds.size) issues.push('search pagination contains fewer rows than unique ids');

  for (const id of searchIds) {
    if (!ids.has(id)) issues.push(`search result game ${id} is missing from known-games.json`);
  }
  for (const id of ids) {
    if (!searchIds.has(id)) issues.push(`known game ${id} is absent from the saved search corpus`);
  }

  if (manifest) {
    const rows = manifest.rows ?? [];
    if (manifest.summary?.totalKnownGames !== resolved.length) {
      issues.push(`capture manifest totalKnownGames=${manifest.summary?.totalKnownGames} but catalog has ${resolved.length}`);
    }
    const manifestIds = new Set(rows.map((r) => String(r.gameId)));
    if (manifestIds.size !== rows.length) issues.push('capture manifest contains duplicate game ids');
    for (const id of ids) if (!manifestIds.has(id)) issues.push(`capture manifest missing catalog game ${id}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      knownGames: resolved.length,
      searchResultUniqueGames: searchIds.size,
      manifestRows: manifest?.rows?.length ?? null,
    },
  };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

async function main() {
  const knownGames = await readJson(knownGamesPath);
  const manifest = await readJson(manifestPath);
  const names = ['Search-FPS-page1-ajax.json', 'Search-FPS-page2-ajax.json', 'Search-FPS-page3-ajax.json', 'Search-FPS-page4-ajax.json'];
  const homepagePages = await Promise.all(names.map((name) => readJson(path.join(homepageParsedDir, name))));
  const result = auditCatalog({ knownGames, homepagePages, manifest });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
