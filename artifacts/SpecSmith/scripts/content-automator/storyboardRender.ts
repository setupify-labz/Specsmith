// The handoff this subsystem kept describing as future work: the storyboard
// it GENERATES is the thing that gets rendered.
//
// WHAT WAS THERE BEFORE. endToEndOfflinePipeline.ts builds a real content
// package, a real six-beat storyboard and a real production plan — and then
// renders something else. Its own header is explicit: the generated plan "is
// used ONLY to build a real QualityReviewRequest CONTRACT ... it is never
// rendered through", and the MP4 comes from offlineCompositorSmoke.ts's
// "separate, hand-authored, already-proven 3-visual/8-second timeline".
//
// So the chain of custody from a render onward was proven, and the chain from
// an IDEA to that render was not. A storyboard nobody renders is a document,
// not a pipeline.
//
// WHAT CLOSES IT. Nothing about the plan changes. buildProductionPlanPackage
// already emits `sourceBeat: index` and a `uiRenderState` per beat; the only
// reason the plan could not run was that two of its eight tasks had no
// offline adapter. offlineBeatFixtures.ts supplies those two. This module
// registers all six adapters and renders the generated plan as-is.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not pass a quality gate, mark
// anything publishable, or touch the publication ledger. The output is a
// DRAFT for a human to watch. Every beat records which adapter produced it
// and whether that adapter was a fixture, so a reviewer can see exactly which
// seconds are real product evidence and which are stand-ins.

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { createCaptionRenderAdapter } from "./captionRender.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import { createMotionCompositorAdapter } from "./motionCompositor.ts";
import { createOfflineCardVideoAdapter, createOfflineSilentBedAdapter } from "./offlineBeatFixtures.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";
import { RenderAdapterRegistry, renderPlatformPlan, type PlatformRenderResult, type RenderArtifact } from "./rendering.ts";
import { COMPARE_IDEA } from "./compareIdeaFixture.ts";
import type {
  ContentPackage,
  ContentIdea,
  PlatformProductionPlan,
  ProductionPlanPackage,
  ScriptStoryboardPackage,
  VideoPlatform,
} from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));

export const STORYBOARD_RENDER_PLATFORM: VideoPlatform = "youtube-shorts";

/**
 * The voice this draft is INTENDED to ship with, recorded as intent only.
 *
 * "Liam" is an ElevenLabs premade voice and reaching it costs a paid API
 * call, which is out of scope without explicit approval. The id is therefore
 * NOT hardcoded here: this environment has no ElevenLabs credential to
 * validate one against, and writing down an unverified voice id would be
 * exactly the kind of plausible-looking invention this repository's rules
 * forbid. Set ELEVENLABS_VOICE_ID (and ELEVENLABS_API_KEY) to render with it
 * for real; until then the name travels with the draft so the reviewer knows
 * what the narration is a stand-in FOR.
 */
export const INTENDED_VOICE_NAME = "Liam";

/**
 * Words per minute the narration fixture actually speaks at.
 *
 * espeak-ng's own default, and squarely inside the 150-180 wpm range natural
 * speech occupies. It is used to PREDICT whether a storyboard's narration can
 * fit its stated windows before a render is attempted — not to argue the
 * fixture is slow. A professional read of the same words would not be faster.
 */
export const NARRATION_WORDS_PER_MINUTE = 165;

/** Seconds a piece of narration needs at a natural speaking rate. */
export function narrationSecondsFor(text: string, wordsPerMinute = NARRATION_WORDS_PER_MINUTE): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / wordsPerMinute) * 60;
}

export interface StoryboardTimingFit {
  /** What the storyboard claims the video lasts. */
  targetSeconds: number;
  /** What its own narration actually needs, spoken naturally. */
  narrationSeconds: number;
  /** narrationSeconds / targetSeconds. 1.0 means the storyboard fits. */
  overrunRatio: number;
  /** True when the storyboard wrote more words than its windows can hold. */
  overruns: boolean;
  /** Per-beat detail, so the defect can be attributed rather than averaged. */
  beats: { index: number; purpose: string; windowSeconds: number; neededSeconds: number }[];
}

/**
 * Measures a storyboard's narration against the windows it assigned itself.
 *
 * THIS EXISTS BECAUSE THE FIRST REAL RENDER FOUND A DEFECT NOBODY HAD SEEN.
 * Wiring the generated storyboard through to ffmpeg immediately failed the
 * compositor's voice-overrun guard: 90 words of narration for a 24-second
 * target, which is 225 wpm — far outside natural speech, and every one of the
 * six beats overran its own window. The storyboard had never been rendered,
 * so nothing had ever checked that its words fit its clock.
 *
 * Reported rather than silently corrected. Shortening the narration is a
 * copy decision.
 */
export function measureStoryboardTiming(
  script: { targetDurationSeconds: number; beats: readonly { purpose: string; narration: string; startSecond: number; endSecond: number }[] },
  wordsPerMinute = NARRATION_WORDS_PER_MINUTE,
): StoryboardTimingFit {
  const narrationSeconds = narrationSecondsFor(script.beats.map((beat) => beat.narration).join(" "), wordsPerMinute);
  const targetSeconds = script.targetDurationSeconds;
  return {
    targetSeconds,
    narrationSeconds,
    overrunRatio: targetSeconds > 0 ? narrationSeconds / targetSeconds : Number.POSITIVE_INFINITY,
    overruns: narrationSeconds > targetSeconds,
    beats: script.beats.map((beat, index) => ({
      index,
      purpose: beat.purpose,
      windowSeconds: beat.endSecond - beat.startSecond,
      neededSeconds: narrationSecondsFor(beat.narration, wordsPerMinute),
    })),
  };
}

/**
 * Stretches a plan's clock to the duration its narration actually needs.
 *
 * EVERY WINDOW SCALES BY THE SAME FACTOR, so the storyboard's proportions and
 * the visual/voice sync survive intact — beat three still occupies the same
 * share of the video it was written to occupy. Nothing is trimmed, reordered
 * or rewritten.
 *
 * This is NOT a way around the compositor's voice-overrun guard. That guard
 * exists to stop a mismatch being HIDDEN behind a long freeze-frame, and the
 * mismatch here is not hidden: `measureStoryboardTiming` reports it, the CLI
 * prints it, and the review packet leads with it. What this does is let a
 * reviewer watch the draft the storyboard actually describes while the copy
 * defect is fixed, instead of having no draft at all.
 */
/**
 * The timeline is NOT rescaled to fit over-long narration any more.
 *
 * It was, briefly. A storyboard that wrote 90 words for a 24-second target
 * had every window stretched by 1.36x so a draft could be watched, which
 * turned a 24-second short into a 34-second one without anybody choosing
 * that length. The clock was never the thing that was wrong.
 *
 * `assertNarrationFitsDuration` in scriptStoryboard.ts now refuses to emit a
 * script whose words cannot be spoken in its own runtime, so an overrun is
 * caught where the copy is written rather than accommodated three stages
 * later. `measureStoryboardTiming` stays because the review packet still
 * reports the margin — how close a script runs to its budget is worth
 * seeing even when it fits.
 */

export interface StoryboardRenderOptions {
  idea?: ContentIdea;
  platform?: VideoPlatform;
  baseUrl?: string;
  outputDir?: string;
  generatedAt?: Date;
}

/** One beat, and the honest provenance of the seconds it produced. */
export interface RenderedBeat {
  beatIndex: number;
  purpose: string;
  /** Where this beat sits in the STORYBOARD's clock. */
  startSecond: number;
  endSecond: number;
  /** Where it actually sits in the RENDERED video, after any rescale. */
  renderedStartSecond: number;
  renderedEndSecond: number;
  onScreenText: string;
  narration: string;
  capability: string;
  adapterName: string;
  /** True when a fixture stood in for a provider that needs approval. */
  isFixture: boolean;
  artifactUri: string | null;
}

export interface StoryboardRenderResult {
  idea: ContentIdea;
  content: ContentPackage;
  storyboard: ScriptStoryboardPackage;
  production: ProductionPlanPackage;
  plan: PlatformProductionPlan;
  /** The storyboard's own clock versus what its narration needs. */
  timing: StoryboardTimingFit;
  /** Always 1. Kept so the packet can state that nothing was stretched. */
  timingScale: number;
  render: PlatformRenderResult;
  master: RenderArtifact;
  beats: RenderedBeat[];
  outputDir: string;
}

/** Every adapter needed to run a generated plan without a paid provider. */
export function createOfflineStoryboardRegistry(options: {
  baseUrl: string;
  outputDir: string;
}): RenderAdapterRegistry {
  return new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl: options.baseUrl, outputDir: join(options.outputDir, "ui") }))
    .register(createOfflineCardVideoAdapter({ outputDir: join(options.outputDir, "hook") }))
    .register(createLocalFixtureTtsAdapter({ outputDir: join(options.outputDir, "audio") }))
    .register(createOfflineSilentBedAdapter({ outputDir: join(options.outputDir, "music") }))
    .register(createCaptionRenderAdapter({ outputDir: join(options.outputDir, "captions") }))
    .register(createMotionCompositorAdapter({
      outputDir: options.outputDir,
      ffmpegPath: process.env.SPECSMITH_FFMPEG_PATH,
      ffprobePath: process.env.SPECSMITH_FFPROBE_PATH,
    }));
}

/**
 * Pairs each rendered task back to the storyboard beat that asked for it.
 *
 * The join is `sourceBeat`, which the plan builder has always populated and
 * nothing has ever read. It is what lets the review packet say "second 4 to 8
 * is a real capture of the Compare page" rather than "trust the pipeline".
 */
export function describeRenderedBeats(
  plan: PlatformProductionPlan,
  storyboard: ScriptStoryboardPackage,
  platform: VideoPlatform,
  render: PlatformRenderResult,
  timingScale = 1,
): RenderedBeat[] {
  const script = storyboard.scripts.find((entry) => entry.platform === platform);
  if (!script) return [];
  const resultByTask = new Map(render.taskResults.map((entry) => [entry.taskId, entry]));

  return plan.tasks
    .filter((task) => task.sourceBeat !== null)
    .map((task) => {
      const beat = script.beats[task.sourceBeat as number];
      const result = resultByTask.get(task.taskId);
      const artifact = result?.artifacts[0];
      const metadata = (artifact?.metadata ?? {}) as { isFixture?: unknown; renderer?: unknown };
      return {
        beatIndex: task.sourceBeat as number,
        purpose: beat?.purpose ?? "unknown",
        startSecond: beat?.startSecond ?? 0,
        endSecond: beat?.endSecond ?? 0,
        renderedStartSecond: Number(((beat?.startSecond ?? 0) * timingScale).toFixed(2)),
        renderedEndSecond: Number(((beat?.endSecond ?? 0) * timingScale).toFixed(2)),
        onScreenText: beat?.onScreenText ?? "",
        narration: beat?.narration ?? "",
        capability: task.capability,
        adapterName: result?.attempts.at(-1)?.adapterName ?? "none",
        isFixture: metadata.isFixture === true,
        artifactUri: artifact?.uri ?? null,
      };
    })
    .sort((a, b) => a.beatIndex - b.beatIndex);
}

/**
 * Runs idea -> package -> storyboard -> plan -> real MP4, offline.
 *
 * Throws rather than returning a partial result: a render that lost a beat is
 * not a draft with a gap, it is a draft whose timing no longer matches the
 * storyboard a reviewer is about to read.
 */
export async function renderGeneratedStoryboard(
  options: StoryboardRenderOptions = {},
): Promise<StoryboardRenderResult> {
  const idea = options.idea ?? COMPARE_IDEA;
  const platform = options.platform ?? STORYBOARD_RENDER_PLATFORM;
  const baseUrl = options.baseUrl ?? process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";
  const outputDir = options.outputDir ?? join(here, "..", "..", "render-output", "storyboard-draft");
  const generatedAt = options.generatedAt ?? new Date();

  const content = buildContentPackage(idea, generatedAt);
  const storyboard = buildScriptStoryboardPackage(idea, content);
  const production = buildProductionPlanPackage(storyboard);
  const generatedPlan = production.platforms.find((entry) => entry.platform === platform);
  if (!generatedPlan) throw new Error(`The generated plan has no ${platform} platform.`);
  const script = storyboard.scripts.find((entry) => entry.platform === platform);
  if (!script) throw new Error(`The generated storyboard has no ${platform} script.`);

  // Throws if the copy cannot be spoken in the runtime it claims. The plan is
  // rendered exactly as generated — no clock is adjusted to accommodate it.
  const timing = measureStoryboardTiming(script);
  const plan = generatedPlan;
  const timingScale = 1;

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const registry = createOfflineStoryboardRegistry({ baseUrl, outputDir });
  const render = await renderPlatformPlan(production, plan, registry, { maxAttemptsPerCapability: 1 });

  if (render.status !== "succeeded") {
    const failures = render.taskResults
      .filter((task) => task.status !== "succeeded")
      .map((task) => `${task.taskId}: ${task.status} ${task.error ?? ""}`.trim());
    throw new Error(`Generated storyboard render failed.\n  ${failures.join("\n  ")}`);
  }

  const master = render.finalArtifacts.find((artifact) => artifact.mimeType === "video/mp4");
  if (!master) throw new Error("Render succeeded but produced no MP4 master.");
  if (master.uri.startsWith("dry-run://")) {
    throw new Error(`Compositor returned a dry-run placeholder at ${master.uri}, not a real MP4.`);
  }

  return {
    idea,
    content,
    storyboard,
    production,
    plan,
    timing,
    timingScale,
    render,
    master,
    beats: describeRenderedBeats(plan, storyboard, platform, render, timingScale),
    outputDir,
  };
}
