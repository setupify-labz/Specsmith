import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => fs.readFileSync(path.join(here, file), 'utf-8');

describe('affiliate catalog builder integration', () => {
  it('loads the browser-safe catalog and routes all twelve categories into selectors', () => {
    const builder = read('../pages/Builder.tsx');
    expect(builder).toContain('useAffiliatePartCatalog()');
    expect(builder).toContain('affiliateCatalog.catalog.parts');
    for (const list of [
      'builderGpus', 'builderCpus', 'builderMotherboards', 'builderRam',
      'builderStorage', 'builderPsus', 'builderCases', 'builderCoolers',
      'builderMonitors', 'builderKeyboards', 'builderMice', 'builderHeadsets',
    ]) {
      expect(builder).toContain(`parts={${list}}`);
    }
  });

  it('routes both retailer CTAs through the shared link-integrity classifier, never a re-derived URL', () => {
    const card = read('PartCard.tsx');
    const summary = read('BuildSummary.tsx');
    for (const source of [card, summary]) {
      expect(source).toContain("from '../lib/retailerLinkState'");
      expect(source).toContain('getAmazonLink(');
      expect(source).toContain('getNeweggLink(');
      // The exact-link path is real only when the caller's own tracked URL
      // is passed through — never re-derived from a search-URL builder.
      expect(source).not.toMatch(/getNeweggLink\([^)]*getNeweggUrl/);
    }
  });

  it('keeps a clear search-is-not-exact disclosure next to links, and never claims an unverified commission', () => {
    const selector = read('PartSelector.tsx');
    const summary = read('BuildSummary.tsx');
    for (const source of [selector, summary]) {
      expect(source).toContain('a retailer search, not the exact product');
      // Neither getAmazonLink nor getNeweggLink can currently mark a link
      // sponsored (see retailerLinkState.ts) — an "SpecSmith may earn a
      // commission" claim here would be false today.
      expect(source).not.toContain('may earn a commission');
    }
  });

  it('does not claim an unverified Amazon Associates relationship in the global footer', () => {
    const footer = read('Footer.tsx');
    expect(footer).not.toContain('As an Amazon Associate');
    expect(footer).not.toContain('earns from qualifying purchases');
    expect(footer).toContain('Confirm the exact model, current price, and availability');
  });

  it('labels unreported prices and excludes them from the displayed subtotal', () => {
    const summary = read('BuildSummary.tsx');
    const builder = read('../pages/Builder.tsx');
    expect(summary).toContain("'Retailer price'");
    expect(summary).toContain("'Estimated known-price subtotal'");
    expect(builder).toContain('(p.price ?? 0)');
  });
});
