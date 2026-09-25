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

  it('uses a validated tracked URL directly and never replaces it with a search URL', () => {
    const card = read('PartCard.tsx');
    expect(card).toContain('href={affiliateUrl ?? getNeweggUrl(query)}');
    expect(card).toContain("rel={affiliateUrl ? 'noopener noreferrer sponsored'");
    expect(card).toContain('{!affiliateUrl && (');
    expect(card).toContain('View at Newegg');
  });

  it('keeps a clear affiliate disclosure next to links in both selection and summary views', () => {
    const selector = read('PartSelector.tsx');
    const summary = read('BuildSummary.tsx');
    for (const source of [selector, summary]) {
      expect(source).toContain('Affiliate disclosure:');
      expect(source).toContain('may earn a commission');
    }
  });

  it('labels unreported prices and excludes them from the displayed subtotal', () => {
    // #156 moved the wording into one typed summary (partPrice.ts): a row with
    // no usable figure says so, is named, and turns the total into a subtotal.
    // The behaviour is rendered in partPriceProvenance.test.tsx; this pins
    // that both surfaces still go through it.
    const summary = read('BuildSummary.tsx');
    const builder = read('../pages/Builder.tsx');
    const pricing = read('../lib/partPrice.ts');
    expect(summary).toContain('describeSummaryPrice(p.price)');
    expect(summary).toContain('summarizeSummaryPrices(parts)');
    expect(builder).toContain('summarizeSummaryPrices(summaryParts).amount');
    expect(pricing).toContain("'Known-price subtotal'");
    expect(pricing).toContain("(no catalogue price)");
    expect(pricing).toContain("export const NO_PRICE_LABEL = 'Price at retailer';");
  });
});
