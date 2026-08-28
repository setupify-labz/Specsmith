import { describe, it, expect } from 'vitest';

import { DEFAULT_REQUESTS_PER_MINUTE, RAKUTEN_CALLS_PER_MINUTE, RateLimiter, type Clock } from './rateLimiter';

/** A clock that only moves when slept on, so pacing is testable in microseconds. */
function fakeClock(): Clock & { advance(ms: number): void; readonly elapsed: number } {
  let t = 1_000_000;
  const start = t;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    get elapsed() {
      return t - start;
    },
  };
}

describe('RateLimiter', () => {
  it('lets the first N requests through without waiting', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(5, clock);
    for (let i = 0; i < 5; i += 1) expect(await limiter.acquire()).toBe(0);
    expect(clock.elapsed).toBe(0);
  });

  it('waits exactly until the oldest request leaves the window', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(3, clock, 60_000);
    await limiter.acquire();
    clock.advance(10_000);
    await limiter.acquire();
    await limiter.acquire();
    // Window is full; the oldest was 10s ago, so the next may go at +60s.
    const waited = await limiter.acquire();
    expect(waited).toBe(50_001);
  });

  it('never exceeds the limit in any window, even for a burst straddling the boundary', async () => {
    // The property a fixed inter-request delay does not give you.
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock, 60_000);
    const times: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      await limiter.acquire();
      times.push(clock.now());
    }
    for (const t of times) {
      const inWindow = times.filter((other) => other >= t && other < t + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(10);
    }
  });

  it('accumulates the time it spent waiting', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1, clock, 1_000);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.waitedMs).toBe(2_002);
  });

  it('refuses to be configured above Rakuten\'s published limit', () => {
    expect(() => new RateLimiter(RAKUTEN_CALLS_PER_MINUTE + 1)).toThrow(/exceeds Rakuten/);
    expect(() => new RateLimiter(0)).toThrow(RangeError);
    expect(() => new RateLimiter(1.5)).toThrow(RangeError);
  });

  it('defaults below the ceiling, leaving headroom', () => {
    expect(DEFAULT_REQUESTS_PER_MINUTE).toBeLessThan(RAKUTEN_CALLS_PER_MINUTE);
  });
});
