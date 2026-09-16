// Stale data must not be published as current, and must not display as current
// if it somehow is. Two gates, because one of them is not enough:
//
//   - PUBLICATION. A catalogue is written from one sweep. A listing whose
//     reading was already outside the freshness window when the file was
//     written was read too long ago to be published as a current price, so the
//     build refuses it rather than writing a part the card will then hide. A
//     file of 500 listings the reader withholds is a publication that looks
//     successful and shows nothing.
//   - DISPLAY. The window keeps running after the file is written, so a
//     catalogue that was fresh at 09:00 is stale by the next day. The card
//     re-checks against its own clock and withholds the number rather than
//     captioning it.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN, MAX_CLOCK_SKEW_MS } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { PRICE_FRESHNESS_MS, priceView, STALE_PRICE_LABEL, summarizeBuildPrices } from '../../../src/lib/retail/partPricing';
import { AffiliateCatalogFailure, buildAffiliatePartCatalog } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';

const generatedAt = '2026-09-01T12:00:00.000Z';
const publishedAtMs = Date.parse(generatedAt);
const at = (offsetMs: number) => new Date(publishedAtMs + offsetMs).toISOString();

const listing = (over: Partial<AffiliatePart> & { id: string; name: string }): AffiliatePart => ({
  category: 'gpu',
  merchant: 'Newegg',
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${over.id}`,
  fetchedAt: generatedAt,
  availability: AVAILABILITY_UNKNOWN,
  // Inside every category scope: above the highest floor and below the lowest ceiling.
  retailPrice: 100,
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

/** Exactly the quota per category, so one spoiled candidate causes a shortfall. */
const candidates = (spoil?: (part: AffiliatePart) => AffiliatePart) =>
  new Map<RetailPartCategory, AffiliatePart[]>(
    RETAIL_CATEGORY_CONFIG.map((config) => [
      config.category,
      Array.from({ length: config.quota }, (_, index) => {
        const part = listing({
          category: config.category,
          canonicalPartId: config.category === 'gpu' ? 'rtx4070' : null,
          id: `newegg-${config.category}-${index}`,
          name: `${config.category} ${index}`,
          retailPrice: 100 + index,
        });
        return index === 0 && spoil ? spoil(part) : part;
      }),
    ]),
  );

describe('stale data cannot be published as current', () => {
  it('builds when every reading is inside the window', () => {
    expect(buildAffiliatePartCatalog(candidates(), generatedAt).parts).toHaveLength(500);
  });

  it('refuses a listing read before the freshness window opened', () => {
    const stale = (part: AffiliatePart) => ({ ...part, fetchedAt: at(-(PRICE_FRESHNESS_MS + 60_000)) });
    expect(() => buildAffiliatePartCatalog(candidates(stale), generatedAt)).toThrow(AffiliateCatalogFailure);
  });

  it('refuses a reading stamped in the future rather than treating it as freshest', () => {
    // Otherwise the cheapest way to make an old price look current would be to
    // write tomorrow's date on it — and this ranking publishes the cheapest.
    const future = (part: AffiliatePart) => ({ ...part, fetchedAt: at(MAX_CLOCK_SKEW_MS + 60_000) });
    expect(() => buildAffiliatePartCatalog(candidates(future), generatedAt)).toThrow(AffiliateCatalogFailure);
  });

  it('refuses a reading whose instant cannot be read at all', () => {
    const unreadable = (part: AffiliatePart) => ({ ...part, fetchedAt: 'yesterday' });
    expect(() => buildAffiliatePartCatalog(candidates(unreadable), generatedAt)).toThrow(AffiliateCatalogFailure);
  });

  it('tolerates a reading inside the allowed clock skew', () => {
    const skewed = (part: AffiliatePart) => ({ ...part, fetchedAt: at(MAX_CLOCK_SKEW_MS - 1_000) });
    expect(buildAffiliatePartCatalog(candidates(skewed), generatedAt).parts).toHaveLength(500);
  });

  it('a stale candidate loses its slot to a fresh one rather than the run failing', () => {
    const map = candidates();
    const gpu = map.get('gpu') ?? [];
    map.set('gpu', [
      // Cheapest in the feed, and read two days ago. It must not win the slot.
      { ...gpu[0], id: 'newegg-gpu-stale-bargain', name: 'stale bargain', retailPrice: 70, fetchedAt: at(-(PRICE_FRESHNESS_MS + 60_000)) },
      ...gpu,
      listing({ id: 'newegg-gpu-spare', name: 'gpu spare', retailPrice: 199 }),
    ]);
    const parts = buildAffiliatePartCatalog(map, generatedAt).parts;
    // The stale listing is the cheapest in the feed, and this ranking publishes
    // the cheapest — so if freshness were checked after selection rather than
    // before it, this is the one that would take the slot.
    expect(parts.map((part) => part.id)).not.toContain('newegg-gpu-stale-bargain');
    expect(parts.filter((part) => part.category === 'gpu')).toHaveLength(80);
  });
});

describe('stale data cannot display as current', () => {
  const part = listing({ id: 'newegg-gpu-1', name: 'gpu 1', fetchedAt: generatedAt });

  it('shows the number while the reading is inside the window', () => {
    expect(priceView(part, publishedAtMs + 1_000)).toMatchObject({ status: 'fresh', displayAmount: 100 });
  });

  it('carries no number at all once the window has passed', () => {
    const view = priceView(part, publishedAtMs + PRICE_FRESHNESS_MS + 1_000);
    expect(view).toEqual({ status: 'stale', reason: 'expired' });
    expect(JSON.stringify(view)).not.toContain('100');
  });

  it('sends the shopper to the merchant instead of captioning an old figure', () => {
    expect(STALE_PRICE_LABEL).toBe('See current price at Newegg');
    expect(STALE_PRICE_LABEL).not.toMatch(/last known|was|previously|approx/i);
  });

  it('a stale item is excluded from a build total and named, never counted as zero', () => {
    const summary = summarizeBuildPrices([part], publishedAtMs + PRICE_FRESHNESS_MS + 1_000);
    expect(summary).toMatchObject({ complete: false, knownTotal: 0, countedItems: 0 });
    expect(summary.excluded).toEqual([{ partId: 'newegg-gpu-1', reason: 'stale-price' }]);
  });

  it('claims no stock either way: the feed is a catalogue of listings', () => {
    expect(part.availability).toBe('unknown');
  });
});
