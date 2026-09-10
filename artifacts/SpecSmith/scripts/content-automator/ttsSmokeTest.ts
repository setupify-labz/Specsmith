import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElevenLabsTtsAdapter, elevenLabsTtsConfigFromEnv } from "./elevenLabsTts.ts";
import { RenderAdapterRegistry, renderPlatformPlan } from "./rendering.ts";
import type { PlatformProductionPlan, ProductionPlanPackage } from "./types.ts";

const config = elevenLabsTtsConfigFromEnv();
if (!config) {
  console.log("ELEVENLABS_API_KEY is not configured; skipping live TTS smoke test.");
  process.exit(0);
}

const outputDir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-smoke-"));
try {
  const taskId = "youtube-shorts-voice";
  const platformPlan: PlatformProductionPlan = {
    platform: "youtube-shorts",
    targetDurationSeconds: 2,
    tasks: [{
      taskId,
      capability: "text-to-speech",
      sourceBeat: null,
      purpose: "Validate the live ElevenLabs renderer adapter.",
      inputRequirements: ["SpecSmith voice online."],
      outputRequirements: ["Return real audio bytes."],
    }],
    renderOrder: [taskId],
    qualityChecks: ["Live TTS returns a non-empty audio artifact."],
  };
  const productionPackage: ProductionPlanPackage = {
    packageId: "tts-smoke-package",
    ideaId: "tts-smoke-idea",
    campaignId: "tts-smoke-campaign",
    platforms: [platformPlan],
  };

  const registry = new RenderAdapterRegistry().register(createElevenLabsTtsAdapter({ config, outputDir }));
  const result = await renderPlatformPlan(productionPackage, platformPlan, registry, { maxAttemptsPerCapability: 1 });
  if (result.status !== "succeeded") {
    throw new Error(`Live ElevenLabs render did not succeed: ${result.taskResults[0]?.error ?? "unknown error"}`);
  }

  const artifact = result.taskResults[0]?.artifacts[0];
  if (!artifact || artifact.kind !== "audio") throw new Error("Live ElevenLabs render produced no audio artifact");
  const bytes = await readFile(fileURLToPath(artifact.uri));
  if (bytes.byteLength < 100) throw new Error(`Live ElevenLabs audio artifact is unexpectedly small (${bytes.byteLength} bytes)`);

  console.log(`Live ElevenLabs TTS succeeded: ${bytes.byteLength} audio bytes.`);
  console.log(`Voice: ${String(artifact.metadata?.voiceId ?? "unknown")}; model: ${String(artifact.metadata?.modelId ?? "unknown")}.`);
  if (artifact.metadata?.characterCost !== undefined) {
    console.log(`Reported character cost: ${String(artifact.metadata.characterCost)}.`);
  }
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
