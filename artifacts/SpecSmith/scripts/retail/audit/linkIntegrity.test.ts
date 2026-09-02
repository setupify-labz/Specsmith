import { describe, expect, it } from 'vitest';

import { classifyAmazonUrl, classifyDirectNeweggUrl, classifyTrackedNeweggUrl } from './linkIntegrity';

// Real shapes, taken from the committed `public/data/retail-parts.json` and
// from `src/lib/fps.ts`'s own fallback-link builders (`getAffiliateUrl`,
// `getNeweggUrl`). Each fixture pins one real-world scenario the audit tool
// must be able to tell apart; running the CLI against the actual catalog
// (see `audit-retailer-links.test.ts`) is what confirms these are exhaustive
// in practice, not just in imagination.

const TRACKED_EXACT =
  'https://click.linksynergy.com/link?id=ptE95Z94djU&offerid=1786142.445836758097709657137697&type=15&murl=https%3A%2F%2Fwww.newegg.com%2Fgigabyte-gv-n5090aorusm-ice-32gd-geforce-rtx-5090-32gb-graphics-card-triple-fans%2Fp%2FN82E16814932765%3Fitem%3DN82E16814932765';

// A real listing whose Newegg URL-path item id ("274-000M-001T4") differs
// from its query-string item id ("9SIAWKTKFU6722") — two valid identifiers
// for the same page. The query parameter is the one this repository's own
// `id` field is derived from (see `expectedItemIdFromPartId`), so it must win.
const TRACKED_DUAL_ITEM_ID =
  'https://click.linksynergy.com/link?id=ptE95Z94djU&offerid=1786142.445835507703677803621270&type=15&murl=https%3A%2F%2Fwww.newegg.com%2Famd-ryzen-5-5000-series-ryzen-5-5600-vermeer-socket-am4-processors-desktops%2Fp%2F274-000M-001T4%3Fitem%3D9SIAWKTKFU6722';

describe('classifyAmazonUrl', () => {
  it('classifies the missing case', () => {
    expect(classifyAmazonUrl(null)).toEqual({ urlType: 'missing', attributed: false, evidence: 'no-url-supplied' });
    expect(classifyAmazonUrl('')).toEqual({ urlType: 'missing', attributed: false, evidence: 'no-url-supplied' });
  });

  it('classifies a malformed URL', () => {
    expect(classifyAmazonUrl('not a url')).toMatchObject({ urlType: 'malformed' });
  });

  it('classifies the real getAffiliateUrl() fallback-search shape as fallback-search, never exact', () => {
    const url = 'https://www.amazon.com/s?k=NVIDIA%20GeForce%20RTX%205090%20graphics%20card&tag=specsmithpc-20';
    expect(classifyAmazonUrl(url)).toEqual({ urlType: 'fallback-search', attributed: true, evidence: 'search-path-shape' });
  });

  it('classifies an exact product page with attribution', () => {
    expect(classifyAmazonUrl('https://www.amazon.com/dp/B0CJKX8QYT?tag=specsmithpc-20')).toEqual({
      urlType: 'exact',
      attributed: true,
      evidence: 'product-path-shape',
    });
  });

  it('flags an exact-shaped product page missing the affiliate tag rather than reporting it as clean', () => {
    expect(classifyAmazonUrl('https://www.amazon.com/dp/B0CJKX8QYT')).toEqual({
      urlType: 'exact',
      attributed: false,
      evidence: 'affiliate-tag-missing',
    });
  });

  it('classifies a wrong domain, including a nested redirector, as wrong-domain — never as exact', () => {
    expect(classifyAmazonUrl('https://amazon.com.evil.test/dp/B0CJKX8QYT')).toMatchObject({ urlType: 'wrong-domain' });
    expect(classifyAmazonUrl('https://click.linksynergy.com/link?murl=https://www.amazon.com/dp/B0CJKX8QYT')).toMatchObject({
      urlType: 'wrong-domain',
      evidence: 'host-looks-like-nested-redirector',
    });
  });

  it('classifies an unrecognized path shape as ambiguous rather than guessing', () => {
    expect(classifyAmazonUrl('https://www.amazon.com/gp/cart/view.html')).toMatchObject({ urlType: 'ambiguous' });
  });
});

describe('classifyDirectNeweggUrl', () => {
  it('classifies the real getNeweggUrl() fallback-search shape as fallback-search, never exact', () => {
    const url = 'https://www.newegg.com/p/pl?d=NVIDIA%20GeForce%20RTX%205090%20graphics%20card';
    expect(classifyDirectNeweggUrl(url)).toEqual({ urlType: 'fallback-search', attributed: false, evidence: 'search-path-shape' });
  });

  it('classifies a real product-page shape (slug + /p/<item>) as exact', () => {
    const url = 'https://www.newegg.com/gigabyte-gv-n5090aorusm-ice-32gd-geforce-rtx-5090-32gb-graphics-card-triple-fans/p/N82E16814932765?item=N82E16814932765';
    expect(classifyDirectNeweggUrl(url, 'N82E16814932765')).toEqual({ urlType: 'exact', attributed: false, evidence: 'product-path-shape' });
  });

  it('accepts an item id containing dashes (a real Newegg SKU shape)', () => {
    const url = 'https://www.newegg.com/zotac-nvidia-rtx-5070-ti-16gb-gddr7-video-cards/p/1FT-000M-00474?item=1FT-000M-00474';
    expect(classifyDirectNeweggUrl(url, '1FT-000M-00474')).toMatchObject({ urlType: 'exact' });
  });

  it('catches a WRONG VARIANT: a product link whose item id does not match the intended part', () => {
    const url = 'https://www.newegg.com/some-other-card/p/N82E16814500639?item=N82E16814500639';
    expect(classifyDirectNeweggUrl(url, 'N82E16814932765')).toEqual({
      urlType: 'ambiguous',
      attributed: false,
      evidence: 'product-path-item-id-mismatch',
    });
  });

  it('never counts a product-page shape with no item id at all as exact', () => {
    expect(classifyDirectNeweggUrl('https://www.newegg.com/some-slug-with-no-item-id')).toMatchObject({ urlType: 'ambiguous' });
  });

  it('classifies a wrong domain as wrong-domain', () => {
    expect(classifyDirectNeweggUrl('https://www.newegg.com.evil.test/p/N82E16814932765')).toMatchObject({ urlType: 'wrong-domain' });
  });

  it('classifies a malformed URL and a missing URL', () => {
    expect(classifyDirectNeweggUrl('ht!tp://broken')).toMatchObject({ urlType: 'malformed' });
    expect(classifyDirectNeweggUrl(undefined)).toEqual({ urlType: 'missing', attributed: false, evidence: 'no-url-supplied' });
  });
});

describe('classifyTrackedNeweggUrl', () => {
  it('classifies a real tracked, attributed, exact listing as exact and attributed', () => {
    expect(classifyTrackedNeweggUrl(TRACKED_EXACT, 'N82E16814932765')).toEqual({
      urlType: 'exact',
      attributed: true,
      evidence: 'product-path-shape',
    });
  });

  it('prefers the destination query item id over the path item id when the two real ids differ', () => {
    expect(classifyTrackedNeweggUrl(TRACKED_DUAL_ITEM_ID, '9SIAWKTKFU6722')).toMatchObject({ urlType: 'exact', attributed: true });
  });

  it('catches a WRONG VARIANT inside a tracked link', () => {
    expect(classifyTrackedNeweggUrl(TRACKED_EXACT, 'N82E16814500639')).toEqual({
      urlType: 'ambiguous',
      attributed: true,
      evidence: 'product-path-item-id-mismatch',
    });
  });

  it('flags MISSING ATTRIBUTION: a tracked link missing id/offerid, even though the destination is exact', () => {
    const url = 'https://click.linksynergy.com/link?type=15&murl=' + encodeURIComponent(
      'https://www.newegg.com/gigabyte-.../p/N82E16814932765?item=N82E16814932765',
    );
    expect(classifyTrackedNeweggUrl(url, 'N82E16814932765')).toEqual({
      urlType: 'exact',
      attributed: false,
      evidence: 'tracked-link-missing-affiliate-ids',
    });
  });

  it('classifies a REDIRECT to a generic search page as fallback-search, never exact', () => {
    const url = 'https://click.linksynergy.com/link?id=x&offerid=1.1&type=15&murl=' + encodeURIComponent('https://www.newegg.com/p/pl?d=graphics+card');
    expect(classifyTrackedNeweggUrl(url)).toEqual({ urlType: 'fallback-search', attributed: true, evidence: 'search-path-shape' });
  });

  it('classifies a MALFORMED tracked link (destination does not parse)', () => {
    const url = 'https://click.linksynergy.com/link?id=x&offerid=1.1&type=15&murl=not-a-url';
    expect(classifyTrackedNeweggUrl(url)).toMatchObject({ urlType: 'malformed', evidence: 'tracked-link-destination-does-not-parse' });
  });

  it('classifies a tracked link with no destination param at all as ambiguous', () => {
    const url = 'https://click.linksynergy.com/link?id=x&offerid=1.1&type=15';
    expect(classifyTrackedNeweggUrl(url)).toMatchObject({ urlType: 'ambiguous', evidence: 'tracked-link-missing-destination-param' });
  });

  it('classifies a WRONG-DOMAIN destination inside an otherwise-valid tracking hop', () => {
    const url = 'https://click.linksynergy.com/link?id=x&offerid=1.1&type=15&murl=' + encodeURIComponent('https://www.walmart.com/ip/rtx-5090/123');
    expect(classifyTrackedNeweggUrl(url)).toMatchObject({ urlType: 'wrong-domain', evidence: 'tracked-link-destination-wrong-host' });
  });

  it('classifies an untracked host as wrong-domain outright — the tracking hop itself is required', () => {
    expect(classifyTrackedNeweggUrl('https://www.newegg.com/gigabyte/p/N82E16814932765?item=N82E16814932765')).toMatchObject({
      urlType: 'wrong-domain',
      evidence: 'host-not-allowed',
    });
  });

  it('classifies the missing case', () => {
    expect(classifyTrackedNeweggUrl(null)).toEqual({ urlType: 'missing', attributed: false, evidence: 'no-url-supplied' });
  });
});
