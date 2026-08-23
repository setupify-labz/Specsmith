import type {
  PlatformProductionPlan,
  PlatformScriptStoryboard,
  ProductionPlanPackage,
  ProductionTask,
  ScriptStoryboardPackage,
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

function buildTasks(script: PlatformScriptStoryboard, context: UiRenderContext): ProductionTask[] {
  const tasks: ProductionTask[] = [];

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

    tasks.push({
      taskId: `${script.platform}-beat-${index + 1}-visual`,
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
      // prose for the generative adapters; this is what the deterministic
      // renderer reads, so canonical ids never have to be recovered from text.
      ...(capability === "deterministic-ui-render" && uiRenderState ? { uiRenderState } : {}),
    });
  }

  tasks.push({
    taskId: `${script.platform}-voice`,
    capability: "text-to-speech",
    sourceBeat: null,
    purpose: "Generate narration matched to storyboard timing and emphasis.",
    inputRequirements: script.beats.map((beat) => beat.narration),
    outputRequirements: [
      `Fit naturally within approximately ${script.targetDurationSeconds} seconds without sped-up robotic delivery.`,
      "Preserve hardware names, numbers, and SpecSmith terminology exactly after factual verification.",
    ],
  });

  tasks.push({
    taskId: `${script.platform}-audio`,
    capability: "music-sfx",
    sourceBeat: null,
    purpose: "Create restrained music and sound design that supports reveals and decisions.",
    inputRequirements: ["Use silence, impacts, and transitions intentionally; do not flatten every beat with nonstop hype audio."],
    outputRequirements: ["Narration remains intelligible.", "No copyrighted music is assumed available without license."],
  });

  tasks.push({
    taskId: `${script.platform}-captions`,
    capability: "caption-render",
    sourceBeat: null,
    purpose: "Render readable captions and deliberate on-screen decision text.",
    inputRequirements: script.beats.map((beat) => beat.onScreenText),
    outputRequirements: ["Captions stay inside short-form safe areas.", "Do not cover critical product UI or hardware evidence."],
  });

  tasks.push({
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
  });

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
