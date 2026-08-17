import { describe, it, expect } from 'vitest';
import { getSffPicks } from './sffBuilds';

describe('getSffPicks avgFps', () => {
  it('attaches a sane avgFps to both SFF tiers', () => {
    const picks = getSffPicks();
    expect(picks.length).toBe(2);
    for (const p of picks) {
      expect(p.avgFps).toBeGreaterThan(0);
      expect(p.avgFps).toBeLessThan(999);
    }
  });

  it('the Premium SFF tier does not estimate a lower avgFps than the Budget tier', () => {
    const picks = getSffPicks();
    const budget = picks.find(p => p.tier.slug === 'budget')!;
    const premium = picks.find(p => p.tier.slug === 'premium')!;
    expect(premium.avgFps).toBeGreaterThanOrEqual(budget.avgFps);
  });
});
