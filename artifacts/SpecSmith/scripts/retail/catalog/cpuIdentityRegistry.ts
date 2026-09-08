// Issue #101: the reviewed bindings between a Newegg CPU listing and a
// canonical SpecSmith processor.
//
// WHY A REGISTRY AND NOT JUST A MATCHER
// -------------------------------------
// `cpuModelMatch.ts` can prove that a title names exactly one processor and
// which one. That is necessary but not sufficient to publish an FPS estimate
// against a product someone is about to buy: it proves the merchant's TEXT is
// unambiguous, not that a human ever agreed this listing is that part. #101 is
// explicit on the point — "a similar title alone is not sufficient evidence to
// mark this retailer item verified".
//
// So a binding needs BOTH:
//
//   1. an entry here, added deliberately, naming the retailer SKU, the
//      canonical id, the evidence consulted and when it was observed; and
//   2. a passing `verifyCpuModel` against the listing's CURRENT title.
//
// (1) alone would let a stale hand-written mapping outlive the listing it
// described — Newegg reuses SKUs and merchants re-title items. (2) alone would
// be exactly the title guess the issue rules out. Requiring both means a feed
// that starts describing a different chip drops the binding automatically
// rather than quietly re-pointing an estimate at the wrong processor.
//
// EVERYTHING ELSE STAYS UNSUPPORTED. This is a reviewed subset, not a coverage
// target. An unlisted CPU keeps `canonicalPartId: null` and
// `specsVerified: false`, and the builder's existing gate refuses to estimate
// from it. Growing this list is a review action, never an automated one.

/** What was actually consulted to justify a binding. */
export type CpuEvidenceKind =
  /**
   * The merchant's own product record in the Rakuten/Newegg affiliate feed:
   * its SKU, its full product title and its tracked deep link, captured
   * together in one observation. This is Newegg describing its own item — a
   * first-party record, not SpecSmith inferring identity from a fuzzy string.
   */
  | 'merchant-feed-record';

export interface CpuIdentityBinding {
  /** The published catalogue part id, e.g. `newegg-cpu-9sia4rekg24553`. */
  retailPartId: string;
  /** The canonical processor id in `src/data/cpus.json`, e.g. `i5-13400f`. */
  canonicalCpuId: string;
  /** Manufacturer part identifier when the listing states one; null when it does not. */
  manufacturerPartId: string | null;
  kind: CpuEvidenceKind;
  /** Where the evidence was read. */
  sourceUrl: string;
  /** ISO date the evidence was observed. */
  observedAt: string;
  /** Why this specific binding is valid, in a sentence a reviewer can check. */
  reason: string;
}

/**
 * The reviewed bindings.
 *
 * Deliberately small. Each entry was checked against the feed record named in
 * `sourceUrl` on `observedAt`; the title in that record names exactly one
 * processor, and `verifyCpuModel` re-checks that at catalogue-build time.
 */
export const CPU_IDENTITY_BINDINGS: readonly CpuIdentityBinding[] = [
  {
    retailPartId: 'newegg-cpu-9sia4rekg24553',
    canonicalCpuId: 'i5-13400f',
    // The feed record states no manufacturer part number for this item. Null
    // records that absence; it is not an invitation to supply a plausible one.
    manufacturerPartId: null,
    kind: 'merchant-feed-record',
    // The merchant destination decoded from the record's own tracked deep link.
    sourceUrl:
      'https://www.newegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E16819118431?item=9SIA4REKG24553',
    observedAt: '2026-09-08',
    reason:
      'Three fields of the merchant\'s own record agree and none contradicts: the title names exactly one processor ("Intel Core i5-13400F Desktop Processor 10 cores (6 P-cores + 4 E-cores)"), the deep-link product slug independently reads "core-i5-13400f", and the link\'s item id 9SIA4REKG24553 matches this part\'s own SKU. The F designator is explicit in both the title and the slug, so the binding does not rest on it being absent-or-present by inference.',
  },
];

/** The binding for a retail part, or null when that part has not been reviewed. */
export function bindingFor(retailPartId: string): CpuIdentityBinding | null {
  return CPU_IDENTITY_BINDINGS.find((b) => b.retailPartId === retailPartId) ?? null;
}
