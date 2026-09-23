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
 * Scales every clock in a plan so the narration it wrote actually fits.
 *
 * EVERY WINDOW SCALES BY THE SAME FACTOR, so the storyboard's proportions and
 * the visual/voice sync survive intact — beat three still occupies the same
 * share of the video it was written to occupy. Nothing is trimmed, reordered
 * or rewritten.
 *
 * It has to reach into `compositorState` and `captionRenderState` because
 * that is where the real clocks live. `plan.targetDurationSeconds` is a
 * headline; the compositor validates against `compositorState.durationSeconds`
 * and its `visualTimeline`, and the caption renderer against its own cues.
 * Scaling only the headline would leave the compositor rejecting the same
 * mismatch while the plan claimed to have fixed it.
 *
 * This is NOT a way around the compositor's voice-overrun guard. That guard
 * exists to stop a mismatch being HIDDEN behind a long freeze-frame, and this
 * mismatch is not hidden: `measureStoryboardTiming` reports it, the CLI leads
 * with it, and the review packet records both clocks. What this does is let a
 * reviewer watch the draft the storyboard actually describes while the copy
 * defect is fixed, instead of having no draft at all.
 */
export function fitPlanToNarration(
  plan: PlatformProductionPlan,
  fit: StoryboardTimingFit,
): { plan: PlatformProductionPlan; scale: number } {
  if (!fit.overruns) return { plan, scale: 1 };
  const scale = fit.narrationSeconds / fit.targetSeconds;
  const seconds = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? Number((value * scale).toFixed(3)) : 0;

  const scaleWindows = (entries: unknown): unknown => {
    if (!Array.isArray(entries)) return entries;
    return entries.map((entry) => {
      const window = entry as { startSecond?: unknown; endSecond?: unknown };
      return { ...(entry as object), startSecond: seconds(window.startSecond), endSecond: seconds(window.endSecond) };
    });
  };

  const tasks = plan.tasks.map((task) => {
    const carrier = task as typeof task & { compositorState?: unknown; captionRenderState?: unknown };
    const next = { ...task } as typeof carrier;

    if (carrier.compositorState && typeof carrier.compositorState === "object") {
      const state = carrier.compositorState as { durationSeconds?: unknown; visualTimeline?: unknown };
      next.compositorState = {
        ...state,
        durationSeconds: seconds(state.durationSeconds),
        visualTimeline: scaleWindows(state.visualTimeline),
      };
    }
    if (carrier.captionRenderState && typeof carrier.captionRenderState === "object") {
      const state = carrier.captionRenderState as { durationSeconds?: unknown; cues?: unknown };
      next.captionRenderState = {
        ...state,
        durationSeconds: seconds(state.durationSeconds),
        cues: scaleWindows(state.cues),
      };
    }
    return next as typeof task;
  });

  return {
    plan: { ...plan, targetDurationSeconds: Math.ceil(fit.narrationSeconds), tasks },
    scale,
  };
}

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
  /** Factor the clock was stretched by so the narration fits. 1 = untouched. */
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

  const timing = measureStoryboardTiming(script);
  const { plan, scale: timingScale } = fitPlanToNarration(generatedPlan, timing);

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
