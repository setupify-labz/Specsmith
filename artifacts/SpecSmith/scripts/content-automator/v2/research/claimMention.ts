// Deciding whether a line of script is talking about a claim.
//
// WHY THIS IS ITS OWN MODULE
// ---------------------------
// Both the evidence gate and the strict evidence gate depend on this judgment,
// and until now each carried its own copy of it. Two copies of a security-
// relevant matcher drift, and the moment they disagree one of the two gates is
// weaker than the other without anyone choosing that. There is one matcher.
//
// THE TWO FAILURE MODES IT HAS TO BALANCE
// ----------------------------------------
// Too narrow, and a script asserts a refused claim in slightly different words
// and sails through. Too broad, and a title saying "GPU" matches every hardware
// claim ever made, the gate screams constantly, and someone switches it off —
// at which point it protects nothing at all.
//
// The rule that resolves it: match on what is DISTINCTIVE, and treat the
// claim's FIGURES as more distinctive than its nouns.
//
// WHY FIGURES COUNT FOR MORE
// ---------------------------
// A claim's subject can be referred to without naming it. SpecSmith's flagship
// format is literally a blind comparison — "Pick the GPU before SpecSmith
// reveals the names" — so a script asserting the comparison will often say "the
// first card", never "Example GPU-A". Requiring two distinctive tokens meant
// such a line shared only the percentage with the claim and went unblocked,
// which is the exact assertion the research refused.
//
// A figure is different. There is no innocent reason for a script to say "40%
// faster" when research refused a 40%-faster claim. So one figure match is
// enough, while ordinary words still need two. A bare subject mention is
// deliberately NOT enough: saying "the Widget-9000 ships next month" mentions
// the subject of a refused claim without asserting that claim.
//
// WHY NORMALIZATION RATHER THAN A BLACKLIST
// ------------------------------------------
// "40%", "40 percent" and "forty percent" are the same assertion. So are
// "$549.99" and "549.99". And "GPU‑A" (non-breaking hyphen) and
// "GPU​A" (zero-width space) are the same identifier as "GPU-A" to every
// reader and a different one to a naive tokenizer. Normalizing these is not a
// list of banned phrases that an attacker can step around — it removes the
// representational slack that made stepping around possible.

/**
 * Generic domain vocabulary that identifies nothing.
 *
 * Every SpecSmith script says "gpu" and "fps". Letting those count towards a
 * match means every line matches every hardware claim, and the gate then blocks
 * copy that never mentioned the claim at all.
 */
const GENERIC_TERMS = new Set([
  "gpu", "cpu", "card", "cards", "fps", "price", "prices", "faster", "slower",
  "better", "worse", "performance", "specs", "spec", "build", "pc", "game",
  "games", "gaming", "memory", "vram", "new", "best", "buy", "value",
]);

/**
 * Words carrying no identity, including the hedges.
 *
 * The hedges are here because a hedge is not part of what a claim asserts —
 * NOT because a hedge makes a claim acceptable. Whether hedging excuses an
 * unsupported assertion is decided in strictEvidenceGate.ts, where the answer
 * is no.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on",
  "at", "for", "with", "this", "that", "it", "its", "than", "more", "less", "be",
  "has", "have", "costs", "cost", "gets", "get", "may", "might", "could",
  "about", "roughly", "approximately", "around", "possibly", "seems", "seem",
  "really", "just", "very", "some", "evidence", "suggests", "not",
]);

/** Number words, for turning "forty percent" into the same token as "40%". */
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Collapses the ways the same characters can be written.
 *
 * NFKC folds full-width and compatibility forms. The dash class covers every
 * Unicode hyphen a word processor or a copy-paste might introduce. The
 * zero-width class covers invisible characters that split an identifier into
 * two harmless-looking halves — the trick that turned "GPU-A" into the generic
 * token "gpu".
 */
export function normalizeForMatching(value: string): string {
  return value
    .normalize("NFKC")
    // Zero-width and bidi formatting characters: delete, never separate.
    .replace(/[​-‏‪-‮⁠-⁤﻿­]/g, "")
    // Every dash-like character becomes the ASCII hyphen the tokenizer keeps.
    .replace(/[‐-―⁃−﹘﹣－]/g, "-")
    .toLowerCase();
}

/** A spelled number, plus the token that ended it — which carries its unit. */
interface SpelledNumber {
  readonly value: number;
  readonly terminator?: string;
}

/**
 * Splits a run of number words into the numbers it actually spells.
 *
 * English number grammar is [hundreds] [tens] [units], and a word that cannot
 * follow what came before starts a NEW number. "five hundred forty nine ninety
 * nine" is therefore 549 and 99, not one 648 — a naive left-to-right sum reads
 * a spoken price as a number nobody said, and the claim's figure is then
 * missed entirely.
 */
function spelledNumbers(words: readonly string[]): SpelledNumber[] {
  const numbers: SpelledNumber[] = [];
  let current = 0;
  let started = false;
  let tensApplied = false;
  let unitsApplied = false;

  const flush = (terminator?: string) => {
    if (started) numbers.push({ value: current, terminator });
    current = 0;
    started = false;
    tensApplied = false;
    unitsApplied = false;
  };

  for (const word of words) {
    if (word === "hundred") {
      if (!started) { flush(); continue; }
      current = (current === 0 ? 1 : current) * 100;
      tensApplied = false;
      unitsApplied = false;
      continue;
    }
    if (word in TENS) {
      // A tens word cannot follow another tens word or a units word.
      if (tensApplied || unitsApplied) flush();
      current += TENS[word];
      started = true;
      tensApplied = true;
      continue;
    }
    if (word in UNITS) {
      const value = UNITS[word];
      // A units word cannot follow another units word, and a teen cannot
      // follow a tens word ("forty fifteen" is two numbers).
      if (unitsApplied || (tensApplied && value >= 10)) flush();
      current += value;
      started = true;
      unitsApplied = true;
      continue;
    }
    flush(word);
  }
  flush(undefined);
  return numbers;
}

/** A canonical figure token: the quantitative core of an assertion. */
function figureToken(value: number, unit: "pct" | "money" | "plain"): string {
  const rounded = Math.round(value * 100) / 100;
  return `fig:${rounded}${unit === "pct" ? "pct" : ""}`;
}

/**
 * Extracts every figure a line asserts, in canonical form.
 *
 * A decimal also emits its integer part, so a price written "$549.99" and one
 * spoken as "five hundred forty nine ninety nine" still meet on `fig:549`.
 */
function extractFigures(normalized: string): string[] {
  const figures = new Set<string>();

  // Digit percentages: "40%", "40 percent", "40 pct".
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent|pct\b)/g)) {
    figures.add(figureToken(Number(match[1]), "pct"));
  }

  // Money and bare decimals: "$549.99", "549.99 dollars", "549.99".
  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars|usd)\b/g)) {
    const raw = Number(match[1] ?? match[2]);
    figures.add(figureToken(raw, "money"));
    if (!Number.isInteger(raw)) figures.add(figureToken(Math.trunc(raw), "money"));
  }
  for (const match of normalized.matchAll(/(?<![\w$.])(\d+\.\d+)(?![\w%])/g)) {
    const raw = Number(match[1]);
    figures.add(figureToken(raw, "money"));
    figures.add(figureToken(Math.trunc(raw), "money"));
  }

  // Spelled-out numbers. Walked as one token sequence, because the unit that
  // gives a number its meaning sits immediately AFTER it — an earlier version
  // looked only at the end of a run of words, so "forty percent faster than the
  // second" was read as a bare 40 and never met the claim's "40%".
  const PERCENT_MARKERS = new Set(["percent", "pct", "%"]);
  const sequence = normalized.match(/[a-z]+|%/g) ?? [];
  const spelled = spelledNumbers(sequence);
  for (const entry of spelled) {
    if (entry.terminator !== undefined && PERCENT_MARKERS.has(entry.terminator)) {
      figures.add(figureToken(entry.value, "pct"));
    }
    figures.add(figureToken(entry.value, "money"));
  }

  // A SPOKEN price. Nobody narrating a short-form video says "five hundred and
  // forty nine point nine nine" — they say "five forty nine ninety nine", which
  // is not a well-formed number at all and so parses above as 5, 49 and 99.
  // Read consecutive groups as digits of one price whose last two digits are
  // cents. Two or more groups are required, so an ordinary "three cards" does
  // not acquire a price reading.
  for (let start = 0; start < spelled.length; start += 1) {
    for (let end = start + 2; end <= spelled.length; end += 1) {
      const digits = spelled.slice(start, end).map((entry) => String(entry.value)).join("");
      if (digits.length < 3 || digits.length > 7) continue;
      const spoken = Number(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
      if (!Number.isFinite(spoken)) continue;
      figures.add(figureToken(spoken, "money"));
      figures.add(figureToken(Math.trunc(spoken), "money"));
    }
  }

  return [...figures];
}

/** Tokens that are not figures: ordinary identifying words. */
function wordTokens(normalized: string): string[] {
  return normalized
    .split(/[^a-z0-9$%.\-]+/)
    .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter(Boolean);
}

/**
 * The comparison form of an identifier.
 *
 * Internal separators are removed so "gpu-a" and "gpua" are the same part. That
 * matters because a zero-width space inside "GPU-A" deletes to "GPUA" — the
 * character is gone, and with it the hyphen that made the token distinctive.
 * Comparing canonical forms closes that without weakening the generic-word
 * protection: "gpu" canonicalizes to "gpu" and is still discarded, while
 * "gpu-a" canonicalizes to "gpua" and is still kept.
 */
function canonicalToken(token: string): string {
  return token.replace(/[-.]/g, "");
}

export interface MentionAnalysis {
  readonly mentions: boolean;
  /** Which figures of the claim the line repeats. */
  readonly figureHits: readonly string[];
  /** Which ordinary distinctive words the line repeats. */
  readonly wordHits: readonly string[];
  readonly reason: string;
}

/**
 * Whether a line of script is talking about a claim, and why.
 *
 * One shared figure is sufficient; otherwise two shared distinctive words are
 * required. The analysis is returned rather than a bare boolean so a finding can
 * say what matched, which is what makes a block arguable instead of mysterious.
 */
export function analyseMention(text: string, proposition: string): MentionAnalysis {
  const normalizedText = normalizeForMatching(text);
  const normalizedClaim = normalizeForMatching(proposition);

  const claimFigures = new Set(extractFigures(normalizedClaim));
  const textFigures = new Set(extractFigures(normalizedText));
  const figureHits = [...claimFigures].filter((figure) => textFigures.has(figure));

  // Generic and stop words are judged on the token as written; identity is
  // then compared on the canonical form, deduplicated so one identifier cannot
  // satisfy the two-distinct-words rule on its own.
  const distinctiveWords = [
    ...new Map(
      wordTokens(normalizedClaim)
        .filter(
          (token) =>
            token.length > 2 &&
            !STOP_WORDS.has(token) &&
            !GENERIC_TERMS.has(token) &&
            // A token that is purely a figure is handled by the figure path;
            // counting it twice would let "40%" alone satisfy the word rule.
            !/^[\d$%.]+$/.test(token),
        )
        .map((token) => [canonicalToken(token), token] as const),
    ).keys(),
  ].filter(Boolean);
  const textWords = new Set(wordTokens(normalizedText).map(canonicalToken));
  const wordHits = distinctiveWords.filter((token) => textWords.has(token));

  if (figureHits.length > 0) {
    return {
      mentions: true,
      figureHits,
      wordHits,
      reason: `repeats the claim's figure (${figureHits.join(", ")})`,
    };
  }
  if (distinctiveWords.length === 0) {
    return { mentions: false, figureHits: [], wordHits: [], reason: "the claim carries no distinctive wording to match" };
  }
  const enough = wordHits.length >= 2 || (distinctiveWords.length <= 2 && wordHits.length === distinctiveWords.length);
  return {
    mentions: enough,
    figureHits: [],
    wordHits,
    reason: enough
      ? `repeats the claim's distinctive wording (${wordHits.join(", ")})`
      : `shares only ${wordHits.length} distinctive word(s) and none of its figures`,
  };
}

/** Boolean form, for call sites that do not need the explanation. */
export function mentionsClaim(text: string, proposition: string): boolean {
  return analyseMention(text, proposition).mentions;
}
