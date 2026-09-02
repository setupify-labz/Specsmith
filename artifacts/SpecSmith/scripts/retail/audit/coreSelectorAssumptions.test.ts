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
