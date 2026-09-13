/**
 * The reference upgrade guide, pinned — and the claims it may not make.
 *
 * Two kinds of assertion. The first is about REACH: this change was scoped to
 * one URL out of fifty-seven and the component is shared, so the test that
 * matters most is that every other slug is untouched.
 *
 * The second is about EVIDENCE BOUNDARIES. Review cut the first version of
 * this page back for claiming more than the data supports, and each boundary
 * is easy to drift back across, so each one is a test:
 *
 *   - no recommendation derived from price, resale or cost-per-FPS;
 *   - no claim that the shortlist is every option;
 *   - the 15% line described as SpecSmith's own, never as perception;
 *   - no CPU-comparison bottleneck finding;
 *   - no categorical power claim and no PSU verdict;
 *   - the displayed rationale matching the selection algorithm exactly.
 */

import { describe, expect, it } from 'vitest';
import { UPGRADE_PAGES, getUpgradePageMeta } from './upgradePages';
import { UPGRADE_REFERENCE_CPU, getUpgradeCandidates, getUpgradeGpu } from './upgradeCalculator';
import type { UpgradeCandidate } from './upgradeCalculator';
import {
  MEANINGFUL_GAIN_PCT,
  article,
  buildVerdict,
  getUpgradeGuideDetail,
  hasUpgradeGuideDetail,
  pickUpgradePaths,
} from './upgradeGuideDetail';

const detail = getUpgradeGuideDetail('rx-6600', 'rx6600');

/** Everything this module hands the page as prose, in one string. */
const allProse = () => {
  if (!detail) throw new Error('no detail');
  return [
    detail.intro,
    detail.verdict.headline,
    detail.verdict.body,
    detail.shortlistNote,
    detail.estimatorNote,
    detail.power?.caveat ?? '',
    ...detail.paths.map((p) => p.rationale),
  ].join(' ');
};

describe('the reference build reaches exactly one page', () => {
  it('rx-6600 has one', () => {
    expect(hasUpgradeGuideDetail('rx-6600')).toBe(true);
    expect(detail).toBeDefined();
  });

  it('and every other upgrade page does not', () => {
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
  it("the meta path is still the page's own URL, with no override", () => {
    const page = UPGRADE_PAGES.find((p) => p.slug === 'rx-6600')!;
    const meta = getUpgradePageMeta(page);
    expect(meta.path).toBe('/upgrade/rx-6600');
    expect(meta.canonicalOverride).toBeUndefined();
    expect(meta.noindex).toBeFalsy();
  });
});

describe('no recommendation rests on a price', () => {
  it('says nothing about net cost, resale value or cost per frame', () => {
    // `gpus.json` prices are editorial and `estimateResaleValue` is a flat 65%
    // of one. Net cost and cost-per-FPS compound the two into a figure that
    // looks precise and is not, so the page states none of them.
    const prose = allProse().toLowerCase();
    for (const forbidden of ['net cost', 'resale', 'cost per fps', 'cost/fps', 'per estimated fps', 'out of pocket', 'trade-in']) {
      expect(prose, `prose still mentions "${forbidden}"`).not.toContain(forbidden);
    }
    expect(prose).not.toMatch(/\$\s?\d/);
  });

  it('and ranks purely on modelled gain, so price cannot reorder the shortlist', () => {
    if (!detail) throw new Error('no detail');
    const gains = detail.paths.map((p) => p.candidate.fpsGainPct);
    expect(gains).toEqual([...gains].sort((a, b) => a - b));
  });

  it('follows gain even when price would order the shortlist differently', () => {
    // THE ASSERTION THAT ACTUALLY PINS THE AXIS. On the real RX 6600 data,
    // price order and gain order happen to agree, so a sort keyed on net cost
    // produces the same three cards and every other test here passes. These
    // candidates are built so the two orders DISAGREE: the biggest gain is the
    // cheapest card. Anything that reintroduces a price key fails here.
    const make = (id: string, fpsGainPct: number, netCost: number): UpgradeCandidate => ({
      gpu: { id, name: id.toUpperCase(), price_usd: netCost, tier: 9, gpu_multiplier: 1 },
      netCost,
      avgFpsCurrent: 100,
      avgFpsNew: 100 + fpsGainPct,
      fpsGainPct,
      verdict: 'strong',
      costPerFps: Math.round(netCost / fpsGainPct),
    });
    const inverted = [
      make('expensive-small', 16, 900),
      make('middling', 40, 500),
      make('cheap-huge', 80, 100),
    ];
    const paths = pickUpgradePaths(inverted);
    expect(paths.map((p) => p.band)).toEqual(['smallest', 'middle', 'largest']);
    expect(paths.map((p) => p.candidate.gpu.id)).toEqual(['expensive-small', 'middling', 'cheap-huge']);
    // Cost order would have put the cheapest card first and the dearest last.
    expect(paths[0].candidate.netCost).toBeGreaterThan(paths[2].candidate.netCost);
  });
});

describe('the shortlist is never described as complete', () => {
  it('states how the shortlist was built, and that it omits cards', () => {
    if (!detail) throw new Error('no detail');
    // `getUpgradeCandidates` keeps the CHEAPEST card per tier above the
    // current one, drops any that do not beat it on the modelled average, and
    // returns at most six. An earlier draft called that "every option we can
    // model", which it is not.
    expect(detail.shortlistNote).toMatch(/not every card/i);
    expect(detail.shortlistNote).toMatch(/each tier/i);
    expect(detail.shortlistNote).toMatch(/at most six/i);
    expect(detail.shortlistNote).toMatch(/may still be worth considering/i);
  });

  it('and no prose claims completeness', () => {
    const prose = allProse().toLowerCase();
    for (const forbidden of ['every option', 'all options', 'complete list', 'exhaustive']) {
      expect(prose, `prose still claims "${forbidden}"`).not.toContain(forbidden);
    }
    // Matched as an AFFIRMATIVE claim rather than a substring: the honest
    // disclaimer contains "not every card that would be faster", and a bare
    // substring ban would fail on the very sentence that fixes the problem.
    for (const claim of [/\b(ranks|compares|covers|lists|includes)\s+every\b/, /(?<!not )\bevery card that\b/]) {
      expect(prose, `prose still claims completeness: ${claim}`).not.toMatch(claim);
    }
  });
});

describe('the 15% line is SpecSmith’s own, not a claim about perception', () => {
  it('names it as a comparison threshold wherever it appears', () => {
    if (!detail) throw new Error('no detail');
    expect(detail.verdict.body).toMatch(/comparison threshold/i);
    const marginal = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT);
    const verdict = buildVerdict(getUpgradeGpu('rx6600')!, [], marginal);
    expect(verdict.headline).toMatch(/comparison threshold/i);
  });

  it('never claims a player would or would not notice a difference', () => {
    const prose = allProse().toLowerCase();
    for (const forbidden of ['would notice', 'you would not notice', 'noticeable', 'feel faster', 'changes how games feel', 'perceptible', 'not worth paying']) {
      expect(prose, `prose still claims "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

describe('no bottleneck finding is offered', () => {
  it('names the reference CPU as an assumption and stops there', () => {
    if (!detail) throw new Error('no detail');
    expect(detail.estimatorNote).toContain(UPGRADE_REFERENCE_CPU.name);
    expect(detail.estimatorNote).toMatch(/model output, not benchmark results/i);
    expect(detail.estimatorNote).toMatch(/a different CPU would produce different figures/i);
  });

  it('offers no second-CPU comparison and no bottleneck language', () => {
    const prose = allProse().toLowerCase();
    for (const forbidden of ['bottleneck', 'hold it back', 'holds it back', 'ryzen 5 3600', 'slower chip', 'falls from']) {
      expect(prose, `prose still says "${forbidden}"`).not.toContain(forbidden);
    }
    expect(detail).toBeDefined();
    expect((detail as unknown as Record<string, unknown>).cpu).toBeUndefined();
  });
});

describe('board power is reported, never ruled on', () => {
  it('gives the figures’ provenance and refuses the verdict', () => {
    if (!detail?.power) throw new Error('no power notes');
    expect(detail.power.caveat).toMatch(/not measurements of any specific card/i);
    expect(detail.power.caveat).toMatch(/does not assess whether a given power supply is sufficient/i);
    expect(detail.power.caveat).toMatch(/check the exact model/i);
  });

  it('makes no categorical claim about behaviour under load', () => {
    // An earlier draft asserted that power spikes exceed the rated figure:
    // true of some cards, measured by SpecSmith for none of them, and stated
    // as though it held universally.
    const caveat = (detail?.power?.caveat ?? '').toLowerCase();
    for (const forbidden of ['spike', 'exceed the rated', 'will draw', 'always', 'guaranteed', 'will fit']) {
      expect(caveat, `caveat still claims "${forbidden}"`).not.toContain(forbidden);
    }
    // Same care as above. The caveat's job is to say SpecSmith does NOT assess
    // sufficiency, so the ban is on the affirmative verdict, not the word.
    expect(caveat).not.toMatch(/(your|the|this)\s+(power supply|psu)\s+(is|will be|should be)\s+(sufficient|fine|enough|adequate)/);
  });

  it('reports the dataset’s own numbers and arithmetic on them', () => {
    if (!detail?.power) throw new Error('no power notes');
    const gpu = getUpgradeGpu('rx6600')!;
    expect(detail.power.current.typicalWatts).toBe(gpu.tdp_watts);
    for (const note of detail.power.upgrades) {
      const source = getUpgradeGpu(note.gpu.id)!;
      expect(note.typicalWatts).toBe(source.tdp_watts);
      expect(note.deltaWatts).toBe(note.typicalWatts - detail.power.current.typicalWatts);
    }
  });
});

describe('every displayed rationale matches the algorithm that chose it', () => {
  it('the largest band really is the largest modelled gain on the shortlist', () => {
    if (!detail) throw new Error('no detail');
    // THE CONTRADICTION THIS REPLACES. The previous build labelled a card
    // "largest estimated gain, whatever it costs" while a hidden
    // cost-per-FPS ceiling excluded the biggest one. A label that disagrees
    // with its own selection rule is worse than no label.
    const largest = detail.paths.find((p) => p.band === 'largest');
    if (!largest) throw new Error('no largest band');
    const qualifying = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct >= MEANINGFUL_GAIN_PCT);
    const maxGain = Math.max(...qualifying.map((c) => c.fpsGainPct));
    expect(largest.candidate.fpsGainPct).toBe(maxGain);
    expect(largest.rationale).toMatch(/largest modelled gain/i);
    expect(largest.rationale.toLowerCase()).not.toContain('whatever it costs');
  });

  it('the smallest band really is the smallest that reaches the threshold', () => {
    if (!detail) throw new Error('no detail');
    const smallest = detail.paths.find((p) => p.band === 'smallest')!;
    const qualifying = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct >= MEANINGFUL_GAIN_PCT);
    expect(smallest.candidate.fpsGainPct).toBe(Math.min(...qualifying.map((c) => c.fpsGainPct)));
  });

  it('no band is filled twice, and a short list yields fewer bands', () => {
    if (!detail) throw new Error('no detail');
    const ids = detail.paths.map((p) => p.candidate.gpu.id);
    expect(new Set(ids).size).toBe(ids.length);

    const two = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct >= MEANINGFUL_GAIN_PCT).slice(0, 2);
    expect(pickUpgradePaths(two).map((p) => p.band)).toEqual(['smallest', 'largest']);
    const one = two.slice(0, 1);
    expect(pickUpgradePaths(one).map((p) => p.band)).toEqual(['smallest']);
  });

  it('recommends nothing when nothing reaches the threshold', () => {
    const below = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT);
    expect(below.length).toBeGreaterThan(0);
    expect(pickUpgradePaths(below)).toEqual([]);
  });

  it('says so plainly when there is nothing faster at all', () => {
    const top = getUpgradeGpu('rtx4090')!;
    expect(getUpgradeCandidates('rtx4090')).toEqual([]);
    expect(buildVerdict(top, [], []).headline).toMatch(/nothing faster/i);
  });
});

describe('nothing is invented', () => {
  it('every shortlisted figure matches the calculator it came from', () => {
    if (!detail) throw new Error('no detail');
    const candidates = getUpgradeCandidates('rx6600');
    for (const path of detail.paths) {
      const source = candidates.find((c) => c.gpu.id === path.candidate.gpu.id);
      expect(source, `${path.candidate.gpu.id} is not a tracked candidate`).toBeDefined();
      expect(path.candidate).toStrictEqual(source);
    }
  });

  it('no sentence claims a measured result', () => {
    const prose = allProse().toLowerCase();
    for (const forbidden of ['we measured', 'benchmarked', 'tested at', 'real-world results', 'in our testing']) {
      expect(prose).not.toContain(forbidden);
    }
    expect(detail?.intro).toMatch(/estimates, not benchmark results/i);
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
