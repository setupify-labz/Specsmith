import type {
  ContentPackage,
  PlatformProductionPlan,
  PlatformScriptStoryboard,
  ProductionPlanPackage,
  ScriptStoryboardPackage,
  VideoPlatform,
} from "./types.ts";

export type ReviewDecision =
  | "pass"
  | "regenerate-targeted"
  | "regenerate-full"
  | "hold-for-human-review";

export type ReviewSeverity = "warning" | "error" | "critical";

export type ReviewDimension =
  | "factual-accuracy"
  | "product-integrity"
  | "hook-clarity"
  | "visual-quality"
  | "caption-readability"
  | "audio-quality"
  | "pacing-retention"
  | "specsmith-relevance"
  | "cta-accuracy";

export type ClaimKind =
  | "price"
  | "hardware-spec"
  | "compatibility"
  | "specsmith-score"
  | "measured-fps"
  | "estimated-fps"
  | "other";

export interface ReviewIssue {
  code: string;
  severity: ReviewSeverity;
  dimension: ReviewDimension;
  message: string;
  taskIds: string[];
}

export interface QualityReviewRequest {
  packageId: string;
  ideaId: string;
  campaignId: string;
  platform: VideoPlatform;
  expectedRoute: string;
  targetDurationSeconds: number;
  requiredFacts: string[];
  storyboardChecks: string[];
  productionChecks: string[];
  expectedTaskIds: string[];
  hardBlockers: string[];
}

export interface ObservedClaim {
  text: string;
  kind: ClaimKind;
  verification: "verified" | "unverified" | "contradicted";
  evidenceRefs: string[];
  displayLabel?: string;
}

export interface ObservedUiShot {
  source: "deterministic" | "generated" | "unknown";
  presentedAsRealSpecSmithUi: boolean;
  taskId?: string;
}

export interface RenderedVideoObservation {
  packageId: string;
  platform: VideoPlatform;
  durationSeconds: number;
  openingDecisionClearWithoutAudio: boolean;
  captionsLegibilityScore: number;
  captionSafeAreaRatio: number;
  audioClarityScore: number;
  visualCoherenceScore: number;
  pacingScore: number;
  specSmithRelevanceScore: number;
  genericAiBrollRatio: number;
  observedCtaRoute: string;
  claims: ObservedClaim[];
  uiShots: ObservedUiShot[];
  missingRequiredFacts: string[];
  failedTaskIds: string[];
}

export interface QualityReviewResult {
  packageId: string;
  platform: VideoPlatform;
  decision: ReviewDecision;
  publishable: boolean;
  overallScore: number;
  dimensionScores: Record<ReviewDimension, number>;
  issues: ReviewIssue[];
  regenerateTaskIds: string[];
}

const clamp10 = (value: number) => Math.max(0, Math.min(10, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function platformScript(scriptPackage: ScriptStoryboardPackage, platform: VideoPlatform): PlatformScriptStoryboard {
  const script = scriptPackage.scripts.find((entry) => entry.platform === platform);
  if (!script) throw new Error(`Missing ${platform} storyboard for ${scriptPackage.packageId}`);
  return script;
}

function platformPlan(productionPackage: ProductionPlanPackage, platform: VideoPlatform): PlatformProductionPlan {
  const plan = productionPackage.platforms.find((entry) => entry.platform === platform);
  if (!plan) throw new Error(`Missing ${platform} production plan for ${productionPackage.packageId}`);
  return plan;
}

export function buildQualityReviewRequest(
  contentPackage: ContentPackage,
  scriptPackage: ScriptStoryboardPackage,
  productionPackage: ProductionPlanPackage,
  platform: VideoPlatform,
): QualityReviewRequest {
  if (contentPackage.packageId !== scriptPackage.packageId || contentPackage.packageId !== productionPackage.packageId) {
    throw new Error(`Quality-review inputs do not share the same package id: ${contentPackage.packageId}`);
  }

  const script = platformScript(scriptPackage, platform);
  const production = platformPlan(productionPackage, platform);

  return {
    packageId: contentPackage.packageId,
    ideaId: contentPackage.ideaId,
    campaignId: contentPackage.campaignId,
    platform,
    expectedRoute: contentPackage.site.route,
    targetDurationSeconds: script.targetDurationSeconds,
    requiredFacts: [...contentPackage.requiredFacts],
    storyboardChecks: [...script.factualGuardrails],
    productionChecks: [...production.qualityChecks],
    expectedTaskIds: [...production.renderOrder],
    hardBlockers: [
      "No contradicted factual claim may publish.",
      "No unverified factual claim may publish automatically.",
      "Generated or unknown UI may not be presented as real SpecSmith UI.",
      "SpecSmith internal benchmark_score may not be presented as measured game FPS.",
      "Estimated FPS must be visibly labeled Estimated FPS.",
      `The CTA route must exactly match ${contentPackage.site.route}.`,
    ],
  };
}

export function buildQualityReviewRequests(
  contentPackages: ContentPackage[],
  scriptPackages: ScriptStoryboardPackage[],
  productionPackages: ProductionPlanPackage[],
): QualityReviewRequest[] {
  const scriptsByPackage = new Map(scriptPackages.map((entry) => [entry.packageId, entry]));
  const productionByPackage = new Map(productionPackages.map((entry) => [entry.packageId, entry]));
  const platforms: VideoPlatform[] = ["youtube-shorts", "tiktok", "instagram-reels"];

  return contentPackages.flatMap((contentPackage) => {
    const scriptPackage = scriptsByPackage.get(contentPackage.packageId);
    const productionPackage = productionByPackage.get(contentPackage.packageId);
    if (!scriptPackage || !productionPackage) {
      throw new Error(`Missing script or production package for ${contentPackage.packageId}`);
    }
    return platforms.map((platform) => buildQualityReviewRequest(contentPackage, scriptPackage, productionPackage, platform));
  });
}

function taskIdsForCapability(request: QualityReviewRequest, capabilityHint: string): string[] {
  return request.expectedTaskIds.filter((taskId) => taskId.includes(capabilityHint));
}

function addIssue(issues: ReviewIssue[], issue: ReviewIssue): void {
  issues.push(issue);
}

function checkClaims(request: QualityReviewRequest, observation: RenderedVideoObservation, issues: ReviewIssue[]): void {
  for (const claim of observation.claims) {
    if (claim.verification === "contradicted") {
      addIssue(issues, {
        code: "contradicted-claim",
        severity: "critical",
        dimension: "factual-accuracy",
        message: `Contradicted factual claim: ${claim.text}`,
        taskIds: [...observation.failedTaskIds],
      });
    } else if (claim.verification === "unverified") {
      addIssue(issues, {
        code: "unverified-claim",
        severity: "error",
        dimension: "factual-accuracy",
        message: `Unverified factual claim requires evidence or removal: ${claim.text}`,
        taskIds: [...observation.failedTaskIds],
      });
    } else if (claim.evidenceRefs.length === 0) {
      addIssue(issues, {
        code: "missing-claim-evidence",
        severity: "error",
        dimension: "factual-accuracy",
        message: `Verified claim is missing an evidence reference: ${claim.text}`,
        taskIds: [...observation.failedTaskIds],
      });
    }

    const normalizedLabel = (claim.displayLabel ?? "").toLowerCase();
    if (claim.kind === "estimated-fps" && !normalizedLabel.includes("estimated fps")) {
      addIssue(issues, {
        code: "estimated-fps-unlabeled",
        severity: "critical",
        dimension: "factual-accuracy",
        message: "Estimated FPS appeared without an explicit Estimated FPS label.",
        taskIds: [...observation.failedTaskIds],
      });
    }
    if (claim.kind === "specsmith-score" && normalizedLabel.includes("measured") && normalizedLabel.includes("fps")) {
      addIssue(issues, {
        code: "score-mislabeled-as-measured-fps",
        severity: "critical",
        dimension: "factual-accuracy",
        message: "A SpecSmith internal score was presented as measured game FPS.",
        taskIds: [...observation.failedTaskIds],
      });
    }
    if (claim.kind === "measured-fps" && (claim.verification !== "verified" || claim.evidenceRefs.length === 0)) {
      addIssue(issues, {
        code: "measured-fps-without-evidence",
        severity: "critical",
        dimension: "factual-accuracy",
        message: "Measured FPS requires verified benchmark evidence before publication.",
        taskIds: [...observation.failedTaskIds],
      });
    }
  }

  if (observation.missingRequiredFacts.length > 0) {
    addIssue(issues, {
      code: "missing-required-facts",
      severity: "error",
      dimension: "factual-accuracy",
      message: `Required facts are missing from the render review: ${observation.missingRequiredFacts.join(", ")}`,
      taskIds: [...observation.failedTaskIds],
    });
  }

  const unknownMissing = observation.missingRequiredFacts.filter((fact) => !request.requiredFacts.includes(fact));
  if (unknownMissing.length > 0) {
    addIssue(issues, {
      code: "review-input-mismatch",
      severity: "error",
      dimension: "factual-accuracy",
      message: `Reviewer reported missing facts that were not in the package contract: ${unknownMissing.join(", ")}`,
      taskIds: [],
    });
  }
}

export function reviewRenderedVideo(
  request: QualityReviewRequest,
  observation: RenderedVideoObservation,
): QualityReviewResult {
  if (request.packageId !== observation.packageId || request.platform !== observation.platform) {
    throw new Error(`Observation does not match review request ${request.packageId}/${request.platform}`);
  }

  const issues: ReviewIssue[] = [];
  checkClaims(request, observation, issues);

  for (const uiShot of observation.uiShots) {
    if (uiShot.presentedAsRealSpecSmithUi && uiShot.source !== "deterministic") {
      addIssue(issues, {
        code: "fake-specsmith-ui",
        severity: "critical",
        dimension: "product-integrity",
        message: "Generated or unknown UI was presented as real SpecSmith UI.",
        taskIds: uiShot.taskId ? [uiShot.taskId] : [],
      });
    }
  }

  if (observation.observedCtaRoute !== request.expectedRoute) {
    addIssue(issues, {
      code: "wrong-cta-route",
      severity: "critical",
      dimension: "cta-accuracy",
      message: `CTA route ${observation.observedCtaRoute || "<missing>"} does not match ${request.expectedRoute}.`,
      taskIds: taskIdsForCapability(request, "cta").concat(taskIdsForCapability(request, "compose")),
    });
  }

  if (!observation.openingDecisionClearWithoutAudio) {
    addIssue(issues, {
      code: "unclear-opening",
      severity: "error",
      dimension: "hook-clarity",
      message: "The first two seconds do not make the decision/conflict understandable without audio.",
      taskIds: request.expectedTaskIds.filter((taskId) => taskId.includes("beat-1-visual")),
    });
  }

  if (observation.captionsLegibilityScore < 8 || observation.captionSafeAreaRatio < 0.95) {
    addIssue(issues, {
      code: "caption-quality",
      severity: "error",
      dimension: "caption-readability",
      message: "Captions are not consistently readable or inside safe areas.",
      taskIds: taskIdsForCapability(request, "captions"),
    });
  }

  if (observation.audioClarityScore < 8) {
    addIssue(issues, {
      code: "audio-clarity",
      severity: "error",
      dimension: "audio-quality",
      message: "Narration/audio clarity is below the publish threshold.",
      taskIds: taskIdsForCapability(request, "voice").concat(taskIdsForCapability(request, "audio"), taskIdsForCapability(request, "compose")),
    });
  }

  if (observation.visualCoherenceScore < 8) {
    addIssue(issues, {
      code: "visual-coherence",
      severity: "error",
      dimension: "visual-quality",
      message: "Visual continuity or composition is below the publish threshold.",
      taskIds: [...observation.failedTaskIds],
    });
  }

  if (observation.pacingScore < 8) {
    addIssue(issues, {
      code: "weak-pacing",
      severity: "error",
      dimension: "pacing-retention",
      message: "Pacing does not meet the retention-oriented publish threshold.",
      taskIds: taskIdsForCapability(request, "compose"),
    });
  }

  if (observation.specSmithRelevanceScore < 9) {
    addIssue(issues, {
      code: "weak-specsmith-relevance",
      severity: "error",
      dimension: "specsmith-relevance",
      message: "SpecSmith is not essential enough to the final video.",
      taskIds: [...observation.failedTaskIds],
    });
  }

  if (observation.genericAiBrollRatio > 0.6) {
    addIssue(issues, {
      code: "ai-slop-dominant",
      severity: "critical",
      dimension: "visual-quality",
      message: "Generic AI B-roll dominates the video; rebuild the visual concept instead of patching it.",
      taskIds: [...observation.failedTaskIds],
    });
  } else if (observation.genericAiBrollRatio > 0.35) {
    addIssue(issues, {
      code: "too-much-generic-ai-broll",
      severity: "error",
      dimension: "visual-quality",
      message: "Too much of the render is generic AI B-roll rather than purposeful product-led visuals.",
      taskIds: [...observation.failedTaskIds],
    });
  }

  const durationDelta = Math.abs(observation.durationSeconds - request.targetDurationSeconds);
  if (durationDelta > 3) {
    addIssue(issues, {
      code: "duration-drift",
      severity: "warning",
      dimension: "pacing-retention",
      message: `Render duration is ${round(durationDelta)}s away from the storyboard target.`,
      taskIds: taskIdsForCapability(request, "compose"),
    });
  }

  const factualScore = issues.some((issue) => issue.dimension === "factual-accuracy" && issue.severity === "critical")
    ? 0
    : issues.some((issue) => issue.dimension === "factual-accuracy" && issue.severity === "error") ? 5 : 10;
  const integrityScore = issues.some((issue) => issue.dimension === "product-integrity") ? 0 : 10;
  const ctaScore = observation.observedCtaRoute === request.expectedRoute ? 10 : 0;
  const hookScore = observation.openingDecisionClearWithoutAudio ? 10 : 5;
  const captionScore = clamp10(Math.min(observation.captionsLegibilityScore, observation.captionSafeAreaRatio * 10));
  const visualScore = clamp10(observation.visualCoherenceScore - Math.max(0, observation.genericAiBrollRatio - 0.2) * 5);

  const dimensionScores: Record<ReviewDimension, number> = {
    "factual-accuracy": factualScore,
    "product-integrity": integrityScore,
    "hook-clarity": hookScore,
    "visual-quality": round(visualScore),
    "caption-readability": round(captionScore),
    "audio-quality": round(clamp10(observation.audioClarityScore)),
    "pacing-retention": round(clamp10(observation.pacingScore)),
    "specsmith-relevance": round(clamp10(observation.specSmithRelevanceScore)),
    "cta-accuracy": ctaScore,
  };

  const overallScore = round(
    dimensionScores["factual-accuracy"] * 0.20 +
    dimensionScores["product-integrity"] * 0.12 +
    dimensionScores["hook-clarity"] * 0.12 +
    dimensionScores["visual-quality"] * 0.12 +
    dimensionScores["caption-readability"] * 0.06 +
    dimensionScores["audio-quality"] * 0.08 +
    dimensionScores["pacing-retention"] * 0.10 +
    dimensionScores["specsmith-relevance"] * 0.12 +
    dimensionScores["cta-accuracy"] * 0.08,
  );

  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const hasUncertainFacts = issues.some((issue) => issue.code === "unverified-claim" || issue.code === "missing-claim-evidence" || issue.code === "missing-required-facts" || issue.code === "review-input-mismatch");
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const targetedTaskIds = [...new Set(issues.flatMap((issue) => issue.taskIds).filter(Boolean))];
  const canTargetRepair = errorIssues.length > 0 && errorIssues.every((issue) => issue.taskIds.length > 0);

  let decision: ReviewDecision;
  if (hasUncertainFacts && !hasCritical) {
    decision = "hold-for-human-review";
  } else if (hasCritical) {
    decision = "regenerate-full";
  } else if (errorIssues.length > 0 || overallScore < 8.5) {
    decision = canTargetRepair ? "regenerate-targeted" : "regenerate-full";
  } else {
    decision = "pass";
  }

  return {
    packageId: request.packageId,
    platform: request.platform,
    decision,
    publishable: decision === "pass",
    overallScore,
    dimensionScores,
    issues,
    regenerateTaskIds: decision === "regenerate-targeted" ? targetedTaskIds : [],
  };
}
