/**
 * The GPU upgrade template makes no recommendation, and price cannot reach it.
 *
 * The page used to recommend: a "best upgrade", cards ranked by net cost and
 * cost per frame, one badged "Best value", a resale estimate for the reader's
 * own card, and a verdict on whether upgrading was worth it. All of it rested
 * on editorial prices and a flat 65% resale assumption.
 *
 * An intermediate revision removed the visible money but kept the defect:
 * `getUpgradeCandidates` selects the CHEAPEST card in each tier BEFORE
 * anything sorts by modelled gain, so price still decided which cards a reader
 * saw — while the page said selection was on modelled gain alone. That is the
 * failure these tests are built around, so the important one does not check
 * wording at all: it changes every price in the dataset and asserts the page's
 * output is byte-identical.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import gpuData from '../data/gpus.json';
import { getUpgradeComparisons, getUpgradeGpu, averageFps } from './upgradeCalculator';
import { UPGRADE_PAGES, getUpgradeIntro, getUpgradePageMeta } from './upgradePages';

/** Low-, mid- and high-end, plus the top of the stack. */
const REPRESENTATIVE = ['rx6400', 'rx6600', 'rtx4070', 'rtx5080'] as const;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../data/gpus.json');
});

describe('price cannot alter what the page shows', () => {
  it('every price in the dataset can change and the comparison is identical', async () => {
    // THE LOAD-BEARING TEST. Not "the wording avoids money" — the data is
    // rewritten underneath and the output is required not to move. If any
    // price ever re-enters selection, ordering or membership, this fails.
    const before = Object.fromEntries(
      REPRESENTATIVE.map((id) => [id, getUpgradeComparisons(id).map((c) => `${c.gpu.id}:${c.fpsDiffPct}`)]),
    );

    vi.resetModules();
    vi.doMock('../data/gpus.json', () => ({
      default: (gpuData as Array<Record<string, unknown>>).map((gpu, index) => ({
        ...gpu,
        // Invert the price order and scatter it: the cheapest card becomes the
        // dearest, so any surviving price key would reorder or re-select.
        price_usd: 9999 - index * 7,
      })),
    }));
    const reloaded = await import('./upgradeCalculator');
    const after = Object.fromEntries(
      REPRESENTATIVE.map((id) => [id, reloaded.getUpgradeComparisons(id).map((c) => `${c.gpu.id}:${c.fpsDiffPct}`)]),
    );

    expect(after).toEqual(before);
    for (const id of REPRESENTATIVE) expect(before[id].length).toBeGreaterThan(0);
  });

  it('and the intro sentence is unchanged by it too', async () => {
    const gpu = getUpgradeGpu('rx6600')!;
    const before = getUpgradeIntro(gpu);

    vi.resetModules();
    vi.doMock('../data/gpus.json', () => ({
      default: (gpuData as Array<Record<string, unknown>>).map((g, index) => ({ ...g, price_usd: 9999 - index * 7 })),
    }));
    const reloadedPages = await import('./upgradePages');
    const reloadedCalc = await import('./upgradeCalculator');
    expect(reloadedPages.getUpgradeIntro(reloadedCalc.getUpgradeGpu('rx6600')!)).toBe(before);
  });

  it('the comparison carries no price-derived field at all', () => {
    const [row] = getUpgradeComparisons('rx6600');
    expect(row).toBeDefined();
    expect(Object.keys(row)).toEqual(['gpu', 'avgFpsCurrent', 'avgFpsNew', 'fpsDiffPct']);
    for (const banned of ['netCost', 'costPerFps', 'resale', 'verdict', 'price']) {
      expect(row).not.toHaveProperty(banned);
    }
  });
});

describe('the comparison is complete and ordered by modelled difference', () => {
  it.each(REPRESENTATIVE)('%s lists every tracked GPU with a higher modelled average', (id) => {
    const current = getUpgradeGpu(id)!;
    const base = averageFps(current);
    const rows = getUpgradeComparisons(id);

    // COMPLETENESS, which the old shortlist could not claim: it kept one card
    // per tier and capped the result at six, so cards were dropped silently.
    const expected = (gpuData as Array<{ id: string }>)
      .filter((g) => g.id !== id && averageFps(getUpgradeGpu(g.id)!) > base)
      .map((g) => g.id)
      .sort();
    expect(rows.map((r) => r.gpu.id).sort()).toEqual(expected);

    const diffs = rows.map((r) => r.fpsDiffPct);
    expect(diffs).toEqual([...diffs].sort((a, b) => b - a));
    for (const row of rows) expect(row.fpsDiffPct).toBeGreaterThan(0);
  });

  it('is empty for the fastest card SpecSmith models, without throwing', () => {
    const fastest = (gpuData as Array<{ id: string }>)
      .map((g) => ({ id: g.id, fps: averageFps(getUpgradeGpu(g.id)!) }))
      .reduce((best, g) => (g.fps > best.fps ? g : best));
    expect(getUpgradeComparisons(fastest.id)).toEqual([]);
    expect(getUpgradeIntro(getUpgradeGpu(fastest.id)!)).toMatch(/No GPU SpecSmith tracks/i);
  });

  it('an unknown GPU id yields nothing rather than throwing', () => {
    expect(getUpgradeComparisons('not-a-gpu')).toEqual([]);
  });
});

describe('the shared copy recommends nothing', () => {
  it.each(REPRESENTATIVE)('%s: the intro states no verdict and names no best', (id) => {
    const intro = getUpgradeIntro(getUpgradeGpu(id)!).toLowerCase();
    for (const banned of ['best upgrade', 'worth it', 'you should', 'we recommend', 'top pick', 'best value', 'net cost', 'resale']) {
      expect(intro, `intro still says "${banned}"`).not.toContain(banned);
    }
    expect(intro).not.toMatch(/\$\s?\d/);
  });

  it.each(REPRESENTATIVE)('%s: the intro labels its figures as modelled', (id) => {
    const intro = getUpgradeIntro(getUpgradeGpu(id)!);
    expect(intro).toMatch(/estimates?|models?|modelled/i);
    expect(intro).toMatch(/(not|rather than) benchmark results|model estimates/i);
  });
});

describe('URLs and canonical metadata are untouched', () => {
  it('all 57 guides keep their slug, and each canonical is its own URL', () => {
    expect(UPGRADE_PAGES).toHaveLength(57);
    for (const page of UPGRADE_PAGES) {
      const meta = getUpgradePageMeta(page);
      expect(meta.path).toBe(`/upgrade/${page.slug}`);
      expect(meta.canonicalOverride).toBeUndefined();
      expect(meta.noindex).toBeFalsy();
    }
  });

  it('the meta description no longer promises a resale value or a net cost', () => {
    for (const page of UPGRADE_PAGES) {
      const description = getUpgradePageMeta(page).description.toLowerCase();
      for (const banned of ['resale', 'net cost', 'trading up', 'best upgrade']) {
        expect(description, `${page.slug} description still says "${banned}"`).not.toContain(banned);
      }
      expect(description).toMatch(/estimates?|modell?ed/);
    }
  });

  it('titles and descriptions stay unique across all 57 pages', () => {
    const titles = UPGRADE_PAGES.map((p) => getUpgradePageMeta(p).title);
    const descriptions = UPGRADE_PAGES.map((p) => getUpgradePageMeta(p).description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
