import { describe, expect, it } from 'vitest';

import { findItems, parseProductSearchXml } from '../rakuten';
import { AFFILIATE_PART_TARGET, type AffiliatePart, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import { admitAffiliatePart, AffiliateCatalogFailure, buildAffiliatePartCatalog, isSelectableBuilderPart } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';

const fetchedAt = '2026-08-29T23:00:00.000Z';
const item = (over: { mid?: string; leaf?: string; title?: string; link?: string } = {}) =>
  findItems(
    parseProductSearchXml(`<result><item>
      <mid>${over.mid ?? '44583'}</mid>
      <sku>N82E16800000001</sku>
      <productname>${over.title ?? 'Example Desktop Processor'}</productname>
      <category><primary>Electronics</primary><secondary>Components~~${over.leaf ?? 'Computer Processors'}</secondary></category>
      <imageurl>https://c1.neweggimages.com/example.jpg</imageurl>
      <linkurl>${over.link ?? 'https://click.linksynergy.com/link?id=site&amp;offerid=offer'}</linkurl>
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
  ] as const)('refuses a %s accessory or bundle: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(false);
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
  ] as const)('keeps a real %s component: %s', (category, title) => {
    expect(isSelectableBuilderPart(category, title)).toBe(true);
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
