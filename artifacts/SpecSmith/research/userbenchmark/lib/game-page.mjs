// Full extraction of a locally saved UserBenchmark "FPS Estimates" game page.
//
// RESEARCH-ONLY. Pure function over a string a human already saved. No
// network code, no file I/O in this module.
//
// This is the extraction core originally developed in ../parse.mjs, factored
// out so parse.mjs, ingest.mjs and the tests all share exactly one
// implementation. Behavioural changes vs. that original:
//   - filter-path positions 2/3 are no longer named "resolutionFilter"/
//     "settingsFilter"; those meanings were never proven (see
//     efps/configuration-analysis.md) and are now preserved raw as
//     position2/position3 plus an explicit unresolvedPositions list.
//   - EFPS records are extracted as a first-class section.
//   - A `sourceKind` check distinguishes a real FPS-Estimates game page from
//     some other saved file, instead of returning a hollow all-null result.

import { createHash } from 'node:crypto';

import { decodeEntities, parseIntLoose, parsePercent, parseArrayLiteral, parseFilterSegments } from './html.mjs';
import { extractEfpsRecords } from './efps.mjs';
import { PARSER_VERSION } from './version.mjs';

// ---------------------------------------------------------------------------
// Section extractors — each returns { value, warnings[] }
// ---------------------------------------------------------------------------
export function extractGameIdentity(html) {
  const warnings = [];
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  const canonicalUrl = canonicalMatch ? decodeEntities(canonicalMatch[1]) : null;
  if (!canonicalUrl) warnings.push('No canonical URL found — cannot confirm gameId/slug.');

  let gameId = null;
  let slug = null;
  let filterSegments = null;
  if (canonicalUrl) {
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
  const strip = (s) => decodeEntities(s).replace(/^UserBenchmark:\s*Can I Run\s*/i, '').trim();
  const name =
    (h1Match && decodeEntities(h1Match[1])) ||
    (ogTitleMatch && strip(ogTitleMatch[1])) ||
    (titleTagMatch && strip(titleTagMatch[1])) ||
    null;
  if (!name) warnings.push('No game name found in <h1 class="pg-head-title">, og:title, or <title>.');

  return { value: { gameId, slug, name, canonicalUrl, filterSegments }, warnings };
}

/** Average FPS may be an integer or a decimal — Counter-Strike: Global
 * Offensive publishes `153`, PlayerUnknown's Battlegrounds publishes `75.5`.
 * The value is captured verbatim and never rounded: `75.5` stays `75.5`.
 *
 * The separator before `<span>` is a pair of non-breaking spaces (U+00A0) in
 * the real markup; JavaScript's `\s` already covers those. */
export function extractSampleSummary(html) {
  const warnings = [];
  const m = html.match(/Average Fps:\s*(\d+(?:\.\d+)?)\s*<span class="mutedtext">\s*([\d,]+)\s*samples<\/span>/);
  if (!m) {
    warnings.push('No "Average Fps: N ... samples" block found.');
    return { value: { averageFps: null, totalSamples: null }, warnings };
  }
  return { value: { averageFps: Number(m[1]), totalSamples: parseIntLoose(m[2]) }, warnings };
}

/** Pulls `labels: [...]` and the ARRAY-valued `data: [...]` out of the
 * Chart.js config for a canvas id. The `\[` immediately after the colon is
 * what distinguishes the dataset's array from the outer config's
 * `data: {...}` object. A bounded window keeps this from reading into a later
 * chart.
 *
 * Whitespace before the colon is optional because the real markup is
 * inconsistent WITHIN A SINGLE PAGE: the Counter-Strike source writes
 * `labels:` for the FPS histogram but `labels :` for the settings and
 * resolution pie charts. Requiring no space silently returned empty arrays for
 * those two charts on both newly captured pages. */
export function extractChart(html, elementId) {
  const warnings = [];
  const idx = html.indexOf(`getElementById("${elementId}")`);
  if (idx === -1) {
    warnings.push(`No Chart.js block found for #${elementId}.`);
    return { value: { labels: [], data: [] }, warnings };
  }
  const window_ = html.slice(idx, idx + 3000);
  const labelsMatch = window_.match(/labels\s*:\s*\[([^\]]*)\]/);
  const dataMatch = window_.match(/data\s*:\s*\[([^\]]*)\]/);
  if (!labelsMatch) warnings.push(`#${elementId}: found the chart but no "labels: [...]" array.`);
  if (!dataMatch) warnings.push(`#${elementId}: found the chart but no "data: [...]" array.`);
  const labels = labelsMatch ? parseArrayLiteral(labelsMatch[1]) : [];
  const data = dataMatch ? parseArrayLiteral(dataMatch[1]) : [];
  if (labels.length > 0 && data.length > 0 && labels.length !== data.length) {
    warnings.push(`#${elementId}: labels (${labels.length}) and data (${data.length}) lengths differ — chart may be misaligned.`);
  }
  return { value: { labels, data, rawLabels: labelsMatch ? labelsMatch[1] : null, rawData: dataMatch ? dataMatch[1] : null }, warnings };
}

/** Every `<tr>` in the GPU/CPU tables. Rows are classified by which domain
 * their "Bench" link points at, not by table position. */
export function extractComponentTables(html) {
  const warnings = [];
  const rowRe =
    /<tr>\s*<td style='padding:0;text-align:left'>\s*<a[^>]*href='([^']+)'[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>\s*(?:<a class='bglink' href='([^']+)'>([^<]*)<\/a>)?\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;

  const gpuRows = [];
  const cpuRows = [];
  const unclassified = [];
  let match;
  let rowCount = 0;
  rowRe.lastIndex = 0;
  while ((match = rowRe.exec(html)) !== null) {
    rowCount++;
    const [, gameFilterHref, name, samplesRaw, benchHref, benchRaw, valueRaw, priceCell] = match;

    let priceUsd = null;
    let priceUrl = null;
    let priceStore = null;
    const priceMatch = priceCell.match(/href='([^']+)'[^>]*title='Live (\w+) price'[\s\S]*?\$([\d,.]+)/);
    if (priceMatch) {
      priceUrl = decodeEntities(priceMatch[1]);
      priceStore = priceMatch[2];
      priceUsd = Number(priceMatch[3].replace(/,/g, ''));
    }

    const decodedGameFilterUrl = decodeEntities(gameFilterHref);
    const filterPathMatch = decodedGameFilterUrl.match(/\/PCGame\/FPS-Estimates-[^/]+\/\d+\/([0-9a-zA-Z.]+)$/);
    const componentIdMatch = benchHref ? benchHref.match(/\/Rating\/(\d+)/) : null;

    const row = {
      name: decodeEntities(name),
      samples: parseIntLoose(samplesRaw),
      benchPercent: parsePercent(benchRaw),
      valuePercent: parsePercent(valueRaw),
      priceUsd,
      priceStore,
      priceUrl,
      gameFilterUrl: decodedGameFilterUrl,
      filterSegments: filterPathMatch ? parseFilterSegments(filterPathMatch[1]) : null,
      componentPageUrl: benchHref ? decodeEntities(benchHref) : null,
      componentRatingId: componentIdMatch ? componentIdMatch[1] : null,
    };

    if (benchHref && benchHref.includes('gpu.userbenchmark.com')) gpuRows.push(row);
    else if (benchHref && benchHref.includes('cpu.userbenchmark.com')) cpuRows.push(row);
    else unclassified.push(row);
  }
  if (rowCount === 0) warnings.push('No GPU/CPU table rows matched at all — page markup may differ from the expected template.');
  if (unclassified.length > 0) {
    warnings.push(`${unclassified.length} table row(s) couldn't be classified as GPU or CPU (bench link didn't point at gpu./cpu.userbenchmark.com) — see "unclassifiedTableRows".`);
  }
  return { value: { gpuTable: gpuRows, cpuTable: cpuRows, unclassified }, warnings };
}

export function extractBrandFilters(html) {
  const re = /<a href="([^"]*\/PCGame\/FPS-Estimates-[^"]+)" class="btn btn-[\w-]+-3d[^"]*">([^<]+)<\/a>/g;
  const filters = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = decodeEntities(m[1]);
    const pathMatch = url.match(/\/PCGame\/FPS-Estimates-[^/]+\/\d+\/([0-9a-zA-Z.]+)$/);
    filters.push({ label: decodeEntities(m[2]), url, filterSegments: pathMatch ? parseFilterSegments(pathMatch[1]) : null });
  }
  return { value: filters, warnings: [] };
}

/** Other games linked from this page. DISCOVERED, NOT FETCHED — recording a
 * URL here is not a crawl step. */
export function extractRelatedGamePages(html, excludeGameId) {
  const re = /<a class="btn btn-default[^"]*" href="(https:\/\/www\.userbenchmark\.com\/PCGame\/FPS-Estimates-[^"]+\/(\d+)\/[0-9.]+)" title="([^"]+)"/g;
  const related = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, url, gameId, title] = m;
    if (gameId === excludeGameId || seen.has(gameId)) continue;
    seen.add(gameId);
    related.push({ gameId, title: decodeEntities(title), url: decodeEntities(url) });
  }
  return { value: related, warnings: [] };
}

/** Every distinct filter path this page links to for its OWN game — the raw
 * material for the filter-position analysis. */
export function extractOwnFilterPaths(html, gameId) {
  if (!gameId) return { value: [], warnings: [] };
  const re = new RegExp(`FPS-Estimates-[^/"']+/${gameId}/([0-9A-Za-z.\\-]+)`, 'g');
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) seen.add(m[1]);
  return { value: [...seen].sort().map((p) => parseFilterSegments(p)), warnings: [] };
}

// ---------------------------------------------------------------------------
// Source-kind detection
// ---------------------------------------------------------------------------
/** Decides whether a saved file actually is an FPS-Estimates game page,
 * before extraction claims anything about it. Prevents a search page or a JS
 * bundle from being silently reported as a game page with everything null. */
export function detectSourceKind(html) {
  const hasCanonicalGame = /<link rel="canonical" href="[^"]*\/PCGame\/FPS-Estimates-[^/]+\/\d+\//.test(html);
  const hasAvgFps = /Average Fps:\s*\d+/.test(html);
  if (hasCanonicalGame && hasAvgFps) return { kind: 'fps-estimates-game-page', confident: true };
  if (hasCanonicalGame) return { kind: 'fps-estimates-game-page', confident: false, note: 'canonical URL matches a game page but no "Average Fps:" block was found' };
  if (/<partial-response/.test(html)) return { kind: 'jsf-ajax-partial-response', confident: true, note: 'search-result pagination fragment, not a game page' };
  if (/searchTerm=/.test(html) && /tl-tag/.test(html)) return { kind: 'search-page', confident: true, note: 'search/hub page, not a game page' };
  return { kind: 'unknown', confident: false, note: 'no FPS-Estimates canonical URL and no recognizable alternative page shape' };
}

// ---------------------------------------------------------------------------
// Top-level parse
// ---------------------------------------------------------------------------
export function parseGamePage(html, sourceFile) {
  const warnings = [];
  const sourceKind = detectSourceKind(html);
  // Deterministic provenance anchor — pins every derived record to the exact
  // source bytes, and stays stable across re-runs (unlike a timestamp).
  const sourceContentSha256 = createHash('sha256').update(html).digest('hex');
  if (sourceKind.kind !== 'fps-estimates-game-page') {
    return {
      _meta: {
        sourceFile,
        sourceContentSha256,
        parsedAt: new Date().toISOString(),
        parserVersion: PARSER_VERSION,
        sourceKind,
        parsedSuccessfully: false,
        warnings: [`Source is not an FPS-Estimates game page (detected: ${sourceKind.kind}${sourceKind.note ? ` — ${sourceKind.note}` : ''}). No game extraction attempted.`],
      },
      game: null,
    };
  }
  if (!sourceKind.confident) warnings.push(`Source kind detected with low confidence: ${sourceKind.note}`);

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
  const ownFilterPaths = extractOwnFilterPaths(html, identity.value.gameId);

  const efps = extractEfpsRecords(html, {
    sourceFile,
    gameId: identity.value.gameId,
    gameName: identity.value.name,
    sourceUrl: identity.value.canonicalUrl,
  });
  if (efps.rejected.length > 0) warnings.push(`[efps] ${efps.rejected.length} EFPS object(s) rejected — see efps.rejected.`);
  if (efps.stats.withWarnings > 0) warnings.push(`[efps] ${efps.stats.withWarnings} EFPS record(s) carry their own warnings.`);

  return {
    _meta: {
      sourceFile,
      sourceContentSha256,
      parsedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceKind,
      parsedSuccessfully: true,
      parserNote:
        'RESEARCH DATA — extracted from a locally saved UserBenchmark page source. Not fetched by this tool. NOT a verified BenchmarkRecord; these are crowd-sourced self-reported values.',
      warnings,
    },
    game: identity.value,
    sampleSummary: summary.value,
    fpsHistogram: {
      description: 'X-axis buckets are FPS values (labels); Y-axis is sample count per bucket (data). Coarse, noisy crowd-sourced distribution.',
      ...fpsHistogram.value,
    },
    settingsDistribution: {
      description: 'Sample count per in-game quality preset, exactly as labelled by the source.',
      ...settingsDistribution.value,
    },
    resolutionDistribution: {
      description: 'Sample count per display resolution, exactly as labelled by the source.',
      ...resolutionDistribution.value,
    },
    gpuTable: tables.value.gpuTable,
    cpuTable: tables.value.cpuTable,
    unclassifiedTableRows: tables.value.unclassified,
    brandFilterUrls: brandFilters.value,
    ownFilterPaths: {
      note: 'Every distinct filter path this page links to for its own game. Positions 2 and 3 have no proven meaning — see efps/configuration-analysis.md.',
      paths: ownFilterPaths.value,
    },
    relatedGamePages: {
      note: 'Discovered on this page, NOT fetched. A human must explicitly save any of these before they can be parsed.',
      games: relatedGamePages.value,
    },
    efps: {
      note: 'Embedded EFPS objects. Direct records carry one measured FPS for one (game, GPU, CPU); comparison records carry two sides. Values are copied verbatim — never derived, never converted from Bench%/Value%.',
      stats: efps.stats,
      records: efps.records,
      rejected: efps.rejected,
    },
  };
}
