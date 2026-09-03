import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import gpus from "../../src/data/gpus.json" with { type: "json" };
import cpus from "../../src/data/cpus.json" with { type: "json" };
import { buildReviewableAutomationBatch } from "./reviewableAutomator.ts";
import {
  createGeminiVeoVideoAdapter,
  geminiVeoConfigFromEnv,
} from "./geminiVeoVideo.ts";
import type { HardwareItem, ProductionPlanPackage, ProductionTask } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, "..", "..", "render-output", "video-generation-smoke");

function findFirstGeneratedTask(packages: ProductionPlanPackage[]): {
  productionPackage: ProductionPlanPackage;
  task: ProductionTask;
  platformIndex: number;
} {
  for (const productionPackage of packages) {
    for (const [platformIndex, platform] of productionPackage.platforms.entries()) {
      const task = platform.tasks.find((entry) => entry.capability === "video-generation");
      if (task) return { productionPackage, task, platformIndex };
    }
  }
  throw new Error("The generated Daily Five contains no video-generation task to smoke-test.");
}

async function main(): Promise<void> {
  const config = geminiVeoConfigFromEnv();
  if (!config) {
    throw new Error("GEMINI_API_KEY is required for the live Google Veo smoke test.");
  }

  const batch = buildReviewableAutomationBatch(
    gpus as HardwareItem[],
    cpus as HardwareItem[],
    [],
    new Date(),
  );
  const selected = findFirstGeneratedTask(batch.productionPlans);
  const platform = selected.productionPackage.platforms[selected.platformIndex];

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const adapter = createGeminiVeoVideoAdapter({ config, outputDir });

  console.log(`Submitting real Daily Five video task ${selected.task.taskId} via Google Gemini API model ${config.modelId}.`);
  console.log(`Idea: ${selected.productionPackage.ideaId}; platform: ${platform.platform}.`);
  console.log(`Resolution: ${config.resolution}. Provider-native audio will be stripped by the SpecSmith compositor.`);
  const artifacts = await adapter.render({
    packageId: selected.productionPackage.packageId,
    campaignId: selected.productionPackage.campaignId,
    ideaId: selected.productionPackage.ideaId,
    platform: platform.platform,
    targetDurationSeconds: platform.targetDurationSeconds,
    task: selected.task,
    dependencyArtifacts: [],
  });

  if (artifacts.length !== 1 || artifacts[0].mimeType !== "video/mp4" || !artifacts[0].uri.startsWith("file:")) {
    throw new Error("Gemini Veo smoke did not produce exactly one real local video/mp4 artifact.");
  }

  console.log("Real Google Veo automated video generation succeeded.");
  console.log(`Output: ${artifacts[0].uri}`);
  console.log(`Metadata: ${JSON.stringify(artifacts[0].metadata)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
