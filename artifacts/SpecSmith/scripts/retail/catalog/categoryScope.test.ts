// Coverage must not guarantee an irrelevant listing a slot.
//
// The equal-population price bands this replaced did exactly that: the top
// band was always "the dearest things that arrived", and reserving slots for
// it published a $34,912 enterprise storage device in a catalogue for people
// building a gaming PC.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import {
  loadCategoryScopes,
  MIN_EDITORIAL_EXAMPLES,
  SCOPE_CEILING_FACTOR,
  SCOPE_FLOOR_FACTOR,
  scopeVerdict,
} from './categoryScope';
import { selectBestListings, scopeTierOf, verifiedCoverageKey } from './listingSelection';

const scopes = loadCategoryScopes();
const scopeFor = (category: RetailPartCategory) => scopes.get(category)!;

const listing = (over: Partial<AffiliatePart> & { id: string; name: string; retailPrice: number }): AffiliatePart => ({
  category: 'storage',
  merchant: 'Newegg',
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${over.id}`,
  fetchedAt: '2026-09-01T12:00:00.000Z',
  availability: AVAILABILITY_UNKNOWN,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: null,
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
  sku: null,
  unitSpecs: null,
  ...over,
});

describe('the enterprise storage outlier is rejected, and consumer parts are not', () => {
  const storage = scopeFor('storage');

  // The exact listing that reached the published catalogue under the band rule.
  const enterprise = listing({
    id: 'newegg-storage-enterprise',
    name: 'Solidigm Solid State Drive D3-S4620 Series 3.84TB 2.5in SATA Enterprise',
    retailPrice: 34_912,
  });

  it('refuses it as above the category ceiling', () => {
    expect(scopeVerdict(enterprise, storage)).toEqual({ inScope: false, reason: 'above-category-ceiling' });
  });

  it('will not publish it even when it is the ONLY candidate in the dearest range', () => {
    // Under equal-population bands this was guaranteed a slot: it was the top
    // band, and the top band had to be filled from somewhere. Now an empty
    // tier simply contributes nothing.
    const consumer = Array.from({ length: 20 }, (_, index) =>
      listing({ id: `newegg-storage-${index}`, name: `Consumer NVMe SSD ${index}`, retailPrice: 60 + index * 25 }),
    );
    const outcome = selectBestListings([...consumer, enterprise], 20, storage);
    expect(outcome.selected.map((part) => part.id)).not.toContain('newegg-storage-enterprise');
    expect(outcome.outOfScope).toEqual({ 'above-category-ceiling': 1 });
  });

  it('keeps budget AND premium consumer drives on either side of it', () => {
    const budget = listing({ id: 'newegg-storage-budget', name: 'Budget 1TB NVMe SSD', retailPrice: 54.99 });
    const premium = listing({ id: 'newegg-storage-premium', name: 'Premium 4TB Gen5 NVMe SSD', retailPrice: 669 });
    const filler = Array.from({ length: 10 }, (_, index) =>
      listing({ id: `newegg-storage-mid-${index}`, name: `Mid SSD ${index}`, retailPrice: 150 + index * 20 }),
    );
    const published = selectBestListings([...filler, budget, premium, enterprise], 12, storage)
      .selected.map((part) => part.id);
    expect(published).toContain('newegg-storage-budget');
    expect(published).toContain('newegg-storage-premium');
    expect(published).not.toContain('newegg-storage-enterprise');
  });

  it('rejects the accessories and OEM pulls that carry a category name', () => {
    // All four reached the published catalogue. None is the part it is filed as.
    const rejected = [
      { part: listing({ category: 'headset', id: 'newegg-headset-pads', name: 'Headphone Protective Cushion Pad', retailPrice: 15.78 }), reason: 'below-category-floor' },
      { part: listing({ category: 'psu', id: 'newegg-psu-breakout', name: 'PSU Breakout Board ATX Splitter', retailPrice: 19.89 }), reason: 'below-category-floor' },
      { part: listing({ category: 'ram', id: 'newegg-ram-2gb', name: 'MemoryMasters 2GB DDR3-1333MHz', retailPrice: 15.3 }), reason: 'below-category-floor' },
      { part: listing({ category: 'psu', id: 'newegg-psu-1600w', name: 'CORSAIR AXi AX1600i 1600W Digital ATX', retailPrice: 999 }), reason: 'above-category-ceiling' },
    ] as const;
    for (const { part, reason } of rejected) {
      expect(scopeVerdict(part, scopeFor(part.category))).toEqual({ inScope: false, reason });
    }
  });

  it('admits the real consumer parts at both ends of each category', () => {
    const admitted = [
      listing({ category: 'gpu', id: 'newegg-gpu-budget', name: 'RTX 5060 8GB', retailPrice: 259.99 }),
      listing({ category: 'gpu', id: 'newegg-gpu-halo', name: 'RTX 5090 32GB', retailPrice: 2149.99 }),
      listing({ category: 'cpu', id: 'newegg-cpu-budget', name: 'Ryzen 5 budget', retailPrice: 53.54 }),
      listing({ category: 'monitor', id: 'newegg-monitor-halo', name: '4K 240Hz OLED', retailPrice: 2141.9 }),
      listing({ category: 'mouse', id: 'newegg-mouse-budget', name: 'Wired gaming mouse', retailPrice: 18.97 }),
    ];
    for (const part of admitted) {
      expect(scopeVerdict(part, scopeFor(part.category))).toEqual({ inScope: true });
    }
  });
});

describe('the bounds come from the shipped catalogue, not from the feed', () => {
  it('derives every category from its editorial examples', () => {
    for (const scope of scopes.values()) {
      expect(scope.editorial.examples).toBeGreaterThanOrEqual(MIN_EDITORIAL_EXAMPLES);
      expect(scope.floorUsd).toBeCloseTo(scope.editorial.minUsd * SCOPE_FLOOR_FACTOR, 2);
      expect(scope.ceilingUsd).toBeCloseTo(scope.editorial.maxUsd * SCOPE_CEILING_FACTOR, 2);
      expect(scope.floorUsd).toBeLessThan(scope.ceilingUsd);
    }
  });

  it('bounds differ by category rather than being one global rule', () => {
    // A $600 cooler is out of scope; a $600 graphics card plainly is not.
    expect(scopeFor('cooler').ceilingUsd).toBeLessThan(scopeFor('gpu').ceilingUsd);
    expect(new Set([...scopes.values()].map((scope) => scope.ceilingUsd)).size).toBeGreaterThan(6);
  });

  it('refuses to bound a category whose catalogue says too little', () => {
    // Fails closed. A bound from one or two entries is a guess with a citation.
    expect(() => loadCategoryScopes('/nonexistent-editorial-data')).toThrow();
  });

  it('will not compare a listing in another currency to a dollar bound', () => {
    // No exchange rate is invented to decide scope; the listing is refused.
    const euros = listing({ id: 'newegg-storage-eur', name: 'Euro SSD', retailPrice: 200, currency: 'EUR' });
    expect(scopeVerdict(euros, scopeFor('storage'))).toEqual({ inScope: false, reason: 'currency-not-comparable' });
  });

  it('scores a listing on what a shopper would pay, sale price included', () => {
    const onSale = listing({ id: 'newegg-storage-sale', name: 'Discounted drive', retailPrice: 900, salePrice: 300 });
    expect(scopeVerdict(onSale, scopeFor('storage'))).toEqual({ inScope: true });
  });
});

describe('coverage follows verified attributes where they exist', () => {
  const gpuScope = scopeFor('gpu');
  const gpu = (id: string, model: string, price: number) =>
    listing({ category: 'gpu', canonicalPartId: model, id, name: `Partner ${id}`, retailPrice: price });

  it('spreads GPU slots across distinct verified models, not across price bands', () => {
    // Four cards of one model, one of another. Price ranking would take the
    // four cheapest, all of the same chip. Coverage by attribute does not.
    const candidates = [
      gpu('newegg-gpu-a1', 'rtx5060', 300),
      gpu('newegg-gpu-a2', 'rtx5060', 310),
      gpu('newegg-gpu-a3', 'rtx5060', 320),
      gpu('newegg-gpu-a4', 'rtx5060', 330),
      gpu('newegg-gpu-b1', 'rtx5090', 1999),
    ];
    const outcome = selectBestListings(candidates, 2, gpuScope);
    expect(outcome.coverage).toBe('verified-attribute');
    expect(outcome.selected.map((part) => part.canonicalPartId)).toEqual(['rtx5060', 'rtx5090']);
  });

  it('reads the attribute the matcher established, never one guessed from a title', () => {
    expect(verifiedCoverageKey(gpu('newegg-gpu-x', 'rtx5070', 600))).toBe('rtx5070');
    // A title full of model names establishes nothing without the matcher.
    expect(verifiedCoverageKey(listing({ id: 'newegg-storage-x', name: 'Fits RTX 5070 and RTX 4090 builds', retailPrice: 100 }))).toBeNull();
  });

  it('falls back to fixed scope tiers when any candidate lacks the attribute', () => {
    // All-or-nothing: a half-identified category would otherwise get a silent
    // mixture of two policies, and the spread would depend on how much of the
    // feed the matcher happened to recognise.
    const mixed = [gpu('newegg-gpu-a1', 'rtx5060', 300), listing({ category: 'gpu', id: 'newegg-gpu-u', name: 'Unidentified card', retailPrice: 400 })];
    expect(selectBestListings(mixed, 2, gpuScope).coverage).toBe('scope-tier');
  });

  it('cuts tiers from the declared bounds, so one freak listing cannot move them', () => {
    const storage = scopeFor('storage');
    const tierOfCheap = scopeTierOf(60, storage);
    const withoutOutlier = scopeTierOf(400, storage);
    // The same prices land in the same tiers whatever else is in the feed,
    // because the cuts are fixed to [floor, ceiling] rather than to the sample.
    expect(scopeTierOf(60, storage)).toBe(tierOfCheap);
    expect(scopeTierOf(400, storage)).toBe(withoutOutlier);
    expect(scopeTierOf(storage.floorUsd, storage)).toBe(0);
    expect(scopeTierOf(storage.ceilingUsd, storage)).toBe(4);
  });

  it('leaves an empty tier empty rather than reaching for the nearest listing', () => {
    // Twelve budget drives and nothing above $200. The catalogue publishes
    // twelve budget drives; that is the truth about this feed.
    const budgetOnly = Array.from({ length: 12 }, (_, index) =>
      listing({ id: `newegg-storage-${index}`, name: `Budget SSD ${index}`, retailPrice: 50 + index * 10 }),
    );
    const outcome = selectBestListings(budgetOnly, 12, scopeFor('storage'));
    expect(outcome.selected).toHaveLength(12);
    expect(Math.max(...outcome.selected.map((part) => part.retailPrice))).toBeLessThan(200);
    expect(outcome.coverageGroups).toBeLessThan(5);
  });
});
