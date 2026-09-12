import { describe, expect, it } from 'vitest';

import { prebuilts } from '../prebuilts';
import { RETAIL_PART_CATEGORIES } from './partCatalog';
import {
  CHOOSE_CURRENT_LISTING_LABEL,
  GUIDE_OPEN_PARAM,
  chooseCurrentListingLabel,
  guidePlanUrl,
  isShoppableCategory,
  openCategoryFrom,
} from './guidePlanHandoff';

const paramsOf = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

describe('the whole plan travels, not just the clicked part', () => {
  it('carries every category the guide names', () => {
    const plan = prebuilts[0].parts;
    const params = paramsOf(guidePlanUrl(plan, 'psu'));
    for (const [category, id] of Object.entries(plan)) {
      expect(params.get(category), category).toBe(id);
    }
  });

  it('loses nothing when a category is opened', () => {
    // Clicking the power supply row must not empty the other seven slots:
    // the shopper still wants the build they were reading about.
    const plan = prebuilts[0].parts;
    const withOpen = paramsOf(guidePlanUrl(plan, 'psu'));
    const without = paramsOf(guidePlanUrl(plan));
    for (const category of Object.keys(plan)) {
      expect(withOpen.get(category), category).toBe(without.get(category));
    }
    expect(withOpen.get(GUIDE_OPEN_PARAM)).toBe('psu');
    expect(without.get(GUIDE_OPEN_PARAM)).toBeNull();
  });

  it('points at the builder', () => {
    expect(guidePlanUrl(prebuilts[0].parts, 'gpu').startsWith('/builder?')).toBe(true);
  });
});

describe('reading the category back', () => {
  it('round-trips every shoppable category', () => {
    for (const category of RETAIL_PART_CATEGORIES) {
      const params = paramsOf(guidePlanUrl({ gpu: 'g1' }, category));
      expect(openCategoryFrom(params), category).toBe(category);
    }
  });

  it('ignores a category that does not exist', () => {
    // This arrives from a URL, which anyone can type.
    for (const junk of ['motherboards', 'GPU', '../admin', '', 'undefined']) {
      expect(openCategoryFrom(new URLSearchParams(`open=${junk}`)), junk).toBeNull();
    }
  });

  it('is null when nothing was asked for', () => {
    expect(openCategoryFrom(new URLSearchParams('gpu=rtx5090'))).toBeNull();
  });
});

describe('the action names itself', () => {
  it('reads the same to a sighted user on every row', () => {
    expect(CHOOSE_CURRENT_LISTING_LABEL).toBe('Choose current listing');
  });

  it('gives a screen reader the category and the model', () => {
    // Eight rows reading "Choose current listing" are eight identical
    // announcements without them.
    const label = chooseCurrentListingLabel('gpu', 'RTX 5090');
    expect(label).toContain('Choose current listing');
    expect(label.toLowerCase()).toContain('graphics card');
    expect(label).toContain('RTX 5090');
  });

  it('is distinct for every category of one plan', () => {
    const plan = prebuilts[0].parts;
    const names = Object.entries(plan)
      .filter(([category]) => isShoppableCategory(category))
      .map(([category, id]) => chooseCurrentListingLabel(category as never, id));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('what counts as shoppable', () => {
  it('accepts every real retail category', () => {
    for (const category of RETAIL_PART_CATEGORIES) {
      expect(isShoppableCategory(category), category).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const junk of ['prebuilt', 'os', 'warranty', '']) {
      expect(isShoppableCategory(junk), junk).toBe(false);
    }
  });
});
