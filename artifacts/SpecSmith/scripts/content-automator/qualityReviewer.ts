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

/**
 * How audioClarityScore below was actually produced.
 *
 * "listened-full" is the only method that can certify intelligibility,
 * pronunciation, synchronization with the visuals, or truncation — a human
 * or Claude genuinely played the exact SHA-256-bound master start to finish.
 * "signal-analysis-only" means only mechanical signal statistics (e.g.
 * ffmpeg silencedetect/volumedetect) were checked: those prove the audio
 * track is present and at a healthy level, not that anyone could understand
 * it. "not-reviewed" means no audio assessment happened at all. Only
 * "listened-full" may back a passing audio-quality verdict — see the
 * fail-closed check in reviewRenderedVideo.
 */
export type AudioReviewMethod = "listened-full" | "signal-analysis-only" | "not-reviewed";

export interface RenderedVideoObservation {
  packageId: string;
  platform: VideoPlatform;
  /**
   * SHA-256 of the exact master file that was watched to produce this
   * observation. Every judgement below is about these bytes and no others.
   */
  masterSha256: string;
  durationSeconds: number;
  openingDecisionClearWithoutAudio: boolean;
  captionsLegibilityScore: number;
  captionSafeAreaRatio: number;
  audioClarityScore: number;
  audioReviewMethod: AudioReviewMethod;
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
  /**
   * The master this verdict applies to, carried through from the observation.
   *
   * A review is a statement about specific bytes. Surfacing the hash on the
   * result is what lets the publishing gate prove the file it is about to
   * schedule is the one that was actually reviewed, instead of trusting a
   * hash the caller passes alongside.
   */
  reviewedMediaSha256: string;
  decision: ReviewDecision;
  publishable: boolean;
  overallScore: number;
  dimensionScores: Record<ReviewDimension, number>;
  issues: ReviewIssue[];
  regenerateTaskIds: string[];
}

function requireSha256(value: string, field: string): string {
  const digest = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${field} must be a 64-character SHA-256 hex digest.`);
  return digest;
}

/**
 * A committed, versioned record of a genuine one-time human/Claude visual
 * inspection of one exact render's bytes: the sha256 of the render that was
 * actually watched, alongside the observation that inspection produced.
 *
 * This exists because `RenderedVideoObservation.masterSha256` is entirely
 * self-reported by whatever code constructs the observation — nothing in
 * `reviewRenderedVideo` on its own proves the scores/claims in that
 * observation were ever produced by watching those specific bytes. A
 * `RecordedRenderEvidence` is the external anchor: it must be committed to
 * the repository (not generated at run time) so its content is a durable,
 * reviewable record of a real inspection, independent of whatever the render
 * pipeline produces on any later run.
 */
export interface RecordedRenderEvidence {
  /** sha256 of the exact master file that was actually watched. */
  masterSha256: string;
  /** Who performed the inspection this evidence records (e.g. "claude-code-manual-review"). */
  reviewedBy: string;
  /** ISO 8601 timestamp of the inspection. */
  reviewedAt: string;
  /** Free-form notes about what was inspected and found. */
  notes: string[];
  /** The observation that inspection produced. */
  observation: RenderedVideoObservation;
}

export type RenderEvidenceMatch =
  | { matched: true; observation: RenderedVideoObservation }
  | { matched: false; reason: string };

/**
 * Binds a freshly-rendered master's actual sha256 to a committed,
 * previously-recorded evidence file before its observation may be trusted.
 *
 * This is the fail-closed gate blocker #2 requires: a hardcoded
 * `RenderedVideoObservation` in a script is not evidence of anything about
 * whatever bytes get rendered on a later run — only a match between THIS
 * run's actual sha256 and a committed record's sha256 is. If the render this
 * run produced is not the exact bytes that were actually inspected to
 * produce `evidence.observation`, this returns `matched: false` and the
 * caller must stop before treating the review as a pass.
 */
export function matchRenderToRecordedEvidence(
  actualMasterSha256: string,
  evidence: RecordedRenderEvidence,
): RenderEvidenceMatch {
  const actual = requireSha256(actualMasterSha256, "actualMasterSha256");
  const recorded = requireSha256(evidence.masterSha256, "evidence.masterSha256");
  const observed = requireSha256(evidence.observation.masterSha256, "evidence.observation.masterSha256");

  if (recorded !== observed) {
    return {
      matched: false,
      reason: `Evidence record is internally inconsistent: its masterSha256 (${recorded}) does not match its own observation.masterSha256 (${observed}).`,
    };
  }
  if (actual !== recorded) {
    return {
      matched: false,
      reason: `This run's rendered master (sha256 ${actual}) does not match the committed evidence record (sha256 ${recorded}). This render has no matching evidence of having actually been inspected — it is awaiting review and not publishable.`,
    };
  }
  return { matched: true, observation: evidence.observation };
}

export class RecordedRenderEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordedRenderEvidenceError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structurally validates a parsed evidence JSON file before it is trusted.
 * Fails closed on anything malformed rather than letting a broken record
 * silently pass through as `undefined` fields.
 */
export function parseRecordedRenderEvidence(input: unknown): RecordedRenderEvidence {
  if (!input || typeof input !== "object") {
    throw new RecordedRenderEvidenceError("Recorded render evidence must be an object.");
  }
  const raw = input as Record<string, unknown>;
  if (!isNonEmptyString(raw.masterSha256)) {
    throw new RecordedRenderEvidenceError("Recorded render evidence is missing masterSha256.");
  }
  if (!isNonEmptyString(raw.reviewedBy)) {
    throw new RecordedRenderEvidenceError("Recorded render evidence is missing reviewedBy.");
  }
  if (!isNonEmptyString(raw.reviewedAt)) {
    throw new RecordedRenderEvidenceError("Recorded render evidence is missing reviewedAt.");
  }
  if (!Array.isArray(raw.notes) || !raw.notes.every((entry) => typeof entry === "string")) {
    throw new RecordedRenderEvidenceError("Recorded render evidence notes must be an array of strings.");
  }
  if (!raw.observation || typeof raw.observation !== "object") {
    throw new RecordedRenderEvidenceError("Recorded render evidence is missing an observation.");
  }
  const observation = raw.observation as Record<string, unknown>;
  if (!isNonEmptyString(observation.masterSha256)) {
    throw new RecordedRenderEvidenceError("Recorded render evidence's observation is missing masterSha256.");
  }
  return {
    masterSha256: requireSha256(raw.masterSha256, "evidence.masterSha256"),
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
    notes: raw.notes as string[],
    observation: raw.observation as RenderedVideoObservation,
  };
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

  if (observation.audioReviewMethod !== "listened-full") {
    addIssue(issues, {
      code: "audio-not-genuinely-reviewed",
      severity: "error",
      dimension: "audio-quality",
      message: `audioClarityScore is not backed by a genuine end-to-end listen (audioReviewMethod: ${observation.audioReviewMethod}). Signal statistics alone cannot certify intelligibility, pronunciation, synchronization, or truncation — a passing audio verdict requires someone to have actually listened to these exact bytes.`,
      taskIds: [],
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
  const hasUncertainFacts = issues.some((issue) => issue.code === "unverified-claim" || issue.code === "missing-claim-evidence" || issue.code === "missing-required-facts" || issue.code === "review-input-mismatch" || issue.code === "audio-not-genuinely-reviewed");
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
    reviewedMediaSha256: requireSha256(observation.masterSha256, "observation.masterSha256"),
    decision,
    publishable: decision === "pass",
    overallScore,
    dimensionScores,
    issues,
    regenerateTaskIds: decision === "regenerate-targeted" ? targetedTaskIds : [],
  };
}
