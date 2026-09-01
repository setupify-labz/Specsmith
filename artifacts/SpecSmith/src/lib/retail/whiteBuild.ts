/**
 * Which retailer listings are genuinely white-finish products.
 *
 * WHAT THIS IS FOR. "White build" is a shopping view, not a component
 * category: the twelve categories stay exactly as they are and each one is
 * narrowed to the SKUs whose own merchant title says, unambiguously, that the
 * product is white.
 *
 * WHY THE TITLE AND NOTHING ELSE. The photograph cannot be read — a white
 * card shot on a white background is the same pixels as a black one shot on
 * white, and inferring finish from an image is guessing with extra steps. The
 * brand cannot be read either: ASUS sells the same model in both. Neither can
 * the canonical model, because the whole point of the retail catalogue is that
 * one model has several distinct SKUs. What CAN be read is the merchant's own
 * title, which is verified feed data and is where the retailer states the
 * colourway: "White Edition", "-WHITE", "(White)", "SNOW".
 *
 * THE HARD PART IS SAYING NO. "White" appears in plenty of titles that
 * describe something other than the product's colour — a white backlight, a
 * black-and-white keycap set, a switch colour. Those are the matches that
 * would make this feature a liar, so the rule below is built around refusing
 * them, and the refusals are the part worth reading.
 */

import type { AffiliatePart, RetailPartCategory } from './partCatalog';

/**
 * Words that, standing alone in a title, name a white finish.
 *
 * Deliberately short. "Frost", "arctic", "ice", "pearl" and friends are all
 * used as model names for products that are not white — Frostbite, Arctic the
 * cooler brand — and adding them buys a handful of matches at the cost of the
 * one property this list has to have.
 */
const WHITE_WORDS = ['white', 'snow'] as const;

/**
 * A word right AFTER the colour token that means it described something else.
 *
 * Every one of these is in the live catalogue or one keystroke away from it:
 * "White Backlight" is a Keychron K8 that is black, "Black White Keycaps" is a
 * keycap set on any colour of board, "white LED" is a light.
 */
const DISQUALIFYING_AFTER = [
  'backlight',
  'backlit',
  'led',
  'leds',
  'light',
  'lights',
  'lighting',
  'key',
  'keys',
  'keycap',
  'keycaps',
  'switch',
  'switches',
  'text',
  'background',
  'balance',
  'noise',
  'paper',
  'glove',
  'gloves',
  'box',
  'label',
  'list',
  'screen',
  'print',
  'printing',
];

/**
 * A word right BEFORE the colour token that means the same thing.
 *
 * "Optical Red Switch/White" is a switch colour, not a chassis colour. Note
 * that "RGB" is deliberately NOT here: "CX650F RGB White 650W" is a white
 * power supply with RGB, and refusing it would throw away true matches to
 * avoid a false one that does not occur.
 */
const DISQUALIFYING_BEFORE = ['switch', 'switches', 'backlight', 'led', 'keycap', 'keycaps'];

/** Why a listing was not admitted to the white collection. A closed set. */
export type WhiteRefusal =
  /** No white word anywhere in the title. */
  | 'no-colour-word'
  /** The white word described a different part — a backlight, a keycap, a switch. */
  | 'describes-something-else';

export type WhiteVerdict =
  | { white: true; evidence: string }
  | { white: false; refusal: WhiteRefusal };

/** Splits a title into lowercase word tokens, keeping position. */
const tokenize = (title: string): string[] =>
  title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');

/**
 * Is this listing a white-finish product, by its own merchant title?
 *
 * Returns the evidence when it is, so a card can say WHY it is in the
 * collection rather than asking to be believed.
 */
export function classifyWhiteFinish(title: string): WhiteVerdict {
  const tokens = tokenize(title);
  let sawColourWord = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    // Model numbers like "SUP01W" or "GT650WH" are not evidence on their own —
    // a single letter is far too thin a thread to hang a colour claim on. Only
    // a whole word counts.
    if (!(WHITE_WORDS as readonly string[]).includes(token)) continue;
    sawColourWord = true;

    const after = tokens[index + 1];
    if (after !== undefined && DISQUALIFYING_AFTER.includes(after)) continue;
    const before = tokens[index - 1];
    if (before !== undefined && DISQUALIFYING_BEFORE.includes(before)) continue;

    // Surviving both neighbours means the word is being used as the product's
    // own colourway. Report the phrase it was found in as the evidence.
    const from = Math.max(0, index - 2);
    return { white: true, evidence: tokens.slice(from, index + 2).join(' ') };
  }

  return { white: false, refusal: sawColourWord ? 'describes-something-else' : 'no-colour-word' };
}

/** The parts of a catalogue that belong in the white collection. */
export function whiteParts(parts: readonly AffiliatePart[]): AffiliatePart[] {
  return parts.filter((part) => classifyWhiteFinish(part.name).white);
}

/**
 * Categories whose finish is not part of how a finished build looks.
 *
 * A CPU sits under a cooler and an SSD sits inside the case or under a
 * motherboard heatsink; neither is visible once the side panel is on, and
 * merchant titles for them never state a colour. Filtering these by finish
 * therefore removes every option in the category on the strength of a word
 * that was never going to appear — which does not make the build whiter, it
 * makes it impossible to finish.
 *
 * Deliberately a short list. Everything not named here is treated as visible
 * and is filtered, including motherboards, RAM and peripherals — those do
 * come in white, so a category with none is a real absence and says so.
 */
export const COLOR_NEUTRAL_CATEGORIES: readonly string[] = ['cpu', 'storage'];

export function isColorNeutralCategory(category: string): boolean {
  return COLOR_NEUTRAL_CATEGORIES.includes(category);
}

/**
 * What the White build shows.
 *
 * Appearance-relevant categories are narrowed to listings whose merchant title
 * states a white finish. Colour-neutral ones keep their normal compatible
 * products, because the collection is about what the build LOOKS like and
 * these parts are not part of that.
 *
 * This is not a relaxation of the evidence rule: nothing here is called white.
 * A CPU shown in this view is shown as an ordinary CPU, and the white claim is
 * still made only where a merchant title makes it.
 */
export function whiteBuildParts(parts: readonly AffiliatePart[]): AffiliatePart[] {
  return parts.filter(
    (part) => isColorNeutralCategory(part.category) || classifyWhiteFinish(part.name).white,
  );
}

/** How many white products each category has, for the navigation counts. */
export function whiteCountsByCategory(
  parts: readonly AffiliatePart[],
): Partial<Record<RetailPartCategory, number>> {
  const counts: Partial<Record<RetailPartCategory, number>> = {};
  for (const part of whiteParts(parts)) {
    counts[part.category] = (counts[part.category] ?? 0) + 1;
  }
  return counts;
}

/** Shown where an APPEARANCE-RELEVANT category has no verified white product. Not an error. */
export const WHITE_EMPTY_MESSAGE =
  'No listing in this category states a white finish in its title. Rather than guess from a photograph, this collection shows nothing here.';

/** The collection's own explanation, shown once where it is switched on. */
export const WHITE_COLLECTION_NOTE =
  'Only listings whose merchant title states a white finish — "White Edition", "-WHITE", "SNOW". Colour is never inferred from a photograph or a model name.';
