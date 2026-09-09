// Issue #101: the reviewed bindings between a Newegg CPU listing and a
// canonical SpecSmith processor, and the evidence each one rests on.
//
// TWO INDEPENDENT SOURCES, JOINED BY THE PART NUMBER
// --------------------------------------------------
// A binding needs evidence from two parties that can disagree:
//
//   RETAILER      the merchant's product record. Establishes WHAT IS ON SALE
//                 and which manufacturer part number the merchant claims to be
//                 selling. It cannot establish what that part IS, because the
//                 merchant is the party whose labelling is in question.
//
//   MANUFACTURER  the chip vendor's own specification and ordering records.
//                 Establishes WHAT THE PART IS and which boxed ordering code
//                 denotes it.
//
// The manufacturer part number is the JOIN, and it is enforced by exact string
// equality in `cpuIdentityBinding.ts`: the retailer says "I am selling
// BX8071513400F", Intel says "BX8071513400F is a Core i5-13400F". A missing
// MPN on either side, or two that differ by a single character, fails closed.
// Neither party's word alone binds anything.
//
// An earlier revision bound on three fields of the SAME merchant record
// agreeing (title, deep-link slug, item id). That is self-consistency, not
// corroboration: a merchant that mislabels an item mislabels it in every field
// of its own record at once.
//
// FAIL CLOSED
// -----------
// `manufacturer.status` must be `confirmed` AND the two part numbers must match
// for a binding to be admitted. Anything else leaves the part unsupported, with
// `canonicalPartId: null`, and the builder refuses to estimate from it.

/** Whether the vendor's own records have actually been read. */
export type ManufacturerEvidenceStatus = 'confirmed' | 'pending';

export interface RetailerEvidence {
  /** The merchant product page, decoded from the record's tracked deep link. */
  productUrl: string;
  /**
   * The merchant's identifier for the PRODUCT: the `/p/<id>` segment.
   *
   * This is the key a binding is looked up by. Newegg rotates the offer-level
   * `item=` id for the same product — observed on 2026-09-09, when the feed
   * replaced item 9SIA4REKG24553 with 9SIC7VBM1R3247 for this identical
   * listing, same title and same product page. Because the published part id
   * is derived from that item id, keying on the part id meant a binding died
   * whenever the merchant re-issued the offer. The product id survives that.
   */
  merchantProductId: string;
  /**
   * The offer-level item id observed at review time.
   *
   * Recorded as provenance, NOT used as the key: it is expected to change.
   */
  observedItemId: string;
  /**
   * The manufacturer part number the MERCHANT states for this item.
   *
   * Null when the listing states none — which fails the binding closed rather
   * than falling back to a title comparison. This is the retailer's half of the
   * join and must never be copied from the manufacturer's record.
   */
  mpn: string | null;
  /** ISO date the retailer record was observed. */
  observedAt: string;
}

export interface ManufacturerEvidence {
  /** The vendor's specification record for the processor. */
  specificationsUrl: string;
  /** The vendor's ordering record, which names the boxed ordering code. */
  orderingUrl: string;
  status: ManufacturerEvidenceStatus;
  /** ISO date the vendor records were read. Null unless `status` is 'confirmed'. */
  observedAt: string | null;
  /** The processor the specifications record identifies. Null while unconfirmed. */
  statedProcessor: string | null;
  /**
   * The boxed ordering code the ordering record identifies. Null while
   * unconfirmed. This is the manufacturer's half of the join.
   */
  orderingCode: string | null;
  /** How the vendor records were obtained, so a reviewer can re-check them. */
  attribution: string;
}

export interface CpuIdentityBinding {
  /** The canonical processor id in `src/data/cpus.json`. */
  canonicalCpuId: string;
  retailer: RetailerEvidence;
  manufacturer: ManufacturerEvidence;
  /** Why this binding is valid, in a sentence a reviewer can check. */
  reason: string;
}

/**
 * Every binding under review.
 *
 * Deliberately one entry. #101 asks for a single proven path, not coverage.
 */
export const CPU_IDENTITY_BINDINGS: readonly CpuIdentityBinding[] = [
  {
    canonicalCpuId: 'i5-13400f',
    retailer: {
      productUrl:
        'https://www.newegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E16819118431?item=9SIA4REKG24553',
      merchantProductId: 'N82E16819118431',
      observedItemId: '9SIA4REKG24553',
      mpn: 'BX8071513400F',
      observedAt: '2026-09-08',
    },
    manufacturer: {
      specificationsUrl:
        'https://www.intel.com/content/www/us/en/products/sku/230501/intel-core-i513400f-processor-20m-cache-up-to-4-60-ghz/specifications.html',
      orderingUrl:
        'https://www.intel.com/content/www/us/en/products/sku/230501/intel-core-i513400f-processor-20m-cache-up-to-4-60-ghz/ordering.html',
      status: 'confirmed',
      observedAt: '2026-09-08',
      statedProcessor: 'Intel Core i5-13400F',
      orderingCode: 'BX8071513400F',
      attribution:
        "Supplied by the repository owner and independently corroborated in Codex's review of PR #105, both citing Intel's SKU 230501 records: the specifications page identifies processor number i5-13400F, and the ordering page identifies boxed ordering code BX8071513400F. Not retrieved by the authoring agent, whose sandbox has no route to intel.com; a reviewer can re-check both URLs directly.",
    },
    reason:
      'Newegg states it is selling MPN BX8071513400F as item 9SIA4REKG24553, titled "Intel Core i5-13400F Desktop Processor". Intel\'s ordering record states BX8071513400F is the boxed ordering code for the Core i5-13400F, which its specifications record identifies as processor number i5-13400F. The two parties agree on the part number, so the merchant\'s identity claim is corroborated by the party that defines the part rather than by more of the merchant\'s own record.',
  },
];

/**
 * The binding under review for a merchant PRODUCT id, admitted or not.
 *
 * Looked up by `/p/<id>` rather than by the published part id, so a binding
 * survives the merchant re-issuing the same product under a new offer id.
 */
export function bindingFor(merchantProductId: string): CpuIdentityBinding | null {
  return CPU_IDENTITY_BINDINGS.find((b) => b.retailer.merchantProductId === merchantProductId) ?? null;
}

/** Only bindings whose manufacturer records have actually been read. */
export function admittedBindings(): readonly CpuIdentityBinding[] {
  return CPU_IDENTITY_BINDINGS.filter((b) => b.manufacturer.status === 'confirmed');
}
