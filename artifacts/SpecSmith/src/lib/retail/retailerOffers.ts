/**
 * Which retailers a listing can honestly be bought from.
 *
 * THE AUDIT THAT PRODUCED THIS FILE. The review asked for a "View at Amazon"
 * choice beside "View at Newegg", conditional on verified Amazon offer data
 * existing. It does not. The repository was searched for ASINs, Amazon product
 * URLs, Amazon prices and affiliate configuration, and what exists is:
 *
 *   - `AMAZON_AFFILIATE_TAG = 'specsmithpc-20'` in src/lib/fps.ts, whose own
 *     comment says it is a placeholder "until the SpecSmith Amazon Associates
 *     account is approved".
 *   - `getAffiliateUrl(partName)`, which builds
 *     `amazon.com/s?k=<name>&tag=<placeholder>` — a SEARCH URL. It resolves to
 *     a results page, not to a product, and which product a shopper lands on
 *     depends on Amazon's ranking that day.
 *   - Zero ASINs. Zero Amazon product URLs. Zero Amazon prices. No Amazon
 *     entry in any feed, fixture or snapshot.
 *   - The Rakuten feed is Newegg-only: every item carries Newegg's merchant
 *     id, and the adapter refuses anything else.
 *
 * So an Amazon button on a retail card could only be one of the things the
 * review explicitly ruled out: a fabricated product URL, a search link dressed
 * up as a product link, a guessed ASIN, or Newegg's price shown under Amazon's
 * name. This module therefore models offers as a list and returns exactly one
 * — the Newegg listing the catalogue actually came from.
 *
 * WHAT WOULD BE NEEDED to light Amazon up, stated so it can be acted on:
 *
 *   1. An approved Amazon Associates account and a real tracking tag.
 *   2. Access to Amazon's Product Advertising API (PA-API 5.0), which requires
 *      that account plus qualifying sales.
 *   3. A resolution step mapping each Newegg SKU to an Amazon ASIN by a shared
 *      identifier — the feed's `upccode` is the realistic candidate, present
 *      on 22 of 23 fixture items — with a recorded confidence, never a title
 *      match.
 *   4. Amazon's own price, currency and read-time stored per offer, so the two
 *      retailers' prices carry independent provenance and neither inherits the
 *      other's timestamp.
 *
 * Until all four exist, `offersFor` returns one offer and the card shows one
 * button. That is not a limitation to work around; it is the honest shape of
 * the data.
 */

import type { AffiliatePart } from './partCatalog';

/** A retailer we can link to for a specific listing. */
export type RetailerName = 'Newegg';

export interface RetailerOffer {
  retailer: RetailerName;
  /** The listing this offer belongs to. Offers are never shared between SKUs. */
  partId: string;
  /** The retailer's own tracked URL for this exact product. */
  url: string;
  /** That retailer's own price. Never copied from another retailer. */
  retailPrice: number;
  salePrice: number | null;
  currency: string;
  /** When THIS retailer's price was read. Each offer carries its own instant. */
  fetchedAt: string;
}

/**
 * Every verified offer for a listing.
 *
 * One today, by construction rather than by accident: the catalogue is built
 * from a Newegg-only feed, so a second entry could not be evidenced.
 */
export function offersFor(part: AffiliatePart): RetailerOffer[] {
  return [
    {
      retailer: 'Newegg',
      partId: part.id,
      url: part.trackedAffiliateUrl,
      retailPrice: part.retailPrice,
      salePrice: part.salePrice,
      currency: part.currency,
      fetchedAt: part.fetchedAt,
    },
  ];
}

/**
 * Whether a "View at <retailer>" control may be rendered.
 *
 * The check a future Amazon offer has to pass: the offer must name the exact
 * listing it is shown on. A model-level match is not enough — the whole point
 * of the retail catalogue is that one model has several distinct SKUs at
 * several distinct prices.
 */
export function offerBelongsToPart(offer: RetailerOffer, part: AffiliatePart): boolean {
  return offer.partId === part.id;
}

/** Retailers with no verified offer data, and why. For the UI to explain itself. */
export const UNAVAILABLE_RETAILERS: ReadonlyArray<{ retailer: string; missing: string }> = [
  {
    retailer: 'Amazon',
    missing:
      'No ASIN, product URL or price exists for any listing. The only Amazon code in the repository builds a search URL with a placeholder associates tag, which is not a product link.',
  },
];
