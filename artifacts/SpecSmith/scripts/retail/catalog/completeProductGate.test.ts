// EVERY FIXTURE IN THIS FILE IS A LISTING THAT WAS ACTUALLY SELECTED.
//
// Not "a title of this shape". The 500 rows in
// `__fixtures__/dry-run-35275594594.json` are the exact set that GitHub
// Actions run 35275594594 proposed to publish, trimmed to the four fields the
// gate reads and otherwise untouched — the file's `_provenance` block names
// the run, the artifact and the head commit, and a test below re-derives the
// count rather than trusting the block.
//
// That matters because the previous gate's tests could not do this. Their
// header says so: most of their fixtures were CONSTRUCTED to the defect as
// described, because the artifact could not be fetched, and a constructed
// fixture proves a rule fires on a SHAPE, not on the listing that shipped.
// Two of the six defects here would have survived a shape test —
//
//   - `X99 Dual CPU Motherboard ... E-ATX Server` reads as a server board to
//     any human and to the existing `isServerBoard`, EXCEPT that "Server" is
//     the last word and the rule required it before the noun;
//   - `(4Pcs-Dustproof Gold)` is a four-pack with no space before "Pcs" and no
//     "pack" anywhere, so the multipack rule did not see it.
//
// — and both were found only by running the real titles.
//
// THE PRESERVATION TESTS CARRY THE SAME WEIGHT AS THE REJECTION TESTS. A gate
// that rejects the twelve bad rows and forty good ones has made the catalogue
// worse, and the cheapest way to pass a rejection test is to over-reach. So
// the last describe block asserts on the whole fixture: 500 rows in, exactly
// 12 rejected, and the 488 survivors named where they matter.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import fixture from './__fixtures__/dry-run-35275594594.json';
import { planCatalogSelection } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';
import { consumerProductVerdict } from './consumerProductGate';
import {
  completeProductVerdict,
  isBoardAccessory,
  isBoardComponentBundle,
  isHardwareMonitorScreen,
  isMouseComponent,
  isMultiSocketServerBoard,
  isWearableDeviceCase,
  describesCompleteMouse,
  describesWorkableMonitor,
  sellsMousePart,
  showsSensorReadings,
  statedDiagonalInches,
  MIN_WORKABLE_DISPLAY_INCHES,
  screenCompleteProducts,
  type IncompleteRejection,
} from './completeProductGate';

interface FixtureRow {
  sku: string;
  category: RetailPartCategory;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  /** The effective published price: `salePrice ?? retailPrice`. */
  priceUsd: number;
}

const SELECTED = fixture.selected as FixtureRow[];

/** The one selected row with this SKU. Throws rather than silently skipping. */
const row = (sku: string): FixtureRow => {
  const found = SELECTED.find((candidate) => candidate.sku === sku);
  if (found === undefined) throw new Error(`No selected listing with SKU ${sku} in the run-35275594594 fixture`);
  return found;
};

/** Every confirmed defect, by SKU, with the reason it must be rejected for. */
const CONFIRMED_DEFECTS: readonly (readonly [string, IncompleteRejection])[] = [
  ['9SIBZT2KJN8869', 'board-accessory'],
  ['9SIC6E1M4J4236', 'board-accessory'],
  ['9SIC6E1M4J4239', 'board-accessory'],
  ['9SIB66RK6A9763', 'board-component-bundle'],
  ['9SIC6E1M4K6972', 'board-component-bundle'],
  ['9SIB66RK6B0037', 'multi-socket-server-board'],
  ['9SIC84RM3W9827', 'wearable-device-case'],
  ['9SIBVHXKPK5189', 'hardware-monitor-screen'],
  ['9SIA4REJYD1812', 'hardware-monitor-screen'],
  ['9SIA4REJYD1813', 'hardware-monitor-screen'],
  ['9SIC6T1M085452', 'mouse-component'],
  ['9SIC2ZPKRA0778', 'mouse-component'],
] as const;

describe('the fixture is the run, not a paraphrase of it', () => {
  it('holds all 500 selected listings', () => {
    expect(SELECTED).toHaveLength(500);
  });

  it('names the run, the artifact and the commit it came from', () => {
    expect(fixture._provenance.source).toContain('35275594594');
    expect(fixture._provenance.source).toContain('10519804365');
    expect(fixture._provenance.headSha).toBe('7d1026e510a1e4554063a40d4fabf1794feb54b3');
  });

  it('prices every row at what a shopper pays', () => {
    // The gate itself reads no price — it reads product KIND — so this is
    // here only to keep the shared fixture honest for the price comparison
    // below and for the scope report, which does read it. 130 of the 500
    // listings are discounted, and the first version of this fixture carried
    // the struck-through price for all of them.
    for (const listing of SELECTED) {
      expect(listing.priceUsd, listing.sku).toBe(listing.salePrice ?? listing.retailPrice);
    }
    expect(SELECTED.filter((listing) => listing.salePrice !== null)).toHaveLength(130);
  });

  it('carries every SKU the defect table asserts on', () => {
    // Guards the table itself: a typo'd SKU would otherwise make a rejection
    // test pass vacuously by never finding a row to test.
    for (const [sku] of CONFIRMED_DEFECTS) expect(row(sku).sku).toBe(sku);
  });
});

describe('board accessories are not boards', () => {
  it('rejects the BIOS flash programmer', () => {
    const listing = row('9SIBZT2KJN8869');
    expect(listing.name).toContain('XTW100 Programmer');
    expect(completeProductVerdict('motherboard', listing.name)).toEqual({
      ok: false,
      reason: 'board-accessory',
    });
  });

  it('rejects both TPM security modules', () => {
    for (const sku of ['9SIC6E1M4J4236', '9SIC6E1M4J4239']) {
      const listing = row(sku);
      expect(listing.name).toMatch(/TPM 2\.0/);
      expect(completeProductVerdict('motherboard', listing.name), sku).toEqual({
        ok: false,
        reason: 'board-accessory',
      });
    }
  });

  it('keeps a board that merely advertises a TPM header, by name or by pin count', () => {
    // CONSTRUCTED, AND LABELLED AS SUCH. The word appears on real boards and
    // the rule needs TPM to be the PRODUCT, but no selected board says so, and
    // this run therefore cannot price a looser rule on its own. The second
    // title is the shape that retired a pin-count clause: it reads exactly
    // like the TPM module's "14 Pin LPC Card", on a board.
    for (const board of [
      'GIGABYTE B650 AORUS ELITE AX ICE AM5 ATX Motherboard, TPM 2.0 Header, DDR5, PCIe 5.0 M.2',
      'ASRock B760M Pro RS/D4 LGA1700 Micro ATX Motherboard, 14-1 Pin LPC Header for TPM, DDR4, 2.5G LAN',
    ]) {
      expect(isBoardAccessory(board.toLowerCase()), board).toBe(false);
      expect(completeProductVerdict('motherboard', board), board).toEqual({ ok: true });
    }
  });
});

describe('a board sold with a processor is not a board', () => {
  it('rejects the X99H board bundled with an E5 2666 V3', () => {
    const listing = row('9SIB66RK6A9763');
    expect(listing.name).toContain('Motherboard+E5 2666 V3 CPU');
    expect(completeProductVerdict('motherboard', listing.name)).toEqual({
      ok: false,
      reason: 'board-component-bundle',
    });
  });

  it('rejects the ASUS B550M-E sold with a Ryzen 7 5700X', () => {
    const listing = row('9SIC6E1M4K6972');
    expect(listing.name).toContain('Motherboard and AMD Ryzen 7 5700X');
    expect(completeProductVerdict('motherboard', listing.name)).toEqual({
      ok: false,
      reason: 'board-component-bundle',
    });
  });

  it('keeps the three selected boards that name CPUs without shipping one', () => {
    // The mirror of the defect, and the easier mistake to make. All three are
    // legitimate DIY boards from the same run.
    for (const sku of ['9SIBP4YM3E6389', '9SIC7PVM6D1804', '9SIC70UKZA6987']) {
      const listing = row(sku);
      expect(listing.name).toMatch(/cpu/i);
      expect(isBoardComponentBundle(listing.name.toLowerCase()), listing.name).toBe(false);
      expect(completeProductVerdict('motherboard', listing.name), listing.name).toEqual({ ok: true });
    }
  });
});

describe('word order does not excuse a dual-CPU server board', () => {
  it('rejects the X99 board that says "Dual CPU" first and "Server" last', () => {
    const listing = row('9SIB66RK6B0037');
    expect(listing.name).toMatch(/^X99 Dual CPU Motherboard/);
    expect(listing.name).toMatch(/Server$/);
    expect(completeProductVerdict('motherboard', listing.name)).toEqual({
      ok: false,
      reason: 'multi-socket-server-board',
    });
  });

  it('keys on the socket count and never on the word "server"', () => {
    // The `server` + board-noun clause is GONE — see the doc comment. It was
    // rejecting the ASUS Pro WS W790-ACE for the phrase "server-grade", where
    // "server" is an adjective describing a feature. These assertions pin the
    // removal: a board is rejected for taking two processors, not for the
    // company its marketing copy keeps.
    expect(isMultiSocketServerBoard('supermicro x11 server motherboard atx')).toBe(false);
    expect(isMultiSocketServerBoard('x11 motherboard atx lga3647 server')).toBe(false);
    expect(isMultiSocketServerBoard('x11dpi nt dual socket lga3647 motherboard')).toBe(true);
    expect(isMultiSocketServerBoard('x99 dual cpu motherboard f8d plus')).toBe(true);
    expect(isMultiSocketServerBoard('h12ssl i two socket epyc board')).toBe(true);
  });

  it('leaves forward-order server boards to the consumer gate, which still has them', () => {
    // Removing the clause does not let `Supermicro X11 Server Motherboard`
    // through the pipeline — it means a DIFFERENT gate refuses it. Asserted
    // here so the removal cannot be read as opening a hole.
    for (const title of [
      'Supermicro X11SCL-F Server Motherboard LGA 1151 Intel C242 ATX',
      'ASRock Rack ROMED8-2T Server Motherboard Socket SP3 AMD EPYC 7003 ATX',
    ]) {
      expect(consumerProductVerdict('motherboard', title).ok, title).toBe(false);
    }
  });

  it('keeps the two selected single-socket workstation boards', () => {
    for (const sku of ['9SIC70UKZA6987', '9SIC6E1M4K7626']) {
      const listing = row(sku);
      expect(isMultiSocketServerBoard(listing.name.toLowerCase()), listing.name).toBe(false);
      expect(completeProductVerdict('motherboard', listing.name), listing.name).toEqual({ ok: true });
    }
  });
});

describe('"Hard PC Case" is polycarbonate, not a computer', () => {
  it('rejects the Amazfit smartwatch case', () => {
    const listing = row('9SIC84RM3W9827');
    expect(listing.name).toContain('Hard PC Case');
    expect(completeProductVerdict('case', listing.name)).toEqual({
      ok: false,
      reason: 'wearable-device-case',
    });
  });

  it('lets chassis evidence outrank a worn device named in the same title', () => {
    // CONSTRUCTED, AND LABELLED AS SUCH — no selected chassis names a phone,
    // so this run cannot exercise the guard and a mutation that deletes it
    // goes unnoticed on real data alone. These titles do exercise it: each
    // names a device the rule watches for AND is unmistakably a chassis.
    for (const title of [
      'nzxt h9 flow dual chamber atx mid tower case tempered glass with iphone dock',
      'montech king 65 pro micro atx pc case airbods earbuds holder mesh front panel',
    ]) {
      expect(isWearableDeviceCase(title), title).toBe(false);
      expect(completeProductVerdict('case', title), title).toEqual({ ok: true });
    }
  });

  it('keeps every selected PC case, including the open-frame Cougars', () => {
    // 35 cases were selected. Exactly one is the smartwatch.
    const cases = SELECTED.filter((candidate) => candidate.category === 'case');
    const rejected = cases.filter((candidate) => !completeProductVerdict('case', candidate.name).ok);
    expect(cases).toHaveLength(35);
    expect(rejected.map((candidate) => candidate.sku)).toEqual(['9SIC84RM3W9827']);
    for (const sku of ['9SIB7VEJWV5569', '9SIB7VEJWV7807']) {
      expect(completeProductVerdict('case', row(sku).name), sku).toEqual({ ok: true });
    }
  });
});

describe('a panel that reports temperatures is not a monitor', () => {
  it('rejects the Thermalright AIO hardware-monitoring display', () => {
    const listing = row('9SIBVHXKPK5189');
    expect(listing.name).toContain('Hardware Monitoring');
    expect(completeProductVerdict('monitor', listing.name)).toEqual({
      ok: false,
      reason: 'hardware-monitor-screen',
    });
  });

  it('rejects both CORN secondary IPS screens', () => {
    for (const sku of ['9SIA4REJYD1812', '9SIA4REJYD1813']) {
      const listing = row(sku);
      expect(listing.name).toContain('Secondary IPS Screen');
      expect(completeProductVerdict('monitor', listing.name), sku).toEqual({
        ok: false,
        reason: 'hardware-monitor-screen',
      });
    }
  });

  it('keeps the 15.6-inch and 13.3-inch portable monitors', () => {
    // The nearest legitimate neighbours: small external displays. Neither
    // says "monitoring" and neither is a secondary panel.
    for (const sku of ['9SIBJBBJNN7651', '9SIBJBBJU76117']) {
      const listing = row(sku);
      expect(listing.name).toContain('Portable Monitor');
      expect(isHardwareMonitorScreen(listing.name.toLowerCase()), listing.name).toBe(false);
      expect(completeProductVerdict('monitor', listing.name), sku).toEqual({ ok: true });
    }
  });
});

describe('a switch is not a mouse', () => {
  it('rejects the four-pack of TTC micro switches', () => {
    const listing = row('9SIC6T1M085452');
    expect(listing.name).toContain('Micro Mouse Switch');
    expect(listing.name).toContain('(4Pcs-Dustproof Gold)');
    expect(completeProductVerdict('mouse', listing.name)).toEqual({ ok: false, reason: 'mouse-component' });
  });

  it('rejects the ROCCAT cable bungee', () => {
    const listing = row('9SIC2ZPKRA0778');
    expect(listing.name).toContain('Bungee');
    expect(completeProductVerdict('mouse', listing.name)).toEqual({ ok: false, reason: 'mouse-component' });
  });

  it('keeps a complete mouse that advertises its switches and their endurance', () => {
    // CONSTRUCTED, AND LABELLED AS SUCH: no selected mouse but the defect
    // mentions a switch, so this run alone cannot show the cost of a looser
    // rule. An endurance rating is ordinary marketing copy on a real mouse,
    // and an earlier draft of `isMouseComponent` rejected exactly this shape.
    for (const title of [
      'logitech g pro x superlight 2 wireless gaming mouse lightforce hybrid optical mechanical switches 100 million clicks',
      'razer deathadder v3 pro ergonomic wireless gaming mouse gen-3 optical switches rated 90 million clicks',
    ]) {
      expect(isMouseComponent(title), title).toBe(false);
      expect(completeProductVerdict('mouse', title), title).toEqual({ ok: true });
    }
  });

  it('keeps the three cheapest complete mice, which the switch undercuts', () => {
    // The switch four-pack is $14.99. These are $15.23, $15.27 and $15.49 —
    // so a rule that leaned on price would have taken the switch and dropped
    // a real mouse. It leans on the noun instead.
    for (const sku of ['9SIAFJTKJX1446', '9SIAFJTKJX1547', '9SIACD55AW0338']) {
      const listing = row(sku);
      expect(listing.priceUsd).toBeGreaterThan(row('9SIC6T1M085452').priceUsd);
      expect(isMouseComponent(listing.name.toLowerCase()), listing.name).toBe(false);
      expect(completeProductVerdict('mouse', listing.name), sku).toEqual({ ok: true });
    }
  });
});

describe('the whole run, offline: 500 rows in', () => {
  const screened = screenCompleteProducts(SELECTED);

  it('rejects exactly the twelve confirmed defects and nothing else', () => {
    const rejectedSkus = SELECTED.filter((candidate) => !completeProductVerdict(candidate.category, candidate.name).ok)
      .map((candidate) => candidate.sku)
      .sort();
    expect(rejectedSkus).toEqual([...CONFIRMED_DEFECTS.map(([sku]) => sku)].sort());
  });

  it('gives each defect the reason that names what it actually is', () => {
    for (const [sku, reason] of CONFIRMED_DEFECTS) {
      const listing = row(sku);
      expect(completeProductVerdict(listing.category, listing.name), listing.name).toEqual({ ok: false, reason });
    }
  });

  it('keeps 488 of the 500 — every listing not in the defect table', () => {
    expect(screened.kept).toHaveLength(488);
    const keptSkus = new Set(screened.kept.map((candidate) => candidate.sku));
    for (const [sku] of CONFIRMED_DEFECTS) expect(keptSkus.has(sku), sku).toBe(false);
    for (const candidate of SELECTED) {
      const isDefect = CONFIRMED_DEFECTS.some(([sku]) => sku === candidate.sku);
      expect(keptSkus.has(candidate.sku), candidate.name).toBe(!isDefect);
    }
  });

  it('records more than three refusals of one reason, without sampling', () => {
    // ANOTHER NEGATIVE-CONTROL GAP. Re-imposing the old three-per-reason cap
    // broke nothing on the real fixture, because no reason reaches four there
    // — board-accessory and hardware-monitor-screen both stop at exactly
    // three. So the cap's absence is proven on a set built to exceed it.
    //
    // The titles are the three REAL board accessories; the fourth and fifth
    // repeat one of them under synthetic SKUs. That is bookkeeping under test,
    // not product data: the claim is about how many records the screener
    // keeps, and nothing here is presented as a listing that exists.
    const accessory = row('9SIC6E1M4J4236');
    const candidates = [
      row('9SIBZT2KJN8869'),
      row('9SIC6E1M4J4236'),
      row('9SIC6E1M4J4239'),
      { ...accessory, sku: 'TEST-DUPLICATE-1' },
      { ...accessory, sku: 'TEST-DUPLICATE-2' },
    ];
    const screened = screenCompleteProducts(candidates);

    expect(screened.kept).toHaveLength(0);
    expect(screened.rejected).toEqual({ 'board-accessory': 5 });
    expect(screened.rejections).toHaveLength(5);
    expect(screened.rejections.map((refusal) => refusal.sku)).toEqual([
      '9SIBZT2KJN8869',
      '9SIC6E1M4J4236',
      '9SIC6E1M4J4239',
      'TEST-DUPLICATE-1',
      'TEST-DUPLICATE-2',
    ]);
  });

  it('touches no category it was not given a rule for', () => {
    // Eight of the twelve categories have no rule. Every row in them survives,
    // which is asserted rather than assumed: a rule written without a `case`
    // label would otherwise leak across the whole catalogue.
    const ruled = new Set(['motherboard', 'case', 'monitor', 'mouse']);
    for (const candidate of SELECTED) {
      if (ruled.has(candidate.category)) continue;
      expect(completeProductVerdict(candidate.category, candidate.name), candidate.name).toEqual({ ok: true });
    }
  });

  it('tallies the rejections by reason, with real titles for a reviewer', () => {
    expect(screened.rejected).toEqual({
      'board-accessory': 3,
      'board-component-bundle': 2,
      'multi-socket-server-board': 1,
      'wearable-device-case': 1,
      'hardware-monitor-screen': 3,
      'mouse-component': 2,
    });
    // EVERY rejection is recorded, not a sample, and each carries the SKU and
    // the complete untruncated title. The old shape — three clipped titles per
    // reason, no identifier — is why run 35284766312's three false positives
    // could not be traced back to listings.
    expect(screened.rejections).toHaveLength(12);
    const bySku = new Map(SELECTED.map((candidate) => [candidate.sku, candidate.name]));
    for (const refusal of screened.rejections) {
      expect(refusal.sku, refusal.name).not.toBeNull();
      expect(bySku.get(refusal.sku as string), refusal.sku as string).toBe(refusal.name);
      expect(refusal.name.endsWith('…'), refusal.name).toBe(false);
    }
    expect(screened.rejections.map((refusal) => refusal.sku).sort())
      .toEqual([...CONFIRMED_DEFECTS.map(([sku]) => sku)].sort());
  });
});

describe('run 35284766312 false positives: three complete products the gate ate', () => {
  // PROVENANCE, STATED PLAINLY BECAUSE IT IS WEAKER THAN EVERYTHING ABOVE.
  //
  // These three listings were refused by the deployed gate in dry run
  // 35284766312, and Aaron identified them from that run's
  // `notCompleteProductTitles`. The titles below are RECONSTRUCTED FROM HIS
  // DESCRIPTION — they are NOT the verbatim merchant rows, because the run's
  // artifact cannot be fetched from this environment (the blob host is
  // refused by the egress policy) and the console output of that run did not
  // print the gate's refusals at all. That reporting gap is fixed in this same
  // change, so the next run will print SKU and full title for every refusal.
  //
  // WHAT THAT MEANS FOR THESE TESTS: each one proves the rule no longer fires
  // on the SHAPE Aaron described. None proves it no longer fires on the exact
  // listing that shipped. They must be replaced with the verbatim rows, by
  // SKU, as soon as the artifact is to hand — exactly as the twelve confirmed
  // defects above already are. Until then they are the weakest evidence in
  // this file and should be read that way.

  it('keeps a single-socket workstation board that says "server-grade"', () => {
    // "server" as an ADJECTIVE describing a feature's quality. The board takes
    // one processor and ships alone.
    const title = 'ASUS Pro WS W790-ACE Intel LGA 4677 CEB Workstation Motherboard, server-grade power design, DDR5 R-DIMM, PCIe 5.0, dual Intel 10G LAN';
    expect(isMultiSocketServerBoard(title.toLowerCase()), title).toBe(false);
    expect(completeProductVerdict('motherboard', title), title).toEqual({ ok: true });
  });

  it('refuses to read a size out of a number that has no unit', () => {
    // A NEGATIVE CONTROL FOUND THIS GAP. Loosening the parser to accept bare
    // numbers broke nothing, because no tested title happens to be misread in
    // a way that flips a verdict — so the contract is asserted directly.
    //
    // The first title is the real Thermalright row: its "9.16" carries no
    // unit, and a guessing parser would call 1080P a ten-inch screen or read
    // a model number as a diagonal.
    expect(statedDiagonalInches('Thermalright Trofeo Vision LCD AIO Display 9.16 PC Monitor, 1080P USB Type-C')).toBeNull();
    expect(statedDiagonalInches('CORN Secondary IPS Screen 800*400 Data Monitoring with 16GB TF card')).toBeNull();
    expect(statedDiagonalInches('MSI G274CV 27 Curved 1080P Full HD 75 Hz Gaming Monitor')).toBeNull();
    // And it does read the forms merchants actually write.
    expect(statedDiagonalInches("UPERFECT Portable Monitor 15.6'' 1080P FHD")).toBe(15.6);
    expect(statedDiagonalInches('UPERFECT 13.3 Inch Portable Monitor')).toBe(13.3);
    expect(statedDiagonalInches('Unew 15.6-inch Portable Gaming Monitor')).toBe(15.6);
    expect(statedDiagonalInches('CORN Secondary IPS Screen, 5 inch 800*400')).toBe(5);
  });

  it('keeps a 15.6-inch portable monitor that calls itself a "secondary screen"', () => {
    // Which is what a portable monitor IS. Size decides before the phrase.
    const title = 'Unew 15.6 Inch Portable Gaming Monitor 1080P FHD IPS, secondary screen for laptop PC, HDMI Type-C, built-in speakers';
    expect(statedDiagonalInches(title)).toBe(15.6);
    expect(isHardwareMonitorScreen(title.toLowerCase(), title), title).toBe(false);
    expect(completeProductVerdict('monitor', title), title).toEqual({ ok: true });
  });

  it('keeps a complete wireless mouse that names the switch fitted inside it', () => {
    // Naming a component is how a real product describes its build.
    const title = 'iRocks M31R Wireless Gaming Mouse, 26000 DPI PAW3395 Sensor, Huano mouse switch rated 80 million clicks, 6 programmable buttons, rechargeable';
    expect(describesCompleteMouse(title.toLowerCase()), title).toBe(true);
    expect(isMouseComponent(title.toLowerCase()), title).toBe(false);
    expect(completeProductVerdict('mouse', title), title).toEqual({ ok: true });
  });

  it('does not let mouse vocabulary rescue a part that is plainly a part', () => {
    // CODEX FOUND THESE ON 0d73e39, and they are the reason the guard is no
    // longer an early return. In both, "wireless", "Bluetooth", "2.4G" and
    // "gaming mouse" describe the mouse the PART IS FOR — the positive
    // evidence was being read as though it described the thing in the box.
    for (const title of [
      'Replacement Huano Mouse Switch for Wireless Gaming Mouse, Bluetooth 2.4G Compatible',
      'Wireless Gaming Mouse Bungee Charging Dock with 2.4G Receiver',
    ]) {
      const lower = title.toLowerCase();
      // The positive signal really is present — that is the whole trap.
      expect(describesCompleteMouse(lower), title).toBe(true);
      // And it no longer decides.
      expect(sellsMousePart(lower), title).toBe(true);
      expect(isMouseComponent(lower), title).toBe(true);
      expect(completeProductVerdict('mouse', title), title).toEqual({ ok: false, reason: 'mouse-component' });
    }
  });

  it('does not let a workable diagonal rescue a panel that reports sensors', () => {
    // CODEX'S THIRD CASE. At 14 inches this cleared the size gate, which was
    // an unconditional early return, and every accessory noun after it went
    // unread. Size now has a much smaller job.
    const title = '14 Inch PC Sensor Panel Secondary Screen for Hardware Monitoring, USB Display Inside Case';
    const lower = title.toLowerCase();
    expect(statedDiagonalInches(title)).toBe(14);
    expect(statedDiagonalInches(title)).toBeGreaterThanOrEqual(MIN_WORKABLE_DISPLAY_INCHES);
    expect(showsSensorReadings(lower), title).toBe(true);
    expect(isHardwareMonitorScreen(lower, title), title).toBe(true);
    expect(completeProductVerdict('monitor', title), title).toEqual({
      ok: false,
      reason: 'hardware-monitor-screen',
    });
  });

  it('requires BOTH size and monitor evidence to neutralise "secondary screen"', () => {
    // The phrase is ambiguous, so neither signal may carry it alone. A
    // 15.6-inch panel with no monitor vocabulary stays rejected; so does a
    // monitor-shaped title with no stated size.
    const sizeOnly = '15.6 Inch Secondary Screen Panel for PC';
    expect(isHardwareMonitorScreen(sizeOnly.toLowerCase(), sizeOnly), sizeOnly).toBe(true);
    const monitorOnly = 'Portable Gaming Monitor 1080P secondary screen for laptop, HDMI Type-C';
    expect(statedDiagonalInches(monitorOnly)).toBeNull();
    expect(isHardwareMonitorScreen(monitorOnly.toLowerCase(), monitorOnly), monitorOnly).toBe(true);
  });

  it('and still rejects the part-only versions of all three', () => {
    // The point of a narrowing is that it narrows rather than disables. Each
    // of the three rules must still refuse the thing it was written for, and
    // the twelve real defects above assert exactly that on verbatim rows.
    expect(completeProductVerdict('motherboard', row('9SIB66RK6B0037').name))
      .toEqual({ ok: false, reason: 'multi-socket-server-board' });
    expect(completeProductVerdict('monitor', row('9SIA4REJYD1812').name))
      .toEqual({ ok: false, reason: 'hardware-monitor-screen' });
    expect(completeProductVerdict('mouse', row('9SIC6T1M085452').name))
      .toEqual({ ok: false, reason: 'mouse-component' });
  });
});

describe('each authoritative clause carries its own weight', () => {
  // WHY THIS BLOCK EXISTS. The mutation run showed six clauses could be
  // deleted with every test still green — not because they are useless, but
  // because the real listings trip two or three of them at once, so removing
  // one leaves another to catch the same row. Redundancy on real data is
  // fine; redundancy that hides a deletion is not.
  //
  // Every title here is CONSTRUCTED to isolate exactly one clause. They are
  // labelled as constructed and prove rule structure, not that any such
  // listing was ever offered for sale.

  it('the piece count catches a switch multipack that talks like a mouse', () => {
    // Isolates the `\d+ pcs` clause. Without it the ambiguity resolver sees
    // "wireless" and keeps a bag of ten switches. The real NoirVogel pack
    // states no mouse specs, so it never exercised this path.
    const title = '10Pcs Huano Blue Mouse Switches for Wireless Gaming Mouse, 20 Million Clicks';
    const lower = title.toLowerCase();
    expect(describesCompleteMouse(lower)).toBe(true);
    expect(sellsMousePart(lower), title).toBe(true);
    expect(completeProductVerdict('mouse', title), title).toEqual({ ok: false, reason: 'mouse-component' });
  });

  it('a bare switch with no part-sale signal and no mouse specs is still a part', () => {
    // Isolates the ambiguity resolver's reject branch. No "replacement", no
    // count, no bungee — and nothing that says a whole mouse is in the box.
    const title = 'Kailh GM 8.0 Mouse Switch Micro Switch Dust-proof';
    const lower = title.toLowerCase();
    expect(sellsMousePart(lower)).toBe(false);
    expect(describesCompleteMouse(lower)).toBe(false);
    expect(completeProductVerdict('mouse', title), title).toEqual({ ok: false, reason: 'mouse-component' });
  });

  it('"sensor panel" alone is authoritative, at any size', () => {
    // Isolates the sensor-panel clause: workable size, monitor vocabulary,
    // and no monitoring/in-case phrase to fall back on.
    const title = '15.6 Inch Sensor Panel Secondary Screen 1080P for Gaming PC';
    expect(showsSensorReadings(title.toLowerCase()), title).toBe(true);
    expect(completeProductVerdict('monitor', title), title).toEqual({
      ok: false, reason: 'hardware-monitor-screen',
    });
  });

  it('"inside the case" alone is authoritative, at any size', () => {
    // Isolates the in-case clause. A screen that mounts in the chassis is not
    // one you sit in front of, however large the panel is.
    const title = '14 Inch Secondary Screen 1080P Gaming Monitor Mounted Inside Case';
    expect(showsSensorReadings(title.toLowerCase()), title).toBe(true);
    expect(completeProductVerdict('monitor', title), title).toEqual({
      ok: false, reason: 'hardware-monitor-screen',
    });
  });

  it('"hardware monitoring" alone is authoritative, at any size', () => {
    // Isolates the monitoring clause: no sensor-panel noun, no AIO, no
    // in-case phrase, and a diagonal well over the floor.
    const title = '16 Inch 1080P Display for Real-Time Hardware Monitoring, USB Type-C';
    expect(showsSensorReadings(title.toLowerCase()), title).toBe(true);
    expect(completeProductVerdict('monitor', title), title).toEqual({
      ok: false, reason: 'hardware-monitor-screen',
    });
  });

  it('the 13-inch floor is what keeps a small panel small', () => {
    // Isolates MIN_WORKABLE_DISPLAY_INCHES. This title has monitor
    // vocabulary and a stated size, so only the threshold stands between it
    // and being neutralised — and at 5 inches it is a case panel.
    const title = '5 Inch Secondary Screen 1080P Mini Display for PC';
    expect(statedDiagonalInches(title)).toBe(5);
    expect(describesWorkableMonitor(title.toLowerCase())).toBe(true);
    expect(showsSensorReadings(title.toLowerCase())).toBe(false);
    expect(completeProductVerdict('monitor', title), title).toEqual({
      ok: false, reason: 'hardware-monitor-screen',
    });
  });
});

describe('the gate runs BEFORE selection, so a defect cannot take a slot', () => {
  // The property the whole design rests on. A listing rejected AFTER selection
  // has already occupied a slot in a filled quota, and the category finishes
  // one product short with no candidate left to replace it.
  const generatedAt = '2026-09-17T12:00:00.000Z';

  const part = (category: RetailPartCategory, name: string, retailPrice: number): AffiliatePart => ({
    id: `newegg-${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    category,
    merchant: 'Newegg',
    name,
    imageUrl: 'https://c1.neweggimages.com/example.jpg',
    trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${encodeURIComponent(name.slice(0, 24))}`,
    fetchedAt: generatedAt,
    availability: AVAILABILITY_UNKNOWN,
    retailPrice,
    salePrice: null,
    currency: 'USD',
    canonicalPartId: category === 'gpu' ? 'rtx4070' : null,
    specsVerified: false,
    imageContentRatio: null,
    imageSha256: null,
    upc: null,
    sku: null,
    unitSpecs: null,
  });

  /** Exactly quota per category, so one wasted slot causes a visible shortfall. */
  const candidates = (extra: readonly AffiliatePart[]) =>
    new Map<RetailPartCategory, AffiliatePart[]>(
      RETAIL_CATEGORY_CONFIG.map((config) => [
        config.category,
        [
          ...extra.filter((candidate) => candidate.category === config.category),
          ...Array.from({ length: config.quota }, (_, index) =>
            part(config.category, `${config.category} filler ${index}`, 100 + index),
          ),
        ],
      ]),
    );

  it('fills every quota with the twelve real defects priced below every filler', () => {
    // Priced at $70 — under every filler — so the ranking would take them
    // first. If the gate ran after selection, four categories would finish
    // short by exactly the number of defects they were given.
    const intruders = CONFIRMED_DEFECTS.map(([sku]) => {
      const listing = row(sku);
      return part(listing.category, listing.name, 70);
    });
    const { selected, report } = planCatalogSelection(candidates(intruders), generatedAt);

    expect(selected).toHaveLength(500);
    for (const line of report) expect(line.published, line.category).toBe(line.quota);

    const published = new Set(selected.map((candidate) => candidate.name));
    for (const [sku] of CONFIRMED_DEFECTS) expect(published.has(row(sku).name), sku).toBe(false);
  });

  it('reports what it refused under its own heading, not the consumer gate\'s', () => {
    // A TPM module IS a consumer product. Counting it as `notConsumerProduct`
    // would have reported something untrue about it, which is why there are
    // two tallies rather than one.
    const intruders = ['9SIC6E1M4J4236', '9SIC6E1M4J4239'].map((sku) => {
      const listing = row(sku);
      return part(listing.category, listing.name, 70);
    });
    const { report } = planCatalogSelection(candidates(intruders), generatedAt);
    const motherboard = report.find((line) => line.category === 'motherboard');

    expect(motherboard?.notCompleteProduct).toEqual({ 'board-accessory': 2 });
    expect(motherboard?.notConsumerProduct).toEqual({});
    expect(motherboard?.notCompleteProductRejections).toHaveLength(2);
    for (const refusal of motherboard?.notCompleteProductRejections ?? []) {
      expect(refusal.reason).toBe('board-accessory');
      expect(refusal.name.length).toBeGreaterThan(40);
    }
    expect(motherboard?.considered).toBe(motherboard?.quota);
  });
});
