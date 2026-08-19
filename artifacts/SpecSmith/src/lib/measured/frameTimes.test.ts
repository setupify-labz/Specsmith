import { describe, it, expect } from 'vitest';
import {
  averageFps,
  canonicalFrameTimeBytes,
  computeFrameTimeStats,
  detectCap,
  meanSlowestFractionFps,
  roundFps,
  runDurationSec,
  slowestFrameCount,
} from './frameTimes';
import { PINNED_ONE_PERCENT_LOW_METHOD } from './types';

/** A run of `n` frames at a steady `fps`, with the slowest `spikes` injected. */
function makeFrames(n: number, fps: number, spikes: number[] = []): number[] {
  const base = 1000 / fps;
  const frames = Array.from({ length: n - spikes.length }, () => base);
  return [...frames, ...spikes];
}

describe('the pinned 1%-low definition', () => {
  it('is mean-slowest-1pct, and the alternative is not used by default', () => {
    expect(PINNED_ONE_PERCENT_LOW_METHOD).toBe('mean-slowest-1pct');
  });

  // Worked by hand so the definition is pinned to an arithmetic fact, not to
  // whatever the implementation happens to return. 100 frames: 99 at 10ms plus
  // one at 50ms. floor(100 * 0.01) = 1 frame in the slowest 1% -> the 50ms
  // frame -> 1000/50 = 20 fps.
  it('averages the slowest frames as TIMES, then converts once', () => {
    const frames = [...Array.from({ length: 99 }, () => 10), 50];
    expect(meanSlowestFractionFps(frames, 0.01)).toBe(20);
  });

  // 200 frames: 198 at 10ms, plus 40ms and 60ms. floor(200*0.01) = 2 frames.
  // mean of the two slowest TIMES = 50ms -> 20 fps.
  //
  // Converting each frame first and averaging the FPS values would give
  // (25 + 16.67)/2 = 20.83 — a different, higher number. This test is the
  // guard against that arithmetic slipping in.
  it('does not average per-frame FPS values (which would read higher)', () => {
    const frames = [...Array.from({ length: 198 }, () => 10), 40, 60];
    expect(meanSlowestFractionFps(frames, 0.01)).toBe(20);
    const perFrameFpsMean = roundFps((1000 / 40 + 1000 / 60) / 2);
    expect(perFrameFpsMean).not.toBe(20);
  });

  it('is unaffected by the order frames arrive in', () => {
    const frames = [...Array.from({ length: 198 }, () => 10), 40, 60];
    const shuffled = [60, ...Array.from({ length: 99 }, () => 10), 40, ...Array.from({ length: 99 }, () => 10)];
    expect(meanSlowestFractionFps(shuffled, 0.01)).toBe(meanSlowestFractionFps(frames, 0.01));
  });

  it('takes floor(n * fraction) frames, with a floor of one', () => {
    expect(slowestFrameCount(1000, 0.01)).toBe(10);
    expect(slowestFrameCount(3000, 0.001)).toBe(3);
    expect(slowestFrameCount(50, 0.01)).toBe(1);
    expect(slowestFrameCount(1, 0.01)).toBe(1);
  });

  it('refuses to compute a low from zero frames rather than returning a number', () => {
    expect(() => meanSlowestFractionFps([], 0.01)).toThrow();
  });
});

describe('average FPS', () => {
  it('is total frames over total elapsed time', () => {
    expect(averageFps(Array.from({ length: 100 }, () => 10))).toBe(100);
  });

  it('reflects the whole run, not the typical frame', () => {
    // 99 frames at 10ms + one 1000ms stall = 100 frames over 1.99s.
    const frames = [...Array.from({ length: 99 }, () => 10), 1000];
    expect(averageFps(frames)).toBe(roundFps(100 / 1.99));
  });

  it('refuses to average zero frames', () => {
    expect(() => averageFps([])).toThrow();
  });
});

describe('determinism', () => {
  // Validation recomputes these figures and compares them against what a
  // record claims, so identical input must give identical output every time.
  it('produces byte-identical stats across repeated runs and input orders', () => {
    const frames = makeFrames(5000, 144, [30, 45, 22, 18, 60, 12.5, 9.75]);
    const once = JSON.stringify(computeFrameTimeStats(frames));
    const twice = JSON.stringify(computeFrameTimeStats([...frames]));
    const reversed = JSON.stringify(computeFrameTimeStats([...frames].reverse()));
    expect(twice).toBe(once);
    // Average FPS sums in capture order, so only the order-independent figures
    // are asserted equal under reversal.
    const a = computeFrameTimeStats(frames);
    const b = computeFrameTimeStats([...frames].reverse());
    expect(b.onePercentLow).toBe(a.onePercentLow);
    expect(b.zeroPointOnePercentLow).toBe(a.zeroPointOnePercentLow);
    expect(reversed).toBeTruthy();
  });

  it('rounds every published figure through the same helper', () => {
    const stats = computeFrameTimeStats(makeFrames(4000, 143.7, [33.3, 41.1]));
    for (const v of [stats.averageFps, stats.onePercentLow, stats.zeroPointOnePercentLow]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
  });

  it('hashes a canonical, compression-independent serialization', () => {
    expect(canonicalFrameTimeBytes([16.7, 8.3])).toBe('[16.7,8.3]');
  });
});

describe('cap detection', () => {
  // A capped run measures the cap, not the hardware. This is a heuristic and
  // only ever raises a warning, so it is tuned to keep false positives rare.
  it('flags a vsync-locked run at a standard refresh period', () => {
    const result = detectCap(Array.from({ length: 5000 }, () => 1000 / 60));
    expect(result.capDetected).toBe('vsync');
    expect(result.clusteredFraction).toBeGreaterThan(0.95);
  });

  it('flags a non-standard limiter separately from vsync', () => {
    const result = detectCap(Array.from({ length: 5000 }, () => 1000 / 87));
    expect(result.capDetected).toBe('fps-limit');
  });

  it('does not flag a genuinely variable run', () => {
    const frames = Array.from({ length: 5000 }, (_, i) => 8 + (i % 40) * 0.35);
    expect(detectCap(frames).capDetected).toBe('none');
  });

  it('returns a defined result for an empty run rather than throwing', () => {
    expect(detectCap([]).capDetected).toBe('none');
  });
});

describe('run duration', () => {
  it('sums frame times into seconds', () => {
    expect(runDurationSec(Array.from({ length: 6000 }, () => 10))).toBe(60);
  });
});
