import { describe, it, expect } from 'vitest';
import { getAverageFps, getCostPerFps, getBetterValueBuild } from './compareValue';

describe('getAverageFps', () => {
  it('returns 0 for an empty list', () => {
    expect(getAverageFps([])).toBe(0);
  });

  it('rounds the mean to the nearest whole number', () => {
    expect(getAverageFps([100, 101, 102])).toBe(101);
    expect(getAverageFps([100, 101])).toBe(101); // 100.5 rounds up
    expect(getAverageFps([90, 91])).toBe(91); // 90.5 rounds up (Math.round convention)
  });

  it('handles a single value', () => {
    expect(getAverageFps([144])).toBe(144);
  });
});

describe('getCostPerFps', () => {
  it('divides cost by average FPS and rounds', () => {
    expect(getCostPerFps(1000, 100)).toBe(10);
    expect(getCostPerFps(1000, 3)).toBe(333);
  });

  it('returns null when cost is zero or negative', () => {
    expect(getCostPerFps(0, 100)).toBeNull();
    expect(getCostPerFps(-50, 100)).toBeNull();
  });

  it('returns null when average FPS is zero or negative', () => {
    expect(getCostPerFps(1000, 0)).toBeNull();
    expect(getCostPerFps(1000, -10)).toBeNull();
  });

  it('returns null when both cost and average FPS are non-positive', () => {
    expect(getCostPerFps(0, 0)).toBeNull();
  });
});

describe('getBetterValueBuild', () => {
  it('picks the build with the lower cost per FPS', () => {
    expect(getBetterValueBuild(10, 15)).toBe('A');
    expect(getBetterValueBuild(15, 10)).toBe('B');
  });

  it('returns null when the two builds are exactly tied', () => {
    expect(getBetterValueBuild(12, 12)).toBeNull();
  });

  it('returns null when either side is not computable', () => {
    expect(getBetterValueBuild(null, 10)).toBeNull();
    expect(getBetterValueBuild(10, null)).toBeNull();
    expect(getBetterValueBuild(null, null)).toBeNull();
  });

  it('is independent of any win-count concept — it only ever sees cost/FPS numbers', () => {
    // A cheaper-per-FPS build can still lose more individual games; this
    // function has no access to win counts at all, so there's nothing to
    // assert about win counts here beyond the fact that the signature only
    // takes costPerFps values.
    expect(getBetterValueBuild(5, 6)).toBe('A');
  });
});
