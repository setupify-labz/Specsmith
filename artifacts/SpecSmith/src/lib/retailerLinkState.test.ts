import { describe, expect, it } from 'vitest';
import { getAmazonLink, getNeweggLink } from './retailerLinkState';
import { getAffiliateUrl, getNeweggUrl } from './fps';

describe('getAmazonLink', () => {
  it('is fallback-search for a real part name, using the same URL getAffiliateUrl builds, and is honest about not being sponsored', () => {
    // AMAZON_AFFILIATE_TAG (fps.ts) is a placeholder pending Amazon
    // Associates approval — a constructed tag is not evidence of an owned,
    // live revenue relationship, so this must not claim sponsored: true.
    const link = getAmazonLink('NVIDIA GeForce RTX 4090');
    expect(link.state).toBe('fallback-search');
    expect(link.href).toBe(getAffiliateUrl('NVIDIA GeForce RTX 4090'));
    expect(link.sponsored).toBe(false);
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

describe('getNeweggLink — fails closed to fallback-search, even for a well-shaped product URL', () => {
  // Regression coverage for #88's round-2 independent review: a URL whose
  // shape unambiguously names *a* Newegg product page is still not
  // evidence it names the *intended* part — a valid-shaped id for the
  // wrong product would announce itself as "the exact product page" with
  // nothing here to catch it. This canonical/primary-builder path has no
  // independently-verified part-to-item-id binding today, so every one of
  // these must fall through to the generated fallback-search URL, not just
  // the previously-rejected malformed/wrong-domain/search-shaped cases.
  const query = 'AMD Ryzen 5 5600';
  const fallbackHref = getNeweggUrl(query);

  it('does not trust an otherwise well-shaped, single-product Newegg URL', () => {
    expect(getNeweggLink(query, 'https://www.newegg.com/p/N82E16819113476')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

  it('does not trust a well-shaped URL even when a redundant item= query id agrees with the path id', () => {
    expect(getNeweggLink(query, 'https://www.newegg.com/p/N82E16819113476?item=n82e16819113476')).toEqual({
      state: 'fallback-search', href: fallbackHref, sponsored: false,
    });
  });

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

  it('is unavailable for an empty query with no override, and stays unavailable even with a well-shaped override', () => {
    expect(getNeweggLink('')).toEqual({ state: 'unavailable', href: null, sponsored: false });
    expect(getNeweggLink('  ')).toEqual({ state: 'unavailable', href: null, sponsored: false });
    expect(getNeweggLink('', 'https://www.newegg.com/p/N82E16819113476')).toEqual({
      state: 'unavailable', href: null, sponsored: false,
    });
  });

  it('treats an empty-string override as absent, not as a rejected-but-present URL', () => {
    expect(getNeweggLink(query, '').state).toBe('fallback-search');
  });

  it('treats a whitespace-only override as absent', () => {
    expect(getNeweggLink(query, '   ').state).toBe('fallback-search');
  });

  it('never returns exact — there is no per-part identity binding to verify against in this component tier', () => {
    // Guards against a regression that resurrects #88's round-2 trust bug:
    // no argument combination may currently produce state: 'exact'.
    const overrides = [undefined, '', 'https://www.newegg.com/p/N82E16819113476'];
    for (const override of overrides) {
      expect(getNeweggLink(query, override).state).not.toBe('exact');
    }
  });
});
