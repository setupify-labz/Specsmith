import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';
import {
  CORE_BUILD_CATEGORIES,
  CORE_BUILD_TOTAL,
  chosenCoreCategories,
  coreBuildCount,
  coreBuildLabel,
  coreCategoryAction,
  missingCoreCategories,
  nextMissingCoreCategory,
} from './coreBuild';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);

describe('what counts as a core part', () => {
  it('is exactly the eight that make a computer', () => {
    expect([...CORE_BUILD_CATEGORIES]).toEqual([
      'gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler',
    ]);
    expect(CORE_BUILD_TOTAL).toBe(8);
  });

  it('excludes every peripheral', () => {
    for (const peripheral of ['monitor', 'keyboard', 'mouse', 'headset']) {
      expect([...CORE_BUILD_CATEGORIES]).not.toContain(peripheral);
    }
    expect(coreBuildCount({ monitor: 'm1', keyboard: 'k1' } as never)).toBe(0);
  });
});

describe('counting', () => {
  it('counts a filled slot and ignores an empty one', () => {
    expect(coreBuildCount({})).toBe(0);
    expect(coreBuildCount({ gpu: 'g1' })).toBe(1);
    expect(coreBuildCount({ gpu: 'g1', cpu: 'c1', motherboard: 'm1' })).toBe(3);
  });

  it('treats null, undefined and blank as unchosen', () => {
    // `null` is what removing a part writes. A blank string is what a
    // half-decoded share link can produce, and it is not a part either.
    expect(coreBuildCount({ gpu: null, cpu: undefined, motherboard: '' })).toBe(0);
    expect(coreBuildCount({ gpu: '   ' })).toBe(0);
  });

  it('never exceeds eight, whatever else the selection carries', () => {
    const everything: Record<string, string> = {};
    for (const category of [...CORE_BUILD_CATEGORIES, 'monitor', 'keyboard', 'mouse', 'headset']) {
      everything[category] = `${category}-1`;
    }
    expect(coreBuildCount(everything as never)).toBe(CORE_BUILD_TOTAL);
  });

  it('asks nothing about the id beyond its existence', () => {
    // THE DEFECT, AS A PROPERTY. The old counter resolved each id to a
    // canonical part and only when the listing's specs were verified. Any
    // string counts here, because "have you chosen one?" and "can we model
    // it?" are different questions.
    expect(coreBuildCount({ cpu: 'retail-cpu-nobody-has-verified' })).toBe(1);
    expect(coreBuildCount({ psu: 'a-delisted-sku' })).toBe(1);
  });
});

describe('what to offer next', () => {
  it('is the first unchosen category in assembly order', () => {
    expect(nextMissingCoreCategory({})).toBe('gpu');
    expect(nextMissingCoreCategory({ gpu: 'g1' })).toBe('cpu');
    expect(nextMissingCoreCategory({ gpu: 'g1', cpu: 'c1' })).toBe('motherboard');
  });

  it('skips over what is already chosen rather than restarting', () => {
    expect(nextMissingCoreCategory({ gpu: 'g1', motherboard: 'm1' })).toBe('cpu');
    expect(nextMissingCoreCategory({ cpu: 'c1' })).toBe('gpu');
  });

  it('is null once the core build is complete', () => {
    const full: Record<string, string> = {};
    for (const category of CORE_BUILD_CATEGORIES) full[category] = `${category}-1`;
    expect(nextMissingCoreCategory(full as never)).toBeNull();
    expect(missingCoreCategories(full as never)).toHaveLength(0);
  });

  it('agrees with the count at every step of filling a build', () => {
    // Walked rather than sampled: chosen + missing must always be eight, and
    // the next suggestion must always be one of the missing.
    const selection: Record<string, string> = {};
    for (let filled = 0; filled <= CORE_BUILD_TOTAL; filled += 1) {
      const chosen = chosenCoreCategories(selection as never);
      const missing = missingCoreCategories(selection as never);
      expect(chosen.length).toBe(filled);
      expect(chosen.length + missing.length).toBe(CORE_BUILD_TOTAL);
      const next = nextMissingCoreCategory(selection as never);
      if (filled === CORE_BUILD_TOTAL) expect(next).toBeNull();
      else expect(missing).toContain(next);
      if (next) selection[next] = `${next}-1`;
    }
  });
});

describe('the label', () => {
  it('says what it counts', () => {
    expect(coreBuildLabel({})).toBe('Core build: 0 of 8 parts selected');
    expect(coreBuildLabel({ gpu: 'g1', cpu: 'c1' })).toBe('Core build: 2 of 8 parts selected');
  });

  it('says nothing about verification or compatibility', () => {
    // The old label read "N of 8 selected" while counting resolved, verified
    // parts. The words have to match the arithmetic.
    const label = coreBuildLabel({ gpu: 'g1' }).toLowerCase();
    for (const word of ['verified', 'compatible', 'checked', 'supported']) {
      expect(label, word).not.toContain(word);
    }
  });
});

describe('against the published catalogue', () => {
  it('counts the categories the old rule could not', () => {
    // The reason this bug was invisible in review and obvious in use: seven of
    // the eight core categories publish unverified specs, so the old counter
    // could only ever move for a graphics card.
    const unverified = CORE_BUILD_CATEGORIES.filter((category) =>
      parsed.catalog.parts.some((part) => part.category === category && !part.specsVerified),
    );
    expect(unverified.length).toBeGreaterThan(1);

    const selection: Record<string, string> = {};
    for (const category of unverified) {
      selection[category] = parsed.catalog.parts.find((p) => p.category === category)!.id;
    }
    expect(coreBuildCount(selection as never)).toBe(unverified.length);
  });
});

describe('the call to action reads like English', () => {
  it('gives each category its own sentence rather than gluing an article on', () => {
    // "Choose a " + label produces "Choose a memory" and "Choose a storage".
    expect(coreCategoryAction('ram')).toBe('Choose memory');
    expect(coreCategoryAction('storage')).toBe('Choose storage');
    expect(coreCategoryAction('gpu')).toBe('Choose a graphics card');
    expect(coreCategoryAction('psu')).toBe('Choose a power supply');
  });

  it('has a sentence for every core category, and none is empty', () => {
    for (const category of CORE_BUILD_CATEGORIES) {
      expect(coreCategoryAction(category), category).toMatch(/^Choose /);
      expect(coreCategoryAction(category).trim().split(' ').length, category).toBeGreaterThan(1);
    }
  });
});
