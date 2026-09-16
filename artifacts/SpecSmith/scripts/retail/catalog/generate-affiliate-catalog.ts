// Builds the committed, browser-readable catalog of 500 priced parts.
//
// Every published part carries the merchant's own retail price, its sale price
// when one is genuinely lower, the currency, and the instant all three were
// read. A candidate whose pricing cannot be trusted is REJECTED and another
// qualified candidate takes its place, so the catalogue reaches its quota with
// 500 parts and 500 valid prices — never 500 parts and 493 prices.
//
// Stock is still absent, and still cannot be inferred: the feed is a catalogue
// of listings, not an inventory. Availability is unknown for every part, and
// the merchant page remains the source of truth after a click.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAffiliatePartCatalog, type AffiliatePart, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import {
  fetchAllProductSearchPages,
  findItems,
  loadGpuCatalog,
  parseProductSearchXml,
  readAccessToken,
} from '../rakuten';
import { DEFAULT_REQUESTS_PER_MINUTE, RateLimiter } from '../coverage/rateLimiter';
import { createInstrumentedFetch } from '../coverage/instrumentedFetch';
import { buildSnapshot } from '../snapshot/buildSnapshot';
import { sweepOffers } from '../snapshot/sweepOffers';
import {
  admitAffiliatePart,
  AffiliateCatalogFailure,
  attachImageContentRatios,
  buildAffiliatePartCatalog,
  gpuOfferToAffiliatePart,
  type CatalogSelectionReport,
} from './affiliateCatalog';
import { measureImageAtUrl } from './imageContent';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');

type GeneratorFailureCode =
  | 'argument-invalid'
  | 'output-inside-repository'
  | 'output-directory-missing'
  | 'gpu-sweep-refused'
  | 'category-request-failed'
  | 'category-shortfall'
  | 'catalog-invalid'
  | 'write-failed';

class GeneratorFailure extends Error {
  constructor(readonly code: GeneratorFailureCode) {
    super(code);
  }
}

export function resolveCatalogOutputPath(file: string, root: string = repoRoot): string {
  const output = path.resolve(file);
  const relative = path.relative(path.resolve(root), output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new GeneratorFailure('output-inside-repository');
  }
  return output;
}

export function parseArgs(argv: readonly string[]): { out: string } {
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1]) throw new GeneratorFailure('argument-invalid');
  return { out: resolveCatalogOutputPath(argv[1]) };
}

async function run(argv: readonly string[]): Promise<number> {
  const { out } = parseArgs(argv);
  if (!fs.existsSync(path.dirname(out))) throw new GeneratorFailure('output-directory-missing');
  readAccessToken();

  const gpuCatalog = loadGpuCatalog();
  const gpuSweep = await sweepOffers({ catalog: gpuCatalog, requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE });
  const measured = buildSnapshot({
    expectedGpuIds: gpuCatalog.map((gpu) => gpu.id),
    outcomes: gpuSweep.outcomes,
    generatedAt: gpuSweep.finishedAt,
  });
  if (!measured.ok) throw new GeneratorFailure('gpu-sweep-refused');

  const candidates = new Map<RetailPartCategory, AffiliatePart[]>();
  const gpuParts = gpuSweep.outcomes.flatMap((outcome) =>
    // An offer whose pricing would not satisfy the published schema yields
    // null and is dropped here, exactly like a non-GPU candidate rejected for
    // 'price'. The quota then draws on the next qualified candidate.
    outcome.status === 'ok'
      ? outcome.offers.flatMap((offer) => {
          const part = gpuOfferToAffiliatePart(offer);
          return part === null ? [] : [part];
        })
      : [],
  );
  candidates.set('gpu', gpuParts);

  // EVERY PAGE, NOT THE FIRST ONE. This loop used to request `pageNumber: 1`
  // and nothing else, so a category with 900 matching listings offered the
  // selection 100 candidates for a quota of 55 — and which 100 was decided by
  // the feed's own ordering. Selecting the best listings is meaningless if the
  // candidates were already truncated by arrival before selection saw them.
  //
  // `fetchAllProductSearchPages` is the SAME pager the GPU sweep already uses,
  // with the same paging-consistency rules and the same refusal to read a
  // prefix and report it as the whole result. Requests go through the same
  // instrumented, rate-limited fetch, so walking more pages costs time rather
  // than breaching the feed's limits.
  const limiter = new RateLimiter(DEFAULT_REQUESTS_PER_MINUTE);
  const { fetch: limitedFetch, stats } = createInstrumentedFetch({ limiter });
  for (const config of RETAIL_CATEGORY_CONFIG.filter((entry) => entry.category !== 'gpu')) {
    const result = await fetchAllProductSearchPages(
      { keyword: config.keyword, categoryLeaf: config.categoryLeaf, max: 100 },
      { fetch: limitedFetch },
    );
    const accepted = result.pages.flatMap((xml) =>
      findItems(parseProductSearchXml(xml)).flatMap((item) => {
        const admission = admitAffiliatePart(item, config.category, config.categoryLeaf, result.fetchedAt);
        return admission.status === 'accepted' ? [admission.part] : [];
      }),
    );
    console.error(
      `${config.category}: walked ${result.pages.length} of ${result.totalPages} reported pages`
        + ` (${result.totalMatches ?? 'unknown'} matches), ${accepted.length} admitted.`,
    );
    candidates.set(config.category, accepted);
  }
  console.error(`Feed requests: ${stats.requests} (${stats.rateLimited} rate-limited, ${Math.round(stats.waitedMs / 1000)}s waiting).`);

  console.error(
    `Admitted candidates: ${RETAIL_CATEGORY_CONFIG.map((config) => `${config.category}=${candidates.get(config.category)?.length ?? 0}`).join(', ')}.`,
  );

  let catalog;
  const selection: CatalogSelectionReport[] = [];
  try {
    catalog = buildAffiliatePartCatalog(candidates, new Date().toISOString(), selection);
  } catch (cause) {
    if (cause instanceof AffiliateCatalogFailure && cause.code === 'category-shortfall') {
      throw new GeneratorFailure('category-shortfall');
    }
    throw new GeneratorFailure('catalog-invalid');
  }

  // What the selection actually looked at. Printed because the defect this
  // replaced was invisible from the outside: a run that published 80 of 600
  // eligible GPU listings and one that published 80 of 80 produced identical
  // output and identical logs.
  for (const row of selection) {
    const rejected = Object.entries(row.outOfScope).map(([reason, count]) => `${reason}=${count}`).join(', ');
    console.error(
      `${row.category}: published ${row.published} of ${row.distinctProducts} distinct products `
        + `from ${row.considered} candidates, spread across ${row.coverageGroups} ${row.coverage} groups `
        + `(${row.consolidated} duplicate listings consolidated to their cheapest, ${row.stale} refused as stale`
        + `${rejected ? `, out of scope: ${rejected}` : ''}).`,
    );
  }

  // Frame measurement, after the quota is settled so only the 500 published
  // images are fetched. Best effort: an image that cannot be measured keeps a
  // null ratio and is framed exactly as it arrives, and no failure here can
  // stop the prices from being published.
  const framing = await attachImageContentRatios(catalog.parts, (url) => measureImageAtUrl(url));
  catalog = { ...catalog, parts: framing.parts };
  const problems = Object.entries(framing.problems)
    .map(([problem, count]) => `${problem}=${count}`)
    .join(', ');
  console.error(
    `Image framing measured for ${framing.measured}/${catalog.parts.length} parts${problems ? ` (${problems})` : ''}.`,
  );

  // The measured catalogue is re-validated before it is written. The ratios
  // came from outside, and the file on disk must satisfy the same reader the
  // browser uses — the build's own validation ran before these were attached.
  if (!parseAffiliatePartCatalog(catalog).ok) throw new GeneratorFailure('catalog-invalid');

  try {
    fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new GeneratorFailure('write-failed');
  }
  console.error(`Affiliate catalog built: ${catalog.parts.length} image-and-link parts across ${RETAIL_CATEGORY_CONFIG.length} categories.`);
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (cause) {
    const code = cause instanceof GeneratorFailure ? cause.code : 'category-request-failed';
    console.error(`Affiliate catalog failed [${code}]. Nothing was written.`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
