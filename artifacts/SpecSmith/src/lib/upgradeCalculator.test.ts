import { describe, it, expect } from 'vitest';
import { getUpgradeCandidates, getUpgradeGpus, getBestValueCandidate, type UpgradeCandidate, type UpgradeGpu } from './upgradeCalculator';

function fixtureCandidate(overrides: Partial<UpgradeCandidate>): UpgradeCandidate {
  const gpu: UpgradeGpu = { id: 'fixture', name: 'Fixture GPU', price_usd: 500, tier: 5, gpu_multiplier: 1 };
  return {
    gpu,
    netCost: 100,
    avgFpsCurrent: 100,
    avgFpsNew: 120,
    fpsGainPct: 20,
    verdict: 'moderate',
    costPerFps: 5,
    ...overrides,
  };
}

describe('getBestValueCandidate', () => {
  it('picks the candidate with the lowest costPerFps', () => {
    const candidates = [
      fixtureCandidate({ gpu: { id: 'a', name: 'A', price_usd: 1, tier: 1, gpu_multiplier: 1 }, costPerFps: 10 }),
      fixtureCandidate({ gpu: { id: 'b', name: 'B', price_usd: 1, tier: 1, gpu_multiplier: 1 }, costPerFps: 3 }),
      fixtureCandidate({ gpu: { id: 'c', name: 'C', price_usd: 1, tier: 1, gpu_multiplier: 1 }, costPerFps: 7 }),
    ];
    expect(getBestValueCandidate(candidates)?.gpu.id).toBe('b');
  });

  it('ignores candidates with a null costPerFps', () => {
    const candidates = [
      fixtureCandidate({ gpu: { id: 'a', name: 'A', price_usd: 1, tier: 1, gpu_multiplier: 1 }, costPerFps: null }),
      fixtureCandidate({ gpu: { id: 'b', name: 'B', price_usd: 1, tier: 1, gpu_multiplier: 1 }, costPerFps: 12 }),
    ];
    expect(getBestValueCandidate(candidates)?.gpu.id).toBe('b');
  });

  it('returns undefined when every candidate has a null costPerFps', () => {
    const candidates = [
      fixtureCandidate({ costPerFps: null }),
      fixtureCandidate({ costPerFps: null }),
    ];
    expect(getBestValueCandidate(candidates)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(getBestValueCandidate([])).toBeUndefined();
  });
});

describe('getUpgradeCandidates (real catalog data)', () => {
  it('never returns a candidate that is not a positive modeled FPS upgrade', () => {
    for (const gpu of getUpgradeGpus()) {
      const candidates = getUpgradeCandidates(gpu.id, 100);
      for (const c of candidates) {
        expect(c.avgFpsNew).toBeGreaterThan(c.avgFpsCurrent);
        expect(c.fpsGainPct).toBeGreaterThan(0);
      }
    }
  });

  it('does not recommend the RX 6900 XT as an RTX 5070 upgrade', () => {
    const candidates = getUpgradeCandidates('rtx5070', 100);
    expect(candidates.some(c => c.gpu.id === 'rx6900xt')).toBe(false);
  });

  it('never returns a negative or zero costPerFps', () => {
    for (const id of ['rtx3050', 'rtx4060', 'rx6600', 'arca580']) {
      const candidates = getUpgradeCandidates(id);
      for (const c of candidates) {
        if (c.costPerFps !== null) {
          expect(c.costPerFps).toBeGreaterThan(0);
        }
      }
    }
  });

  it('computes costPerFps from positive FPS gain, or null when netCost is 0', () => {
    for (const id of ['rtx3050', 'rtx4060', 'rx6600', 'arca580']) {
      const candidates = getUpgradeCandidates(id);
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

  it('the fastest tracked GPU has no candidates and thus no best-value pick', () => {
    const candidates = getUpgradeCandidates('rtx5090');
    expect(candidates).toHaveLength(0);
    expect(getBestValueCandidate(candidates)).toBeUndefined();
  });
});
