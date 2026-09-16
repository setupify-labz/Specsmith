// A dry run must be unable to touch the committed catalogue, and must report
// every category rather than stopping at the first one that falls short.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { AffiliateCatalogFailure, buildAffiliatePartCatalog, planCatalogSelection } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';
import { parseArgs, resolveCatalogOutputPath } from './generate-affiliate-catalog';

const generatedAt = '2026-09-16T12:00:00.000Z';

const listing = (category: RetailPartCategory, index: number): AffiliatePart => ({
  id: `newegg-${category}-${index}`,
  category,
  merchant: 'Newegg',
  name: `${category} ${index}`,
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${category}-${index}`,
  fetchedAt: generatedAt,
  availability: AVAILABILITY_UNKNOWN,
  retailPrice: 100 + index,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: category === 'gpu' ? 'rtx4070' : null,
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
  sku: null,
  unitSpecs: null,
});

const candidates = (short?: RetailPartCategory) =>
  new Map<RetailPartCategory, AffiliatePart[]>(
    RETAIL_CATEGORY_CONFIG.map((config) => [
      config.category,
      Array.from(
        { length: config.category === short ? config.quota - 3 : config.quota },
        (_, index) => listing(config.category, index),
      ),
    ]),
  );

describe('a dry run cannot write into the repository', () => {
  it('refuses an output path inside the checkout, dry run or not', () => {
    // The committed catalogue lives at artifacts/SpecSmith/public/data. No
    // invocation of this script can name it.
    expect(() => resolveCatalogOutputPath('artifacts/SpecSmith/public/data/retail-parts.json')).toThrow(
      'output-inside-repository',
    );
    expect(() => parseArgs(['--out', 'public/data/retail-parts.json', '--dry-run'])).toThrow(
      'output-inside-repository',
    );
  });

  it('accepts a path outside it, and carries the flag', () => {
    expect(parseArgs(['--out', '/tmp/proposed.json', '--dry-run'])).toEqual({ out: '/tmp/proposed.json', dryRun: true });
    expect(parseArgs(['--out', '/tmp/proposed.json'])).toEqual({ out: '/tmp/proposed.json', dryRun: false });
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--out', '/tmp/p.json', '--force'])).toThrow('argument-invalid');
    expect(() => parseArgs(['--dry-run'])).toThrow('argument-invalid');
  });
});

describe('the plan reports every category, including the ones that fall short', () => {
  it('reports all twelve when one is short, rather than stopping at it', () => {
    const { report } = planCatalogSelection(candidates('storage'), generatedAt);
    expect(report).toHaveLength(RETAIL_CATEGORY_CONFIG.length);
    const storage = report.find((row) => row.category === 'storage');
    expect(storage).toMatchObject({ quota: 55, published: 52 });
    // Every other category is still measured.
    expect(report.filter((row) => row.published === row.quota)).toHaveLength(RETAIL_CATEGORY_CONFIG.length - 1);
  });

  it('never lowers a quota to make a category pass', () => {
    const { report } = planCatalogSelection(candidates('psu'), generatedAt);
    const psu = report.find((row) => row.category === 'psu');
    // The requested figure is reported unchanged beside what was found.
    expect(psu?.quota).toBe(RETAIL_CATEGORY_CONFIG.find((c) => c.category === 'psu')?.quota);
    expect(psu?.published).toBeLessThan(psu?.quota ?? 0);
  });

  it('carries the selected price range so coverage can be checked', () => {
    const { report } = planCatalogSelection(candidates(), generatedAt);
    for (const row of report) {
      expect(row.range).not.toBeNull();
      expect(row.range!.lowUsd).toBeLessThanOrEqual(row.range!.highUsd);
    }
  });

  it('a real build still refuses the same shortfall the plan merely reports', () => {
    expect(() => buildAffiliatePartCatalog(candidates('storage'), generatedAt)).toThrow(AffiliateCatalogFailure);
    expect(() => planCatalogSelection(candidates('storage'), generatedAt)).not.toThrow();
  });
});
