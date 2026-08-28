import { describe, it, expect } from 'vitest';

import { createInstrumentedFetch } from './instrumentedFetch';
import { RateLimiter, type Clock } from './rateLimiter';

function fakeClock(): Clock {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

const respond = (status: number, body = '<result/>') =>
  (async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;

describe('createInstrumentedFetch', () => {
  it('counts every request it issues', async () => {
    const { fetch, stats } = createInstrumentedFetch({ fetch: respond(200), clock: fakeClock() });
    await fetch('https://example.invalid/1');
    await fetch('https://example.invalid/2');
    expect(stats).toMatchObject({ requests: 2, rateLimited: 0, httpErrors: 0, transportErrors: 0 });
  });

  it('retries a 429 with exponential backoff and counts each one', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      return new Response('', { status: calls <= 2 ? 429 : 200 });
    }) as unknown as typeof globalThis.fetch;

    const clock = fakeClock();
    const { fetch, stats } = createInstrumentedFetch({ fetch: flaky, clock, backoffMs: 1_000 });
    const response = await fetch('https://example.invalid/');

    expect(response.status).toBe(200);
    expect(stats.requests).toBe(3);
    expect(stats.rateLimited).toBe(2);
    // 1000 then 2000 — doubling, not a flat retry.
    expect(stats.waitedMs).toBe(3_000);
  });

  it('gives up after the retry budget and hands the 429 back', async () => {
    const clock = fakeClock();
    const { fetch, stats } = createInstrumentedFetch({ fetch: respond(429), clock, maxRetriesOn429: 2, backoffMs: 1 });
    const response = await fetch('https://example.invalid/');
    expect(response.status).toBe(429);
    expect(stats.requests).toBe(3);
    expect(stats.rateLimited).toBe(3);
  });

  it('counts a non-429 HTTP error without retrying it', async () => {
    const { fetch, stats } = createInstrumentedFetch({ fetch: respond(500), clock: fakeClock() });
    await fetch('https://example.invalid/');
    expect(stats).toMatchObject({ requests: 1, httpErrors: 1, rateLimited: 0 });
  });

  it('counts a transport error and rethrows it unchanged', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;
    const { fetch, stats } = createInstrumentedFetch({ fetch: boom, clock: fakeClock() });
    await expect(fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(stats).toMatchObject({ requests: 1, transportErrors: 1 });
  });

  it('paces through the limiter, and 429 retries are paced too', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(2, clock, 60_000);
    const { fetch, stats } = createInstrumentedFetch({ fetch: respond(429), clock, limiter, maxRetriesOn429: 2, backoffMs: 0 });
    await fetch('https://example.invalid/');
    // Three attempts against a 2-per-window limiter: the third had to wait.
    expect(stats.requests).toBe(3);
    expect(limiter.waitedMs).toBeGreaterThan(0);
  });
});
