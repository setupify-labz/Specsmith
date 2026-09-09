// Issue #101, requirement 9: prove the binding through the catalogue
// generator's own admission function, not by editing published data.
//
// The live Rakuten feed is unreachable from this sandbox, so the feed RESPONSE
// is reconstructed here from the real record's own published values — the same
// SKU, title and tracked link that are in `public/data/retail-parts.json`
// today. Everything downstream of parsing is the production code path:
// `admitAffiliatePart` is the function `generate-affiliate-catalog.ts` calls
// for every non-GPU listing.
//
// This is a deterministic proof of the ADMISSION PATH. It is not a claim that a
// live refresh ran, and it does not modify the published catalogue.
import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { findItems, parseProductSearchXml } from '../rakuten/parseProductSearchXml';
import { admitAffiliatePart } from './affiliateCatalog';

const PARTS = ((catalogData as any).parts ?? catalogData) as any[];
const TARGET = 'newegg-cpu-9sia4rekg24553';
const real = PARTS.find((p) => p.id === TARGET);

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A feed item carrying the real record's values. */
const feedItem = (over: { sku?: string; title?: string; link?: string } = {}) =>
  findItems(
    parseProductSearchXml(`<result><item>
      <mid>44583</mid>
      <sku>${over.sku ?? '9SIA4REKG24553'}</sku>
      <productname>${xmlEscape(over.title ?? real.name)}</productname>
      <category><primary>Electronics</primary><secondary>Components~~Computer Processors</secondary></category>
      <imageurl>${xmlEscape(real.imageUrl)}</imageurl>
      <linkurl>${xmlEscape(over.link ?? real.trackedAffiliateUrl)}</linkurl>
      <price currency="USD">199.99</price>
      <saleprice currency="USD">0.00</saleprice>
    </item></result>`),
  )[0];

const admit = (over = {}) =>
  admitAffiliatePart(feedItem(over), 'cpu', 'Computer Processors', '2026-09-08T08:12:42.395Z');

describe('the generator admits the reviewed processor as a verified part', () => {
  it('the real record exists and is currently unsupported in published data', () => {
    expect(real).toBeTruthy();
    expect(real.canonicalPartId).toBeNull();
    expect(real.specsVerified).toBe(false);
  });

  it('emits canonicalPartId i5-13400f and specsVerified true', () => {
    expect(admit()).toMatchObject({
      status: 'accepted',
      part: { id: TARGET, category: 'cpu', canonicalPartId: 'i5-13400f', specsVerified: true },
    });
  });

  it('carries the retailer observation through unchanged', () => {
    const outcome: any = admit();
    expect(outcome.part.name).toBe(real.name);
    expect(outcome.part.trackedAffiliateUrl).toBe(real.trackedAffiliateUrl);
    expect(outcome.part.merchant).toBe('Newegg');
  });
});

describe('the generator still refuses everything it should', () => {
  it('refuses an unreviewed SKU, even with an identical title', () => {
    expect(admit({ sku: '9SIAOTHERSKU0001' })).toMatchObject({
      status: 'accepted',
      part: { canonicalPartId: null, specsVerified: false },
    });
  });

  it('refuses the reviewed SKU once its title names the non-F variant', () => {
    expect(admit({ title: 'Intel Core i5-13400 Desktop Processor 10 cores' })).toMatchObject({
      status: 'accepted',
      part: { canonicalPartId: null, specsVerified: false },
    });
  });

  it('refuses the reviewed SKU when its link points at a different processor', () => {
    const hostile =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent('https://www.newegg.com/intel-core-i9-14900k-desktop-processor/p/N82E1');
    expect(admit({ link: hostile })).toMatchObject({
      status: 'accepted',
      part: { canonicalPartId: null, specsVerified: false },
    });
  });
});
