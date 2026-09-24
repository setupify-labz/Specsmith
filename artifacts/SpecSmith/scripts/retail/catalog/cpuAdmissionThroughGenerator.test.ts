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
import { decodeMerchantDestination, merchantProductIdFrom } from './cpuIdentityBinding';
import { CPU_IDENTITY_BINDINGS } from './cpuIdentityRegistry';

const PARTS = ((catalogData as any).parts ?? catalogData) as any[];
const PRODUCT_ID = CPU_IDENTITY_BINDINGS[0].retailer.merchantProductId;
const real = PARTS.find((part) => {
  const destination = decodeMerchantDestination(part.trackedAffiliateUrl);
  return destination !== null && merchantProductIdFrom(destination) === PRODUCT_ID;
});
if (!real) throw new Error(`reviewed product ${PRODUCT_ID} is absent from the catalogue`);
const TARGET = real.id;
const REAL_SKU = new URL(decodeMerchantDestination(real.trackedAffiliateUrl)!).searchParams.get('item');
if (!REAL_SKU) throw new Error(`reviewed product ${PRODUCT_ID} has no current offer id`);

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A feed item carrying the real record's values. */
const feedItem = (over: { sku?: string; title?: string; link?: string } = {}) =>
  findItems(
    parseProductSearchXml(`<result><item>
      <mid>44583</mid>
      <sku>${over.sku ?? REAL_SKU}</sku>
      <productname>${xmlEscape(over.title ?? real.name)}</productname>
      <category><primary>Electronics</primary><secondary>Components~~Computer Processors</secondary></category>
      <imageurl>${xmlEscape(real.imageUrl)}</imageurl>
      <linkurl>${xmlEscape(over.link ?? real.trackedAffiliateUrl)}</linkurl>
      <price currency="USD">199.99</price>
      <saleprice currency="USD">0.00</saleprice>
    </item></result>`),
  )[0];

/**
 * An INDEPENDENT raw Rakuten feed record for the reviewed processor, written
 * out literally: Newegg product N82E16819118431, offer 9SIA4REKG24553. It is
 * not read from `retail-parts.json`, so the admission result it produces is
 * evidence about the generator, not an echo of the published data.
 */
const RAW_FEED_XML = `<result><item>
  <mid>44583</mid>
  <sku>9SIA4REKG24553</sku>
  <productname>Intel Core i5-13400F Desktop Processor 10 cores (6 P-cores + 4 E-cores) 20MB Cache, up to 4.6 GHz - Box</productname>
  <category><primary>Electronics</primary><secondary>Components~~Computer Processors</secondary></category>
  <imageurl>https://c1.neweggimages.com/ProductImageCompressAll640/19-118-431-04.jpg</imageurl>
  <linkurl>https://click.linksynergy.com/link?id=ptE95Z94djU&amp;offerid=1786142.4458312946026341861780320&amp;type=15&amp;murl=https%3A%2F%2Fwww.newegg.com%2Fintel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor%2Fp%2FN82E16819118431%3Fitem%3D9SIA4REKG24553</linkurl>
  <price currency="USD">199.99</price>
  <saleprice currency="USD">0.00</saleprice>
</item></result>`;

const admit = (over = {}) =>
  admitAffiliatePart(feedItem(over), 'cpu', 'Computer Processors', '2026-09-08T08:12:42.395Z');

describe('the generator admits the reviewed processor with verified identity', () => {
  it('admits an independent raw feed record as i5-13400f without exact-unit specs, and the published record agrees', () => {
    // This used to assert the published record was UNBOUND (canonicalPartId
    // null). That was true when #105 merged and stopped being true when the
    // next scheduled refresh (aeb377e) ran this same admission path and
    // published the binding. The lasting properties are checked instead,
    // against a raw feed record written out literally below rather than
    // rebuilt from the published JSON, so the two sides cannot agree merely
    // because one was derived from the other.
    const outcome: any = admitAffiliatePart(
      findItems(parseProductSearchXml(RAW_FEED_XML))[0],
      'cpu',
      'Computer Processors',
      '2026-09-08T08:12:42.395Z',
    );
    expect(outcome.status).toBe('accepted');
    expect(outcome.part.category).toBe('cpu');
    expect(outcome.part.canonicalPartId).toBe('i5-13400f');
    expect(outcome.part.specsVerified).toBe(false);

    expect(real).toBeTruthy();
    expect(real.canonicalPartId).toBe('i5-13400f');
    expect(real.specsVerified).toBe(false);
  });

  it('emits canonicalPartId i5-13400f without claiming exact-unit specs', () => {
    expect(admit()).toMatchObject({
      status: 'accepted',
      part: { id: TARGET, category: 'cpu', canonicalPartId: 'i5-13400f', specsVerified: false },
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
  it('still binds when only the offer id changes, which is why it is keyed on the product', () => {
    // Newegg re-issues the same product under new item ids. The binding is
    // keyed on the /p/ product id in the tracked link, so a new SKU for the
    // same product page still resolves.
    expect(admit({ sku: '9SIANEWOFFER0001' })).toMatchObject({
      status: 'accepted',
      part: { canonicalPartId: 'i5-13400f', specsVerified: false },
    });
  });

  it('refuses a listing whose link points at an unreviewed product', () => {
    const otherProduct =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent(
        'https://www.newegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E99999999999?item=9SIA1',
      );
    expect(admit({ link: otherProduct })).toMatchObject({
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
