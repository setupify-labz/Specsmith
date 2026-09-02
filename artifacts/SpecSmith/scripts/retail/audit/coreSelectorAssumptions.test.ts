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
    ['pages', 'Prebuilts.tsx'],
    ['pages', 'PrebuiltDetail.tsx'],
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
// above: they accept an optional `affiliateUrl` prop and route it through
// `getNeweggLink` (src/lib/retailerLinkState.ts), which classifies it and
// only ever treats it as the exact, preferred link when it independently
// verifies the URL as a real Newegg product page — never merely for being
// nonempty (see retailerLinkState.ts's own fail-closed shape checks, added
// after issue #88's independent review caught the earlier version of this
// PR trusting any nonempty override). `getAmazonLink`/`getNeweggLink` are
// `src/components/affiliateParts.test.ts`'s concern to lock down in detail;
// this guard only needs to know that BOTH components still route a truthy
// `affiliateUrl` into that classifier, and still hide the Amazon CTA only
// when Newegg's classification comes back `exact`. That routing is exactly
// why this audit's "always fallback-search" finding depends on Builder.tsx
// never actually HAVING a real affiliateUrl to pass — proven by the
// "canonical part catalogs never carry an affiliateUrl" block above. If any
// of these three files changed, that finding — which the PR for issue #85
// explicitly claims covers PartCard.tsx and BuildSummary.tsx — would go
// stale silently without this guard.
describe('the core-selector journey (Builder.tsx -> PartCard/BuildSummary) still cannot supply a real affiliateUrl', () => {
  it('PartCard.tsx routes affiliateUrl through the shared, fail-closed link classifier for both retailers', () => {
    const source = fs.readFileSync(path.join(componentsDir, 'PartCard.tsx'), 'utf-8');
    expect(source).toContain("from '../lib/retailerLinkState'");
    expect(source).toContain('getNeweggLink(query, affiliateUrl)');
    expect(source).toContain("neweggLink.state !== 'exact'");
  });

  it('BuildSummary.tsx routes affiliateUrl through the shared, fail-closed link classifier for both retailers', () => {
    const source = fs.readFileSync(path.join(componentsDir, 'BuildSummary.tsx'), 'utf-8');
    expect(source).toContain("from '../lib/retailerLinkState'");
    expect(source).toContain('getNeweggLink(query, p.affiliateUrl)');
    expect(source).toContain("neweggLink.state !== 'exact'");
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
