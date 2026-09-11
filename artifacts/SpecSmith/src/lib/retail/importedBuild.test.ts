import { describe, expect, it } from 'vitest';

import {
  CHOOSE_LISTING_LABEL,
  IMPORTED_BADGE,
  IMPORTED_PRICE_NOTE,
  importedRecommendations,
  recognisedPartIds,
  slotOrigin,
  type CanonicalPartRef,
} from './importedBuild';

const retail = new Set(['retail-gpu-1', 'retail-cpu-1']);
const canonical = new Map<string, CanonicalPartRef>([
  ['rx6600', { id: 'rx6600', name: 'Radeon RX 6600', estimatedPrice: 199 }],
  ['r5-5600', { id: 'r5-5600', name: 'Ryzen 5 5600', estimatedPrice: 129 }],
  ['b550tom', { id: 'b550tom', name: 'B550 Tomahawk' }],
]);

describe('where a slot comes from', () => {
  it('recognises an exact retailer listing', () => {
    expect(slotOrigin('retail-gpu-1', retail, canonical)).toBe('retail');
  });

  it('recognises a canonical model as imported', () => {
    expect(slotOrigin('rx6600', retail, canonical)).toBe('imported');
  });

  it('rejects an id that names neither', () => {
    // A stale share link, a delisted SKU, a typo. Unchanged behaviour: an id
    // nobody recognises does not become a part.
    expect(slotOrigin('gpu-that-never-existed', retail, canonical)).toBe('unknown');
    expect(slotOrigin(null, retail, canonical)).toBe('unknown');
    expect(slotOrigin('', retail, canonical)).toBe('unknown');
    expect(slotOrigin('   ', retail, canonical)).toBe('unknown');
  });

  it('prefers the exact listing when an id is somehow both', () => {
    // An exact listing is strictly better information than a model, and a
    // shopper holding one must never be demoted to a recommendation.
    const both = new Map(canonical);
    both.set('retail-gpu-1', { id: 'retail-gpu-1', name: 'collision' });
    expect(slotOrigin('retail-gpu-1', retail, both)).toBe('retail');
  });
});

describe('the recommendations a build produces', () => {
  it('lists a canonical choice per category, in assembly order', () => {
    const found = importedRecommendations(
      { cpu: 'r5-5600', gpu: 'rx6600' },
      retail,
      canonical,
    );
    expect(found.map((r) => r.category)).toEqual(['gpu', 'cpu']);
    expect(found[0]).toMatchObject({ canonicalId: 'rx6600', name: 'Radeon RX 6600', estimatedPrice: 199 });
  });

  it('produces nothing for a slot holding a real listing', () => {
    // This is how a recommendation is REPLACED rather than accumulated: pick a
    // listing and the slot stops being imported, with no second state to clear.
    expect(importedRecommendations({ gpu: 'retail-gpu-1' }, retail, canonical)).toHaveLength(0);
  });

  it('replaces exactly one slot, leaving the others alone', () => {
    const before = importedRecommendations({ gpu: 'rx6600', cpu: 'r5-5600' }, retail, canonical);
    const after = importedRecommendations({ gpu: 'retail-gpu-1', cpu: 'r5-5600' }, retail, canonical);
    expect(before.map((r) => r.category)).toEqual(['gpu', 'cpu']);
    expect(after.map((r) => r.category)).toEqual(['cpu']);
  });

  it('produces nothing for an unknown id', () => {
    expect(importedRecommendations({ gpu: 'nonsense' }, retail, canonical)).toHaveLength(0);
  });

  it('carries no price when the model has no estimate', () => {
    // Absent, not zero. A missing estimate is unknown, and unknown is not free.
    const [board] = importedRecommendations({ motherboard: 'b550tom' }, retail, canonical);
    expect(board.estimatedPrice).toBeUndefined();
    expect('estimatedPrice' in board).toBe(false);
  });

  it('never invents a retailer listing for a model', () => {
    // THE RULE THIS FILE EXISTS FOR. One model has several distinct SKUs at
    // different prices; choosing one for the shopper would invent a purchase
    // decision. A recommendation names its canonical model and nothing else.
    const [gpu] = importedRecommendations({ gpu: 'rx6600' }, retail, canonical);
    expect(gpu.canonicalId).toBe('rx6600');
    expect(Object.keys(gpu).sort()).toEqual(['canonicalId', 'category', 'estimatedPrice', 'name']);
  });
});

describe('what the counter counts', () => {
  it('is exact listings and recognised models together', () => {
    const recognised = recognisedPartIds(retail, canonical);
    expect(recognised.has('retail-gpu-1')).toBe(true);
    expect(recognised.has('rx6600')).toBe(true);
    expect(recognised.has('nonsense')).toBe(false);
    expect(recognised.size).toBe(retail.size + canonical.size);
  });
});

describe('the words shown to a shopper', () => {
  it('say estimate, and say it is not a retailer price', () => {
    expect(IMPORTED_PRICE_NOTE.toLowerCase()).toContain('estimated');
    expect(IMPORTED_PRICE_NOTE.toLowerCase()).toContain('not a current retailer');
    expect(IMPORTED_BADGE).toBe('Imported recommendation');
    expect(CHOOSE_LISTING_LABEL).toBe('Choose current listing');
  });

  it('never claim availability or a live price', () => {
    for (const copy of [IMPORTED_PRICE_NOTE, IMPORTED_BADGE, CHOOSE_LISTING_LABEL]) {
      expect(copy.toLowerCase()).not.toContain('in stock');
      expect(copy.toLowerCase()).not.toMatch(/\bcurrent price\b/);
    }
  });
});

describe('peripherals are recommendations too', () => {
  // They arrive through exactly the same links a core part does — a Build
  // Crate roll hands over a monitor and a headset alongside the GPU — and one
  // dropped because it is "only" a peripheral is still a part that vanished.
  const peripherals = new Map<string, CanonicalPartRef>([
    ['mon-1', { id: 'mon-1', name: '27in 1440p', estimatedPrice: 249 }],
    ['kb-1', { id: 'kb-1', name: 'Tenkeyless board', estimatedPrice: 89 }],
    ['mouse-1', { id: 'mouse-1', name: 'Lightweight mouse' }],
    ['hs-1', { id: 'hs-1', name: 'Closed-back headset', estimatedPrice: 99 }],
  ]);

  it('recognises all four', () => {
    const found = importedRecommendations(
      { monitor: 'mon-1', keyboard: 'kb-1', mouse: 'mouse-1', headset: 'hs-1' },
      new Set(),
      peripherals,
    );
    expect(found.map((r) => r.category)).toEqual(['monitor', 'keyboard', 'mouse', 'headset']);
  });

  it('covers all twelve categories in one build', () => {
    const everything = new Map<string, CanonicalPartRef>([...canonical, ...peripherals]);
    const selection: Record<string, string> = {
      gpu: 'rx6600', cpu: 'r5-5600', motherboard: 'b550tom',
      monitor: 'mon-1', keyboard: 'kb-1', mouse: 'mouse-1', headset: 'hs-1',
    };
    const found = importedRecommendations(selection, new Set(), everything);
    expect(found).toHaveLength(7);
    // Category order is the catalogue's own, so core parts still come first.
    expect(found.map((r) => r.category)).toEqual([
      'gpu', 'cpu', 'motherboard', 'monitor', 'keyboard', 'mouse', 'headset',
    ]);
  });

  it('is replaced by an exact peripheral SKU like any other slot', () => {
    const retailMonitor = new Set(['retail-monitor-1']);
    const found = importedRecommendations(
      { monitor: 'retail-monitor-1', keyboard: 'kb-1' },
      retailMonitor,
      peripherals,
    );
    expect(found.map((r) => r.category)).toEqual(['keyboard']);
  });
});
