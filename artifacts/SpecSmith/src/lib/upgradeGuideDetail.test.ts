/**
 * The reference upgrade guide, pinned.
 *
 * Two kinds of assertion live here. The first is about REACH: this change was
 * scoped to one URL out of fifty-seven, and the component is shared, so the
 * test that matters most is that every other slug is untouched. The second is
 * about HONESTY: every figure derived rather than written, every estimate
 * labelled, and no recommendation the page's own badges call marginal.
 */

import { describe, expect, it } from 'vitest';
import { UPGRADE_PAGES, getUpgradePageMeta } from './upgradePages';
import { getUpgradeCandidates, getUpgradeGpu } from './upgradeCalculator';
import {
  MEANINGFUL_GAIN_PCT,
  article,
  buildVerdict,
  getUpgradeGuideDetail,
  hasUpgradeGuideDetail,
  pickUpgradePaths,
} from './upgradeGuideDetail';

const detail = getUpgradeGuideDetail('rx-6600', 'rx6600');

describe('the reference build reaches exactly one page', () => {
  it('rx-6600 has one', () => {
    expect(hasUpgradeGuideDetail('rx-6600')).toBe(true);
    expect(detail).toBeDefined();
  });

  it('and every other upgrade page does not', () => {
    // THE SCOPE ASSERTION. All 57 guides render from one component; this is
    // what stops a change to the reference build reaching the other 56.
    const others = UPGRADE_PAGES.filter((page) => page.slug !== 'rx-6600');
    expect(others.length).toBeGreaterThan(50);
    for (const page of others) {
      expect(hasUpgradeGuideDetail(page.slug), `${page.slug} unexpectedly has a detail`).toBe(false);
      expect(getUpgradeGuideDetail(page.slug, page.gpuId)).toBeUndefined();
    }
  });

  it('an unknown slug gets nothing rather than throwing', () => {
    expect(getUpgradeGuideDetail('not-a-card', 'nope')).toBeUndefined();
  });
});

describe('the page keeps its self-referential canonical metadata', () => {
  it('the meta path is still the page\'s own URL, with no override', () => {
    const page = UPGRADE_PAGES.find((p) => p.slug === 'rx-6600')!;
    const meta = getUpgradePageMeta(page);
    expect(meta.path).toBe('/upgrade/rx-6600');
    // A canonicalOverride would point this page at another URL. The upgrade
    // guides must each be their own canonical.
    expect(meta.canonicalOverride).toBeUndefined();
    expect(meta.noindex).toBeFalsy();
  });
});

describe('the recommendations never include a gain the page calls marginal', () => {
  it('every path clears the threshold the badges use', () => {
    if (!detail) throw new Error('no detail');
    expect(detail.paths.length).toBeGreaterThan(0);
    for (const path of detail.paths) {
      expect(path.candidate.fpsGainPct).toBeGreaterThanOrEqual(MEANINGFUL_GAIN_PCT);
    }
  });

  it('the cheapest card one tier up is NOT recommended when it barely gains', () => {
    // THE DEFECT THIS PAGE EXISTED WITH. `getUpgradeIntro` calls the cheapest
    // next-tier card "the best upgrade in our data" — for the RX 6600 that is
    // an RX 6600 XT at about +3%, which the page's own badge calls a marginal
    // gain. The first recommendation a reader saw was the one not worth money.
    if (!detail) throw new Error('no detail');
    const candidates = getUpgradeCandidates('rx6600');
    const cheapestNextTier = candidates[0];
    expect(cheapestNextTier.fpsGainPct).toBeLessThan(MEANINGFUL_GAIN_PCT);
    expect(detail.paths.map((p) => p.candidate.gpu.id)).not.toContain(cheapestNextTier.gpu.id);
    // ...and it is not silently dropped either: it is named as not worth it.
    expect(detail.notWorthIt.map((c) => c.gpu.id)).toContain(cheapestNextTier.gpu.id);
  });

  it('the high-end pick is not just the most expensive card in the dataset', () => {
    // Unbounded, "largest gain" picks the RTX 4090: roughly ten times the net
    // cost of the mid-range pick, at several times the cost per FPS. A
    // recommendation has to be defensible on value, not only on magnitude.
    if (!detail) throw new Error('no detail');
    const highEnd = detail.paths.find((p) => p.band === 'high-end');
    const midrange = detail.paths.find((p) => p.band === 'midrange');
    if (!highEnd || !midrange) throw new Error('bands missing');
    expect(highEnd.candidate.costPerFps).not.toBeNull();
    expect(midrange.candidate.costPerFps).not.toBeNull();
    expect(highEnd.candidate.costPerFps!).toBeLessThanOrEqual(midrange.candidate.costPerFps! * 2);
  });

  it('a card is never recommended twice under two bands', () => {
    if (!detail) throw new Error('no detail');
    const ids = detail.paths.map((p) => p.candidate.gpu.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recommends nothing at all when nothing clears the threshold', () => {
    // Fail closed rather than filling three bands for their own sake.
    const marginalOnly = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT);
    expect(marginalOnly.length).toBeGreaterThan(0);
    expect(pickUpgradePaths(marginalOnly)).toEqual([]);

    const gpu = getUpgradeGpu('rx6600')!;
    const verdict = buildVerdict(gpu, [], marginalOnly);
    expect(verdict.headline).toMatch(/not yet/i);
  });

  it('says so plainly when there is nothing faster at all', () => {
    const top = getUpgradeGpu('rtx4090')!;
    expect(getUpgradeCandidates('rtx4090')).toEqual([]);
    expect(buildVerdict(top, [], []).headline).toMatch(/nothing faster/i);
  });
});

describe('nothing is invented', () => {
  it('every recommended figure matches the calculator it came from', () => {
    if (!detail) throw new Error('no detail');
    const candidates = getUpgradeCandidates('rx6600');
    for (const path of detail.paths) {
      const source = candidates.find((c) => c.gpu.id === path.candidate.gpu.id);
      expect(source, `${path.candidate.gpu.id} is not a tracked candidate`).toBeDefined();
      // Field for field. `getUpgradeCandidates` builds fresh objects per call,
      // so identity is not available; what matters is that not one figure was
      // rewritten, rounded or "adjusted" between the calculator and the page.
      expect(path.candidate).toStrictEqual(source);
    }
  });

  it('power figures are the dataset\'s, and the deltas are arithmetic on them', () => {
    if (!detail) throw new Error('no detail');
    const gpu = getUpgradeGpu('rx6600')!;
    expect(detail.power.current.typicalWatts).toBe(gpu.tdp_watts);
    for (const note of detail.power.upgrades) {
      const source = getUpgradeGpu(note.gpu.id)!;
      expect(note.typicalWatts).toBe(source.tdp_watts);
      expect(note.deltaWatts).toBe(note.typicalWatts - detail.power.current.typicalWatts);
    }
  });

  it('the CPU comparison changes only the CPU', () => {
    if (!detail) throw new Error('no detail');
    // Same card, same games, same resolution and preset — so the difference
    // is attributable to the chip and nothing else.
    expect(detail.cpu.fpsWithReferenceCpu).toBeGreaterThan(detail.cpu.fpsWithModestCpu);
    expect(detail.cpu.referenceCpuName).not.toBe(detail.cpu.modestCpuName);
    expect(detail.cpu.gpu.id).toBe(detail.paths[0].candidate.gpu.id);
  });

  it('the power section states no compatibility verdict', () => {
    if (!detail) throw new Error('no detail');
    const caveat = detail.power.caveat.toLowerCase();
    // SpecSmith refuses to turn a generic figure into an exact-fit claim
    // (src/lib/retail/partIdentity.ts). This page holds the same line: it
    // hands over the numbers and rules on nothing.
    expect(caveat).toMatch(/not measurements of a specific card/);
    expect(caveat).toMatch(/check the exact model/);
    for (const forbidden of ['your psu is fine', 'will fit', 'is sufficient', 'guaranteed']) {
      expect(caveat).not.toContain(forbidden);
    }
  });
});

describe('estimates are labelled in the prose the page renders', () => {
  it('the intro and verdict both say the figures are modelled', () => {
    if (!detail) throw new Error('no detail');
    expect(detail.intro).toMatch(/estimates?/i);
    expect(detail.intro).toMatch(/not benchmark results/i);
    expect(detail.verdict.body).toMatch(/estimated|modelled/i);
  });

  it('no sentence claims a measured result', () => {
    if (!detail) throw new Error('no detail');
    const prose = [detail.intro, detail.verdict.headline, detail.verdict.body, detail.power.caveat].join(' ').toLowerCase();
    for (const forbidden of ['we measured', 'benchmarked', 'tested at', 'real-world results']) {
      expect(prose).not.toContain(forbidden);
    }
  });
});

describe('the article helper reads the name aloud', () => {
  it('uses "an" before an initialism whose first letter sounds like a vowel', () => {
    expect(article('RX 6600')).toBe('an');
    expect(article('RTX 3070 Ti')).toBe('an');
  });

  it('and "a" where that is what a reader would say', () => {
    expect(article('Ryzen 5 3600')).toBe('a');
    expect(article('GeForce')).toBe('a');
  });
});
