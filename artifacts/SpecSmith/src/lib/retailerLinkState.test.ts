import { describe, expect, it } from 'vitest';
import { getAmazonLink, getNeweggLink } from './retailerLinkState';
import { getAffiliateUrl, getNeweggUrl } from './fps';

describe('getAmazonLink', () => {
  it('is fallback-search for a real part name, using the same URL getAffiliateUrl builds', () => {
    const link = getAmazonLink('NVIDIA GeForce RTX 4090');
    expect(link.state).toBe('fallback-search');
    expect(link.href).toBe(getAffiliateUrl('NVIDIA GeForce RTX 4090'));
  });

  it('is unavailable for an empty or whitespace-only query, never a malformed search URL', () => {
    expect(getAmazonLink('')).toEqual({ state: 'unavailable', href: null });
    expect(getAmazonLink('   ')).toEqual({ state: 'unavailable', href: null });
  });

  it('has no exact-link path at all — Amazon carries no per-part tracked URL today', () => {
    // getAmazonLink's signature accepts only a query, never a tracked URL —
    // there is no argument that could produce an 'exact' state.
    expect(getAmazonLink.length).toBe(1);
  });
});

describe('getNeweggLink', () => {
  it('is fallback-search when no tracked URL is supplied, using the same URL getNeweggUrl builds', () => {
    const link = getNeweggLink('AMD Ryzen 5 5600');
    expect(link.state).toBe('fallback-search');
    expect(link.href).toBe(getNeweggUrl('AMD Ryzen 5 5600'));
  });

  it('is exact when the caller supplies its own tracked URL, and returns that URL unchanged', () => {
    const tracked = 'https://www.newegg.com/p/N82E16819113476?item=N82E16819113476&aid=example';
    const link = getNeweggLink('AMD Ryzen 5 5600', tracked);
    expect(link).toEqual({ state: 'exact', href: tracked });
  });

  it('never falls back to a search URL once a tracked URL is present, even for an empty query', () => {
    const tracked = 'https://www.newegg.com/p/N82E16819113476?item=N82E16819113476';
    expect(getNeweggLink('', tracked)).toEqual({ state: 'exact', href: tracked });
  });

  it('is unavailable for an empty query with no tracked URL', () => {
    expect(getNeweggLink('')).toEqual({ state: 'unavailable', href: null });
    expect(getNeweggLink('  ')).toEqual({ state: 'unavailable', href: null });
  });

  it('treats an empty-string tracked URL as absent, not as a real destination', () => {
    expect(getNeweggLink('AMD Ryzen 5 5600', '').state).toBe('fallback-search');
  });
});
