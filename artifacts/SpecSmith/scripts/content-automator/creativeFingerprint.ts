import type {
  ContentPackage,
  CreativeFingerprint,
  DailyVideoPlan,
  DensityBand,
  FirstVisualType,
  PlatformScriptStoryboard,
  ScriptStoryboardPackage,
  VideoPlatform,
  ContentFreshness,
} from "./types.ts";

export interface CreativeRuntimeMetadata {
  variantKey?: string;
  firstVisualType?: FirstVisualType;
  editDensity?: DensityBand;
  sfxDensity?: DensityBand;
  voiceId?: string;
  voiceName?: string;
  narrationSpeed?: number;
  musicStyle?: string;
  ctaFamily?: string;
  changedVariable?: string;
  parentCreativeId?: string;
  contentFreshness?: ContentFreshness;
  generatedVisualRatio?: number;
  uiProofRatio?: number;
  exactProductAssetRatio?: number;
  generationCostUsd?: number;
  generationSeconds?: number;
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "v1";
}

function hookFamily(format: DailyVideoPlan["idea"]["format"]): string {
  if (format === "game") return "interactive-choice";
  if (format === "buyer-warning") return "buyer-warning";
  if (format === "comparison") return "price-gap-comparison";
  if (format === "visual-story") return "visual-metaphor";
  if (format === "simulation") return "rules-based-simulation";
  if (format === "experiment") return "story-experiment";
  if (format === "value") return "value-reveal";
  if (format === "build") return "budget-allocation";
  return "curiosity-reveal";
}

function captionDensity(script: PlatformScriptStoryboard): DensityBand {
  if (script.beats.length === 0) return "unknown";
  const captioned = script.beats.filter((beat) => beat.onScreenText.trim().length > 0).length;
  const ratio = captioned / script.beats.length;
  if (ratio <= 0.35) return "low";
  if (ratio <= 0.70) return "medium";
  return "high";
}

function ctaTimingBucket(script: PlatformScriptStoryboard): "early" | "middle" | "late" {
  const ctaBeat = script.beats.find((beat) => beat.purpose === "cta");
  const start = ctaBeat?.startSecond ?? Math.max(0, script.targetDurationSeconds - 2);
  const ratio = script.targetDurationSeconds > 0 ? start / script.targetDurationSeconds : 1;
  if (ratio < 0.4) return "early";
  if (ratio < 0.72) return "middle";
  return "late";
}

function defaultCtaFamily(feature: DailyVideoPlan["idea"]["productConnection"]["feature"]): string {
  if (feature === "compare") return "compare-on-specsmithpc";
  if (feature === "builder") return "build-on-specsmithpc";
  if (feature === "build-crate") return "try-build-crate";
  if (feature === "upgrade") return "check-upgrade-on-specsmithpc";
  return `open-${feature}`;
}

function assertRatio(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite ratio from 0 to 1.`);
  }
  return round(value);
}

function findPackage(packages: ContentPackage[], ideaId: string): ContentPackage {
  const result = packages.find((entry) => entry.ideaId === ideaId);
  if (!result) throw new Error(`Missing content package for idea ${ideaId}.`);
  return result;
}

function findScriptPackage(packages: ScriptStoryboardPackage[], ideaId: string): ScriptStoryboardPackage {
  const result = packages.find((entry) => entry.ideaId === ideaId);
  if (!result) throw new Error(`Missing storyboard package for idea ${ideaId}.`);
  return result;
}

function runtimeKey(ideaId: string, platform: VideoPlatform): string {
  return `${ideaId}:${platform}`;
}

export function buildCreativeFingerprint(
  plan: DailyVideoPlan,
  contentPackage: ContentPackage,
  script: PlatformScriptStoryboard,
  runtime: CreativeRuntimeMetadata = {},
): CreativeFingerprint {
  if (contentPackage.ideaId !== plan.idea.id) {
    throw new Error(`Creative fingerprint idea mismatch: ${plan.idea.id} vs ${contentPackage.ideaId}.`);
  }
  if (script.targetDurationSeconds <= 0 || !Number.isFinite(script.targetDurationSeconds)) {
    throw new Error(`Creative fingerprint requires a positive duration for ${plan.idea.id}/${script.platform}.`);
  }
  if (runtime.narrationSpeed !== undefined && (!Number.isFinite(runtime.narrationSpeed) || runtime.narrationSpeed <= 0)) {
    throw new Error("narrationSpeed must be a positive finite number.");
  }
  if (runtime.generationCostUsd !== undefined && (!Number.isFinite(runtime.generationCostUsd) || runtime.generationCostUsd < 0)) {
    throw new Error("generationCostUsd cannot be negative.");
  }
  if (runtime.generationSeconds !== undefined && (!Number.isFinite(runtime.generationSeconds) || runtime.generationSeconds < 0)) {
    throw new Error("generationSeconds cannot be negative.");
  }

  const variant = slug(runtime.variantKey ?? "v1");
  const creativeId = `creative-${contentPackage.campaignId}-${script.platform}-${variant}`;
  const platformPackage = contentPackage.platforms.find((entry) => entry.platform === script.platform);
  if (!platformPackage) throw new Error(`Missing ${script.platform} content variant for ${contentPackage.packageId}.`);

  const captionedBeats = script.beats.filter((beat) => beat.onScreenText.trim().length > 0).length;
  const captionedBeatRatio = script.beats.length > 0 ? captionedBeats / script.beats.length : 0;
  const plannedBeatChangesPer10Seconds = script.beats.length > 1
    ? ((script.beats.length - 1) / script.targetDurationSeconds) * 10
    : 0;

  return {
    version: "creative-fingerprint-v1",
    creativeId,
    packageId: contentPackage.packageId,
    campaignId: contentPackage.campaignId,
    ideaId: plan.idea.id,
    platform: script.platform,
    format: plan.idea.format,
    feature: plan.idea.productConnection.feature,
    subjectIds: [...plan.idea.subjectIds],
    hookFamily: hookFamily(plan.idea.format),
    hookText: plan.idea.hook,
    visualWorld: plan.idea.creativeDNA.visualWorld.split(" — ")[0].trim(),
    narrativeEngine: plan.idea.creativeDNA.narrativeEngine,
    targetDurationSeconds: script.targetDurationSeconds,
    beatCount: script.beats.length,
    plannedBeatChangesPer10Seconds: round(plannedBeatChangesPer10Seconds),
    editDensity: runtime.editDensity ?? "unknown",
    captionedBeatRatio: round(captionedBeatRatio),
    captionDensity: captionDensity(script),
    firstVisualType: runtime.firstVisualType ?? "unknown",
    voiceId: runtime.voiceId?.trim() || undefined,
    voiceName: runtime.voiceName?.trim() || undefined,
    narrationSpeed: runtime.narrationSpeed,
    musicStyle: runtime.musicStyle?.trim() || undefined,
    sfxDensity: runtime.sfxDensity ?? "unknown",
    ctaFamily: runtime.ctaFamily?.trim() || defaultCtaFamily(plan.idea.productConnection.feature),
    ctaTimingBucket: ctaTimingBucket(script),
    hashtagStrategy: platformPackage.hashtagStrategy,
    hashtags: [...platformPackage.hashtags],
    // Variants are observations in one experiment, not separate experiments.
    // Keep the platform boundary because each network has a different
    // distribution system and should be learned independently.
    experimentId: `exp-${contentPackage.campaignId}-${script.platform}`,
    experimentPrimaryMetric: plan.experiment.primaryMetric,
    changedVariable: runtime.changedVariable?.trim() || "unassigned",
    parentCreativeId: runtime.parentCreativeId?.trim() || undefined,
    contentFreshness: runtime.contentFreshness ?? "unknown",
    generatedVisualRatio: assertRatio("generatedVisualRatio", runtime.generatedVisualRatio),
    uiProofRatio: assertRatio("uiProofRatio", runtime.uiProofRatio),
    exactProductAssetRatio: assertRatio("exactProductAssetRatio", runtime.exactProductAssetRatio),
    generationCostUsd: runtime.generationCostUsd,
    generationSeconds: runtime.generationSeconds,
  };
}

export function buildCreativeFingerprints(
  plans: DailyVideoPlan[],
  contentPackages: ContentPackage[],
  storyboardPackages: ScriptStoryboardPackage[],
  runtimeByIdeaAndPlatform: Record<string, CreativeRuntimeMetadata> = {},
): CreativeFingerprint[] {
  const fingerprints: CreativeFingerprint[] = [];

  for (const plan of plans) {
    const contentPackage = findPackage(contentPackages, plan.idea.id);
    const storyboards = findScriptPackage(storyboardPackages, plan.idea.id);
    for (const script of storyboards.scripts) {
      fingerprints.push(
        buildCreativeFingerprint(
          plan,
          contentPackage,
          script,
          runtimeByIdeaAndPlatform[runtimeKey(plan.idea.id, script.platform)] ?? {},
        ),
      );
    }
  }

  const ids = new Set<string>();
  for (const fingerprint of fingerprints) {
    if (ids.has(fingerprint.creativeId)) throw new Error(`Duplicate creative id ${fingerprint.creativeId}.`);
    ids.add(fingerprint.creativeId);
  }

  return fingerprints;
}
