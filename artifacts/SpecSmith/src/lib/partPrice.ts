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
import { CATALOGUE_PRICE_DATE, catalogueSourceOf } from './prices';

export type PartPrice =
  | {
      provenance: 'editorial-estimate';
      /** US dollars, from the SpecSmith catalogue. */
      amount: number;
      /**
       * When this source's prices were last revised, or null when no revision
       * date is documented for it. Null is an explicit "undated", not a
       * missing value: the label then says "SpecSmith estimate" and makes no
       * claim about when.
       */
      catalogueDate: string | null;
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
 * one. A missing, non-finite or non-positive amount is malformed data, not a
 * free part, and shows no figure.
 *
 * `catalogueDate` is the source's documented revision date, or null for a
 * source with none. Anything else (undefined, a blank string, a non-string)
 * is a caller bug, and it is refused rather than read as either.
 */
export function editorialEstimatePrice(amount: unknown, catalogueDate: string | null): PartPrice {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return UNKNOWN_PART_PRICE;
  if (catalogueDate !== null && (typeof catalogueDate !== 'string' || catalogueDate.trim() === '')) return UNKNOWN_PART_PRICE;
  return { provenance: 'editorial-estimate', amount, catalogueDate };
}

/**
 * A catalogue estimate for a part in a Builder category, dated by the ONE
 * source-to-date rule in prices.ts. An unrecognised category has no known
 * source, so its figure is 'unknown' rather than an estimate of unknown origin.
 */
export function catalogueEstimatePrice(category: string, amount: unknown): PartPrice {
  const source = catalogueSourceOf(category);
  if (source === null) return UNKNOWN_PART_PRICE;
  return editorialEstimatePrice(amount, CATALOGUE_PRICE_DATE[source]);
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
      detail: price.catalogueDate === null ? 'SpecSmith estimate' : `SpecSmith estimate · updated ${price.catalogueDate}`,
      accessible: price.catalogueDate === null
        ? `estimated ${amount}, a SpecSmith catalogue estimate, not a retailer price`
        : `estimated ${amount}, a SpecSmith catalogue estimate updated ${price.catalogueDate}, not a retailer price`,
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

/**
 * A figure in a build summary: a catalogue price with its provenance, or a
 * price the shopper typed in for a custom part. The two are kept apart so a
 * total can say what it is made of.
 */
export type SummaryPrice =
  | { kind: 'catalogue'; price: PartPrice }
  | { kind: 'user-entered'; amount: number };

const wholeDollars = (amount: number) => `$${amount.toLocaleString('en-US')}`;

/** What one summary row shows for its figure. */
export function describeSummaryPrice(price: SummaryPrice): { text: string; accessible: string } {
  if (price.kind === 'user-entered') {
    const amount = wholeDollars(price.amount);
    return { text: `${amount} (your price)`, accessible: `${amount}, a price you entered` };
  }
  const label = describePartPrice(price.price);
  return { text: label.primary, accessible: label.accessible };
}

export interface SummaryTotal {
  /** The figure summed: included estimates plus entered prices. */
  amount: number;
  /** "Estimated total", "Known-price subtotal", "Total of your prices" or "Total". */
  label: string;
  /** The figure as shown, "Est. $X" whenever an estimate is in it. */
  amountText: string;
  /** What the figure contains and what it leaves out. Null when nothing is selected. */
  note: string | null;
  includesEstimates: boolean;
}

/**
 * Totals a build summary honestly.
 *
 * - Catalogue estimates and entered prices are summed, and the label says
 *   which kinds are in it. Any estimate makes the whole figure an estimate.
 * - A date is given only when EVERY estimate in the sum is from a source that
 *   date covers. One undated estimate in the sum and no date is claimed.
 * - An item with no usable figure is excluded and named, never counted as
 *   zero, and the label becomes a subtotal.
 * - A retailer observation is never added to catalogue estimates. It is
 *   excluded and named, so the two kinds of number cannot be blended.
 */
export function summarizeSummaryPrices(rows: readonly { label: string; price: SummaryPrice }[]): SummaryTotal {
  let amount = 0;
  let estimates = 0;
  let entered = 0;
  const dates = new Set<string | null>();
  const missing: string[] = [];
  const retailer: string[] = [];

  for (const { label, price } of rows) {
    if (price.kind === 'user-entered') {
      amount += price.amount;
      entered += 1;
      continue;
    }
    const partPrice = price.price;
    if (partPrice.provenance === 'editorial-estimate') {
      amount += partPrice.amount;
      estimates += 1;
      dates.add(partPrice.catalogueDate);
    } else if (partPrice.provenance === 'retailer-observation') {
      retailer.push(label);
    } else {
      missing.push(label);
    }
  }

  const excludedCount = missing.length + retailer.length;
  if (rows.length === 0) {
    return { amount: 0, label: 'Total', amountText: wholeDollars(0), note: null, includesEstimates: false };
  }

  const label = excludedCount > 0
    ? 'Known-price subtotal'
    : estimates > 0 ? 'Estimated total' : 'Total of your prices';
  const amountText = estimates > 0 ? `Est. ${wholeDollars(amount)}` : wholeDollars(amount);

  // What is IN the figure, then what is left out of it.
  const included: string[] = [];
  if (estimates > 0) {
    const [only] = [...dates];
    const dated = dates.size === 1 && only !== null ? ` · updated ${only}` : '';
    included.push(`${estimates === 1 ? 'SpecSmith estimate' : 'SpecSmith estimates'}${dated}`);
  }
  if (entered > 0) included.push(`${entered} ${entered === 1 ? 'price' : 'prices'} you entered`);
  const excluded: string[] = [];
  if (missing.length > 0) excluded.push(`excludes ${missing.join(', ')} (no catalogue price)`);
  if (retailer.length > 0) excluded.push(`excludes ${retailer.join(', ')} (retailer price, shown separately)`);
  const note = [included.join(' + '), ...excluded].filter(Boolean).join('; ');

  return {
    amount: Number(amount.toFixed(2)),
    label,
    amountText,
    note: note === '' ? null : note,
    includesEstimates: estimates > 0,
  };
}
