/**
 * What a Build Guide can show for each of its slots, right now.
 *
 * Three outcomes, and they are kept apart because they mean different things
 * to a shopper:
 *
 * - `available`   — a reviewed binding, and the catalogue still carries that
 *                   exact listing. Show the product, its current price and
 *                   when that price was read.
 * - `delisted`    — a reviewed binding whose listing has dropped out of the
 *                   catalogue. Say the listing is unavailable. Do NOT fall
 *                   back to the editorial estimate, a similar product, or a
 *                   search page; the guide's answer is simply not buyable
 *                   today and pretending otherwise is the whole problem.
 * - `unbound`     — no reviewer has bound this slot, because the catalogue
 *                   carries no listing for the product or because the choice
 *                   needs an editorial decision.
 *
 * `delisted` and `unbound` look the same to a shopper and are deliberately
 * different here: one is a guide whose answer sold out, the other is a guide
 * that has no answer yet, and only the second is an editor's job.
 */

import type { AffiliatePart, RetailPartCategory } from '../retail/partCatalog';
import { priceView, summarizeBuildPrices, type BuildPriceSummary } from '../retail/partPricing';
import { CATEGORY_LABELS } from '../retail/retailShopping';
import {
  bindingFor,
  unboundFor,
  type GuideSlotBinding,
  type GuideSlotUnbound,
} from './guideBindings';

/** Shown wherever a guide slot has no buyable listing. */
export const LISTING_UNAVAILABLE_LABEL = 'Current listing unavailable';

/** The action offered beside it. It goes to the Builder, never to a search. */
export const CHOOSE_REPLACEMENT_LABEL = 'Choose replacement in Builder';

export type GuideSlotState =
  | { readonly status: 'available'; readonly category: RetailPartCategory; readonly binding: GuideSlotBinding; readonly part: AffiliatePart }
  | { readonly status: 'delisted'; readonly category: RetailPartCategory; readonly binding: GuideSlotBinding }
  | { readonly status: 'unbound'; readonly category: RetailPartCategory; readonly unbound: GuideSlotUnbound | null };

/**
 * Read one guide's slots against the catalogue on screen.
 *
 * `catalogue` is indexed by exact id. A binding resolves by exact id and
 * nothing else — no name fallback, no nearest match. If the id is gone, the
 * slot is delisted, full stop.
 */
export function resolveGuideSlots(
  guideId: string,
  guideParts: Readonly<Record<string, string>>,
  catalogue: ReadonlyMap<string, AffiliatePart>,
): readonly GuideSlotState[] {
  const states: GuideSlotState[] = [];
  for (const category of Object.keys(guideParts) as RetailPartCategory[]) {
    const binding = bindingFor(guideId, category);
    if (!binding) {
      states.push({ status: 'unbound', category, unbound: unboundFor(guideId, category) });
      continue;
    }
    const part = catalogue.get(binding.neweggPartId);
    states.push(part ? { status: 'available', category, binding, part } : { status: 'delisted', category, binding });
  }
  return states;
}

/** The available listings, in slot order. */
export function availableParts(states: readonly GuideSlotState[]): readonly AffiliatePart[] {
  return states.flatMap((s) => (s.status === 'available' ? [s.part] : []));
}

/** Categories a shopper cannot buy from this guide today, in slot order. */
export function unavailableCategories(states: readonly GuideSlotState[]): readonly RetailPartCategory[] {
  return states.flatMap((s) => (s.status === 'available' ? [] : [s.category]));
}

/**
 * What the guide may add up.
 *
 * Only the available exact listings, through the same summariser the Builder's
 * own subtotal uses — so the two figures are computed once and cannot drift.
 * An editorial estimate never enters this sum; a slot with no listing is a
 * hole in the total, and the total says so rather than filling it.
 */
export function guideSubtotal(states: readonly GuideSlotState[], now: number): BuildPriceSummary {
  const summary = summarizeBuildPrices(availableParts(states), now);
  // A SLOT WITH NO LISTING MAKES THE TOTAL INCOMPLETE, even when every price
  // that WAS found is perfectly readable. The summariser only sees the parts
  // it is handed, so left alone it would call a guide missing its graphics
  // card "complete" and label the figure "Current price subtotal" — a total
  // that silently omits the most expensive thing in the build.
  if (states.some((s) => s.status !== 'available')) {
    return { ...summary, complete: false };
  }
  return summary;
}

/** Whether every slot in the guide resolved to a buyable listing. */
export function isGuideComplete(states: readonly GuideSlotState[]): boolean {
  return states.length > 0 && states.every((s) => s.status === 'available');
}

/** "graphics card, motherboard and power supply" — for naming the holes. */
export function namedCategories(categories: readonly RetailPartCategory[]): string {
  const named = categories.map((c) => CATEGORY_LABELS[c].toLowerCase());
  if (named.length === 0) return '';
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/**
 * The selection "Load into Builder" hands over: exact listing ids only.
 *
 * A slot with no listing is LEFT OUT rather than filled with the canonical
 * model id. Passing the model is what produced the wall of recommendation
 * cards this replaces — the Builder would receive something it could not put
 * in a cart and would ask the shopper to choose a listing for it, for all
 * eight slots. An absent slot is simply empty, which is true and which the
 * shopper can fill with one click.
 */
export function guideBuildSelection(
  states: readonly GuideSlotState[],
): Readonly<Record<string, string>> {
  const selection: Record<string, string> = {};
  for (const state of states) {
    if (state.status === 'available') selection[state.category] = state.part.id;
  }
  return selection;
}

/** Whether a part's price may be shown as current at all. */
export function hasCurrentPrice(part: AffiliatePart, now: number): boolean {
  return priceView(part, now).status === 'fresh';
}
