import { isIssuedRenderReceipt, type RenderReceipt } from "./motionCompositor.ts";
import { isIssuedListeningReview, type ListeningReview, type ListeningReviewRecord } from "./listeningReview.ts";
import { PRICE_FRESHNESS_MS } from "../../src/lib/retail/partPricing.ts";
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

/**
 * WHAT KIND OF NUMBER A PRICE ON SCREEN IS (#157). A closed set, one entry per
 * source of prices SpecSmith actually has:
 *
 *  - "retailer-observation": a merchant's listing read at a recorded instant.
 *    public/data/retail-parts.json carries exactly this for every listing
 *    (merchant, fetchedAt, salePrice/retailPrice). The ONLY kind that may be
 *    called live, real or current, and only while it is within the retail
 *    builder's own freshness window (PRICE_FRESHNESS_MS). It must name the
 *    retailer, when it was observed, and the evidence it came from.
 *  - "catalogue-estimate": SpecSmith's editorial figure, the `price_usd` in
 *    src/data/{gpus,cpus,components,peripherals}.json. The site shows these as
 *    "Est. $X" (src/lib/partPrice.ts); a video must label them the same way.
 *  - "fixture": a stand-in value from an offline or test render. It must say
 *    so on screen, and it never publishes.
 *
 * Deliberately NOT in the set: a manufacturer MSRP. No data source in this
 * repository records one, so there is nothing to justify the category; a claim
 * that says "MSRP" has no provenance here and is held, like any other price
 * whose provenance is missing. Add the kind together with its source.
 */
export const PRICE_PROVENANCE_KINDS = ["retailer-observation", "catalogue-estimate", "fixture"] as const;
export type PriceProvenanceKind = (typeof PRICE_PROVENANCE_KINDS)[number];

export type PriceProvenance =
  | {
      kind: "retailer-observation";
      /** The merchant whose listing was read. */
      retailer: string;
      /** ISO-8601 time the listing was read. */
      observedAt: string;
      /** The evidence the figure came from; must also be one of the claim's evidenceRefs. */
      evidenceRef: string;
    }
  | { kind: "catalogue-estimate" }
  | { kind: "fixture" };

export interface ObservedClaim {
  text: string;
  kind: ClaimKind;
  verification: "verified" | "unverified" | "contradicted";
  evidenceRefs: string[];
  /**
   * The words shown on screen with the claim. Wording rules are judged on this
   * label ONLY, never on `text`: `text` is the reviewer's description, which
   * may accurately say "not a live price" without the video saying anything.
   */
  displayLabel?: string;
  /** Required for every `kind: "price"` claim. Missing or unknown holds. */
  priceProvenance?: PriceProvenance;
}

export interface ObservedUiShot {
  source: "deterministic" | "generated" | "unknown";
  presentedAsRealSpecSmithUi: boolean;
  taskId?: string;
}

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
  /**
   * Digest of the compositor render receipt this review covers.
   *
   * Optional in the type because the QC evidence schema does not record it
   * yet; the publish gate REFUSES a review without it, so omitting it fails
   * closed rather than open.
   */
  reviewedReceiptDigest?: string;
  /**
   * The issued listening record for this master and receipt, when one was
   * supplied and bound. The publish gate re-checks it: it must be issued,
   * say "listened-full", and name the exact master and receipt.
   */
  audioReview?: ListeningReview;
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
  /**
   * How the audio was reviewed, when it was recorded. It is only a claim until
   * `recordListeningReview` binds it to the genuine receipt for this master;
   * absent means no one is recorded as having listened.
   */
  audioReview?: ListeningReviewRecord;
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
  // Only its shape is checked here. Whether it is a real listen to THESE
  // bytes is decided by recordListeningReview against the genuine receipt.
  if (raw.audioReview !== undefined && (raw.audioReview === null || typeof raw.audioReview !== "object")) {
    throw new RecordedRenderEvidenceError("Recorded render evidence audioReview must be an object when present.");
  }
  return {
    masterSha256: requireSha256(raw.masterSha256, "evidence.masterSha256"),
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
    notes: raw.notes as string[],
    observation: raw.observation as RenderedVideoObservation,
    ...(raw.audioReview === undefined ? {} : { audioReview: raw.audioReview as ListeningReviewRecord }),
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

/** Wording that tells a viewer a price is live. Judged on the on-screen label only. */
const LIVE_PRICE_WORDING = /\b(live|real|actual|current|currently|today'?s|up[- ]to[- ]date|right now)\b/i;
/** "Est. $499", "Estimated price", "SpecSmith estimate". */
const ESTIMATE_LABEL = /\best(?:\.|imated?\b)/i;
const FIXTURE_LABEL = /\b(fixture|sample|example|placeholder)\b/i;

const PRICE_ISSUE = (code: string, severity: ReviewSeverity, message: string, taskIds: string[]): ReviewIssue => ({
  code, severity, dimension: "factual-accuracy", message, taskIds,
});

/**
 * Fails closed on every price claim whose on-screen wording its provenance
 * does not support. Returns nothing; every problem becomes an issue.
 */
function checkPriceClaim(claim: ObservedClaim, now: Date, taskIds: string[], issues: ReviewIssue[]): void {
  const provenance = claim.priceProvenance as { kind?: unknown } | undefined;
  const label = claim.displayLabel ?? "";
  if (!provenance || typeof provenance !== "object"
      || !(PRICE_PROVENANCE_KINDS as readonly unknown[]).includes(provenance.kind)) {
    addIssue(issues, PRICE_ISSUE(
      "price-provenance-missing", "error",
      `Price claim has no known provenance (retailer observation, catalogue estimate or fixture); it cannot say what kind of number it is: ${claim.text}`,
      taskIds,
    ));
    return;
  }
  const live = LIVE_PRICE_WORDING.test(label);
  const known = claim.priceProvenance as PriceProvenance;

  if (known.kind === "retailer-observation") {
    const problems: string[] = [];
    if (!isNonEmptyString(known.retailer)) problems.push("no retailer");
    const observedAt = isNonEmptyString(known.observedAt) ? new Date(known.observedAt) : undefined;
    if (!observedAt || Number.isNaN(observedAt.getTime())) problems.push("no valid observation time");
    else if (observedAt.getTime() > now.getTime() + 60_000) problems.push("an observation time in the future");
    if (!isNonEmptyString(known.evidenceRef)) problems.push("no evidence reference");
    else if (!claim.evidenceRefs.includes(known.evidenceRef)) problems.push("an evidence reference the claim does not cite");
    if (problems.length > 0) {
      addIssue(issues, PRICE_ISSUE(
        "price-observation-incomplete", "error",
        `Retailer price observation has ${problems.join(", ")}: ${claim.text}`,
        taskIds,
      ));
    } else if (live && now.getTime() - (observedAt as Date).getTime() > PRICE_FRESHNESS_MS) {
      addIssue(issues, PRICE_ISSUE(
        "stale-price-presented-as-live", "critical",
        `"${label}" calls a price live, but ${known.retailer} was observed at ${known.observedAt}, outside the freshness window: ${claim.text}`,
        taskIds,
      ));
    }
    return;
  }

  // Everything below is not a retailer observation, so it may never be
  // described as live, real or current.
  if (live) {
    addIssue(issues, PRICE_ISSUE(
      "price-live-wording-not-observed", "critical",
      `"${label}" describes a ${known.kind} as live; only a verified retailer observation may be: ${claim.text}`,
      taskIds,
    ));
  }
  if (known.kind === "catalogue-estimate" && !ESTIMATE_LABEL.test(label)) {
    addIssue(issues, PRICE_ISSUE(
      "price-estimate-unlabeled", "critical",
      `A SpecSmith catalogue estimate appeared without an "Est." or "estimate" label: ${claim.text}`,
      taskIds,
    ));
  }
  if (known.kind === "fixture") {
    if (!FIXTURE_LABEL.test(label)) {
      addIssue(issues, PRICE_ISSUE(
        "price-fixture-unlabeled", "critical",
        `A fixture price appeared without saying it is a fixture or sample: ${claim.text}`,
        taskIds,
      ));
    }
    addIssue(issues, PRICE_ISSUE(
      "fixture-price", "critical",
      `A fixture price is a stand-in, not a price; it never publishes: ${claim.text}`,
      taskIds,
    ));
  }
}

function checkClaims(
  request: QualityReviewRequest,
  observation: RenderedVideoObservation,
  now: Date,
  issues: ReviewIssue[],
): void {
  for (const claim of observation.claims) {
    if (claim.kind === "price") checkPriceClaim(claim, now, [...observation.failedTaskIds], issues);

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

export interface ReviewOptions {
  /**
   * The issued listening record for this master, from recordListeningReview.
   * Without one, audio cannot pass: the review holds for a person to listen.
   */
  listeningReview?: ListeningReview;
  /** Clock injection for tests; judges price freshness and future dates. */
  now?: Date;
}

/**
 * Reviews an observed render.
 *
 * Pass the compositor's receipt for the master that was watched to bind the
 * verdict to it: the receipt must be a genuine compositor-issued receipt and
 * describe the exact master the observation names, and its digest is then
 * recorded as `reviewedReceiptDigest`. Without a receipt the result carries
 * none, and the publish gate refuses it — never a guessed or copied digest.
 *
 * Audio passes only with an issued listening record that says "listened-full"
 * for this receipt and master. A clarity score, or signal statistics, alone
 * hold for human review; they never pass.
 */
export function reviewRenderedVideo(
  request: QualityReviewRequest,
  observation: RenderedVideoObservation,
  renderReceipt?: RenderReceipt,
  options: ReviewOptions = {},
): QualityReviewResult {
  const now = options.now ?? new Date();
  const listening = options.listeningReview;
  if (listening !== undefined && !isIssuedListeningReview(listening)) {
    throw new Error(
      "Quality review was given a listening record recordListeningReview did not issue; a hand-written listen is not evidence.",
    );
  }
  if (request.packageId !== observation.packageId || request.platform !== observation.platform) {
    throw new Error(`Observation does not match review request ${request.packageId}/${request.platform}`);
  }
  let reviewedReceiptDigest: string | undefined;
  if (renderReceipt !== undefined) {
    if (!isIssuedRenderReceipt(renderReceipt)) {
      throw new Error("Quality review was given a render receipt the compositor did not issue.");
    }
    if (renderReceipt.masterSha256 !== requireSha256(observation.masterSha256, "observation.masterSha256")) {
      throw new Error(
        `The observed master ${observation.masterSha256} is not the receipt's master ${renderReceipt.masterSha256}; `
        + "a review cannot be bound to a render it did not watch.",
      );
    }
    reviewedReceiptDigest = renderReceipt.digest;
  }

  const issues: ReviewIssue[] = [];
  checkClaims(request, observation, now, issues);

  // HOW THE AUDIO WAS REVIEWED. A clarity score is not a listen.
  const audioTaskIds = taskIdsForCapability(request, "voice").concat(taskIdsForCapability(request, "audio"), taskIdsForCapability(request, "compose"));
  let audioReview: ListeningReview | undefined;
  if (listening === undefined) {
    addIssue(issues, {
      code: "audio-not-listened",
      severity: "error",
      dimension: "audio-quality",
      message:
        "No one is recorded as having listened to this exact master. A clarity score or signal statistics "
        + "(silence, volume, loudness) cannot certify intelligibility, pronunciation, sync or truncation.",
      taskIds: audioTaskIds,
    });
  } else if (listening.receiptDigest !== reviewedReceiptDigest) {
    // The receipt digest is the whole binding: recordListeningReview issued
    // this listen only for a receipt AND its master, and the observed master
    // was proven to be this receipt's master above. No receipt, no binding.
    addIssue(issues, {
      code: "stale-audio-review",
      severity: "error",
      dimension: "audio-quality",
      message:
        `The listening record covers master ${listening.masterSha256.slice(0, 16)}… / receipt ${listening.receiptDigest.slice(0, 16)}…, `
        + "not the master and receipt under review; a listen does not transfer between renders.",
      taskIds: audioTaskIds,
    });
  } else {
    audioReview = listening;
    if (listening.method !== "listened-full") {
      addIssue(issues, {
        code: "audio-not-listened",
        severity: "error",
        dimension: "audio-quality",
        message: `The audio was reviewed by "${listening.method}", not by listening to the whole master.`,
        taskIds: audioTaskIds,
      });
    }
  }

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
  // A person has to act on these; regenerating the render cannot fix them.
  const HUMAN_REVIEW_CODES = new Set([
    "unverified-claim", "missing-claim-evidence", "missing-required-facts", "review-input-mismatch",
    "price-provenance-missing", "price-observation-incomplete", "audio-not-listened", "stale-audio-review",
  ]);
  const hasUncertainFacts = issues.some((issue) => HUMAN_REVIEW_CODES.has(issue.code));
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
    ...(reviewedReceiptDigest === undefined ? {} : { reviewedReceiptDigest }),
    ...(audioReview === undefined ? {} : { audioReview }),
    decision,
    publishable: decision === "pass",
    overallScore,
    dimensionScores,
    issues,
    regenerateTaskIds: decision === "regenerate-targeted" ? targetedTaskIds : [],
  };
}
