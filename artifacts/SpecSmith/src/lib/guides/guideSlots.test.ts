import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from '../retail/partCatalog';
import {
  GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW,
  GUIDE_SLOT_BINDINGS,
  bindingFor,
  editorialReviewFor,
} from './guideBindings';
import {
  CATALOGUE_PENDING,
  availableParts,
  catalogueReady,
  guideBuildSelection,
  guideSubtotal,
  isGuideComplete,
  isGuidePending,
  namedCategories,
  resolveGuideSlots,
  unavailableCategories,
  uncheckedCategories,
} from './guideSlots';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const publishedParts = new Map(parsed.catalog.parts.map((p) => [p.id, p]));
const published = catalogueReady(publishedParts);
/** A fixed clock inside the freshness window of the published snapshot. */
const NOW = Date.parse(parsed.catalog.parts[0].fetchedAt) + 60_000;

const SLOTS = { gpu: 'rx6600', cpu: 'r5-5600', case: 'nzxth510' } as const;

describe('every binding is reviewed, and says so', () => {
  it('names an exact model and the date a person checked it', () => {
    expect(GUIDE_SLOT_BINDINGS.length).toBeGreaterThan(0);
    for (const b of GUIDE_SLOT_BINDINGS) {
      expect(b.exactModel, b.neweggPartId).toBeTruthy();
      expect(b.manufacturer, b.neweggPartId).toBeTruthy();
      expect(b.reviewedOn, b.neweggPartId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.why.length, b.neweggPartId).toBeGreaterThan(20);
    }
  });

  it('points at a listing that is really in the published catalogue', () => {
    // A binding to an id nobody carries is a typo, not a review.
    for (const b of GUIDE_SLOT_BINDINGS) {
      expect(publishedParts.has(b.neweggPartId), `${b.guideId}/${b.category} -> ${b.neweggPartId}`).toBe(true);
    }
  });

  it('binds to the category it claims', () => {
    for (const b of GUIDE_SLOT_BINDINGS) {
      expect(publishedParts.get(b.neweggPartId)!.category, b.neweggPartId).toBe(b.category);
    }
  });

  it('never invents a part number', () => {
    // Null is a real answer. A code that is present must appear in the
    // listing's own title, which is where the reviewer read it.
    for (const b of GUIDE_SLOT_BINDINGS) {
      if (b.manufacturerPartNumber === null) continue;
      const title = publishedParts.get(b.neweggPartId)!.name;
      expect(title, `${b.neweggPartId} should state ${b.manufacturerPartNumber}`)
        .toContain(b.manufacturerPartNumber);
    }
  });

  it('does not both bind and flag the same slot', () => {
    for (const b of GUIDE_SLOT_BINDINGS) {
      const flagged = GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW.find(
        (s) => s.guideId === b.guideId && s.category === b.category,
      );
      expect(flagged, `${b.guideId}/${b.category} is both bound and flagged`).toBeUndefined();
    }
  });

  it('explains every slot it declined to bind', () => {
    for (const s of GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW) {
      expect(s.note.length, `${s.guideId}/${s.category}`).toBeGreaterThan(20);
      expect(['no-exact-listing', 'needs-editorial-review']).toContain(s.reason);
    }
  });
});

describe('resolving a guide against the catalogue', () => {
  it('returns the exact listing for a bound, carried slot', () => {
    const binding = GUIDE_SLOT_BINDINGS[0];
    const states = resolveGuideSlots(binding.guideId, { [binding.category]: binding.canonicalPartId }, published);
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe('available');
    if (states[0].status !== 'available') throw new Error('unreachable');
    expect(states[0].part.id).toBe(binding.neweggPartId);
  });

  it('reports an unbound slot rather than guessing one', () => {
    const states = resolveGuideSlots('budget-beast', { gpu: SLOTS.gpu }, published);
    expect(states[0].status).toBe('unbound');
    if (states[0].status !== 'unbound') throw new Error('unreachable');
    expect(states[0].unbound?.reason).toBe('no-exact-listing');
  });

  it('resolves by exact id only — a same-category listing is not a substitute', () => {
    const binding = GUIDE_SLOT_BINDINGS[0];
    const others = parsed.catalog.parts.filter(
      (p) => p.category === binding.category && p.id !== binding.neweggPartId,
    );
    expect(others.length, 'no sibling listings to test against').toBeGreaterThan(0);
    // A catalogue full of that category but missing the bound id resolves to
    // delisted, not to a neighbour.
    const withoutBound = catalogueReady(new Map(others.map((p) => [p.id, p])));
    const states = resolveGuideSlots(
      binding.guideId,
      { [binding.category]: binding.canonicalPartId },
      withoutBound,
    );
    expect(states[0].status).toBe('delisted');
  });
});

describe('when a bound SKU disappears after a catalogue refresh', () => {
  // THE EXACT CONDITION, reproduced deterministically: take the published
  // catalogue and remove precisely the bound id. Nothing here looks for a
  // replacement target, and that is the point — the guide must go unavailable
  // rather than quietly re-point at whatever else happens to be on the shelf.
  const binding = GUIDE_SLOT_BINDINGS[0];
  const afterRefreshParts = new Map(publishedParts);
  afterRefreshParts.delete(binding.neweggPartId);
  const afterRefresh = catalogueReady(afterRefreshParts);

  const guideParts = { [binding.category]: binding.canonicalPartId };

  it('turns that slot unavailable', () => {
    const states = resolveGuideSlots(binding.guideId, guideParts, afterRefresh);
    expect(states[0].status).toBe('delisted');
  });

  it('keeps the binding on record, so the guide can recover if it returns', () => {
    expect(bindingFor(binding.guideId, binding.category)?.neweggPartId).toBe(binding.neweggPartId);
  });

  it('does not substitute another product', () => {
    const states = resolveGuideSlots(binding.guideId, guideParts, afterRefresh);
    expect(availableParts(states)).toHaveLength(0);
    expect(guideBuildSelection(states)).toEqual({});
  });

  it('leaves the amount out of the subtotal instead of estimating it', () => {
    const before = guideSubtotal(resolveGuideSlots(binding.guideId, guideParts, published), NOW);
    const after = guideSubtotal(resolveGuideSlots(binding.guideId, guideParts, afterRefresh), NOW);
    expect(before.countedItems).toBe(1);
    expect(after.countedItems).toBe(0);
    expect(after.knownTotal).toBe(0);
    expect(after.complete).toBe(false);
  });

  it('names the category a shopper can no longer buy', () => {
    const states = resolveGuideSlots(binding.guideId, guideParts, afterRefresh);
    expect(unavailableCategories(states)).toEqual([binding.category]);
  });
});

describe('the subtotal only adds up what is really there', () => {
  const guide = '4k-monster';
  const parts = { cpu: 'r9-7950x3d', case: 'fdtorrent', gpu: 'rtx4080s' };

  it('counts the available listings and no editorial estimate', () => {
    const states = resolveGuideSlots(guide, parts, published);
    const summary = guideSubtotal(states, NOW);
    const expected = availableParts(states).reduce(
      (sum, p) => sum + (p.salePrice ?? p.retailPrice),
      0,
    );
    expect(summary.knownTotal).toBeCloseTo(Number(expected.toFixed(2)), 2);
    expect(summary.countedItems).toBe(availableParts(states).length);
  });

  it('is explicitly incomplete while a slot has no listing', () => {
    const states = resolveGuideSlots(guide, parts, published);
    expect(isGuideComplete(states)).toBe(false);
    expect(guideSubtotal(states, NOW).complete).toBe(false);
    expect(unavailableCategories(states)).toContain('gpu');
  });

  it('says which categories are missing, in words', () => {
    expect(namedCategories(['gpu'])).toBe('graphics card');
    expect(namedCategories(['gpu', 'psu'])).toMatch(/ and /);
    expect(namedCategories([])).toBe('');
  });
});

describe('what Load into Builder hands over', () => {
  it('is exact listing ids, never canonical model ids', () => {
    const guide = '4k-monster';
    const states = resolveGuideSlots(guide, { cpu: 'r9-7950x3d', case: 'fdtorrent', gpu: 'rtx4080s' }, published);
    const selection = guideBuildSelection(states);

    for (const [category, id] of Object.entries(selection)) {
      const part = publishedParts.get(id);
      expect(part, `${category} -> ${id} is not a catalogue listing`).toBeTruthy();
      expect(part!.category).toBe(category);
    }
    // The unbound GPU is absent rather than carried over as "rtx4080s",
    // which is what used to produce a recommendation card.
    expect(selection).not.toHaveProperty('gpu');
    expect(Object.values(selection)).not.toContain('rtx4080s');
  });

  it('hands over nothing at all for a guide with no bindings', () => {
    const states = resolveGuideSlots('1080p-champion', { gpu: 'rtx4060ti', cpu: 'i5-13600k' }, published);
    expect(guideBuildSelection(states)).toEqual({});
  });
});

describe('the coverage this catalogue can actually support', () => {
  it('flags every slot that is not bound, for every guide', () => {
    // Not a vanity metric: an editor needs the list, and a silent hole is how
    // a guide ends up recommending something nobody can buy.
    for (const guideId of new Set(GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW.map((s) => s.guideId))) {
      expect(editorialReviewFor(guideId).length, guideId).toBeGreaterThan(0);
    }
  });

  it('records that no guide is fully bound against the current catalogue', () => {
    // If this ever fails it is good news and the note in guideBindings.ts
    // should be updated to match.
    const guides = new Set([
      ...GUIDE_SLOT_BINDINGS.map((b) => b.guideId),
      ...GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW.map((s) => s.guideId),
    ]);
    for (const guideId of guides) {
      expect(editorialReviewFor(guideId).length, `${guideId} is now fully bound`).toBeGreaterThan(0);
    }
  });
});

describe('a catalogue that has not answered', () => {
  // REVIEW BLOCKER. An empty map meant both "the download failed" and "this
  // listing is gone", so a guide opened during a failed fetch announced that
  // every one of its products was unavailable — a claim about the world
  // derived from a claim about our own network.
  const binding = GUIDE_SLOT_BINDINGS[0];
  const guideParts = { [binding.category]: binding.canonicalPartId };

  it('leaves the slot unchecked, not unavailable', () => {
    const states = resolveGuideSlots(binding.guideId, guideParts, CATALOGUE_PENDING);
    expect(states[0].status).toBe('unchecked');
    expect(unavailableCategories(states)).toHaveLength(0);
    expect(uncheckedCategories(states)).toEqual([binding.category]);
    expect(isGuidePending(states)).toBe(true);
  });

  it('claims no subtotal it has not checked', () => {
    const summary = guideSubtotal(resolveGuideSlots(binding.guideId, guideParts, CATALOGUE_PENDING), NOW);
    expect(summary.countedItems).toBe(0);
    expect(summary.complete).toBe(false);
  });

  it('hands the Builder nothing while it cannot see the catalogue', () => {
    const states = resolveGuideSlots(binding.guideId, guideParts, CATALOGUE_PENDING);
    expect(guideBuildSelection(states)).toEqual({});
  });

  it('is told apart from a listing that really is gone', () => {
    const gone = catalogueReady(new Map());
    const delisted = resolveGuideSlots(binding.guideId, guideParts, gone);
    expect(delisted[0].status).toBe('delisted');
    expect(unavailableCategories(delisted)).toEqual([binding.category]);
    expect(isGuidePending(delisted)).toBe(false);
  });
});

describe('a binding that no longer matches its guide slot', () => {
  // REVIEW BLOCKER. The registry is keyed by guide and category, not by
  // product, so editing a guide's processor without re-reviewing its binding
  // would leave the old listing resolving under the new heading: the guide
  // would name one product and sell another.
  const binding = GUIDE_SLOT_BINDINGS[0];

  it('fails closed rather than showing the bound listing', () => {
    const states = resolveGuideSlots(
      binding.guideId,
      { [binding.category]: 'some-other-canonical-part' },
      published,
    );
    expect(states[0].status).toBe('mismatched');
    expect(availableParts(states)).toHaveLength(0);
  });

  it('keeps the mismatched product out of the Builder handoff', () => {
    const states = resolveGuideSlots(
      binding.guideId,
      { [binding.category]: 'some-other-canonical-part' },
      published,
    );
    expect(guideBuildSelection(states)).toEqual({});
  });

  it('keeps it out of the subtotal', () => {
    const states = resolveGuideSlots(
      binding.guideId,
      { [binding.category]: 'some-other-canonical-part' },
      published,
    );
    expect(guideSubtotal(states, NOW).countedItems).toBe(0);
    expect(unavailableCategories(states)).toEqual([binding.category]);
  });

  it('still resolves when the guide names the product the binding reviewed', () => {
    const states = resolveGuideSlots(
      binding.guideId,
      { [binding.category]: binding.canonicalPartId },
      published,
    );
    expect(states[0].status).toBe('available');
  });

  it('holds for every binding in the registry', () => {
    for (const b of GUIDE_SLOT_BINDINGS) {
      const ok = resolveGuideSlots(b.guideId, { [b.category]: b.canonicalPartId }, published);
      expect(ok[0].status, `${b.guideId}/${b.category}`).toBe('available');
      const bad = resolveGuideSlots(b.guideId, { [b.category]: `${b.canonicalPartId}-changed` }, published);
      expect(bad[0].status, `${b.guideId}/${b.category}`).toBe('mismatched');
    }
  });
});
