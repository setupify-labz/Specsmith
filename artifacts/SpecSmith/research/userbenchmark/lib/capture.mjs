// Capture-status tracking across the known 316-game catalog.
//
// RESEARCH-ONLY. This module does NOT and CANNOT acquire pages. It reads
// known-games.json plus whatever sources a human has already saved into
// pages/, and reports exactly which games are captured and which are not.
//
// WHY THERE IS NO FETCHER HERE
// ----------------------------
// Automatic page acquisition is deliberately not implemented:
//   1. userbenchmark.com is unreachable from this environment — the egress
//      proxy refuses CONNECT for that host (verified: HTTP 403 on the
//      tunnel). Nothing here could fetch it even if it were appropriate.
//   2. Walking a 316-URL catalog on an aggregator's own site is bulk
//      collection of their proprietary aggregated database, regardless of
//      rate limiting or robots handling. That is out of scope by the
//      project's own rules.
//
// So the capture side is built as a MANIFEST: it makes the missing-source
// problem mechanical (a precise, per-game to-do list with exact URLs and
// exact expected filenames) rather than manual bookkeeping. A human decides
// what to save; this tool tracks what has and hasn't arrived, and never
// reports an uncaptured page as collected.

import { parseFilterSegments } from './html.mjs';

/** Filename convention: `FPS-Estimates-<slug>-<gameId>.html`. Deterministic,
 * so the manifest can state the exact filename to save each missing page as,
 * and so a saved file can be matched to its game before it is even parsed. */
export function expectedFilename(game) {
  const slug = (game.slug || game.name || 'game').replace(/[^A-Za-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `FPS-Estimates-${slug}-${game.gameId}.html`;
}

/**
 * Builds the capture manifest.
 *
 * @param {object[]} knownGames   `resolved` entries from known-games.json
 * @param {object[]} parsedPages  results of parseGamePage() for saved sources
 * @param {string[]} savedFiles   filenames present in pages/
 */
export function buildCaptureManifest(knownGames, parsedPages, savedFiles) {
  // gameId -> parsed page (only pages that actually parsed as a game page)
  const parsedByGameId = new Map();
  for (const p of parsedPages) {
    if (p._meta.parsedSuccessfully && p.game?.gameId) parsedByGameId.set(p.game.gameId, p);
  }
  // A saved file whose name follows the convention counts as "captured" even
  // if parsing then failed — captured and parsed are tracked separately, so a
  // broken save stays visible instead of looking like a missing page.
  //
  // The filename pattern is deliberately strict (`FPS-Estimates-<slug>-<id>`),
  // not a loose "trailing number" match: an unrelated file such as
  // `notes-2024.html` must never be read as evidence that game 2024 was
  // captured. Claiming an uncaptured page was collected is the one failure
  // mode this whole module exists to prevent.
  const savedByGameId = new Map();
  for (const f of savedFiles) {
    const m = f.match(/^FPS-Estimates-.+-(\d+)\.[A-Za-z]+$/);
    if (m) savedByGameId.set(m[1], f);
  }
  // A successful parse is authoritative — it beats any filename guess.
  for (const p of parsedPages) {
    if (p.game?.gameId) savedByGameId.set(p.game.gameId, p._meta.sourceFile);
  }

  const rows = knownGames.map((g) => {
    const parsed = parsedByGameId.get(g.gameId) ?? null;
    const sourceFile = parsed?._meta.sourceFile ?? savedByGameId.get(g.gameId) ?? null;
    const captured = sourceFile != null;
    return {
      gameId: g.gameId,
      name: g.name,
      url: g.url,
      captured,
      sourceFile,
      expectedFilename: expectedFilename(g),
      parsed: parsed != null,
      efpsCount: parsed?.efps?.stats?.accepted ?? 0,
      efpsDirectCount: parsed?.efps?.stats?.direct ?? 0,
      efpsComparisonCount: parsed?.efps?.stats?.comparisons ?? 0,
      gpuRowCount: parsed?.gpuTable?.length ?? 0,
      cpuRowCount: parsed?.cpuTable?.length ?? 0,
      averageFps: parsed?.sampleSummary?.averageFps ?? null,
      totalSamples: parsed?.sampleSummary?.totalSamples ?? null,
      warnings: parsed?._meta?.warnings ?? [],
      warningCount: parsed?._meta?.warnings?.length ?? 0,
      // Deliberately the source content hash, not a processing timestamp: the
      // manifest is committed, and a wall-clock field would dirty every row on
      // every run, burying real changes in noise.
      sourceContentSha256: parsed?._meta?.sourceContentSha256 ?? null,
    };
  });

  // Saved sources that parsed as a game page but aren't in known-games.json.
  const knownIds = new Set(knownGames.map((g) => g.gameId));
  const unlisted = [...parsedByGameId.values()]
    .filter((p) => !knownIds.has(p.game.gameId))
    .map((p) => ({
      gameId: p.game.gameId,
      name: p.game.name,
      sourceFile: p._meta.sourceFile,
      note: 'Saved source parsed as a game page but its gameId is not in known-games.json — catalog may be stale.',
    }));

  const captured = rows.filter((r) => r.captured);
  const parsedRows = rows.filter((r) => r.parsed);
  return {
    rows,
    unlisted,
    summary: {
      totalKnownGames: rows.length,
      captured: captured.length,
      notCaptured: rows.length - captured.length,
      parsed: parsedRows.length,
      capturedButNotParsed: captured.length - parsedRows.length,
      unlistedSavedGames: unlisted.length,
      capturePercent: rows.length ? Number(((captured.length / rows.length) * 100).toFixed(2)) : 0,
    },
  };
}

/** Verifies a game URL is the canonical, unfiltered form before it is put in
 * front of a human as something to save. */
export function checkCatalogUrl(url) {
  const m = String(url ?? '').match(/^https:\/\/www\.userbenchmark\.com\/PCGame\/FPS-Estimates-([^/]+)\/(\d+)\/([0-9a-zA-Z.]+)$/);
  if (!m) return { ok: false, reason: 'does not match the canonical /PCGame/FPS-Estimates-<slug>/<id>/<filters> shape' };
  const seg = parseFilterSegments(m[3]);
  const filtered = seg.gpuId || seg.cpuId || seg.cpuFamilyFilter || seg.position2 || seg.position3;
  return filtered
    ? { ok: false, reason: `URL carries an active filter path (${seg.raw}); the unfiltered 0.0.0.0.0 form is the one to capture` }
    : { ok: true, slug: m[1], gameId: m[2] };
}
