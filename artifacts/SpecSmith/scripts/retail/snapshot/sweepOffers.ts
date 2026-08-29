// The sweep behind a snapshot: every catalogue GPU, sequentially, paced.
//
// Deliberately NOT measureCoverage. That tool answers "how much does the feed
// cover?" and its report type has nowhere to put a URL or a SKU on purpose —
// it is a document people paste into issues. This one needs the offers
// themselves, so it keeps them and produces nothing human-readable. Two tools
// with two outputs beats one tool with a flag that changes what it may carry.
//
// Everything else is shared: the same adapter entry point, the same rate
// limiter, the same instrumented fetch, the same closed failure categories. A
// second idea of how to pace requests against this account is the last thing
// this repository needs.

import { fetchNeweggOffersForGpu } from '../rakuten';
import type { CatalogGpu } from '../rakuten/types';
import { createInstrumentedFetch, type FetchStats } from '../coverage/instrumentedFetch';
import { classifyFailure } from '../coverage/measureCoverage';
import { RateLimiter, systemClock, type Clock } from '../coverage/rateLimiter';
import type { GpuSweepOutcome } from './buildSnapshot';

export interface SweepOptions {
  catalog: readonly CatalogGpu[];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  requestsPerMinute?: number;
  onProgress?: (done: number, total: number, outcome: GpuSweepOutcome) => void;
}

export interface SweepResult {
  outcomes: GpuSweepOutcome[];
  stats: Readonly<FetchStats>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/**
 * Sweeps the catalogue.
 *
 * A failed GPU is RECORDED, not thrown and not skipped. It has to reach
 * buildSnapshot, because "one GPU failed" is the difference between a snapshot
 * that may be published and one that may not — and an exception here would
 * lose the other fifty-six results along with the reason.
 */
export async function sweepOffers(options: SweepOptions): Promise<SweepResult> {
  const clock = options.clock ?? systemClock;
  const limiter = new RateLimiter(options.requestsPerMinute, clock);
  const { fetch, stats } = createInstrumentedFetch({ fetch: options.fetch, limiter, clock });

  const startedMs = clock.now();
  const outcomes: GpuSweepOutcome[] = [];

  for (const gpu of options.catalog) {
    outcomes.push(await sweepOne(gpu, { env: options.env, fetch, now: () => new Date(clock.now()) }));
    options.onProgress?.(outcomes.length, options.catalog.length, outcomes[outcomes.length - 1]);
  }

  const finishedMs = clock.now();
  return {
    outcomes,
    stats,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
  };
}

async function sweepOne(
  gpu: CatalogGpu,
  deps: { env?: NodeJS.ProcessEnv; fetch: typeof globalThis.fetch; now: () => Date },
): Promise<GpuSweepOutcome> {
  try {
    const result = await fetchNeweggOffersForGpu(gpu, deps);
    // Rejections are counted and dropped here. They are diagnostic — the
    // coverage tool exists to report them — and a snapshot that carried the
    // listings it refused would be publishing the wrong cards' prices.
    return {
      gpuId: gpu.id,
      status: 'ok',
      offers: result.offers,
      emptyResult: result.emptyResult,
      itemsSeen: result.itemsSeen,
    };
  } catch (cause) {
    // Classified from the error's TYPE, never its message: a message can quote
    // a response body or a URL with a publisher id in it.
    return { gpuId: gpu.id, status: 'failed', failure: classifyFailure(cause) };
  }
}
