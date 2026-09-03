import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import {
  createFullDryRunRegistry,
  RenderAdapterRegistry,
  renderPlatformPlan,
  renderProductionPackage,
  type RenderAdapter,
} from "./rendering.ts";
import type { ContentIdea } from "./types.ts";

const idea: ContentIdea = {
  id: "render-test",
  format: "game",
  title: "Can you beat SpecSmith?",
  hook: "Pick before the reveal.",
  angle: "Use a real SpecSmith decision as the game.",
  targetAudience: "PC buyers",
  requiredFacts: ["verified price", "verified spec"],
  subjectIds: ["g1"],
  productConnection: {
    feature: "compare",
    route: "/compare",
    userProblem: "Buyers need to choose between two real hardware options.",
    whySpecSmith: "SpecSmith keeps the comparison grounded in the actual product workflow.",
    continuationAction: "Open Compare and continue the exact decision with your own parts.",
    sitePayoff: "The viewer can inspect the complete tradeoff after the reveal.",
  },
  creativeDNA: {
    conceptName: "Blind Pick",
    visualWorld: "Compare Blindfold — choose before names are revealed",
    narrativeEngine: "choice -> evidence -> reversal -> payoff",
    openingImage: "Two real comparison cards appear with names hidden.",
    patternInterrupt: "Reveal the cheaper option after the viewer commits.",
    retentionBeats: ["hook", "choice", "evidence", "reversal", "payoff"],
    payoff: "Reveal the actual SpecSmith comparison result.",
    audioDirection: "Sparse tension and one reveal hit.",
    originalityConstraint: "The comparison workflow must drive the story.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 9,
    visualPotential: 9,
    purchaseIntent: 8,
    novelty: 8,
    originality: 9,
    retentionPotential: 9,
    shareability: 8,
    productFit: 10,
    siteContinuation: 10,
    total: 9.1,
  },
};

function production() {
  const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
  const scripts = buildScriptStoryboardPackage(idea, content);
  return buildProductionPlanPackage(scripts);
}

describe("rendering orchestrator", () => {
  it("executes a full three-platform production package in render order", async () => {
    const plan = production();
    const results = await renderProductionPackage(plan, createFullDryRunRegistry(), { maxAttemptsPerCapability: 1 });
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === "succeeded")).toBe(true);
    for (const result of results) {
      const platformPlan = plan.platforms.find((entry) => entry.platform === result.platform)!;
      expect(result.taskResults.map((entry) => entry.taskId)).toEqual(platformPlan.renderOrder);
      expect(result.finalArtifacts.length).toBeGreaterThan(0);
      expect(result.finalArtifacts.every((artifact) => artifact.kind === "video")).toBe(true);
    }
  });

  it("passes completed task artifacts into the compositor", async () => {
    const plan = production();
    const platformPlan = plan.platforms[0];
    let compositorDependencyCount = -1;
    const registry = createFullDryRunRegistry();
    const compositor: RenderAdapter = {
      name: "inspect-compositor",
      capability: "motion-compositor",
      async render(context) {
        compositorDependencyCount = context.dependencyArtifacts.length;
        return [{ artifactId: "final", taskId: context.task.taskId, kind: "video", uri: "memory://final", mimeType: "video/mp4" }];
      },
    };
    const custom = new RenderAdapterRegistry();
    for (const capability of ["deterministic-ui-render", "video-generation", "image-generation", "text-to-speech", "music-sfx", "caption-render"] as const) {
      for (const adapter of registry.get(capability)) custom.register(adapter);
    }
    custom.register(compositor);

    const result = await renderPlatformPlan(plan, platformPlan, custom, { maxAttemptsPerCapability: 1 });
    expect(result.status).toBe("succeeded");
    expect(compositorDependencyCount).toBe(platformPlan.tasks.length - 1);
  });

  it("falls back from failed video generation to image generation", async () => {
    const plan = production();
    const platformPlan = plan.platforms[0];
    const registry = createFullDryRunRegistry();
    const custom = new RenderAdapterRegistry();
    const alwaysFail: RenderAdapter = {
      name: "broken-video-provider",
      capability: "video-generation",
      async render() { throw new Error("provider unavailable"); },
    };
    custom.register(alwaysFail);
    for (const capability of ["deterministic-ui-render", "image-generation", "text-to-speech", "music-sfx", "motion-compositor", "caption-render"] as const) {
      for (const adapter of registry.get(capability)) custom.register(adapter);
    }

    const result = await renderPlatformPlan(plan, platformPlan, custom, { maxAttemptsPerCapability: 1 });
    expect(result.status).toBe("succeeded");
    const visualWithFallback = result.taskResults.find((entry) => entry.attempts.some((attempt) => attempt.capability === "video-generation"));
    expect(visualWithFallback?.attempts.some((attempt) => attempt.capability === "image-generation" && attempt.ok)).toBe(true);
  });

  it("fails closed when a required non-fallback renderer is missing", async () => {
    const plan = production();
    const platformPlan = plan.platforms[0];
    const registry = new RenderAdapterRegistry();
    for (const capability of ["video-generation", "image-generation", "text-to-speech", "music-sfx", "motion-compositor", "caption-render"] as const) {
      registry.register({
        name: `test-${capability}`,
        capability,
        async render(context) {
          return [{ artifactId: context.task.taskId, taskId: context.task.taskId, kind: capability === "motion-compositor" ? "video" : "json", uri: "memory://artifact", mimeType: "application/octet-stream" }];
        },
      });
    }

    const result = await renderPlatformPlan(plan, platformPlan, registry, { maxAttemptsPerCapability: 1 });
    expect(result.status).toBe("failed");
    expect(result.taskResults.some((entry) => entry.status === "failed" && entry.error?.includes("deterministic-ui-render"))).toBe(true);
    expect(result.taskResults.at(-1)?.status).toBe("skipped");
  });
});
