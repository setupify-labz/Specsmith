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
 * case. A shopper was being told a build fit on the strength of a measurement
 * of a different object.
 *
 * The power figure is a separate and quieter problem: exact-unit power draw
 * was never ESTABLISHED for any listing. For this card it happens to agree —
 * MSI publishes 250 W, and so does the canonical record — but an agreement
 * found after the fact is not a measurement, and the next partner card need
 * not agree. The claim here is only that the figure was not established, not
 * that it was wrong.
 *
 * SO THE TWO ARE SPLIT HERE:
 *
 * - CANONICAL IDENTITY — "this listing is an RTX 5070". Verified by the model
 *   matcher, and enough to offer an FPS estimate, which is labelled estimated
 *   wherever it appears.
 * - EXACT-UNIT SPECIFICATIONS — the length, the power draw, the dimensions of
 *   the thing that ships. Not established anywhere today, so the checks that
 *   need them are withheld rather than answered from a model record.
 *
 * AND THE SECOND HALF IS NOT A RETAIL PROBLEM. The first version of this file
 * withheld per-unit figures from retail listings and let a CANONICAL selection
 * keep them, on the reasoning that the model's figures describe the model. But
 * `rtx5070` is not a board. It is a chip, and the record's 290 mm is an
 * editorial figure for a typical card — the same figure, from the same place,
 * that was wrong for the Ventus. A shopper who picks the generic model is told
 * "GPU clearance: passed" on exactly as little evidence as one who picks a
 * listing. So the gate is EVIDENCE, not where the selection came from:
 *
 *   per-unit figures reach a compatibility check only when the record carries
 *   SOURCED unit specifications — a specifically identified board, with the
 *   provenance of the measurement — AND the shopper selected that record
 *   itself, since a listing merely mapped to it need not be that same board.
 *
 * No record satisfies that today, so no build produces a GPU clearance or
 * GPU-power verdict. Withholding is the fail-closed direction: a check that
 * does not run produces no claim, while one fed a generic number produces a
 * confident wrong one.
 */

import type { AffiliatePart } from './partCatalog';

/**
 * Where a selected id came from.
 *
 * No longer sufficient on its own to permit a per-unit claim — see
 * `compatibilityView` — but still necessary: sourced specifications describe
 * the board the record names, and a listing mapped to that record is not
 * proof it is that board.
 */
export type SelectionOrigin =
  /** The shopper picked this record itself. */
  | 'canonical'
  /** The shopper picked an exact retailer listing that maps to this record. */
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
 * This is the only retail CONFIDENCE or COMPATIBILITY path that consults the
 * published `specsVerified` flag, and it does not trust it — so the legacy
 * `true` that older catalogues carry cannot decide whether a part's specs are
 * shown as verified, nor reach a compatibility check.
 *
 * The flag is still read elsewhere for other purposes: the reader validates
 * its type, the generator writes it, and `Builder.tsx` sets it on canonical
 * records to drive the "Not verified" spec rows in the legacy selectors. Those
 * are display and schema concerns, not judgements about an exact unit.
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
 * The field a record uses to declare that its per-unit figures are sourced.
 *
 * A non-empty string naming WHERE the measurement came from — a manufacturer
 * specification page for a specific board, say. The field's presence is the
 * record's claim to describe one identified physical product rather than a
 * model in general; its content is what a reviewer checks.
 *
 * No record in `src/data/gpus.json` carries it. That is the accurate state of
 * the data, not an oversight: those records describe chips.
 */
export const UNIT_SPECS_SOURCE_FIELD = 'unit_specs_source';

/**
 * Whether a record's per-unit figures come with provenance.
 *
 * The question is NOT "is this a canonical record" — that was the mistake this
 * gate replaces. A canonical record for a chip carries a typical length for
 * the model, which is exactly the kind of figure that produced a wrong
 * clearance verdict. Only a record that identifies a specific board AND says
 * where its dimensions came from may drive an exact-fit claim.
 */
export function hasSourcedUnitSpecs(part: Record<string, unknown> | null): boolean {
  if (part === null) return false;
  const source = part[UNIT_SPECS_SOURCE_FIELD];
  return typeof source === 'string' && source.trim() !== '';
}

/**
 * The part as the compatibility checker may see it.
 *
 * Per-unit fields survive only when the record's figures are sourced AND the
 * shopper picked that record itself. Otherwise they are dropped. Every check
 * in `compatibility.ts` guards on `typeof … === 'number'`, so a dropped field
 * means that check does not run and nothing is asserted about it.
 *
 * Today no record is sourced, so this drops the per-unit fields for every
 * selection — generic model and retailer listing alike. That is the point: an
 * exact-fit claim needs an exact measurement, and there isn't one yet.
 */
export function compatibilityView<T extends Record<string, unknown>>(
  part: T | null,
  origin: SelectionOrigin,
): T | null {
  if (part === null) return null;
  if (origin === 'canonical' && hasSourcedUnitSpecs(part)) return part;
  const withheld = { ...part } as Record<string, unknown>;
  for (const field of PER_UNIT_SPEC_FIELDS) delete withheld[field];
  return withheld as T;
}

/** Which per-unit facts were withheld, so the page can say so rather than go quiet. */
export function withheldSpecFields<T extends Record<string, unknown>>(
  part: T | null,
  origin: SelectionOrigin,
): readonly string[] {
  if (part === null) return [];
  if (origin === 'canonical' && hasSourcedUnitSpecs(part)) return [];
  return PER_UNIT_SPEC_FIELDS.filter((field) => typeof part[field] === 'number');
}
