// One <item> element -> an accepted NeweggOffer or a reasoned rejection.
//
// Pure and deterministic: no I/O, no clock, no randomness. `fetchedAt` is
// passed in rather than read from Date.now() precisely so this stays
// testable byte-for-byte — a function that stamps its own timestamp cannot be
// asserted against a fixture.

import { classifyListing } from './listingKind';
import { verifyGpuModel } from './gpuModelMatch';
import { childText, readPrice, type XmlElement, child } from './parseProductSearchXml';
import {
  NEWEGG_MID,
  RAKUTEN_ADAPTER_VERSION,
  REQUIRED_CATEGORY_LEAF,
  SECONDARY_CATEGORY_DELIMITER,
  type CatalogGpu,
  type OfferAdmission,
  type OfferRejectionReason,
  type RejectedOffer,
} from './types';

/**
 * `<description><short>`, or null.
 *
 * A separate reader rather than an inline lookup because it is nested two deep
 * and its absence is normal — a listing with no short description is a listing
 * whose capacity must come from the title, not a broken record.
 */
export function readShortDescription(item: XmlElement): string | null {
  const description = child(item, 'description');
  return description ? childText(description, 'short') : null;
}

export interface ListingCategory {
  primary: string | null;
  secondary: string | null;
  /** Final segment of the secondary path — the actual leaf the item sits in. */
  secondaryLeaf: string | null;
}

/**
 * Both category fields, kept apart.
 *
 * `<primary>` is a department ("Computers"); `<secondary>` is the delimited
 * path whose last segment is the leaf. They are preserved separately on the
 * record rather than collapsed into one string, because collapsing them loses
 * the only distinction that makes either useful: the department is too coarse
 * to gate on, and the leaf is the thing that says "this is a graphics card".
 */
export function readCategory(item: XmlElement): ListingCategory {
  const cat = child(item, 'category');
  if (!cat) return { primary: null, secondary: null, secondaryLeaf: null };
  const primary = childText(cat, 'primary');
  const secondary = childText(cat, 'secondary');
  return { primary, secondary, secondaryLeaf: secondaryCategoryLeaf(secondary) };
}

/**
 * The last segment of a delimited secondary path.
 *
 * Exact segment equality, never `includes`. A substring test would admit
 * "Video Cards & Adapters~~Accessories" — the aisle the cables and brackets
 * are in — which is precisely the sibling leaf this gate exists to exclude.
 */
export function secondaryCategoryLeaf(secondary: string | null): string | null {
  if (secondary === null) return null;
  const segments = secondary
    .split(SECONDARY_CATEGORY_DELIMITER)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return segments.length === 0 ? null : segments[segments.length - 1];
}

function reject(reason: OfferRejectionReason, detail: string, sku: string | null, productName: string | null): RejectedOffer {
  return { status: 'rejected', reason, detail, sku, productName };
}

/**
 * Admits one listing for one catalog GPU.
 *
 * GATE ORDER (first failure wins, and this order is asserted by a test):
 *   1. merchant id           — wrong merchant means a mis-issued query
 *   2. category              — what KIND of thing the merchant says this is
 *   3. required fields       — nothing downstream can work without these
 *   4. listing kind/condition— accessory, laptop, prebuilt, not-new
 *   5. GPU model             — model, variant suffix, memory capacity
 *   6. prices                — parseable, non-negative, currency present
 *
 * Kind is checked BEFORE model on purpose: an "RTX 5090 power cable" names the
 * model perfectly, and the true statement about it is that it is a cable.
 */
export function admitOffer(item: XmlElement, gpu: CatalogGpu, fetchedAt: string): OfferAdmission {
  const sku = childText(item, 'sku');
  const productName = childText(item, 'productname');

  const mid = childText(item, 'mid');
  if (mid !== NEWEGG_MID) {
    return reject('merchant-mismatch', `Merchant id ${JSON.stringify(mid)} is not Newegg (${NEWEGG_MID}).`, sku, productName);
  }

  const category = readCategory(item);
  if (category.secondaryLeaf !== REQUIRED_CATEGORY_LEAF) {
    return reject(
      'category-mismatch',
      `Secondary category ${JSON.stringify(category.secondary)} has leaf ${JSON.stringify(category.secondaryLeaf)}, not ${JSON.stringify(REQUIRED_CATEGORY_LEAF)}.`,
      sku,
      productName,
    );
  }

  if (!sku) return reject('incomplete-record', 'No <sku>: the listing has no identity to record.', sku, productName);
  if (!productName) return reject('incomplete-record', 'No <productname>: nothing to verify the model against.', sku, productName);

  const imageUrl = childText(item, 'imageurl');
  if (!imageUrl) return reject('incomplete-record', 'No <imageurl>.', sku, productName);

  const trackedAffiliateUrl = childText(item, 'linkurl');
  if (!trackedAffiliateUrl) {
    return reject('incomplete-record', 'No <linkurl>: without the tracked deep link the offer earns nothing and must not be shown.', sku, productName);
  }
  if (!/^https:\/\/(click|www)\.linksynergy\.com\//i.test(trackedAffiliateUrl)) {
    // An untracked newegg.com URL in this field means attribution is already
    // lost. Storing it would produce a buy button that silently earns nothing,
    // which is worse than having no button.
    return reject('incomplete-record', '<linkurl> is not a linksynergy tracked URL; attribution would be lost.', sku, productName);
  }

  const kind = classifyListing(productName);
  if (kind.issue) return reject(kind.issue, kind.detail, sku, productName);

  // The short description is merchant-supplied evidence about the SAME item,
  // and on real listings it is where the memory size actually appears. It is
  // read for capacity only, and `productName` below is still the feed's value
  // untouched — nothing from the description is merged into the stored title.
  const shortDescription = readShortDescription(item);
  const model = verifyGpuModel({ productName, shortDescription }, gpu);
  if (!model.ok) return reject(model.reason, model.detail, sku, productName);

  const price = readPrice(item, 'price');
  if (!price || price.amount === null) {
    return reject('incomplete-record', 'No parseable <price>.', sku, productName);
  }
  if (price.amount <= 0) {
    return reject('incomplete-record', `<price> is ${price.amount}; a retail price of zero or less is not a price.`, sku, productName);
  }
  if (!price.currency) {
    return reject('incomplete-record', '<price> carries no currency attribute; an unlabelled amount is not a price.', sku, productName);
  }

  // THE ZERO RULE. Rakuten writes 0.00 for "no sale running". That is absence,
  // not a free graphics card, and it is normalized to null here — at the only
  // place that reads the raw element — so no downstream consumer can ever see
  // the 0 and treat it as the lower of the two prices.
  const sale = readPrice(item, 'saleprice');
  let salePrice: number | null = null;
  if (sale) {
    if (sale.amount === null && child(item, 'saleprice')!.text.trim() !== '') {
      return reject('incomplete-record', 'A <saleprice> is present but unparseable; refusing rather than dropping a discount silently.', sku, productName);
    }
    if (sale.amount !== null && sale.amount < 0) {
      return reject('incomplete-record', `<saleprice> is negative (${sale.amount}).`, sku, productName);
    }
    if (sale.amount !== null && sale.amount > 0) {
      // A sale price with no currency of its own used to inherit the retail
      // price's. That is an assumption about money made on the feed's behalf:
      // the whole reason `currency` is a per-element attribute is that the two
      // elements can differ, and a discount silently relabelled into the wrong
      // currency is a wrong price that looks entirely normal.
      if (!sale.currency) {
        return reject('incomplete-record', '<saleprice> is positive but carries no currency attribute; refusing to assume it is the retail price\'s currency.', sku, productName);
      }
      if (sale.currency !== price.currency) {
        return reject('incomplete-record', `<saleprice> currency ${sale.currency} disagrees with <price> currency ${price.currency}.`, sku, productName);
      }
      salePrice = sale.amount;
    }
  }

  return {
    status: 'accepted',
    sku,
    upc: childText(item, 'upccode'),
    productName,
    categoryPrimary: category.primary,
    categorySecondary: category.secondary!,
    categorySecondaryLeaf: REQUIRED_CATEGORY_LEAF,
    retailPrice: price.amount,
    salePrice,
    currency: price.currency,
    imageUrl,
    trackedAffiliateUrl,
    canonicalGpuId: gpu.id,
    mid,
    fetchedAt,
    adapterVersion: RAKUTEN_ADAPTER_VERSION,
  };
}

/** Admits a whole response. Accepted and rejected are both returned — nothing is dropped silently. */
export function admitOffers(items: readonly XmlElement[], gpu: CatalogGpu, fetchedAt: string): OfferAdmission[] {
  return items.map((item) => admitOffer(item, gpu, fetchedAt));
}
