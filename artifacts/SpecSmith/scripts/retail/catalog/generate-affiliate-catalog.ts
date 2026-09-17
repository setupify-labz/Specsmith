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

import { AFFILIATE_PART_TARGET, parseAffiliatePartCatalog, type AffiliatePart, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { isHttpUrl, isInstant, isTrackedAffiliateUrl } from '../../../src/lib/retail/offerSnapshot';
import {
  fetchAllProductSearchPages,
  findItems,
  RakutenAuthError,
  RakutenPagingError,
  RakutenRequestError,
  loadGpuCatalog,
  parseProductSearchXml,
  readAccessToken,
  childText,
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
  planCatalogSelection,
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

/**
 * `--dry-run` reports what a build WOULD publish and refuses to stop early.
 *
 * The difference is not the writing — `resolveCatalogOutputPath` already
 * refuses any path inside the repository, so no run of this script can touch
 * the committed catalogue. The difference is that a dry run reports every
 * category even when one of them falls short, where a real build refuses at
 * the first shortfall and leaves nobody able to see the other eleven.
 *
 * A dry run NEVER lowers a quota to make a category pass. It prints the
 * shortfall and exits non-zero.
 */
export function parseArgs(argv: readonly string[]): { out: string; dryRun: boolean } {
  const flags = argv.filter((arg) => arg.startsWith('--') && arg !== '--out');
  const dryRun = flags.length === 1 && flags[0] === '--dry-run';
  if (flags.length > (dryRun ? 1 : 0)) throw new GeneratorFailure('argument-invalid');
  const rest = argv.filter((arg) => arg !== '--dry-run');
  if (rest.length !== 2 || rest[0] !== '--out' || !rest[1]) throw new GeneratorFailure('argument-invalid');
  return { out: resolveCatalogOutputPath(rest[1]), dryRun };
}

/** What one category's candidates cost to gather, and why listings were refused. */
interface CandidateAudit {
  pagesRead: number;
  feedTotalPages: number;
  totalMatches: number | null;
  itemsSeen: number;
  admitted: number;
  /** Rejection counts by the first gate each listing failed. */
  rejections: Record<string, number>;
  /** One title per reason, so a reason can be checked rather than trusted. */
  samples: { reason: string; title: string }[];
}

const emptyAudit = (): CandidateAudit => ({
  pagesRead: 0, feedTotalPages: 0, totalMatches: null, itemsSeen: 0, admitted: 0, rejections: {}, samples: [],
});

const noteRejection = (audit: CandidateAudit, reason: string, title: string | null): void => {
  audit.rejections[reason] = (audit.rejections[reason] ?? 0) + 1;
  // Up to three per reason: enough to see what a gate is catching, few enough
  // that the log stays readable.
  if (audit.samples.filter((sample) => sample.reason === reason).length < 3 && title) {
    audit.samples.push({ reason, title: title.slice(0, 120) });
  }
};

async function run(argv: readonly string[]): Promise<number> {
  const { out, dryRun } = parseArgs(argv);
  if (!fs.existsSync(path.dirname(out))) throw new GeneratorFailure('output-directory-missing');
  readAccessToken();

  const gpuCatalog = loadGpuCatalog();
  const gpuSweep = await sweepOffers({ catalog: gpuCatalog, requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE });
  const measured = buildSnapshot({
    expectedGpuIds: gpuCatalog.map((gpu) => gpu.id),
    outcomes: gpuSweep.outcomes,
    generatedAt: gpuSweep.finishedAt,
  });
  // A REFUSED SWEEP STOPS A BUILD, BUT NOT A REPORT.
  //
  // `buildSnapshot` refuses when too much of the GPU catalogue failed at once
  // — the right answer for a real build, which must not publish a collapsed
  // sweep. But it fires before any category has been reported, so a dry run
  // that hit it produced NOTHING: no report, no artifact, no indication of
  // which GPUs failed. The second live dry run did exactly that.
  //
  // The dry run records the refusal and carries on with whatever the sweep did
  // return, so the other eleven categories are still measured. GPU will fall
  // short of its quota on a genuinely collapsed sweep, and the run still
  // fails; it fails having said what happened.
  if (!measured.ok && !dryRun) throw new GeneratorFailure('gpu-sweep-refused');

  const candidates = new Map<RetailPartCategory, AffiliatePart[]>();
  const audits = new Map<RetailPartCategory, CandidateAudit>();

  const gpuAudit = emptyAudit();
  gpuAudit.totalMatches = 0;
  if (!measured.ok) noteRejection(gpuAudit, `sweep-refused-${measured.refusal.code}`, `${measured.refusal.failedGpus} of ${gpuCatalog.length} catalogue GPUs failed`);
  for (const outcome of gpuSweep.outcomes) {
    if (outcome.status !== 'ok') {
      noteRejection(gpuAudit, `sweep-${outcome.failure}`, outcome.gpuId);
      continue;
    }
    gpuAudit.pagesRead += outcome.pagesRead ?? 0;
    gpuAudit.feedTotalPages += outcome.feedTotalPages ?? 0;
    gpuAudit.totalMatches = (gpuAudit.totalMatches ?? 0) + (outcome.totalMatches ?? 0);
    gpuAudit.itemsSeen += outcome.itemsSeen;
    for (const refusal of outcome.rejected ?? []) noteRejection(gpuAudit, refusal.reason, refusal.productName);
  }
  audits.set('gpu', gpuAudit);

  const gpuParts = gpuSweep.outcomes.flatMap((outcome) =>
    // An offer whose pricing would not satisfy the published schema yields
    // null and is dropped here, exactly like a non-GPU candidate rejected for
    // 'price'. The quota then draws on the next qualified candidate.
    outcome.status === 'ok'
      ? outcome.offers.flatMap((offer) => {
          const part = gpuOfferToAffiliatePart(offer);
          // An accepted OFFER whose pricing the published schema would refuse.
          // Counted here so it is not silently absent from both tallies.
          if (part === null) noteRejection(gpuAudit, 'price', offer.productName);
          return part === null ? [] : [part];
        })
      : [],
  );
  gpuAudit.admitted = gpuParts.length;
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
    const audit = emptyAudit();
    audits.set(config.category, audit);
    // A CATEGORY THAT CANNOT BE FETCHED IS RECORDED, NOT THROWN.
    //
    // This is what `sweepOffers` already does for a GPU that fails: an
    // exception here loses the other eleven categories along with the reason,
    // and the reason is the whole point of a dry run. The live run that found
    // this walked nine pages of processors, admitted 822 candidates, and then
    // died on the next category with a generic 'category-request-failed' — no
    // indication of which category or why.
    //
    // The category still reports zero published against its quota, so the run
    // still fails. It fails having said what happened.
    let result;
    try {
      result = await fetchAllProductSearchPages(
        { keyword: config.keyword, categoryLeaf: config.categoryLeaf, max: 100 },
        { fetch: limitedFetch },
      );
    } catch (cause) {
      // Classified from the error's TYPE and its own code, never its message:
      // a message can quote a response body or a URL carrying a publisher id.
      const reason = cause instanceof RakutenPagingError
        ? `paging-${cause.code}`
        : cause instanceof RakutenRequestError
          ? `http-${cause.httpStatus}`
          : cause instanceof RakutenAuthError
            ? 'auth'
            : 'transport';
      noteRejection(audit, `fetch-failed-${reason}`, config.keyword);
      candidates.set(config.category, []);
      continue;
    }
    audit.pagesRead = result.pages.length;
    audit.feedTotalPages = result.totalPages;
    audit.totalMatches = result.totalMatches;
    const accepted = result.pages.flatMap((xml) =>
      findItems(parseProductSearchXml(xml)).flatMap((item) => {
        audit.itemsSeen += 1;
        const admission = admitAffiliatePart(item, config.category, config.categoryLeaf, result.fetchedAt);
        if (admission.status === 'accepted') return [admission.part];
        noteRejection(audit, admission.reason, childText(item, 'productname'));
        return [];
      }),
    );
    audit.admitted = accepted.length;
    candidates.set(config.category, accepted);
  }
  console.error(`Feed requests: ${stats.requests} (${stats.rateLimited} rate-limited, ${Math.round(stats.waitedMs / 1000)}s waiting).`);

  console.error(
    `Admitted candidates: ${RETAIL_CATEGORY_CONFIG.map((config) => `${config.category}=${candidates.get(config.category)?.length ?? 0}`).join(', ')}.`,
  );

  const generatedAt = new Date().toISOString();
  const plan = planCatalogSelection(candidates, generatedAt);

  // THE REPORT, BEFORE ANY GATE CAN STOP THE RUN.
  //
  // Printed for every category even when one of them falls short, because a
  // build that refuses at the first shortfall leaves nobody able to see the
  // other eleven — and the shortfall itself is the thing worth looking at.
  const shortfalls: string[] = [];
  for (const row of plan.report) {
    const audit = audits.get(row.category) ?? emptyAudit();
    const gates = Object.entries(audit.rejections).sort(([, a], [, b]) => b - a);
    const admissionRejects = gates.reduce((sum, [, count]) => sum + count, 0);
    const scoped = Object.entries(row.outOfScope).map(([reason, count]) => `${reason}=${count}`).join(' ');
    if (row.published < row.quota) shortfalls.push(`${row.category} ${row.published}/${row.quota}`);

    console.error(`\n=== ${row.category} ===`);
    console.error(
      `  feed:      ${audit.pagesRead} pages read of ${audit.feedTotalPages} reported`
        + `, ${audit.totalMatches ?? 'unknown'} matches claimed, ${audit.itemsSeen} listings examined`,
    );
    console.error(`  admission: ${audit.admitted} admitted, ${admissionRejects} refused`
      + (gates.length ? ` — ${gates.map(([reason, count]) => `${reason}=${count}`).join(' ')}` : ''));
    console.error(`  freshness: ${row.stale} refused as stale at publication`);
    console.error(`  scope:     ${scoped || 'none refused'}`);
    console.error(`  duplicates:${row.consolidated} listings consolidated to their cheapest`);
    console.error(`  coverage:  ${row.coverageGroups} ${row.coverage} groups`);
    console.error(
      `  QUOTA:     ${row.published} published of ${row.quota} requested`
        + ` (${row.distinctProducts} distinct products available)`
        + `${row.published < row.quota ? `  *** SHORT BY ${row.quota - row.published} ***` : ''}`,
    );
    console.error(`  price:     ${row.range ? `$${row.range.lowUsd.toFixed(2)} – $${row.range.highUsd.toFixed(2)}` : 'nothing selected'}`);
    for (const sample of audit.samples) console.error(`    [${sample.reason}] ${sample.title}`);
  }

  console.error(`\nFeed requests: ${stats.requests} (${stats.rateLimited} rate-limited, ${Math.round(stats.waitedMs / 1000)}s waiting).`);
  console.error(`Selected ${plan.selected.length} of ${AFFILIATE_PART_TARGET} requested.`);

  // FIELD COMPLETENESS, COUNTED ON THE SELECTED LISTINGS THEMSELVES.
  //
  // The published reader already refuses a part missing a price, a currency, a
  // tracked link, an image or a fetchedAt — so a catalogue that parses has
  // them by construction. `sku` is the exception: it is OPTIONAL at the reader
  // so that catalogues published before the field existed still load, which
  // means "the file parsed" is not evidence that this run captured it.
  //
  // So the run counts them rather than inferring them from a successful parse.
  // A reviewer asking "does every listing carry an exact SKU" gets a number
  // measured on these listings, not a deduction from a schema rule.
  const completeness = {
    total: plan.selected.length,
    sku: plan.selected.filter((part) => typeof part.sku === 'string' && part.sku.trim() !== '').length,
    trackedAffiliateUrl: plan.selected.filter((part) => isTrackedAffiliateUrl(part.trackedAffiliateUrl)).length,
    imageUrl: plan.selected.filter((part) => isHttpUrl(part.imageUrl)).length,
    retailPrice: plan.selected.filter((part) => Number.isFinite(part.retailPrice) && part.retailPrice > 0).length,
    currency: plan.selected.filter((part) => /^[A-Z]{3}$/.test(part.currency)).length,
    fetchedAt: plan.selected.filter((part) => isInstant(part.fetchedAt)).length,
    upc: plan.selected.filter((part) => typeof part.upc === 'string' && part.upc !== '').length,
    unitSpecs: plan.selected.filter((part) => part.unitSpecs !== null).length,
  };
  console.error('\nField completeness across the selected listings:');
  for (const [field, count] of Object.entries(completeness)) {
    if (field === 'total') continue;
    const optional = field === 'upc' || field === 'unitSpecs';
    console.error(
      `  ${field.padEnd(22)} ${count}/${completeness.total}`
        + `${count === completeness.total ? '' : optional ? '  (not supplied for every listing)' : '  *** INCOMPLETE ***'}`,
    );
  }

  // Duplicate identity, checked ACROSS categories on the final selection —
  // the per-category consolidation counts above cannot see a collision
  // between two categories.
  const ids = plan.selected.map((part) => part.id);
  const urls = plan.selected.map((part) => part.trackedAffiliateUrl);
  const skus = plan.selected.map((part) => part.sku).filter((sku): sku is string => typeof sku === 'string');
  const duplicates = {
    ids: ids.length - new Set(ids).size,
    trackedAffiliateUrls: urls.length - new Set(urls).size,
    skus: skus.length - new Set(skus).size,
  };
  console.error(
    `Duplicate identity in the selection: ids=${duplicates.ids}, links=${duplicates.trackedAffiliateUrls}, skus=${duplicates.skus}.`,
  );

  // THE DEAREST SELECTED LISTINGS, NAMED.
  //
  // The per-category summary gives a price RANGE, which is enough to notice
  // that a category reaches $5,399 and not enough to say what that listing is.
  // Reviewing the top of a category — is this really a consumer part? — then
  // needs the catalogue file, and the file is an artifact a reviewer has to
  // download. These lines put the answer in the log beside the range.
  //
  // The tracked link is public data: it is already in the committed catalogue
  // and carries no credential of ours. The access token never appears here.
  const DEAREST_PER_CATEGORY = 10;
  console.error(`\nDearest ${DEAREST_PER_CATEGORY} selected listings per category:`);
  for (const config of RETAIL_CATEGORY_CONFIG) {
    const dearest = plan.selected
      .filter((part) => part.category === config.category)
      .sort((a, b) => (b.salePrice ?? b.retailPrice) - (a.salePrice ?? a.retailPrice))
      .slice(0, DEAREST_PER_CATEGORY);
    if (dearest.length === 0) continue;
    console.error(`  --- ${config.category} ---`);
    for (const part of dearest) {
      console.error(
        `  $${(part.salePrice ?? part.retailPrice).toFixed(2).padStart(9)}  ${part.sku ?? '(no sku)'}  ${part.name.slice(0, 90)}`,
      );
      console.error(`             ${part.trackedAffiliateUrl}`);
    }
  }

  // The report is the artifact a reviewer reads; it is written whether or not
  // the catalogue itself could be built.
  const reportPath = `${out.replace(/\.json$/, '')}-report.json`;
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({
      generatedAt,
      dryRun,
      quotasLowered: false,
      selection: plan.report,
      completeness,
      duplicates,
      candidates: Object.fromEntries([...audits].map(([category, audit]) => [category, audit])),
      feedRequests: stats,
    }, null, 2)}\n`,
    { encoding: 'utf-8', mode: 0o600, flag: 'wx' },
  );
  console.error(`Selection report written: ${reportPath}`);

  if (shortfalls.length > 0) {
    // QUOTAS ARE NOT LOWERED TO MAKE THIS PASS. The shortfall is the finding.
    console.error(`\nSHORTFALL: ${shortfalls.join(', ')}. Quotas were NOT lowered. Nothing was written as a catalogue.`);
    throw new GeneratorFailure('category-shortfall');
  }

  let catalog;
  try {
    catalog = buildAffiliatePartCatalog(candidates, generatedAt);
  } catch (cause) {
    if (cause instanceof AffiliateCatalogFailure && cause.code === 'category-shortfall') {
      throw new GeneratorFailure('category-shortfall');
    }
    throw new GeneratorFailure('catalog-invalid');
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
  for (const failure of framing.failures) {
    console.error(`  [${failure.problem}] ${failure.sku ?? failure.id} ${failure.imageUrl}`);
  }
  if (framing.failures.length > 0) {
    // NOT A REASON TO WITHHOLD ANYTHING, and said here so nobody reads the
    // list as a defect report. These are outcomes of an OPTIONAL measurement:
    // 'off-centre' means the product sits to one side, so enlarging it would
    // crop it, and 'unsupported-format' means this build script has no decoder
    // for those bytes — not that a browser lacks one. Either way the part
    // keeps a null ratio and `imageZoom` returns 1, so the picture is
    // published exactly as the merchant serves it. See imageFraming.ts.
    console.error(
      `  ${framing.failures.length} image(s) unmeasured; each is published unenlarged, at its original framing.`,
    );
  }

  // The measured catalogue is re-validated before it is written. The ratios
  // came from outside, and the file on disk must satisfy the same reader the
  // browser uses — the build's own validation ran before these were attached.
  if (!parseAffiliatePartCatalog(catalog).ok) throw new GeneratorFailure('catalog-invalid');

  try {
    fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new GeneratorFailure('write-failed');
  }
  console.error(
    `${dryRun ? 'PROPOSED catalogue (dry run, nothing published)' : 'Affiliate catalog built'}: `
      + `${catalog.parts.length} parts across ${RETAIL_CATEGORY_CONFIG.length} categories -> ${out}`,
  );
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
