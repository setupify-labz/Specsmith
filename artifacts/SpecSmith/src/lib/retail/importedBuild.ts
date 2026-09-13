/**
 * A build that arrived from somewhere else in the site.
 *
 * WHAT WAS BROKEN. Build Guides, the Quiz, Build Crate, shared links and saved
 * builds all hand `/builder` a set of CANONICAL model ids — "rx6600",
 * "r5-5600" — because those are what the rest of the site reasons about.
 * The retail builder recognises only exact retailer SKU ids, so loading Budget
 * Beast produced a build summary reading "View build (0)" and a progress
 * counter reading "0 of 8" over a page that had just been handed eight parts.
 * The shopper's whole build vanished on arrival.
 *
 * WHAT THIS IS NOT. It is not a matcher. Nothing here maps a canonical model
 * onto a retailer listing, by name, by score or by anything else. One model has
 * several distinct SKUs at different prices, and picking one on the shopper's
 * behalf would be inventing a purchase decision — the exact failure the retail
 * catalogue exists to avoid. A recognised canonical id becomes a RECOMMENDATION,
 * shown as such, and the shopper chooses the listing themselves.
 *
 * THE THREE OUTCOMES for a selected id, and there are only three:
 *
 *   retail    the id names a listing in the catalogue — an exact SKU, with a
 *             real price, a real link and a real timestamp;
 *   imported  the id names a canonical model — a recommendation carrying an
 *             editorial estimate, which is NEVER a retailer price and never
 *             reaches the retailer subtotal;
 *   unknown   the id names neither. Rejected, exactly as before: a stale or
 *             invented id must not become a part.
 */

import { RETAIL_PART_CATEGORIES, type RetailPartCategory } from './partCatalog';

/**
 * A selection across ALL TWELVE categories, not just the core eight.
 *
 * Peripherals arrive through exactly the same links a core part does — a
 * Build Crate roll hands over a monitor and a headset alongside the GPU — so a
 * recommendation module that stopped at the core eight would drop them on the
 * floor in precisely the way this whole change set exists to stop.
 */
export type BuilderSelection = {
  readonly [K in RetailPartCategory]?: string | null;
};

/** The canonical model behind an imported choice. Deliberately a small shape. */
export interface CanonicalPartRef {
  id: string;
  name: string;
  /**
   * The site's editorial estimate for this model, when it has one.
   *
   * Called `estimatedPrice` and never `price`, because the difference is the
   * whole point: it describes a MODEL at some past moment, not a listing a
   * shopper can buy now. It is displayed as an estimate, labelled as an
   * estimate, and excluded from every retailer total.
   */
  estimatedPrice?: number;
}

export type SlotOrigin = 'retail' | 'imported' | 'unknown';

export interface ImportedRecommendation {
  category: RetailPartCategory;
  canonicalId: string;
  name: string;
  estimatedPrice?: number;
}

const isChosen = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.trim() !== '';

/**
 * Where a single slot's id comes from.
 *
 * Retail wins when an id somehow appears in both: an exact listing is strictly
 * better information than a model, and a shopper holding one should never be
 * demoted to a recommendation.
 */
export function slotOrigin(
  id: string | null | undefined,
  retailIds: ReadonlySet<string>,
  canonicalById: ReadonlyMap<string, CanonicalPartRef>,
): SlotOrigin {
  if (!isChosen(id)) return 'unknown';
  if (retailIds.has(id)) return 'retail';
  if (canonicalById.has(id)) return 'imported';
  return 'unknown';
}

/**
 * The imported recommendations in a selection, across all twelve categories.
 *
 * ALL TWELVE, DELIBERATELY. The progress bar counts the eight parts that make
 * a computer and is unchanged — a monitor does not make the machine more
 * complete. But the build a shopper carries in is whatever they were given,
 * peripherals included, and a recommendation dropped because it is "only" a
 * headset is still a part that vanished on arrival.
 *
 * A category holding an exact retailer SKU produces nothing here — that is how
 * a recommendation is REPLACED rather than accumulated: the moment the shopper
 * picks a listing, the slot stops being imported and there is no second state
 * to clean up.
 */
export function importedRecommendations(
  selection: BuilderSelection,
  retailIds: ReadonlySet<string>,
  canonicalById: ReadonlyMap<string, CanonicalPartRef>,
): ImportedRecommendation[] {
  const recommendations: ImportedRecommendation[] = [];
  for (const category of RETAIL_PART_CATEGORIES) {
    const id = selection[category];
    if (slotOrigin(id, retailIds, canonicalById) !== 'imported') continue;
    const canonical = canonicalById.get(id as string);
    if (!canonical) continue;
    recommendations.push({
      category,
      canonicalId: canonical.id,
      name: canonical.name,
      ...(typeof canonical.estimatedPrice === 'number' ? { estimatedPrice: canonical.estimatedPrice } : {}),
    });
  }
  return recommendations;
}

/**
 * Every id the builder can show something for: exact listings and recognised
 * models together.
 *
 * This is what the progress counter counts, so the counter and the summary
 * describe the same set — the property PR #111 was about, extended to cover a
 * build that arrived from elsewhere. An unknown id is in neither, so it counts
 * for nothing and is displayed nowhere.
 */
export function recognisedPartIds(
  retailIds: ReadonlySet<string>,
  canonicalById: ReadonlyMap<string, CanonicalPartRef>,
): ReadonlySet<string> {
  const recognised = new Set<string>(retailIds);
  for (const id of canonicalById.keys()) recognised.add(id);
  return recognised;
}

/**
 * The whole explanation, said ONCE above the plan.
 *
 * WHY IT MOVED. It used to be repeated inside every recommendation, which at
 * eight parts meant 1,413 characters of identical warning, a summary 1,788px
 * tall, and the FPS action 1,835px down the page where nobody saw it. Three
 * sentences a shopper reads once do not become truer for being printed eight
 * times; they become a wall the shopper scrolls past.
 *
 * All three facts survive verbatim — these are recommended MODELS, an exact
 * listing has to be chosen before buying, and the figures are dated planning
 * estimates rather than live prices. Only the repetition is gone.
 */
export const IMPORTED_PLAN_NOTICE =
  'Recommended models, not listings. Choose a current retailer listing in each category before buying. Prices are dated planning estimates, not live retailer prices.';

/** The heading above the planned parts. */
export const IMPORTED_PLAN_HEADING = 'Planned parts';

/** Per-row prefix on an estimate, so the number is never bare. */
export const ESTIMATED_PREFIX = 'Estimated';

/** The action that turns a recommendation into a real purchase decision. */
export const CHOOSE_LISTING_LABEL = 'Choose listing';

/**
 * The accessible name for one row's action.
 *
 * Twelve buttons reading "Choose listing" are twelve identical announcements;
 * the category is what tells them apart, and a screen-reader user has nothing
 * else to go on.
 */
export function chooseListingLabel(categoryLabel: string): string {
  return `${CHOOSE_LISTING_LABEL} for ${categoryLabel}`;
}
