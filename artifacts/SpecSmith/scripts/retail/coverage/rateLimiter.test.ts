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
  it('smooths requests across the window instead of letting the first N burst', async () => {
    // The regression: previously all 5 went out instantly and the minute was
    // then idle. A burst is within the letter of a per-minute limit and is
    // still the shape most likely to trip server-side protection.
    const clock = fakeClock();
    const limiter = new RateLimiter(5, clock, 60_000);
    expect(limiter.minIntervalMs).toBe(12_000);

    const at: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
      at.push(clock.elapsed);
    }
    expect(at).toEqual([0, 12_000, 24_000, 36_000, 48_000]);
  });

  it('only the first request goes out immediately', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(90, clock);
    expect(await limiter.acquire()).toBe(0);
    expect(await limiter.acquire()).toBe(667); // ceil(60000/90)
  });

  it('does not re-wait when the caller was already slow', async () => {
    // Spacing is a minimum gap, not a fixed schedule: real work between
    // requests counts toward it.
    const clock = fakeClock();
    const limiter = new RateLimiter(90, clock);
    await limiter.acquire();
    clock.advance(5_000);
    expect(await limiter.acquire()).toBe(0);
  });

  it('rounds the interval up, so N requests occupy at least a full window', async () => {
    const limiter = new RateLimiter(7, fakeClock(), 1_000);
    expect(limiter.minIntervalMs).toBe(143); // 1000/7 = 142.857 -> 143
    expect(limiter.minIntervalMs * 7).toBeGreaterThanOrEqual(1_000);
  });

  it('still applies the rolling window when spacing alone would allow a request', async () => {
    // The backstop, exercised directly: the clock is advanced externally so
    // the spacing constraint is already satisfied, and only the window is left
    // to stop the request.
    const clock = fakeClock();
    const limiter = new RateLimiter(2, clock, 1_000); // minInterval 500
    await limiter.acquire(); // t = 0
    clock.advance(500);
    await limiter.acquire(); // t = 500, window now holds [0, 500]
    clock.advance(499); // t = 999: 499 since last is < 500, window is full
    const waited = await limiter.acquire();
    // Window wants t >= 1001 (oldest 0 + 1000 + 1); spacing only wanted 1000.
    expect(waited).toBe(2);
    expect(clock.elapsed).toBe(1_001);
  });

  it('never shortens the gap when the clock steps backwards', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock, 1_000); // minInterval 100
    await limiter.acquire();
    clock.advance(-50);
    // sinceLast is negative, so the wait is longer than the interval, not shorter.
    expect(await limiter.acquire()).toBe(150);
  });

  it('never exceeds the limit in any window', async () => {
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
    // 1001 twice: at one request per window the rolling-window bound (+1ms to
    // clear the boundary) is fractionally longer than the spacing bound.
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
