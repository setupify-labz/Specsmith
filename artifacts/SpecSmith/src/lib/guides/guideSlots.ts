/**
 * What a Build Guide can show for each of its slots, right now.
 *
 * Five outcomes, kept apart because they mean different things:
 *
 * - `available`   — a reviewed binding, and the catalogue still carries that
 *                   exact listing. Show the product, its current price and
 *                   when that price was read.
 * - `unchecked`   — NOTHING HAS BEEN ABLE TO LOOK YET. The catalogue is still
 *                   arriving, or its download failed. This is not evidence
 *                   about a product and must never be reported as one.
 * - `delisted`    — a reviewed binding whose listing has dropped out of a
 *                   catalogue that DID arrive. Say the listing is
 *                   unavailable. Do NOT fall back to the editorial estimate,
 *                   a similar product, or a search page.
 * - `mismatched`  — a binding exists but names a different canonical product
 *                   than the guide slot does. Fail closed: someone changed
 *                   the guide without re-reviewing the binding, and showing
 *                   the bound listing would put the wrong product under the
 *                   guide's own heading.
 * - `unbound`     — no reviewer has bound this slot at all.
 *
 * WHY `unchecked` IS ITS OWN STATE. An empty catalogue map used to mean both
 * "the feed failed" and "this listing is gone", so a guide opened during a
 * failed fetch announced that all eight of its products were unavailable —
 * a claim about the world derived from a claim about our network. A download
 * that never arrived cannot testify that a product does not exist.
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
  | {
      readonly status: 'unchecked';
      readonly category: RetailPartCategory;
      readonly binding: GuideSlotBinding;
      /** Whether an answer is still coming, or has already failed to come. */
      readonly reason: 'loading' | 'failed';
    }
  | { readonly status: 'delisted'; readonly category: RetailPartCategory; readonly binding: GuideSlotBinding }
  | { readonly status: 'mismatched'; readonly category: RetailPartCategory; readonly binding: GuideSlotBinding; readonly expectedCanonicalId: string }
  | { readonly status: 'unbound'; readonly category: RetailPartCategory; readonly unbound: GuideSlotUnbound | null };

/**
 * What the page knows about the catalogue it is resolving against.
 *
 * THREE STATES, NOT TWO. `loading` and `failed` agree on the one thing that
 * matters for integrity — neither can say a product is unavailable — and on
 * nothing else. A page that shows "Checking current listing…" after the
 * request has already failed is a spinner that never stops: the shopper waits
 * for an answer that is not coming, and is never offered the one action that
 * could produce it. A failure has to say so, and say what to do.
 */
export type GuideCatalogue =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly parts: ReadonlyMap<string, AffiliatePart> };

export const CATALOGUE_LOADING: GuideCatalogue = { status: 'loading' };
export const CATALOGUE_FAILED: GuideCatalogue = { status: 'failed' };
export const catalogueReady = (parts: ReadonlyMap<string, AffiliatePart>): GuideCatalogue =>
  ({ status: 'ready', parts });

/** Shown while the catalogue is genuinely still on its way. */
export const LISTING_CHECKING_LABEL = 'Checking current listing…';

/** Shown when the request answered and there is no catalogue to check against. */
export const LISTINGS_UNCHECKABLE_LABEL = 'Unable to check current listings';

/** The action that can actually change that. */
export const RETRY_LISTINGS_LABEL = 'Try again';

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
  catalogue: GuideCatalogue,
): readonly GuideSlotState[] {
  const states: GuideSlotState[] = [];
  for (const category of Object.keys(guideParts) as RetailPartCategory[]) {
    const binding = bindingFor(guideId, category);
    if (!binding) {
      states.push({ status: 'unbound', category, unbound: unboundFor(guideId, category) });
      continue;
    }

    // FAIL CLOSED WHEN THE GUIDE MOVED UNDER THE BINDING. The registry is
    // keyed by guide and category, not by product, so editing a guide's
    // processor without re-reviewing its binding would leave the old
    // listing resolving happily under the new heading — the guide would name
    // one product and sell another. A mismatch is refused, not reconciled.
    const expectedCanonicalId = guideParts[category];
    if (binding.canonicalPartId !== expectedCanonicalId) {
      states.push({ status: 'mismatched', category, binding, expectedCanonicalId });
      continue;
    }

    if (catalogue.status !== 'ready') {
      states.push({ status: 'unchecked', category, binding, reason: catalogue.status });
      continue;
    }

    const part = catalogue.parts.get(binding.neweggPartId);
    states.push(part ? { status: 'available', category, binding, part } : { status: 'delisted', category, binding });
  }
  return states;
}

/** Slots nothing has been able to check yet, in slot order. */
export function uncheckedCategories(states: readonly GuideSlotState[]): readonly RetailPartCategory[] {
  return states.flatMap((s) => (s.status === 'unchecked' ? [s.category] : []));
}

/** True while any slot is still waiting on the catalogue. */
export function isGuidePending(states: readonly GuideSlotState[]): boolean {
  return states.some((s) => s.status === 'unchecked');
}

/** True when the catalogue answered and there is nothing to check against. */
export function isGuideUncheckable(states: readonly GuideSlotState[]): boolean {
  return states.some((s) => s.status === 'unchecked' && s.reason === 'failed');
}

/** The available listings, in slot order. */
export function availableParts(states: readonly GuideSlotState[]): readonly AffiliatePart[] {
  return states.flatMap((s) => (s.status === 'available' ? [s.part] : []));
}

/**
 * Categories a shopper cannot buy from this guide today, in slot order.
 *
 * An `unchecked` slot is NOT here. Nothing has looked at it, so calling it
 * unavailable would state as fact something no request has established.
 */
export function unavailableCategories(states: readonly GuideSlotState[]): readonly RetailPartCategory[] {
  return states.flatMap((s) =>
    s.status === 'available' || s.status === 'unchecked' ? [] : [s.category],
  );
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
