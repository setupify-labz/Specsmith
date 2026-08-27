// Rakuten Advertising Product Search -> Newegg offer records.
//
// SERVER-ONLY. Nothing in this directory may be imported from `src/`: it reads
// RAKUTEN_API_ACCESS_TOKEN out of the process environment, and a bundled
// module holding a publisher access token is a leaked token. The boundary is
// enforced structurally by serverOnly.test.ts, not by convention.
//
// WHAT THIS IS, AND WHAT IT IS NOT
// --------------------------------
// SpecSmith already has two price-shaped things, and this is neither:
//
//   1. `src/data/gpus.json`'s `price_usd` — a hand-maintained planning
//      estimate, refreshed monthly, stamped by `src/lib/prices.ts`'s
//      PRICES_UPDATED. It is an editorial figure about a PART.
//   2. `src/lib/fps.ts`'s getAffiliateUrl/getNeweggUrl — SEARCH links. They
//      build a query string precise enough that the right product is usually
//      the top result; they name no SKU, carry no price, and cannot be wrong
//      about a price because they assert none.
//
// A Rakuten offer is a third thing: one real, dated LISTING for one SKU at one
// merchant, with the retailer's own prices and a pre-tracked deep link. It is
// not an estimate and must never be written back into gpus.json, and it is not
// a search link and must never be produced by getNeweggUrl. Keeping it in its
// own record type is what stops "the RTX 4070 costs $549" (editorial, about a
// part) from being confused with "Newegg listed SKU N82E16814137837 at $529.99
// when we asked, at 14:02 UTC" (observational, about a listing).
//
// EVERY FIELD IS THE MERCHANT'S OWN VALUE
// ---------------------------------------
// Nothing here is repaired, rounded, converted, or inferred. A field the feed
// does not publish is null; a record missing something required is rejected
// whole rather than completed with a guess.

/** Newegg's merchant id in the Rakuten network. Fixed; not configurable. */
export const NEWEGG_MID = '44583';

/**
 * The single Newegg category a discrete graphics card is listed under.
 *
 * Required, not preferred. The category is the only field in the feed that
 * states what KIND of thing a listing is; product names do not reliably say
 * (plenty of cables are named after the card they plug into). Matching on the
 * name alone and hoping is how a $19 power adapter becomes "an RTX 4070 for
 * $19", so a listing whose category is anything else is refused before its
 * name is even read.
 */
export const REQUIRED_CATEGORY = 'Video Cards & Adapters';

/** Product Search endpoint. Version-pinned; a new version gets a new adapter. */
export const PRODUCT_SEARCH_ENDPOINT = 'https://api.linksynergy.com/productsearch/1.0';

/** Environment variable holding the Rakuten publisher access token. */
export const ACCESS_TOKEN_ENV_VAR = 'RAKUTEN_API_ACCESS_TOKEN';

/**
 * Bump on ANY change to parsing or admission rules, so a stored offer built
 * by older rules is detectable rather than silently trusted.
 */
export const RAKUTEN_ADAPTER_VERSION = 1;

/**
 * Why a listing was refused.
 *
 * A closed union rather than free text: these are the reasons a caller may
 * branch on, and an unlisted reason means a rule was added without deciding
 * what it is called. Order of evaluation is fixed and documented on
 * `admitOffer` — a listing can fail several gates, and the reason reported is
 * always the first one it hits.
 */
export type OfferRejectionReason =
  /** Not Newegg. The feed is queried per-merchant, so this is a feed error. */
  | 'merchant-mismatch'
  /** Category is not REQUIRED_CATEGORY. */
  | 'category-mismatch'
  /** A cable, adapter, bracket, riser or other accessory — not a card. */
  | 'not-a-graphics-card'
  /** A laptop (or a laptop GPU) rather than a desktop add-in board. */
  | 'laptop-part'
  /** A whole desktop PC / prebuilt that CONTAINS the card. */
  | 'prebuilt-system'
  /** Refurbished, open-box, used or recertified. The catalog prices new parts. */
  | 'condition-not-new'
  /** No GPU model could be read out of the product name at all. */
  | 'model-not-found'
  /** The name mentions more than one distinct model; which one is on sale is unknowable. */
  | 'model-ambiguous'
  /** A different model entirely (RTX 4070 asked, RTX 4060 listed). */
  | 'model-mismatch'
  /** Same number, different variant: Ti, Super, Ti Super, XT, XTX, GRE. */
  | 'variant-suffix-mismatch'
  /** Same model, different memory size — or a size-disambiguated part with no size stated. */
  | 'memory-capacity-mismatch'
  /** A required field is absent, blank, or unparseable. */
  | 'incomplete-record';

export interface RejectedOffer {
  status: 'rejected';
  reason: OfferRejectionReason;
  /** Human-readable specifics. Never contains credentials. */
  detail: string;
  /** The SKU, when the feed supplied one — null when the record was too broken to have one. */
  sku: string | null;
  productName: string | null;
}

/**
 * One Newegg listing, as Rakuten published it, verified to be the catalog part
 * the caller asked about.
 */
export interface NeweggOffer {
  status: 'accepted';

  /** Newegg's own item number, e.g. "N82E16814137837". The listing's identity. */
  sku: string;
  /** Manufacturer UPC. Frequently absent from the feed; null when it is. */
  upc: string | null;
  /** The merchant's product title, verbatim. Never cleaned up or shortened. */
  productName: string;
  /** The merchant's category string. Always REQUIRED_CATEGORY for an accepted offer. */
  category: string;

  /**
   * The merchant's list price. Rakuten calls this `<price>`; it is what the
   * item costs when nothing is discounted.
   */
  retailPrice: number;
  /**
   * The discounted price, or null when the item is not on sale.
   *
   * THE ZERO RULE: Rakuten writes `<saleprice>0.00</saleprice>` for "no sale
   * running", not "free". Storing that 0 would make every un-discounted card
   * look like the best deal on the site, and a `salePrice ?? retailPrice`
   * reader downstream would silently pick the 0. So a zero sale price is
   * normalized to null — absent, which is what it means — at the parse
   * boundary, before any consumer can see it.
   */
  salePrice: number | null;
  /** ISO 4217 code from the price element's own `currency` attribute. */
  currency: string;

  /** Product image URL as published. */
  imageUrl: string;
  /**
   * The tracked deep link Rakuten generated for this publisher and SKU.
   *
   * Used verbatim. It already carries the publisher/offer identifiers, so
   * appending anything to it, or rebuilding it from parts, breaks attribution.
   * This is also why the adapter never needs to embed an affiliate id of its
   * own: unlike `src/lib/fps.ts`'s search links, the tracking is in the URL
   * the API hands back.
   */
  trackedAffiliateUrl: string;

  /** The SpecSmith catalog GPU id this listing was verified against. */
  canonicalGpuId: string;
  /** Merchant id the listing came from. Always NEWEGG_MID. */
  mid: string;
  /** When the feed was read. ISO 8601, UTC. A price with no timestamp is not evidence. */
  fetchedAt: string;
  adapterVersion: number;
}

export type OfferAdmission = NeweggOffer | RejectedOffer;

/** The minimum a catalog GPU must expose to be matched against a listing. */
export interface CatalogGpu {
  id: string;
  name: string;
  brand: string;
  vram_gb: number;
}
