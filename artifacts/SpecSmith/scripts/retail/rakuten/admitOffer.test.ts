import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { admitOffer, admitOffers } from './admitOffer';
import { classifyListing } from './listingKind';
import { findItems, parseProductSearchXml, type XmlElement } from './parseProductSearchXml';
import { loadGpuCatalog, partition } from './index';
import { NEWEGG_MID, RAKUTEN_ADAPTER_VERSION, REQUIRED_CATEGORY_LEAF, type CatalogGpu } from './types';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const items = (name: string): XmlElement[] => findItems(parseProductSearchXml(fs.readFileSync(path.join(fixtures, name), 'utf-8')));

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;
const page1 = () => items('newegg-rtx4070-page1.xml');
const bothPages = () => [...items('newegg-rtx4070-page1.xml'), ...items('newegg-rtx4070-page2.xml')];
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
    const admitted = admitOffer(page1()[0], gpu('rtx4070'), FETCHED_AT);
    expect(admitted).toEqual({
      status: 'accepted',
      sku: 'N82E16814932663',
      upc: '889523036891',
      productName: 'GIGABYTE GeForce RTX 4070 WINDFORCE OC V2 12GB GDDR6X Desktop Graphics Card, GV-N4070WF3OCV2-12GD',
      categoryPrimary: 'Computers',
      categorySecondary: 'Components~~Video Cards & Adapters',
      categorySecondaryLeaf: REQUIRED_CATEGORY_LEAF,
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
    const admitted = admitOffer(page1()[0], gpu('rtx4070'), FETCHED_AT);
    expect(admitted).toMatchObject({ status: 'accepted', salePrice: null });
    // The rule that matters downstream: the "current" price never becomes 0.
    const current = admitted.status === 'accepted' ? admitted.salePrice ?? admitted.retailPrice : null;
    expect(current).toBe(579.99);
  });

  it('keeps a real sale price', () => {
    const admitted = admitOffer(items('newegg-rtx4060ti-capacity.xml')[0], gpu('rtx4060ti16'), FETCHED_AT);
    expect(admitted).toMatchObject({ status: 'accepted', retailPrice: 449.99, salePrice: 429.99, currency: 'USD' });
  });

  it('gives each fixture listing the reason it actually fails on, across both pages', () => {
    const results = admitOffers(bothPages(), gpu('rtx4070'), FETCHED_AT);
    expect(results.map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'accepted',
      'variant-suffix-mismatch', // RTX 4070 SUPER
      'category-mismatch', // cable, in the Accessories leaf UNDER the card leaf
      'category-mismatch', // prebuilt, correctly categorised by the merchant
      'condition-not-new', // refurbished
      'variant-suffix-mismatch', // RTX 4070 Ti
      'laptop-part', // laptop, miscategorised into the card leaf
      'prebuilt-system', // gaming desktop, miscategorised into the card leaf
    ]);
  });

  it('refuses the accessories leaf, which sits directly under the card leaf', () => {
    // A substring match on the secondary path would admit this; segment
    // equality is what stops a $19 cable becoming an RTX 4070 offer.
    const cable = page1()[2];
    const verdict = admitOffer(cable, gpu('rtx4070'), FETCHED_AT);
    expect(verdict).toMatchObject({ status: 'rejected', reason: 'category-mismatch' });
    expect((verdict as { detail: string }).detail).toContain('Accessories');
  });

  it('checks kind before model, so a cable inside the card leaf is reported as a cable', () => {
    // Same cable, this time miscategorised by the merchant into the card leaf,
    // so the category gate cannot catch it and the title gate must.
    const miscategorised = findItems(
      parseProductSearchXml(
        fs
          .readFileSync(path.join(fixtures, 'newegg-rtx4070-page1.xml'), 'utf-8')
          .replace('Components~~Video Cards &amp; Adapters~~Accessories', 'Components~~Video Cards &amp; Adapters'),
      ),
    )[2];
    expect(admitOffer(miscategorised, gpu('rtx4070'), FETCHED_AT)).toMatchObject({ reason: 'not-a-graphics-card' });
  });

  it('separates the two RTX 4060 Ti capacities and refuses the one that states neither', () => {
    const page = items('newegg-rtx4060ti-capacity.xml');
    const reasons = (id: string) =>
      admitOffers(page, gpu(id), FETCHED_AT).map((r) => (r.status === 'accepted' ? 'accepted' : r.reason));
    expect(reasons('rtx4060ti16')).toEqual([
      'accepted',
      'memory-capacity-mismatch',
      'memory-capacity-unstated',
      'model-mismatch',
      'model-mismatch',
    ]);
    expect(reasons('rtx4060ti')).toEqual([
      'memory-capacity-mismatch',
      'accepted',
      'memory-capacity-unstated',
      'model-mismatch',
      'model-mismatch',
    ]);
  });

  it('refuses an unspecified RTX 5060 Ti even though the catalog tracks only the 16GB part', () => {
    const page = items('newegg-rtx4060ti-capacity.xml');
    const results = admitOffers(page, gpu('rtx5060ti'), FETCHED_AT);
    expect(results.map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'model-mismatch',
      'model-mismatch',
      'model-mismatch',
      'memory-capacity-unstated', // "ASUS Dual RTX 5060 Ti OC" — could be the 8GB card
      'accepted', // "ASUS PRIME RTX 5060 Ti 16GB" — says so
    ]);
    expect(results[4]).toMatchObject({ status: 'accepted', sku: 'N82E16814137888', retailPrice: 479.99 });
  });

  it('refuses an unparseable price, an untracked link, and another merchant', () => {
    const results = admitOffers(items('newegg-malformed.xml'), gpu('rx7600'), FETCHED_AT);
    expect(results.map((r) => (r.status === 'accepted' ? 'accepted' : r.reason))).toEqual([
      'incomplete-record',
      'incomplete-record',
      'merchant-mismatch',
    ]);
    expect(results[1]).toMatchObject({ detail: expect.stringContaining('linksynergy') });
  });

  it('carries the sku and product name onto rejections so they can be audited', () => {
    const { rejected } = partition(admitOffers(bothPages(), gpu('rtx4070'), FETCHED_AT));
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect(r.sku).toBeTruthy();
      expect(r.productName).toBeTruthy();
    }
  });

  it('never emits a record whose current price is zero or negative', () => {
    const all = [
      ...admitOffers(bothPages(), gpu('rtx4070'), FETCHED_AT),
      ...admitOffers(items('newegg-rtx4060ti-capacity.xml'), gpu('rtx4060ti16'), FETCHED_AT),
      ...admitOffers(items('newegg-rtx4060ti-capacity.xml'), gpu('rtx4060ti'), FETCHED_AT),
    ];
    for (const o of all) {
      if (o.status !== 'accepted') continue;
      expect(o.retailPrice).toBeGreaterThan(0);
      expect(o.salePrice === null || o.salePrice > 0).toBe(true);
    }
  });
});
