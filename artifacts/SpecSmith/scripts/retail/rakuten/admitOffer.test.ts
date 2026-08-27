import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { admitOffer, admitOffers } from './admitOffer';
import { classifyListing } from './listingKind';
import { findItems, parseProductSearchXml, type XmlElement } from './parseProductSearchXml';
import { loadGpuCatalog, partition } from './index';
import { NEWEGG_MID, RAKUTEN_ADAPTER_VERSION, REQUIRED_CATEGORY, type CatalogGpu } from './types';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const items = (name: string): XmlElement[] => findItems(parseProductSearchXml(fs.readFileSync(path.join(fixtures, name), 'utf-8')));

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;
const FETCHED_AT = '2026-08-20T12:04:11.000Z';

describe('classifyListing', () => {
  it('passes a plain desktop add-in board', () => {
    expect(classifyListing('GIGABYTE GeForce RTX 4070 WINDFORCE OC V2 12GB Desktop Graphics Card').issue).toBeNull();
  });

  it('does not mistake "Desktop Graphics Card" for a desktop computer', () => {
    expect(classifyListing('ASUS Dual RTX 4070 Desktop Graphics Card').issue).toBeNull();
    expect(classifyListing('Skytech Chronos Gaming Desktop - RTX 4070').issue).toBe('prebuilt-system');
    expect(classifyListing('ABS Cyclone Desktop PC - RTX 4070').issue).toBe('prebuilt-system');
  });

  it('rejects accessories that live in the same category as the cards', () => {
    expect(classifyListing('CORSAIR 12VHPWR Power Cable for RTX 4070').issue).toBe('not-a-graphics-card');
    expect(classifyListing('upHere GPU Support Bracket for RTX 4090').issue).toBe('not-a-graphics-card');
    expect(classifyListing('EZDIY-FAB Vertical GPU Riser Cable').issue).toBe('not-a-graphics-card');
  });

  it('rejects laptops and laptop GPUs', () => {
    expect(classifyListing('MSI Katana 15 Gaming Laptop - RTX 4070 Laptop GPU').issue).toBe('laptop-part');
    expect(classifyListing('GeForce RTX 4070 (Mobile) 8GB').issue).toBe('laptop-part');
    expect(classifyListing('RTX 4070 Max-Q Notebook Module').issue).toBe('laptop-part');
  });

  it('rejects anything not sold as new', () => {
    for (const t of ['RTX 4070 - Refurbished', 'RTX 4070 Open Box', 'Used RTX 4070 12GB', 'RTX 4070 Recertified']) {
      expect(classifyListing(t).issue, t).toBe('condition-not-new');
    }
  });
});

describe('admitOffer', () => {
  it('accepts the matching card and preserves every published field', () => {
    const admitted = admitOffer(items('newegg-rtx4070-page.xml')[0], gpu('rtx4070'), catalog, FETCHED_AT);
    expect(admitted).toEqual({
      status: 'accepted',
      sku: 'N82E16814932663',
      upc: '889523036891',
      productName: 'GIGABYTE GeForce RTX 4070 WINDFORCE OC V2 12GB GDDR6X Desktop Graphics Card, GV-N4070WF3OCV2-12GD',
      category: REQUIRED_CATEGORY,
      retailPrice: 579.99,
      salePrice: null,
      currency: 'USD',
      imageUrl: 'https://c1.neweggimages.com/productimage/nb640/14-932-663-01.jpg',
      trackedAffiliateUrl:
        'https://click.linksynergy.com/link?id=REDACTED_SITE_ID&offerid=REDACTED_OFFER_ID&murl=https%3A%2F%2Fwww.newegg.com%2Fp%2FN82E16814932663',
      canonicalGpuId: 'rtx4070',
      mid: NEWEGG_MID,
      fetchedAt: FETCHED_AT,
      adapterVersion: RAKUTEN_ADAPTER_VERSION,
    });
  });

  it('treats saleprice 0.00 as absent, not as a free graphics card', () => {
    const admitted = admitOffer(items('newegg-rtx4070-page.xml')[0], gpu('rtx4070'), catalog, FETCHED_AT);
    expect(admitted).toMatchObject({ status: 'accepted', salePrice: null });
    // The rule that matters downstream: the "current" price never becomes 0.
    const current = admitted.status === 'accepted' ? admitted.salePrice ?? admitted.retailPrice : null;
    expect(current).toBe(579.99);
  });

  it('keeps a real sale price', () => {
    const admitted = admitOffer(items('newegg-rtx4060ti-capacity.xml')[0], gpu('rtx4060ti16'), catalog, FETCHED_AT);
    expect(admitted).toMatchObject({ status: 'accepted', retailPrice: 449.99, salePrice: 429.99, currency: 'USD' });
  });

  it('gives each fixture listing the reason it actually fails on', () => {
    const results = admitOffers(items('newegg-rtx4070-page.xml'), gpu('rtx4070'), catalog, FETCHED_AT);
    expect(results.map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'accepted',
      'variant-suffix-mismatch', // RTX 4070 SUPER
      'not-a-graphics-card', // 12VHPWR power cable
      'category-mismatch', // prebuilt, correctly categorised by the merchant
      'condition-not-new', // refurbished
      'variant-suffix-mismatch', // RTX 4070 Ti
      'laptop-part', // laptop, miscategorised into Video Cards & Adapters
      'prebuilt-system', // gaming desktop, miscategorised into Video Cards & Adapters
    ]);
  });

  it('checks kind before model, so a cable that names the card is reported as a cable', () => {
    const cable = items('newegg-rtx4070-page.xml')[2];
    expect(admitOffer(cable, gpu('rtx4070'), catalog, FETCHED_AT)).toMatchObject({ reason: 'not-a-graphics-card' });
  });

  it('separates the two RTX 4060 Ti capacities and refuses the one that states neither', () => {
    const page = items('newegg-rtx4060ti-capacity.xml');
    expect(admitOffers(page, gpu('rtx4060ti16'), catalog, FETCHED_AT).map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'accepted',
      'memory-capacity-mismatch',
      'memory-capacity-mismatch',
    ]);
    expect(admitOffers(page, gpu('rtx4060ti'), catalog, FETCHED_AT).map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'memory-capacity-mismatch',
      'accepted',
      'memory-capacity-mismatch',
    ]);
  });

  it('refuses an unparseable price, an untracked link, and another merchant', () => {
    const results = admitOffers(items('newegg-malformed.xml'), gpu('rx7600'), catalog, FETCHED_AT);
    expect(results.map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'incomplete-record',
      'incomplete-record',
      'merchant-mismatch',
    ]);
    expect(results[1]).toMatchObject({ detail: expect.stringContaining('linksynergy') });
  });

  it('carries the sku and product name onto rejections so they can be audited', () => {
    const { rejected } = partition(admitOffers(items('newegg-rtx4070-page.xml'), gpu('rtx4070'), catalog, FETCHED_AT));
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect(r.sku).toBeTruthy();
      expect(r.productName).toBeTruthy();
    }
  });

  it('never emits a record whose current price is zero or negative', () => {
    const all = [
      ...admitOffers(items('newegg-rtx4070-page.xml'), gpu('rtx4070'), catalog, FETCHED_AT),
      ...admitOffers(items('newegg-rtx4060ti-capacity.xml'), gpu('rtx4060ti16'), catalog, FETCHED_AT),
      ...admitOffers(items('newegg-rtx4060ti-capacity.xml'), gpu('rtx4060ti'), catalog, FETCHED_AT),
    ];
    for (const o of all) {
      if (o.status !== 'accepted') continue;
      expect(o.retailPrice).toBeGreaterThan(0);
      expect(o.salePrice === null || o.salePrice > 0).toBe(true);
    }
  });
});
