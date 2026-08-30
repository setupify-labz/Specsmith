// What a card may say about money, and when it must say nothing.
//
// BROWSER-SAFE AND PURE. No I/O, no clock of its own — the caller passes
// `now`, so every rule here is testable without waiting a day.
//
// THE ONE RULE THAT MATTERS
// -------------------------
// A price is a claim about this moment, and the only evidence behind it is the
// instant it was read. Past the freshness window that evidence is gone, so the
// number is not shown at all: no "last known price", no greyed-out figure, no
// asterisk. A stale number rendered with a caveat is still read as a price by
// almost everyone who sees it. The card sends the shopper to the merchant page
// instead, which is the source of truth either way.
//
// WHAT THIS FILE WILL NOT DO
// --------------------------
// It will not compute availability, infer stock from price movement, or emit
// any of the words "in stock", "out of stock" or "available". The feed is a
// catalogue of listings, not an inventory. Availability is unknown, and a
// pricing module is exactly where that would quietly stop being true.

import { DEFAULT_MAX_SNAPSHOT_AGE_MS, MAX_CLOCK_SKEW_MS } from './offerSnapshot';
import type { AffiliatePart } from './partCatalog';

/**
 * How old a price may be and still be shown: the same 26 hours the offer
 * snapshot already uses.
 *
 * Deliberately imported rather than restated. Two freshness windows that drift
 * apart would mean the catalogue and the snapshot disagreeing about whether
 * the same instant is current, and the daily refresh is paced against this
 * one number.
 */
export const PRICE_FRESHNESS_MS = DEFAULT_MAX_SNAPSHOT_AGE_MS;

/** Shown wherever a price is withheld. Never "price unavailable" — that reads as out of stock. */
export const STALE_PRICE_LABEL = 'See current price at Newegg';

/** Shown beside every price, always. The feed cannot support anything stronger. */
export const AVAILABILITY_UNKNOWN_LABEL = 'Availability unknown';

export type PriceView =
  | {
      status: 'fresh';
      /** The number to show large. The sale price when there is one. */
      displayAmount: number;
      /** The struck-through original, present only when a genuine discount applies. */
      strikeThroughAmount: number | null;
      currency: string;
      /** When the price was read. */
      checkedAt: Date;
      ageMs: number;
    }
  /** Older than the window, or stamped in the future. Show STALE_PRICE_LABEL. */
  | { status: 'stale'; reason: 'expired' | 'future-timestamp' | 'unreadable-timestamp' };

/**
 * Decides what one part's card may display.
 *
 * A future timestamp is refused rather than treated as maximally fresh —
 * otherwise the simplest way to make a stale price look current would be to
 * write tomorrow's date on it.
 */
export function priceView(part: AffiliatePart, now: number): PriceView {
  const checked = Date.parse(part.fetchedAt);
  if (!Number.isFinite(checked)) return { status: 'stale', reason: 'unreadable-timestamp' };
  if (checked - now > MAX_CLOCK_SKEW_MS) return { status: 'stale', reason: 'future-timestamp' };

  const ageMs = now - checked;
  if (ageMs > PRICE_FRESHNESS_MS) return { status: 'stale', reason: 'expired' };

  // The schema guarantees salePrice is null or strictly below retailPrice, so
  // the strike-through never has to be justified again here.
  const onSale = part.salePrice !== null;
  return {
    status: 'fresh',
    displayAmount: onSale ? (part.salePrice as number) : part.retailPrice,
    strikeThroughAmount: onSale ? part.retailPrice : null,
    currency: part.currency,
    checkedAt: new Date(checked),
    ageMs,
  };
}

/** Money, in the merchant's own currency. Never a bare number. */
export function formatAmount(amount: number, currency: string, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // An unknown ISO code should degrade to something readable, not throw in a
    // render path.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** "Price checked 30 Aug 2026, 00:29 UTC" — the evidence behind the number. */
export function formatCheckedAt(checkedAt: Date, locale = 'en-US'): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(checkedAt);
  return `Price checked ${formatted} UTC`;
}

/**
 * Why an item contributes no money to the build total.
 *
 * A closed set so the summary can explain the exclusion rather than quietly
 * dropping a line from a sum — a subtotal that silently omits items is worse
 * than no subtotal, because it looks complete.
 */
export type SubtotalExclusion = 'stale-price' | 'editorial-estimate-only';

export interface BuildPriceSummary {
  /**
   * True only when EVERY selected item has a fresh, verified retailer price.
   *
   * The distinction the UI hangs on: a complete subtotal may be labelled a
   * total, an incomplete one may not.
   */
  complete: boolean;
  /** Sum of the fresh verified prices, in `currency`. */
  knownTotal: number;
  /** The currency every counted item shares. Null when nothing is counted. */
  currency: string | null;
  /** How many selected items are in the sum. */
  countedItems: number;
  /** Selected items left out, with the reason each was excluded. */
  excluded: { partId: string; reason: SubtotalExclusion }[];
  /**
   * Set when selected items carry different currencies.
   *
   * Adding them would invent an exchange rate, so nothing is summed at all.
   */
  mixedCurrency: boolean;
}

/**
 * Totals what can honestly be totalled.
 *
 * Items whose price is hidden are EXCLUDED and listed, never counted as zero:
 * a missing price is unknown, and treating unknown as free understates a build
 * by exactly the amount nobody can see.
 */
export function summarizeBuildPrices(parts: readonly AffiliatePart[], now: number): BuildPriceSummary {
  const excluded: { partId: string; reason: SubtotalExclusion }[] = [];
  const currencies = new Set<string>();
  let knownTotal = 0;
  let countedItems = 0;

  for (const part of parts) {
    const view = priceView(part, now);
    if (view.status !== 'fresh') {
      excluded.push({ partId: part.id, reason: 'stale-price' });
      continue;
    }
    currencies.add(view.currency);
    knownTotal += view.displayAmount;
    countedItems += 1;
  }

  const mixedCurrency = currencies.size > 1;
  return {
    complete: excluded.length === 0 && parts.length > 0 && !mixedCurrency,
    knownTotal: mixedCurrency ? 0 : Number(knownTotal.toFixed(2)),
    currency: mixedCurrency || currencies.size === 0 ? null : [...currencies][0],
    countedItems: mixedCurrency ? 0 : countedItems,
    excluded,
    mixedCurrency,
  };
}

/** The label a summary must use for its figure. Never "Total" unless it is one. */
export function subtotalLabel(summary: BuildPriceSummary): string {
  return summary.complete ? 'Current price subtotal' : 'Known-price subtotal';
}
