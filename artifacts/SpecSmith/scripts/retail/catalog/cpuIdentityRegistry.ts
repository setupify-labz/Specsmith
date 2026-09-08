// Issue #101: the reviewed bindings between a Newegg CPU listing and a
// canonical SpecSmith processor, and the evidence each one rests on.
//
// TWO INDEPENDENT SOURCES, NOT ONE RECORD AGREEING WITH ITSELF
// ------------------------------------------------------------
// An earlier revision of this file bound a processor on the strength of three
// fields of the SAME Newegg feed record agreeing: the title, the deep-link
// product slug, and the item id. That is self-consistency, not corroboration.
// A merchant that mislabels an item mislabels it in every field of its own
// record at once, and all three checks pass on a wrong product.
//
// So a binding now needs evidence from two sources that can fail
// independently:
//
//   RETAILER   — the merchant's own feed record: which SKU is being sold, at
//                what price, behind which tracked link. This establishes WHAT
//                IS ON SALE. It cannot establish what the part IS, because the
//                merchant is the party whose labelling is in question.
//
//   MANUFACTURER — the chip vendor's own specification/ordering record for the
//                manufacturer part number. This establishes WHAT THE PART IS,
//                from the only party that defines it.
//
// The MPN is the join between them: the retailer says "I am selling
// BX8071513400F", the manufacturer says "BX8071513400F is a Core i5-13400F".
// Neither sentence alone binds anything.
//
// FAIL CLOSED
// -----------
// `manufacturer.status` must be `confirmed` for a binding to be admitted. An
// entry whose manufacturer evidence is `blocked` or `pending` is a recorded
// INTENT to bind, not a binding: `admittedBindings()` excludes it, the
// catalogue keeps `canonicalPartId: null`, and the builder's existing gate
// refuses to estimate. Recording the intent is deliberate — it keeps the
// unfinished work visible and reviewable instead of dropping it on the floor.

/** How a manufacturer record was obtained, and whether it can be relied on. */
export type ManufacturerEvidenceStatus =
  /** The official record was retrieved and read. Only this admits a binding. */
  | 'confirmed'
  /** Not yet attempted. */
  | 'pending'
  /** Attempted and prevented. `blockedReason` says exactly what stopped it. */
  | 'blocked';

export interface RetailerEvidence {
  /** The merchant product page, decoded from the record's tracked deep link. */
  productUrl: string;
  /** The retailer's own item identifier, as it appears in that URL. */
  merchantItemId: string;
  /** ISO date the feed record was observed. */
  observedAt: string;
}

export interface ManufacturerEvidence {
  /** The manufacturer part number this binding turns on. */
  mpn: string;
  /** The official vendor specification/ordering record for that MPN. */
  sourceUrl: string;
  status: ManufacturerEvidenceStatus;
  /** ISO date the official record was read. Null unless `status` is 'confirmed'. */
  observedAt: string | null;
  /**
   * What the official record states, quoted, when it has been read. Null while
   * unconfirmed. This is never paraphrased from memory: an unread source has
   * no findings.
   */
  statedProcessor: string | null;
  /** Why the official record could not be read. Null unless `status` is 'blocked'. */
  blockedReason: string | null;
}

export interface CpuIdentityBinding {
  /** The published catalogue part id, e.g. `newegg-cpu-9sia4rekg24553`. */
  retailPartId: string;
  /** The canonical processor id in `src/data/cpus.json`. */
  canonicalCpuId: string;
  retailer: RetailerEvidence;
  manufacturer: ManufacturerEvidence;
  /** Why this binding is valid, in a sentence a reviewer can check. */
  reason: string;
}

/**
 * Every binding under review, admitted or not.
 *
 * Deliberately one entry. #101 asks for a single proven path, not coverage.
 */
export const CPU_IDENTITY_BINDINGS: readonly CpuIdentityBinding[] = [
  {
    retailPartId: 'newegg-cpu-9sia4rekg24553',
    canonicalCpuId: 'i5-13400f',
    retailer: {
      productUrl:
        'https://www.newegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E16819118431?item=9SIA4REKG24553',
      merchantItemId: '9SIA4REKG24553',
      observedAt: '2026-09-08',
    },
    manufacturer: {
      mpn: 'BX8071513400F',
      sourceUrl:
        'https://www.intel.com/content/www/us/en/products/sku/230580/intel-core-i513400f-processor-20m-cache-up-to-4-60-ghz/specifications.html',
      status: 'blocked',
      observedAt: null,
      statedProcessor: null,
      blockedReason:
        "This environment's network egress proxy denies every intel.com host (CONNECT answered 403 for www.intel.com:443, ark.intel.com, intel.com and edc.intel.com on 2026-09-08). The official ordering record for BX8071513400F could not be retrieved, so it has not been read and nothing is claimed about its contents. Until it is, this binding stays unadmitted and the part remains unsupported.",
    },
    reason:
      'The retailer record identifies the item being sold (Newegg item 9SIA4REKG24553, titled "Intel Core i5-13400F Desktop Processor"). Binding it to canonical i5-13400f additionally requires Intel\'s own ordering record for BX8071513400F to state that this MPN is a Core i5-13400F — an independent source that can disagree with the merchant. That record is not yet readable here, so this entry is recorded but not admitted.',
  },
];

/** The binding under review for a retail part, admitted or not. */
export function bindingFor(retailPartId: string): CpuIdentityBinding | null {
  return CPU_IDENTITY_BINDINGS.find((b) => b.retailPartId === retailPartId) ?? null;
}

/**
 * Only the bindings whose manufacturer evidence has actually been read.
 *
 * This is the list the catalogue generator is allowed to act on.
 */
export function admittedBindings(): readonly CpuIdentityBinding[] {
  return CPU_IDENTITY_BINDINGS.filter((b) => b.manufacturer.status === 'confirmed');
}
