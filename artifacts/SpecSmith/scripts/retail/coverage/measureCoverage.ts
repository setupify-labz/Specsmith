// The measurement run itself, minus the process.
//
// Split from the CLI so the whole sweep is testable against a fake fetch: the
// CLI supplies argv, the environment, stdout and the real clock; everything
// that decides what gets measured lives here.

import {
  fetchNeweggOffersForGpu,
  RakutenAuthError,
  RakutenPagingError,
  RakutenRequestError,
  RakutenXmlError,
} from '../rakuten';
import type { CatalogGpu, OfferRejectionReason } from '../rakuten/types';
import { createInstrumentedFetch, type FetchStats } from './instrumentedFetch';
import {
  ALL_FAILURE_CATEGORIES,
  emptyFailureCounts,
  emptyRejectionCounts,
  totalRejections,
  type CoverageReport,
  type FailureCategory,
  type GpuCoverage,
  type GpuFailure,
} from './coverageReport';
import { RateLimiter, systemClock, type Clock } from './rateLimiter';

export interface MeasureOptions {
  catalog: readonly CatalogGpu[];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  requestsPerMinute?: number;
  maxRetriesOn429?: number;
  backoffMs?: number;
  /** Called after each GPU so a long run shows progress. */
  onProgress?: (done: number, total: number, gpu: GpuCoverage) => void;
}

/**
 * Measures every catalog GPU, SEQUENTIALLY.
 *
 * Sequential is not a simplification: the rate limiter can only pace what it
 * can see, and concurrent requests would let a burst past it before the window
 * had recorded them. The run is a few dozen requests and finishes in about a
 * minute; there is nothing to gain from parallelism here and an account's
 * standing to lose.
 *
 * A GPU whose fetch fails is RECORDED, not skipped and not fatal. One bad
 * keyword must not cost the other 56 measurements, and a failure that vanished
 * from the report would be indistinguishable from a GPU that genuinely has no
 * offers — which is the single most important distinction this run produces.
 */
export async function measureCoverage(options: MeasureOptions): Promise<CoverageReport> {
  const clock = options.clock ?? systemClock;
  const limiter = new RateLimiter(options.requestsPerMinute, clock);
  const { fetch, stats } = createInstrumentedFetch({
    fetch: options.fetch,
    limiter,
    clock,
    maxRetriesOn429: options.maxRetriesOn429,
    backoffMs: options.backoffMs,
  });

  const startedMs = clock.now();
  const startedAt = new Date(startedMs).toISOString();
  const gpus: GpuCoverage[] = [];

  for (const gpu of options.catalog) {
    gpus.push(await measureOne(gpu, { env: options.env, fetch, now: () => new Date(clock.now()) }));
    options.onProgress?.(gpus.length, options.catalog.length, gpus[gpus.length - 1]);
  }

  const finishedMs = clock.now();
  return buildReport({
    gpus,
    stats,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    requestsPerMinuteLimit: options.requestsPerMinute ?? 90,
  });
}

async function measureOne(
  gpu: CatalogGpu,
  deps: { env?: NodeJS.ProcessEnv; fetch: typeof globalThis.fetch; now: () => Date },
): Promise<GpuCoverage> {
  const base = {
    gpuId: gpu.id,
    gpuName: gpu.name,
    rejectionsByReason: emptyRejectionCounts(),
  };
  try {
    const result = await fetchNeweggOffersForGpu(gpu, deps);
    const counts = emptyRejectionCounts();
    for (const r of result.rejected) counts[r.reason as OfferRejectionReason] += 1;
    return {
      ...base,
      status: 'ok',
      accepted: result.offers.length,
      rejected: result.rejected.length,
      itemsSeen: result.itemsSeen,
      pagesRead: result.pagesRead,
      totalMatches: result.totalMatches,
      emptyResult: result.emptyResult,
      rejectionsByReason: counts,
      failure: null,
    };
  } catch (cause) {
    return {
      ...base,
      status: 'failed',
      accepted: 0,
      rejected: 0,
      itemsSeen: 0,
      pagesRead: 0,
      totalMatches: null,
      emptyResult: false,
      failure: classifyFailure(cause),
    };
  }
}

/**
 * Maps a thrown value to a closed category and, where one exists, a status number.
 *
 * Deliberately reads only the error's TYPE and its numeric status — never its
 * message. The message is the one part an attacker or a misbehaving server
 * controls, and this is the boundary where it would otherwise enter a document
 * people paste into issues and chat.
 */
export function classifyFailure(cause: unknown): GpuFailure {
  if (cause instanceof RakutenAuthError) return { category: 'auth', httpStatus: null, pagingReason: null };
  if (cause instanceof RakutenPagingError) {
    // The code is a closed union defined in the adapter, so copying it here
    // cannot import free text.
    return { category: 'paging', httpStatus: null, pagingReason: cause.code };
  }
  if (cause instanceof RakutenXmlError) return { category: 'malformed-xml', httpStatus: null, pagingReason: null };
  if (cause instanceof RakutenRequestError) {
    // The adapter uses status 0 for "never got an HTTP response at all".
    return cause.httpStatus === 0
      ? { category: 'transport', httpStatus: null, pagingReason: null }
      : { category: 'http-status', httpStatus: cause.httpStatus, pagingReason: null };
  }
  return { category: 'unexpected', httpStatus: null, pagingReason: null };
}

/** Assembles the totals. Pure, so the shape can be asserted without a run. */
export function buildReport(input: {
  gpus: GpuCoverage[];
  stats: Readonly<FetchStats>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestsPerMinuteLimit: number;
}): CoverageReport {
  const { gpus, stats } = input;
  const sum = (pick: (g: GpuCoverage) => number) => gpus.reduce((n, g) => n + pick(g), 0);

  const succeeded = gpus.filter((g) => g.status === 'ok');
  const failed = gpus.filter((g) => g.status === 'failed');

  const failuresByCategory = emptyFailureCounts();
  const pagingFailuresByReason: Record<string, number> = {};
  for (const g of failed) {
    const category: FailureCategory = g.failure?.category ?? 'unexpected';
    failuresByCategory[ALL_FAILURE_CATEGORIES.includes(category) ? category : 'unexpected'] += 1;
    const reason = g.failure?.pagingReason;
    if (reason) pagingFailuresByReason[reason] = (pagingFailuresByReason[reason] ?? 0) + 1;
  }

  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    requestsPerMinuteLimit: input.requestsPerMinuteLimit,
    gpusMeasured: gpus.length,
    gpusSucceeded: succeeded.length,
    gpus,
    totals: {
      accepted: sum((g) => g.accepted),
      rejected: sum((g) => g.rejected),
      itemsSeen: sum((g) => g.itemsSeen),
      pages: sum((g) => g.pagesRead),
      requests: stats.requests,
      rateLimited: stats.rateLimited,
      httpErrors: stats.httpErrors,
      transportErrors: stats.transportErrors,
      failures: failed.length,
      waitedMs: stats.waitedMs,
    },
    rejectionsByReason: totalRejections(gpus),
    // SUCCESSFUL zero-offer GPUs only. A GPU whose request failed produced no
    // offers either, but for a different reason and with a different meaning:
    // "no matching feed listing" is a finding about the feed, "we could not
    // ask" is a finding about the network. Merging them would let a bad API
    // minute masquerade as poor coverage.
    zeroOfferGpuIds: succeeded.filter((g) => g.accepted === 0).map((g) => g.gpuId),
    failedGpuIds: failed.map((g) => g.gpuId),
    failuresByCategory,
    pagingFailuresByReason,
    emptyResultGpuIds: succeeded.filter((g) => g.emptyResult).map((g) => g.gpuId),
  };
}
