// Arrival order must not decide what the catalogue publishes.
//
// The defect these cover: selection was `unique.slice(0, quota)` over the feed's
// own ordering, so the first 80 GPU listings to arrive were published and every
// later one — cheaper or not — was never looked at.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { AffiliateCatalogFailure, buildAffiliatePartCatalog, type CatalogSelectionReport } from './affiliateCatalog';
import { loadCategoryScopes } from './categoryScope';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';
import { compareListings, effectivePrice, selectBestListings } from './listingSelection';

const generatedAt = '2026-09-01T12:00:00.000Z';
const scopes = loadCategoryScopes();
const gpuScope = scopes.get('gpu')!;

const listing = (over: Partial<AffiliatePart> & { id: string; name: string; retailPrice: number }): AffiliatePart => ({
  category: 'gpu',
  merchant: 'Newegg',
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${over.id}`,
  fetchedAt: generatedAt,
  availability: AVAILABILITY_UNKNOWN,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: 'rtx4070',
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
  sku: null,
  unitSpecs: null,
  ...over,
});

/** The same set of candidates, handed over in a different arrival order. */
const rotate = <T,>(items: readonly T[], by: number): T[] => [...items.slice(by), ...items.slice(0, by)];

describe('arrival order cannot hide a cheaper eligible offer', () => {
  it('publishes the cheapest listing of a product, whichever order it arrived in', () => {
    const dear = listing({ id: 'newegg-gpu-a-dear', name: 'Brand GeForce RTX 4070 OC', retailPrice: 699 });
    const cheap = listing({ id: 'newegg-gpu-a-cheap', name: 'Brand GeForce RTX 4070 OC', retailPrice: 599 });

    // Dear first is the shape that used to lose: de-duplication kept the first
    // arrival of a normalized name and discarded the cheaper later one.
    expect(selectBestListings([dear, cheap], 1, gpuScope).selected).toEqual([cheap]);
    expect(selectBestListings([cheap, dear], 1, gpuScope).selected).toEqual([cheap]);
  });

  it('a cheaper offer arriving after the quota is filled still reaches the catalogue', () => {
    // 80 listings arrive first, then one cheaper than all of them. Under
    // slice(0, quota) the quota was already full and the last one was unread.
    const early = Array.from({ length: 80 }, (_, index) =>
      listing({ id: `newegg-gpu-early-${index}`, name: `Brand GeForce RTX 4070 Model ${index}`, retailPrice: 900 + index }),
    );
    const lateBargain = listing({ id: 'newegg-gpu-late', name: 'Brand GeForce RTX 4070 Bargain', retailPrice: 399 });

    const { selected } = selectBestListings([...early, lateBargain], 80, gpuScope);
    expect(selected.map((part) => part.id)).toContain('newegg-gpu-late');
    expect(selected).toHaveLength(80);
  });

  it('considers every eligible candidate, not a prefix of them', () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      listing({ id: `newegg-gpu-${index}`, name: `Brand GeForce RTX 4070 Model ${index}`, retailPrice: 300 + index }),
    );
    const outcome = selectBestListings(many, 80, gpuScope);
    expect(outcome.considered).toBe(500);
    expect(outcome.distinctProducts).toBe(500);
  });

  it('produces the same catalogue whatever order the feed returned', () => {
    const many = Array.from({ length: 300 }, (_, index) =>
      listing({ id: `newegg-gpu-${index}`, name: `Brand GeForce RTX 4070 Model ${index}`, retailPrice: 300 + ((index * 37) % 600) }),
    );
    const baseline = selectBestListings(many, 80, gpuScope).selected.map((part) => part.id).sort();
    for (const by of [1, 57, 149, 299]) {
      expect(selectBestListings(rotate(many, by), 80, gpuScope).selected.map((part) => part.id).sort()).toEqual(baseline);
    }
  });

  it('ranks a genuine sale price against other listings, not the pre-sale figure', () => {
    const discounted = listing({ id: 'newegg-gpu-sale', name: 'Brand RTX 4070 Sale Card', retailPrice: 900, salePrice: 401 });
    const plain = listing({ id: 'newegg-gpu-plain', name: 'Brand RTX 4070 Plain Card', retailPrice: 500 });
    expect(effectivePrice(discounted)).toBe(401);
    expect(compareListings(plain, discounted)).toBeGreaterThan(0);
  });

  it('never ties, so a stable sort cannot smuggle arrival order back in', () => {
    const a = listing({ id: 'newegg-gpu-aaa', name: 'Card A', retailPrice: 500 });
    const b = listing({ id: 'newegg-gpu-bbb', name: 'Card B', retailPrice: 500 });
    expect(compareListings(a, b)).toBeLessThan(0);
    expect(compareListings(b, a)).toBeGreaterThan(0);
  });

});

describe('the whole catalogue is built this way, not just the helper', () => {
  const fullCandidates = (extra: readonly AffiliatePart[] = []) =>
    new Map<RetailPartCategory, AffiliatePart[]>(
      RETAIL_CATEGORY_CONFIG.map((config) => [
        config.category,
        [
          ...Array.from({ length: config.quota }, (_, index) =>
            listing({
              category: config.category,
              canonicalPartId: config.category === 'gpu' ? 'rtx4070' : null,
              id: `newegg-${config.category}-filler-${index}`,
              name: `${config.category} filler ${index}`,
              // Inside every category's scope: above the highest floor ($69.50,
              // gpu) and below the lowest ceiling ($358, cooler).
              retailPrice: 100 + index,
            }),
          ),
          ...extra.filter((part) => part.category === config.category),
        ],
      ]),
    );

  it('admits a cheaper late arrival into the published 500', () => {
    // In scope, and cheaper than every filler. A $9 "processor" would now be
    // refused by the cpu floor before it could compete, which is the point of
    // the scope gate — so the bargain here is a real budget part, not a fault.
    const bargain = listing({ id: 'newegg-cpu-bargain', category: 'cpu', canonicalPartId: null, name: 'cpu bargain', retailPrice: 59 });
    const catalog = buildAffiliatePartCatalog(fullCandidates([bargain]), generatedAt);
    expect(catalog.parts.map((part) => part.id)).toContain('newegg-cpu-bargain');
  });

  it('reports what it considered, so a selection that stopped looking is visible', () => {
    const report: CatalogSelectionReport[] = [];
    buildAffiliatePartCatalog(fullCandidates(), generatedAt, report);
    const gpu = report.find((row) => row.category === 'gpu');
    expect(gpu).toMatchObject({ considered: 80, distinctProducts: 80, consolidated: 0, published: 80, outOfScope: {} });
  });

  it('still refuses to publish when a category has too few distinct products', () => {
    const candidates = fullCandidates();
    const gpu = candidates.get('gpu') ?? [];
    // Eighty listings, but all of one product. Consolidation leaves one.
    candidates.set('gpu', gpu.map((part, index) => ({ ...part, id: `newegg-gpu-dup-${index}`, name: 'the only card' })));
    expect(() => buildAffiliatePartCatalog(candidates, generatedAt)).toThrow(AffiliateCatalogFailure);
  });
});
