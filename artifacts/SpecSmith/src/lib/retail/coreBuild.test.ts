import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';
import {
  CORE_BUILD_CATEGORIES,
  CORE_BUILD_CHECKING_LABEL,
  CORE_BUILD_TOTAL,
  coreBuildCount,
  coreBuildLabel,
  coreCategoryAction,
  coreReplacementAction,
  coreSlotState,
  describeCoreBuild,
  nextMissingCoreCategory,
  unavailableCoreCategories,
  unavailableCoreNotice,
  type CoreBuildCategory,
} from './coreBuild';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);

/** A catalogue holding exactly these ids. Deterministic: a plain Set. */
const holding = (...ids: string[]): ReadonlySet<string> => new Set(ids);
/** A catalogue that holds nothing. */
const EMPTY: ReadonlySet<string> = new Set();
/** A catalogue that has not answered yet. */
const LOADING = null;

const filled = (): Record<string, string> => {
  const selection: Record<string, string> = {};
  for (const category of CORE_BUILD_CATEGORIES) selection[category] = `${category}-1`;
  return selection;
};
const allOf = (selection: Record<string, string>) => holding(...Object.values(selection));

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
    expect(describeCoreBuild({ monitor: 'm1', keyboard: 'k1' } as never, holding('m1', 'k1')).count)
      .toBe(0);
  });
});

describe('the three states a slot can be in', () => {
  it('tells empty, present, unavailable and unknown apart', () => {
    expect(coreSlotState(null, EMPTY)).toBe('empty');
    expect(coreSlotState('   ', EMPTY)).toBe('empty');
    expect(coreSlotState(undefined, EMPTY)).toBe('empty');
    expect(coreSlotState('g1', holding('g1'))).toBe('present');
    expect(coreSlotState('g1', EMPTY)).toBe('unavailable');
    expect(coreSlotState('g1', LOADING)).toBe('unknown');
  });

  it('calls an unfilled slot empty even before the catalogue answers', () => {
    // There is nothing to check, so there is nothing unknown about it.
    expect(coreSlotState(null, LOADING)).toBe('empty');
  });
});

describe('counting', () => {
  it('counts a slot the catalogue can fill, and ignores an empty one', () => {
    expect(describeCoreBuild({}, EMPTY).count).toBe(0);
    expect(describeCoreBuild({ gpu: 'g1' }, holding('g1')).count).toBe(1);
    expect(describeCoreBuild({ gpu: 'g1', cpu: 'c1', motherboard: 'm1' }, holding('g1','c1','m1')).count)
      .toBe(3);
  });

  it('treats null, undefined and blank as unchosen', () => {
    // `null` is what removing a part writes. A blank string is what a
    // half-decoded share link can produce, and it is not a part either.
    const status = describeCoreBuild({ gpu: null, cpu: undefined, motherboard: '' }, EMPTY);
    expect(status.count).toBe(0);
    expect(status.unavailable).toHaveLength(0);
  });

  it('never exceeds eight, whatever else the selection carries', () => {
    const everything: Record<string, string> = { ...filled() };
    for (const peripheral of ['monitor','keyboard','mouse','headset']) everything[peripheral] = `${peripheral}-1`;
    expect(describeCoreBuild(everything as never, holding(...Object.values(everything))).count)
      .toBe(CORE_BUILD_TOTAL);
  });

  it('asks nothing about verification — only whether the catalogue holds the id', () => {
    // Seven of the eight core categories publish unverified specs. They count.
    // "Have you chosen one?" and "can we model it?" are different questions.
    const status = describeCoreBuild(
      { cpu: 'unverified-cpu', psu: 'unverified-psu' },
      holding('unverified-cpu', 'unverified-psu'),
    );
    expect(status.count).toBe(2);
    expect(status.label.toLowerCase()).not.toContain('verified');
  });
});

describe('a saved id the catalogue no longer holds', () => {
  it('is not a completed part', () => {
    const status = describeCoreBuild({ gpu: 'g1', cpu: 'delisted' }, holding('g1'));
    expect(status.count).toBe(1);
    expect(status.slots.cpu).toBe('unavailable');
    expect(status.label).toBe('Core build: 1 of 8 parts selected');
  });

  it('is told apart from a slot that was never filled', () => {
    const status = describeCoreBuild({ cpu: 'delisted' }, EMPTY);
    expect(status.slots.cpu).toBe('unavailable');
    expect(status.slots.gpu).toBe('empty');
    expect(status.unavailable).toEqual(['cpu']);
  });

  it('is what gets offered next, in build order', () => {
    const status = describeCoreBuild({ gpu: 'g1', cpu: 'delisted', motherboard: 'm1' }, holding('g1','m1'));
    expect(status.next).toBe('cpu');
  });

  it('keeps a full-looking build from reading as complete', () => {
    const selection = filled();
    const allButPsu = holding(
      ...CORE_BUILD_CATEGORIES.filter((c) => c !== 'psu').map((c) => `${c}-1`),
    );
    const status = describeCoreBuild(selection as never, allButPsu);
    expect(status.count).toBe(7);
    expect(status.label).toBe('Core build: 7 of 8 parts selected');
    expect(status.next).toBe('psu');
    expect(status.notice).toMatch(/no longer available/i);
  });

  it('reports every stale category, not just the first', () => {
    const selection = filled();
    const onlyGpu = holding('gpu-1');
    const status = describeCoreBuild(selection as never, onlyGpu);
    expect(status.count).toBe(1);
    expect(status.unavailable).toEqual(
      CORE_BUILD_CATEGORIES.filter((c) => c !== 'gpu'),
    );
  });
});

describe('before the catalogue has answered', () => {
  it('states no number for a draft it has not checked', () => {
    const status = describeCoreBuild(filled() as never, LOADING);
    expect(status.settled).toBe(false);
    expect(status.count).toBe(0);
    expect(status.label).toBe(CORE_BUILD_CHECKING_LABEL);
    expect(status.label).not.toMatch(/\d/);
  });

  it('offers no next part, because it does not yet know which one', () => {
    expect(describeCoreBuild({ gpu: 'g1' }, LOADING).next).toBeNull();
    expect(describeCoreBuild(filled() as never, LOADING).next).toBeNull();
  });

  it('claims nothing is missing either', () => {
    // "Not known yet" is not evidence of absence. Telling a shopper their
    // part is gone while the page is still loading it would be a lie with a
    // short shelf life.
    const status = describeCoreBuild(filled() as never, LOADING);
    expect(status.unavailable).toHaveLength(0);
    expect(status.notice).toBeNull();
  });

  it('is settled when there is nothing waiting to be checked', () => {
    // An empty draft needs no catalogue, so "0 of 8" is already true.
    const status = describeCoreBuild({}, LOADING);
    expect(status.settled).toBe(true);
    expect(status.label).toBe('Core build: 0 of 8 parts selected');
  });

  it('is unsettled if even one saved slot is unchecked', () => {
    expect(describeCoreBuild({ cooler: 'c1' }, LOADING).settled).toBe(false);
  });
});

describe('what to offer next', () => {
  it('is the first slot without a part, in assembly order', () => {
    expect(describeCoreBuild({}, EMPTY).next).toBe('gpu');
    expect(describeCoreBuild({ gpu: 'g1' }, holding('g1')).next).toBe('cpu');
    expect(describeCoreBuild({ gpu: 'g1', cpu: 'c1' }, holding('g1','c1')).next).toBe('motherboard');
  });

  it('skips over what is already chosen rather than restarting', () => {
    expect(describeCoreBuild({ gpu: 'g1', motherboard: 'm1' }, holding('g1','m1')).next).toBe('cpu');
    expect(describeCoreBuild({ cpu: 'c1' }, holding('c1')).next).toBe('gpu');
  });

  it('is null once every core slot holds a part the catalogue has', () => {
    const selection = filled();
    const status = describeCoreBuild(selection as never, allOf(selection));
    expect(status.next).toBeNull();
    expect(status.count).toBe(CORE_BUILD_TOTAL);
    expect(status.notice).toBeNull();
  });

  it('agrees with the count at every step of filling a build', () => {
    // Walked rather than sampled: present + everything else is always eight,
    // and the next suggestion is always a slot without a part.
    const selection: Record<string, string> = {};
    const held = new Set<string>();
    for (let step = 0; step <= CORE_BUILD_TOTAL; step += 1) {
      const status = describeCoreBuild(selection as never, held);
      expect(status.count).toBe(step);
      const outstanding = CORE_BUILD_CATEGORIES.filter((c) => status.slots[c] !== 'present');
      expect(status.count + outstanding.length).toBe(CORE_BUILD_TOTAL);
      if (step === CORE_BUILD_TOTAL) expect(status.next).toBeNull();
      else expect(outstanding).toContain(status.next);
      if (status.next) {
        selection[status.next] = `${status.next}-1`;
        held.add(`${status.next}-1`);
      }
    }
  });
});

describe('the label', () => {
  it('says what it counts', () => {
    expect(describeCoreBuild({}, EMPTY).label).toBe('Core build: 0 of 8 parts selected');
    expect(describeCoreBuild({ gpu: 'g1', cpu: 'c1' }, holding('g1','c1')).label)
      .toBe('Core build: 2 of 8 parts selected');
  });

  it('says nothing about verification or compatibility', () => {
    const label = describeCoreBuild({ gpu: 'g1' }, holding('g1')).label.toLowerCase();
    for (const word of ['verified', 'compatible', 'checked', 'supported']) {
      expect(label, word).not.toContain(word);
    }
  });
});

describe('the one notice about saved parts that are gone', () => {
  it('says nothing when nothing is missing', () => {
    expect(unavailableCoreNotice([])).toBeNull();
    expect(describeCoreBuild({ gpu: 'g1' }, holding('g1')).notice).toBeNull();
  });

  it('names the single category to replace', () => {
    const notice = unavailableCoreNotice(['cpu'])!;
    expect(notice).toContain('no longer available');
    expect(notice.toLowerCase()).toContain('processor');
  });

  it('is ONE sentence naming several, not one sentence each', () => {
    const notice = unavailableCoreNotice(['cpu', 'psu', 'case'] as CoreBuildCategory[])!;
    expect(notice.match(/no longer available/g)).toHaveLength(1);
    expect(notice).toMatch(/ and /);
    for (const category of ['processor', 'power supply', 'case']) {
      expect(notice.toLowerCase(), category).toContain(category);
    }
  });

  it('invents no reason for the part being gone', () => {
    // All that is known is that this catalogue lacks the id.
    const notice = unavailableCoreNotice(['cpu', 'psu'] as CoreBuildCategory[])!.toLowerCase();
    for (const guess of ['discontinued', 'out of stock', 'sold out', 'recalled', 'price']) {
      expect(notice, guess).not.toContain(guess);
    }
  });

  it('matches what describeCoreBuild reports as unavailable', () => {
    const status = describeCoreBuild({ gpu: 'g1', cpu: 'gone', psu: 'gone-too' }, holding('g1'));
    expect(status.unavailable).toEqual(['cpu', 'psu']);
    expect(status.notice).toBe(unavailableCoreNotice(['cpu', 'psu'] as CoreBuildCategory[]));
    expect(unavailableCoreCategories({ gpu: 'g1', cpu: 'gone', psu: 'gone-too' }, holding('g1')))
      .toEqual(['cpu', 'psu']);
  });
});

describe('against the published catalogue', () => {
  const ids = new Set(parsed.catalog.parts.map((part) => part.id));

  it('counts the categories a verification-based rule could not', () => {
    // Seven of the eight core categories publish unverified specs, which is
    // why a counter keyed on verification could only ever move for a GPU.
    const unverified = CORE_BUILD_CATEGORIES.filter((category) =>
      parsed.catalog.parts.some((part) => part.category === category && !part.specsVerified),
    );
    expect(unverified.length).toBeGreaterThan(1);

    const selection: Record<string, string> = {};
    for (const category of unverified) {
      selection[category] = parsed.catalog.parts.find((p) => p.category === category)!.id;
    }
    const status = describeCoreBuild(selection as never, ids);
    expect(status.count).toBe(unverified.length);
    expect(status.unavailable).toHaveLength(0);
  });

  it('rejects an id the published catalogue has never carried', () => {
    const gpu = parsed.catalog.parts.find((p) => p.category === 'gpu')!;
    const status = describeCoreBuild({ gpu: gpu.id, cpu: 'retail-cpu-that-no-longer-exists' }, ids);
    expect(status.count).toBe(1);
    expect(status.slots.cpu).toBe('unavailable');
    expect(status.next).toBe('cpu');
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

  it('says "replacement" for a slot whose saved part has gone', () => {
    for (const category of CORE_BUILD_CATEGORIES) {
      expect(coreReplacementAction(category), category).toMatch(/^Choose a replacement /);
    }
  });
});

describe('the catalogue argument cannot be forgotten', () => {
  it('is required by the type, so no caller can count without checking', () => {
    // The regression that brought this file back twice was an OPTIONAL
    // catalogue: leaving the argument off returned a confident number that
    // had validated nothing. These calls must not compile without it.
    // @ts-expect-error the catalogue is required
    void (() => coreBuildCount({ gpu: 'g1' }));
    // @ts-expect-error the catalogue is required
    void (() => coreBuildLabel({ gpu: 'g1' }));
    // @ts-expect-error the catalogue is required
    void (() => nextMissingCoreCategory({ gpu: 'g1' }));
    // @ts-expect-error the catalogue is required
    void (() => describeCoreBuild({ gpu: 'g1' }));
    expect(true).toBe(true);
  });
});
