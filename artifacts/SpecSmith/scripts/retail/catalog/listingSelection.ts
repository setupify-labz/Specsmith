// WHICH eligible listings reach the catalogue, and why.
//
// THE DEFECT THIS FILE REPLACES
// -----------------------------
// Selection used to be `unique.slice(0, quota)` over candidates in the order
// the feed happened to return them. Two things followed from that, and both
// were wrong:
//
//   1. THE QUOTA WAS FILLED BY ARRIVAL. The GPU quota is 80. A sweep that
//      returns 600 eligible listings published the first 80 the pages
//      happened to yield and never looked at the other 520. Nothing about
//      those 80 made them better listings; they were earlier.
//   2. A CHEAPER LISTING OF THE SAME PRODUCT WAS DISCARDED. De-duplication
//      kept the FIRST arrival of a normalized name. When the same product
//      appeared twice — Newegg carries re-listings — the later, cheaper one
//      was dropped in favour of the dearer one already held. That is the worst
//      shape this bug can take: the shopper is shown a higher price for a
//      product the feed also offered for less, in the same run.
//
// WHAT REPLACES IT
// ----------------
// Every eligible candidate is evaluated before anything is selected, under a
// TOTAL and ARRIVAL-INDEPENDENT order. Feeding the same candidates in any
// permutation produces the same catalogue, which is what the regression tests
// assert.
//
// The order is declared here rather than left implicit, because which listings
// a catalogue publishes is a product decision and it should be readable as
// one:
//
//   - WITHIN one product identity, the CHEAPEST listing wins. This is not a
//     preference; two listings of the same product at different prices are the
//     same offer to a shopper, and publishing the dearer one is simply wrong.
//   - ACROSS products, the quota is filled by cycling equal-population PRICE
//     BANDS, cheapest-first inside each band. Ranking the whole category by
//     price and taking the head would fill all 80 GPU slots with the cheapest
//     cards in the feed and leave a shopper with a larger budget nothing to
//     pick, which defeats what the catalogue is for. Cycling bands keeps the
//     published set spread across the price range the feed actually offered.
//
// NOTHING HERE INVENTS A NUMBER. The only figures it reads are `retailPrice`
// and `salePrice`, exactly as the merchant published them and as the admission
// rules already validated them. There is no MSRP, no discount arithmetic, no
// comparison against any other retailer, and no notion of a market price.

import type { AffiliatePart } from '../../../src/lib/retail/partCatalog';
/**
 * The merchant title reduced to a comparison key: lowercase, punctuation
 * collapsed to single spaces. Lives here rather than in `affiliateCatalog`
 * because selection is what needs it and the reverse import would be a cycle.
 */
export const normalizeCatalogName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * How many price bands the quota is spread across.
 *
 * Equal-population bands, cut from the price-ranked candidates, so the bands
 * follow whatever distribution the feed actually returned rather than any
 * price boundary we made up.
 */
export const PRICE_BAND_COUNT = 5;

/**
 * What a shopper would pay for this listing today: the sale price when there
 * is a genuine one, the retail price otherwise.
 *
 * The schema guarantees `salePrice` is either null or strictly below
 * `retailPrice`, so this needs no further defence. It is the merchant's own
 * number in the merchant's own currency — not a discount we computed, and not
 * a claim about any other seller.
 */
export const effectivePrice = (part: AffiliatePart): number => part.salePrice ?? part.retailPrice;

/**
 * A TOTAL order over listings. Never returns 0 for two distinct parts.
 *
 * Totality is the point. A comparator that ties leaves the outcome to the
 * sort's stability and therefore to arrival order, which is the bug. `id` is
 * unique within a category, so the final tie-break always decides.
 */
export function compareListings(a: AffiliatePart, b: AffiliatePart): number {
  const byEffective = effectivePrice(a) - effectivePrice(b);
  if (byEffective !== 0) return byEffective;
  const byRetail = a.retailPrice - b.retailPrice;
  if (byRetail !== 0) return byRetail;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The identity two listings share when they are the same product.
 *
 * The normalized merchant title, which is the same key the published
 * catalogue's duplicate-name rule already enforces. Deliberately NOT the
 * canonical model id: a dozen partner cards map to `rtx5070` and they are
 * different products at different prices, so collapsing them would publish one
 * RTX 5070 and call the rest duplicates.
 */
export const listingIdentity = (part: AffiliatePart): string => normalizeCatalogName(part.name);

export interface ListingSelection {
  /** The listings to publish, at most `quota` of them. */
  selected: AffiliatePart[];
  /** How many eligible candidates were evaluated. */
  considered: number;
  /** Distinct products among them, after consolidation. */
  distinctProducts: number;
  /**
   * Listings dropped because another listing of the SAME product was cheaper.
   *
   * Reported rather than swallowed: a run where this is unexpectedly large is
   * a feed returning heavy duplication, which is worth seeing in the log.
   */
  consolidated: number;
}

/**
 * Consolidates duplicate listings of one product down to its cheapest, then
 * fills `quota` from the survivors by cycling price bands.
 *
 * `isTaken` excludes candidates already claimed by an earlier category, so the
 * cross-category uniqueness the published schema requires is decided BEFORE
 * ranking rather than by trimming afterwards — trimming afterwards would let
 * an excluded listing occupy a slot a publishable one should have had.
 */
export function selectBestListings(
  candidates: readonly AffiliatePart[],
  quota: number,
  isTaken: (part: AffiliatePart) => boolean = () => false,
): ListingSelection {
  const eligible = candidates.filter((part) => !isTaken(part));

  // 1. One representative per product: the cheapest listing of it.
  const byIdentity = new Map<string, AffiliatePart>();
  for (const part of eligible) {
    const key = listingIdentity(part);
    const held = byIdentity.get(key);
    if (held === undefined || compareListings(part, held) < 0) byIdentity.set(key, part);
  }
  const representatives = [...byIdentity.values()].sort(compareListings);

  // 2. Equal-population price bands over the ranked survivors.
  const bands: AffiliatePart[][] = [];
  const bandCount = Math.min(PRICE_BAND_COUNT, Math.max(1, representatives.length));
  for (let band = 0; band < bandCount; band += 1) {
    const from = Math.floor((band * representatives.length) / bandCount);
    const to = Math.floor(((band + 1) * representatives.length) / bandCount);
    bands.push(representatives.slice(from, to));
  }

  // 3. Cheapest-first within each band, cycling bands, until the quota is met.
  const selected: AffiliatePart[] = [];
  for (let round = 0; selected.length < quota; round += 1) {
    let tookAny = false;
    for (const band of bands) {
      if (selected.length >= quota) break;
      const next = band[round];
      if (next === undefined) continue;
      selected.push(next);
      tookAny = true;
    }
    if (!tookAny) break;
  }

  return {
    selected,
    considered: eligible.length,
    distinctProducts: representatives.length,
    consolidated: eligible.length - representatives.length,
  };
}
