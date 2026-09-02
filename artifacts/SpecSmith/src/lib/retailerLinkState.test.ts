import { describe, expect, it } from 'vitest';
import { getAmazonLink, getNeweggLink } from './retailerLinkState';
import { getAffiliateUrl, getNeweggUrl } from './fps';

describe('getAmazonLink', () => {
  it('is fallback-search for a real part name, using the same URL getAffiliateUrl builds, and is genuinely sponsored', () => {
    const link = getAmazonLink('NVIDIA GeForce RTX 4090');
    expect(link.state).toBe('fallback-search');
    expect(link.href).toBe(getAffiliateUrl('NVIDIA GeForce RTX 4090'));
    expect(link.sponsored).toBe(true);
  });

  it('is unavailable for an empty or whitespace-only query, never a malformed search URL', () => {
    expect(getAmazonLink('')).toEqual({ state: 'unavailable', href: null, sponsored: false });
    expect(getAmazonLink('   ')).toEqual({ state: 'unavailable', href: null, sponsored: false });
  });

  it('has no exact-link path at all — Amazon carries no per-part tracked URL today', () => {
    // getAmazonLink's signature accepts only a query, never a tracked URL —
    // there is no argument that could produce an 'exact' state.
    expect(getAmazonLink.length).toBe(1);
  });
});

describe('getNeweggLink — a genuine exact product page', () => {
  it('is exact when the URL is a real Newegg product page, and never claims sponsorship it cannot verify', () => {
    const tracked = 'https://www.newegg.com/p/N82E16819113476';
    const link = getNeweggLink('AMD Ryzen 5 5600', tracked);
    expect(link).toEqual({ state: 'exact', href: tracked, sponsored: false });
  });

  it('stays exact when a redundant item= query parameter agrees with the path id (case-insensitively)', () => {
    const tracked = 'https://www.newegg.com/p/N82E16819113476?item=n82e16819113476';
    expect(getNeweggLink('AMD Ryzen 5 5600', tracked).state).toBe('exact');
  });

  it('never falls back to a search URL once a genuinely exact URL is present, even for an empty query', () => {
    const tracked = 'https://www.newegg.com/p/N82E16819113476';
    expect(getNeweggLink('', tracked)).toEqual({ state: 'exact', href: tracked, sponsored: false });
  });
});

describe('getNeweggLink — fail-closed rejection of an untrustworthy override', () => {
  // Regression coverage for the exact repro cases from #88's independent
  // review: a nonempty affiliateUrl override must never become 'exact'
  // unless its own shape unambiguously names one product page. Each of
  // these instead falls through to the generated fallback-search URL.
  const query = 'AMD Ryzen 5 5600';
  const fallbackHref = getNeweggUrl(query);

  it('rejects a search-results URL (the /p/pl shape) even though it is a real newegg.com link', () => {
    expect(getNeweggLink(query, 'https://www.newegg.com/p/pl?d=rtx+4090')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('rejects a URL on a domain that is not Newegg at all', () => {
    expect(getNeweggLink(query, 'https://example.com/not-newegg')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('rejects an unparseable/malformed URL string', () => {
    expect(getNeweggLink(query, 'not a url at all')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('rejects a plain non-https URL', () => {
    expect(getNeweggLink(query, 'http://www.newegg.com/p/N82E16819113476')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('rejects a product URL whose path id and query item id disagree — the shape of a swapped/corrupted link', () => {
    expect(getNeweggLink(query, 'https://www.newegg.com/p/N82E16819113476?item=N82E16814932765')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('rejects an unrecognized path shape (neither a product page nor the known search shape)', () => {
    expect(getNeweggLink(query, 'https://www.newegg.com/Info/HelpDesk')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('is unavailable for an empty query with no override', () => {
    expect(getNeweggLink('')).toEqual({ state: 'unavailable', href: null, sponsored: false });
    expect(getNeweggLink('  ')).toEqual({ state: 'unavailable', href: null, sponsored: false });
  });

  it('treats an empty-string override as absent, not as a rejected-but-present URL', () => {
    expect(getNeweggLink(query, '').state).toBe('fallback-search');
  });

  it('treats a whitespace-only override as absent', () => {
    expect(getNeweggLink(query, '   ').state).toBe('fallback-search');
  });
});
