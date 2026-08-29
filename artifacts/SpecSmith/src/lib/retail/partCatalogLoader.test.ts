import { describe, expect, it } from 'vitest';

import { AFFILIATE_PART_CATALOG_SCHEMA_VERSION } from './partCatalog';
import { loadAffiliatePartCatalog } from './partCatalogLoader';

const catalog = {
  schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  generatedAt: '2026-08-29T23:00:00.000Z',
  merchant: 'Newegg',
  availability: 'unknown',
  parts: [],
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
