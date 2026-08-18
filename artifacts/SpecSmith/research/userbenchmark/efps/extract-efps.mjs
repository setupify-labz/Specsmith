// Research-only extractor for the EFPS Select2 dataset embedded in saved
// UserBenchmark FPS-Estimates pages. It reads local files only; no network.
//
// Usage:
//   node artifacts/SpecSmith/research/userbenchmark/efps/extract-efps.mjs <saved-page.html>
//
// The page embeds objects shaped like:
//   { id: 'https://www.userbenchmark.com/EFps/...', t: 'PUBG 3600 2060S', p: '119' }
//
// We preserve the exact title, URL and FPS value. We also expose the raw
// comma/underscore URL payload so a later, separately-validated decoder can
// map CPU/GPU/configuration components. This script deliberately does NOT
// invent that mapping.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'parsed');

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function parseEfpsUrl(url) {
  const decoded = decodeEntities(url);
  const payload = decoded.split('/').at(-1) ?? '';
  const pieces = payload.split('_');
  const left = pieces[0] ?? '';
  const right = pieces.slice(1).join('_');
  return {
    raw: decoded,
    payload,
    left,
    right,
    leftTokens: left.split(',').filter(Boolean),
    rightTokens: right.split(',').filter(Boolean),
  };
}

function extractGameIdentity(html) {
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? null;
  const m = canonical?.match(/\/PCGame\/FPS-Estimates-([^/]+)\/(\d+)\//i);
  return {
    name: html.match(/<h1 class="pg-head-title">\s*<a[^>]*>([^<]+)<\/a>/i)?.[1]
      ? decodeEntities(html.match(/<h1 class="pg-head-title">\s*<a[^>]*>([^<]+)<\/a>/i)[1])
      : null,
    gameId: m?.[2] ?? null,
    slug: m?.[1] ?? null,
    canonicalUrl: canonical ? decodeEntities(canonical) : null,
  };
}

function classify(title, gameName) {
  const suffix = gameName && title.toLowerCase().startsWith(`${gameName.toLowerCase()} `)
    ? title.slice(gameName.length + 1)
    : title;
  return /\s+vs\s+/i.test(suffix) ? 'comparison' : 'single';
}

function extractEfps(html, game) {
  const records = [];
  const seen = new Set();
  const re = /\{\s*id:\s*'([^']+)'\s*,\s*t:\s*'([^']+)'\s*,\s*p:\s*'([^']*)'\s*\}/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const [, idRaw, titleRaw, fpsRaw] = match;
    const fps = Number(fpsRaw);
    if (!Number.isFinite(fps)) continue;
    const id = decodeEntities(idRaw);
    const title = decodeEntities(titleRaw);
    const key = `${id}|${title}|${fps}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      gameId: game.gameId,
      game: game.name,
      title,
      fps,
      url: id,
      type: classify(title, game.name),
      urlParts: parseEfpsUrl(id),
    });
  }
  return records;
}

async function parseFile(filePath) {
  const html = await fs.readFile(filePath, 'utf8');
  const game = extractGameIdentity(html);
  const records = extractEfps(html, game);
  const warnings = [];
  if (!game.gameId) warnings.push('Could not identify a gameId from the canonical URL.');
  if (!records.length) warnings.push('No EFPS Select2 result objects matched the expected {id,t,p} shape.');
  return {
    _meta: {
      sourceFile: path.basename(filePath),
      parsedAt: new Date().toISOString(),
      parser: 'research/userbenchmark/efps/extract-efps.mjs',
      researchOnly: true,
      warnings,
    },
    game,
    counts: {
      total: records.length,
      single: records.filter((r) => r.type === 'single').length,
      comparison: records.filter((r) => r.type === 'comparison').length,
    },
    records,
  };
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node extract-efps.mjs <saved-page.html>');
  const result = await parseFile(input);
  await fs.mkdir(outDir, { recursive: true });
  const slug = result.game.slug || path.basename(input, path.extname(input));
  const output = path.join(outDir, `${slug || 'unknown'}.json`);
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...result.counts, warnings: result._meta.warnings }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
