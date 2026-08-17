import { describe, it, expect } from 'vitest';
import { getCpuUpgradeCandidates, getBestValueCpuCandidate } from './cpuUpgradeCalculator';

describe('getBestValueCpuCandidate', () => {
  it('returns undefined for an empty list', () => {
    expect(getBestValueCpuCandidate([])).toBeUndefined();
  });
});

describe('getCpuUpgradeCandidates costPerFps guard (real catalog data)', () => {
  it('never returns a negative or zero costPerFps', () => {
    for (const id of ['r5-3600', 'i5-12400f', 'r5-5500', 'i3-13100f']) {
      const candidates = getCpuUpgradeCandidates(id);
      for (const c of candidates) {
        if (c.costPerFps !== null) {
          expect(c.costPerFps).toBeGreaterThan(0);
        }
      }
    }
  });

  it('sets costPerFps to null whenever netCost is 0 or the FPS gain is not positive', () => {
    for (const id of ['r5-3600', 'i5-12400f', 'r5-5500', 'i3-13100f']) {
      const candidates = getCpuUpgradeCandidates(id);
      for (const c of candidates) {
        const fpsGained = c.avgFpsNew - c.avgFpsCurrent;
        if (c.netCost <= 0 || fpsGained <= 0) {
          expect(c.costPerFps).toBeNull();
        } else {
          expect(c.costPerFps).toBe(Math.round(c.netCost / fpsGained));
        }
      }
    }
  });

  it('the fastest tracked CPU has no candidates and thus no best-value pick', () => {
    const candidates = getCpuUpgradeCandidates('r9-9950x3d');
    expect(candidates).toHaveLength(0);
    expect(getBestValueCpuCandidate(candidates)).toBeUndefined();
  });
});
