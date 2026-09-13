// Issue #89's acceptance criterion: "A test fails if the rendered beat
// IDs/order differ from the generated plan." This proves the render
// orchestration actually consumes the beat identity/order
// buildProductionPlanPackage() generated — not a hand-authored substitute —
// using fast dry-run/fake adapters for the expensive capabilities
// (deterministic-ui-render needs a browser, motion-compositor needs ffmpeg;
// see rendering.test.ts for the same pattern) plus a small inspection
// compositor that records exactly what beat timeline it was asked to
// render. It also proves every capability the generated plan actually
// requests (including video-generation and music-sfx, which had no offline
// adapter before this change) resolves through a registered adapter.

import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { parseMotionCompositorState } from "./motionCompositor.ts";
import {
  createFullDryRunRegistry,
  RenderAdapterRegistry,
  renderPlatformPlan,
  type RenderAdapter,
} from "./rendering.ts";
import { COMPARE_RTX4080S_RTX4080_IDEA } from "./fixtures/compareRtx4080sRtx4080Idea.ts";
import { parseUiRenderRequest, stateIdentifier } from "./uiRender/uiRenderState.ts";
import { planSurface } from "./uiRender/surfaces.ts";
import { deriveUiRenderState, framingForBeatPurpose } from "./uiRender/planUiRenderState.ts";
import type { VideoPlatform } from "./types.ts";

const PLATFORM: VideoPlatform = "youtube-shorts";

function generatedPlan() {
  const content = buildContentPackage(COMPARE_RTX4080S_RTX4080_IDEA, new Date("2026-09-01T00:00:00Z"));
  const storyboard = buildScriptStoryboardPackage(COMPARE_RTX4080S_RTX4080_IDEA, content);
  const production = buildProductionPlanPackage(storyboard);
  const script = storyboard.scripts.find((entry) => entry.platform === PLATFORM)!;
  const platformPlan = production.platforms.find((entry) => entry.platform === PLATFORM)!;
  return { production, script, platformPlan };
}

describe("rendering the generated production plan (no hand-authored substitute timeline)", () => {
  it("renders exactly six beats, in generated order, through a registered adapter for every requested capability", async () => {
    const { production, script, platformPlan } = generatedPlan();
    expect(script.beats).toHaveLength(6);

    const expectedBeatTaskIds = platformPlan.tasks
      .filter((task) => task.sourceBeat !== null)
      .sort((a, b) => a.sourceBeat! - b.sourceBeat!)
      .map((task) => task.taskId);
    expect(expectedBeatTaskIds).toEqual([
      `${PLATFORM}-beat-1-visual`,
      `${PLATFORM}-beat-2-visual`,
      `${PLATFORM}-beat-3-visual`,
      `${PLATFORM}-beat-4-visual`,
      `${PLATFORM}-beat-5-visual`,
      `${PLATFORM}-beat-6-visual`,
    ]);

    // Only the hook beat (index 0) uses video-generation; the compare
    // feature/idea resolves a UI state, so every other beat uses the real
    // deterministic-ui-render capability — not a generated substitute.
    const hookTask = platformPlan.tasks.find((task) => task.sourceBeat === 0)!;
    expect(hookTask.capability).toBe("video-generation");
    for (const task of platformPlan.tasks.filter((task) => task.sourceBeat !== null && task.sourceBeat !== 0)) {
      expect(task.capability).toBe("deterministic-ui-render");
    }

    let capturedVisualTaskIds: string[] | undefined;
    const inspectionCompositor: RenderAdapter = {
      name: "inspect-compositor",
      capability: "motion-compositor",
      async render(context) {
        const state = parseMotionCompositorState((context.task as { compositorState?: unknown }).compositorState);
        capturedVisualTaskIds = state.visualTimeline.map((beat) => beat.visualTaskId);
        return [{ artifactId: "final", taskId: context.task.taskId, kind: "video", uri: "memory://final", mimeType: "video/mp4" }];
      },
    };

    // Dry-run stands in for every other capability — this test is about
    // beat identity/order fidelity, not about exercising the real offline
    // fixtures (those have their own unit tests).
    const registry = new RenderAdapterRegistry();
    const dryRun = createFullDryRunRegistry();
    for (const capability of ["deterministic-ui-render", "video-generation", "image-generation", "text-to-speech", "music-sfx", "caption-render"] as const) {
      for (const adapter of dryRun.get(capability)) registry.register(adapter);
    }
    registry.register(inspectionCompositor);

    const result = await renderPlatformPlan(production, platformPlan, registry, { maxAttemptsPerCapability: 1 });

    expect(result.status).toBe("succeeded");
    expect(result.taskResults.map((entry) => entry.taskId)).toEqual(platformPlan.renderOrder);
    // The exact assertion the acceptance criterion asks for: the compositor
    // must receive the SAME beat identities, in the SAME order, the
    // generated plan produced — not a hand-authored 3-beat timeline, and
    // not a reordering.
    expect(capturedVisualTaskIds).toEqual(expectedBeatTaskIds);
    // Concretely: this is NOT offlineCompositorSmoke.ts's old hand-authored
    // 3-beat timeline (visual-1/visual-2/visual-3) — proving the point of
    // issue #89 directly, not just that six beats happen to exist somewhere.
    expect(capturedVisualTaskIds).not.toHaveLength(3);
    expect(capturedVisualTaskIds).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// The generated plan must control the SHOT LIST, not just the beat order.
//
// Before this, deriveUiRenderState was called once per plan and every non-hook
// beat reused it, so five beats asking five different questions resolved to
// five requests for one identical screenshot. The state is still derived once
// — same parts, same resolution, same preset, so the numbers on screen stay
// consistent and verified — but the FRAMING now comes from each beat's own
// purpose, which is what makes the storyboard control the render.
// ---------------------------------------------------------------------------
describe("a generated beat controls the region its capture frames", () => {
  const uiTasks = () => {
    const { production } = generatedPlan();
    const plan = production.platforms.find((entry) => entry.platform === PLATFORM)!;
    return plan.tasks.filter((task) => task.capability === "deterministic-ui-render");
  };

  it("gives every UI beat a capture state, and gives no two of them the same one", () => {
    const tasks = uiTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(5);

    const ids = tasks.map((task) => {
      const state = (task as { uiRenderState?: unknown }).uiRenderState;
      expect(state, `${task.taskId} requests a UI render but carries no state`).toBeDefined();
      return stateIdentifier(parseUiRenderRequest(state));
    });

    // The real regression: five identical ids meant one screenshot billed as
    // five distinct beats.
    expect(new Set(ids).size, `beats share a capture state: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("keeps every beat on the same verified state, varying only the framing", () => {
    const requests = uiTasks().map((task) => parseUiRenderRequest((task as { uiRenderState?: unknown }).uiRenderState));
    const states = new Set(requests.map((request) => JSON.stringify(request.state)));
    // One state, several windows onto it. More than one state would mean beats
    // were showing different numbers as if they were the same comparison.
    expect(states.size).toBe(1);
    expect(new Set(requests.map((request) => request.framing)).size).toBe(requests.length);
  });

  it("maps each beat purpose to the region of the page that beat is about", () => {
    expect(framingForBeatPurpose("commitment")).toBe("matchup");
    expect(framingForBeatPurpose("evidence")).toBe("chart");
    expect(framingForBeatPurpose("reversal")).toBe("value");
    expect(framingForBeatPurpose("payoff")).toBe("verdict");
    expect(framingForBeatPurpose("cta")).toBe("cta");
    // An unrecognised purpose keeps the previous behaviour rather than guessing.
    expect(framingForBeatPurpose("something-new")).toBe("default");
  });

  it("frames each region on text the Compare page actually renders", () => {
    const requests = uiTasks().map((request) => parseUiRenderRequest((request as { uiRenderState?: unknown }).uiRenderState));
    const anchors = requests.map((request) => planSurface(request).focusText);
    // Every beat must have an anchor, and no two beats may aim at the same one
    // — an unset or duplicated anchor is how identical crops crept back in.
    expect(anchors.every((anchor) => typeof anchor === "string" && anchor.length > 0)).toBe(true);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("refuses an unrecognised framing rather than silently rendering the default crop", () => {
    expect(() => parseUiRenderRequest({
      state: { surface: "compare", gpuA: "rtx4080s", cpuA: "r9-9950x3d", gpuB: "rtx4080", cpuB: "r9-9950x3d" },
      captureType: "static",
      framing: "close-up-of-the-vibes",
    })).toThrow(/Unknown framing/);
  });

  it("changing a beat's purpose changes that beat's rendered state id", () => {
    const before = deriveUiRenderState({ feature: "compare", subjectIds: ["rtx4080s", "rtx4080"], ideaId: "x", framing: framingForBeatPurpose("evidence") })!;
    const after = deriveUiRenderState({ feature: "compare", subjectIds: ["rtx4080s", "rtx4080"], ideaId: "x", framing: framingForBeatPurpose("payoff") })!;
    expect(stateIdentifier(before)).not.toBe(stateIdentifier(after));
    expect(planSurface(before).focusText).not.toBe(planSurface(after).focusText);
  });
});
