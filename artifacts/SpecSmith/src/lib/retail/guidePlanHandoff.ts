/**
 * Getting a build guide's plan into the Builder, honestly.
 *
 * WHAT THE GUIDES USED TO DO. Every part row carried two links, "Amazon" and
 * "Newegg", titled "Buy on Amazon" and "Buy on Newegg". Neither went to a
 * product. Both went to a SEARCH RESULTS PAGE built from a string we
 * assembled out of the model name — so the promise ("buy this") and the
 * destination (a query that may return a different model, a used listing, an
 * accessory, or nothing) disagreed. Beside them sat a bare dollar amount from
 * our own editorial JSON, which in that company reads as the price you are
 * about to pay. The Amazon links also carried an Associates tag for an
 * account that was never approved.
 *
 * Relabelling the searches was considered and rejected: a search link cannot
 * be made to name a price, a stock state, or a specific listing, so no wording
 * makes it the thing the row implies. The row now offers ONE action that goes
 * where those facts actually exist — the Builder's catalogue, where a category
 * holds exact Newegg SKUs with observed prices, images, observation
 * timestamps and tracked direct links.
 *
 * WHAT IT MUST NOT DO. It must not choose a listing. A guide recommends a
 * MODEL ("RTX 5090"); a retailer sells dozens of SKUs of that model at
 * different prices from different sellers. Picking one on the shopper's
 * behalf would invent a purchase decision they never made, so the plan
 * arrives as recommendations with nothing selected, and the shopper picks.
 */

import { RETAIL_PART_CATEGORIES, type RetailPartCategory } from './partCatalog';
import { CATEGORY_LABELS } from './retailShopping';

/** The query parameter naming the category to open on arrival. */
export const GUIDE_OPEN_PARAM = 'open';

/** The visible label on a guide row's single action. */
export const CHOOSE_CURRENT_LISTING_LABEL = 'Choose current listing';

const isRetailCategory = (value: string): value is RetailPartCategory =>
  (RETAIL_PART_CATEGORIES as readonly string[]).includes(value);

/**
 * The Builder URL carrying a whole plan, and which category to open.
 *
 * THE WHOLE PLAN TRAVELS, always. A shopper who clicks the row for a power
 * supply still wants the graphics card, the processor and the rest — landing
 * in the Builder with one category filled and the other seven emptied would
 * throw away the thing they came for. The category only decides what is on
 * screen when they arrive.
 */
export function guidePlanUrl(
  parts: Readonly<Record<string, string>>,
  openCategory?: RetailPartCategory,
): string {
  const params = new URLSearchParams();
  for (const [category, id] of Object.entries(parts)) params.set(category, id);
  if (openCategory) params.set(GUIDE_OPEN_PARAM, openCategory);
  return `/builder?${params.toString()}`;
}

/**
 * Which category a visitor asked to open, or null.
 *
 * Validated against the real category list rather than trusted: this arrives
 * from a URL, which anyone can type. An unknown value opens nothing and the
 * Builder keeps its default, rather than being handed a category that does
 * not exist.
 */
export function openCategoryFrom(params: URLSearchParams): RetailPartCategory | null {
  const asked = params.get(GUIDE_OPEN_PARAM);
  if (!asked) return null;
  return isRetailCategory(asked) ? asked : null;
}

/**
 * The accessible name for one row's action.
 *
 * Eight rows reading "Choose current listing" are eight identical
 * announcements. The category and the model are what tell them apart, and a
 * screen-reader user tabbing the list has nothing else to go on.
 *
 * THE PLAN NAME IS NEEDED WHERE SEVERAL PLANS SHARE A PAGE. The guides hub
 * lists every build at once, and two builds on different budgets often
 * recommend the same power supply or the same case — measured on the real
 * page, forty actions produced only thirty-seven distinct names. Naming the
 * build disambiguates the duplicates; a single guide page has one plan and
 * does not need it.
 */
export function chooseCurrentListingLabel(
  category: RetailPartCategory,
  modelName: string,
  planName?: string,
): string {
  const base = `${CHOOSE_CURRENT_LISTING_LABEL} for ${CATEGORY_LABELS[category].toLowerCase()}: ${modelName}`;
  return planName ? `${base} — ${planName}` : base;
}

/** Whether a guide row's category exists in the shopping catalogue at all. */
export function isShoppableCategory(category: string): category is RetailPartCategory {
  return isRetailCategory(category);
}
