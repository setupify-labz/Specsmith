import { describe, expect, it } from 'vitest';
import { buildGoogleRequestQueue, parseSitemap, selectIndexNowUrls } from './core';

describe('parseSitemap', () => {
  it('deduplicates canonical SpecSmith URLs', () => {
    expect(parseSitemap('<loc>https://specsmithpc.com/</loc><loc>https://specsmithpc.com/</loc>')).toEqual([
      'https://specsmithpc.com/',
    ]);
  });

  it('refuses URLs outside the verified host or carrying query state', () => {
    expect(() => parseSitemap('<loc>https://example.com/</loc>')).toThrow('outside');
    expect(() => parseSitemap('<loc>https://specsmithpc.com/builder?x=1</loc>')).toThrow('non-canonical');
  });
});

describe('buildGoogleRequestQueue', () => {
  it('excludes indexed pages, separates technical failures, and prioritizes useful pages', () => {
    const base = { indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL', robotsTxtState: 'ALLOWED' };
    const result = buildGoogleRequestQueue([
      { ...base, url: 'https://specsmithpc.com/', verdict: 'PASS', coverageState: 'Submitted and indexed' },
      { ...base, url: 'https://specsmithpc.com/builder', verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' },
      { ...base, url: 'https://specsmithpc.com/upgrade/rx-6600', verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' },
      { ...base, robotsTxtState: 'BLOCKED', url: 'https://specsmithpc.com/bad', verdict: 'FAIL', coverageState: 'Blocked by robots.txt' },
      { ...base, userCanonical: 'https://specsmithpc.com/right', googleCanonical: 'https://specsmithpc.com/wrong', url: 'https://specsmithpc.com/right', verdict: 'FAIL', coverageState: 'Alternate page' },
    ], new Map([
      ['https://specsmithpc.com/upgrade/rx-6600', { clicks: 1, impressions: 30, ctr: 0.03, position: 3 }],
    ]), 10);

    expect(result.indexedCount).toBe(1);
    expect(result.requestQueue.map((item) => item.url)).toEqual([
      'https://specsmithpc.com/builder',
      'https://specsmithpc.com/upgrade/rx-6600',
    ]);
    expect(result.needsFix.map((item) => item.url)).toEqual([
      'https://specsmithpc.com/bad',
      'https://specsmithpc.com/right',
    ]);
  });
});

describe('selectIndexNowUrls', () => {
  const urls = [
    'https://specsmithpc.com/',
    'https://specsmithpc.com/builder',
    'https://specsmithpc.com/upgrade',
    'https://specsmithpc.com/upgrade/rx-6600',
    'https://specsmithpc.com/about',
  ];

  it('always includes newly-added sitemap URLs', () => {
    expect(selectIndexNowUrls(urls, urls.slice(0, -1), [])).toEqual(['https://specsmithpc.com/about']);
  });

  it('maps a shared upgrade template to its hub and detail pages', () => {
    expect(selectIndexNowUrls(urls, urls, ['artifacts/SpecSmith/src/pages/GpuUpgradePage.tsx'])).toEqual([
      'https://specsmithpc.com/upgrade',
      'https://specsmithpc.com/upgrade/rx-6600',
    ]);
  });

  it('treats route and SEO registry changes as site-wide', () => {
    expect(selectIndexNowUrls(urls, urls, ['artifacts/SpecSmith/src/entry-server.tsx'])).toEqual(urls);
    expect(selectIndexNowUrls(urls, urls, ['artifacts/SpecSmith/scripts/prerender.mjs'])).toEqual(urls);
    expect(selectIndexNowUrls(urls, urls, ['artifacts/SpecSmith/src/lib/fps.ts'])).toEqual(urls);
  });
});
