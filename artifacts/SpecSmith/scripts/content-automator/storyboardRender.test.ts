// The timing arithmetic that the first real render of a generated storyboard
// forced into existence. The render itself is exercised by running
// `content:e2e:storyboard` against a served build; these cover the pure logic
// that decides whether a storyboard can be spoken in the time it allotted.

import { describe, expect, it } from "vitest";

import {
  measureStoryboardTiming,
  narrationSecondsFor,
  NARRATION_WORDS_PER_MINUTE,
} from "./storyboardRender";

const beat = (purpose: string, startSecond: number, endSecond: number, narration: string) =>
  ({ purpose, startSecond, endSecond, narration });

/** The real generated storyboard's shape: 90 words in a 24-second target. */
const OVERRUNNING = {
  targetDurationSeconds: 24,
  beats: [
    beat("hook", 0, 2, "Can you pick the faster card before the names show up here"),
    beat("commitment", 2, 6, Array.from({ length: 19 }, () => "word").join(" ")),
    beat("evidence", 6, 12, Array.from({ length: 18 }, () => "word").join(" ")),
    beat("reversal", 12, 18, Array.from({ length: 16 }, () => "word").join(" ")),
    beat("payoff", 18, 22, Array.from({ length: 19 }, () => "word").join(" ")),
    beat("cta", 22, 24, Array.from({ length: 8 }, () => "word").join(" ")),
  ],
};

describe("measuring narration against the clock a storyboard gave itself", () => {
  it("uses a natural speaking rate, not a convenient one", () => {
    // 165 wpm is espeak-ng's default and sits inside the 150-180 wpm range
    // natural speech occupies. A professional read is not faster, so this is
    // not an excuse built around the fixture being slow.
    expect(NARRATION_WORDS_PER_MINUTE).toBe(165);
    expect(narrationSecondsFor(Array.from({ length: 165 }, () => "word").join(" "))).toBeCloseTo(60, 5);
    expect(narrationSecondsFor("   ")).toBe(0);
  });

  it("catches the real defect: 24 seconds of clock, 33 seconds of words", () => {
    const fit = measureStoryboardTiming(OVERRUNNING);
    expect(fit.targetSeconds).toBe(24);
    expect(fit.narrationSeconds).toBeGreaterThan(32);
    expect(fit.overrunRatio).toBeGreaterThan(1.3);
    expect(fit.overruns).toBe(true);
  });

  it("attributes the overrun per beat instead of averaging it away", () => {
    // The first render showed five of six beats individually over. A single
    // total would let a reader assume one long beat was the problem.
    const fit = measureStoryboardTiming(OVERRUNNING);
    const over = fit.beats.filter((entry) => entry.neededSeconds > entry.windowSeconds);
    expect(over.map((entry) => entry.purpose)).toEqual(["hook", "commitment", "evidence", "payoff", "cta"]);
    expect(fit.beats).toHaveLength(6);
  });

  it("reports a storyboard that does fit as fitting", () => {
    const fits = { targetDurationSeconds: 30, beats: [beat("hook", 0, 30, "short line")] };
    const fit = measureStoryboardTiming(fits);
    expect(fit.overruns).toBe(false);
    expect(fit.overrunRatio).toBeLessThan(1);
  });
});

describe("the timeline is no longer stretched to fit over-long narration", () => {
  it("exports no rescaling helper", async () => {
    // `fitPlanToNarration` scaled every clock by 1.36x so a 90-word script
    // could be watched, turning a 24-second short into a 34-second one that
    // nobody chose. The copy was shortened instead, and the helper is gone so
    // it cannot quietly come back.
    const module = await import("./storyboardRender");
    expect(Object.keys(module)).not.toContain("fitPlanToNarration");
  });

  it("still measures the margin, because how close a script runs is worth seeing", () => {
    const fit = measureStoryboardTiming(OVERRUNNING);
    expect(fit.narrationSeconds).toBeGreaterThan(0);
    expect(fit.beats).toHaveLength(6);
  });
});
