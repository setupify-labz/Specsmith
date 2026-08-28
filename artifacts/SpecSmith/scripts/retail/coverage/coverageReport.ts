// Builds and renders the coverage report.
//
// WHAT THIS FILE MAY NOT CONTAIN
// ------------------------------
// Counts, ids, names and reasons. Never a tracked URL, never a publisher or
// offer identifier, never a token, and NEVER FREE TEXT FROM ANYWHERE ELSE.
//
// The report carries no arbitrary string at all. A failure is a closed
// category plus an HTTP status number — not an error message — because an
// error message is the one field that can carry anything the far end chose to
// put in it: a response body, a URL with a publisher id, in a bad case a
// credential echoed back. Scrubbing such a string is a filter, and a filter is
// a list of the leaks someone thought of. Having nowhere to put the string is
// not.
//
// A test asserts the failure object's keys are exactly the two structured
// ones, and renders a report built from offers carrying real linksynergy URLs
// to prove none of it survives.
//
// Pure: no I/O, no clock, no process. The CLI supplies timings.

import type { OfferRejectionReason } from '../rakuten/types';
import type { PagingErrorCode } from '../rakuten';

/** Every reason the adapter can refuse a listing, so a zero is reported rather than omitted. */
export const ALL_REJECTION_REASONS: readonly OfferRejectionReason[] = [
  'merchant-mismatch',
  'category-mismatch',
  'not-a-graphics-card',
  'laptop-part',
  'prebuilt-system',
  'condition-not-new',
  'model-not-found',
  'model-ambiguous',
  'model-mismatch',
  'variant-suffix-mismatch',
  'memory-capacity-mismatch',
  'memory-capacity-unstated',
  'incomplete-record',
];

export type RejectionCounts = Record<OfferRejectionReason, number>;

export const emptyRejectionCounts = (): RejectionCounts =>
  Object.fromEntries(ALL_REJECTION_REASONS.map((r) => [r, 0])) as RejectionCounts;

/**
 * What went wrong, as a closed set.
 *
 * Each maps to one error the adapter can raise, so the category alone tells a
 * reader which layer refused: credentials, the HTTP exchange, the paging
 * contract, or the XML itself. 'unexpected' is the catch-all and means a bug
 * rather than a condition.
 */
export type FailureCategory =
  /** RakutenAuthError — the token is missing or blank. Fatal for every GPU, not just this one. */
  | 'auth'
  /** RakutenRequestError with a real status — the server answered and refused. */
  | 'http-status'
  /** RakutenRequestError with status 0 — DNS, TLS, connection reset. */
  | 'transport'
  /** RakutenPagingError — the paging header was absent, unreadable or contradictory. */
  | 'paging'
  /** RakutenXmlError — the body was not XML this reader will process. */
  | 'malformed-xml'
  /** Anything else. Should not occur; if it does, it is a defect in this tool. */
  | 'unexpected';

export const ALL_FAILURE_CATEGORIES: readonly FailureCategory[] = [
  'auth',
  'http-status',
  'transport',
  'paging',
  'malformed-xml',
  'unexpected',
];

export interface GpuFailure {
  category: FailureCategory;
  /** The HTTP status when one was received; null otherwise. A number, never text. */
  httpStatus: number | null;
  /**
   * For category 'paging', WHICH paging rule refused — a closed code from the
   * adapter, never text. Null for every other category.
   *
   * This exists because "39 GPUs failed on paging" was a count without a
   * diagnosis: it could not distinguish a missing page count from a page
   * mismatch, and those want opposite fixes.
   */
  pagingReason: PagingErrorCode | null;
}

export interface GpuCoverage {
  gpuId: string;
  gpuName: string;
  /**
   * 'ok' means the API answered and the adapter judged every listing it
   * returned. 'failed' means the measurement did not happen — which is NOT the
   * same as a GPU having no offers, and is never counted as one.
   */
  status: 'ok' | 'failed';
  accepted: number;
  rejected: number;
  itemsSeen: number;
  pagesRead: number;
  totalMatches: number | null;
  /** The feed returned no matching listing — a definite zero, not a filtered-out zero. Says nothing about stock. */
  emptyResult: boolean;
  rejectionsByReason: RejectionCounts;
  /** Structured failure detail when status is 'failed'; null when it is 'ok'. */
  failure: GpuFailure | null;
}

export interface CoverageReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestsPerMinuteLimit: number;
  /** Every GPU the run attempted. */
  gpusMeasured: number;
  /**
   * GPUs the API actually answered for. THE DENOMINATOR for every coverage
   * percentage.
   *
   * A GPU whose request failed tells us nothing about the feed's contents for
   * it, so counting it as "no offers" would report a network problem as a
   * feed-coverage finding — and would make coverage look worse every time the
   * API had a bad minute. Failures are reported on their own line instead.
   */
  gpusSucceeded: number;
  gpus: GpuCoverage[];
  totals: {
    accepted: number;
    rejected: number;
    itemsSeen: number;
    pages: number;
    requests: number;
    rateLimited: number;
    httpErrors: number;
    transportErrors: number;
    failures: number;
    waitedMs: number;
  };
  rejectionsByReason: RejectionCounts;
  /** Ids that were measured successfully and genuinely had no accepted offer. */
  zeroOfferGpuIds: string[];
  /** Ids whose measurement did not complete. Coverage is UNKNOWN for these, not zero. */
  failedGpuIds: string[];
  failuresByCategory: Record<FailureCategory, number>;
  /** Counts per closed paging code, so a wave of paging failures is diagnosable. */
  pagingFailuresByReason: Record<string, number>;
  /**
   * Ids for which the feed returned no matching listing.
   *
   * A fact about the FEED. It is not a stock signal: a part can be on a shelf
   * and absent from the feed, so availability stays unknown either way.
   */
  emptyResultGpuIds: string[];
}

export const emptyFailureCounts = (): Record<FailureCategory, number> =>
  Object.fromEntries(ALL_FAILURE_CATEGORIES.map((c) => [c, 0])) as Record<FailureCategory, number>;

/** Sums per-GPU rejection counts into one total. */
export function totalRejections(gpus: readonly GpuCoverage[]): RejectionCounts {
  const total = emptyRejectionCounts();
  for (const gpu of gpus) {
    for (const reason of ALL_REJECTION_REASONS) total[reason] += gpu.rejectionsByReason[reason];
  }
  return total;
}

const pct = (n: number, of: number): string => (of === 0 ? '  n/a' : `${((n / of) * 100).toFixed(1).padStart(5)}%`);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number | string, w: number) => String(n).padStart(w);

/**
 * Renders the report as plain text.
 *
 * Written for the question this run exists to answer — "is there enough here
 * to build a shopping page on?" — so the acceptance rate and the zero-offer
 * list come first, and the rejection histogram is ordered by frequency
 * because the top row is the gate most worth arguing about.
 */
export function renderCoverageReport(report: CoverageReport): string {
  const t = report.totals;
  const lines: string[] = [];

  lines.push('Rakuten x Newegg — GPU offer coverage');
  lines.push('='.repeat(72));
  lines.push(`Started   ${report.startedAt}`);
  lines.push(`Finished  ${report.finishedAt}`);
  lines.push(`Runtime   ${(report.durationMs / 1000).toFixed(1)}s (${(t.waitedMs / 1000).toFixed(1)}s of it rate-limit waiting)`);
  lines.push(`Pacing    ${report.requestsPerMinuteLimit} requests/minute`);
  lines.push('');

  lines.push('API');
  lines.push(`  requests           ${num(t.requests, 6)}`);
  lines.push(`  pages read         ${num(t.pages, 6)}`);
  lines.push(`  429 responses      ${num(t.rateLimited, 6)}`);
  lines.push(`  other HTTP errors  ${num(t.httpErrors, 6)}`);
  lines.push(`  transport errors   ${num(t.transportErrors, 6)}`);
  lines.push(`  failed GPUs        ${num(t.failures, 6)}`);
  lines.push('');

  const withOffers = report.gpusSucceeded - report.zeroOfferGpuIds.length;

  lines.push('Coverage  (percentages are of GPUs measured OK — failures are excluded,');
  lines.push('           because a failed request tells us nothing about the feed\'s contents)');
  lines.push(`  GPUs attempted     ${num(report.gpusMeasured, 6)}`);
  lines.push(`  measured OK        ${num(report.gpusSucceeded, 6)}`);
  lines.push(`  failed / unknown   ${num(report.failedGpuIds.length, 6)}`);
  lines.push(`  with offers        ${num(withOffers, 6)}   ${pct(withOffers, report.gpusSucceeded)}`);
  lines.push(`  with zero offers   ${num(report.zeroOfferGpuIds.length, 6)}   ${pct(report.zeroOfferGpuIds.length, report.gpusSucceeded)}`);
  // Of the zeroes, how many did the feed return nothing for, versus how many
  // had listings that every gate refused. Same offer count, different causes:
  // one is about what the feed publishes, the other about what the matcher
  // admits. NEITHER is a statement about stock — see the availability note.
  lines.push(`    ...no feed listing ${num(report.emptyResultGpuIds.length, 4)}   (no matching Rakuten feed listing)`);
  lines.push(`    ...all rejected    ${num(report.zeroOfferGpuIds.length - report.emptyResultGpuIds.length, 4)}   (listings returned, none admitted)`);
  lines.push(`  listings seen      ${num(t.itemsSeen, 6)}`);
  lines.push(`  accepted           ${num(t.accepted, 6)}   ${pct(t.accepted, t.itemsSeen)} of listings`);
  lines.push(`  rejected           ${num(t.rejected, 6)}   ${pct(t.rejected, t.itemsSeen)} of listings`);
  lines.push('');

  lines.push('Rejections by reason (most frequent first)');
  const ranked = [...ALL_REJECTION_REASONS].sort((a, b) => report.rejectionsByReason[b] - report.rejectionsByReason[a]);
  for (const reason of ranked) {
    const n = report.rejectionsByReason[reason];
    lines.push(`  ${pad(reason, 26)} ${num(n, 6)}   ${pct(n, t.rejected)}`);
  }
  lines.push('');

  if (report.failedGpuIds.length > 0) {
    lines.push('Failures by category');
    for (const category of ALL_FAILURE_CATEGORIES) {
      const n = report.failuresByCategory[category];
      if (n > 0) lines.push(`  ${pad(category, 26)} ${num(n, 6)}`);
    }
    for (const [reason, n] of Object.entries(report.pagingFailuresByReason).sort((a, b) => b[1] - a[1])) {
      lines.push(`    paging: ${pad(reason, 24)} ${num(n, 4)}`);
    }
    lines.push('');
  }

  lines.push('Per GPU');
  lines.push(`  ${pad('id', 14)}${pad('name', 22)}${num('seen', 6)}${num('acc', 6)}${num('rej', 6)}${num('pages', 7)}  status`);
  for (const gpu of report.gpus) {
    const status =
      gpu.status === 'failed'
        ? `FAILED (${gpu.failure!.category}${gpu.failure!.httpStatus === null ? '' : ` ${gpu.failure!.httpStatus}`}${gpu.failure!.pagingReason === null ? '' : `: ${gpu.failure!.pagingReason}`})`
        : gpu.accepted === 0
          ? gpu.emptyResult
            ? 'no feed listing'
            : 'all rejected'
          : '';
    lines.push(
      `  ${pad(gpu.gpuId, 14)}${pad(gpu.gpuName, 22)}${num(gpu.itemsSeen, 6)}${num(gpu.accepted, 6)}${num(gpu.rejected, 6)}${num(gpu.pagesRead, 7)}  ${status}`,
    );
  }
  lines.push('');

  lines.push('Availability is UNKNOWN for every GPU here. The Product Search feed is a');
  lines.push('catalogue of listings, not an inventory: absence from it means no matching');
  lines.push('feed listing, and says nothing about whether the retailer holds the part.');
  lines.push('');

  if (report.zeroOfferGpuIds.length > 0) {
    lines.push(`Measured OK, zero accepted offers (${report.zeroOfferGpuIds.length})`);
    lines.push(`  ${report.zeroOfferGpuIds.join(' ')}`);
  } else if (report.gpusSucceeded > 0) {
    lines.push('Every GPU measured OK produced at least one accepted offer.');
  }

  if (report.failedGpuIds.length > 0) {
    lines.push('');
    lines.push(`Not measured — coverage UNKNOWN, not zero (${report.failedGpuIds.length})`);
    lines.push(`  ${report.failedGpuIds.join(' ')}`);
  }

  return lines.join('\n');
}
