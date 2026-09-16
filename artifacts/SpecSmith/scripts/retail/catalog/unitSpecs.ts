// The one gate a manufacturer specification must pass to reach a listing.
//
// WHY A GATE AND NOT A LOOKUP
// ---------------------------
// `src/lib/retail/partIdentity.ts` records what went wrong the last time
// specifications reached a listing: a card mapped to the canonical `rtx5070`
// record inherited that record's 290 mm length, the case-clearance check ran
// on it, and a shopper was told a build fit. MSI specifies 302 mm for the
// Ventus 3X OC, which is one of the listings it applied to. Twelve millimetres
// decides whether the card goes in the case.
//
// The mistake was not a bad number. It was attaching a figure that describes a
// MODEL to a record that is a PRODUCT. So this module never looks a
// specification up. It takes a source someone has already established and
// asks, every time, whether that source describes THIS listing and no other.
//
// THE RULES, IN THE ORDER THEY ARE APPLIED
// ----------------------------------------
//   1. The source must name the exact SKU, and it must be this listing's SKU.
//      A source that names only a model describes the model, and the model is
//      not what ships in the box.
//   2. When both carry a UPC, they must agree. A disagreement is two different
//      products, and the safe reading of "these two records disagree about
//      which product they describe" is to publish neither claim.
//   3. The listing's own title must name exactly ONE graphics model. A title
//      mentioning a 4070 and a 4070 Ti does not establish which variant is on
//      sale, so no specification may be bound to it however good the source
//      is. This reuses the model matcher the offer adapter already runs rather
//      than adding a second opinion about what a title says.
//
//   4. The source must state a verification the schema publishes. There are
//      only two — manufacturer-listed and retailer-listed — and there is
//      deliberately no "unverified" one to fall back to. The earlier schema
//      had one, which made this module's own rule self-contradictory: it said
//      unconfirmed figures are withheld while providing a value that carried
//      them anyway. See SPEC_VERIFICATIONS in partCatalog.ts.
//
// Anything that fails is WITHHELD with a named reason, never softened into a
// lower confidence value. A withheld specification produces no claim; an
// unconfirmed one attached anyway produces a claim with a caveat, and the
// caveat is what nobody reads.

import { SPEC_VERIFICATIONS, type AffiliatePart, type SpecVerification, type UnitSpecField } from '../../../src/lib/retail/partCatalog';
import { findGpuMentions, mentionKey } from '../rakuten/gpuModelMatch';

/**
 * A specification block someone established for one identified product.
 *
 * Constructed from a manufacturer or retailer specification page by a reviewer
 * or a future adapter. NOTHING in this repository produces one today — the
 * Rakuten Product Search feed publishes no dimensions — so every published
 * part carries `unitSpecs: null`. That is the accurate state of the data.
 */
export interface UnitSpecSource {
  /** The exact merchant item number the source describes. Never a model name. */
  sku: string;
  /** The UPC the source states, when it states one. */
  upc: string | null;
  /** Where it was read: a URL, or a named document. Never blank. */
  citation: string;
  /** When it was read. */
  observedAt: string;
  verification: SpecVerification;
  /** Field name to value and unit, exactly as published. */
  fields: Readonly<Record<string, { value: number | string; unit: string | null }>>;
}

export type SpecWithholdReason =
  /** No source was offered for this listing. The ordinary case today. */
  | 'no-source'
  /** The listing carries no exact SKU, so nothing can be bound to it. */
  | 'listing-sku-unknown'
  /** The source describes a different item number. */
  | 'source-describes-another-listing'
  /** Source and listing state different UPCs. */
  | 'upc-conflict'
  /** The listing's title names more than one model, or none. */
  | 'variant-ambiguous'
  /** The source carried no usable fields. */
  | 'source-empty'
  /** The source cites nothing, so nothing about it can be checked. */
  | 'source-uncited'
  /**
   * The source states a verification the schema will not publish.
   *
   * Checked at run time as well as in the type, because a source can arrive
   * from a JSON file a reviewer wrote, where the compiler never saw it. An
   * 'unverified' value used to be accepted here; now it stops the attachment
   * rather than being carried through to a published field.
   */
  | 'source-not-verified';

export type SpecAttachment =
  | { status: 'attached'; specs: Readonly<Record<string, UnitSpecField>> }
  | { status: 'withheld'; reason: SpecWithholdReason };

/**
 * Whether a title names exactly one graphics model.
 *
 * Only meaningful for GPU listings; other categories have no model matcher, so
 * they are not put through a test they cannot pass. For them the SKU identity
 * rules above are the whole gate.
 */
export function namesOneVariant(productName: string): boolean {
  const keys = new Set(findGpuMentions(productName).map(mentionKey));
  return keys.size === 1;
}

/**
 * Binds a source's fields to a listing, or says why it would not.
 *
 * Pure. No I/O, no clock: `observedAt` comes from the source, because the
 * instant that matters is when the specification was READ, not when this ran.
 */
export function attachUnitSpecs(
  part: Pick<AffiliatePart, 'sku' | 'upc' | 'name' | 'category'>,
  source: UnitSpecSource | null,
): SpecAttachment {
  if (source === null) return { status: 'withheld', reason: 'no-source' };
  if (typeof part.sku !== 'string' || part.sku.trim() === '') {
    return { status: 'withheld', reason: 'listing-sku-unknown' };
  }
  if (source.sku !== part.sku) return { status: 'withheld', reason: 'source-describes-another-listing' };
  if (part.upc !== null && source.upc !== null && part.upc !== source.upc) {
    return { status: 'withheld', reason: 'upc-conflict' };
  }
  if (part.category === 'gpu' && !namesOneVariant(part.name)) {
    return { status: 'withheld', reason: 'variant-ambiguous' };
  }
  if (typeof source.citation !== 'string' || source.citation.trim() === '') {
    return { status: 'withheld', reason: 'source-uncited' };
  }
  if (!(SPEC_VERIFICATIONS as readonly string[]).includes(source.verification)) {
    return { status: 'withheld', reason: 'source-not-verified' };
  }

  const specs: Record<string, UnitSpecField> = {};
  for (const [field, published] of Object.entries(source.fields)) {
    specs[field] = {
      value: published.value,
      unit: published.unit,
      source: source.citation,
      verification: source.verification,
      observedAt: source.observedAt,
    };
  }
  if (Object.keys(specs).length === 0) return { status: 'withheld', reason: 'source-empty' };
  return { status: 'attached', specs };
}
