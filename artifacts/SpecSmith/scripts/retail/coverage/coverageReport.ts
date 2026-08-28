// Builds and renders the coverage report.
//
// WHAT THIS FILE MAY NOT CONTAIN
// ------------------------------
// Counts, ids, names and reasons. Never a tracked URL, never a publisher or
// offer identifier, never a token. That is enforced structurally rather than
// by care: the report type below has no field capable of holding a URL, so
// an accepted offer's `trackedAffiliateUrl` and `imageUrl` are never copied
// anywhere a renderer could reach them. `scrubMessage` covers the one
// remaining route — an upstream error message quoting a response body — and a
// test renders a report built from offers with real linksynergy URLs and
// asserts none of it survives.
//
// Pure: no I/O, no clock, no process. The CLI supplies timings.

import type { OfferRejectionReason } from '../rakuten/types';

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

export interface GpuCoverage {
  gpuId: string;
  gpuName: string;
  status: 'ok' | 'failed';
  accepted: number;
  rejected: number;
  itemsSeen: number;
  pagesRead: number;
  totalMatches: number | null;
  rejectionsByReason: RejectionCounts;
  /** Error class name when status is 'failed'. */
  failureKind: string | null;
  /** Scrubbed error text when status is 'failed'. */
  failureMessage: string | null;
}

export interface CoverageReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestsPerMinuteLimit: number;
  gpusMeasured: number;
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
  /** Catalog ids that produced no accepted offer, including ones whose fetch failed. */
  zeroOfferGpuIds: string[];
}

/**
 * Strips anything URL-shaped out of an error message and caps its length.
 *
 * The adapter already redacts the access token from its own errors. This
 * covers the other direction: an HTTP error body echoed into a message could
 * carry a tracked link, and a coverage report is a document people paste into
 * issues and chat.
 */
export function scrubMessage(message: string, maxLength = 300): string {
  const scrubbed = String(message)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:id|offerid|linkid|token)=\S*/gi, '[redacted-param]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength)}…` : scrubbed;
}

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

  lines.push('Coverage');
  lines.push(`  GPUs measured      ${num(report.gpusMeasured, 6)}`);
  lines.push(`  GPUs with offers   ${num(report.gpusMeasured - report.zeroOfferGpuIds.length, 6)}   ${pct(report.gpusMeasured - report.zeroOfferGpuIds.length, report.gpusMeasured)}`);
  lines.push(`  GPUs with none     ${num(report.zeroOfferGpuIds.length, 6)}   ${pct(report.zeroOfferGpuIds.length, report.gpusMeasured)}`);
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

  lines.push('Per GPU');
  lines.push(`  ${pad('id', 14)}${pad('name', 22)}${num('seen', 6)}${num('acc', 6)}${num('rej', 6)}${num('pages', 7)}  status`);
  for (const gpu of report.gpus) {
    const status = gpu.status === 'failed' ? `FAILED ${gpu.failureKind}: ${gpu.failureMessage}` : gpu.accepted === 0 ? 'no offers' : '';
    lines.push(
      `  ${pad(gpu.gpuId, 14)}${pad(gpu.gpuName, 22)}${num(gpu.itemsSeen, 6)}${num(gpu.accepted, 6)}${num(gpu.rejected, 6)}${num(gpu.pagesRead, 7)}  ${status}`,
    );
  }
  lines.push('');

  if (report.zeroOfferGpuIds.length > 0) {
    lines.push(`GPUs with zero accepted offers (${report.zeroOfferGpuIds.length})`);
    lines.push(`  ${report.zeroOfferGpuIds.join(' ')}`);
  } else {
    lines.push('Every measured GPU produced at least one accepted offer.');
  }

  return lines.join('\n');
}
