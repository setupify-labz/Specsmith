import type {
  PlatformProductionPlan,
  PlatformScriptStoryboard,
  ProductionPlanPackage,
  ProductionTask,
  ScriptStoryboardPackage,
  StoryboardBeat,
} from "./types.ts";
import { deriveUiRenderState, isRenderableFeature } from "./uiRender/planUiRenderState.ts";

interface UiRenderContext {
  feature: ScriptStoryboardPackage["feature"];
  subjectIds: readonly string[];
  ideaId: string;
}

function visualCapability(beat: PlatformScriptStoryboard["beats"][number]): ProductionTask["capability"] {
  if (beat.purpose === "evidence" || beat.purpose === "payoff" || beat.purpose === "cta") {
    return "deterministic-ui-render";
  }
  if (beat.visualDirection.toLowerCase().includes("real specsmith")) {
    return "deterministic-ui-render";
  }
  return "video-generation";
}

function providerDurationForBeat(beat: StoryboardBeat): 4 | 6 | 8 {
  const duration = beat.endSecond - beat.startSecond;
  if (duration <= 4) return 4;
  if (duration <= 6) return 6;
  return 8;
}

export function deriveVideoGenerationState(
  script: Pick<PlatformScriptStoryboard, "title">,
  beat: StoryboardBeat,
): {
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "9:16";
  generateAudio: false;
} {
  const prompt = [
    `Create one instantly understandable vertical short-form PC-hardware visual for this story: ${script.title}.`,
    `Beat direction: ${beat.visualDirection}`,
    "The viewer may know almost nothing about PC hardware, so communicate one obvious choice, conflict, action, or reveal with a single strong focal point and clear cause/effect.",
    "Use cinematic motion, depth, lighting, and composition rather than a static product slideshow.",
    "Do not render readable text, prices, benchmark numbers, specification values, logos, watermarks, charts, websites, or app interfaces. Accurate text and factual evidence are added later by SpecSmith.",
    "Do not imitate the SpecSmith interface. Real SpecSmith UI is captured separately for evidence beats.",
    "Do not invent a factual performance result. This clip is entertainment/setup only, not evidence.",
  ].join(" ");

  return {
    prompt,
    durationSeconds: providerDurationForBeat(beat),
    aspectRatio: "9:16",
    generateAudio: false,
  };
}

function buildTasks(script: PlatformScriptStoryboard, context: UiRenderContext): ProductionTask[] {
  const tasks: ProductionTask[] = [];
  const visualTaskIds: string[] = [];

  // Derived once per plan: the state depends on the idea's subjects and
  // feature, not on which beat is being rendered, so every UI beat in a plan
  // depicts the same verified state.
  const uiRenderState = deriveUiRenderState(context);

  for (const [index, beat] of script.beats.entries()) {
    // Downgrade only when the SURFACE can never be captured (gallery,
    // price-guesser, ...). A renderable surface whose ids failed to resolve
    // keeps the deterministic capability and fails loudly downstream — quietly
    // turning an evidence beat into generated footage would hide the bug and
    // fabricate product visuals.
    const requested = visualCapability(beat);
    const capability = requested === "deterministic-ui-render" && !isRenderableFeature(context.feature)
      ? "video-generation"
      : requested;
    const taskId = `${script.platform}-beat-${index + 1}-visual`;
    visualTaskIds.push(taskId);

    tasks.push({
      taskId,
      capability,
      sourceBeat: index,
      purpose: `Create the ${beat.purpose} visual for ${beat.startSecond}-${beat.endSecond}s.`,
      inputRequirements: [beat.visualDirection, ...beat.factDependencies],
      outputRequirements: [
        "Vertical 9:16 framing with safe margins for captions and platform UI.",
        "No fabricated product UI, prices, specs, benchmark claims, or compatibility states.",
        capability === "deterministic-ui-render"
          ? "Use real SpecSmith UI/data state or a deterministic render from verified inputs."
          : "Generated visuals may dramatize presentation but cannot introduce factual claims absent from the storyboard.",
      ],
      fallbackCapability: capability === "video-generation" ? "image-generation" : undefined,
      // Structured state travels with the task. inputRequirements above stays
      // prose for generative/fallback adapters; the real provider receives a
      // provider-safe prompt and explicit allowed duration/aspect ratio.
      ...(capability === "video-generation" ? { videoGenerationState: deriveVideoGenerationState(script, beat) } : {}),
      ...(capability === "deterministic-ui-render" && uiRenderState ? { uiRenderState } : {}),
    });
  }

  const voiceTaskId = `${script.platform}-voice`;
  tasks.push({
    taskId: voiceTaskId,
    capability: "text-to-speech",
    sourceBeat: null,
    purpose: "Generate narration matched to storyboard timing and emphasis.",
    inputRequirements: script.beats.map((beat) => beat.narration),
    outputRequirements: [
      `Fit naturally within approximately ${script.targetDurationSeconds} seconds without sped-up robotic delivery.`,
      "Preserve hardware names, numbers, and SpecSmith terminology exactly after factual verification.",
    ],
  });

  const musicTaskId = `${script.platform}-audio`;
  tasks.push({
    taskId: musicTaskId,
    capability: "music-sfx",
    sourceBeat: null,
    purpose: "Create restrained music and sound design that supports reveals and decisions.",
    inputRequirements: ["Use silence, impacts, and transitions intentionally; do not flatten every beat with nonstop hype audio."],
    outputRequirements: ["Narration remains intelligible.", "No copyrighted music is assumed available without license."],
  });

  const captionTaskId = `${script.platform}-captions`;
  const captionTask: ProductionTask = {
    taskId: captionTaskId,
    capability: "caption-render",
    sourceBeat: null,
    purpose: "Render readable captions and deliberate on-screen decision text.",
    inputRequirements: script.beats.map((beat) => beat.onScreenText),
    outputRequirements: ["Captions stay inside short-form safe areas.", "Do not cover critical product UI or hardware evidence."],
  };
  // Timing is structured at the planning boundary. The caption renderer will
  // not guess cue times by dividing a video evenly or parsing prose.
  (captionTask as ProductionTask & { captionRenderState?: unknown }).captionRenderState = {
    durationSeconds: script.targetDurationSeconds,
    cues: script.beats
      .filter((beat) => beat.onScreenText.trim().length > 0)
      .map((beat) => ({
        startSecond: beat.startSecond,
        endSecond: beat.endSecond,
        text: beat.onScreenText,
      })),
  };
  tasks.push(captionTask);

  const composeTask: ProductionTask = {
    taskId: `${script.platform}-compose`,
    capability: "motion-compositor",
    sourceBeat: null,
    purpose: "Assemble verified visuals, narration, audio, captions, and transitions into the platform master.",
    inputRequirements: tasks.map((task) => task.taskId),
    outputRequirements: [
      `Final duration stays close to ${script.targetDurationSeconds} seconds.`,
      "Cuts follow storyboard causality rather than arbitrary template timing.",
      "The final CTA uses the exact SpecSmith destination defined by the content package.",
    ],
  };
  // The compositor receives an explicit beat timeline rather than relying on
  // dependency-array order. This keeps cuts tied to the storyboard and makes a
  // reordered/refactored production plan fail loudly instead of changing edit timing.
  (composeTask as ProductionTask & { compositorState?: unknown }).compositorState = {
    durationSeconds: script.targetDurationSeconds,
    fps: 30,
    visualTimeline: script.beats.map((beat, index) => ({
      visualTaskId: visualTaskIds[index],
      startSecond: beat.startSecond,
      endSecond: beat.endSecond,
    })),
    voiceTaskId,
    musicTaskId,
    captionTaskId,
  };
  tasks.push(composeTask);

  return tasks;
}

function buildPlatformProductionPlan(script: PlatformScriptStoryboard, context: UiRenderContext): PlatformProductionPlan {
  const tasks = buildTasks(script, context);
  return {
    platform: script.platform,
    targetDurationSeconds: script.targetDurationSeconds,
    tasks,
    renderOrder: tasks.map((task) => task.taskId),
    qualityChecks: [
      "Every factual visual claim is traceable to a verified storyboard dependency or deterministic SpecSmith state.",
      "No generated asset impersonates real SpecSmith UI when a deterministic UI render is required.",
      "Generated setup visuals contain no readable generated text/specs/prices/benchmark claims; those overlays come from verified production data.",
      "No benchmark_score is presented as measured game FPS.",
      "Opening conflict is understandable in the first two seconds without requiring audio.",
      "The video contains a real reversal or decision beat before the payoff.",
      "The final CTA points to the exact product route, not a generic homepage.",
      "Reject and regenerate if the output looks like generic AI B-roll plus captions.",
    ],
  };
}

export function buildProductionPlanPackage(scriptPackage: ScriptStoryboardPackage): ProductionPlanPackage {
  const context: UiRenderContext = {
    feature: scriptPackage.feature,
    subjectIds: scriptPackage.subjectIds,
    ideaId: scriptPackage.ideaId,
  };
  return {
    packageId: scriptPackage.packageId,
    ideaId: scriptPackage.ideaId,
    campaignId: scriptPackage.campaignId,
    platforms: scriptPackage.scripts.map((script) => buildPlatformProductionPlan(script, context)),
  };
}

export function buildProductionPlanPackages(scriptPackages: ScriptStoryboardPackage[]): ProductionPlanPackage[] {
  return scriptPackages.map(buildProductionPlanPackage);
}
