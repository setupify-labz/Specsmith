/**
 * The CPU upgrade template makes no recommendation, and price cannot reach it.
 *
 * Same defect the GPU template carried and the same fix (#119).
 * `getCpuUpgradeCandidates` keeps the CHEAPEST chip in each tier before
 * anything sorts by modelled gain, so an editorial price decided which chips a
 * reader saw. The important test here does not check wording: it rewrites every
 * price in the dataset and requires the output not to move.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import cpuData from '../data/cpus.json';
import { getCpuUpgradeComparisons, getClosestCpuUpgradeComparisons, getUpgradeCpu, averageCpuFps, CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT } from './cpuUpgradeCalculator';
import { CPU_UPGRADE_PAGES, getCpuUpgradeIntro, getCpuUpgradePageMeta } from './cpuUpgradePages';

/** Low-, mid- and high-end, spanning the catalogue. */
const REPRESENTATIVE = ['i3-13100f', 'r5-5500', 'i5-12400f', 'r7-7800x3d'] as const;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../data/cpus.json');
});

describe('price cannot alter what the page shows', () => {
  it('every price in the dataset can change and the comparison is identical', async () => {
    const before = Object.fromEntries(
      REPRESENTATIVE.map((id) => [id, getCpuUpgradeComparisons(id).map((c) => `${c.cpu.id}:${c.fpsDiffPct}`)]),
    );

    vi.resetModules();
    vi.doMock('../data/cpus.json', () => ({
      // Inverted and scattered: the cheapest chip becomes the dearest, so any
      // surviving price key would reorder or re-select.
      default: (cpuData as Array<Record<string, unknown>>).map((cpu, index) => ({ ...cpu, price_usd: 9999 - index * 7 })),
    }));
    const reloaded = await import('./cpuUpgradeCalculator');
    const after = Object.fromEntries(
      REPRESENTATIVE.map((id) => [id, reloaded.getCpuUpgradeComparisons(id).map((c) => `${c.cpu.id}:${c.fpsDiffPct}`)]),
    );

    expect(after).toEqual(before);
    for (const id of REPRESENTATIVE) expect(before[id].length).toBeGreaterThan(0);
  });

  it('and the intro sentence is unchanged by it too', async () => {
    const before = getCpuUpgradeIntro(getUpgradeCpu('r5-5500')!);
    vi.resetModules();
    vi.doMock('../data/cpus.json', () => ({
      default: (cpuData as Array<Record<string, unknown>>).map((c, index) => ({ ...c, price_usd: 9999 - index * 7 })),
    }));
    const reloadedPages = await import('./cpuUpgradePages');
    const reloadedCalc = await import('./cpuUpgradeCalculator');
    expect(reloadedPages.getCpuUpgradeIntro(reloadedCalc.getUpgradeCpu('r5-5500')!)).toBe(before);
  });

  it('the comparison carries no price-derived field at all', () => {
    const [row] = getCpuUpgradeComparisons('r5-5500');
    expect(row).toBeDefined();
    expect(Object.keys(row)).toEqual(['cpu', 'avgFpsCurrent', 'avgFpsNew', 'fpsDiffPct']);
    for (const banned of ['netCost', 'costPerFps', 'resale', 'verdict', 'price']) {
      expect(row).not.toHaveProperty(banned);
    }
  });
});

describe('the comparison is complete, and the preview is a stated subset', () => {
  it.each(REPRESENTATIVE)('%s lists every tracked CPU with a higher modelled average', (id) => {
    const base = averageCpuFps(getUpgradeCpu(id)!);
    const expected = (cpuData as Array<{ id: string }>)
      .filter((c) => c.id !== id && averageCpuFps(getUpgradeCpu(c.id)!) > base)
      .map((c) => c.id)
      .sort();
    expect(getCpuUpgradeComparisons(id).map((r) => r.cpu.id).sort()).toEqual(expected);

    const diffs = getCpuUpgradeComparisons(id).map((r) => r.fpsDiffPct);
    expect(diffs).toEqual([...diffs].sort((a, b) => b - a));
    for (const d of diffs) expect(d).toBeGreaterThan(0);
  });

  it.each(REPRESENTATIVE)('%s previews the closest steps, never more than the limit', (id) => {
    const preview = getClosestCpuUpgradeComparisons(id);
    const all = getCpuUpgradeComparisons(id);
    expect(preview.length).toBeLessThanOrEqual(CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT);
    expect(preview.length).toBeLessThanOrEqual(all.length);
    // Closest first — the smallest modelled differences, ascending.
    const diffs = preview.map((p) => p.fpsDiffPct);
    expect(diffs).toEqual([...diffs].sort((a, b) => a - b));
    const smallest = Math.min(...all.map((a) => a.fpsDiffPct));
    if (all.length > 0) expect(diffs[0]).toBe(smallest);
  });

  it('a non-positive limit previews nothing rather than everything', () => {
    expect(getClosestCpuUpgradeComparisons('r5-5500', 0)).toEqual([]);
    expect(getClosestCpuUpgradeComparisons('r5-5500', -1)).toEqual([]);
  });

  it('is empty for the fastest chip SpecSmith models, without throwing', () => {
    const fastest = (cpuData as Array<{ id: string }>)
      .map((c) => ({ id: c.id, fps: averageCpuFps(getUpgradeCpu(c.id)!) }))
      .reduce((best, c) => (c.fps > best.fps ? c : best));
    expect(getCpuUpgradeComparisons(fastest.id)).toEqual([]);
    expect(getCpuUpgradeIntro(getUpgradeCpu(fastest.id)!)).toMatch(/No CPU SpecSmith tracks/i);
  });

  it('an unknown CPU id yields nothing rather than throwing', () => {
    expect(getCpuUpgradeComparisons('not-a-cpu')).toEqual([]);
  });
});

describe('the shared copy recommends nothing', () => {
  it.each(REPRESENTATIVE)('%s: the intro states no verdict and names no best', (id) => {
    const intro = getCpuUpgradeIntro(getUpgradeCpu(id)!).toLowerCase();
    for (const banned of ['best upgrade', 'worth it', 'you should', 'we recommend', 'top pick', 'best value', 'net cost', 'resale']) {
      expect(intro, `intro still says "${banned}"`).not.toContain(banned);
    }
    expect(intro).not.toMatch(/\$\s?\d/);
  });

  it.each(REPRESENTATIVE)('%s: the intro labels its figures as modelled', (id) => {
    const intro = getCpuUpgradeIntro(getUpgradeCpu(id)!);
    expect(intro).toMatch(/estimates?|models?|modelled/i);
    expect(intro).toMatch(/(not|rather than) benchmark results|model estimates/i);
  });
});

describe('URLs and canonical metadata are untouched', () => {
  it('every comparison keeps its slug, and each canonical is its own URL', () => {
    expect(CPU_UPGRADE_PAGES.length).toBeGreaterThan(40);
    for (const page of CPU_UPGRADE_PAGES) {
      const meta = getCpuUpgradePageMeta(page);
      expect(meta.path).toBe(`/upgrade-cpu/${page.slug}`);
      expect(meta.canonicalOverride).toBeUndefined();
      expect(meta.noindex).toBeFalsy();
    }
  });

  it('the meta description no longer promises a resale value or a net cost', () => {
    for (const page of CPU_UPGRADE_PAGES) {
      const description = getCpuUpgradePageMeta(page).description.toLowerCase();
      for (const banned of ['resale', 'net cost', 'trading up', 'best upgrade']) {
        expect(description, `${page.slug} still says "${banned}"`).not.toContain(banned);
      }
      expect(description).toMatch(/estimates?|modell?ed/);
    }
  });

  it('titles and descriptions stay unique across every page', () => {
    const titles = CPU_UPGRADE_PAGES.map((p) => getCpuUpgradePageMeta(p).title);
    const descriptions = CPU_UPGRADE_PAGES.map((p) => getCpuUpgradePageMeta(p).description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
