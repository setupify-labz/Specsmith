// Browser-safe schema for the retail catalog: image, tracked link, and the
// merchant's own price as published at a stated instant.
//
// PRICES ARE HERE NOW, AND THEY WERE NOT BEFORE.
// ----------------------------------------------
// Version 1 of this file omitted prices, on the reasoning that a price cannot
// stay true for the lifetime of a committed static catalog. That reasoning was
// right about the danger and wrong about the remedy: the answer to "a number
// goes stale" is not "publish no number", it is "publish the number with the
// instant it was read, refresh it daily, and HIDE it the moment it is older
// than the window". All three of those now exist — the refresh workflow, the
// `fetchedAt` on every part, and `partPricing.ts`'s freshness rule — so a
// price can be shown honestly. Availability still cannot: the feed is a
// catalogue of listings, not an inventory, so `availability` remains the
// literal 'unknown' and no code here may say otherwise.
//
// A PRICE BELONGS TO A SKU, NEVER TO A MODEL
// ------------------------------------------
// `retailPrice` is a field of one merchant listing. A canonical part (an "RTX
// 5090") is not a thing anyone can buy — dozens of SKUs carry that model at
// different prices — so a canonical row must never display one. That is
// enforced by shape: the price lives on AffiliatePart, which IS a SKU, and no
// canonical grouping in the UI may lift it upward.
//
// The merchant page remains the source of truth after a click.

import { AVAILABILITY_UNKNOWN, isHttpUrl, isInstant, isTrackedAffiliateUrl } from './offerSnapshot';

/**
 * Bumped from 1 to 2 when prices became part of the shape.
 *
 * A version-1 catalogue — every one published before this change — is now
 * REFUSED rather than read as a priceless catalogue. That is deliberate: a
 * reader that silently accepted the old shape would render 500 cards with no
 * prices and no explanation, which looks like a pricing outage rather than a
 * catalogue that predates pricing.
 */
export const AFFILIATE_PART_CATALOG_SCHEMA_VERSION = 3;
export const AFFILIATE_PART_CATALOG_URL = '/data/retail-parts.json';
export const AFFILIATE_PART_TARGET = 500;

export const RETAIL_PART_CATEGORIES = [
  'gpu',
  'cpu',
  'motherboard',
  'ram',
  'storage',
  'psu',
  'case',
  'cooler',
  'monitor',
  'keyboard',
  'mouse',
  'headset',
] as const;

export type RetailPartCategory = (typeof RETAIL_PART_CATEGORIES)[number];

export const AFFILIATE_PART_CATEGORY_TARGETS: Readonly<Record<RetailPartCategory, number>> = {
  gpu: 80,
  cpu: 55,
  motherboard: 45,
  ram: 45,
  storage: 55,
  psu: 35,
  case: 35,
  cooler: 35,
  monitor: 40,
  keyboard: 25,
  mouse: 25,
  headset: 25,
};

export interface AffiliatePart {
  /** Stable, repository-safe identity derived from category + Newegg SKU. */
  id: string;
  category: RetailPartCategory;
  merchant: 'Newegg';
  /** Merchant title, unchanged. */
  name: string;
  imageUrl: string;
  /** Network-generated redirect; attribution is already encoded in it. */
  trackedAffiliateUrl: string;
  /**
   * When this listing — including its price — was read from the feed.
   *
   * This is the "Price checked" instant the card shows, and the value the
   * freshness rule measures. A price without one is not evidence.
   */
  fetchedAt: string;
  availability: typeof AVAILABILITY_UNKNOWN;
  /** The merchant's list price for THIS SKU. Always finite and above zero. */
  retailPrice: number;
  /**
   * The discounted price, or null when nothing is discounted.
   *
   * Null is the normal case. The feed writes `saleprice=0` to mean "no sale
   * running", which the adapter normalizes to null at the parse boundary — a
   * stored 0 would make every un-discounted part look free. When present it is
   * strictly LOWER than retailPrice, so a card can strike the retail price
   * through without checking first: a "sale" that is not lower is not a sale,
   * and this schema will not carry one.
   */
  salePrice: number | null;
  /** ISO 4217, exactly three uppercase letters, as the merchant published it. */
  currency: string;
  /** Present only when the existing SpecSmith catalog verified the specs. */
  canonicalPartId: string | null;
  specsVerified: boolean;
  /**
   * How much of the merchant's image the product itself spans, 0 to 1.
   *
   * Retailer photographs are not framed consistently: one arrives cropped to
   * the card, the next sits in a wide margin of white. Both pass every check
   * on the <img> element — same box, same aspect, nothing stretched — and yet
   * one product looks half the size of the other on screen. The difference is
   * inside the raster, so it can only be measured by looking at the pixels.
   *
   * This is the larger of the content box's width and height as a fraction of
   * the image's own width and height: 1.0 for a photograph that fills its
   * frame, ~0.5 for one that occupies the middle of a blank field. The card
   * uses it to enlarge the sparse ones until the products themselves are a
   * comparable size, which moves the surplus margin out of view without
   * touching the product.
   *
   * Null means unmeasured — an image that could not be fetched, a format
   * without a decoder, or content too far off-centre to enlarge safely. The
   * card treats null as "frame it exactly as it arrived".
   */
  imageContentRatio: number | null;
}

/** Why a listing's pricing was refused. A closed set, so a test can name each case. */
export type PricingProblem =
  /** Missing, non-numeric, NaN or Infinite retail price. */
  | 'retail-price-not-a-number'
  /** Zero or negative. Neither is a price. */
  | 'retail-price-not-positive'
  /** A sale price that is present but not a positive finite number. */
  | 'sale-price-invalid'
  /** A sale price at or above the retail price — not a discount. */
  | 'sale-price-not-lower'
  /** Currency absent, lowercase, padded, or not three letters. */
  | 'currency-invalid';

const isPositiveAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** ISO 4217: exactly three uppercase letters. Anchored, so 'xUSD' is refused. */
export const CATALOG_CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Checks the three pricing fields together, or names what is wrong.
 *
 * Together, because they constrain each other: a sale price is only meaningful
 * relative to a retail price, and both are only meaningful under a currency.
 * Exported so the price rules can be tested directly rather than inferred from
 * whether a whole 500-part catalogue happened to parse.
 */
export function checkPartPricing(raw: {
  retailPrice?: unknown;
  salePrice?: unknown;
  currency?: unknown;
}): { ok: true } | { ok: false; problem: PricingProblem } {
  const { retailPrice, salePrice, currency } = raw;
  if (typeof retailPrice !== 'number' || Number.isNaN(retailPrice) || !Number.isFinite(retailPrice)) {
    return { ok: false, problem: 'retail-price-not-a-number' };
  }
  if (retailPrice <= 0) return { ok: false, problem: 'retail-price-not-positive' };
  if (typeof currency !== 'string' || !CATALOG_CURRENCY_PATTERN.test(currency)) {
    return { ok: false, problem: 'currency-invalid' };
  }
  if (salePrice !== null) {
    if (!isPositiveAmount(salePrice)) return { ok: false, problem: 'sale-price-invalid' };
    if (salePrice >= retailPrice) return { ok: false, problem: 'sale-price-not-lower' };
  }
  return { ok: true };
}

export interface AffiliatePartCatalog {
  schemaVersion: number;
  generatedAt: string;
  merchant: 'Newegg';
  availability: typeof AVAILABILITY_UNKNOWN;
  parts: AffiliatePart[];
}

export type AffiliateCatalogProblem =
  | 'not-an-object'
  | 'schema-version-unsupported'
  | 'generated-at-invalid'
  | 'merchant-invalid'
  | 'availability-not-unknown'
  | 'parts-not-an-array'
  | 'part-count-invalid'
  | 'part-invalid'
  | 'duplicate-part-id'
  | 'duplicate-part-name'
  | 'duplicate-affiliate-url'
  | 'category-count-invalid';

export type AffiliateCatalogParse =
  | { ok: true; catalog: AffiliatePartCatalog }
  | { ok: false; problem: AffiliateCatalogProblem };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** A measured fraction of an image frame: finite, above zero, at most one. */
const isContentRatio = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;

const isCategory = (value: unknown): value is RetailPartCategory =>
  typeof value === 'string' && (RETAIL_PART_CATEGORIES as readonly string[]).includes(value);

function parsePart(raw: unknown): AffiliatePart | null {
  if (!isObject(raw)) return null;
  const { id, category, merchant, name, imageUrl, trackedAffiliateUrl, fetchedAt, availability, retailPrice, salePrice, currency, canonicalPartId, specsVerified, imageContentRatio } = raw;
  if (!isText(id) || !/^newegg-[a-z]+-[a-z0-9-]+$/.test(id)) return null;
  if (!isCategory(category) || merchant !== 'Newegg' || !isText(name)) return null;
  if (!isHttpUrl(imageUrl) || !isTrackedAffiliateUrl(trackedAffiliateUrl)) return null;
  if (!isInstant(fetchedAt) || availability !== AVAILABILITY_UNKNOWN) return null;
  // A part without a trustworthy price is not published at all — the generator
  // rejects the candidate and picks another. So by the time a catalogue is
  // read, every part has one, and a missing price is a corrupt file.
  if (!checkPartPricing({ retailPrice, salePrice, currency }).ok) return null;
  if (category === 'gpu') {
    if (!isText(canonicalPartId) || specsVerified !== true) return null;
  } else if (canonicalPartId !== null || specsVerified !== false) {
    return null;
  }
  // Absent is not the same as unmeasured-and-recorded, but both mean the same
  // thing to a card, so an older file missing the field reads as null rather
  // than being rejected. A present value must be a real fraction.
  if (imageContentRatio !== undefined && imageContentRatio !== null && !isContentRatio(imageContentRatio)) return null;
  return {
    id,
    category,
    merchant: 'Newegg',
    name,
    imageUrl: imageUrl as string,
    trackedAffiliateUrl: trackedAffiliateUrl as string,
    fetchedAt,
    availability: AVAILABILITY_UNKNOWN,
    retailPrice: retailPrice as number,
    salePrice: (salePrice ?? null) as number | null,
    currency: currency as string,
    canonicalPartId: canonicalPartId as string | null,
    specsVerified,
    imageContentRatio: (imageContentRatio ?? null) as number | null,
  };
}

export function parseAffiliatePartCatalog(raw: unknown): AffiliateCatalogParse {
  if (!isObject(raw)) return { ok: false, problem: 'not-an-object' };
  if (raw.schemaVersion !== AFFILIATE_PART_CATALOG_SCHEMA_VERSION) {
    return { ok: false, problem: 'schema-version-unsupported' };
  }
  if (!isInstant(raw.generatedAt)) return { ok: false, problem: 'generated-at-invalid' };
  if (raw.merchant !== 'Newegg') return { ok: false, problem: 'merchant-invalid' };
  if (raw.availability !== AVAILABILITY_UNKNOWN) return { ok: false, problem: 'availability-not-unknown' };
  if (!Array.isArray(raw.parts)) return { ok: false, problem: 'parts-not-an-array' };
  if (raw.parts.length !== AFFILIATE_PART_TARGET) return { ok: false, problem: 'part-count-invalid' };

  const parts: AffiliatePart[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const affiliateUrls = new Set<string>();
  const categoryCounts = Object.fromEntries(
    RETAIL_PART_CATEGORIES.map((category) => [category, 0]),
  ) as Record<RetailPartCategory, number>;
  for (const candidate of raw.parts) {
    const part = parsePart(candidate);
    if (!part) return { ok: false, problem: 'part-invalid' };
    if (ids.has(part.id)) return { ok: false, problem: 'duplicate-part-id' };
    const normalizedName = part.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (names.has(normalizedName)) return { ok: false, problem: 'duplicate-part-name' };
    if (affiliateUrls.has(part.trackedAffiliateUrl)) return { ok: false, problem: 'duplicate-affiliate-url' };
    ids.add(part.id);
    names.add(normalizedName);
    affiliateUrls.add(part.trackedAffiliateUrl);
    categoryCounts[part.category] += 1;
    parts.push(part);
  }
  if (RETAIL_PART_CATEGORIES.some(
    (category) => categoryCounts[category] !== AFFILIATE_PART_CATEGORY_TARGETS[category],
  )) return { ok: false, problem: 'category-count-invalid' };
  return {
    ok: true,
    catalog: {
      schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
      generatedAt: raw.generatedAt as string,
      merchant: 'Newegg',
      availability: AVAILABILITY_UNKNOWN,
      parts,
    },
  };
}
