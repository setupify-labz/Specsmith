import { describe, expect, it } from 'vitest';

import {
  AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  AFFILIATE_PART_CATEGORY_TARGETS,
  RETAIL_PART_CATEGORIES,
  parseAffiliatePartCatalog,
} from './partCatalog';

const valid = () => ({
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
      availability: 'unknown',
      retailPrice: 100 + index,
      salePrice: index % 5 === 0 ? 90 + index : null,
      currency: 'USD',
      canonicalPartId: category === 'gpu' ? `gpu-${index}` : null,
      specsVerified: category === 'gpu',
    })),
  ),
});

describe('affiliate part catalog', () => {
  it('accepts a validated priced record that makes no stock claim', () => {
    const parsed = parseAffiliatePartCatalog(valid());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Prices are now carried; stock claims still are not, and no wording that
    // implies one may appear anywhere in the document.
    expect(parsed.catalog.parts[0].retailPrice).toBeGreaterThan(0);
    expect(parsed.catalog.parts[0].currency).toBe('USD');
    expect(JSON.stringify(valid())).not.toMatch(/in.stock|out.of.stock|unavailable|sold.out|ships/i);
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
    raw.parts[raw.parts.length - 1] = { ...raw.parts[0] };
    expect(parseAffiliatePartCatalog(raw)).toEqual({ ok: false, problem: 'duplicate-part-id' });
  });

  it('refuses partial, category-skewed, duplicate-name and duplicate-link catalogues', () => {
    const partial = valid();
    partial.parts.pop();
    expect(parseAffiliatePartCatalog(partial)).toEqual({ ok: false, problem: 'part-count-invalid' });

    const skewed = valid();
    const last = skewed.parts.length - 1;
    skewed.parts[last] = {
      ...skewed.parts[last],
      id: 'newegg-mouse-extra-sku',
      category: 'mouse',
      name: 'Example mouse extra',
      trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=site&offerid=mouse-extra',
    };
    expect(parseAffiliatePartCatalog(skewed)).toEqual({ ok: false, problem: 'category-count-invalid' });

    const duplicateName = valid();
    duplicateName.parts[1] = { ...duplicateName.parts[1], name: ' EXAMPLE GPU 0!!!' };
    expect(parseAffiliatePartCatalog(duplicateName)).toEqual({ ok: false, problem: 'duplicate-part-name' });

    const duplicateLink = valid();
    duplicateLink.parts[1] = {
      ...duplicateLink.parts[1],
      trackedAffiliateUrl: duplicateLink.parts[0].trackedAffiliateUrl,
    };
    expect(parseAffiliatePartCatalog(duplicateLink)).toEqual({ ok: false, problem: 'duplicate-affiliate-url' });
  });
});
