/**
 * Two different things were called "verified", and one of them was not true.
 *
 * A retail GPU listing carries `canonicalPartId: 'rtx5070'` and
 * `specsVerified: true`. The first is a real finding: a reviewer's matcher
 * established that this listing is an RTX 5070, and that identity is enough to
 * estimate frame rates, because the estimator models a CHIP.
 *
 * The second was not. Nothing measured that listing. `specsVerified` made the
 * Builder resolve the listing to the canonical `rtx5070` record and take its
 * `length_mm` and `tdp_watts` — editorial figures describing a generic RTX
 * 5070 — and feed them to the case-clearance and power checks as though they
 * described the exact card in the box.
 *
 * THE NUMBERS DIFFER BY ENOUGH TO MATTER. The canonical record says 290 mm.
 * MSI specifies 302 mm for the Ventus 3X OC, one of the listings this applied
 * to. Twelve millimetres is the margin that decides whether a card fits a
 * case, and an overclocked partner card draws more than the reference board,
 * so the power figure is optimistic in the same direction. A shopper was being
 * told a build fit on the strength of a measurement of a different object.
 *
 * SO THE TWO ARE SPLIT HERE:
 *
 * - CANONICAL IDENTITY — "this listing is an RTX 5070". Verified by the model
 *   matcher, and enough to offer an FPS estimate, which is labelled estimated
 *   wherever it appears.
 * - EXACT-UNIT SPECIFICATIONS — the length, the power draw, the dimensions of
 *   the thing that ships. Not established for any listing today, so the checks
 *   that need them are withheld rather than answered from the model record.
 *
 * Withholding is the fail-closed direction: a clearance check that does not
 * run produces no claim, while one fed a generic number produces a confident
 * wrong one.
 */

import type { AffiliatePart } from './partCatalog';

/** Where a selected id came from, which decides what may be said about it. */
export type SelectionOrigin =
  /** The shopper picked a canonical model. Model specs describe it correctly. */
  | 'canonical'
  /** The shopper picked an exact retailer listing. Model specs do not. */
  | 'retail-listing';

/**
 * Fields on a canonical record that describe a PHYSICAL UNIT.
 *
 * These vary between board partners and between revisions of the same model,
 * so they cannot be carried from a model record onto a specific listing. The
 * rest of the canonical record — core counts, socket, architecture, benchmark
 * tier — describes the chip or the standard and travels fine.
 */
export const PER_UNIT_SPEC_FIELDS = [
  'length_mm',
  'height_mm',
  'width_mm',
  'tdp_watts',
] as const;

/**
 * Whether a listing's canonical mapping is established.
 *
 * Identity, not specifications. A mapping exists when the generator recorded a
 * canonical id for the listing; that is what the model matcher verified and
 * all the estimator needs.
 */
export function hasVerifiedIdentity(part: Pick<AffiliatePart, 'canonicalPartId'>): boolean {
  return typeof part.canonicalPartId === 'string' && part.canonicalPartId.trim() !== '';
}

/**
 * Whether THIS EXACT UNIT's specifications have been verified.
 *
 * False for every listing in the catalogue today. Deliberately separate from
 * `hasVerifiedIdentity`: a listing can be a known RTX 5070 and still have no
 * measured length, and conflating the two is the defect this file exists for.
 *
 * The published `specsVerified` flag is read here and nowhere else, so the
 * legacy `true` that older catalogues carry cannot leak into a compatibility
 * decision by some other route.
 */
export function hasVerifiedUnitSpecs(part: Pick<AffiliatePart, 'specsVerified'>): boolean {
  // No listing today carries measured per-unit specifications. The flag as
  // published conflated identity with measurement, so it is not trusted to
  // mean the second. When real per-unit evidence exists it will arrive as its
  // own field, and this is the one place that has to change.
  void part;
  return false;
}

/**
 * The part as the compatibility checker may see it.
 *
 * For a canonical selection this is the record unchanged: the shopper chose a
 * model, and the model's figures describe that model. For a retail listing the
 * per-unit fields are dropped, because the canonical record is not a
 * measurement of the boxed product. Every check in `compatibility.ts` guards
 * on `typeof … === 'number'`, so a dropped field means that check does not run
 * and nothing is asserted about it.
 */
export function compatibilityView<T extends Record<string, unknown>>(
  part: T | null,
  origin: SelectionOrigin,
): T | null {
  if (part === null) return null;
  if (origin === 'canonical') return part;
  const withheld = { ...part } as Record<string, unknown>;
  for (const field of PER_UNIT_SPEC_FIELDS) delete withheld[field];
  return withheld as T;
}

/** Which per-unit facts were withheld, so the page can say so rather than go quiet. */
export function withheldSpecFields<T extends Record<string, unknown>>(
  part: T | null,
  origin: SelectionOrigin,
): readonly string[] {
  if (part === null || origin === 'canonical') return [];
  return PER_UNIT_SPEC_FIELDS.filter((field) => typeof part[field] === 'number');
}
