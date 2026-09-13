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
