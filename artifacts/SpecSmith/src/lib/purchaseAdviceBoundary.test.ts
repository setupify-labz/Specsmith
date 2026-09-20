/**
 * Nothing the site renders may import the price-derived recommendation layer.
 *
 * SpecSmith used to tell people what to buy. The GPU upgrade guides (#119),
 * the CPU upgrade guides (#120) and the interactive calculators each named a
 * "best upgrade", ranked parts by net cost and cost per frame, badged one
 * "Best value", and estimated what the reader's part was worth used. All of it
 * rested on two numbers that cannot carry it: the prices in `gpus.json` and
 * `cpus.json` are editorial and are not checked against the live market, and
 * the resale figures are a flat percentage of one of those prices. Worse, the
 * candidate selectors take the CHEAPEST part in each tier before anything
 * sorts by modelled performance, so a price silently decided which parts a
 * reader was shown even where the page claimed otherwise.
 *
 * Three reviewed pull requests removed all of that from the product. The
 * functions themselves still exist, unreferenced, and that is the hazard this
 * file exists for: an unused export is an invitation. Re-importing
 * `getBestValueCpuCandidate` is a one-line change that would quietly undo a
 * decision made three times over, and nothing else in the suite would notice.
 *
 * The functions are deliberately NOT deleted here. Whether SpecSmith should
 * one day give purchase advice from CURRENT retailer prices is a product
 * decision, and the machinery is where it would start. This test draws the
 * boundary instead: keep them, keep them out of the product, and make crossing
 * the line fail loudly rather than silently.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..', '..');

/**
 * Exports that compute or rank on price, or that name a purchase.
 *
 * The ban covers names that no longer exist as well as names that do. Deleting
 * a function does not stop someone writing it again, and the point of the list
 * is the IDEA, not the current symbol table.
 */
const PURCHASE_ADVICE_EXPORTS = [
  // Resale: a flat percentage of an editorial price.
  'estimateResaleValue',
  'estimateCpuResaleValue',
  // Candidate selectors: cheapest-per-tier, so price decides membership.
  'getUpgradeCandidates',
  'getCpuUpgradeCandidates',
  // "Best value": lowest cost per modelled frame.
  'getBestValueCandidate',
  'getBestValueCpuCandidate',
  'getBetterValueBuild',
] as const;

/**
 * THE CLEANUP STOPPED HALFWAY, and this records where.
 *
 * The GPU side was carried through: `estimateResaleValue`,
 * `getUpgradeCandidates` and `getBestValueCandidate` are gone from
 * `upgradeCalculator.ts`. The CPU equivalents and the build-comparison
 * value verdict were left behind, unreferenced.
 *
 * Both lists are asserted, so this stays true rather than becoming a stale
 * comment: if the leftovers are removed, the test says so and the entry moves.
 */
const ALREADY_REMOVED = ['estimateResaleValue', 'getUpgradeCandidates', 'getBestValueCandidate'];
const STILL_DEFINED = ['estimateCpuResaleValue', 'getCpuUpgradeCandidates', 'getBestValueCpuCandidate', 'getBetterValueBuild'];

/** The modules that define them. They may reference their own exports. */
const DEFINING_MODULES = new Set([
  path.join('src', 'lib', 'upgradeCalculator.ts'),
  path.join('src', 'lib', 'cpuUpgradeCalculator.ts'),
  path.join('src', 'lib', 'compareValue.ts'),
]);

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__fixtures__') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
};

/** Every production source file the site or its scripts actually build from. */
const productionFiles = [
  ...walk(path.join(appRoot, 'src')),
  ...walk(path.join(appRoot, 'scripts')),
].filter((file) => !DEFINING_MODULES.has(path.relative(appRoot, file)));

/**
 * The names a file imports.
 *
 * Reads import statements rather than searching the whole file, so the doc
 * comments that explain why these functions were removed — which necessarily
 * name them — do not register as usage.
 */
function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const [, clause] of source.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const part of clause.split(',')) {
      const name = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('the product does not import purchase advice', () => {
  it('scans a real set of production files', () => {
    // Guards the guard: a walk that silently returned nothing would make every
    // assertion below vacuous.
    expect(productionFiles.length).toBeGreaterThan(100);
    expect(productionFiles.some((f) => f.endsWith(path.join('pages', 'CpuUpgradePage.tsx')))).toBe(true);
  });

  it.each(PURCHASE_ADVICE_EXPORTS)('no production file imports %s', (symbol) => {
    const importers = productionFiles
      .filter((file) => importedNames(fs.readFileSync(file, 'utf-8')).includes(symbol))
      .map((file) => path.relative(appRoot, file));
    expect(importers).toEqual([]);
  });

  it('records exactly which leftovers are still defined', () => {
    // Keeps the two lists honest. A green ban on a name nobody defines guards
    // nothing, and a leftover quietly deleted should show up here as progress
    // rather than pass unnoticed.
    const defined = [...DEFINING_MODULES]
      .map((rel) => fs.readFileSync(path.join(appRoot, rel), 'utf-8'))
      .join('\n');
    const isDefined = (symbol: string) =>
      new RegExp(`export\\s+(?:function|const)\\s+${symbol}\\b`).test(defined);

    expect(PURCHASE_ADVICE_EXPORTS.filter(isDefined).sort()).toEqual([...STILL_DEFINED].sort());
    expect(PURCHASE_ADVICE_EXPORTS.filter((s) => !isDefined(s)).sort()).toEqual([...ALREADY_REMOVED].sort());
  });

  it('keeps the guides and calculators free of price-derived figures on screen', () => {
    // The wording sits in the pages; this checks the four surfaces that used to
    // carry these figures still do not name them outside a disclaimer.
    const surfaces = [
      path.join('src', 'pages', 'GpuUpgradePage.tsx'),
      path.join('src', 'pages', 'CpuUpgradePage.tsx'),
      path.join('src', 'pages', 'UpgradeCalculator.tsx'),
      path.join('src', 'pages', 'UpgradeCalculatorCpu.tsx'),
    ];
    for (const rel of surfaces) {
      const source = fs.readFileSync(path.join(appRoot, rel), 'utf-8');
      // Comments explain what was removed and must be allowed to say so.
      const code = source
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      for (const banned of ['netCost', 'costPerFps', 'estimateResaleValue', 'estimateCpuResaleValue']) {
        expect(code, `${rel} still uses ${banned}`).not.toContain(banned);
      }
    }
  });
});
