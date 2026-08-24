import { describe, it, expect } from 'vitest';
import { getCpuUpgradeCandidates, getUpgradeCpus, getBestValueCpuCandidate } from './cpuUpgradeCalculator';

describe('getBestValueCpuCandidate', () => {
  it('returns undefined for an empty list', () => {
    expect(getBestValueCpuCandidate([])).toBeUndefined();
  });
});

describe('getCpuUpgradeCandidates (real catalog data)', () => {
  it('never returns a candidate that is not a positive modeled FPS upgrade', () => {
    for (const cpu of getUpgradeCpus()) {
      const candidates = getCpuUpgradeCandidates(cpu.id, 100);
      for (const c of candidates) {
        expect(c.avgFpsNew).toBeGreaterThan(c.avgFpsCurrent);
        expect(c.fpsGainPct).toBeGreaterThan(0);
      }
    }
  });

  it('does not recommend the Core Ultra 7 265K as an i5-14600KF upgrade', () => {
    const candidates = getCpuUpgradeCandidates('i5-14600kf', 100);
    expect(candidates.some(c => c.cpu.id === 'cu7-265k')).toBe(false);
  });

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

  it('computes costPerFps from positive FPS gain, or null when netCost is 0', () => {
    for (const id of ['r5-3600', 'i5-12400f', 'r5-5500', 'i3-13100f']) {
      const candidates = getCpuUpgradeCandidates(id);
      for (const c of candidates) {
        const fpsGained = c.avgFpsNew - c.avgFpsCurrent;
        expect(fpsGained).toBeGreaterThan(0);
        if (c.netCost <= 0) {
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
