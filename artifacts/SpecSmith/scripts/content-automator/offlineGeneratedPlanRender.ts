// The real, non-placeholder MP4 render of the ACTUAL generated six-beat
// production plan — no paid credentials, no hand-authored parallel timeline.
//
// Issue #89's gap: buildProductionPlanPackage() already generates a real
// six-beat plan (scriptStoryboard.ts's buildBeats -> productionPlan.ts's
// buildTasks), complete with a contiguous compositorState.visualTimeline and
// captionRenderState built directly from those beats. But that generated
// plan requests "video-generation" for its hook beat and always requests
// "music-sfx" — capabilities the offline path had no adapter for — so
// nothing ever actually rendered it; a separate, hand-authored three-shot
// timeline (offlineCompositorSmoke.ts) was rendered instead and the
// generated plan was used only to build a quality-review CONTRACT.
//
// This module closes that gap by adding the two missing offline adapters
// (localFixtureVideo.ts, localFixtureMusic.ts) and executing the plan
// buildProductionPlanPackage() actually produced — every beat, in the exact
// order and identity the plan generated them, with no substitute timeline:
//
//   deterministic-ui-render -> real Playwright capture of the real
//     SpecSmith Compare page (5 of the 6 beats — every beat except the hook)
//   video-generation -> localFixtureVideo.ts's labeled offline fixture card
//     (the hook beat only — see productionPlan.ts's visualCapability)
//   text-to-speech -> localFixtureTts.ts's local espeak-ng narration
//   music-sfx -> localFixtureMusic.ts's digital silence
//   caption-render -> captionRender.ts's real burned-in .ass captions
//   motion-compositor -> motionCompositor.ts's real ffmpeg compose, which
//     validates the output is a genuine 1080x1920 H.264/AAC MP4
//
// Every stage above is a real render adapter implementing rendering.ts's
// RenderAdapter contract; nothing here is a dry-run placeholder.

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { createCaptionRenderAdapter } from "./captionRender.ts";
import { createLocalFixtureMusicAdapter } from "./localFixtureMusic.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import { createLocalFixtureVideoAdapter } from "./localFixtureVideo.ts";
import { createMotionCompositorAdapter } from "./motionCompositor.ts";
import { RenderAdapterRegistry, renderPlatformPlan, type PlatformRenderResult } from "./rendering.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";
import { COMPARE_RTX4080S_RTX4080_IDEA } from "./fixtures/compareRtx4080sRtx4080Idea.ts";
import type { ContentPackage, ProductionPlanPackage, ScriptStoryboardPackage, VideoPlatform } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(here, "..", "..", "render-output", "generated-plan-offline");
const defaultBaseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";

export const GENERATED_PLAN_IDEA = COMPARE_RTX4080S_RTX4080_IDEA;
export const GENERATED_PLAN_PLATFORM: VideoPlatform = "youtube-shorts";

export interface GeneratedPlanPackages {
  content: ContentPackage;
  storyboard: ScriptStoryboardPackage;
  production: ProductionPlanPackage;
}

/** Real idea -> real content package -> real storyboard -> real six-beat production plan. */
export function buildGeneratedPlanPackages(generatedAt: Date): GeneratedPlanPackages {
  const content = buildContentPackage(GENERATED_PLAN_IDEA, generatedAt);
  const storyboard = buildScriptStoryboardPackage(GENERATED_PLAN_IDEA, content);
  const production = buildProductionPlanPackage(storyboard);
  return { content, storyboard, production };
}

export function buildOfflineGeneratedPlanRegistry(options: {
  baseUrl: string;
  outputDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}): RenderAdapterRegistry {
  return new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl: options.baseUrl, outputDir: join(options.outputDir, "ui") }))
    .register(createLocalFixtureVideoAdapter({ outputDir: join(options.outputDir, "video-fixture"), config: { ffmpegPath: options.ffmpegPath } }))
    // The full six-beat narration is much longer than offlineCompositorSmoke.ts's
    // one-line smoke narration, so espeak-ng's default 165wpm no longer fits
    // the storyboard's target duration (motionCompositor.ts refuses to trim
    // speech or silently hide an overrun — see its voice-overrun check). A
    // real paid narrator would read this pace comfortably; 220wpm is
    // espeak-ng's offline stand-in for that, not a change to the actual
    // narration text or timing the storyboard generated.
    .register(createLocalFixtureTtsAdapter({ outputDir: join(options.outputDir, "audio"), config: { speedWpm: 220 } }))
    .register(createLocalFixtureMusicAdapter({ outputDir: join(options.outputDir, "music-fixture"), config: { ffmpegPath: options.ffmpegPath } }))
    .register(createCaptionRenderAdapter({ outputDir: join(options.outputDir, "captions") }))
    .register(createMotionCompositorAdapter({ outputDir: options.outputDir, ffmpegPath: options.ffmpegPath, ffprobePath: options.ffprobePath }));
}

/**
 * Renders an ALREADY-BUILT production plan package — the same object a
 * caller may also use to build a quality-review contract — so the contract
 * and the render are guaranteed to describe the same plan, not two separate
 * builds of "the same idea" that could silently drift apart.
 */
export async function renderGeneratedProductionPlan(
  production: ProductionPlanPackage,
  platform: VideoPlatform,
  options: { baseUrl?: string; outputDir?: string; ffmpegPath?: string; ffprobePath?: string } = {},
): Promise<{ result: PlatformRenderResult; outputDir: string }> {
  const platformPlan = production.platforms.find((entry) => entry.platform === platform);
  if (!platformPlan) throw new Error(`Generated production plan ${production.packageId} has no ${platform} platform.`);

  const outputDir = options.outputDir ?? defaultOutputDir;
  const baseUrl = options.baseUrl ?? defaultBaseUrl;
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const registry = buildOfflineGeneratedPlanRegistry({
    baseUrl,
    outputDir,
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath,
  });

  console.log(`Rendering the actual generated ${platformPlan.tasks.filter((t) => t.sourceBeat !== null).length}-beat production plan for ${production.ideaId} (${platform}) against ${baseUrl}.`);
  const result = await renderPlatformPlan(production, platformPlan, registry, { maxAttemptsPerCapability: 1 });
  if (result.status !== "succeeded" || result.finalArtifacts.length !== 1) {
    for (const task of result.taskResults) {
      if (task.status !== "succeeded") console.error(`${task.taskId}: ${task.status} ${task.error ?? ""}`);
    }
    throw new Error("Generated-plan offline render failed.");
  }
  const final = result.finalArtifacts[0];
  if (final.mimeType !== "video/mp4" || final.uri.startsWith("dry-run://")) {
    throw new Error(`Compositor returned ${final.mimeType} at ${final.uri}, not a real MP4.`);
  }
  console.log("Real generated-plan offline render succeeded.");
  console.log(`Output: ${final.uri}`);
  console.log(`Metadata: ${JSON.stringify(final.metadata)}`);
  return { result, outputDir };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain) {
  const { production } = buildGeneratedPlanPackages(new Date());
  renderGeneratedProductionPlan(production, GENERATED_PLAN_PLATFORM).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
