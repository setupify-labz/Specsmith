// Research-only tool: extracts structured data from a LOCALLY SAVED
// UserBenchmark search/hub page (the page saved here is
// /Search?searchTerm=FPS — see README.md for why that's the relevant
// "homepage" for this project, not the bare "/" root). No network code
// anywhere in this file — it only reads files already present in
// research/userbenchmark/homepage/pages/.
//
// Run with:
//   node research/userbenchmark/homepage/parse.mjs
//   node research/userbenchmark/homepage/parse.mjs <filename>
//
// Output: one JSON file per source under
// research/userbenchmark/homepage/parsed/, plus an index.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, 'pages');
const outDir = path.join(here, 'parsed');

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
/** Strips spurious JS-string backslash-escapes (e.g. \-, \+, \!, \&) that
 * are legal in a JS string literal but not in JSON, so the array literal
 * from mhasearchcomp(...) can be parsed with JSON.parse. */
function jsStringArrayToJson(raw) {
  return raw.replace(/\\(.)/g, (full, ch) => ('"\\/bfnrtu'.includes(ch) ? full : ch));
}

// ---------------------------------------------------------------------------
// Section extractors
// ---------------------------------------------------------------------------
function extractPageContext(html) {
  const warnings = [];
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const robotsMatch = html.match(/<meta name="robots" content="([^"]*)"/);
  const actionMatch = html.match(/<form id="searchForm"[^>]*action="([^"]*)"/);
  const searchInputMatch = html.match(/id="navForm:searchInput"[^>]*value="([^"]*)"/);
  if (!titleMatch) warnings.push('No <title> found.');
  return {
    value: {
      title: titleMatch ? decodeEntities(titleMatch[1]) : null,
      robotsMeta: robotsMatch ? robotsMatch[1] : null,
      searchFormAction: actionMatch ? decodeEntities(actionMatch[1]) : null,
      searchTerm: searchInputMatch ? decodeEntities(searchInputMatch[1]) : null,
    },
    warnings,
  };
}

function extractHitsSummary(html) {
  const warnings = [];
  const m = html.match(/<h3[^>]*>\s*([\d,]+)\s*Hits\s*<small>\s*\(showing\s*(\d+)\)/);
  if (!m) {
    warnings.push('No "N Hits (showing M)" header found.');
    return { value: { totalHits: null, shownCount: null }, warnings };
  }
  return { value: { totalHits: parseIntLoose(m[1]), shownCount: parseIntLoose(m[2]) }, warnings };
}

/** The `tl-tag` result cards — this page's actual FPS-Estimates game
 * search results, each carrying a sample count that the "Can You Run It?"
 * carousel and the raw autocomplete array both lack. Not every `tl-tag`
 * hit is a game — a search for "FPS" also turns up unrelated product hits
 * (e.g. a "Blade" RAM kit whose SpeedTest URL happens to match "FPS" in
 * its own title). Those are split out into `nonGameHits` rather than
 * miscategorized as a game with a null gameId. */
function extractSearchResultGames(html) {
  const warnings = [];
  const re = /<a\s+class='tl-tag'\s+href='([^']+)'>[\s\S]*?<img class='tl-icon' src='([^']+)'\/>[\s\S]*?<span class='tl-title'>([^<]+)<\/span><span class='tl-caption'>([^<]*)<\/span><span class='tl-desc'>([^<]*)<\/span>/g;
  const results = [];
  const nonGameHits = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, href, iconUrl, title, caption, desc] = m;
    const url = decodeEntities(href);
    const idMatch = url.match(/\/PCGame\/FPS-Estimates-([^/]+)\/(\d+)\//);
    const samplesMatch = desc.match(/([\d,]+)\s*samples/);
    if (!idMatch) {
      nonGameHits.push({ name: decodeEntities(title), caption: decodeEntities(caption), desc: decodeEntities(desc), url, iconUrl: decodeEntities(iconUrl) });
      continue;
    }
    results.push({
      name: decodeEntities(title),
      caption: decodeEntities(caption),
      sampleCount: samplesMatch ? parseIntLoose(samplesMatch[1]) : null,
      gameId: idMatch[2],
      slug: idMatch[1],
      url,
      iconUrl: decodeEntities(iconUrl),
    });
  }
  if (results.length === 0 && nonGameHits.length === 0) warnings.push('No tl-tag search result entries matched.');
  return { value: { games: results, nonGameHits }, warnings };
}

/** The facet sidebar (Subdomain / Type / Category / Brand), each entry a
 * {label, count, filterUrl}. Facet GROUP names are read from the
 * `tallp mutedtext` labels immediately preceding each `<ul class="nav">`. */
function extractFacets(html) {
  const warnings = [];
  const groupRe = /<div class="tallp mutedtext">([^<]+)<\/div>\s*<ul class="nav"[^>]*>([\s\S]*?)<\/ul>/g;
  const itemRe = /<a class="topbranchlink" href="([^"]+)">([^<]*?)<span class='facetcount'>\s*•\s*(\d+)<\/span>/g;
  const facets = {};
  let gm;
  while ((gm = groupRe.exec(html)) !== null) {
    const [, groupName, groupHtml] = gm;
    const items = [];
    let im;
    itemRe.lastIndex = 0;
    while ((im = itemRe.exec(groupHtml)) !== null) {
      items.push({ label: decodeEntities(im[2]), count: parseIntLoose(im[3]), filterUrl: decodeEntities(im[1]) });
    }
    facets[decodeEntities(groupName)] = items;
  }
  if (Object.keys(facets).length === 0) warnings.push('No facet groups matched.');
  return { value: facets, warnings };
}

/** The "308 MORE »" control (page 1 of the search page as first loaded) is
 * a JSF/Mojarra AJAX postback (mojarra.ab(...)), not a navigable URL — this
 * function records that fact rather than a fetchable link. A page captured
 * from one of those AJAX postbacks (page 2, 3, ...) instead shows the
 * `mh-ajaxpager` widget + a "Page N of M" nav with "« Prev"/"Next »"
 * controls carrying the PGMP (page number) value each postback needs —
 * still not a GET URL, but recorded with its own page/of/PGMP fields. */
function extractPaginationGap(html, totalHits, shownCount) {
  const warnings = [];
  const isAjaxPostback = /mojarra\.ab\(this,event,'action','@form','@form'/.test(html);
  const pagerMatch = html.match(/<div class="mh-ajaxpager" data-ajpnpp="(\d+)" data-ajpcp="(\d+)">/);
  const pageOfMatch = html.match(/Page (\d+) of (\d+)/);
  const nextMatch = html.match(/'PGMP':'(\d+)'[^}]*\}\);return false">Next\s*»/);
  const prevMatch = html.match(/'PGMP':'(\d+)'[^}]*\}\);return false">«\s*Prev/);
  if (pagerMatch || pageOfMatch) {
    return {
      value: {
        source: 'ajax-page',
        resultsPerPage: pagerMatch ? parseIntLoose(pagerMatch[1]) : null,
        currentPage: pagerMatch ? parseIntLoose(pagerMatch[2]) : pageOfMatch ? parseIntLoose(pageOfMatch[1]) : null,
        totalPages: pageOfMatch ? parseIntLoose(pageOfMatch[2]) : null,
        nextPagePGMP: nextMatch ? parseIntLoose(nextMatch[1]) : null,
        prevPagePGMP: prevMatch ? parseIntLoose(prevMatch[1]) : null,
        reachableViaStaticUrl: false,
        mechanism: 'JSF/Mojarra AJAX form postback (mojarra.ab), captured by hand from a browser devtools Network tab — no GET URL exists for this page.',
      },
      warnings,
    };
  }
  const moreMatch = html.match(/(\d+)\s*MORE\s*»/);
  const remaining = moreMatch ? parseIntLoose(moreMatch[1]) : totalHits != null && shownCount != null ? totalHits - shownCount : null;
  if (!moreMatch) warnings.push('No "N MORE »" pagination control and no "Page N of M" ajax-pager found (may mean all hits fit on one page).');
  return {
    value: {
      source: 'initial-page',
      remainingHitsNotShown: remaining,
      reachableViaStaticUrl: false,
      mechanism: isAjaxPostback ? 'JSF/Mojarra AJAX form postback (mojarra.ab), requires executing JS and submitting a form — no GET URL exists for page 2+' : 'unknown — did not match the expected mojarra.ab(...) pattern',
    },
    warnings,
  };
}

/** The "The Best" table: CPU / GPU / SSD picks. Column identity comes from
 * the <th> header links; each <td> has a component name+URL and,
 * optionally, a live/hot price + URL + store. No bench/value score or
 * sample count is present in this table (see README's gap list). */
function extractBestTable(html) {
  const warnings = [];
  const tableMatch = html.match(/<table class="table table-no-border table-super-condensed[\s\S]*?<\/table>/);
  if (!tableMatch) {
    warnings.push('No "The Best" table found.');
    return { value: { columns: [], rows: [] }, warnings };
  }
  const tableHtml = tableMatch[0];

  const headerRe = /<th><a[^>]*href='([^']+)'>[\s\S]*?\/>(\w+)<\/a><\/th>/g;
  const columns = [];
  let hm;
  while ((hm = headerRe.exec(tableHtml)) !== null) columns.push({ label: hm[2], subdomainUrl: decodeEntities(hm[1]) });
  if (columns.length === 0) warnings.push('"The Best" table matched but no column headers parsed.');

  const rowsHtml = [...tableHtml.matchAll(/<tr>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g)].map((m) => m[1]).slice(1); // skip header row
  const cellRe = /<td><span class='nowrap'><a class='nodec wheattext' href='([^']+)'>([^<]+)<\/a>\s*(?:<a class='nodec navtrack ambertext'[^>]*href='([^']+)' title='([^']+)'><span class='nowrap'>\$([\d,.]+)(<i class='fa fa-fire hotprice'><\/i>)?<\/span><\/a>)?<\/span><\/td>/g;
  const rows = [];
  for (const rowHtml of rowsHtml) {
    const cells = [];
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      const [, ratingUrl, name, priceUrl, priceTitle, price, hotFlag] = cm;
      const ratingIdMatch = ratingUrl.match(/\/Rating\/(\d+)$/);
      cells.push({
        name: decodeEntities(name),
        ratingUrl: decodeEntities(ratingUrl),
        ratingId: ratingIdMatch ? ratingIdMatch[1] : null,
        priceUsd: price ? Number(price.replace(/,/g, '')) : null,
        priceStore: priceTitle ? decodeEntities(priceTitle).replace(/^(Live|Hot)\s*/, '').replace(/\s*price$/, '') : null,
        priceUrl: priceUrl ? decodeEntities(priceUrl) : null,
        hotPrice: Boolean(hotFlag),
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) warnings.push('"The Best" table matched but no data rows parsed.');
  return { value: { columns, rows }, warnings };
}

/** The "Can You Run It?" game carousel — name/id/slug/url only, no sample
 * counts (unlike extractSearchResultGames, which does have them). */
function extractCarouselGames(html) {
  const warnings = [];
  const sectionMatch = html.match(/Can You Run It\?[\s\S]*?<div class="btn-group btn-group-lg[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  const scope = sectionMatch ? sectionMatch[0] : html;
  const re = /<a class="btn btn-primary img-coh" href="(https:\/\/www\.userbenchmark\.com\/PCGame\/FPS-Estimates-[^"]+\/(\d+)\/[0-9.]+)" title="([^"]+)"/g;
  const games = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(scope)) !== null) {
    const [, url, gameId, title] = m;
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    const slugMatch = url.match(/FPS-Estimates-([^/]+)\//);
    games.push({ name: decodeEntities(title), gameId, slug: slugMatch ? slugMatch[1] : null, url: decodeEntities(url) });
  }
  if (games.length === 0) warnings.push('No "Can You Run It?" carousel entries found.');
  return { value: games, warnings };
}

/** The site-wide autocomplete label array (mhasearchcomp(...)). Labels
 * only — no ids, no URLs, no sample counts, no scores. Also derives the
 * "FPS Estimates <Game>" subset as additional discovered game NAMES
 * (unresolvable to an id/url from this data alone). */
function extractAutocompleteCatalog(html) {
  const warnings = [];
  const callMatch = html.match(/mhasearchcomp\("[^"]+",\s*\[([\s\S]*?)\]\);/);
  if (!callMatch) {
    warnings.push('No mhasearchcomp(...) autocomplete array found.');
    return { value: { totalItems: 0, items: [], fpsEstimatesGameNames: [], duplicateLabels: [] }, warnings };
  }
  let items;
  try {
    items = JSON.parse(jsStringArrayToJson('[' + callMatch[1] + ']'));
  } catch (e) {
    warnings.push(`mhasearchcomp(...) array found but failed to parse as JSON: ${e.message}`);
    return { value: { totalItems: 0, items: [], fpsEstimatesGameNames: [], duplicateLabels: [] }, warnings };
  }
  const fpsEstimatesGameNames = items.filter((s) => s.startsWith('FPS Estimates ')).map((s) => s.replace(/^FPS Estimates\s*/, '').trim());
  const seen = new Set();
  const duplicateLabels = [...new Set(items.filter((s) => (seen.has(s) ? true : (seen.add(s), false))))];
  return {
    value: {
      totalItems: items.length,
      items,
      fpsEstimatesGameNames,
      duplicateLabels,
    },
    warnings,
  };
}

/** The "Go/HotXXXAmazon" affiliate/ad-tracking links — recorded as their
 * own category since they're navigation/monetization, not benchmark data. */
function extractAffiliateLinks(html) {
  const re = /<a[^>]*href="(https:\/\/www\.userbenchmark\.com\/Go\/Hot(\w+)Amazon\/[^"]+)"/g;
  const links = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, url, category] = m;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ category, url: decodeEntities(url) });
  }
  return { value: links, warnings: [] };
}

// ---------------------------------------------------------------------------
// Gap analysis — what CPU/GPU/RAM/storage/benchmark/score/ranking data the
// task asked about is and isn't present on this page.
// ---------------------------------------------------------------------------
function buildGapReport(parsed) {
  const gaps = [];
  gaps.push({
    dimension: 'RAM',
    embeddedOnThisPage: 'Nav link only (ram.userbenchmark.com) + one facet count ("ram" subdomain: 1 hit; "Memory Kits" category: 1 hit). No RAM product names, scores, or rankings are embedded.',
    wouldRequire: 'Fetching ram.userbenchmark.com directly — a separate subdomain/page this tool was not given and does not fetch.',
  });
  gaps.push({
    dimension: 'Storage (HDD)',
    embeddedOnThisPage: 'Nav link only (hdd.userbenchmark.com). Zero HDD products, scores, or data embedded anywhere on this page.',
    wouldRequire: 'Fetching hdd.userbenchmark.com directly.',
  });
  gaps.push({
    dimension: 'Storage (SSD)',
    embeddedOnThisPage: 'Present, but only in "The Best" table: name + rating URL + live price. No bench/value score, no sample count.',
    wouldRequire: 'Fetching the SSD\'s own /Rating/<id> page (e.g. ssd.userbenchmark.com/.../Rating/4188) for a score or sample count.',
  });
  gaps.push({
    dimension: 'USB',
    embeddedOnThisPage: 'Nav link only (usb.userbenchmark.com). Zero USB products or data embedded.',
    wouldRequire: 'Fetching usb.userbenchmark.com directly.',
  });
  gaps.push({
    dimension: 'CPU / GPU numeric benchmark score',
    embeddedOnThisPage: 'Not present anywhere on this page. "The Best" table has name + price only, no bench%/value% (unlike the FPS-Estimates game pages\' GPU/CPU tables, which do carry a Bench % and Value % — see ../parse.mjs).',
    wouldRequire: 'Fetching the component\'s own /Rating/<id> page, or a game\'s FPS-Estimates page (which does carry bench/value percentages per part, for that specific game).',
  });
  gaps.push({
    dimension: 'Full FPS-Estimates game catalog with IDs',
    embeddedOnThisPage: `${parsed.searchResultGames.length} of ${parsed.hitsSummary.totalHits ?? '(unknown)'} total hits on this specific page carry a resolvable gameId/URL (the tl-tag search results). The autocomplete array separately lists ${parsed.autocompleteCatalog.fpsEstimatesGameNames.length} "FPS Estimates <Game>" NAMES, but with zero ids/URLs attached to any of them.`,
    wouldRequire: 'The "308 MORE »" AJAX pagination control (a JSF/Mojarra form postback, not a GET URL — see paginationGap below) to resolve the remaining hits\' ids/URLs, or visiting each named game individually via search.',
  });
  gaps.push({
    dimension: 'Explicit numeric ranking/position',
    embeddedOnThisPage: '"The Best" table\'s 3 rows are presented top-to-bottom without an explicit rank number, price tier label, or score attached to that ordering — the ranking is positional/implicit only, not a labeled field.',
    wouldRequire: 'Nothing on this page makes the ranking criteria explicit; would need the site\'s own ranking/methodology page or each part\'s dedicated Rating page.',
  });
  return gaps;
}

// ---------------------------------------------------------------------------
// Top-level parse + CLI
// ---------------------------------------------------------------------------
function parsePage(html, sourceFile) {
  const warnings = [];
  const pageContext = extractPageContext(html);
  warnings.push(...pageContext.warnings);
  const hitsSummary = extractHitsSummary(html);
  warnings.push(...hitsSummary.warnings);
  const searchResultGames = extractSearchResultGames(html);
  warnings.push(...searchResultGames.warnings.map((w) => `[searchResultGames] ${w}`));
  const facets = extractFacets(html);
  warnings.push(...facets.warnings.map((w) => `[facets] ${w}`));
  const paginationGap = extractPaginationGap(html, hitsSummary.value.totalHits, hitsSummary.value.shownCount);
  warnings.push(...paginationGap.warnings.map((w) => `[paginationGap] ${w}`));
  const bestTable = extractBestTable(html);
  warnings.push(...bestTable.warnings.map((w) => `[bestTable] ${w}`));
  const carouselGames = extractCarouselGames(html);
  warnings.push(...carouselGames.warnings.map((w) => `[carouselGames] ${w}`));
  const autocompleteCatalog = extractAutocompleteCatalog(html);
  warnings.push(...autocompleteCatalog.warnings.map((w) => `[autocompleteCatalog] ${w}`));
  const affiliateLinks = extractAffiliateLinks(html);

  const parsed = {
    _meta: {
      sourceFile,
      parsedAt: new Date().toISOString(),
      parserNote: 'RESEARCH DATA — extracted from a locally saved UserBenchmark page source. Not fetched by this tool. Not a BenchmarkRecord.',
      warnings,
    },
    pageContext: pageContext.value,
    hitsSummary: hitsSummary.value,
    searchResultGames: searchResultGames.value.games,
    nonGameSearchHits: searchResultGames.value.nonGameHits,
    facets: facets.value,
    paginationGap: paginationGap.value,
    bestTable: bestTable.value,
    carouselGames: carouselGames.value,
    autocompleteCatalog: autocompleteCatalog.value,
    affiliateLinks: affiliateLinks.value,
  };
  parsed.gapReport = buildGapReport(parsed);
  return parsed;
}

async function main() {
  const arg = process.argv[2];
  await fs.mkdir(outDir, { recursive: true });

  let files;
  try {
    files = (await fs.readdir(pagesDir)).filter((f) => /\.(html?|xhtml|txt|xml)$/i.test(f));
  } catch {
    console.error(`No pages/ directory found at ${pagesDir} — see README.md.`);
    process.exitCode = 1;
    return;
  }
  if (arg) files = files.filter((f) => f === arg);
  if (files.length === 0) {
    console.error(arg ? `File "${arg}" not found in ${pagesDir}` : `No .html/.htm/.xhtml/.txt/.xml files found in ${pagesDir}.`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of files) {
    const html = await fs.readFile(path.join(pagesDir, file), 'utf-8');
    const parsed = parsePage(html, file);
    const outName = `${path.basename(file, path.extname(file))}.json`;
    await fs.writeFile(path.join(outDir, outName), JSON.stringify(parsed, null, 2) + '\n');
    results.push({
      sourceFile: file,
      outputFile: outName,
      totalHits: parsed.hitsSummary.totalHits,
      searchResultGamesFound: parsed.searchResultGames.length,
      nonGameSearchHitsFound: parsed.nonGameSearchHits.length,
      carouselGamesFound: parsed.carouselGames.length,
      autocompleteItemsFound: parsed.autocompleteCatalog.totalItems,
      autocompleteFpsGameNamesFound: parsed.autocompleteCatalog.fpsEstimatesGameNames.length,
      bestTableRows: parsed.bestTable.rows.length,
      warningCount: parsed._meta.warnings.length,
    });
    console.log(
      `Parsed ${file} -> ${outName}: ${parsed.hitsSummary.totalHits} total hits, ${parsed.searchResultGames.length} search-result games (w/ sample counts), ${parsed.carouselGames.length} carousel games, ${parsed.autocompleteCatalog.fpsEstimatesGameNames.length} autocomplete "FPS Estimates" names, ${parsed.bestTable.rows.length} "Best" table rows, ${parsed._meta.warnings.length} warning(s).`,
    );
  }

  await fs.writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), note: 'Index of all parsed UserBenchmark homepage/search page sources. Research data only.', pages: results }, null, 2) + '\n',
  );
  console.log(`Wrote index.json (${results.length} page(s)).`);
}

await main();
