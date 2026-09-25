// What a part card may say about money, decided ONCE, from where the number
// came from (#156).
//
// PartCard and PartSelector used to receive a bare `price_usd` and print
// "$669". A bare number carries no provenance, so the card could not know
// whether it was showing SpecSmith's own catalogue estimate or a price a
// retailer published at a known moment, and it guessed "real price" by
// default. The Builder's offline fallback, the one caller that shows prices,
// passes canonical catalogue records, which the rest of the codebase already
// treats as editorial estimates (see Builder.tsx `estimatedPrice`,
// offerSnapshot.ts, importedBuild.ts). The card called them prices anyway.
//
// So a card no longer takes a number. It takes a PartPrice, which says where
// the number came from, and the wording follows from that alone:
//
//  - 'editorial-estimate': SpecSmith's catalogue figure. Shown as "Est. $X",
//    with the catalogue date.
//  - 'retailer-observation': a listing a merchant published, read at a
//    recorded instant. Shown as that merchant's price with its "Price
//    checked" time while fresh. Past the freshness window NO number is shown,
//    by the same rule the retail builder uses (priceView).
//  - 'unknown': neutral wording, no number.
//
// Nothing here looks at the size of a number, a link, a title or a URL to
// decide what it is. A caller that cannot say where a price came from gets
// 'unknown', and 'unknown' never shows a figure.

import {
  formatAmount,
  formatCheckedAt,
  priceView,
  STALE_PRICE_LABEL,
  type PriceView,
} from './retail/partPricing';
import type { AffiliatePart } from './retail/partCatalog';

export type PartPrice =
  | {
      provenance: 'editorial-estimate';
      /** US dollars, from the SpecSmith catalogue. */
      amount: number;
      /** When the catalogue's prices were last revised, e.g. PRICES_UPDATED. */
      catalogueDate: string;
    }
  | {
      provenance: 'retailer-observation';
      merchant: string;
      /** The freshness verdict for this listing, from priceView. */
      view: PriceView;
    }
  | { provenance: 'unknown' };

export const UNKNOWN_PART_PRICE: PartPrice = Object.freeze({ provenance: 'unknown' });

/** Shown wherever no figure can honestly be given. */
export const NO_PRICE_LABEL = 'Price at retailer';

/**
 * A SpecSmith catalogue estimate, or 'unknown' when the record cannot support
 * one. A missing, non-finite or non-positive amount, or a missing catalogue
 * date, is malformed data, not a free part, and shows no figure.
 */
export function editorialEstimatePrice(amount: unknown, catalogueDate: string): PartPrice {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return UNKNOWN_PART_PRICE;
  if (typeof catalogueDate !== 'string' || catalogueDate.trim() === '') return UNKNOWN_PART_PRICE;
  return { provenance: 'editorial-estimate', amount, catalogueDate };
}

/** A retailer listing's price, judged fresh or stale at `now`. */
export function retailerObservationPrice(part: AffiliatePart, now: number): PartPrice {
  return { provenance: 'retailer-observation', merchant: part.merchant, view: priceView(part, now) };
}

export interface PartPriceLabel {
  /** The large figure or phrase. */
  primary: string;
  /** The small line that says where it came from, or null. */
  detail: string | null;
  /** The whole statement for assistive technology, qualifier included. */
  accessible: string;
  /** Whether a monetary figure is shown at all. */
  showsAmount: boolean;
  provenance: PartPrice['provenance'];
}

const estimateAmount = (amount: number) => `$${amount.toLocaleString('en-US')}`;

/** The words a card uses for a price. The only place that decides them. */
export function describePartPrice(price: PartPrice | undefined): PartPriceLabel {
  if (!price || price.provenance === 'unknown') {
    return {
      primary: NO_PRICE_LABEL,
      detail: null,
      accessible: 'no price shown; check the retailer',
      showsAmount: false,
      provenance: 'unknown',
    };
  }

  if (price.provenance === 'editorial-estimate') {
    const amount = estimateAmount(price.amount);
    return {
      primary: `Est. ${amount}`,
      detail: `SpecSmith estimate · updated ${price.catalogueDate}`,
      accessible: `estimated ${amount}, a SpecSmith catalogue estimate updated ${price.catalogueDate}, not a retailer price`,
      showsAmount: true,
      provenance: 'editorial-estimate',
    };
  }

  const { merchant, view } = price;
  if (view.status !== 'fresh') {
    return {
      primary: STALE_PRICE_LABEL,
      detail: null,
      accessible: `no current price shown; ${STALE_PRICE_LABEL}`,
      showsAmount: false,
      provenance: 'retailer-observation',
    };
  }
  const amount = formatAmount(view.displayAmount, view.currency);
  const checked = formatCheckedAt(view.checkedAt);
  const was = view.strikeThroughAmount === null ? '' : `, was ${formatAmount(view.strikeThroughAmount, view.currency)}`;
  return {
    primary: amount,
    detail: `${merchant} · ${checked}`,
    accessible: `${amount} at ${merchant}${was}, ${checked.charAt(0).toLowerCase()}${checked.slice(1)}`,
    showsAmount: true,
    provenance: 'retailer-observation',
  };
}

/**
 * The amount behind a price, for ordering only, when one may be shown.
 *
 * A withheld price (stale, unknown) has no amount here either, so sorting or
 * ranking cannot quietly lean on a number the card refuses to display.
 */
export function comparablePriceAmount(price: PartPrice | undefined): number | null {
  if (!price) return null;
  if (price.provenance === 'editorial-estimate') return price.amount;
  if (price.provenance === 'retailer-observation' && price.view.status === 'fresh') return price.view.displayAmount;
  return null;
}
