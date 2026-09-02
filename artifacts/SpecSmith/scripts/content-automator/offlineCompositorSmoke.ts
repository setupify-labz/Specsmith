// Real, non-placeholder MP4 render that needs no paid credentials.
//
// This is compositorSmoke.ts's exact scene — the real SpecSmith Compare page
// (RTX 4080 Super vs RTX 4080, same CPU) captured live through a real
// browser, cut against real timed captions and a real ffmpeg composite — with
// one substitution: narration comes from the local offline espeak-ng fixture
// (see localFixtureTts.ts) instead of paid ElevenLabs TTS, because no
// ElevenLabs credential is available in this environment and issue #82's
// excluded scope forbids spending a paid API call without explicit approval.
//
// Every other stage is identical to compositorSmoke.ts and uses the exact
// same production RenderAdapters: the deterministic Playwright UI capture,
// the real .ass caption renderer, and the real ffmpeg motion compositor. The
// output is a genuine H.264/AAC 1080x1920 MP4, not a dry-run placeholder —
// only the narration's origin differs, and that is labeled loudly in the
// audio artifact's own metadata (isFixture: true, isPaidProvider: false).

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCaptionRenderAdapter } from "./captionRender.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import { createMotionCompositorAdapter } from "./motionCompositor.ts";
import { RenderAdapterRegistry, renderPlatformPlan, type PlatformRenderResult } from "./rendering.ts";
import type { PlatformProductionPlan, ProductionPlanPackage, ProductionTask } from "./types.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, "..", "..", "render-output", "mp4-smoke-offline");
const baseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";

export const OFFLINE_SMOKE_PACKAGE_ID = "mp4-smoke-offline";
export const OFFLINE_SMOKE_IDEA_ID = "compare-rtx4080s-rtx4080";
export const OFFLINE_SMOKE_PLATFORM = "youtube-shorts" as const;
export const OFFLINE_SMOKE_DURATION_SECONDS = 8;
export const OFFLINE_SMOKE_NARRATION =
  "RTX 4080 Super versus RTX 4080. Same CPU, same settings. SpecSmith shows which one wins.";

function uiTask(taskId: string, captureType: "static" | "sequence"): ProductionTask {
  return {
    taskId,
    capability: "deterministic-ui-render",
    sourceBeat: null,
    purpose: "Render the real SpecSmith RTX 4080 Super vs RTX 4080 comparison.",
    inputRequirements: ["Real SpecSmith Compare UI only."],
    outputRequirements: ["1080x1920 factual SpecSmith UI capture."],
    uiRenderState: {
      state: {
        surface: "compare",
        gpuA: "rtx4080s",
        cpuA: "r9-9950x3d",
        gpuB: "rtx4080",
        cpuB: "r9-9950x3d",
        resolution: "1440p",
        preset: "high",
      },
      captureType,
    },
  };
}

export function buildOfflineSmokePlan(): { pkg: ProductionPlanPackage; plan: PlatformProductionPlan } {
  const visual1 = uiTask(`${OFFLINE_SMOKE_PACKAGE_ID}-visual-1`, "static");
  const visual2 = uiTask(`${OFFLINE_SMOKE_PACKAGE_ID}-visual-2`, "sequence");
  const visual3 = uiTask(`${OFFLINE_SMOKE_PACKAGE_ID}-visual-3`, "static");

  const voice: ProductionTask = {
    taskId: `${OFFLINE_SMOKE_PACKAGE_ID}-voice`,
    capability: "text-to-speech",
    sourceBeat: null,
    purpose: "Generate narration for the offline compositor smoke video.",
    inputRequirements: [OFFLINE_SMOKE_NARRATION],
    outputRequirements: ["Natural narration; preserve hardware names exactly."],
  };

  const captions: ProductionTask = {
    taskId: `${OFFLINE_SMOKE_PACKAGE_ID}-captions`,
    capability: "caption-render",
    sourceBeat: null,
    purpose: "Render deterministic short-form captions.",
    inputRequirements: ["RTX 4080 SUPER VS RTX 4080", "SAME CPU. SAME SETTINGS.", "ESTIMATED FPS. SEE THE FULL RESULT."],
    outputRequirements: ["Keep captions inside short-form safe areas."],
  };
  (captions as ProductionTask & { captionRenderState?: unknown }).captionRenderState = {
    durationSeconds: OFFLINE_SMOKE_DURATION_SECONDS,
    cues: [
      { startSecond: 0, endSecond: 2.5, text: "RTX 4080 SUPER VS RTX 4080" },
      { startSecond: 2.5, endSecond: 5.5, text: "SAME CPU. SAME SETTINGS." },
      // Compare.tsx's on-screen "Avg FPS" numbers are SpecSmith's own
      // estimateFpsForBuild() estimate, not a measured benchmark, and the
      // live page shows no on-screen qualifier saying so. This pipeline's own
      // data-integrity rule (README.md, qualityReviewer.ts) requires
      // estimated FPS to stay explicitly labeled — so the caption carries the
      // label the source page's own UI doesn't.
      { startSecond: 5.5, endSecond: 8, text: "ESTIMATED FPS. SEE THE FULL RESULT." },
    ],
  };

  const compose: ProductionTask = {
    taskId: `${OFFLINE_SMOKE_PACKAGE_ID}-compose`,
    capability: "motion-compositor",
    sourceBeat: null,
    purpose: "Produce one real 1080x1920 H.264/AAC MP4 from real UI, fixture TTS, and timed captions.",
    inputRequirements: [visual1.taskId, visual2.taskId, visual3.taskId, voice.taskId, captions.taskId],
    outputRequirements: ["Real video/mp4 artifact, not a dry-run placeholder."],
  };
  (compose as ProductionTask & { compositorState?: unknown }).compositorState = {
    durationSeconds: OFFLINE_SMOKE_DURATION_SECONDS,
    fps: 30,
    visualTimeline: [
      { visualTaskId: visual1.taskId, startSecond: 0, endSecond: 2.5 },
      { visualTaskId: visual2.taskId, startSecond: 2.5, endSecond: 5.5 },
      { visualTaskId: visual3.taskId, startSecond: 5.5, endSecond: 8 },
    ],
    voiceTaskId: voice.taskId,
    captionTaskId: captions.taskId,
  };

  const tasks = [visual1, visual2, visual3, voice, captions, compose];
  const plan: PlatformProductionPlan = {
    platform: OFFLINE_SMOKE_PLATFORM,
    targetDurationSeconds: OFFLINE_SMOKE_DURATION_SECONDS,
    tasks,
    renderOrder: tasks.map((task) => task.taskId),
    qualityChecks: [
      "Final artifact is a real 1080x1920 MP4.",
      "All product UI is deterministic real SpecSmith UI.",
      "Narration is generated by the local offline TTS fixture (no paid provider).",
      "Captions follow explicit cue timing.",
    ],
  };
  return {
    pkg: {
      packageId: OFFLINE_SMOKE_PACKAGE_ID,
      ideaId: OFFLINE_SMOKE_IDEA_ID,
      campaignId: OFFLINE_SMOKE_PACKAGE_ID,
      platforms: [plan],
    },
    plan,
  };
}

export interface OfflineSmokeRunResult {
  result: PlatformRenderResult;
  outputDir: string;
}

export async function runOfflineCompositorSmoke(): Promise<OfflineSmokeRunResult> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const registry = new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl, outputDir: join(outputDir, "ui") }))
    .register(createLocalFixtureTtsAdapter({ outputDir: join(outputDir, "audio") }))
    .register(createCaptionRenderAdapter({ outputDir: join(outputDir, "captions") }))
    .register(createMotionCompositorAdapter({
      outputDir,
      ffmpegPath: process.env.SPECSMITH_FFMPEG_PATH,
      ffprobePath: process.env.SPECSMITH_FFPROBE_PATH,
    }));

  const { pkg, plan } = buildOfflineSmokePlan();
  console.log(`Rendering real offline MP4 smoke against ${baseUrl} with local espeak-ng narration (no paid provider).`);
  const result = await renderPlatformPlan(pkg, plan, registry, { maxAttemptsPerCapability: 1 });
  if (result.status !== "succeeded" || result.finalArtifacts.length !== 1) {
    for (const task of result.taskResults) {
      if (task.status !== "succeeded") console.error(`${task.taskId}: ${task.status} ${task.error ?? ""}`);
    }
    throw new Error("Offline MP4 smoke render failed.");
  }
  const final = result.finalArtifacts[0];
  if (final.mimeType !== "video/mp4" || final.uri.startsWith("dry-run://")) {
    throw new Error(`Compositor returned ${final.mimeType} at ${final.uri}, not a real MP4.`);
  }
  console.log("Real offline MP4 compositor smoke succeeded.");
  console.log(`Output: ${final.uri}`);
  console.log(`Metadata: ${JSON.stringify(final.metadata)}`);
  return { result, outputDir };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain) {
  runOfflineCompositorSmoke().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
