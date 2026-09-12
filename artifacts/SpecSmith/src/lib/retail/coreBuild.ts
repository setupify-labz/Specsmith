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
 * What the page knows about which parts it can show.
 *
 * A SET OF IDS IS NOT ENOUGH, and that gap was a real defect. Absence from a
 * set means "this id is not in the catalogue" only when a catalogue actually
 * arrived. When the download failed there is no catalogue to be absent from,
 * and reading the empty-handedness as "your part is gone" told the shopper
 * two contradictory things at once: that live listings could not be loaded,
 * and that a specific product no longer exists. A failed request proves
 * nothing whatsoever about a product.
 *
 * So the knowledge carries its own confidence:
 *
 * - `pending` — nothing has answered. Every filled slot is unknown.
 * - `complete` — the catalogue arrived. Absence from `ids` is a fact about
 *   the catalogue, and a slot missing from it can be reported as such.
 * - `partial` — only locally-held parts are knowable, because the catalogue
 *   request failed. Presence still counts; ABSENCE PROVES NOTHING and leaves
 *   the slot unknown rather than missing.
 */
export type CatalogueKnowledge =
  | { readonly status: 'pending' }
  | { readonly status: 'complete'; readonly ids: ReadonlySet<string> }
  | { readonly status: 'partial'; readonly ids: ReadonlySet<string> };

export const CATALOGUE_PENDING: CatalogueKnowledge = { status: 'pending' };

/** The catalogue answered in full: absence from these ids is meaningful. */
export const catalogueComplete = (ids: ReadonlySet<string>): CatalogueKnowledge =>
  ({ status: 'complete', ids });

/** Only these ids are knowable; anything else is unchecked, not missing. */
export const cataloguePartial = (ids: ReadonlySet<string>): CatalogueKnowledge =>
  ({ status: 'partial', ids });

/*
 * THE KNOWLEDGE ARGUMENT IS REQUIRED, NOT OPTIONAL, on every function below
 * that decides whether a slot is filled. It used to default to `undefined`,
 * which meant "count without checking anything" — the exact behaviour this
 * file has now been corrected for twice. A caller with no catalogue must say
 * so by passing `CATALOGUE_PENDING` and handle the unsettled answer, rather
 * than getting a confident number by leaving an argument off.
 */

/**
 * What one slot in the build is, once the catalogue has been consulted.
 *
 * FOUR STATES, AND THE LAST TWO ARE THE POINT. A slot that is empty, a slot
 * whose id our catalogue does not carry, and a slot nobody has been able to
 * check are three different situations. They share one piece of arithmetic —
 * none of them is a completed part — and nothing else:
 *
 * - `empty` is silent. Nothing was ever there.
 * - `unavailable` owes the shopper a sentence. They chose something, a
 *   catalogue arrived, and that catalogue does not carry the id — so it is
 *   not in the cart and they deserve to know why. It means "not in OUR
 *   catalogue", never "does not exist".
 * - `unknown` may not be reported AT ALL — not as done, not as missing.
 *   Either the catalogue is still in flight, or the request failed and there
 *   is nothing to have been absent from. A count, a tick or a "choose a
 *   processor" is a claim we cannot back.
 *
 * Collapsing `unknown` into "present" is what let the header read 8 of 8
 * before anything had validated a single saved id. Collapsing it into
 * `unavailable` is worse: on a failed download it tells the shopper their
 * part is gone in the same breath as telling them nothing could be loaded.
 */
export type CoreSlotState = 'empty' | 'present' | 'unavailable' | 'unknown';

/**
 * What the catalogue says about one slot.
 *
 * MATCHED BY EXACT ID, with no trimming. It used to compare `id.trim()`,
 * which the cart, the rail, the chips and the imported-model resolver do not
 * — they all look the raw string up. So a draft holding `" rx6600 "` counted
 * in the header and then vanished from the cart, which is precisely the
 * disagreement this file exists to prevent. A malformed id is rejected in the
 * same breath by all four, or it is a bug again.
 *
 * Whitespace still decides whether a slot is FILLED — `"   "` is nobody's
 * part — but it never decides whether a filled slot matches.
 */
export function coreSlotState(id: string | null | undefined, known: CatalogueKnowledge): CoreSlotState {
  if (!isChosen(id)) return 'empty';
  if (known.status === 'pending') return 'unknown';
  if (known.ids.has(id)) return 'present';
  // A catalogue that never arrived cannot testify that a part is missing.
  return known.status === 'complete' ? 'unavailable' : 'unknown';
}

const isPresent = (id: string | null | undefined, known: CatalogueKnowledge): id is string =>
  coreSlotState(id, known) === 'present';

/** Which core categories hold a part the builder can show. */
export function chosenCoreCategories(
  selection: CoreSelection,
  known: CatalogueKnowledge,
): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter((category) => isPresent(selection[category], known));
}

/** How many of the eight are chosen. Never more than eight, never negative. */
export function coreBuildCount(selection: CoreSelection, known: CatalogueKnowledge): number {
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
  known: CatalogueKnowledge,
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
  known: CatalogueKnowledge,
): CoreBuildCategory | null {
  return missingCoreCategories(selection, known)[0] ?? null;
}

/** The counter's label. One string, so the two numbers cannot be written apart. */
export function coreBuildLabel(selection: CoreSelection, known: CatalogueKnowledge): string {
  return `Core build: ${coreBuildCount(selection, known)} of ${CORE_BUILD_TOTAL} parts selected`;
}

/** The label shown while saved ids are still being checked. */
export const CORE_BUILD_CHECKING_LABEL = 'Checking your saved parts…';

/**
 * The label when the catalogue request failed and saved ids cannot be checked.
 *
 * Deliberately different from the loading one. "Checking…" over a page that
 * has stopped checking, and will not resume on its own, is a spinner that
 * lies. The reason and the retry live in the catalogue-failure notice below;
 * this only has to stop claiming a number it cannot stand behind.
 */
export const CORE_BUILD_UNCHECKED_LABEL = 'Some saved parts could not be checked';

/**
 * Slots the shopper filled that the catalogue cannot show.
 *
 * Empty while the catalogue has not answered: "not known yet" is not evidence
 * that anything is gone, and telling a shopper their part is missing while
 * the page is still loading it would be a lie with a short shelf life.
 */
export function unavailableCoreCategories(
  selection: CoreSelection,
  known: CatalogueKnowledge,
): CoreBuildCategory[] {
  return CORE_BUILD_CATEGORIES.filter(
    (category) => coreSlotState(selection[category], known) === 'unavailable',
  );
}

/**
 * ONE notice, naming every category that needs replacing.
 *
 * One sentence rather than one per part: a shopper whose draft has aged out
 * of three categories should read a single line, not a stack of three
 * identical warnings.
 *
 * "NO LONGER AVAILABLE" WAS TOO STRONG, and it is the kind of overreach this
 * project exists to avoid. SpecSmith carries a few hundred listings, not the
 * whole of Newegg. A saved id absent from today's catalogue may have been
 * delisted — or may be sitting on the retailer's site right now, in stock, at
 * a price we simply are not carrying. The honest claim is about OUR
 * catalogue, which is the only thing we looked at, so that is what is said,
 * plus the fact that the part may still exist at the retailer. Declaring it
 * gone would send a shopper off to replace something they already own.
 */
export function unavailableCoreNotice(categories: readonly CoreBuildCategory[]): string | null {
  if (categories.length === 0) return null;
  const named = categories.map((category) => coreCategoryLabel(category).toLowerCase());
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return named.length === 1
    ? `A saved part is not present in the current SpecSmith catalogue — choose a replacement ${list}. It may still be listed at the retailer.`
    : `Some saved parts are not present in the current SpecSmith catalogue — choose a replacement ${list}. They may still be listed at the retailer.`;
}

export interface CoreBuildStatus {
  /** Every core category and what its slot is. */
  readonly slots: Readonly<Record<CoreBuildCategory, CoreSlotState>>;
  /** Completed parts. `present` slots only — never a stale or unchecked one. */
  readonly count: number;
  /**
   * Whether the page may state a number at all.
   *
   * False only when something is actually waiting to be checked: an empty
   * draft needs no catalogue, so "0 of 8" is already true and stays. Saying
   * "checking your saved parts" over a build with none would be its own small
   * untruth.
   */
  readonly settled: boolean;
  /**
   * Filled slots nothing has been able to check, in build order.
   *
   * Not missing — unverified. Either the catalogue has not answered yet, or
   * the request failed and there is nothing to have been absent from.
   */
  readonly unchecked: readonly CoreBuildCategory[];
  /** Filled slots the catalogue cannot show, in build order. */
  readonly unavailable: readonly CoreBuildCategory[];
  /** The one sentence about those slots, or null when there are none. */
  readonly notice: string | null;
  /** The next slot needing attention, or null when complete or unsettled. */
  readonly next: CoreBuildCategory | null;
  /** The counter's label. One string, so the two numbers cannot be written apart. */
  readonly label: string;
}

/**
 * Read the whole build against the catalogue on screen, once.
 *
 * Every surface that describes the build — the counter, the cart, the desktop
 * rail, the mobile chips — reads this, so they cannot drift apart by being
 * computed three different ways in three different files. That drift IS the
 * bug this file keeps being edited for.
 */
export function describeCoreBuild(selection: CoreSelection, known: CatalogueKnowledge): CoreBuildStatus {
  const slots = {} as Record<CoreBuildCategory, CoreSlotState>;
  let count = 0;
  const unavailable: CoreBuildCategory[] = [];
  const unchecked: CoreBuildCategory[] = [];

  for (const category of CORE_BUILD_CATEGORIES) {
    const state = coreSlotState(selection[category], known);
    slots[category] = state;
    if (state === 'present') count += 1;
    else if (state === 'unavailable') unavailable.push(category);
    else if (state === 'unknown') unchecked.push(category);
  }

  const settled = unchecked.length === 0;
  // Nothing is offered as "next" until every slot has an answer. Suggesting a
  // part on the strength of an unchecked selection is the same mistake as
  // counting one, one step further along.
  const next = settled
    ? CORE_BUILD_CATEGORIES.find((category) => slots[category] !== 'present') ?? null
    : null;

  // An unsettled build states no number, and says which of the two reasons
  // applies: still arriving, or arrived broken and not coming back.
  const unsettledLabel =
    known.status === 'pending' ? CORE_BUILD_CHECKING_LABEL : CORE_BUILD_UNCHECKED_LABEL;

  return {
    slots,
    count,
    settled,
    unavailable,
    unchecked,
    notice: unavailableCoreNotice(unavailable),
    next,
    label: settled ? coreBuildLabel(selection, known) : unsettledLabel,
  };
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

/**
 * The same call to action for a slot whose saved part has gone.
 *
 * Worth its own wording: "Choose a processor" beside a build the shopper
 * believes already has one reads as a mistake on their part. "Choose a
 * replacement processor" says what actually happened.
 */
export function coreReplacementAction(category: CoreBuildCategory): string {
  return `Choose a replacement ${coreCategoryLabel(category).toLowerCase()}`;
}
