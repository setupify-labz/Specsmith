import type { NeweggOffer } from '../rakuten/types';
import { describe, expect, it } from 'vitest';

import { findItems, parseProductSearchXml } from '../rakuten';
import { AFFILIATE_PART_TARGET, type AffiliatePart, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import { accessoryLeadsHeadset, gpuOfferToAffiliatePart, admitAffiliatePart, AffiliateCatalogFailure, buildAffiliatePartCatalog, isLegacyMemory, isSelectableBuilderPart } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';

const fetchedAt = '2026-08-29T23:00:00.000Z';
const item = (over: { mid?: string; leaf?: string; title?: string; link?: string; price?: string; sale?: string } = {}) =>
  findItems(
    parseProductSearchXml(`<result><item>
      <mid>${over.mid ?? '44583'}</mid>
      <sku>N82E16800000001</sku>
      <productname>${over.title ?? 'Example Desktop Processor'}</productname>
      <category><primary>Electronics</primary><secondary>Components~~${over.leaf ?? 'Computer Processors'}</secondary></category>
      <imageurl>https://c1.neweggimages.com/example.jpg</imageurl>
      <linkurl>${over.link ?? 'https://click.linksynergy.com/link?id=site&amp;offerid=offer'}</linkurl>
      <price currency="USD">${over.price ?? '299.99'}</price>
      <saleprice currency="USD">${over.sale ?? '0.00'}</saleprice>
    </item></result>`),
  )[0];

const part = (category: RetailPartCategory, index: number): AffiliatePart => ({
  id: `newegg-${category}-sku-${index}`,
  category,
  merchant: 'Newegg',
  name: `${category} ${index}`,
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${category}-${index}`,
  fetchedAt,
  availability: AVAILABILITY_UNKNOWN,
  retailPrice: 100 + index,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: category === 'gpu' ? 'rtx4070' : null,
  specsVerified: category === 'gpu',
});

const candidates = () =>
  new Map<RetailPartCategory, AffiliatePart[]>(
    RETAIL_CATEGORY_CONFIG.map((config) => [
      config.category,
      Array.from({ length: config.quota }, (_, index) => part(config.category, index)),
    ]),
  );

describe('generic affiliate part admission', () => {
  it('accepts only the expected merchant category with an image and tracked link', () => {
    expect(admitAffiliatePart(item(), 'cpu', 'Computer Processors', fetchedAt)).toMatchObject({
      status: 'accepted',
      part: { category: 'cpu', merchant: 'Newegg', specsVerified: false, canonicalPartId: null },
    });
  });

  it('refuses wrong merchants, wrong categories, non-new titles and untracked links', () => {
    expect(admitAffiliatePart(item({ mid: '1' }), 'cpu', 'Computer Processors', fetchedAt)).toMatchObject({ reason: 'merchant' });
    expect(admitAffiliatePart(item({ leaf: 'Laptop Batteries' }), 'cpu', 'Computer Processors', fetchedAt)).toMatchObject({ reason: 'category' });
    expect(admitAffiliatePart(item({ title: 'Open Box Example Processor' }), 'cpu', 'Computer Processors', fetchedAt)).toMatchObject({ reason: 'condition' });
    expect(admitAffiliatePart(item({ link: 'https://www.newegg.com/p/1' }), 'cpu', 'Computer Processors', fetchedAt)).toMatchObject({ reason: 'url' });
  });

  it.each([
    ['motherboard', 'ASUS Motherboard & AMD Ryzen 9 CPU Combo'],
    ['motherboard', 'X79 Motherboard+E5 CPU+2X8GB RAM Memory Set'],
    ['motherboard', 'Lian Li RGB Motherboard Power Extension Cable'],
    ['cpu', 'AMD Ryzen 5 Processor and ASUS B550 Motherboard'],
    ['cpu', 'AMD Ryzen 5 4500 Desktop Processor and ASUS TUF GAMING B550M-PLUS WIFI II AM4 AMD B550 SATA 6Gb/s Micro...'],
    ['keyboard', 'Coiled USB-C Cable for Mechanical Keyboard'],
    ['keyboard', 'Anime Keycaps for Mechanical Keyboard'],
    ['keyboard', 'Custom Switch Gateron Ink V2 Switches Transparent Housing for Mechanical Keyboard'],
    ['mouse', 'XXL Gaming Mouse Pad Desk Mat'],
    ['headset', 'PC Gaming Headset Hook Holder Stand'],
    ['headset', 'Replacement Earpads for Gaming Headset'],
    ['headset', 'Battery Replacement for Wireless Gaming Headset'],
    ['cooler', '80mm Case Fan for Server CPU Cooler'],
    ['psu', '2000W Mining Server Power Supply'],
    ['psu', 'ATX Power Supply Tester'],
    ['headset', 'Kitten Ears Universal for Gaming Headset'],
    ['storage', 'Solidigm Solid State Drive D3-S4620 Series 3.84TB'],
    ['storage', 'Solidigm D7-PS1030 Enterprise NVMe SSD'],
    ['psu', 'ATX PSU Breakout Board Adapter for Desktop Power Supply'],
    ['case', 'SilverStone Computer Case Storage Chassis'],
    ['case', '4U Rackmount Computer Case'],
    ['ram', '2GB DDR3 Desktop Memory RAM'],
    ['headset', 'Audio Cable for Gaming Headset'],
    ['headset', 'Gaming Headset Replacement Cable'],
  ] as const)('refuses a %s accessory or bundle: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(false);
  });

  it.each([
    ['storage', 'Storage Devices', 'Solidigm Solid State Drive D3-S4620 Series 3.84TB', '199.99'],
    ['psu', 'Computer Power Supplies', 'ATX PSU Breakout Board Adapter for Desktop Power Supply', '89.99'],
    ['case', 'Desktop Computer & Server Cases', 'SilverStone Computer Case Storage Chassis', '149.99'],
    ['ram', 'RAM', '2GB DDR3 Desktop Memory RAM', '59.99'],
    ['headset', 'Headphones & Headsets', 'Audio Cable for Gaming Headset', '79.99'],
  ] as const)('rejects an in-range %s false positive by kind, not price: %s', (category, leaf, title, price) => {
    expect(admitAffiliatePart(item({ leaf, title, price }), category, leaf, fetchedAt)).toEqual({
      status: 'rejected',
      reason: 'kind',
    });
  });

  it('applies the product-kind rule at the storage admission boundary', () => {
    expect(admitAffiliatePart(
      item({ leaf: 'Keyboards', title: 'Coiled USB-C Cable for Mechanical Keyboard' }),
      'keyboard',
      'Keyboards',
      fetchedAt,
    )).toEqual({ status: 'rejected', reason: 'kind' });
  });

  it.each([
    ['motherboard', 'ASUS ROG B850 ATX Motherboard'],
    ['keyboard', 'Keychron Q6 Mechanical Keyboard'],
    ['mouse', 'Logitech G Pro Wireless Gaming Mouse'],
    ['headset', 'SteelSeries Arctis Wireless Gaming Headset'],
    ['cooler', 'Noctua NH-D15 CPU Cooler'],
    ['psu', 'Corsair RM850x ATX Power Supply'],
    ['storage', 'Samsung 990 PRO 2TB Internal SSD'],
    ['ram', 'Corsair Vengeance 32GB DDR5 Desktop Memory'],
    ['case', 'Fractal Design North Gaming PC Case'],
    ['headset', 'SteelSeries Arctis Nova Gaming Headset with Detachable Cable'],
  ] as const)('keeps a real %s component: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(true);
  });

  // THE LISTINGS AS THE FEED ACTUALLY WRITES THEM.
  //
  // The kind rules were first written against hand-composed titles, and three
  // of them did not match the real thing. These are the verbatim names from
  // the published catalogue, so a rule that passes a tidy fixture and misses
  // the listing it was written for cannot pass again.
  it.each([
    ['case', 'SilverStone Case Storage Series SST-CS380 Black Computer Case'],
    ['case', '19 inch standard rack mounted 2U server chassis Case industrial control computer case'],
    ['headset', '3.5mm Earphone Cable with Inline Control for G633 G933 Gaming Headset Headphone Accessories'],
    ['headset', 'Headphone Protective Cushion Pad for Arctis 1 Gaming Headset'],
    ['storage', 'Solidigm Solid State Drive D5-P5336 Series (61.44TB, 2.5in PCIe 4.0 x4, 3D5, QLC) Generic FIPS Single Pack Data Center / Server / Internal SSD'],
    ['storage', 'Solidigm Solid State Drive D7-PS1030 Series (1.6TB, U.2 15mm, PCIe 5.0 x4, V7, TLC) Generic'],
    ['ram', 'samsung m378t5663eh3-cf7 8gb 4 x 2gb pc2-6400u ddr2 800 cl6 desktop memory kit'],
    ['ram', 'MemoryMasters 8GB (2x 4GB) DDR3/DDR3L PC3-12800 1600MHz DIMM (240-Pin) Desktop Memory'],
  ] as const)('refuses the real %s listing as published: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(false);
  });

  // THE OTHER DIRECTION. Each of these was rejected by an earlier draft of the
  // kind rules; each is an ordinary consumer part.
  it.each([
    // A merchant who spaces the generation out leaves "ddr" standing alone, and
    // a rule matching the bare word took a current kit with it.
    ['ram', 'Kingston FURY Beast DDR 5 32GB Desktop Memory RAM'],
    // A compatibility note is not a specification. Scanning for "DDR3" without
    // asking which way the sentence points reads this as a DDR3 kit.
    ['ram', 'Crucial Pro 32GB DDR5 RAM for gaming desktop, DDR3 not supported'],
    // "server" and "enterprise" as bare words are marketing copy on consumer
    // drives. Every datacenter listing in the feed says "Data Center"; none
    // says "enterprise", so the bare words cost real parts and caught nothing.
    ['storage', 'WD Black SN850X 4TB NVMe SSD for PC and server builds'],
    ['storage', 'Seagate FireCuda 530 2TB Gaming SSD, enterprise-grade endurance'],
    // The commonest shape in the category: a wireless headset whose dongle is
    // described as "adapter for PC", with "headphones" later in the title.
    ['headset', 'SteelSeries Arctis Nova 7 Wireless Gaming Headset with USB-C adapter for PC, 2.4GHz Headphones'],
    ['headset', 'HyperX Cloud III Wireless Gaming Headset, USB adapter for PC and PS5, over-ear headphones'],
    ['headset', 'Logitech G Pro X Gaming Headset with detachable audio cable'],
    ['case', 'Lian Li O11 Dynamic EVO Gaming Case with storage bay'],
  ] as const)('keeps the real %s component an earlier draft rejected: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(true);
  });

  it('decides a headset accessory by word order, not by adjacency', () => {
    // A cable named BEFORE the device is the product; named after, it is in
    // the box. Adjacency ("cable for … headset") got both of these wrong.
    expect(accessoryLeadsHeadset('3 5mm earphone cable with inline control for g633 gaming headset')).toBe(true);
    expect(accessoryLeadsHeadset('gaming headset with detachable audio cable')).toBe(false);
  });

  it('treats a legacy generation as disqualifying only when no current one is named', () => {
    expect(isLegacyMemory('8gb ddr3 1600mhz desktop memory')).toBe(true);
    expect(isLegacyMemory('32gb ddr5 6000 ram ddr3 not supported')).toBe(false);
    expect(isLegacyMemory('kingston fury beast ddr 5 32gb desktop memory')).toBe(false);
  });
});

describe('500-part catalog gate', () => {
  it('selects exactly the reviewed per-category quotas', () => {
    const catalog = buildAffiliatePartCatalog(candidates(), fetchedAt);
    expect(catalog.parts).toHaveLength(AFFILIATE_PART_TARGET);
    for (const config of RETAIL_CATEGORY_CONFIG) {
      expect(catalog.parts.filter((entry) => entry.category === config.category)).toHaveLength(config.quota);
    }
  });

  it('fails closed if even one category is short', () => {
    const input = candidates();
    input.get('headset')!.pop();
    expect(() => buildAffiliatePartCatalog(input, fetchedAt)).toThrow(AffiliateCatalogFailure);
  });

  it('does not count two listings with the same normalized product name as two parts', () => {
    const input = candidates();
    const headset = input.get('headset')!;
    headset[headset.length - 1] = {
      ...headset[0],
      id: 'newegg-headset-another-sku',
      name: `  ${headset[0].name.toUpperCase()}!!!`,
    };
    expect(() => buildAffiliatePartCatalog(input, fetchedAt)).toThrow(AffiliateCatalogFailure);
  });

  it('the quota registry itself is exactly 500 and has every category once', () => {
    expect(RETAIL_CATEGORY_CONFIG.reduce((sum, config) => sum + config.quota, 0)).toBe(AFFILIATE_PART_TARGET);
    expect(new Set(RETAIL_CATEGORY_CONFIG.map((config) => config.category)).size).toBe(RETAIL_CATEGORY_CONFIG.length);
  });
});

describe('the publication gate requires 500 parts AND 500 prices', () => {
  it('refuses a catalogue where one selected part lost its price', () => {
    // The failure the gate exists for: a quota met in count but not in
    // evidence. Publishing it would ship 499 priced cards and one that renders
    // an empty price with no explanation.
    //
    // A ZERO price is now caught EARLIER, by the category scope: zero is below
    // every category's floor, so the candidate never competes for a slot and
    // the category comes up one short. The two gates are not redundant — the
    // next test carries a pricing fault that IS in scope and still has to be
    // refused — but the reported failure for this input is the shortfall.
    const map = candidates();
    const gpus = [...(map.get('gpu') ?? [])];
    gpus[0] = { ...gpus[0], retailPrice: 0 };
    map.set('gpu', gpus);
    expect(() => buildAffiliatePartCatalog(map, fetchedAt)).toThrow(
      expect.objectContaining({ code: 'category-shortfall' }),
    );
  });

  it('refuses a sale price that is not below the retail price', () => {
    const map = candidates();
    const cpus = [...(map.get('cpu') ?? [])];
    cpus[0] = { ...cpus[0], retailPrice: 100, salePrice: 100 };
    map.set('cpu', cpus);
    expect(() => buildAffiliatePartCatalog(map, fetchedAt)).toThrow(
      expect.objectContaining({ code: 'price-missing' }),
    );
  });

  it('publishes when every selected part carries a valid price', () => {
    const catalog = buildAffiliatePartCatalog(candidates(), fetchedAt);
    expect(catalog.parts).toHaveLength(500);
    expect(catalog.parts.every((p) => p.retailPrice > 0 && /^[A-Z]{3}$/.test(p.currency))).toBe(true);
  });
});

describe('prices are read from the listing, and a bad one costs the candidate', () => {
  it('reads the retail price and its currency', () => {
    const admitted = admitAffiliatePart(item({ price: '449.99' }), 'cpu', 'Computer Processors', fetchedAt);
    expect(admitted).toMatchObject({ status: 'accepted', part: { retailPrice: 449.99, currency: 'USD', salePrice: null } });
  });

  it('treats saleprice=0 as no sale, not as free', () => {
    const admitted = admitAffiliatePart(item({ price: '449.99', sale: '0.00' }), 'cpu', 'Computer Processors', fetchedAt);
    expect(admitted).toMatchObject({ status: 'accepted', part: { salePrice: null } });
  });

  it('keeps a genuine discount', () => {
    const admitted = admitAffiliatePart(item({ price: '449.99', sale: '399.99' }), 'cpu', 'Computer Processors', fetchedAt);
    expect(admitted).toMatchObject({ status: 'accepted', part: { retailPrice: 449.99, salePrice: 399.99 } });
  });

  it('drops a sale that is not lower rather than rendering a false discount', () => {
    const admitted = admitAffiliatePart(item({ price: '449.99', sale: '449.99' }), 'cpu', 'Computer Processors', fetchedAt);
    expect(admitted).toMatchObject({ status: 'accepted', part: { salePrice: null } });
  });

  it('rejects a listing with a zero or unparseable retail price', () => {
    for (const price of ['0.00', 'call for price', '']) {
      expect(admitAffiliatePart(item({ price }), 'cpu', 'Computer Processors', fetchedAt), price).toMatchObject({
        status: 'rejected',
        reason: 'price',
      });
    }
  });
});


it('the scheduled generator refuses contradictory GPU offers before publication', () => {
  const trackedAffiliateUrl = 'https://click.linksynergy.com/link?id=test&offerid=test&murl=' + encodeURIComponent('https://www.newegg.com/msi-rtx-5060-gaming-oc/p/N82E16814137980');
  const offer = { productName: 'MSI RTX 5050 GAMING OC', trackedAffiliateUrl } as NeweggOffer;
  expect(gpuOfferToAffiliatePart(offer)).toBeNull();
});
