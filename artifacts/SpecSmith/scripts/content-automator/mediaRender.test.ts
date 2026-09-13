import { describe, expect, it } from "vitest";
import { buildAssDocument, parseCaptionRenderState, wrapCaption } from "./captionRender.ts";
import { parseMotionCompositorState } from "./motionCompositor.ts";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { COMPARE_RTX4080S_RTX4080_IDEA } from "./fixtures/compareRtx4080sRtx4080Idea.ts";
import type { ProductionTask } from "./types.ts";

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

describe("caption wrapping", () => {
  it("never produces more than two lines, and no line exceeds maxChars", () => {
    // Regression test for a defect found by actually exercising the real
    // generated plan for issue #89: the hook beat's onScreenText is the
    // idea's full title (COMPARE_RTX4080S_RTX4080_IDEA.title, 78 chars) —
    // longer than any caption previously rendered through this pipeline —
    // and the old wrapCaption collapsed overflow into one unwrapped line
    // that rendered wider than the 1080px safe area (confirmed by direct
    // frame inspection: it ran off both screen edges).
    const wrapped = wrapCaption(COMPARE_RTX4080S_RTX4080_IDEA.title, 28);
    const lines = wrapped.split("\\N");
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28);
  });

  it("keeps the first wrapped line intact and truncates overflow with an ellipsis", () => {
    const wrapped = wrapCaption("Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080", 28);
    const [first, second] = wrapped.split("\\N");
    expect(first).toBe("Pick the GPU before");
    expect(second.length).toBeLessThanOrEqual(28);
    expect(second.endsWith("…")).toBe(true);
  });

  it("still wraps normally when everything fits in two lines", () => {
    expect(wrapCaption("RTX 4080 SUPER VS RTX 4080", 28)).toBe("RTX 4080 SUPER VS RTX 4080");
    expect(wrapCaption("ESTIMATED FPS. SEE THE FULL RESULT.", 28)).toBe("ESTIMATED FPS. SEE THE FULL\\NRESULT.");
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

const idea = COMPARE_RTX4080S_RTX4080_IDEA;

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
