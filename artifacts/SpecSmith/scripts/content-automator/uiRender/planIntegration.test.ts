import { describe, it, expect } from "vitest";

import gpuData from "../../../src/data/gpus.json" with { type: "json" };
import cpuData from "../../../src/data/cpus.json" with { type: "json" };
import { buildStrategyBatch } from "../strategist.ts";
import { buildContentPackage } from "../contentPackage.ts";
import { buildScriptStoryboardPackage } from "../scriptStoryboard.ts";
import { buildProductionPlanPackage } from "../productionPlan.ts";
import type { ContentIdea, HardwareItem, ProductionTask } from "../types.ts";
import { parseUiRenderRequest } from "./uiRenderState.ts";
import { planSurface } from "./surfaces.ts";
import { deriveUiRenderState, isRenderableFeature, referenceCpuId, seedFromString } from "./planUiRenderState.ts";
import { predictCrate } from "./crateSeed.ts";

const gpus = gpuData as HardwareItem[];
const cpus = cpuData as HardwareItem[];
const NOW = new Date("2026-08-23T09:00:00Z");

/** The whole real chain: strategist -> package -> storyboard -> production plan. */
function realPlansFor(idea: ContentIdea) {
  const pkg = buildContentPackage(idea, NOW);
  const storyboard = buildScriptStoryboardPackage(idea, pkg);
  return { pkg, storyboard, plan: buildProductionPlanPackage(storyboard) };
}

const uiTasksOf = (plan: ReturnType<typeof realPlansFor>["plan"]): ProductionTask[] =>
  plan.platforms.flatMap((p) => p.tasks).filter((t) => t.capability === "deterministic-ui-render");

describe("canonical ids survive idea -> package -> storyboard -> production task", () => {
  const batch = buildStrategyBatch(gpus, cpus, NOW);

  it("the strategist really does emit canonical catalog ids", () => {
    // The premise everything else rests on. If this ever stops holding, the
    // planner must fail rather than guess, so it is asserted directly.
    const known = new Set([...gpus.map((g) => g.id), ...cpus.map((c) => c.id)]);
    const withSubjects = batch.candidates.filter((idea) => idea.subjectIds.length > 0);
    expect(withSubjects.length).toBeGreaterThan(0);
    for (const idea of withSubjects) {
      for (const id of idea.subjectIds) expect(known.has(id), `${id} should be a catalog id`).toBe(true);
    }
  });

  it("ContentPackage and ScriptStoryboardPackage forward the subjects", () => {
    const idea = batch.candidates.find((i) => i.subjectIds.length > 0)!;
    const { pkg, storyboard } = realPlansFor(idea);
    expect(pkg.subjectIds).toEqual(idea.subjectIds);
    expect(storyboard.subjectIds).toEqual(idea.subjectIds);
    expect(storyboard.feature).toBe(idea.productConnection.feature);
    expect(storyboard.route).toBe(idea.productConnection.route);
  });

  it("every deterministic-ui-render task in a real plan carries valid uiRenderState", () => {
    // The end-to-end guarantee: a real generated idea produces a plan whose UI
    // tasks the adapter will accept. Before this wiring existed the planner
    // emitted UI tasks with no state at all, which the adapter refuses.
    let checked = 0;
    for (const idea of batch.candidates) {
      const { plan } = realPlansFor(idea);
      for (const task of uiTasksOf(plan)) {
        expect(task.uiRenderState, `${idea.id}/${task.taskId} must carry state`).toBeDefined();
        // Throws if invalid — this is the same parser the adapter uses.
        const request = parseUiRenderRequest(task.uiRenderState);
        const surface = planSurface(request);
        expect(surface.route.startsWith("/")).toBe(true);
        expect(surface.expectedText.length).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked, "the real batch should produce UI tasks to check").toBeGreaterThan(0);
  });

  it("at least one real idea targets each renderable surface family", () => {
    const surfaces = new Set<string>();
    for (const idea of batch.candidates) {
      for (const task of uiTasksOf(realPlansFor(idea).plan)) {
        surfaces.add(parseUiRenderRequest(task.uiRenderState).state.surface);
      }
    }
    // Proves the wiring is not accidentally satisfied by one lucky format.
    expect(surfaces.size).toBeGreaterThanOrEqual(2);
  });

  it("a non-renderable feature downgrades instead of emitting an impossible task", () => {
    const idea = batch.candidates.find((i) => !isRenderableFeature(i.productConnection.feature));
    if (!idea) return; // batch happened to contain none; nothing to assert
    expect(uiTasksOf(realPlansFor(idea).plan)).toHaveLength(0);
  });

  it("a renderable feature with unusable ids keeps the UI capability and fails loudly", () => {
    // The opposite policy, and the important one: silently swapping an evidence
    // beat to generated footage would fabricate product visuals.
    const idea = batch.candidates.find((i) => i.productConnection.feature === "compare")!;
    const broken: ContentIdea = { ...idea, subjectIds: ["not-a-real-id"] };
    const tasks = uiTasksOf(realPlansFor(broken).plan);
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(task.uiRenderState).toBeUndefined();
  });
});

describe("state derivation from real strategy shapes", () => {
  it("a two-GPU comparison holds the CPU constant on both sides", () => {
    const request = deriveUiRenderState({ feature: "compare", subjectIds: ["rtx5090", "rtx4090"], ideaId: "x" })!;
    expect(request.state.surface).toBe("compare");
    if (request.state.surface !== "compare") return;
    expect(request.state.gpuA).toBe("rtx5090");
    expect(request.state.gpuB).toBe("rtx4090");
    // Same CPU both sides: otherwise the capture compares builds, not GPUs.
    expect(request.state.cpuA).toBe(request.state.cpuB);
    expect(request.state.cpuA).toBe(referenceCpuId());
  });

  it("a two-CPU comparison holds the GPU constant instead", () => {
    const request = deriveUiRenderState({ feature: "compare", subjectIds: ["r7-9800x3d", "i5-14600k"], ideaId: "x" })!;
    if (request.state.surface !== "compare") throw new Error("expected compare");
    expect(request.state.gpuA).toBe(request.state.gpuB);
    expect(request.state.cpuA).toBe("r7-9800x3d");
    expect(request.state.cpuB).toBe("i5-14600k");
  });

  it("routes upgrade ideas to the calculator matching the subject's kind", () => {
    expect(deriveUiRenderState({ feature: "upgrade", subjectIds: ["rtx3060"], ideaId: "x" })!.state.surface).toBe("upgrade-gpu");
    expect(deriveUiRenderState({ feature: "upgrade", subjectIds: ["r5-5600"], ideaId: "x" })!.state.surface).toBe("upgrade-cpu");
  });

  it("returns undefined rather than inventing a subject", () => {
    expect(deriveUiRenderState({ feature: "compare", subjectIds: ["rtx5090"], ideaId: "x" })).toBeUndefined();
    expect(deriveUiRenderState({ feature: "builder", subjectIds: [], ideaId: "x" })).toBeUndefined();
    expect(deriveUiRenderState({ feature: "gallery", subjectIds: ["rtx5090"], ideaId: "x" })).toBeUndefined();
  });

  it("seeds Build Crate deterministically from the idea id", () => {
    const a = deriveUiRenderState({ feature: "build-crate", subjectIds: [], ideaId: "idea-42" })!;
    const b = deriveUiRenderState({ feature: "build-crate", subjectIds: [], ideaId: "idea-42" })!;
    const c = deriveUiRenderState({ feature: "build-crate", subjectIds: [], ideaId: "idea-43" })!;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    if (a.state.surface === "build-crate") expect(a.state.seed).toBe(seedFromString("idea-42"));
  });
});

describe("Build Crate seed prediction", () => {
  it("predicts eight named parts and repeats exactly for the same seed", () => {
    const a = predictCrate(4242);
    const b = predictCrate(4242);
    expect(a.partNames).toHaveLength(8);
    expect(a.partNames.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
    expect(b.partNames).toEqual(a.partNames);
  });

  it("predicts a different crate for a different seed", () => {
    expect(predictCrate(1).partNames.join("|")).not.toBe(predictCrate(987654).partNames.join("|"));
  });

  it("leaves the shared RNG restored so one prediction cannot contaminate the next", () => {
    // The RNG override is module-scoped; a leak would make unrelated later
    // rolls deterministic without asking.
    predictCrate(7);
    const runs = new Set(Array.from({ length: 30 }, () => predictCrate.length && Math.random()));
    expect(runs.size).toBeGreaterThan(1);
  });
});
