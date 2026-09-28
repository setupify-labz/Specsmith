// How many words a line takes to SAY, not to write, and which figures it says.
//
// Narration timing counted whitespace tokens, so "164 to 160 at 1440p" was
// five words. Spoken it is far more, and HOW a voice reads a numeral is not
// ours to choose: a render with the offline voice read "164" as "one hundred
// and sixty-four" and ran 2.8 seconds past a 24-second plan, so the "79 to 77"
// line played over the next screen.
//
// So the scripted Compare narration writes every figure out the way it should
// be said ("one sixty-four", "fourteen-forty"), and says no digit at all.
// `spokenWordCount` counts those words; `spokenFigures` reads the figures back
// out so they can still be checked against the page.

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Words to say a whole number below 100: "twenty" is one, "seventy-nine" two. */
function underHundred(value: number): number {
  if (value === 0) return 0;
  if (value < 20 || value % 10 === 0) return 1;
  return 2;
}

/** Words to say a run of digits. Conservative: a voice says "hundred". */
function digitsSpoken(digits: string): number {
  const value = Number(digits);
  if (digits.length <= 2) return Math.max(1, underHundred(value));
  if (digits.length === 3) return 2 + underHundred(value % 100); // "one hundred sixty-four"
  if (digits.length === 4) {
    return Math.max(1, underHundred(Number(digits.slice(0, 2)))) + Math.max(1, underHundred(Number(digits.slice(2))));
  }
  return digits.length;
}

/** Spoken words in one whitespace-free token. Hyphenated parts are words. */
function tokenSpoken(token: string): number {
  return token.split("-").reduce((total, part) => {
    const word = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word) return total;
    const numeric = /^(\d+)([a-z]*)$/i.exec(word);
    if (numeric) return total + digitsSpoken(numeric[1]) + (numeric[2] ? numeric[2].length : 0);
    // CPU, FPS, RTX: said letter by letter.
    if (/^[A-Z]{2,4}$/.test(word)) return total + word.length;
    return total + 1;
  }, 0);
}

/** The number of words it takes to read `text` aloud. */
export function spokenWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).reduce((total, token) => total + tokenSpoken(token), 0);
}

/** 0-99 in words: "twenty", "seventy-nine", "fourteen". */
function twoDigitWords(value: number): string {
  if (value < 10) return UNITS[value];
  if (value < 20) return TEENS[value - 10];
  const tens = TENS[Math.floor(value / 10)];
  return value % 10 === 0 ? tens : `${tens}-${UNITS[value % 10]}`;
}

/**
 * A figure as the narration says it: "twenty", "seventy-nine", and a
 * three-digit figure the way people read an FPS count, "one sixty-four".
 */
export function spokenFigure(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error(`No spoken form for ${value}.`);
  if (value < 100) return twoDigitWords(value);
  const rest = value % 100;
  if (rest === 0) return `${UNITS[Math.floor(value / 100)]} hundred`;
  // "two oh-five" is not something spokenFigures can read back, so there is
  // no reviewed spoken form for it yet. Refused rather than said unchecked.
  if (rest < 10) throw new Error(`No reviewed spoken form for ${value}.`);
  return `${UNITS[Math.floor(value / 100)]} ${twoDigitWords(rest)}`;
}

/** Names that are said as numbers but are not figures: parts and settings. */
const SPOKEN_NAMES = /\b(forty-eighty|fourteen-forty|ten-eighty|four-k)\b/gi;

/** The value of one 0-99 word or hyphenated pair, or undefined. */
function wordValue(word: string): number | undefined {
  const [first, second] = word.toLowerCase().split("-");
  const unit = UNITS.indexOf(first);
  if (second === undefined) {
    if (unit >= 0) return unit;
    if (TEENS.includes(first)) return 10 + TEENS.indexOf(first);
    if (TENS.includes(first) && first !== "") return 10 * TENS.indexOf(first);
    return undefined;
  }
  const tens = TENS.indexOf(first);
  const ones = UNITS.indexOf(second);
  return tens >= 2 && ones >= 1 ? 10 * tens + ones : undefined;
}

/**
 * Every figure spoken in `text`, in order, read back from words. A unit word
 * followed by a 10-99 word is one three-digit figure ("one sixty-four" = 164);
 * part and setting names ("forty-eighty", "fourteen-forty", "four-K") are not
 * figures and are skipped.
 */
export function spokenFigures(text: string): number[] {
  const words = text.replace(SPOKEN_NAMES, " ").split(/[^A-Za-z-]+/).filter(Boolean);
  const figures: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const value = wordValue(words[index]);
    if (value === undefined) continue;
    const next = index + 1 < words.length ? wordValue(words[index + 1]) : undefined;
    if (value >= 1 && value <= 9 && next !== undefined && next >= 10) {
      figures.push(value * 100 + next);
      index += 1;
    } else {
      figures.push(value);
    }
  }
  return figures;
}
