import { describe, expect, it } from "vitest";
import { buildAssDocument, parseCaptionRenderState } from "./captionRender.ts";
import { parseMotionCompositorState } from "./motionCompositor.ts";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import type { ContentIdea, ProductionTask } from "./types.ts";

const captionState = {
  durationSeconds: 6,
  cues: [
    { startSecond: 0, endSecond: 2, text: "RTX 4080 SUPER VS RTX 4080" },
    { startSecond: 2, endSecond: 4, text: "SAME CPU SAME SETTINGS" },
    { startSecond: 4, endSecond: 6, text: "WHICH ONE WINS" },
  ],
};

const compositorState = {
  durationSeconds: 6,
  fps: 30,
  visualTimeline: [
    { visualTaskId: "v1", startSecond: 0, endSecond: 2 },
    { visualTaskId: "v2", startSecond: 2, endSecond: 4 },
    { visualTaskId: "v3", startSecond: 4, endSecond: 6 },
  ],
  voiceTaskId: "voice",
  captionTaskId: "captions",
};

describe("caption render state", () => {
  it("preserves explicit storyboard timing", () => {
    const parsed = parseCaptionRenderState(captionState);
    expect(parsed.cues).toEqual(captionState.cues);
    expect(parsed.durationSeconds).toBe(6);
  });

  it("refuses invalid and overlapping cue timing", () => {
    expect(() => parseCaptionRenderState({ ...captionState, cues: [{ startSecond: 2, endSecond: 1, text: "bad" }] }))
      .toThrow(/invalid timing/i);
    expect(() => parseCaptionRenderState({
      ...captionState,
      cues: [
        { startSecond: 0, endSecond: 3, text: "one" },
        { startSecond: 2, endSecond: 4, text: "two" },
      ],
    })).toThrow(/overlap/i);
  });

  it("builds a 1080x1920 ASS document with timed events", () => {
    const ass = buildAssDocument(parseCaptionRenderState(captionState));
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00");
    expect(ass).toContain("RTX 4080 SUPER VS RTX 4080");
  });
});

describe("motion compositor state", () => {
  it("accepts one explicit contiguous visual timeline", () => {
    expect(parseMotionCompositorState(compositorState)).toEqual(compositorState);
  });

  it("refuses gaps, overlaps, missing voice, and a timeline that does not cover the master", () => {
    expect(() => parseMotionCompositorState({
      ...compositorState,
      visualTimeline: [
        { visualTaskId: "v1", startSecond: 0, endSecond: 2 },
        { visualTaskId: "v2", startSecond: 3, endSecond: 6 },
      ],
    })).toThrow(/contiguous/i);
    expect(() => parseMotionCompositorState({ ...compositorState, voiceTaskId: "" })).toThrow(/voiceTaskId/i);
    expect(() => parseMotionCompositorState({
      ...compositorState,
      visualTimeline: [{ visualTaskId: "v1", startSecond: 0, endSecond: 5 }],
    })).toThrow(/end at durationSeconds/i);
  });
});

const idea: ContentIdea = {
  id: "compare-rtx4080s-rtx4080",
  format: "comparison",
  title: "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080",
  hook: "Can you pick the faster card before the names show?",
  angle: "Use Compare as the evidence and reveal.",
  targetAudience: "PC builders",
  requiredFacts: ["comparison state"],
  subjectIds: ["rtx4080s", "rtx4080"],
  productConnection: {
    feature: "compare",
    route: "/compare",
    userProblem: "Buyers cannot tell which near-name GPU is the better choice.",
    whySpecSmith: "SpecSmith Compare holds the rest of the build constant.",
    continuationAction: "Open Compare and change the cards.",
    sitePayoff: "The viewer can continue the exact comparison.",
  },
  creativeDNA: {
    conceptName: "Blind Compare",
    visualWorld: "real SpecSmith comparison",
    narrativeEngine: "blind choice -> evidence -> reveal",
    openingImage: "Two anonymous cards",
    patternInterrupt: "Names hidden",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Reveal the winner",
    audioDirection: "Tight",
    originalityConstraint: "Compare is essential",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9, usefulness: 9, visualPotential: 9, purchaseIntent: 8, novelty: 8,
    originality: 9, retentionPotential: 9, shareability: 8, productFit: 10, siteContinuation: 10, total: 9,
  },
};

describe("planner media timing integration", () => {
  it("carries caption cues and the storyboard visual timeline into structured task state", () => {
    const content = buildContentPackage(idea, new Date("2026-08-23T02:00:00Z"));
    const storyboard = buildScriptStoryboardPackage(idea, content);
    const production = buildProductionPlanPackage(storyboard);

    for (const platform of production.platforms) {
      const captions = platform.tasks.find((task) => task.capability === "caption-render") as ProductionTask & { captionRenderState?: unknown };
      const compose = platform.tasks.find((task) => task.capability === "motion-compositor") as ProductionTask & { compositorState?: unknown };
      expect(captions.captionRenderState).toBeTruthy();
      expect(compose.compositorState).toBeTruthy();

      const parsedCaptions = parseCaptionRenderState(captions.captionRenderState);
      const parsedCompose = parseMotionCompositorState(compose.compositorState);
      expect(parsedCaptions.durationSeconds).toBe(platform.targetDurationSeconds);
      expect(parsedCompose.durationSeconds).toBe(platform.targetDurationSeconds);
      expect(parsedCompose.visualTimeline).toHaveLength(storyboard.scripts.find((script) => script.platform === platform.platform)!.beats.length);
      expect(parsedCompose.captionTaskId).toBe(captions.taskId);
      expect(parsedCompose.voiceTaskId).toBe(`${platform.platform}-voice`);
      expect(parsedCompose.musicTaskId).toBe(`${platform.platform}-audio`);
    }
  });
});
