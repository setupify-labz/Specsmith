import { describe, expect, it } from 'vitest';

import { AFFILIATE_PART_CATALOG_SCHEMA_VERSION, parseAffiliatePartCatalog } from './partCatalog';

const valid = () => ({
  schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  generatedAt: '2026-08-29T23:00:00.000Z',
  merchant: 'Newegg',
  availability: 'unknown',
  parts: [
    {
      id: 'newegg-gpu-n82e16814932663',
      category: 'gpu',
      merchant: 'Newegg',
      name: 'Example GPU',
      imageUrl: 'https://c1.neweggimages.com/example.jpg',
      trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=site&offerid=offer',
      fetchedAt: '2026-08-29T23:00:00.000Z',
      availability: 'unknown',
      canonicalPartId: 'rtx4070',
      specsVerified: true,
    },
  ],
});

describe('affiliate part catalog', () => {
  it('accepts a validated image-and-link record without a price or stock claim', () => {
    const parsed = parseAffiliatePartCatalog(valid());
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(valid())).not.toMatch(/price|in.stock|out.of.stock|unavailable/i);
  });

  it('refuses untracked and lookalike destinations', () => {
    for (const url of [
      'https://www.newegg.com/p/N82E16814932663',
      'https://click.linksynergy.com.evil.test/link',
      'http://click.linksynergy.com/link',
    ]) {
      const raw = valid();
      raw.parts[0].trackedAffiliateUrl = url;
      expect(parseAffiliatePartCatalog(raw)).toEqual({ ok: false, problem: 'part-invalid' });
    }
  });

  it('refuses stock claims and unverifiable spec flags', () => {
    const stock = valid() as ReturnType<typeof valid> & { availability: string };
    stock.availability = 'in-stock';
    expect(parseAffiliatePartCatalog(stock)).toEqual({ ok: false, problem: 'availability-not-unknown' });

    const specs = valid();
    specs.parts[0].canonicalPartId = null;
    expect(parseAffiliatePartCatalog(specs)).toEqual({ ok: false, problem: 'part-invalid' });
  });

  it('refuses duplicate ids', () => {
    const raw = valid();
    raw.parts.push({ ...raw.parts[0] });
    expect(parseAffiliatePartCatalog(raw)).toEqual({ ok: false, problem: 'duplicate-part-id' });
  });
});
