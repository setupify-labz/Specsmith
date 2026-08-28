// A fetch wrapper that paces, counts, and retries 429s — without the adapter
// knowing any of it exists.
//
// The adapter takes `deps.fetch`, so measurement instrumentation goes HERE
// rather than inside it. That matters beyond tidiness: the adapter is merged
// and approved, and a measurement tool that required editing it would put the
// thing being measured and the thing doing the measuring in the same commit.
//
// WHY IT RETRIES 429 ITSELF
// -------------------------
// `fetchProductSearchXml` throws RakutenRequestError on any non-2xx, so an
// un-retried 429 fails that whole GPU and shows up as "no offers" — the exact
// number this run exists to measure, corrupted by a transport condition. So a
// 429 is absorbed here, counted, and retried with exponential backoff; only a
// 429 that survives every retry reaches the adapter as a failure.

import type { Clock } from './rateLimiter';
import { RateLimiter, systemClock } from './rateLimiter';

export interface FetchStats {
  /** Every HTTP request actually issued, retries included. */
  requests: number;
  /** 429 responses received, counting each retry separately. */
  rateLimited: number;
  /** Non-2xx responses that were not 429. */
  httpErrors: number;
  /** fetch() rejections — DNS, TLS, connection reset. */
  transportErrors: number;
  /** Milliseconds spent waiting on the limiter or on 429 backoff. */
  waitedMs: number;
}

export interface InstrumentedFetchOptions {
  fetch?: typeof globalThis.fetch;
  limiter?: RateLimiter;
  clock?: Clock;
  /** Retries per request after a 429. Each retry is itself paced and counted. */
  maxRetriesOn429?: number;
  /** First backoff step; doubles per retry. */
  backoffMs?: number;
}

export interface InstrumentedFetch {
  fetch: typeof globalThis.fetch;
  stats: Readonly<FetchStats>;
}

export function createInstrumentedFetch(options: InstrumentedFetchOptions = {}): InstrumentedFetch {
  const inner = options.fetch ?? globalThis.fetch;
  const clock = options.clock ?? systemClock;
  const limiter = options.limiter ?? new RateLimiter(undefined, clock);
  const maxRetries = options.maxRetriesOn429 ?? 3;
  const backoffMs = options.backoffMs ?? 2_000;

  const stats: FetchStats = { requests: 0, rateLimited: 0, httpErrors: 0, transportErrors: 0, waitedMs: 0 };

  const instrumented = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      stats.waitedMs += await limiter.acquire();
      stats.requests += 1;

      let response: Response;
      try {
        response = await inner(input, init);
      } catch (cause) {
        // Counted, then rethrown unchanged: the adapter turns it into a
        // RakutenRequestError with the token redacted, and duplicating that
        // here would mean two places deciding how a transport error is worded.
        stats.transportErrors += 1;
        throw cause;
      }

      if (response.status === 429) {
        stats.rateLimited += 1;
        if (attempt < maxRetries) {
          const wait = backoffMs * 2 ** attempt;
          await clock.sleep(wait);
          stats.waitedMs += wait;
          continue;
        }
        // Out of retries: hand the 429 to the adapter, which fails this GPU.
        return response;
      }

      if (!response.ok) stats.httpErrors += 1;
      return response;
    }
  }) as unknown as typeof globalThis.fetch;

  return { fetch: instrumented, stats };
}
