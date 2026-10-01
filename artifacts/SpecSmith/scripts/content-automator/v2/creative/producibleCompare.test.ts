// The production plan for a #6 Compare concept that passes #6 and #1: one
// validated view per beat, disclosures in their own persistent panel, captions
// in their band, and nothing the path cannot honestly provide.

import { describe, expect, it } from "vitest";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { DISCLOSURE_BANDED_LAYOUT, storyViewport } from "../../bandedLayout.ts";
import { buildAssDocument, parseCaptionRenderState } from "../../captionRender.ts";
import { planSurface } from "../../uiRender/surfaces.ts";
import { parseUiRenderRequest } from "../../uiRender/uiRenderState.ts";
import { CaptureViewError, missionCaptureViews } from "./captureViews.ts";
import { CREATIVE_DISCLOSURES } from "./concept.ts";
import { evaluateAuthoredBatch } from "./fileWorkflowPass.ts";
import { buildCreativeProposalProductionPlan } from "./proposalPass.ts";
import type { ProductionTask } from "../../types.ts";

const BASE = { packageId: "p", ideaId: "i", campaignId: "c", feature: "compare" as const, route: "/compare", subjectIds: [] };
async function revised() {
  const evaluation = await evaluateAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, DEMO_MISSION);
  return { evaluation, proposal: evaluation.pass.result.proposals.find((entry) => entry.concept.conceptId === "claude-batch-three-checks")! };
}
type Task = ProductionTask & Record<string, unknown>;

describe("validated views", () => {
  it("are the mission's own pair at other settings, primary first", () => {
    const views = missionCaptureViews(DEMO_MISSION.renderRequest, DEMO_MISSION.additionalViews);
    expect(views.map((view) => [view.resolution, view.preset, view.primary])).toEqual([
      ["1440p", "high", true], ["1080p", "high", false], ["4k", "ultra", false], ["1080p", "low", false],
    ]);
    for (const view of views) expect(view.request.state).toMatchObject({ gpuA: "rtx5060ti", cpuA: "i3-13100f", gpuB: "rtx4060ti", cpuB: "r5-9600x" });
  });

  it("refuse a repeat of the primary view or a duplicate", () => {
    expect(() => missionCaptureViews(DEMO_MISSION.renderRequest, [{ resolution: "1440p", preset: "high" }])).toThrow(CaptureViewError);
    expect(() => missionCaptureViews(DEMO_MISSION.renderRequest, [{ resolution: "4k", preset: "low" }, { resolution: "4k", preset: "low" }])).toThrow(/twice/);
  });
});

describe("the #6 production plan for the revised concept", () => {
  it("renders each beat's own view, framed on the active settings, at the story band's size", async () => {
    const { proposal } = await revised();
    const plan = buildCreativeProposalProductionPlan(BASE, proposal).platforms[0];
    const visuals = plan.tasks.filter((task) => task.sourceBeat !== null) as Task[];
    expect(visuals.map((task) => task.capability)).toEqual(Array(5).fill("deterministic-ui-render"));
    expect(visuals.map((task) => {
      const state = (task.uiRenderState as { state: { resolution: string; preset: string } }).state;
      return `${state.resolution}/${state.preset}`;
    })).toEqual(["1440p/high", "1080p/high", "1440p/high", "4k/ultra", "1080p/low"]);
    for (const task of visuals) {
      const request = parseUiRenderRequest(task.uiRenderState);
      expect(request.viewport).toEqual(storyViewport());
      expect(request.framing).toBe("settings");
      // Each capture must find the model's own averages for its setting on screen.
      expect(planSurface(request).expectedText.some((text) => text.startsWith("Est. Avg FPS: "))).toBe(true);
    }
  });

  it("carries the disclosures verbatim in a persistent panel, and captions only the author's text", async () => {
    const { proposal } = await revised();
    const plan = buildCreativeProposalProductionPlan(BASE, proposal).platforms[0];
    const overlay = plan.tasks.find((task) => task.capability === "disclosure-overlay") as Task;
    expect(overlay.disclosureOverlayState).toEqual({
      // Compare shows no range, so "The range shown..." is not among them.
      lines: [CREATIVE_DISCLOSURES["disclosure.fps-estimate"]],
      width: DISCLOSURE_BANDED_LAYOUT.width, height: DISCLOSURE_BANDED_LAYOUT.disclosure.height,
    });
    const captions = plan.tasks.find((task) => task.capability === "caption-render") as Task;
    const state = parseCaptionRenderState(captions.captionRenderState);
    expect(state.placement).toBe("caption-band");
    expect(state.cues.map((cue) => cue.text)).toEqual(["Three checks", "1. Your resolution", "2. Is the gap real?", "3. Your settings", "Run it at /compare"]);
    expect(buildAssDocument(state)).toMatch(/,90,90,70,1\n/);
    const compose = plan.tasks.find((task) => task.capability === "motion-compositor") as Task;
    expect(compose.compositorState).toMatchObject({ layout: DISCLOSURE_BANDED_LAYOUT, disclosureTaskId: overlay.taskId });
    expect(compose.inputRequirements).toContain(overlay.taskId);
    expect(plan.renderOrder.indexOf(overlay.taskId)).toBeLessThan(plan.renderOrder.indexOf(compose.taskId));
  });

  it("has no music task, and says why, rather than a silent placeholder", async () => {
    const { proposal } = await revised();
    const plan = buildCreativeProposalProductionPlan(BASE, proposal).platforms[0];
    expect(plan.tasks.some((task) => task.capability === "music-sfx")).toBe(false);
    expect((plan.tasks.find((task) => task.capability === "motion-compositor") as Task).compositorState).not.toHaveProperty("musicTaskId");
    expect(plan.qualityChecks.join(" ")).toMatch(/No music track/);
  });

  it("refuses a proposal that did not pass", async () => {
    const { proposal } = await revised();
    expect(() => buildCreativeProposalProductionPlan(BASE, { ...proposal, contractEligible: false })).toThrow(/blocked proposal/);
  });
});

describe("readiness stays at the batch", () => {
  it("the batch is unready while two concepts have blockers, and the direct generation status agrees", async () => {
    const { evaluation } = await revised();
    expect(evaluation.packet.humanReviewReady).toBe(false);
    expect(evaluation.packet.approved).toBe(false);
    expect(evaluation.pass.status).toBe("blocked-revision");
    expect(evaluation.pass.status).not.toBe("awaiting-human-review");
  });
});

describe("'The range shown' only where a range is shown", () => {
  it("refuses the sentence on a Compare-only beat, and accepts it where an FPS range is drawn", async () => {
    const { assessConcept } = await import("./concept.ts");
    const { importAuthoredBatch } = await import("./fileWorkflow.ts");
    const stale = importAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, 5).concepts[1];
    const env = { availableCapabilityIds: ["render.compare-surface-capture"], guaranteedDisclosureIds: Object.keys(CREATIVE_DISCLOSURES) };
    const staleCodes = assessConcept({ ...env, concept: stale }).defects.map((defect) => defect.code);
    expect(staleCodes).toContain("disclosure-describes-absent-range");
    const corrected = importAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, 6).concepts[1];
    expect(assessConcept({ ...env, concept: corrected }).defects).toEqual([]);
    // Where an FPS illustration draws the range, the sentence is true and required.
    const { PACKAGE_BRANCH } = await import("./sectionOnePackages.ts");
    expect(assessConcept({ ...env, availableCapabilityIds: PACKAGE_BRANCH.requiredCapabilities.map((capability) => capability.capabilityId), concept: PACKAGE_BRANCH })
      .defects.map((defect) => defect.code)).not.toContain("disclosure-describes-absent-range");
  });
});
