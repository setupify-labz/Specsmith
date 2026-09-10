// Integration smoke: renders representative SpecSmith surfaces for real.
//
//   pnpm content:render:ui-smoke
//
// Requires a running SpecSmith instance. Point at one with SPECSMITH_RENDER_BASE_URL
// (default http://localhost:5178). Build and serve it first, e.g.
//   pnpm build && npx serve dist/public -l 5178
//
// Runs the captures THROUGH the real orchestrator (renderPlatformPlan) rather
// than calling the adapter directly, so the smoke proves adapter registration
// and the orchestrator contract, not just the browser code.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RenderAdapterRegistry, renderPlatformPlan, createDryRunAdapter } from "../rendering.ts";
import type { HardwareItem, PlatformProductionPlan, ProductionPlanPackage, ProductionTask } from "../types.ts";
import { createDeterministicUiRenderAdapter } from "./deterministicUiRenderAdapter.ts";
import gpuData from "../../../src/data/gpus.json" with { type: "json" };
import cpuData from "../../../src/data/cpus.json" with { type: "json" };
import { buildStrategyBatch } from "../strategist.ts";
import { buildContentPackage } from "../contentPackage.ts";
import { buildScriptStoryboardPackage } from "../scriptStoryboard.ts";
import { buildProductionPlanPackage } from "../productionPlan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "..", "..", "..", "render-output", "ui-smoke");
const baseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";

interface SmokeCase {
  id: string;
  description: string;
  state: unknown;
  captureType: "static" | "sequence";
}

const CASES: SmokeCase[] = [
  {
    id: "compare-5090-vs-4090",
    description: "GPU comparison: RTX 5090 + 9800X3D vs RTX 4090 + 7800X3D",
    state: { surface: "compare", gpuA: "rtx5090", cpuA: "r7-9800x3d", gpuB: "rtx4090", cpuB: "r7-7800x3d", resolution: "1440p", preset: "ultra" },
    captureType: "static",
  },
  {
    id: "builder-mid-range",
    description: "Builder loaded with a real mid-range pair",
    state: { surface: "builder", gpu: "rtx4070", cpu: "r5-7600x" },
    captureType: "static",
  },
  {
    id: "upgrade-gpu-3060",
    description: "GPU Upgrade Calculator from an RTX 3060",
    state: { surface: "upgrade-gpu", from: "rtx3060" },
    captureType: "static",
  },
  {
    id: "upgrade-cpu-5600",
    description: "CPU Upgrade Calculator from a Ryzen 5 5600",
    state: { surface: "upgrade-cpu", from: "r5-5600" },
    captureType: "static",
  },
  {
    id: "builder-full-build",
    description: "Builder with every slot filled from the real component catalogs",
    state: {
      surface: "builder",
      gpu: "rtx5070ti", cpu: "r7-9800x3d", motherboard: "z890hero",
      ram: "cv16ddr4", storage: "s870evo", psu: "crm750", case: "fdpopair", cooler: "cmh212",
    },
    captureType: "static",
  },
  {
    id: "build-crate-seeded",
    description: "Build Crate driven through its real reveal with a fixed seed",
    state: { surface: "build-crate", seed: 20260823 },
    captureType: "sequence",
  },
  {
    id: "compare-sequence",
    description: "Compare sequence: resolution and quality actually change between frames",
    state: { surface: "compare", gpuA: "rx9070xt", cpuA: "r7-9700x", gpuB: "rtx5070ti", cpuB: "i5-14600k", resolution: "1440p", preset: "high" },
    captureType: "sequence",
  },
];

function planFor(cases: SmokeCase[]): { pkg: ProductionPlanPackage; plan: PlatformProductionPlan } {
  const tasks: ProductionTask[] = cases.map((c) => ({
    taskId: c.id,
    capability: "deterministic-ui-render",
    sourceBeat: null,
    purpose: c.description,
    inputRequirements: [c.description],
    outputRequirements: ["Vertical 9:16 capture of real SpecSmith UI."],
    uiRenderState: { state: c.state, captureType: c.captureType },
  }));
  // A compose task keeps the plan shaped like a real one; it runs on the
  // dry-run compositor because building video is a later step.
  tasks.push({
    taskId: "ui-smoke-compose",
    capability: "motion-compositor",
    sourceBeat: null,
    purpose: "Placeholder compose step so the plan matches production shape.",
    inputRequirements: cases.map((c) => c.id),
    outputRequirements: ["Not a real composite in V1."],
  });
  const plan: PlatformProductionPlan = {
    platform: "youtube-shorts",
    targetDurationSeconds: 30,
    tasks,
    renderOrder: tasks.map((t) => t.taskId),
    qualityChecks: ["Captures show real SpecSmith UI in the requested state."],
  };
  return {
    pkg: { packageId: "ui-smoke", ideaId: "ui-smoke-idea", campaignId: "ui-smoke-campaign", platforms: [plan] },
    plan,
  };
}

/**
 * Renders a UI task from a REAL generated Daily Five plan.
 *
 * The curated cases above prove the renderer works on hand-picked states. This
 * proves the thing that actually matters in production: an idea the strategist
 * invented, carried through the real package/storyboard/plan chain, produces a
 * task the adapter can execute without anyone hand-writing its state.
 */
async function renderRealDailyFiveTask(registry: RenderAdapterRegistry): Promise<boolean> {
  const now = new Date();
  const batch = buildStrategyBatch(gpuData as HardwareItem[], cpuData as HardwareItem[], now);

  for (const idea of batch.topFour.concat(batch.candidates)) {
    const contentPackage = buildContentPackage(idea, now);
    const storyboard = buildScriptStoryboardPackage(idea, contentPackage);
    const production = buildProductionPlanPackage(storyboard);

    for (const platformPlan of production.platforms) {
      const uiTask = platformPlan.tasks.find(
        (task) => task.capability === "deterministic-ui-render" && task.uiRenderState !== undefined,
      );
      if (!uiTask) continue;

      // Execute exactly this one task through the real orchestrator.
      const singleTaskPlan: PlatformProductionPlan = {
        ...platformPlan,
        tasks: [uiTask],
        renderOrder: [uiTask.taskId],
      };
      console.log(`\nReal Daily Five task: idea "${idea.id}" (${idea.productConnection.feature}) -> ${uiTask.taskId}`);
      const result = await renderPlatformPlan(production, singleTaskPlan, registry, { maxAttemptsPerCapability: 1 });
      const taskResult = result.taskResults[0];
      if (taskResult.status !== "succeeded") {
        console.log(`FAIL  real-daily-five\n      ${taskResult.error}`);
        return false;
      }
      for (const artifact of taskResult.artifacts) {
        const m = artifact.metadata ?? {};
        console.log(`ok    real-daily-five (${idea.format})`);
        console.log(`      ${m.feature} ${m.route}`);
        console.log(`      subjects=${m.subjectIds} ${m.pixelWidth}x${m.pixelHeight} bytes=${m.byteSize}`);
        console.log(`      ${artifact.uri}`);
      }
      return true;
    }
  }
  console.log("FAIL  real-daily-five\n      no generated idea produced a deterministic-ui-render task with state");
  return false;
}

async function main(): Promise<void> {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const registry = new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl, outputDir }))
    .register(createDryRunAdapter("motion-compositor"));

  const { pkg, plan } = planFor(CASES);
  console.log(`Rendering ${CASES.length} SpecSmith surfaces against ${baseUrl}\n`);

  const result = await renderPlatformPlan(pkg, plan, registry, { maxAttemptsPerCapability: 1 });

  let failures = 0;
  for (const taskResult of result.taskResults) {
    if (taskResult.taskId === "ui-smoke-compose") continue;
    if (taskResult.status !== "succeeded") {
      failures += 1;
      console.log(`FAIL  ${taskResult.taskId}\n      ${taskResult.error}`);
      continue;
    }
    for (const artifact of taskResult.artifacts) {
      const m = artifact.metadata ?? {};
      console.log(`ok    ${taskResult.taskId}`);
      console.log(`      ${m.feature} ${m.route}`);
      console.log(`      subjects=${m.subjectIds} ${m.pixelWidth}x${m.pixelHeight} frames=${m.frameCount} bytes=${m.byteSize}`);
      console.log(`      ${artifact.uri}`);
    }
  }

  const dailyFiveOk = await renderRealDailyFiveTask(registry);
  if (!dailyFiveOk) failures += 1;

  const total = CASES.length + 1;
  console.log(`\n${total - failures}/${total} renders succeeded (${CASES.length} curated + 1 real Daily Five). Output: ${outputDir}`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
