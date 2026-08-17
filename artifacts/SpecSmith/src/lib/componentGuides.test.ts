import { describe, it, expect } from 'vitest';
import { getComponentGuide, COMPONENT_GUIDES } from './componentGuides';

describe('RAM and Storage $/unit value picks (real catalog data)', () => {
  it('RAM guide has a Best $/GB pick whose cost_per_gb is the true minimum across all tracked kits', () => {
    const guide = getComponentGuide('ram')!;
    const valuePick = guide.picks.find(p => p.label === 'Best $/GB');
    expect(valuePick).toBeDefined();
    const minCostPerGb = Math.min(...guide.items.map(i => i.cost_per_gb as number));
    expect(valuePick!.item.cost_per_gb).toBe(minCostPerGb);
  });

  it('Storage guide has a Best $/TB pick whose cost_per_tb is the true minimum across all tracked drives', () => {
    const guide = getComponentGuide('storage')!;
    const valuePick = guide.picks.find(p => p.label === 'Best $/TB');
    expect(valuePick).toBeDefined();
    const minCostPerTb = Math.min(...guide.items.map(i => i.cost_per_tb as number));
    expect(valuePick!.item.cost_per_tb).toBe(minCostPerTb);
  });

  it('every RAM item carries a positive cost_per_gb consistent with price/capacity', () => {
    const guide = getComponentGuide('ram')!;
    for (const item of guide.items) {
      const expected = Math.round((item.price_usd / (item.capacity_gb as number)) * 100) / 100;
      expect(item.cost_per_gb).toBe(expected);
      expect(item.cost_per_gb as number).toBeGreaterThan(0);
    }
  });

  it('every Storage item carries a positive cost_per_tb consistent with price/capacity', () => {
    const guide = getComponentGuide('storage')!;
    for (const item of guide.items) {
      const expected = Math.round((item.price_usd / (item.capacity_tb as number)) * 100) / 100;
      expect(item.cost_per_tb).toBe(expected);
      expect(item.cost_per_tb as number).toBeGreaterThan(0);
    }
  });

  it('does not add a value pick to unrelated categories (no $/unit field exists to rank by)', () => {
    for (const guide of COMPONENT_GUIDES) {
      if (guide.slug === 'ram' || guide.slug === 'storage') continue;
      expect(guide.picks.some(p => p.label.startsWith('Best $/'))).toBe(false);
    }
  });
});
