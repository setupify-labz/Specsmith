// Adversarial coverage for the claim matcher.
//
// The independent audit repaired the hedge bypass: adding "may" no longer
// excuses an unsupported assertion. That repair reused the existing matcher
// verbatim, and the matcher was where the remaining hole was — every case in
// "the matcher cannot be stepped around" below was a CONFIRMED bypass of the
// repaired gate before the fixes in claimMention.ts.
//
// The two halves of this file are equally load-bearing. A gate that blocks
// everything is switched off within a week and then protects nothing, so the
// honest-copy half is not decoration: it is what keeps the strict half
// deployable.

import { describe, expect, it } from "vitest";

import { analyseMention, mentionsClaim, normalizeForMatching } from "./claimMention.ts";

const COMPARISON = "Example GPU-A is 40% faster than GPU-B";
const PRICE = "Example GPU-A costs $549.99";
const SUBJECT = "Widget-9000 runs quieter than Widget-8000";

describe("the matcher cannot be stepped around", () => {
  it("catches an assertion that names no product, as a blind comparison would", () => {
    // SpecSmith's flagship format deliberately hides the product names, so a
    // script asserting the comparison shares only the figure with the claim.
    // Requiring two distinctive tokens let exactly this line through.
    expect(mentionsClaim("The first card is 40% faster than the second", COMPARISON)).toBe(true);
  });

  it.each([
    ["percent as a word", "The first card is 40 percent faster than the second"],
    ["percent spelled out", "The first card is forty percent faster than the second"],
    ["percent sign spaced", "The first card is 40 % faster"],
    ["full-width digits", "The first card is ４０％ faster than the second"],
    ["rhetorical fragment", "Forty percent. That is the gap."],
    ["very short assertion", "40% faster."],
    ["comparative reversed", "GPU-B is 40% slower than Example GPU-A"],
    ["buried in a long sentence", "If you are building on a budget this year and wondering which of these two cards to pick, the honest answer is that the first is 40% faster"],
  ])("catches the same figure written as %s", (_label, text) => {
    expect(mentionsClaim(text, COMPARISON)).toBe(true);
  });

  it.each([
    ["non-breaking hyphen", "Example GPU‑A is 40% faster than GPU‑B"],
    ["zero-width space inside the identifier", "Example GPU​A beats GPU​B"],
    ["soft hyphen", "Example GPU­A beats GPU­B"],
  ])("sees through %s in a product identifier", (_label, text) => {
    // Without normalization these split "gpu-a" into the generic token "gpu",
    // which GENERIC_TERMS then discards — an invisible character defeating the
    // whole matcher.
    expect(mentionsClaim(text, COMPARISON)).toBe(true);
  });

  it.each([
    ["no currency symbol", "It is 549.99 right now"],
    ["currency word", "It is 549.99 USD"],
    ["integer only", "It costs 549 dollars"],
    ["spelled in full", "It costs five hundred forty nine ninety nine"],
    ["spoken price shorthand", "Five forty nine ninety nine"],
  ])("catches a stale price written as %s", (_label, text) => {
    expect(mentionsClaim(text, PRICE)).toBe(true);
  });

  it("still catches a claim with no figure at all, on its distinctive words", () => {
    expect(mentionsClaim("The Widget-9000 is quieter than the Widget-8000", SUBJECT)).toBe(true);
  });

  it("is unaffected by hedging, negation or question form", () => {
    for (const text of [
      "Example GPU-A may be 40% faster than GPU-B",
      "Example GPU-A is not 40% faster than GPU-B",
      "Is Example GPU-A really 40% faster than GPU-B?",
      "Some evidence suggests the first card is 40% faster",
      "It seems the first card is possibly 40% faster",
    ]) {
      expect(mentionsClaim(text, COMPARISON), text).toBe(true);
    }
  });
});

describe("honest copy is not blocked", () => {
  it.each([
    ["the blind hook", "Pick the GPU before SpecSmith reveals the names"],
    ["the CTA", "Open SpecSmith Compare and change the cards yourself"],
    ["general advice", "Check your PSU wattage before you upgrade anything"],
    ["a different figure", "This card has 12GB of memory"],
    ["generic performance talk", "Frame rates depend on your resolution and settings"],
    ["real pipeline copy", "SpecSmith holds the rest of the build constant"],
    ["an evidence beat", "REAL SPECS • REAL PRICES • REAL RULES"],
    ["a commitment beat", "LOCK YOUR PICK"],
    ["a count", "We compare three cards in this series"],
    ["a year", "The best builds of twenty twenty four"],
  ])("does not match %s against a comparison claim", (_label, text) => {
    expect(mentionsClaim(text, COMPARISON)).toBe(false);
  });

  it.each([
    ["a different price", "Budget builds usually land around $800"],
    ["price talk with no figure", "Prices move daily, so always check the listing"],
    ["a beat count", "Two cards, one build, zero guesswork"],
  ])("does not match %s against a price claim", (_label, text) => {
    expect(mentionsClaim(text, PRICE)).toBe(false);
  });

  it("does not treat a bare subject mention as asserting the claim about it", () => {
    // Naming the subject of a refused claim is not making that claim, and
    // blocking it would stop the generator ever mentioning the product again.
    expect(mentionsClaim("The Widget-9000 ships next month", SUBJECT)).toBe(false);
  });

  it("does not match honest copy that merely shares domain vocabulary", () => {
    // The claim's own wording is almost entirely generic, so without the
    // generic-term filter its tokens would be "gpu", "performance" and
    // "gaming" — words that appear in nearly every SpecSmith line. This is the
    // case that makes GENERIC_TERMS load-bearing rather than decorative.
    const genericClaim = "GPU performance in modern games";
    expect(mentionsClaim("Gaming performance depends on your GPU and your settings", genericClaim)).toBe(false);
    expect(mentionsClaim("We test GPU performance across several games", genericClaim)).toBe(false);
  });

  it("keeps the generic-token protection that predates this file", () => {
    // The original false positive: "GPU" matching every claim about a GPU.
    const analysis = analyseMention("Pick the GPU before SpecSmith reveals the names", COMPARISON);
    expect(analysis.mentions).toBe(false);
    expect(analysis.figureHits).toEqual([]);
    expect(analysis.reason).toMatch(/none of its figures/);
  });
});

describe("the analysis explains itself", () => {
  it("names the figure that matched, so a block can be argued with", () => {
    const analysis = analyseMention("The first card is forty percent faster", COMPARISON);
    expect(analysis.mentions).toBe(true);
    expect(analysis.figureHits).toContain("fig:40pct");
    expect(analysis.reason).toMatch(/repeats the claim's figure/);
  });

  it("names the words that matched when no figure is involved", () => {
    const analysis = analyseMention("The Widget-9000 is quieter than the Widget-8000", SUBJECT);
    // Hits are reported in canonical form, which is what identity compares on.
    expect(analysis.wordHits).toEqual(expect.arrayContaining(["widget9000", "widget8000"]));
    expect(analysis.reason).toMatch(/distinctive wording/);
  });

  it("says why it did not match", () => {
    expect(analyseMention("Open SpecSmith Compare", COMPARISON).reason).toMatch(/shares only 0 distinctive word/);
  });
});

describe("normalization", () => {
  it("folds invisible characters and unicode dashes without changing meaning", () => {
    expect(normalizeForMatching("GPU‑A")).toBe("gpu-a");
    expect(normalizeForMatching("GPU​A")).toBe("gpua");
    expect(normalizeForMatching("４０％")).toBe("40%");
  });

  it("does not distinguish a percentage from its spelled form", () => {
    expect(analyseMention("forty percent", "40%").figureHits).toContain("fig:40pct");
  });

  it("keeps a percentage distinct from the same number as money", () => {
    // 40% and $40 are different assertions and must not match each other.
    expect(analyseMention("it costs $40", "the gain is 40%").figureHits).toEqual([]);
  });

  it("does not match two different figures", () => {
    expect(analyseMention("The first card is 25% faster", COMPARISON).figureHits).toEqual([]);
  });
});
