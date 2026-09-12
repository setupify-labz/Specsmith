/**
 * The 290 mm defect, pinned.
 *
 * A retail GPU listing carried `canonicalPartId: 'rtx5070'` AND
 * `specsVerified: true`. Only the first was a finding. The model matcher
 * established which chip the listing contains; nothing measured the board in
 * the box. The flag made the Builder resolve the listing to the canonical
 * `rtx5070` record and hand its `length_mm` to the case-clearance check.
 *
 * The figures differ by enough to decide a build: the canonical record says
 * 290 mm, and MSI publishes 302 mm for the GeForce RTX 5070 12G VENTUS 3X OC,
 * one of the listings this applied to. Exact-unit POWER was likewise never
 * established — MSI publishes 250 W for that card, which matches the canonical
 * figure, and a match is not a measurement.
 *
 * EVERYTHING HERE RUNS ON A FIXTURE, not on `public/data/retail-parts.json`.
 * That file is regenerated from a live feed: its listings rotate, and the
 * refresh that lands this split will write `specsVerified: false` on every
 * row. Pinning the behaviour to one SKU in it would test a retailer's
 * inventory. The fixture builds the listing in BOTH shapes — the legacy
 * `true` and the `false` a regeneration writes — because neither may reach a
 * compatibility decision.
 *
 * AND THE SAME RULE BINDS THE CANONICAL RECORD. `rtx5070` is a chip, not a
 * board: its 290 mm is a typical figure for the model, from the same place and
 * worth exactly as much as it was for the listing. So a generic record may not
 * claim an exact fit either. The gate is sourced evidence, not origin, and
 * these tests prove a generic model produces no clearance verdict — while a
 * fixture board that DOES carry sourced dimensions still does, so the gate
 * cannot be mistaken for a permanent shut-off.
 *
 * The compatibility checker, the confidence rules and the estimator are the
 * real ones. Only the data is fixed.
 */

import { describe, expect, it } from 'vitest';
import gpusJson from '../../data/gpus.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from './partCatalog';
import {
  PER_UNIT_SPEC_FIELDS,
  UNIT_SPECS_SOURCE_FIELD,
  compatibilityView,
  hasSourcedUnitSpecs,
  hasVerifiedIdentity,
  hasVerifiedUnitSpecs,
  withheldSpecFields,
} from './partIdentity';
import { canonicalIdFor, confidenceOf, unverifiedNoticeFor, UNVERIFIED_NOTICE } from './retailShopping';
import { checkCompatibility } from '../compatibility';
import { estimateFps } from '../fps';
import {
  CANONICAL_RTX5070,
  CASE_295MM,
  SOURCED_BOARD_RTX5070,
  catalogueContaining,
  rtx5070Listing,
  unmappedListing,
} from './__fixtures__/catalogFixture';

/** Both published shapes of the same listing. The split must hold for each. */
const SHAPES: ReadonlyArray<readonly [string, AffiliatePart]> = [
  ['as published today (legacy specsVerified: true)', rtx5070Listing(true)],
  ['as the next regeneration writes it (specsVerified: false)', rtx5070Listing(false)],
];

const clearanceVerdictsFor = (gpu: Record<string, unknown> | null) => {
  const result = checkCompatibility({ gpu: gpu as never, case: CASE_295MM as never });
  return [
    ...result.passed.filter((label) => /gpu clearance/i.test(label)),
    ...result.warnings
      .filter((warning) => warning.id === 'gpu-too-long' || warning.id === 'gpu-tight-fit')
      .map((warning) => warning.id),
  ];
};

describe('an exact-fit claim needs an exact measurement, whatever was selected', () => {
  it('no canonical GPU record in the repository declares sourced unit specifications', () => {
    // The premise. These records describe chips: a length on one of them is a
    // typical figure for the model, not a measurement of a board. If a record
    // ever gains real provenance this fails, and the tests below need the
    // sourced case re-pointed at it rather than at a fixture.
    const gpus = gpusJson as unknown as Array<Record<string, unknown> & { id: string }>;
    expect(gpus.some((gpu) => hasSourcedUnitSpecs(gpu))).toBe(false);

    // ...and they do still carry the unsourced figures, so withholding them is
    // not a no-op.
    const real = gpus.find((gpu) => gpu.id === 'rtx5070');
    expect(real, 'no canonical rtx5070 record').toBeDefined();
    expect(typeof real?.length_mm).toBe('number');
    expect(typeof real?.tdp_watts).toBe('number');
  });

  it('a GENERIC canonical model gets no clearance verdict, even when picked directly', () => {
    // THE CLAIM THIS FILE EXISTS FOR, second half. 295 mm sits between the
    // canonical 290 and the 302 MSI publishes for the Ventus 3X OC. The old
    // behaviour emitted a 'gpu-tight-fit' warning here — an on-screen
    // statement about clearance derived from a figure for a typical card.
    // Picking `rtx5070` from a menu does not make that figure a measurement.
    expect(clearanceVerdictsFor(compatibilityView(CANONICAL_RTX5070 as never, 'canonical'))).toEqual([]);
  });

  it('nor does a retail listing of that same model', () => {
    expect(clearanceVerdictsFor(compatibilityView(CANONICAL_RTX5070 as never, 'retail-listing'))).toEqual([]);
  });

  it('a specifically identified board WITH sourced dimensions does get one', () => {
    // The gate is evidence, not a permanent shut-off. Given provenance for one
    // physical board, the check runs and warns — which is the behaviour the
    // generic record was borrowing without the evidence.
    expect(hasSourcedUnitSpecs(SOURCED_BOARD_RTX5070 as never)).toBe(true);
    expect(clearanceVerdictsFor(compatibilityView(SOURCED_BOARD_RTX5070 as never, 'canonical')))
      .toEqual(['gpu-tight-fit']);
  });

  it('but not when it was reached through a retailer listing', () => {
    // Sourced dimensions describe the board the record names. A listing merely
    // MAPPED to that record need not be that board, so the second gate holds.
    expect(clearanceVerdictsFor(compatibilityView(SOURCED_BOARD_RTX5070 as never, 'retail-listing')))
      .toEqual([]);
  });

  it('an empty or missing source string does not unlock anything', () => {
    // Provenance is the content of the field, so a blank one is no provenance.
    const blank = { ...SOURCED_BOARD_RTX5070, [UNIT_SPECS_SOURCE_FIELD]: '   ' };
    expect(hasSourcedUnitSpecs(blank as never)).toBe(false);
    expect(clearanceVerdictsFor(compatibilityView(blank as never, 'canonical'))).toEqual([]);
  });

  it('every per-unit field is withheld from an unsourced record, power included', () => {
    for (const origin of ['canonical', 'retail-listing'] as const) {
      const view = compatibilityView(CANONICAL_RTX5070 as never, origin) as Record<string, unknown>;
      for (const field of PER_UNIT_SPEC_FIELDS) expect(view[field]).toBeUndefined();
      expect(withheldSpecFields(CANONICAL_RTX5070 as never, origin)).toContain('tdp_watts');
      expect(withheldSpecFields(CANONICAL_RTX5070 as never, origin)).toContain('length_mm');
    }
  });

  it('everything that describes the CHIP survives the withholding', () => {
    const view = compatibilityView(CANONICAL_RTX5070 as never, 'retail-listing') as Record<string, unknown>;
    // Identity, tier and the multiplier are what the estimator and the monitor
    // pairing advice read. Withholding physical dimensions must not cost them.
    expect(view.id).toBe('rtx5070');
    expect(view.gpu_multiplier).toBe(CANONICAL_RTX5070.gpu_multiplier);
    expect(view.tier).toBe(CANONICAL_RTX5070.tier);
  });
});

describe('an unknown power draw does not become a zero-watt GPU', () => {
  it('a build whose GPU draw was withheld gets NO power verdict', () => {
    // The withholding uncovered this. `checkCompatibility` defaulted a missing
    // draw to 0 W, which is right for a part that is absent and catastrophic
    // for one that is selected: a 1000 W pairing passes on a 450 W unit.
    const result = checkCompatibility({
      gpu: compatibilityView(CANONICAL_RTX5070 as never, 'canonical'),
      cpu: { id: 'fixture-cpu', name: 'Fixture CPU', tdp_watts: 105 } as never,
      psu: { id: 'fixture-psu', name: 'Fixture 450W', wattage: 450 } as never,
    });
    expect(result.passed).not.toContain('PSU wattage');
    expect(result.warnings.map((warning) => warning.id)).not.toContain('psu-tight');
    expect(result.warnings.map((warning) => warning.id)).not.toContain('psu-insufficient');
  });

  it('and one with no GPU at all still gets the check it always had', () => {
    // The zero default stays correct for an ABSENT part. A CPU-only build is
    // still told its power supply is too small.
    const result = checkCompatibility({
      cpu: { id: 'fixture-cpu', name: 'Fixture CPU', tdp_watts: 105 } as never,
      psu: { id: 'fixture-psu', name: 'Fixture 150W', wattage: 150 } as never,
    });
    expect(result.warnings.map((warning) => warning.id)).toContain('psu-insufficient');
  });
});

describe.each(SHAPES)('the RTX 5070 estimate survives — %s', (_label, listing) => {
  it('the listing still resolves to its canonical model', () => {
    // Keyed on identity. This fails if a future change gates the canonical
    // mapping on a specifications flag again — in either published shape.
    expect(hasVerifiedIdentity(listing)).toBe(true);
    expect(canonicalIdFor(listing)).toBe('rtx5070');
  });

  it('a frame-rate figure is produced from that mapping', () => {
    const canonicalId = canonicalIdFor(listing);
    expect(canonicalId).toBe(CANONICAL_RTX5070.id);
    const result = estimateFps(CANONICAL_RTX5070.gpu_multiplier, 1.2, 90);
    expect(result.estimated).toBeGreaterThan(0);
  });

  it('yet the listing is never described as having verified specifications', () => {
    // The legacy `true` must not reach a confidence decision by any route.
    expect(hasVerifiedUnitSpecs(listing)).toBe(false);
    expect(confidenceOf(listing)).toBe('unverified');
  });

  it('and its notice says which half is estimated and which is unverified', () => {
    const notice = unverifiedNoticeFor(listing);
    expect(notice).not.toBe(UNVERIFIED_NOTICE);
    expect(notice).toMatch(/estimate/i);
    expect(notice).toMatch(/dimensions and power draw are unverified/i);
  });
});

describe('a listing with no canonical mapping', () => {
  it('gets the plain notice and no performance guess', () => {
    const unmapped = unmappedListing();
    expect(hasVerifiedIdentity(unmapped)).toBe(false);
    expect(canonicalIdFor(unmapped)).toBeNull();
    expect(unverifiedNoticeFor(unmapped)).toBe(UNVERIFIED_NOTICE);
  });
});

describe('UPC is a supporting identifier, never an identity', () => {
  const withUpc = (upc: unknown) => {
    const listing = { ...(rtx5070Listing(false) as unknown as Record<string, unknown>) };
    if (upc === undefined) delete listing.upc;
    else listing.upc = upc;
    return parseAffiliatePartCatalog(
      catalogueContaining(listing as unknown as AffiliatePart, unmappedListing()),
    );
  };

  it('the reader accepts a listing with a valid UPC', () => {
    const result = withUpc('884588123456');
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.catalog.parts[0].upc).toBe('884588123456');
  });

  it('and one published before the field existed, normalizing it to null', () => {
    const result = withUpc(undefined);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.catalog.parts[0].upc).toBeNull();
  });

  it('a malformed UPC is refused rather than published', () => {
    // Merchants put "N/A" in the element. Publishing it would put a string
    // that is not a UPC into a field a reviewer would check an SKU against.
    expect(withUpc('N/A').ok).toBe(false);
  });

  it('a UPC alone does not establish identity', () => {
    const upcOnly = { canonicalPartId: null, upc: '884588123456' } as unknown as AffiliatePart;
    expect(hasVerifiedIdentity(upcOnly)).toBe(false);
    expect(canonicalIdFor(upcOnly)).toBeNull();
  });
});

describe('every surface that shows a compatibility panel obeys the same rule', () => {
  it('Build Crate makes no exact-fit claim from the canonical records it pulls', async () => {
    // A crate hands `finalizeCrateBuild` canonical records straight from
    // gpus.json, and its result is rendered as a compatibility panel. The
    // Builder refusing a claim on that data while the crate makes it would be
    // the same defect on a different page.
    const { finalizeCrateBuild } = await import('../buildCrate');
    const gpus = gpusJson as unknown as Array<Record<string, unknown> & { id: string }>;
    const gpu = gpus.find((entry) => entry.id === 'rtx5070');
    expect(gpu, 'no canonical rtx5070 record').toBeDefined();

    const build = finalizeCrateBuild({
      gpu: gpu as never,
      cpu: { id: 'c', name: 'C', price_usd: 1, tier: 5, tdp_watts: 105, cpu_multiplier: 1, socket: 'AM5', supported_ram: ['DDR5'] } as never,
      motherboard: { id: 'm', name: 'M', price_usd: 1, socket: 'AM5', supported_ram: ['DDR5'], form_factor: 'ATX' } as never,
      ram: { id: 'r', name: 'R', price_usd: 1, type: 'DDR5' } as never,
      storage: { id: 's', name: 'S', price_usd: 1 } as never,
      case: { ...CASE_295MM, price_usd: 1 } as never,
      cooler: { id: 'cl', name: 'CL', price_usd: 1, max_tdp_watts: 250, type: 'AIO' } as never,
      psu: { id: 'p', name: 'P', price_usd: 1, wattage: 450 } as never,
    });

    expect(build.compat.passed).not.toContain('GPU clearance');
    expect(build.compat.passed).not.toContain('PSU wattage');
    const ids = build.compat.warnings.map((warning) => warning.id);
    for (const id of ['gpu-too-long', 'gpu-tight-fit', 'psu-tight', 'psu-insufficient']) {
      expect(ids).not.toContain(id);
    }
  });
});
