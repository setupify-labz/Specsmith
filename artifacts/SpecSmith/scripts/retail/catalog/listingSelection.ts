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
//   - ACROSS products, coverage is CATEGORY-AWARE and, where the evidence
//     exists, ATTRIBUTE-DRIVEN. Ranking the whole category by price and taking
//     the head would fill all 80 GPU slots with the cheapest cards in the feed
//     and leave a shopper with a larger budget nothing to pick, so slots are
//     spread — but by what the listings ARE, not by where they fall in a price
//     distribution. See COVERAGE below.
//
// COVERAGE, AND THE BAND RULE IT REPLACES
// ---------------------------------------
// The first version of this file spread the quota over equal-population price
// bands cut from whatever the feed returned. Bands cut from the sample are
// dragged by the sample: the top band is always "the dearest things that
// arrived", and reserving slots for it GUARANTEES one of them a place. That is
// how a $34,912 enterprise storage device reached a catalogue for people
// building a gaming PC. Nothing had judged it relevant; it was expensive, and
// the top band had to be filled.
//
// So there are no quantiles here any more. Two rules, in this order:
//
//   1. SCOPE FIRST. Every candidate is checked against its category's absolute
//      bounds — decided before any listing is read, so the feed cannot move
//      them — and an out-of-scope listing is rejected outright. It never
//      competes for a slot. See categoryScope.ts.
//   2. COVERAGE BY VERIFIED ATTRIBUTE WHERE THERE IS ONE. A GPU listing
//      carries `canonicalPartId`, which the model matcher VERIFIED: this
//      listing is an RTX 5070. So GPU slots cycle across distinct models,
//      cheapest listing first within each. Budget and premium cards are both
//      represented because both models exist in the catalogue — a fact about
//      the parts, not a position in a price ranking.
//
//      No other category has a verified attribute; there is no matcher for
//      motherboards. For those, slots cycle over FIXED tiers of the category's
//      own scope range. Fixed is the load-bearing word: the boundaries come
//      from the declared bounds, not from the sample, so one freak listing
//      cannot shift them — and an empty tier contributes NOTHING rather than
//      being filled from the next one along. A category whose feed offers only
//      budget parts publishes only budget parts, which is the truth about that
//      feed.
//
// NOTHING HERE INVENTS A NUMBER. The only figures it reads are `retailPrice`
// and `salePrice`, exactly as the merchant published them and as the admission
// rules already validated them. There is no MSRP, no discount arithmetic, no
// comparison against any other retailer, and no notion of a market price.

import type { AffiliatePart } from '../../../src/lib/retail/partCatalog';
import { scopeVerdict, type CategoryPriceScope } from './categoryScope';
/**
 * The merchant title reduced to a comparison key: lowercase, punctuation
 * collapsed to single spaces. Lives here rather than in `affiliateCatalog`
 * because selection is what needs it and the reverse import would be a cycle.
 */
export const normalizeCatalogName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * How many tiers a category's scope range is divided into for coverage.
 *
 * The tiers are FIXED cuts of the declared [floor, ceiling] range, not
 * quantiles of the candidates, so they do not move when the feed does.
 */
export const COVERAGE_TIER_COUNT = 5;

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
  /** Rejected as outside the category's declared scope, with the reason each time. */
  outOfScope: Record<string, number>;
  /** Distinct products among the in-scope candidates, after consolidation. */
  distinctProducts: number;
  /**
   * Listings dropped because another listing of the SAME product was cheaper.
   *
   * Reported rather than swallowed: a run where this is unexpectedly large is
   * a feed returning heavy duplication, which is worth seeing in the log.
   */
  consolidated: number;
  /** How coverage was spread — by verified attribute, or by scope tier. */
  coverage: 'verified-attribute' | 'scope-tier';
  /** Distinct groups the slots were cycled over. */
  coverageGroups: number;
}

/**
 * The verified attribute a category's coverage may be spread across, or null.
 *
 * Only `canonicalPartId` qualifies, and only because the model matcher
 * ESTABLISHED it — `src/lib/retail/partIdentity.ts` is explicit that this is
 * identity and nothing more, which is exactly what coverage needs. Nothing is
 * read out of a product title here: a title is the merchant's marketing copy,
 * and grouping a catalogue by guesses made from it would be inventing an
 * attribute rather than using a verified one.
 */
export function verifiedCoverageKey(part: AffiliatePart): string | null {
  return typeof part.canonicalPartId === 'string' && part.canonicalPartId.trim() !== ''
    ? part.canonicalPartId
    : null;
}

/**
 * Which fixed tier of a category's scope range a price falls in.
 *
 * Equal-width cuts of [floor, ceiling]. Width, not population: a tier holding
 * nothing stays empty, and the ceiling itself lands in the last tier rather
 * than falling off the end.
 */
export function scopeTierOf(price: number, scope: CategoryPriceScope, tiers = COVERAGE_TIER_COUNT): number {
  const span = scope.ceilingUsd - scope.floorUsd;
  if (!(span > 0)) return 0;
  const tier = Math.floor(((price - scope.floorUsd) / span) * tiers);
  return Math.min(Math.max(tier, 0), tiers - 1);
}

/**
 * Consolidates duplicate listings of one product down to its cheapest, then
 * fills `quota` from the survivors by cycling coverage groups.
 *
 * `isTaken` excludes candidates already claimed by an earlier category, so the
 * cross-category uniqueness the published schema requires is decided BEFORE
 * ranking rather than by trimming afterwards — trimming afterwards would let
 * an excluded listing occupy a slot a publishable one should have had.
 */
export function selectBestListings(
  candidates: readonly AffiliatePart[],
  quota: number,
  scope: CategoryPriceScope,
  isTaken: (part: AffiliatePart) => boolean = () => false,
): ListingSelection {
  const considered = candidates.filter((part) => !isTaken(part));

  // 1. Scope, before anything competes for a slot.
  const outOfScope: Record<string, number> = {};
  const eligible: AffiliatePart[] = [];
  for (const part of considered) {
    const verdict = scopeVerdict(part, scope);
    if (verdict.inScope) eligible.push(part);
    else outOfScope[verdict.reason] = (outOfScope[verdict.reason] ?? 0) + 1;
  }

  // 2. One representative per product: the cheapest listing of it.
  const byIdentity = new Map<string, AffiliatePart>();
  for (const part of eligible) {
    const key = listingIdentity(part);
    const held = byIdentity.get(key);
    if (held === undefined || compareListings(part, held) < 0) byIdentity.set(key, part);
  }
  const representatives = [...byIdentity.values()].sort(compareListings);

  // 3. Coverage groups: verified attribute when every candidate has one,
  //    fixed scope tiers otherwise. All-or-nothing on purpose — a category
  //    where only some listings carry the attribute would otherwise get a
  //    silent mixture of two policies, and the published spread would depend
  //    on how much of the feed the matcher happened to identify.
  const attributed = representatives.length > 0
    && representatives.every((part) => verifiedCoverageKey(part) !== null);
  const groupKey = attributed
    ? (part: AffiliatePart) => verifiedCoverageKey(part) as string
    : (part: AffiliatePart) => String(scopeTierOf(part.salePrice ?? part.retailPrice, scope));

  const groups = new Map<string, AffiliatePart[]>();
  for (const part of representatives) {
    const key = groupKey(part);
    const held = groups.get(key);
    if (held === undefined) groups.set(key, [part]);
    else held.push(part);
  }
  // Groups are visited in a fixed order — by their key — so the outcome does
  // not depend on which group the feed happened to mention first.
  const ordered = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, parts]) => parts);

  // 4. Cheapest-first within each group, cycling groups, until the quota is
  //    met. A group that runs out is skipped; nothing is drawn in from
  //    elsewhere to keep a slot count even.
  const selected: AffiliatePart[] = [];
  for (let round = 0; selected.length < quota; round += 1) {
    let tookAny = false;
    for (const group of ordered) {
      if (selected.length >= quota) break;
      const next = group[round];
      if (next === undefined) continue;
      selected.push(next);
      tookAny = true;
    }
    if (!tookAny) break;
  }

  return {
    selected,
    considered: considered.length,
    outOfScope,
    distinctProducts: representatives.length,
    consolidated: eligible.length - representatives.length,
    coverage: attributed ? 'verified-attribute' : 'scope-tier',
    coverageGroups: ordered.length,
  };
}
