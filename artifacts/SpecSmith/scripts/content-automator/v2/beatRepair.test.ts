// Beat repair tests.
//
// The three guarantees worth protecting here, in order of how badly a
// regression would hurt:
//
//   1. Beats no fix named come back byte for byte. Without this, "targeted
//      repair" is just regeneration with extra steps and no revision is
//      comparable to its parent.
//   2. A pass that does not improve anything is REJECTED, not kept. Otherwise
//      running the loop becomes a substitute for the creative getting better.
//   3. Fixes needing new creative material are refused and recorded. A repair
//      that invents a visual direction or cuts a claim in half is fabrication,
//      and a silent refusal is indistinguishable from the problem not existing.

import { describe, expect, it } from "vitest";

import { assertUntouchedBeatsPreserved, repairCreative } from "./beatRepair.ts";
import { reviewCreativeQuality } from "./creativeQualityReview.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");
const OVERLONG_CAPTION = "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080";

function beat(overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat {
  return {
    narration: "SpecSmith holds the rest of the build constant.",
    visualDirection: `unique direction ${overrides.startSecond}`,
    onScreenText: "REAL SPECS",
    factDependencies: [],
    ...overrides,
  };
}

function storyboard(overrides: Partial<PlatformScriptStoryboard> = {}): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    title: "RTX 4080 Super vs RTX 4080",
    narrationStyle: "direct",
    beats: [
      beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
      beat({ startSecond: 2, endSecond: 8, purpose: "commitment", onScreenText: "LOCK YOUR PICK" }),
      beat({ startSecond: 8, endSecond: 16, purpose: "evidence", onScreenText: "REAL SPECS" }),
      beat({ startSecond: 16, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare and change the cards." }),
    ],
    finalCta: "Open SpecSmith Compare.",
    factualGuardrails: [],
    ...overrides,
  };
}

function cuesFor(board: PlatformScriptStoryboard): CaptionCue[] {
  return board.beats
    .filter((entry) => entry.onScreenText.trim().length > 0)
    .map((entry) => ({ startSecond: entry.startSecond, endSecond: entry.endSecond, text: entry.onScreenText }));
}

const reviewer = (ctaRoute = "/compare") => (board: PlatformScriptStoryboard) =>
  reviewCreativeQuality({
    creativeId: "creative-1",
    packageId: "pkg-1",
    storyboard: board,
    captionCues: cuesFor(board),
    ctaRoute,
    mediaSha256: null,
    now: NOW,
  });

function repair(board: PlatformScriptStoryboard, overrides: Partial<Parameters<typeof repairCreative>[0]> = {}) {
  return repairCreative({
    creativeId: "creative-1",
    storyboard: board,
    review: reviewer(),
    ctaRoute: "/compare",
    ...overrides,
  });
}

describe("repairCreative touches only what a fix named", () => {
  it("leaves every unnamed beat byte-identical after shortening one caption", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: OVERLONG_CAPTION } : entry));
    const input = storyboard({ beats });
    const result = repair(input);

    const changed = result.passes.flatMap((pass) => pass.lineage.changedBeats);
    expect(changed).toContain(2);
    for (const [index, original] of input.beats.entries()) {
      if (changed.includes(index)) continue;
      expect(JSON.stringify(result.finalStoryboard.beats[index]), `beat ${index + 1} was modified without being named`).toBe(JSON.stringify(original));
    }
  });

  it("never changes the beat count", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: OVERLONG_CAPTION } : entry));
    const result = repair(storyboard({ beats }));
    expect(result.finalStoryboard.beats).toHaveLength(4);
  });

  it("preserves total duration when it clamps an over-long hook", () => {
    const input = storyboard({
      beats: [
        beat({ startSecond: 0, endSecond: 8, purpose: "hook", onScreenText: "Names hidden" }),
        beat({ startSecond: 8, endSecond: 12, purpose: "commitment", onScreenText: "LOCK YOUR PICK" }),
        beat({ startSecond: 12, endSecond: 16, purpose: "evidence" }),
        beat({ startSecond: 16, endSecond: 20, purpose: "payoff", onScreenText: "SPECSMITH RESULT" }),
        beat({ startSecond: 20, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare." }),
      ],
    });
    const result = repair(input);
    const final = result.finalStoryboard.beats;
    expect(final[0].endSecond).toBe(3);
    expect(final[1].startSecond).toBe(3);
    expect(final.at(-1)!.endSecond).toBe(24);
    // No gap is opened anywhere: the reclaimed time was spread across the rest.
    for (let i = 1; i < final.length; i += 1) {
      expect(final[i].startSecond).toBe(final[i - 1].endSecond);
    }
    // And no beat absorbed so much that it broke its own envelope.
    for (const entry of final.slice(1)) {
      expect(entry.endSecond - entry.startSecond).toBeLessThanOrEqual(8);
    }
  });

  it("throws rather than silently accept a repair that edited an unnamed beat", () => {
    const before = storyboard();
    const after = storyboard({
      beats: before.beats.map((entry, index) => (index === 3 ? { ...entry, narration: "changed" } : entry)),
    });
    expect(() => assertUntouchedBeatsPreserved(before, after, [0])).toThrow(/modified beat 4/);
    expect(() => assertUntouchedBeatsPreserved(before, after, [3])).not.toThrow();
  });

  it("throws when a repair adds or removes a beat", () => {
    const before = storyboard();
    const after = storyboard({ beats: before.beats.slice(0, 3) });
    expect(() => assertUntouchedBeatsPreserved(before, after, [0, 1, 2, 3])).toThrow(/beat count/);
  });
});

describe("repairCreative records honest lineage", () => {
  it("links each revision to its parent and records the score either side", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: OVERLONG_CAPTION } : entry));
    const result = repair(storyboard({ beats }));

    expect(result.passes.length).toBeGreaterThan(0);
    const first = result.passes[0].lineage;
    expect(first.parentCreativeId).toBe("creative-1");
    expect(first.revisionId).toBe("creative-1-r1");
    expect(first.pass).toBe(1);
    expect(first.changeReason).toContain("shorten-caption-at-clause");
    expect(first.improvedDimensions).toContain("caption-density");
    expect(first.regressedDimensions).toEqual([]);
    expect(first.bestDimensionGain).toBeGreaterThan(0);
    expect(first.accepted).toBe(true);
    expect(result.finalCreativeId).toBe("creative-1-r1");
  });

  it("rejects a pass that does not improve the review, and keeps the parent", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: OVERLONG_CAPTION } : entry));
    const input = storyboard({ beats });
    // An impossible improvement threshold: every pass must now be rejected.
    const result = repair(input, { minImprovement: 99 });

    expect(result.passes[0].lineage.accepted).toBe(false);
    expect(result.passes[0].lineage.rejectionReason).toMatch(/under the 99 minimum/);
    expect(result.passes[0].lineage.improvedDimensions.length).toBeGreaterThan(0);
    expect(result.stoppedBecause).toBe("no-further-improvement");
    // The parent survives untouched: a rejected revision changes nothing.
    expect(JSON.stringify(result.finalStoryboard)).toBe(JSON.stringify(input));
    expect(result.finalCreativeId).toBe("creative-1");
  });

  it("keeps a pass that clears a hard failure even when the average score does not move", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) =>
      index === 1 ? { ...entry, narration: "We benchmarked both cards ourselves." } : entry,
    );
    const result = repair(storyboard({ beats }), { minImprovement: 99 });
    expect(result.passes[0].lineage.accepted).toBe(true);
    expect(result.finalReview.slop.hardFailures).toHaveLength(0);
  });

  it("stops at maxPasses rather than looping forever", () => {
    const board = storyboard();
    const beats = board.beats.map((entry) => ({ ...entry, visualDirection: "the same shot" }));
    const result = repair(storyboard({ beats }), { maxPasses: 2 });
    expect(result.passes.length).toBeLessThanOrEqual(2);
  });
});

describe("repairCreative refuses to invent content", () => {
  it("removes exactly the located slop phrase and nothing else", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) =>
      index === 1 ? { ...entry, narration: "We benchmarked both cards at 1440p." } : entry,
    );
    const result = repair(storyboard({ beats }));
    expect(result.finalStoryboard.beats[1].narration).toBe("both cards at 1440p.");
    expect(result.finalReview.slop.hardFailures).toHaveLength(0);
  });

  it("refuses to invent a visual direction for repeated shots, and says so", () => {
    const board = storyboard();
    const beats = board.beats.map((entry) => ({ ...entry, visualDirection: "the same shot" }));
    const result = repair(storyboard({ beats }));
    const refusal = result.unrepairable.find((entry) => entry.fix.dimension === "visual-repetition");
    expect(refusal?.reason).toMatch(/fabrication/i);
    // And it genuinely did not change any visual direction.
    for (const entry of result.finalStoryboard.beats) expect(entry.visualDirection).toBe("the same shot");
  });

  it("refuses to cut narration to reduce information density", () => {
    const beats = [
      beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden", narration: "Ten separate words crammed into two short seconds is much too dense." }),
      beat({ startSecond: 2, endSecond: 10, purpose: "evidence" }),
      beat({ startSecond: 10, endSecond: 18, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare." }),
    ];
    const input = storyboard({ beats });
    const result = repair(input);
    const refusal = result.unrepairable.find((entry) => entry.fix.dimension === "information-density");
    expect(refusal?.reason).toMatch(/changes what the video claims/i);
    expect(result.finalStoryboard.beats[0].narration).toBe(input.beats[0].narration);
  });

  it("shortens a caption only at a clause boundary, never mid-sentence", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: OVERLONG_CAPTION } : entry));
    const result = repair(storyboard({ beats }));
    expect(result.finalStoryboard.beats[2].onScreenText).toBe("Pick the GPU before SpecSmith reveals the names");
  });

  it("leaves an overlong caption with no clause boundary alone, and records the refusal", () => {
    const noBoundary = "one very long unbroken caption line that simply keeps going and going";
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: noBoundary } : entry));
    const result = repair(storyboard({ beats }));
    expect(result.finalStoryboard.beats[2].onScreenText).toBe(noBoundary);
    const refusal = result.unrepairable.find((entry) => entry.fix.dimension === "caption-density");
    expect(refusal?.reason).toMatch(/no clause boundary/i);
  });

  it("states the known CTA route without inventing one", () => {
    const board = storyboard();
    const beats = board.beats.map((entry) =>
      entry.purpose === "cta" ? { ...entry, narration: "Head over to the site." } : entry,
    );
    const result = repair(storyboard({ beats }));
    expect(result.finalStoryboard.beats[3].narration).toBe("Head over to the site. Open /compare.");
  });
});
