import { describe, expect, it } from 'vitest';

import type { AffiliatePart, AffiliatePartCatalog } from '../../../src/lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import { auditCatalogPartLink, auditRetailPartsCatalog, expectedItemIdFromPartId } from './retailCatalogLinkAudit';

function part(overrides: Partial<AffiliatePart>): AffiliatePart {
  return {
    id: 'newegg-gpu-n82e16814932765',
    category: 'gpu',
    merchant: 'Newegg',
    name: 'GIGABYTE AORUS GeForce RTX 5090 Graphics Card GV-N5090AORUSM ICE-32GD',
    imageUrl: 'https://c1.neweggimages.com/x.jpg',
    trackedAffiliateUrl:
      'https://click.linksynergy.com/link?id=ptE95Z94djU&offerid=1786142.445836758097709657137697&type=15&murl=' +
      encodeURIComponent(
        'https://www.newegg.com/gigabyte-gv-n5090aorusm-ice-32gd-geforce-rtx-5090-32gb-graphics-card-triple-fans/p/N82E16814932765?item=N82E16814932765',
      ),
    fetchedAt: '2026-08-31T23:12:36.244Z',
    availability: AVAILABILITY_UNKNOWN,
    retailPrice: 4999.99,
    salePrice: 4929.99,
    currency: 'USD',
    canonicalPartId: 'rtx5090',
    specsVerified: true,
    imageContentRatio: 0.63,
    ...overrides,
  };
}

describe('expectedItemIdFromPartId', () => {
  it('recovers a plain alphanumeric SKU', () => {
    expect(expectedItemIdFromPartId('newegg-gpu-n82e16814932765', 'gpu')).toBe('N82E16814932765');
  });

  it('recovers a SKU containing dashes', () => {
    expect(expectedItemIdFromPartId('newegg-gpu-1ft-000m-00474', 'gpu')).toBe('1FT-000M-00474');
  });

  it('returns null for an id that does not match the expected category prefix', () => {
    expect(expectedItemIdFromPartId('newegg-cpu-n82e16814932765', 'gpu')).toBeNull();
  });
});

describe('auditCatalogPartLink', () => {
  it('marks a real, matching, attributed tracked link as pass', () => {
    const row = auditCatalogPartLink(part({}));
    expect(row).toMatchObject({ retailer: 'Newegg', source: 'retail-parts-catalog', urlType: 'exact', attributed: true, status: 'pass' });
  });

  it('fails closed on a WRONG VARIANT: tracked link resolves to a different SKU than the part id names', () => {
    const mismatched = part({
      id: 'newegg-gpu-n82e16814500639',
      trackedAffiliateUrl:
        'https://click.linksynergy.com/link?id=ptE95Z94djU&offerid=1786142.1&type=15&murl=' +
        encodeURIComponent('https://www.newegg.com/some-other-card/p/N82E16814932765?item=N82E16814932765'),
    });
    const row = auditCatalogPartLink(mismatched);
    expect(row.status).toBe('fail');
    expect(row.evidence).toBe('product-path-item-id-mismatch');
  });

  it('fails closed on MISSING ATTRIBUTION even though the destination is exact', () => {
    const unattributed = part({
      trackedAffiliateUrl:
        'https://click.linksynergy.com/link?type=15&murl=' +
        encodeURIComponent('https://www.newegg.com/gigabyte/p/N82E16814932765?item=N82E16814932765'),
    });
    const row = auditCatalogPartLink(unattributed);
    expect(row).toMatchObject({ urlType: 'exact', attributed: false, status: 'fail' });
  });

  it('fails closed on a MALFORMED tracked link', () => {
    const row = auditCatalogPartLink(part({ trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=x&offerid=1.1&murl=not-a-url' }));
    expect(row.status).toBe('fail');
    expect(row.urlType).toBe('malformed');
  });

  it('marks an entry with no usable identity as unverifiable rather than skipping it', () => {
    const row = auditCatalogPartLink(part({ id: '', name: '' }));
    expect(row).toMatchObject({ urlType: 'unverifiable', status: 'fail', evidence: 'no-intended-identity' });
  });
});

describe('auditRetailPartsCatalog', () => {
  it('produces exactly one row per catalog part', () => {
    const catalog: AffiliatePartCatalog = {
      schemaVersion: 3,
      generatedAt: '2026-08-31T23:13:20.207Z',
      merchant: 'Newegg',
      availability: AVAILABILITY_UNKNOWN,
      parts: [part({}), part({ id: 'newegg-gpu-n82e16814500639', trackedAffiliateUrl: part({}).trackedAffiliateUrl })],
    };
    expect(auditRetailPartsCatalog(catalog)).toHaveLength(2);
  });
});
