// The test that matters most in this file is the one asserting NOTHING HAPPENS.
//
// Four classes of listing in run 35275594594 are questionable but not
// defective: legacy memory, OEM-proprietary boards, low-wattage supplies and
// prices far out of line with the listing's own specification. Aaron asked for
// them to be reported and NOT silently filtered, because whether a gaming-PC
// catalogue carries them is a product-scope decision.
//
// So the first describe block below asserts the absence of a decision three
// ways: the reporter leaves its input untouched, every SKU it flags is still
// in the selected set, and the module exports nothing shaped like the
// `screen…` functions the two gates beside it export. A fourth test puts each
// flagged title through both gates and shows it survives — these listings
// reach publication, which is precisely why the question has to be asked of a
// person rather than answered here.
//
// The fixtures are the same verbatim run rows as the gate's, and the
// thresholds the reporter uses are SpecSmith's own choices rather than
// industry facts. Two tests pin the margin between a flagged row and the
// nearest legitimate one, so a later change to either number has to face what
// it costs.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import fixture from './__fixtures__/dry-run-35275594594.json';
import { completeProductVerdict } from './completeProductGate';
import { consumerProductVerdict } from './consumerProductGate';
import {
  EXTREME_UNIT_PRICE_MULTIPLE,
  effectivePriceUsd,
  extremeUnitPriceFindings,
  isLegacyRam,
  isLowWattagePsu,
  isOemProprietaryBoard,
  reportProductScope,
  statedGigabytes,
  statedWatts,
  summariseProductScope,
  type ScopeCandidate,
  type ScopeFlag,
} from './productScopeReport';

/** The fixture's full shape: both prices, plus the effective one derived here. */
type FixtureRow = ScopeCandidate & { retailPrice: number; salePrice: number | null };

const SELECTED = fixture.selected as FixtureRow[];
const FINDINGS = reportProductScope(SELECTED);

/** The same rows with the raw list price in the slot the report reads. */
const AT_LIST_PRICE: FixtureRow[] = SELECTED.map((candidate) => ({
  ...candidate,
  priceUsd: candidate.retailPrice,
}));

const skusFor = (flag: ScopeFlag): string[] =>
  FINDINGS.filter((finding) => finding.flag === flag).map((finding) => finding.sku).sort();

const row = (sku: string): ScopeCandidate => {
  const found = SELECTED.find((candidate) => candidate.sku === sku);
  if (found === undefined) throw new Error(`No selected listing with SKU ${sku} in the run-35275594594 fixture`);
  return found;
};

const lower = (sku: string): string => row(sku).name.toLowerCase();

describe('the fixture prices what a shopper pays, not what is struck through', () => {
  // AN INDEPENDENT REVIEW FOUND THIS, AND THE OLD TESTS COULD NOT HAVE.
  //
  // The generator passes `salePrice ?? retailPrice` into the reporter, and the
  // first fixture carried raw `retailPrice`. So the unit-price medians these
  // tests asserted on were computed from prices no shopper would be charged,
  // and every assertion still passed — because none of the 26 flagged rows
  // happens to be discounted, so the one identity check the suite had
  // (`finding.priceUsd === listing.retailPrice`) was true by coincidence.
  //
  // A coincidence is not a guard. These tests fail on the mismatch itself,
  // independently of whether it currently moves a finding.

  it('derives every row through the same function the generator uses', () => {
    // `effectivePriceUsd` is exported and called on both sides. A fixture
    // regenerated with a hand-written rule that drifts from it fails here.
    for (const candidate of SELECTED) {
      expect(candidate.priceUsd, candidate.sku).toBe(effectivePriceUsd(candidate));
    }
  });

  it('keeps both prices so the derivation is checkable, not merely asserted', () => {
    for (const candidate of SELECTED) {
      expect(typeof candidate.retailPrice, candidate.sku).toBe('number');
      expect(candidate.retailPrice).toBeGreaterThan(0);
      expect(candidate.salePrice === null || typeof candidate.salePrice === 'number', candidate.sku).toBe(true);
      if (candidate.salePrice !== null) expect(candidate.salePrice).toBeLessThan(candidate.retailPrice);
    }
  });

  it('actually contains discounted rows, so none of this is vacuous', () => {
    // The number that made the defect invisible. If a future regeneration
    // dropped sale prices entirely, every check above would pass on a fixture
    // that had quietly become the buggy one again.
    const discounted = SELECTED.filter((candidate) => candidate.salePrice !== null);
    expect(discounted).toHaveLength(130);
    for (const candidate of discounted) expect(candidate.priceUsd).toBeLessThan(candidate.retailPrice);
  });

  it('is discounted in both categories the price test measures', () => {
    // `psu` and `ram` are the only categories whose unit price is computed, so
    // they are the only ones where the mismatch can move a median. Both must
    // carry discounted rows or the observability test below proves nothing.
    for (const category of ['psu', 'ram'] as const) {
      const discounted = SELECTED.filter(
        (candidate) => candidate.category === category && candidate.salePrice !== null,
      );
      expect(discounted.length, category).toBeGreaterThan(0);
    }
  });

  it('the choice of price is OBSERVABLE — the medians differ', () => {
    // The test that would have gone red on the original fixture. It asserts
    // the two price views are not interchangeable, so a report built from the
    // wrong one is a different report even when the flag set is unchanged.
    const ramMedian = (rows: readonly FixtureRow[]): number => {
      const perGb = rows
        .filter((candidate) => candidate.category === 'ram')
        .map((candidate) => {
          const gb = statedGigabytes(candidate.name.toLowerCase());
          return gb === null || gb <= 0 ? null : candidate.priceUsd / gb;
        })
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      return perGb[Math.floor(perGb.length / 2)];
    };

    expect(ramMedian(SELECTED)).toBeCloseTo(20.31, 2);
    expect(ramMedian(AT_LIST_PRICE)).toBeCloseTo(20.62, 2);
    expect(ramMedian(SELECTED)).toBeLessThan(ramMedian(AT_LIST_PRICE));
  });

  it('reports the effective price in the detail string, so a reviewer sees it', () => {
    // The 128 MB stick is not discounted, but the median it is measured
    // against moved, and the multiple printed beside it moved with it.
    const stick = FINDINGS.find(
      (finding) => finding.sku === '9SIAE9A8TV4830' && finding.flag === 'extreme-unit-price',
    );
    expect(stick?.detail).toContain('$20.31/GB');
    expect(stick?.detail).toContain('7.4x');
  });

  it('the generator computes the price through effectivePriceUsd, not by hand', () => {
    // A structural guard, because this is the one seam a unit test cannot
    // reach: the reporter is correct in isolation and the fixture is correct
    // in isolation, and the defect lived in how the generator joined them.
    const source = readFileSync(new URL('./generate-affiliate-catalog.ts', import.meta.url), 'utf-8');
    expect(source).toContain('priceUsd: effectivePriceUsd(part)');
    expect(source).not.toMatch(/priceUsd:\s*part\.retailPrice/);
    expect(source).not.toMatch(/retailPrice:\s*part\.salePrice/);
  });

  it('the report has no field a caller could confuse for a list price', () => {
    // `ScopeCandidate.retailPrice` was the defect's hiding place: it matched
    // `AffiliatePart.retailPrice` by name, so assigning the wrong one across
    // produced no type error. Renaming it to `priceUsd` is the fix, and this
    // keeps the name from coming back.
    const source = readFileSync(new URL('./productScopeReport.ts', import.meta.url), 'utf-8');
    const shape = source.slice(source.indexOf('export interface ScopeCandidate'));
    expect(shape.slice(0, shape.indexOf('}'))).not.toContain('retailPrice');
  });
});

describe('nothing is filtered — this is a report', () => {
  it('returns findings and leaves the input untouched', () => {
    const before = SELECTED.map((candidate) => candidate.sku);
    reportProductScope(SELECTED);
    expect(SELECTED.map((candidate) => candidate.sku)).toEqual(before);
    expect(SELECTED).toHaveLength(500);
  });

  it('flags listings that are still in the selected set', () => {
    // The point of the whole module: every flagged SKU WAS published. A
    // finding is a question about a live row, not an obituary for a dropped
    // one.
    const selectedSkus = new Set(SELECTED.map((candidate) => candidate.sku));
    expect(FINDINGS.length).toBeGreaterThan(0);
    for (const finding of FINDINGS) expect(selectedSkus.has(finding.sku), finding.sku).toBe(true);
  });

  it('every flagged listing passes both gates and reaches publication', () => {
    // Not rejected, not quietly dropped — published. A scope question is about
    // a row a shopper can buy today, and if either gate already removed it
    // there would be nothing left to decide.
    for (const finding of FINDINGS) {
      const listing = row(finding.sku);
      expect(consumerProductVerdict(listing.category, listing.name), listing.name).toEqual({ ok: true });
      expect(completeProductVerdict(listing.category, listing.name), listing.name).toEqual({ ok: true });
    }
  });

  it('exports no screening function, unlike the gates beside it', async () => {
    // Enforced rather than documented. `screenConsumerProducts` and
    // `screenCompleteProducts` both return a `kept` array; a function shaped
    // like that appearing here would mean this file had started deciding.
    const module = await import('./productScopeReport');
    for (const name of Object.keys(module)) expect(name).not.toMatch(/^screen/);
  });
});

describe('legacy memory', () => {
  it('reports all nine selected legacy modules', () => {
    expect(skusFor('legacy-ram')).toEqual([
      '9SIAAFJ41E4242',
      '9SIAAFJ41E4647',
      '9SIAAFJ41E5300',
      '9SIAAFJ4GW6966',
      '9SIAAFJ4GW7147',
      '9SIAAFJ4GW7300',
      '9SIAAFJ6S90741',
      '9SIAE9A8TV4830',
      '9SIAWKTKTU5396',
    ]);
  });

  it('reads the capacity the title states, down to a 128 MB stick', () => {
    expect(statedGigabytes(lower('9SIAE9A8TV4830'))).toBeCloseTo(0.125, 5);
    expect(statedGigabytes(lower('9SIAAFJ41E4242'))).toBe(2);
    expect(statedGigabytes('corsair vengeance 64gb 2 x 32gb ddr5 6400')).toBe(64);
  });

  it('reports the Samsung module because the title identifies nothing at all', () => {
    // No generation, no capacity, no speed. A beginner cannot tell what it is,
    // which is its own reason to ask rather than a gap in the generation list.
    const finding = FINDINGS.find((entry) => entry.sku === '9SIAWKTKTU5396');
    expect(row('9SIAWKTKTU5396').name).toBe('SAMSUNG M378B5173Cb0-Ck0 Memory For Desktop Memory-M378B5173Cb0-Ck0');
    expect(finding?.detail).toBe('no DDR generation or capacity stated');
  });

  it('leaves every DDR4 and DDR5 kit in the run unreported', () => {
    // 45 memory listings were selected and 9 are legacy. The other 36 are
    // ordinary purchases and must not appear.
    const memory = SELECTED.filter((candidate) => candidate.category === 'ram');
    expect(memory).toHaveLength(45);
    const reported = new Set(skusFor('legacy-ram'));
    for (const candidate of memory) {
      if (reported.has(candidate.sku)) continue;
      expect(isLegacyRam(candidate.name.toLowerCase()), candidate.name).toBe(false);
    }
    expect(isLegacyRam('g. skill trident z5 rgb series 32gb 2 x 16gb ddr5 6000 pc5 48000')).toBe(false);
    expect(isLegacyRam('hyperx predator 128gb 8 x 16gb ddr4 3000mhz cl15 1.35v black dimm')).toBe(false);
  });
});

describe('OEM-proprietary motherboards', () => {
  it('reports all six selected OEM replacement boards', () => {
    expect(skusFor('oem-proprietary-motherboard')).toEqual([
      '9SIAGUZKG99228',
      '9SIBT5SKME3318',
      '9SIBT5SKME3325',
      '9SIBT5SM0Z2557',
      '9SIC6J1KVX0070',
      '9SIC6J1KVX3470',
    ]);
  });

  it('they are the six cheapest real boards in the catalogue', () => {
    // Which is why selection took them: nothing about them is broken, they
    // are simply unusable outside the one chassis they were made for.
    const boards = SELECTED.filter((candidate) => candidate.category === 'motherboard')
      .filter((candidate) => !/tpm|programmer/i.test(candidate.name))
      .sort((a, b) => a.retailPrice - b.retailPrice);
    expect(boards.slice(0, 6).map((candidate) => candidate.sku).sort()).toEqual(skusFor('oem-proprietary-motherboard'));
  });

  it('needs both an OEM and one of its system families', () => {
    // "Dell" alone rides on legitimate retail parts — a Dell-branded memory
    // module is in the same run — and a family name alone is too generic.
    expect(isOemProprietaryBoard('16gb ram replacement for dell ab883074 snpk7g24c/16g ddr5 4800mhz')).toBe(false);
    expect(isOemProprietaryBoard('asus prime b550m-a ac motherboard socket am4')).toBe(false);
    expect(isOemProprietaryBoard('dell optiplex 5070 sff intel chipset q370 socket lga1151 motherboard')).toBe(true);
  });

  it('leaves the 39 retail boards in the run unreported', () => {
    const boards = SELECTED.filter((candidate) => candidate.category === 'motherboard');
    expect(boards).toHaveLength(45);
    const reported = new Set(skusFor('oem-proprietary-motherboard'));
    expect(boards.filter((candidate) => !reported.has(candidate.sku))).toHaveLength(39);
    for (const sku of ['9SIC70UKZA6987', '9SIC6E1M4K7626', '9SIBP4YM3E6389']) {
      expect(isOemProprietaryBoard(lower(sku)), sku).toBe(false);
    }
  });
});

describe('low-wattage supplies', () => {
  it('reports all six selected supplies below the floor', () => {
    expect(skusFor('low-wattage-psu')).toEqual([
      '9SIAKRCA5A4244',
      '9SIB66RK698428',
      '9SIB66RK698513',
      '9SIB66RK699001',
      '9SIBZT2KGK5661',
      '9SIC6VHM4Y2376',
    ]);
  });

  it('reads the rating past a model number and past a trailing rail figure', () => {
    // "JBON 600WS Power Supply 500W" — the 600 is part of the model name, and
    // `\bw\b` declines it. "SAMA B650 650W ... (450W)" — the 450 is the GPU
    // rail, and first-match declines it. Both are real selected titles, and
    // both would be misreported by a looser pattern.
    expect(statedWatts(lower('9SIBZT7KT40900'))).toBe(500);
    expect(statedWatts(lower('9SIB41TKTE2561'))).toBe(650);
    expect(statedWatts('b-vigor 550w atx power supply')).toBe(550);
    expect(statedWatts('corsair rm series fully modular atx power supply')).toBe(null);
  });

  it('leaves the 450 W Silverstone SFX unreported — it sits exactly on the floor', () => {
    // The nearest legitimate unit, and the margin the SpecSmith-defined floor
    // buys. Lowering the floor below 450 costs nothing; raising it starts
    // reporting real retail supplies.
    const silverstone = row('9SIC2ZPKVM2562');
    expect(statedWatts(silverstone.name.toLowerCase())).toBe(450);
    expect(isLowWattagePsu(silverstone.name.toLowerCase())).toBe(false);
  });

  it('reports nothing when the title states no wattage', () => {
    // Guessing is the error this codebase keeps correcting. An unstated
    // rating is a different gap, not a low one.
    expect(isLowWattagePsu('corsair rm series fully modular atx power supply')).toBe(false);
  });
});

describe('prices out of line with the listing\'s own specification', () => {
  it('reports the four OEM supplies and the 128 MB stick, and nothing else', () => {
    expect(skusFor('extreme-unit-price')).toEqual([
      '9SIAE9A8TV4830',
      '9SIB66RK698428',
      '9SIB66RK698513',
      '9SIB66RK699001',
      '9SIBZT2KGK5661',
    ]);
  });

  it('shows the measurement, the reference and that the threshold is ours', () => {
    const finding = FINDINGS.find(
      (entry) => entry.sku === '9SIBZT2KGK5661' && entry.flag === 'extreme-unit-price',
    );
    expect(finding?.detail).toContain('$1.49/W');
    expect(finding?.detail).toContain('5.0x');
    expect(finding?.detail).toContain('SpecSmith-defined threshold');
  });

  it('does NOT report the $333.62 replacement modules, because they are the median', () => {
    // THE FINDING, not a gap in the rule. Seven "16GB RAM Replacement for ..."
    // modules sit at $20.85/GB against a category median of $20.62/GB. The
    // whole memory category in this feed is priced at roughly $20/GB, and the
    // $1299 128 GB HyperX kit is BELOW it at $10.15/GB. Whether that is the
    // market or the feed is the question the report hands over; it is not one
    // an outlier test on this run's own prices can answer.
    const replacements = SELECTED.filter((candidate) => /^16GB RAM Replacement for/.test(candidate.name));
    expect(replacements).toHaveLength(7);
    for (const candidate of replacements) expect(candidate.retailPrice).toBe(333.62);
    const reported = new Set(skusFor('extreme-unit-price'));
    for (const candidate of replacements) expect(reported.has(candidate.sku), candidate.sku).toBe(false);
    expect(reported.has('9SIC7PVM6D3863')).toBe(false);
  });

  it('measures only categories whose titles state the unit', () => {
    // A GPU title states no quantity the price divides by, so no outlier claim
    // is made about GPUs — including the $5,999.99 RTX 5090, which is the
    // dearest listing in the run and entirely legitimate.
    const measured = new Set(extremeUnitPriceFindings(SELECTED).map((finding) => finding.category));
    for (const category of measured) expect(['psu', 'ram']).toContain(category);
    expect(skusFor('extreme-unit-price')).not.toContain('N82E16814932763');
  });

  it('compares against this run, not an absolute price anyone asserted', () => {
    // Doubling every price in a category moves the median with it, so the
    // same listings are reported. The claim is "an outlier HERE", which is
    // what the data supports.
    const doubled = SELECTED.map((candidate) => ({ ...candidate, retailPrice: candidate.retailPrice * 2 }));
    expect(extremeUnitPriceFindings(doubled).map((finding) => finding.sku).sort())
      .toEqual(extremeUnitPriceFindings(SELECTED).map((finding) => finding.sku).sort());
  });

  it('keeps the threshold a named constant the report prints', () => {
    expect(EXTREME_UNIT_PRICE_MULTIPLE).toBe(2.5);
    for (const finding of FINDINGS.filter((entry) => entry.flag === 'extreme-unit-price')) {
      expect(finding.detail).toContain(`${EXTREME_UNIT_PRICE_MULTIPLE}x`);
    }
  });
});

describe('the run report a reviewer reads', () => {
  it('tallies 26 findings across the four classes', () => {
    expect(summariseProductScope(FINDINGS)).toEqual({
      'legacy-ram': 9,
      'oem-proprietary-motherboard': 6,
      'low-wattage-psu': 6,
      'extreme-unit-price': 5,
    });
  });

  it('reports a listing once per reason, not once in total', () => {
    // The 128 MB stick and the four OEM supplies each carry two flags. They
    // are separate questions and collapsing them would hide one.
    const twice = ['9SIAE9A8TV4830', '9SIB66RK698428', '9SIB66RK698513', '9SIB66RK699001', '9SIBZT2KGK5661'];
    for (const sku of twice) {
      expect(FINDINGS.filter((finding) => finding.sku === sku), sku).toHaveLength(2);
    }
    expect(FINDINGS).toHaveLength(26);
  });

  it('carries the verbatim title and the EFFECTIVE price on every finding', () => {
    // So the question can be answered from the report alone, without the
    // artifact the report was derived from — and answered at the price a
    // shopper is charged, not the struck-through one.
    for (const finding of FINDINGS) {
      const listing = row(finding.sku);
      expect(finding.name).toBe(listing.name);
      expect(finding.priceUsd).toBe(effectivePriceUsd(listing));
      expect(finding.category).toBe(listing.category as RetailPartCategory);
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});
