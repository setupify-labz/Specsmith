/**
 * The 290 mm defect, pinned.
 *
 * MSI specifies 302 mm for the GeForce RTX 5070 12G VENTUS 3X OC. SpecSmith's
 * canonical `rtx5070` record says 290 mm, which is a reasonable editorial
 * figure for a generic RTX 5070 and is not a measurement of that card. Because
 * the catalogue marked the listing `specsVerified: true`, the Builder resolved
 * it to the canonical record and handed 290 mm to the case-clearance check.
 *
 * These tests run the REAL published catalogue, the REAL canonical records and
 * the REAL compatibility checker. They are written to fail against the previous
 * behaviour, and they assert both halves of the split: the clearance claim is
 * gone, and the frame-rate estimate is not.
 */

import { describe, expect, it } from 'vitest';
import catalogJson from '../../../public/data/retail-parts.json';
import gpusJson from '../../data/gpus.json';
import cpusJson from '../../data/cpus.json';
import gamesJson from '../../data/games.json';
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
import { estimateFpsForBuild } from '../fps';

const parsed = parseAffiliatePartCatalog(catalogJson);
if (!parsed.ok) throw new Error(`published catalogue does not parse: ${JSON.stringify(parsed)}`);
const catalog = parsed.catalog;

/** MSI's own figure for the Ventus 3X OC, and the editorial figure it was given instead. */
const MSI_VENTUS_3X_OC_LENGTH_MM = 302;

const ventus = catalog.parts.find(
  (part) => part.category === 'gpu' && /ventus 3x/i.test(part.name) && part.canonicalPartId === 'rtx5070',
);

const gpus = gpusJson as unknown as Array<Record<string, unknown> & { id: string; name: string }>;
const rtx5070 = gpus.find((gpu) => gpu.id === 'rtx5070');

describe('the MSI Ventus listing no longer borrows the canonical RTX 5070 dimensions', () => {
  it('the published catalogue still contains the listing and the canonical record it mapped to', () => {
    expect(ventus, 'no RTX 5070 Ventus 3X listing in the published catalogue').toBeDefined();
    expect(rtx5070, 'no canonical rtx5070 record').toBeDefined();
  });

  it('the canonical figure it was given is not the figure MSI publishes', () => {
    // The premise of the whole file. If the canonical record is ever corrected
    // to a per-model figure this fails loudly rather than testing nothing.
    expect(rtx5070?.length_mm).toBe(290);
    expect(rtx5070?.length_mm).not.toBe(MSI_VENTUS_3X_OC_LENGTH_MM);
  });

  it('a case that fits 290 mm but not 302 mm gets NO clearance verdict for the listing', () => {
    if (!ventus || !rtx5070) throw new Error('fixture missing');

    // 295 mm sits between the generic figure and the real one. Under the old
    // behaviour the checker saw 290 and recorded "GPU clearance" as passed —
    // a card MSI measures at 302 mm would not have gone in.
    const testCase = {
      id: 'test-case-295',
      name: 'Case With 295mm Clearance',
      gpu_clearance_mm: 295,
      motherboard_support: ['ATX'],
      form_factor: 'Mid Tower',
    };

    const asListing = checkCompatibility({
      gpu: compatibilityView(rtx5070 as never, 'retail-listing'),
      case: testCase as never,
    });
    const clearanceVerdicts = [
      ...asListing.passed.filter((label) => /gpu clearance/i.test(label)),
      ...asListing.warnings.filter((warning) => warning.id === 'gpu-too-long' || warning.id === 'gpu-tight-fit').map((w) => w.id),
    ];
    expect(clearanceVerdicts).toEqual([]);

    // And the withholding is specific, not a blanket refusal to check: pick the
    // canonical MODEL and the same check still runs, because there the figure
    // describes the thing chosen.
    const asCanonical = checkCompatibility({
      gpu: compatibilityView(rtx5070 as never, 'canonical'),
      case: testCase as never,
    });
    expect(
      asCanonical.passed.some((label) => /gpu clearance/i.test(label))
        || asCanonical.warnings.some((w) => w.id === 'gpu-too-long' || w.id === 'gpu-tight-fit'),
      'the canonical selection must still receive a clearance verdict',
    ).toBe(true);
  });

  it('the power check is withheld for the listing on the same grounds', () => {
    if (!rtx5070) throw new Error('fixture missing');
    const view = compatibilityView(rtx5070 as never, 'retail-listing') as Record<string, unknown>;
    for (const field of PER_UNIT_SPEC_FIELDS) expect(view[field]).toBeUndefined();
    expect(withheldSpecFields(rtx5070 as never, 'retail-listing')).toContain('tdp_watts');
  });

  it('everything that describes the CHIP survives the withholding', () => {
    if (!rtx5070) throw new Error('fixture missing');
    const view = compatibilityView(rtx5070 as never, 'retail-listing') as Record<string, unknown>;
    // Identity, tier and the multiplier are what the estimator and the monitor
    // pairing advice read. Withholding physical dimensions must not cost them.
    expect(view.id).toBe('rtx5070');
    expect(view.gpu_multiplier).toBe(rtx5070.gpu_multiplier);
    expect(view.tier).toBe(rtx5070.tier);
  });
});

describe('the RTX 5070 FPS estimate remains available for that same listing', () => {
  it('the listing still resolves to its canonical model', () => {
    if (!ventus) throw new Error('fixture missing');
    // Keyed on identity. This is the assertion that fails if a future change
    // gates the canonical mapping on a specifications flag again.
    expect(hasVerifiedIdentity(ventus)).toBe(true);
    expect(canonicalIdFor(ventus)).toBe('rtx5070');
  });

  it('a frame-rate figure is produced for it', () => {
    if (!ventus || !rtx5070) throw new Error('fixture missing');
    const cpus = cpusJson as unknown as Array<Record<string, unknown> & { id: string; name: string; cpu_multiplier: number }>;
    const cpu = cpus[0];
    const games = gamesJson as unknown as Array<Record<string, unknown> & { id: string; name: string; base_fps: Record<string, Record<string, number>> }>;
    const game = games[0];
    const result = estimateFpsForBuild(rtx5070 as never, cpu as never, game as never, '1440p', 'high');
    expect(result.estimated).toBeGreaterThan(0);
  });

  it('but the listing is never described as having verified specifications', () => {
    if (!ventus) throw new Error('fixture missing');
    // The published row still carries the legacy conflated flag. It must not
    // reach a confidence decision through any route.
    expect(ventus.specsVerified).toBe(true);
    expect(hasVerifiedUnitSpecs(ventus)).toBe(false);
    expect(confidenceOf(ventus)).toBe('unverified');
  });

  it('and the notice it shows says which half is estimated and which is unverified', () => {
    if (!ventus) throw new Error('fixture missing');
    const notice = unverifiedNoticeFor(ventus);
    expect(notice).not.toBe(UNVERIFIED_NOTICE);
    expect(notice).toMatch(/estimate/i);
    expect(notice).toMatch(/dimensions and power draw are unverified/i);

    // A listing with no canonical mapping gets the plain notice instead.
    const unmapped = catalog.parts.find((part) => part.canonicalPartId === null);
    expect(unmapped).toBeDefined();
    if (unmapped) expect(unverifiedNoticeFor(unmapped)).toBe(UNVERIFIED_NOTICE);
  });
});

describe('UPC is a supporting identifier, never an identity', () => {
  it('the reader accepts a listing with no UPC and one with a valid UPC', () => {
    const base = catalog.parts[0];
    const withUpc = { ...(base as unknown as Record<string, unknown>), upc: '884588123456' };
    const withoutUpc = { ...(base as unknown as Record<string, unknown>) };
    delete withoutUpc.upc;
    for (const part of [withUpc, withoutUpc]) {
      const result = parseAffiliatePartCatalog({ ...catalogJson, parts: [part, ...catalogJson.parts.slice(1)] });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  });

  it('a malformed UPC is refused rather than published', () => {
    const bad = { ...(catalog.parts[0] as unknown as Record<string, unknown>), upc: 'N/A' };
    const result = parseAffiliatePartCatalog({ ...catalogJson, parts: [bad, ...catalogJson.parts.slice(1)] });
    expect(result.ok).toBe(false);
  });

  it('a UPC alone does not establish identity', () => {
    const upcOnly = { canonicalPartId: null, upc: '884588123456' } as unknown as AffiliatePart;
    expect(hasVerifiedIdentity(upcOnly)).toBe(false);
    expect(canonicalIdFor(upcOnly)).toBeNull();
  });
});
