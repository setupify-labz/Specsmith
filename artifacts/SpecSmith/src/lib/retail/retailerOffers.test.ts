import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';
import { UNAVAILABLE_RETAILERS, offerBelongsToPart, offersFor } from './retailerOffers';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('an offer belongs to one exact listing', () => {
  it('carries that listing\'s own url, price, currency and read time', () => {
    for (const part of catalog.parts.slice(0, 40)) {
      const [offer, ...rest] = offersFor(part);
      expect(rest).toHaveLength(0);
      expect(offer.partId).toBe(part.id);
      expect(offer.url).toBe(part.trackedAffiliateUrl);
      expect(offer.retailPrice).toBe(part.retailPrice);
      expect(offer.salePrice).toBe(part.salePrice);
      expect(offer.currency).toBe(part.currency);
      expect(offer.fetchedAt).toBe(part.fetchedAt);
    }
  });

  it('refuses an offer belonging to a different SKU, even of the same model', () => {
    // Two ASUS RTX 5070s are two products. An offer for one is not an offer
    // for the other, and matching at model level is exactly the error the
    // review named.
    const siblings = catalog.parts.filter((part) => part.canonicalPartId === catalog.parts[0].canonicalPartId);
    const [first, second] = siblings;
    if (second === undefined) return;
    const offer = offersFor(first)[0];
    expect(offerBelongsToPart(offer, first)).toBe(true);
    expect(offerBelongsToPart(offer, second)).toBe(false);
  });

  it('never lets one retailer\'s price stand in for another\'s', () => {
    // Each offer carries its own price AND its own timestamp, so a second
    // retailer could never be added by reusing the first one's figures.
    const part = catalog.parts[0];
    const offer = offersFor(part)[0];
    expect(offer).toHaveProperty('fetchedAt');
    expect(offer).toHaveProperty('currency');
    expect(offer.retailer).toBe('Newegg');
  });
});

describe('Amazon is absent because the data for it is absent', () => {
  it('offers no Amazon entry for any listing', () => {
    for (const part of catalog.parts.slice(0, 60)) {
      expect(offersFor(part).some((offer) => offer.retailer !== 'Newegg')).toBe(false);
    }
  });

  it('the catalogue contains no ASIN or Amazon URL to build one from', () => {
    const serialized = JSON.stringify(catalog.parts);
    expect(serialized.toLowerCase()).not.toContain('amazon');
    expect(serialized).not.toMatch(/\bB0[A-Z0-9]{8}\b/);
  });

  it('the feed carries no Amazon merchant, so one could not be evidenced', () => {
    const fixtures = path.join(repoRoot, 'scripts', 'retail', 'rakuten', '__fixtures__');
    const xml = fs
      .readdirSync(fixtures)
      .filter((name) => name.endsWith('.xml'))
      .map((name) => fs.readFileSync(path.join(fixtures, name), 'utf-8'))
      .join('\n');
    expect(xml.toLowerCase()).not.toContain('amazon');
    expect(xml).not.toMatch(/\bB0[A-Z0-9]{8}\b/);
  });

  it('records what is missing rather than leaving a silent gap', () => {
    const amazon = UNAVAILABLE_RETAILERS.find((entry) => entry.retailer === 'Amazon');
    expect(amazon).toBeDefined();
    expect(amazon?.missing).toContain('ASIN');
    expect(amazon?.missing).toContain('search URL');
  });

  it('the retail modules never reach for the placeholder Amazon helper', () => {
    // getAffiliateUrl() builds amazon.com/s?k=… with a placeholder tag. It is
    // a search link, and no amount of styling makes it this SKU's offer.
    const dir = path.join(repoRoot, 'src', 'lib', 'retail');
    for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
      const body = fs.readFileSync(path.join(dir, name), 'utf-8');
      const code = body.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
      expect(code.includes('getAffiliateUrl'), name).toBe(false);
      expect(code.includes('AMAZON_AFFILIATE_TAG'), name).toBe(false);
      expect(code.includes('amazon.com'), name).toBe(false);
    }
  });
});
