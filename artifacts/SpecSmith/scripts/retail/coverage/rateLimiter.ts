// Sequential request pacing for the coverage run.
//
// Rakuten's published ceiling is 100 calls per minute. This is a SLIDING
// WINDOW rather than a fixed delay because the two behave differently at
// exactly the moment it matters: a fixed 600ms gap is fine in steady state but
// says nothing about a burst that straddles a minute boundary, whereas a
// window that remembers the last N timestamps cannot exceed N in any 60-second
// span no matter how the requests are distributed.
//
// The default is deliberately BELOW the ceiling. A limiter tuned exactly to
// the documented limit has no margin for the server counting slightly
// differently (arrival time vs completion time, its clock vs ours), and the
// cost of being wrong is a 429 storm against an account this pilot depends on.
//
// Clock and sleep are injected so tests exercise the pacing logic in
// milliseconds rather than minutes.

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Rakuten's documented ceiling. Not the default — see DEFAULT_REQUESTS_PER_MINUTE. */
export const RAKUTEN_CALLS_PER_MINUTE = 100;

/** 10% under the ceiling, as headroom against clock skew and counting differences. */
export const DEFAULT_REQUESTS_PER_MINUTE = 90;

export const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly timestamps: number[] = [];
  /** Total time spent waiting, so the report can say how much of the runtime was pacing. */
  private waited = 0;

  constructor(
    private readonly maxPerWindow: number = DEFAULT_REQUESTS_PER_MINUTE,
    private readonly clock: Clock = systemClock,
    private readonly windowMs: number = WINDOW_MS,
  ) {
    if (!Number.isInteger(maxPerWindow) || maxPerWindow < 1) {
      throw new RangeError(`Requests per minute must be a positive integer; got ${maxPerWindow}.`);
    }
    if (maxPerWindow > RAKUTEN_CALLS_PER_MINUTE) {
      throw new RangeError(
        `Requests per minute ${maxPerWindow} exceeds Rakuten's documented ${RAKUTEN_CALLS_PER_MINUTE}/minute limit. This tool will not be configured to break a published rate limit.`,
      );
    }
  }

  get waitedMs(): number {
    return this.waited;
  }

  /** Blocks until another request may be made, then records it. Returns ms waited. */
  async acquire(): Promise<number> {
    let waitedHere = 0;
    for (;;) {
      const now = this.clock.now();
      // Drop anything that has aged out of the window.
      while (this.timestamps.length > 0 && now - this.timestamps[0] >= this.windowMs) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.maxPerWindow) {
        this.timestamps.push(now);
        this.waited += waitedHere;
        return waitedHere;
      }
      // Wait exactly until the oldest request leaves the window. The +1 avoids
      // a spin when now - oldest lands precisely on the boundary.
      const wait = this.timestamps[0] + this.windowMs - now + 1;
      await this.clock.sleep(wait);
      waitedHere += wait;
    }
  }
}
