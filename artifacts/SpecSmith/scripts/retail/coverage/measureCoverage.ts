// The measurement run itself, minus the process.
//
// Split from the CLI so the whole sweep is testable against a fake fetch: the
// CLI supplies argv, the environment, stdout and the real clock; everything
// that decides what gets measured lives here.

import { fetchNeweggOffersForGpu } from '../rakuten';
import type { CatalogGpu, OfferRejectionReason } from '../rakuten/types';
import { createInstrumentedFetch, type FetchStats } from './instrumentedFetch';
import {
  emptyRejectionCounts,
  scrubMessage,
  totalRejections,
  type CoverageReport,
  type GpuCoverage,
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
      rejectionsByReason: counts,
      failureKind: null,
      failureMessage: null,
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
      failureKind: cause instanceof Error ? cause.constructor.name : typeof cause,
      failureMessage: scrubMessage(cause instanceof Error ? cause.message : String(cause)),
    };
  }
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

  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    requestsPerMinuteLimit: input.requestsPerMinuteLimit,
    gpusMeasured: gpus.length,
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
      failures: gpus.filter((g) => g.status === 'failed').length,
      waitedMs: stats.waitedMs,
    },
    rejectionsByReason: totalRejections(gpus),
    // A failed GPU has zero accepted offers and belongs here — but the per-GPU
    // table says FAILED next to it, so the two are never conflated.
    zeroOfferGpuIds: gpus.filter((g) => g.accepted === 0).map((g) => g.gpuId),
  };
}
