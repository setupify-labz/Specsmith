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

/** Which core categories hold a part. */
export function chosenCoreCategories(selection: CoreSelection): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter((category) => isChosen(selection[category]));
}

/** How many of the eight are chosen. Never more than eight, never negative. */
export function coreBuildCount(selection: CoreSelection): number {
  return chosenCoreCategories(selection).length;
}

/** Which core categories are still empty, in assembly order. */
export function missingCoreCategories(selection: CoreSelection): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter((category) => !isChosen(selection[category]));
}

/**
 * The next part to suggest, or null when the core build is complete.
 *
 * "Next" is the first unchosen category in assembly order, not the nearest or
 * the cheapest: a shopper working down the list should never be sent backwards,
 * and a stable answer is one they can follow without the target moving.
 */
export function nextMissingCoreCategory(selection: CoreSelection): CoreBuildCategory | null {
  return missingCoreCategories(selection)[0] ?? null;
}

/** The counter's label. One string, so the two numbers cannot be written apart. */
export function coreBuildLabel(selection: CoreSelection): string {
  return `Core build: ${coreBuildCount(selection)} of ${CORE_BUILD_TOTAL} parts selected`;
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
