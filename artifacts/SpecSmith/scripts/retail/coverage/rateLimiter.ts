// Sequential request pacing for the coverage run.
//
// Rakuten's published ceiling is 100 calls per minute. TWO constraints enforce
// it, and both must be satisfied before a request goes out:
//
//   1. SMOOTHING — a minimum gap of windowMs/maxPerWindow between consecutive
//      requests, so the run trickles across the minute instead of firing the
//      first 90 as fast as the network allows and then sitting idle. A burst
//      is within the letter of a per-minute limit and is still the shape most
//      likely to trip server-side protection, to look like abuse in a rate
//      report, and to collide with anything else using the same account.
//   2. ROLLING WINDOW — never more than maxPerWindow timestamps inside any
//      60-second span. With uniform smoothing this is usually not the binding
//      constraint, which is exactly why it is kept: it is the backstop for the
//      cases smoothing does not cover, such as a clock that jumps, or a future
//      change that loosens the gap.
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
  private lastRequestAt: number | null = null;
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

  /**
   * Minimum gap between consecutive requests.
   *
   * Rounded UP, so N requests genuinely occupy at least one window rather than
   * landing a fraction under it and letting an extra request in at the edge.
   */
  get minIntervalMs(): number {
    return Math.ceil(this.windowMs / this.maxPerWindow);
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

      // Constraint 1: spacing. A negative elapsed (a clock that stepped
      // backwards) yields a wait larger than the interval, which is the safe
      // direction — it never shortens the gap.
      const sinceLast = this.lastRequestAt === null ? Number.POSITIVE_INFINITY : now - this.lastRequestAt;
      const spacingWait = sinceLast >= this.minIntervalMs ? 0 : this.minIntervalMs - sinceLast;

      // Constraint 2: the rolling window. The +1 avoids a spin when
      // now - oldest lands precisely on the boundary.
      const windowWait =
        this.timestamps.length < this.maxPerWindow ? 0 : this.timestamps[0] + this.windowMs - now + 1;

      const wait = Math.max(spacingWait, windowWait);
      if (wait <= 0) {
        this.timestamps.push(now);
        this.lastRequestAt = now;
        this.waited += waitedHere;
        return waitedHere;
      }
      await this.clock.sleep(wait);
      waitedHere += wait;
    }
  }
}
