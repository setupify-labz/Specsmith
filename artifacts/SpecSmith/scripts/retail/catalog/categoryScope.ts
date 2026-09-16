// WHICH LISTINGS ARE IN SCOPE FOR A GAMING-PC CATALOGUE, PER CATEGORY.
//
// WHAT WENT WRONG BEFORE
// ----------------------
// Coverage used to be equal-population price bands cut from whatever the feed
// returned. Bands cut from the sample are dragged by the sample: the top band
// is always "the dearest things that arrived", whatever those are, and the
// round-robin then GUARANTEES one of them a slot. That published a $34,912
// enterprise storage device in a catalogue for people building a gaming PC —
// not because anything judged it relevant, but because it was expensive and
// the top band had to be filled from somewhere.
//
// The failure is structural, so no tuning of the band count fixes it. A
// selection rule that ranks by price and reserves slots for the top of the
// range will keep finding the most extreme listing in the feed and calling it
// coverage.
//
// WHAT REPLACES IT
// ----------------
// A per-category scope with ABSOLUTE bounds, decided before any listing is
// read, so nothing in the feed can move them. A listing outside its category's
// bounds is REJECTED — it never competes for a slot, and an empty tier simply
// contributes nothing rather than being filled with whatever is nearest.
//
// WHERE THE BOUNDS COME FROM, AND WHY THAT IS NOT A MADE-UP NUMBER
// ----------------------------------------------------------------
// SpecSmith already ships an editorial catalogue of the parts it advises on —
// `src/data/gpus.json`, `cpus.json`, `components.json`, `peripherals.json`.
// Its price extents per category ARE this product's statement about the market
// it covers: the cheapest and dearest examples an editor thought worth listing
// for someone building a gaming PC. Reading them beats inventing twelve
// thresholds, and it keeps the boundary moving with the catalogue instead of
// going stale in a constant nobody revisits.
//
// THESE ARE SCOPE BOUNDARIES, NEVER PRICES.
// -----------------------------------------
// The editorial figures are ESTIMATES. They are used here to decide whether a
// listing belongs in a gaming-PC catalogue at all, and for nothing else. No
// bound is ever displayed, compared against a live price, used to call a
// listing cheap or dear, or presented as a market rate. A retail price and an
// editorial estimate stay separate in storage, in logic and on screen — see
// `src/lib/retail/partPricing.ts` — and a scope filter produces no claim about
// any price, which is exactly why it is allowed to read them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RETAIL_PART_CATEGORIES, type AffiliatePart, type RetailPartCategory } from '../../../src/lib/retail/partCatalog';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '..', '..', '..', 'src', 'data');

/**
 * How far above the dearest editorial example a real listing may sit.
 *
 * AN EDITORIAL JUDGEMENT, and the only one in this file. The catalogue lists
 * representative parts, not the ceiling of the market: a partner card sits
 * above its reference model, a larger capacity above the one an editor chose.
 * Two is deliberately generous — it is meant to admit a legitimate high-end
 * consumer part, not to be a tight fit — and it is one number in one place so
 * a reviewer can argue with it.
 */
export const SCOPE_CEILING_FACTOR = 2;

/**
 * How far below the cheapest editorial example a real listing may sit.
 *
 * Symmetrical reasoning, opposite direction. Under it are the listings that
 * carry a category's words without being the part: an OEM pull, a single
 * low-capacity stick, a power supply too small to run anything this site
 * recommends. Those are not budget options, they are a different product.
 */
export const SCOPE_FLOOR_FACTOR = 0.5;

/**
 * The currency every bound is stated in.
 *
 * A listing in another currency CANNOT be compared to these without an
 * exchange rate, and inventing one to decide scope would be inventing a price.
 * Such a listing is refused instead — fail closed. Nothing in the feed is
 * non-USD today, which is why this has to be enforced rather than assumed.
 */
export const SCOPE_CURRENCY = 'USD';

export interface CategoryPriceScope {
  category: RetailPartCategory;
  /** Below this, the listing is not the part a gaming build needs. */
  floorUsd: number;
  /** Above this, the listing is outside the consumer gaming market. */
  ceilingUsd: number;
  /** The editorial extents the bounds were derived from. */
  editorial: { minUsd: number; maxUsd: number; examples: number };
}

/** Where each category's editorial examples live in the shipped data. */
const EDITORIAL_SOURCE: Readonly<Record<RetailPartCategory, { file: string; key: string | null }>> = {
  gpu: { file: 'gpus.json', key: null },
  cpu: { file: 'cpus.json', key: null },
  motherboard: { file: 'components.json', key: 'motherboards' },
  ram: { file: 'components.json', key: 'ram' },
  storage: { file: 'components.json', key: 'storage' },
  psu: { file: 'components.json', key: 'psus' },
  case: { file: 'components.json', key: 'cases' },
  cooler: { file: 'components.json', key: 'coolers' },
  monitor: { file: 'peripherals.json', key: 'monitors' },
  keyboard: { file: 'peripherals.json', key: 'keyboards' },
  mouse: { file: 'peripherals.json', key: 'mice' },
  headset: { file: 'peripherals.json', key: 'headsets' },
};

function editorialPrices(category: RetailPartCategory, root: string): number[] {
  const { file, key } = EDITORIAL_SOURCE[category];
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));
  const entries: unknown = key === null ? raw : (raw as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) throw new Error(`${file}${key ? `#${key}` : ''} is not a list of editorial parts.`);
  return entries
    .map((entry) => (entry as { price_usd?: unknown }).price_usd)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
}

/**
 * Reads the scope for every category, or throws.
 *
 * FAILS CLOSED ON THIN DATA. A category with fewer than four priced editorial
 * examples has not said enough about its own market to bound anything, and a
 * bound derived from one or two entries is a guess wearing a citation. The
 * build stops rather than publishing a category whose scope nobody set.
 */
export const MIN_EDITORIAL_EXAMPLES = 4;

export function loadCategoryScopes(root: string = dataDir): Map<RetailPartCategory, CategoryPriceScope> {
  const scopes = new Map<RetailPartCategory, CategoryPriceScope>();
  for (const category of RETAIL_PART_CATEGORIES) {
    const prices = editorialPrices(category, root);
    if (prices.length < MIN_EDITORIAL_EXAMPLES) {
      throw new Error(
        `${category}: only ${prices.length} priced editorial examples, below the ${MIN_EDITORIAL_EXAMPLES} needed to bound a scope. Refusing to guess one.`,
      );
    }
    const minUsd = Math.min(...prices);
    const maxUsd = Math.max(...prices);
    scopes.set(category, {
      category,
      floorUsd: Number((minUsd * SCOPE_FLOOR_FACTOR).toFixed(2)),
      ceilingUsd: Number((maxUsd * SCOPE_CEILING_FACTOR).toFixed(2)),
      editorial: { minUsd, maxUsd, examples: prices.length },
    });
  }
  return scopes;
}

export type ScopeVerdict =
  | { inScope: true }
  | { inScope: false; reason: 'currency-not-comparable' | 'below-category-floor' | 'above-category-ceiling' };

/**
 * Whether one listing belongs in its category's catalogue.
 *
 * Reads the price a shopper would actually pay — the sale price when there is
 * a genuine one — because that is the figure the card shows and therefore the
 * figure that has to be in scope.
 */
export function scopeVerdict(part: AffiliatePart, scope: CategoryPriceScope): ScopeVerdict {
  if (part.currency !== SCOPE_CURRENCY) return { inScope: false, reason: 'currency-not-comparable' };
  const price = part.salePrice ?? part.retailPrice;
  if (price < scope.floorUsd) return { inScope: false, reason: 'below-category-floor' };
  if (price > scope.ceilingUsd) return { inScope: false, reason: 'above-category-ceiling' };
  return { inScope: true };
}
