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
 * The compatibility checker, the confidence rules and the estimator are the
 * real ones. Only the data is fixed.
 */

import { describe, expect, it } from 'vitest';
import gpusJson from '../../data/gpus.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from './partCatalog';
import {
  PER_UNIT_SPEC_FIELDS,
  compatibilityView,
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

describe('a retail listing no longer borrows the canonical RTX 5070 dimensions', () => {
  it('the canonical record still carries per-unit fields, so withholding them means something', () => {
    // The one assertion that reads real repository data. It does NOT pin the
    // value — an editorial figure may legitimately be revised — only that
    // there is still a physical figure to withhold. Without this the tests
    // below could pass against a record that carries nothing.
    const gpus = gpusJson as unknown as Array<Record<string, unknown> & { id: string }>;
    const real = gpus.find((gpu) => gpu.id === 'rtx5070');
    expect(real, 'no canonical rtx5070 record').toBeDefined();
    expect(typeof real?.length_mm).toBe('number');
    expect(typeof real?.tdp_watts).toBe('number');
  });

  it('a 295 mm case gets NO clearance verdict for the listing', () => {
    // 295 mm sits between the canonical 290 and the 302 MSI publishes for the
    // Ventus 3X OC. Under the old behaviour the checker saw 290 and emitted a
    // 'gpu-tight-fit' warning — an on-screen claim about clearance derived
    // from a measurement of a different object.
    expect(clearanceVerdictsFor(compatibilityView(CANONICAL_RTX5070 as never, 'retail-listing'))).toEqual([]);
  });

  it('but the same case DOES get a verdict for the canonical model', () => {
    // The withholding is specific, not a blanket refusal to check. Choose the
    // model and the figure describes the thing chosen, so the check runs.
    expect(clearanceVerdictsFor(compatibilityView(CANONICAL_RTX5070 as never, 'canonical'))).toEqual(['gpu-tight-fit']);
  });

  it('every per-unit field is withheld from a listing, power included', () => {
    const view = compatibilityView(CANONICAL_RTX5070 as never, 'retail-listing') as Record<string, unknown>;
    for (const field of PER_UNIT_SPEC_FIELDS) expect(view[field]).toBeUndefined();
    // Exact-unit power was not established for this listing. That is the whole
    // claim — not that the card draws more than the canonical figure says.
    expect(withheldSpecFields(CANONICAL_RTX5070 as never, 'retail-listing')).toContain('tdp_watts');
    expect(withheldSpecFields(CANONICAL_RTX5070 as never, 'retail-listing')).toContain('length_mm');
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
