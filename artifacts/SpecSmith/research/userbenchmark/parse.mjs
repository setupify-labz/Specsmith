// Research-only tool: extracts structured data from LOCALLY SAVED
// UserBenchmark "FPS Estimates" page sources. It never fetches anything —
// it only reads .html/.htm/.xhtml/.txt files already sitting in
// research/userbenchmark/pages/, which a human saved there themselves
// (View Source / Save Page As, or a manual copy/paste). There is no
// network code anywhere in this file.
//
// Run with:
//   node research/userbenchmark/parse.mjs              (parses every file in pages/)
//   node research/userbenchmark/parse.mjs <filename>    (parses just one file)
//
// Output: one JSON file per source under research/userbenchmark/parsed/,
// plus an index.json summarizing all of them. Nothing here touches
// src/data/ or any production file — this is a standalone reference tool.
//
// Zero new dependencies: parsing is done with targeted regexes against the
// specific markup UserBenchmark's FPS-Estimates template uses (confirmed
// against a real saved page — see pages/FPS-Estimates-Fortnite-3954.html),
// not a general HTML parser. If a future saved page uses different
// markup, extraction for that section will come back null/empty and get
// flagged in `warnings` rather than silently guessing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, 'pages');
const outDir = path.join(here, 'parsed');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
function parseIntLoose(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,x]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function parsePercent(s) {
  if (s == null) return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
/** Parses a UserBenchmark filter-path segment string like "153864.0.0.0.0"
 * into its 5 positional slots. Position meaning, per observed samples:
 * [0]=gpuId, [1]=cpuId, [2]=resolution filter, [3]=settings filter,
 * [4]=cpu-family text filter (e.g. "i9", "Ryzen") when non-numeric.
 * Positions 2/3's exact encoding isn't confirmed anywhere on the page
 * itself, so they're kept as raw strings, not reinterpreted. */
function parseFilterSegments(pathTail) {
  const parts = pathTail.split('.');
  return {
    raw: pathTail,
    gpuId: parts[0] && parts[0] !== '0' ? parts[0] : null,
    cpuId: parts[1] && parts[1] !== '0' ? parts[1] : null,
    resolutionFilter: parts[2] && parts[2] !== '0' ? parts[2] : null,
    settingsFilter: parts[3] && parts[3] !== '0' ? parts[3] : null,
    cpuFamilyFilter: parts[4] && parts[4] !== '0' ? parts[4] : null,
  };
}

// ---------------------------------------------------------------------------
// Section extractors — each returns { value, warnings[] }
// ---------------------------------------------------------------------------
function extractGameIdentity(html) {
  const warnings = [];
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  const canonicalUrl = canonicalMatch ? decodeEntities(canonicalMatch[1]) : null;
  if (!canonicalUrl) warnings.push('No canonical URL found — cannot confirm gameId/slug.');

  let gameId = null;
  let slug = null;
  let filterSegments = null;
  if (canonicalUrl) {
    // https://www.userbenchmark.com/PCGame/FPS-Estimates-<slug>/<gameId>/<filterPath>
    const m = canonicalUrl.match(/\/PCGame\/FPS-Estimates-([^/]+)\/(\d+)\/([0-9a-zA-Z.]+)/);
    if (m) {
      slug = m[1];
      gameId = m[2];
      filterSegments = parseFilterSegments(m[3]);
    } else {
      warnings.push(`Canonical URL didn't match the expected /PCGame/FPS-Estimates-<slug>/<id>/<filters> shape: ${canonicalUrl}`);
    }
  }

  const h1Match = html.match(/<h1 class="pg-head-title">\s*<a[^>]*>([^<]+)<\/a>/);
  const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
  const titleTagMatch = html.match(/<title>([^<]*)<\/title>/);
  const name =
    (h1Match && decodeEntities(h1Match[1])) ||
    (ogTitleMatch && decodeEntities(ogTitleMatch[1]).replace(/^UserBenchmark:\s*Can I Run\s*/i, '').trim()) ||
    (titleTagMatch && decodeEntities(titleTagMatch[1]).replace(/^UserBenchmark:\s*Can I Run\s*/i, '').trim()) ||
    null;
  if (!name) warnings.push('No game name found in <h1 class="pg-head-title">, og:title, or <title>.');

  return { value: { gameId, slug, name, canonicalUrl, filterSegments }, warnings };
}

function extractSampleSummary(html) {
  const warnings = [];
  const m = html.match(/Average Fps:\s*(\d+)\s*<span class="mutedtext">\s*([\d,]+)\s*samples<\/span>/);
  if (!m) {
    warnings.push('No "Average Fps: N ... samples" block found.');
    return { value: { averageFps: null, totalSamples: null }, warnings };
  }
  return { value: { averageFps: Number(m[1]), totalSamples: parseIntLoose(m[2]) }, warnings };
}

/** Pulls the `labels: [...]` and the array-valued `data: [...]` (not the
 * object-valued `data: {...}`) out of the `new Chart(document.getElementById("<elementId>")...)`
 * block for a given canvas element id. Chart.js config blocks in this
 * template run well under 3000 chars from the getElementById call to the
 * closing `});`, so a bounded window keeps this from accidentally reading
 * into an unrelated later chart. */
function extractChart(html, elementId) {
  const warnings = [];
  const anchor = `getElementById("${elementId}")`;
  const idx = html.indexOf(anchor);
  if (idx === -1) {
    warnings.push(`No Chart.js block found for #${elementId}.`);
    return { value: { labels: [], data: [] }, warnings };
  }
  const window_ = html.slice(idx, idx + 3000);
  const labelsMatch = window_.match(/labels:\s*\[([^\]]*)\]/);
  const dataMatch = window_.match(/data:\s*\[([^\]]*)\]/);
  if (!labelsMatch) warnings.push(`#${elementId}: found the chart but no "labels: [...]" array.`);
  if (!dataMatch) warnings.push(`#${elementId}: found the chart but no "data: [...]" array.`);

  const parseArrayLiteral = (raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const unquoted = s.replace(/^["']|["']$/g, '');
        const asNum = Number(unquoted);
        return unquoted !== '' && Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(unquoted) ? asNum : unquoted;
      });

  return {
    value: {
      labels: labelsMatch ? parseArrayLiteral(labelsMatch[1]) : [],
      data: dataMatch ? parseArrayLiteral(dataMatch[1]) : [],
    },
    warnings,
  };
}

/** Matches every `<tr>` in the GPU/Choose-CPU tables. Rows are classified
 * as gpu/cpu by which domain their "Bench" link points at
 * (gpu.userbenchmark.com vs cpu.userbenchmark.com) rather than by which
 * literal table they're in — more robust if heading text ever changes. */
function extractComponentTables(html) {
  const warnings = [];
  const rowRe =
    /<tr>\s*<td style='padding:0;text-align:left'>\s*<a[^>]*href='([^']+)'[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>\s*(?:<a class='bglink' href='([^']+)'>([^<]*)<\/a>)?\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;

  const gpuRows = [];
  const cpuRows = [];
  const unclassified = [];
  let match;
  let rowCount = 0;
  while ((match = rowRe.exec(html)) !== null) {
    rowCount++;
    const [, gameFilterHref, name, samplesRaw, benchHref, benchRaw, valueRaw, priceCell] = match;

    let price = null;
    let priceUrl = null;
    let priceStore = null;
    const priceMatch = priceCell.match(/href='([^']+)'[^>]*title='Live (\w+) price'[\s\S]*?\$([\d,.]+)/);
    if (priceMatch) {
      priceUrl = decodeEntities(priceMatch[1]);
      priceStore = priceMatch[2];
      price = Number(priceMatch[3].replace(/,/g, ''));
    }

    const decodedGameFilterUrl = decodeEntities(gameFilterHref);
    const filterPathMatch = decodedGameFilterUrl.match(/\/PCGame\/FPS-Estimates-[^/]+\/\d+\/([0-9a-zA-Z.]+)$/);

    const row = {
      name: decodeEntities(name),
      samples: parseIntLoose(samplesRaw),
      benchPercent: parsePercent(benchRaw),
      valuePercent: parsePercent(valueRaw),
      priceUsd: price,
      priceStore,
      priceUrl,
      gameFilterUrl: decodedGameFilterUrl,
      filterSegments: filterPathMatch ? parseFilterSegments(filterPathMatch[1]) : null,
      componentPageUrl: benchHref ? decodeEntities(benchHref) : null,
    };

    if (benchHref && benchHref.includes('gpu.userbenchmark.com')) gpuRows.push(row);
    else if (benchHref && benchHref.includes('cpu.userbenchmark.com')) cpuRows.push(row);
    else unclassified.push(row);
  }
  if (rowCount === 0) warnings.push('No GPU/CPU table rows matched at all — page markup may differ from the expected template.');
  if (unclassified.length > 0) warnings.push(`${unclassified.length} table row(s) couldn't be classified as GPU or CPU (bench link didn't point at gpu.userbenchmark.com or cpu.userbenchmark.com) — see "unclassified".`);

  return { value: { gpuTable: gpuRows, cpuTable: cpuRows, unclassified }, warnings };
}

/** The small quick-filter buttons (e.g. i9/i7/i5/i3/Pentium/Ryzen/FX/Athlon
 * for CPU family, and — on pages that have them — GPU vendor buttons).
 * Generic enough to catch any btn-*-3d filter button, not hardcoded to the
 * specific brand set seen in the one sample page this was built against. */
function extractBrandFilters(html) {
  const re = /<a href="([^"]*\/PCGame\/FPS-Estimates-[^"]+)" class="btn btn-[\w-]+-3d[^"]*">([^<]+)<\/a>/g;
  const filters = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    filters.push({ label: decodeEntities(m[2]), url: decodeEntities(m[1]) });
  }
  return { value: filters, warnings: [] };
}

/** The horizontal strip of other "FPS Estimates" games shown on every game
 * page. These are DISCOVERED, NOT FETCHED — recording a URL here is not a
 * crawl step. A human decides whether to go save any of them. */
function extractRelatedGamePages(html, excludeGameId) {
  const re = /<a class="btn btn-default[^"]*" href="(https:\/\/www\.userbenchmark\.com\/PCGame\/FPS-Estimates-[^"]+\/(\d+)\/[0-9.]+)" title="([^"]+)"/g;
  const related = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, url, gameId, title] = m;
    if (gameId === excludeGameId) continue;
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    related.push({ gameId, title: decodeEntities(title), url: decodeEntities(url) });
  }
  return { value: related, warnings: [] };
}

// ---------------------------------------------------------------------------
// Top-level parse
// ---------------------------------------------------------------------------
function parsePage(html, sourceFile) {
  const warnings = [];
  const identity = extractGameIdentity(html);
  warnings.push(...identity.warnings);
  const summary = extractSampleSummary(html);
  warnings.push(...summary.warnings);
  const fpsHistogram = extractChart(html, 'fpsBarChartHisto');
  warnings.push(...fpsHistogram.warnings.map((w) => `[fpsHistogram] ${w}`));
  const settingsDistribution = extractChart(html, 'settingsPieChart');
  warnings.push(...settingsDistribution.warnings.map((w) => `[settingsDistribution] ${w}`));
  const resolutionDistribution = extractChart(html, 'resolutionsPieChartHisto');
  warnings.push(...resolutionDistribution.warnings.map((w) => `[resolutionDistribution] ${w}`));
  const tables = extractComponentTables(html);
  warnings.push(...tables.warnings);
  const brandFilters = extractBrandFilters(html);
  const relatedGamePages = extractRelatedGamePages(html, identity.value.gameId);

  return {
    _meta: {
      sourceFile,
      parsedAt: new Date().toISOString(),
      parserNote: 'RESEARCH DATA — extracted from a locally saved UserBenchmark page source. Not fetched by this tool. Not a BenchmarkRecord; do not add to src/data/ without independently re-verifying against the schema\'s provenance rules.',
      warnings,
    },
    game: identity.value,
    sampleSummary: summary.value,
    fpsHistogram: {
      description: 'X-axis buckets are FPS values (labels), Y-axis is sample count per bucket (data) — a coarse-grained noisy sample distribution, not a smooth curve.',
      ...fpsHistogram.value,
    },
    settingsDistribution: {
      description: 'How many samples were reported at each in-game quality preset.',
      ...settingsDistribution.value,
    },
    resolutionDistribution: {
      description: 'How many samples were reported at each display resolution.',
      ...resolutionDistribution.value,
    },
    gpuTable: tables.value.gpuTable,
    cpuTable: tables.value.cpuTable,
    unclassifiedTableRows: tables.value.unclassified,
    brandFilterUrls: brandFilters.value,
    relatedGamePages: {
      note: 'Discovered on this page, NOT fetched by this tool. A human must explicitly go save any of these before they can be parsed.',
      games: relatedGamePages.value,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const arg = process.argv[2];
  await fs.mkdir(outDir, { recursive: true });

  let files;
  try {
    files = (await fs.readdir(pagesDir)).filter((f) => /\.(html?|xhtml|txt)$/i.test(f));
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
    const parsed = parsePage(html, file);
    const outName = `${(parsed.game.slug || path.basename(file, path.extname(file))).replace(/[^a-zA-Z0-9-]/g, '-')}.json`;
    await fs.writeFile(path.join(outDir, outName), JSON.stringify(parsed, null, 2) + '\n');
    results.push({ sourceFile: file, outputFile: outName, ...parsed.game, averageFps: parsed.sampleSummary.averageFps, totalSamples: parsed.sampleSummary.totalSamples, gpuRows: parsed.gpuTable.length, cpuRows: parsed.cpuTable.length, warningCount: parsed._meta.warnings.length });
    console.log(`Parsed ${file} -> ${outName} (${parsed.gpuTable.length} GPU rows, ${parsed.cpuTable.length} CPU rows, ${parsed._meta.warnings.length} warning(s))`);
  }

  await fs.writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), note: 'Index of all parsed UserBenchmark page sources. Research data only.', pages: results }, null, 2) + '\n',
  );
  console.log(`Wrote index.json (${results.length} page(s)).`);
}

await main();
