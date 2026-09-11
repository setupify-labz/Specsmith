/**
 * How much of a computer the shopper has actually chosen.
 *
 * WHAT WENT WRONG. The builder's progress counter was derived from RESOLVED
 * CANONICAL parts: each selected id was mapped back to a reference part, and
 * mapped only when the retailer listing's specs had been verified. In the
 * published catalogue exactly one core category is verified — GPUs — so a
 * chosen motherboard, RAM kit, drive, power supply, case or cooler moved the
 * counter not at all. Selecting a GPU, a CPU and a motherboard produced a
 * summary saying three and a header saying one.
 *
 * The two numbers were measuring different things. The summary counts what the
 * shopper picked. The header counted what the FPS estimator could understand,
 * under a label that reads like the former.
 *
 * THE RULE HERE IS DELIBERATELY DULL. A core category counts when it holds an
 * id. Not when the id resolves, not when its specs are verified, not when it
 * passes a compatibility check — those are separate questions, answered
 * elsewhere and shown separately, and folding any of them in here is exactly
 * how one number ends up answering another number's question.
 *
 * VERIFICATION AND COMPATIBILITY STAY FAIL-CLOSED. Nothing in this file is
 * consulted when deciding whether an FPS estimate may be shown or whether a
 * build is compatible. Counting a part the estimator cannot model must never
 * imply that it can model it.
 */

import { CATEGORY_LABELS, } from './retailShopping';
import type { RetailPartCategory } from './partCatalog';

/**
 * The eight parts that make a working computer.
 *
 * Peripherals are excluded on purpose: a monitor is a fine thing to own and
 * does not make the machine any more complete. Order matters — it is the order
 * a build is sensibly assembled in, and it decides which part is offered next.
 */
export const CORE_BUILD_CATEGORIES = [
  'gpu',
  'cpu',
  'motherboard',
  'ram',
  'storage',
  'psu',
  'case',
  'cooler',
] as const satisfies readonly RetailPartCategory[];

export type CoreBuildCategory = (typeof CORE_BUILD_CATEGORIES)[number];

export const CORE_BUILD_TOTAL = CORE_BUILD_CATEGORIES.length;

/**
 * A selection: the chosen id per category, where absent or null means unchosen.
 *
 * Only the eight core keys are required to be readable. A caller's build state
 * carries peripherals too, and is welcome to — they are simply not counted.
 */
export type CoreSelection = {
  readonly [K in CoreBuildCategory]?: string | null;
};

const isChosen = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.trim() !== '';

/**
 * The ids the builder on screen can actually show, or null when it does not
 * know yet.
 *
 * WHY THIS EXISTS — the second half of the same bug. Counting every id the
 * draft holds looks right until a saved SKU drops out of the catalogue: the
 * header then says "8 of 8" while the build summary lists seven, because the
 * summary skips a selection it cannot render. That is the identical
 * contradiction this change set exists to remove, arriving from the other
 * direction.
 *
 * So a slot counts when the builder could put something in it. `null` means
 * the catalogue has not answered yet — during loading there is no summary on
 * screen to contradict, and the shopper's own selections are the best thing
 * to report until availability is known.
 */
export type KnownPartIds = ReadonlySet<string> | null | undefined;

const isPresent = (id: string | null | undefined, known: KnownPartIds): id is string => {
  if (!isChosen(id)) return false;
  // Not yet known is not the same as absent, and must not be reported as one.
  if (known === null || known === undefined) return true;
  return known.has(id);
};

/** Which core categories hold a part the builder can show. */
export function chosenCoreCategories(
  selection: CoreSelection,
  known?: KnownPartIds,
): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter((category) => isPresent(selection[category], known));
}

/** How many of the eight are chosen. Never more than eight, never negative. */
export function coreBuildCount(selection: CoreSelection, known?: KnownPartIds): number {
  return chosenCoreCategories(selection, known).length;
}

/**
 * Which core categories still need a part, in assembly order.
 *
 * A slot whose saved listing has been delisted is MISSING, not filled: the
 * shopper has nothing there, and the next-part action should offer to fill it.
 */
export function missingCoreCategories(
  selection: CoreSelection,
  known?: KnownPartIds,
): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter((category) => !isPresent(selection[category], known));
}

/**
 * The next part to suggest, or null when the core build is complete.
 *
 * "Next" is the first unchosen category in assembly order, not the nearest or
 * the cheapest: a shopper working down the list should never be sent backwards,
 * and a stable answer is one they can follow without the target moving.
 */
export function nextMissingCoreCategory(
  selection: CoreSelection,
  known?: KnownPartIds,
): CoreBuildCategory | null {
  return missingCoreCategories(selection, known)[0] ?? null;
}

/** The counter's label. One string, so the two numbers cannot be written apart. */
export function coreBuildLabel(selection: CoreSelection, known?: KnownPartIds): string {
  return `Core build: ${coreBuildCount(selection, known)} of ${CORE_BUILD_TOTAL} parts selected`;
}

/**
 * Slots the shopper filled whose part the builder can no longer show.
 *
 * Told apart from a slot that was never filled. The two need the same
 * arithmetic — neither is a completed part — and different words: only one of
 * them owes the shopper an explanation for why their cart is a row short.
 *
 * Empty while the catalogue has not answered, because "not known yet" is not
 * evidence that anything is missing.
 */
export function unavailableCoreCategories(
  selection: CoreSelection,
  known?: KnownPartIds,
): CoreBuildCategory[] {
  if (known === null || known === undefined) return [];
  return CORE_BUILD_CATEGORIES.filter((category) => {
    const id = selection[category];
    return isChosen(id) && !known.has(id.trim());
  });
}

/**
 * What to tell the shopper about those slots.
 *
 * Says the part is gone and what to do about it. It does NOT say the part was
 * discontinued, recalled or out of stock — all that is actually known is that
 * the catalogue in front of us does not carry this id, and the rest would be
 * invention.
 */
export function unavailableCoreNotice(categories: readonly CoreBuildCategory[]): string | null {
  if (categories.length === 0) return null;
  const named = categories.map((category) => coreCategoryLabel(category).toLowerCase());
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return named.length === 1
    ? `A saved part is no longer available — choose a replacement ${list}.`
    : `Saved parts are no longer available — choose a replacement ${list}.`;
}

/** What to call a core category on its own, e.g. as a heading. */
export function coreCategoryLabel(category: CoreBuildCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * The whole call to action, written out per category.
 *
 * Built by hand rather than as "Choose a " + label, because that produces
 * "Choose a memory" and "Choose a storage". English articles do not follow
 * from a category name, and a counter that has just been fixed for saying
 * something untrue should not be shipped saying something illiterate.
 */
const CORE_ACTION_LABELS: Readonly<Record<CoreBuildCategory, string>> = {
  gpu: 'Choose a graphics card',
  cpu: 'Choose a processor',
  motherboard: 'Choose a motherboard',
  ram: 'Choose memory',
  storage: 'Choose storage',
  psu: 'Choose a power supply',
  case: 'Choose a case',
  cooler: 'Choose a CPU cooler',
};

export function coreCategoryAction(category: CoreBuildCategory): string {
  return CORE_ACTION_LABELS[category];
}
