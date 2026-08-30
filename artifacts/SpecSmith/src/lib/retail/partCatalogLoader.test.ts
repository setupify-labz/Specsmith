import { describe, expect, it } from 'vitest';

import {
  AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  AFFILIATE_PART_CATEGORY_TARGETS,
  RETAIL_PART_CATEGORIES,
} from './partCatalog';
import { loadAffiliatePartCatalog } from './partCatalogLoader';

const catalog = {
  schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  generatedAt: '2026-08-29T23:00:00.000Z',
  merchant: 'Newegg',
  availability: 'unknown',
  parts: RETAIL_PART_CATEGORIES.flatMap((category) =>
    Array.from({ length: AFFILIATE_PART_CATEGORY_TARGETS[category] }, (_, index) => ({
      id: `newegg-${category}-sku-${index}`,
      category,
      merchant: 'Newegg',
      name: `Example ${category} ${index}`,
      imageUrl: `https://c1.neweggimages.com/${category}-${index}.jpg`,
      trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${category}-${index}`,
      fetchedAt: '2026-08-29T23:00:00.000Z',
      retailPrice: 100 + index,
      salePrice: null,
      currency: 'USD',
      availability: 'unknown',
      canonicalPartId: category === 'gpu' ? `gpu-${index}` : null,
      specsVerified: category === 'gpu',
    })),
  ),
};

describe('affiliate catalog loader', () => {
  it('returns ok only after browser-side validation', async () => {
    const view = await loadAffiliatePartCatalog({ fetch: async () => new Response(JSON.stringify(catalog), { status: 200 }) });
    expect(view).toEqual({ status: 'ok', catalog });
  });

  it('never throws for absence, transport failure, or malformed JSON', async () => {
    expect(await loadAffiliatePartCatalog({ fetch: async () => new Response('', { status: 404 }) })).toEqual({ status: 'absent' });
    expect(await loadAffiliatePartCatalog({ fetch: async () => { throw new Error('offline'); } })).toEqual({ status: 'absent' });
    expect(await loadAffiliatePartCatalog({ fetch: async () => new Response('{', { status: 200 }) })).toEqual({
      status: 'invalid',
      problem: 'not-an-object',
    });
  });
});
