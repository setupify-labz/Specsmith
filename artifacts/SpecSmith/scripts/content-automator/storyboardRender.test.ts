// The timing arithmetic that the first real render of a generated storyboard
// forced into existence. The render itself is exercised by running
// `content:e2e:storyboard` against a served build; these cover the pure logic
// that decides whether a storyboard can be spoken in the time it allotted.

import { describe, expect, it } from "vitest";

import {
  fitPlanToNarration,
  measureStoryboardTiming,
  narrationSecondsFor,
  NARRATION_WORDS_PER_MINUTE,
} from "./storyboardRender";
import type { PlatformProductionPlan, ProductionTask } from "./types";

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

const planWithClocks = (): PlatformProductionPlan => {
  const compose = {
    taskId: "youtube-shorts-compose",
    capability: "motion-compositor",
    sourceBeat: null,
    purpose: "compose",
    inputRequirements: [],
    outputRequirements: [],
  } as ProductionTask;
  (compose as ProductionTask & { compositorState?: unknown }).compositorState = {
    durationSeconds: 24,
    fps: 30,
    visualTimeline: [
      { visualTaskId: "a", startSecond: 0, endSecond: 2 },
      { visualTaskId: "b", startSecond: 2, endSecond: 24 },
    ],
  };
  const captions = { ...compose, taskId: "youtube-shorts-captions", capability: "caption-render" } as ProductionTask;
  delete (captions as ProductionTask & { compositorState?: unknown }).compositorState;
  (captions as ProductionTask & { captionRenderState?: unknown }).captionRenderState = {
    durationSeconds: 24,
    cues: [{ text: "one", startSecond: 0, endSecond: 2 }],
  };
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    tasks: [compose, captions],
  } as PlatformProductionPlan;
};

describe("stretching the clock so the narration fits", () => {
  it("scales the compositor's OWN clock, not just the headline", () => {
    // The headline `targetDurationSeconds` is not what the compositor
    // validates against — `compositorState.durationSeconds` and its
    // visualTimeline are. Scaling only the headline left the render failing
    // on the identical mismatch while the plan claimed to have fixed it.
    const fit = measureStoryboardTiming(OVERRUNNING);
    const { plan, scale } = fitPlanToNarration(planWithClocks(), fit);
    const state = (plan.tasks[0] as ProductionTask & { compositorState: { durationSeconds: number; visualTimeline: { startSecond: number; endSecond: number }[] } }).compositorState;

    expect(scale).toBeGreaterThan(1.3);
    expect(state.durationSeconds).toBeCloseTo(24 * scale, 1);
    expect(state.visualTimeline[1].endSecond).toBeCloseTo(24 * scale, 1);
  });

  it("scales caption cues too, so words stay under the pictures", () => {
    const fit = measureStoryboardTiming(OVERRUNNING);
    const { plan, scale } = fitPlanToNarration(planWithClocks(), fit);
    const state = (plan.tasks[1] as ProductionTask & { captionRenderState: { durationSeconds: number; cues: { endSecond: number }[] } }).captionRenderState;
    expect(state.durationSeconds).toBeCloseTo(24 * scale, 1);
    expect(state.cues[0].endSecond).toBeCloseTo(2 * scale, 1);
  });

  it("preserves every beat's SHARE of the video", () => {
    // The point of scaling rather than padding: beat three still occupies the
    // proportion of the runtime it was written to occupy.
    const fit = measureStoryboardTiming(OVERRUNNING);
    const { plan } = fitPlanToNarration(planWithClocks(), fit);
    const state = (plan.tasks[0] as ProductionTask & { compositorState: { durationSeconds: number; visualTimeline: { startSecond: number; endSecond: number }[] } }).compositorState;
    const firstShare = state.visualTimeline[0].endSecond / state.durationSeconds;
    expect(firstShare).toBeCloseTo(2 / 24, 3);
  });

  it("leaves a storyboard that already fits completely untouched", () => {
    const fits = measureStoryboardTiming({ targetDurationSeconds: 30, beats: [beat("hook", 0, 30, "short line")] });
    const original = planWithClocks();
    const { plan, scale } = fitPlanToNarration(original, fits);
    expect(scale).toBe(1);
    expect(plan).toBe(original);
  });
});
