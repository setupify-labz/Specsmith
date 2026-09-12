// Guards the one assumption `coreSelectorLinkAudit.ts` depends on and cannot
// check for itself at runtime: that no canonical part record carries a real
// `affiliateUrl`, and that the pages calling `getAffiliateUrl`/`getNeweggUrl`
// still do so unconditionally for a canonical part.
//
// If either changes — a canonical record gains a real affiliate link, or a
// page starts preferring one — the core-selector audit's "always
// fallback-search" finding would go stale silently. These tests fail loudly
// instead, the same role `src/components/affiliateParts.test.ts` already
// plays for `PartCard`'s own fallback branch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const dataDir = path.join(appRoot, 'src', 'data');
const pagesDir = path.join(appRoot, 'src', 'pages');
const componentsDir = path.join(appRoot, 'src', 'components');

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
}

function allRecords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null) return Object.values(raw as Record<string, unknown>).flatMap(allRecords);
  return [];
}

describe('canonical part catalogs never carry an affiliateUrl', () => {
  it.each(['gpus.json', 'cpus.json', 'components.json', 'peripherals.json'])('%s', (file) => {
    const records = allRecords(readJson(file));
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record).not.toHaveProperty('affiliateUrl');
    }
  });
});

describe('every core-selector page still calls the gated fallback-link builders unconditionally', () => {
  const pages = [
    ['pages', 'GpuMatchup.tsx'],
    ['pages', 'CpuMatchup.tsx'],
    ['pages', 'BestCpuForGame.tsx'],
    ['pages', 'BestGpuForGame.tsx'],
    ['pages', 'BestMotherboardPage.tsx'],
    ['pages', 'BudgetPartPage.tsx'],
    ['pages', 'ComponentGuidePage.tsx'],
    // Prebuilts.tsx and PrebuiltDetail.tsx are deliberately ABSENT. They no
    // longer build a retailer link of any kind — see the block below, which
    // holds them to that instead. Leaving them here would have asserted the
    // opposite of what they are now required to do.
    ['pages', 'SharedBuild.tsx'],
    ['pages', 'UseCaseBuildPage.tsx'],
    ['components', 'QuizFlow.tsx'],
  ] as const;

  it.each(pages)('%s/%s', (dir, file) => {
    const root = dir === 'pages' ? pagesDir : componentsDir;
    const source = fs.readFileSync(path.join(root, file), 'utf-8');
    expect(source).toContain('getAffiliateUrl');
    expect(source).toContain('getNeweggUrl');
    // Neither an affiliateUrl-first ternary (`affiliateUrl ??`) nor a raw
    // amazon.com/newegg.com literal — either would mean this page can build a
    // link `coreSelectorLinkAudit.ts` does not already model.
    expect(source).not.toMatch(/affiliateUrl\s*\?\?/);
    expect(source).not.toMatch(/https?:\/\/(www\.)?(amazon|newegg)\.com/);
  });
});

// PartCard.tsx and BuildSummary.tsx take a DIFFERENT shape than the pages
// above: they accept an optional `affiliateUrl` prop and prefer it when
// present (`affiliateUrl ?? getNeweggUrl(...)`) — the same conditional
// `src/components/affiliateParts.test.ts` already locks down for PartCard.
// That conditional is exactly why this audit's "always fallback-search"
// finding depends on Builder.tsx never actually HAVING a real affiliateUrl to
// pass — proven by the "canonical part catalogs never carry an affiliateUrl"
// block above. If any of these three files changed, that finding — which the
// PR for issue #85 explicitly claims covers PartCard.tsx and BuildSummary.tsx
// — would go stale silently without this guard.
describe('the core-selector journey (Builder.tsx -> PartCard/BuildSummary) still cannot supply a real affiliateUrl', () => {
  it('PartCard.tsx keeps its affiliateUrl-first conditional for both retailers', () => {
    const source = fs.readFileSync(path.join(componentsDir, 'PartCard.tsx'), 'utf-8');
    expect(source).toContain('!affiliateUrl &&');
    expect(source).toContain('href={affiliateUrl ?? getNeweggUrl(query)}');
  });

  it('BuildSummary.tsx keeps its affiliateUrl-first conditional for both retailers', () => {
    const source = fs.readFileSync(path.join(componentsDir, 'BuildSummary.tsx'), 'utf-8');
    expect(source).toContain('!p.affiliateUrl &&');
    expect(source).toMatch(/href=\{p\.affiliateUrl \?\? getNeweggUrl\(/);
  });

  it("Builder.tsx reads affiliateUrl straight off the canonical part object, with no other source merged in", () => {
    const source = fs.readFileSync(path.join(pagesDir, 'Builder.tsx'), 'utf-8');
    // Every selected-part entry passes `affiliateUrl: selectedX.affiliateUrl`
    // — a field the canonical JSON never has (see above) — and nothing in
    // this file reads `retail-parts.json`/`AffiliatePart` data to backfill one.
    expect(source).toMatch(/affiliateUrl:\s*selected\w+\.affiliateUrl/);
    expect(source).not.toContain('retail-parts.json');
    expect(source).not.toMatch(/AFFILIATE_PART_CATALOG_URL/);
  });
});

// THE BUILD GUIDES ARE THE EXCEPTION, AND MUST STAY ONE.
//
// Every page in the list above still hands a shopper a retailer SEARCH when
// it has no exact listing, and the audit models that. The two build-guide
// pages used to do the same, under labels that read "Buy on Amazon" and "Buy
// on Newegg" — a promise a search results page cannot keep. They now offer a
// single action into the Builder's catalogue, where a category holds exact
// SKUs with observed prices, images, timestamps and tracked direct links.
//
// This guard is the mirror image of the one above: if a search link ever
// reappears on a guide page, the audit's page list would silently stop
// covering a surface that builds one.
describe('the build guides build no retailer link at all', () => {
  it.each([['Prebuilts.tsx'], ['PrebuiltDetail.tsx']])('%s', (file) => {
    const source = fs.readFileSync(path.join(pagesDir, file), 'utf-8');
    // No link builders, and no hand-rolled retailer URL either.
    expect(source).not.toMatch(/\bgetAffiliateUrl\b/);
    expect(source).not.toMatch(/\bgetNeweggUrl\b/);
    expect(source).not.toMatch(/https?:\/\/(www\.)?(amazon|newegg)\.com/);
    // And never the Associates tag for the account that was never approved.
    expect(source).not.toContain('AMAZON_AFFILIATE_TAG');
    expect(source).not.toContain('specsmithpc-20');
  });
});
