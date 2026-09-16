// A specification reaches a listing only when its source describes that exact
// listing. The alternative — a model record's figures on a partner card — is
// the defect src/lib/retail/partIdentity.ts was written about.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import { parseAffiliatePart, type AffiliatePart } from '../../../src/lib/retail/partCatalog';
import { attachUnitSpecs, namesOneVariant, type UnitSpecSource } from './unitSpecs';

const part = (over: Partial<AffiliatePart> = {}): AffiliatePart => ({
  id: 'newegg-gpu-n82e16814137901',
  category: 'gpu',
  merchant: 'Newegg',
  name: 'MSI GeForce RTX 5070 VENTUS 3X OC Graphics Card',
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=site&offerid=1',
  fetchedAt: '2026-09-01T00:00:00.000Z',
  availability: AVAILABILITY_UNKNOWN,
  retailPrice: 599.99,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: 'rtx5070',
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: '824142566633',
  sku: 'N82E16814137901',
  unitSpecs: null,
  ...over,
});

const source = (over: Partial<UnitSpecSource> = {}): UnitSpecSource => ({
  sku: 'N82E16814137901',
  upc: '824142566633',
  citation: 'https://example.invalid/msi-ventus-3x-oc-specifications',
  observedAt: '2026-09-01T00:00:00.000Z',
  verification: 'manufacturer-listed',
  fields: { length_mm: { value: 302, unit: 'mm' } },
  ...over,
});

describe('ambiguous variants do not inherit specifications', () => {
  it('withholds when the title names two models', () => {
    // "RTX 4070 Ti" and "RTX 4070" in one title: which one ships is unknowable,
    // so no dimension may be bound to it however well-sourced the source is.
    const ambiguous = part({
      name: 'Brand GeForce RTX 4070 Ti Cooler, also fits GeForce RTX 4070 Graphics Card',
    });
    expect(attachUnitSpecs(ambiguous, source())).toEqual({ status: 'withheld', reason: 'variant-ambiguous' });
  });

  it('withholds when the title names no model at all', () => {
    expect(attachUnitSpecs(part({ name: 'Brand Graphics Card Retail Box' }), source())).toEqual({
      status: 'withheld',
      reason: 'variant-ambiguous',
    });
  });

  it('counts a repeated single model as one, not as ambiguity', () => {
    expect(namesOneVariant('MSI GeForce RTX 5070 VENTUS 3X OC RTX 5070 Graphics Card')).toBe(true);
    expect(namesOneVariant('Brand RTX 4070 Ti and RTX 4070 bundle')).toBe(false);
  });

  it("refuses a source that describes a different variant's SKU", () => {
    // The 4070 Ti's specification page, offered for the 4070 listing. The
    // figures are real; they are real about another board.
    expect(attachUnitSpecs(part(), source({ sku: 'N82E16814137999' }))).toEqual({
      status: 'withheld',
      reason: 'source-describes-another-listing',
    });
  });

  it('refuses a source whose UPC contradicts the listing', () => {
    expect(attachUnitSpecs(part(), source({ upc: '000000000000' }))).toEqual({
      status: 'withheld',
      reason: 'upc-conflict',
    });
  });

  it('refuses to bind anything to a listing with no exact SKU', () => {
    expect(attachUnitSpecs(part({ sku: null }), source())).toEqual({
      status: 'withheld',
      reason: 'listing-sku-unknown',
    });
  });

  it('attaches only with the source cited on every field', () => {
    const attached = attachUnitSpecs(part(), source({ fields: { length_mm: { value: 302, unit: 'mm' }, tdp_watts: { value: 250, unit: 'W' } } }));
    expect(attached).toEqual({
      status: 'attached',
      specs: {
        length_mm: {
          value: 302,
          unit: 'mm',
          source: 'https://example.invalid/msi-ventus-3x-oc-specifications',
          verification: 'manufacturer-listed',
          observedAt: '2026-09-01T00:00:00.000Z',
        },
        tdp_watts: {
          value: 250,
          unit: 'W',
          source: 'https://example.invalid/msi-ventus-3x-oc-specifications',
          verification: 'manufacturer-listed',
          observedAt: '2026-09-01T00:00:00.000Z',
        },
      },
    });
  });

  it('the ordinary case is no source, and the ordinary answer is nothing', () => {
    expect(attachUnitSpecs(part(), null)).toEqual({ status: 'withheld', reason: 'no-source' });
  });
});

describe('the published reader will not accept a specification without provenance', () => {
  const accepts = (unitSpecs: unknown) => parseAffiliatePart({ ...part(), unitSpecs }) !== null;

  it('refuses a field with no source', () => {
    expect(accepts({ length_mm: { value: 302, unit: 'mm', verification: 'manufacturer-listed', observedAt: '2026-09-01T00:00:00.000Z' } })).toBe(false);
  });

  it('refuses a verification status outside the closed set', () => {
    expect(accepts({ length_mm: { value: 302, unit: 'mm', source: 'https://example.invalid/s', verification: 'probably', observedAt: '2026-09-01T00:00:00.000Z' } })).toBe(false);
  });

  it('refuses a field with no observation instant', () => {
    expect(accepts({ length_mm: { value: 302, unit: 'mm', source: 'https://example.invalid/s', verification: 'manufacturer-listed' } })).toBe(false);
  });

  it('accepts a fully cited field, and keeps its provenance', () => {
    const parsed = parseAffiliatePart({
      ...part(),
      unitSpecs: { length_mm: { value: 302, unit: 'mm', source: 'https://example.invalid/s', verification: 'manufacturer-listed', observedAt: '2026-09-01T00:00:00.000Z' } },
    });
    expect(parsed?.unitSpecs?.length_mm).toMatchObject({ value: 302, source: 'https://example.invalid/s', verification: 'manufacturer-listed' });
  });

  it('reads an empty block as nothing established, never as specifications', () => {
    expect(parseAffiliatePart({ ...part(), unitSpecs: {} })?.unitSpecs).toBeNull();
  });
});

describe('the exact listing identity survives publication', () => {
  it('carries the merchant item number verbatim, not only the slug', () => {
    expect(part().sku).toBe('N82E16814137901');
    expect(part().id).toBe('newegg-gpu-n82e16814137901');
  });

  it('refuses a part whose SKU and id disagree about which listing it is', () => {
    expect(parseAffiliatePart({ ...part(), sku: 'N82E16814000000' })).toBeNull();
  });

  it('still reads a published file that predates the field', () => {
    const legacy = { ...part() } as Record<string, unknown>;
    delete legacy.sku;
    delete legacy.unitSpecs;
    expect(parseAffiliatePart(legacy)).toMatchObject({ sku: null, unitSpecs: null });
  });
});
