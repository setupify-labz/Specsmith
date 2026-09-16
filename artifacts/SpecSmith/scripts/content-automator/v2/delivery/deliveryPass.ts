// MASTER #4 — The delivery pass (sections 30, 34, 37, 41, 42, 43).
//
// The orchestrator. Takes a mission MASTER #3 authorised, builds the audience
// snapshot, evaluates every platform, emits briefs for the platforms that can
// carry the truth, refuses the ones that cannot, and reports why in language a
// reviewer can argue with.
//
// Determinism: `now` is always an argument. Nothing here reads the clock, so
// the same inputs produce a byte-identical result including its hash.
//
// A pass that produces ZERO briefs is a successful pass. If no platform can
// carry this truth to this audience honestly, saying so is the right answer.

import { createHash } from "node:crypto";

import type { ContentMission } from "../strategy/contentMission.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { ResearchResult } from "../research/researchPass.ts";

import { buildAudienceProfile, assessAudienceFit, type AudienceFit } from "../audience/profile.ts";
import type { AudienceProfile } from "../audience/model.ts";
import type { AudienceHypothesis } from "../audience/hypotheses.ts";
import { proposeAudienceHypothesis } from "../audience/hypotheses.ts";
import type { AudienceSignalBundle } from "../audience/signals.ts";

import { PLATFORM_IDS, type PlatformId, type PlatformSnapshot } from "../platform/model.ts";
import { baselineSnapshots, postingTimeFor, trendFor } from "../platform/registry.ts";
import { refreshSnapshot } from "../platform/ingestion.ts";

import { assessAudiencePlatformFit, type AudiencePlatformFit } from "./fit.ts";
import {
  assertMissionPreserved,
  assertNoEvidenceUpgrade,
  extractTruthInvariant,
  type InvariantFinding,
  type TruthInvariant,
} from "./invariants.ts";
import { BriefRefusedError, buildPlatformBrief, type PlatformCreativeBrief } from "./brief.ts";
import { buildCrossPlatformPlan, type CrossPlatformPackagePlan } from "./crossPlatform.ts";

/** Why a pass produced no brief at all. Every value is a real outcome. */
export type DeliveryNoOpReason =
  | "no-mission-authorised"
  | "every-platform-refused"
  | "synthetic-input-refused"
  | "audience-ungrounded";

/**
 * A typed escalation back to MASTER #3 (section 34).
 *
 * MASTER #4 never rewrites a mission. When audience or platform analysis
 * exposes a strategic contradiction, it hands the contradiction back and stops.
 */
export interface StrategyEscalation {
  readonly code: string;
  readonly missionId: string;
  readonly contradiction: string;
  readonly whatStrategyMustDecide: string;
}

export interface PlatformOutcome {
  readonly platform: PlatformId;
  readonly fit: AudiencePlatformFit;
  readonly brief: PlatformCreativeBrief | null;
  readonly refusedBecause: string | null;
}

export interface DeliveryResult {
  readonly version: "delivery-result-v1";
  readonly runId: string;
  readonly missionId: string | null;
  readonly researchQuestionId: string;
  readonly strategyRunId: string;
  readonly startedAt: string;
  readonly completedAt: string;

  readonly audienceProfile: AudienceProfile | null;
  readonly audienceFit: AudienceFit | null;
  readonly hypotheses: readonly AudienceHypothesis[];
  readonly snapshots: readonly PlatformSnapshot[];
  readonly outcomes: readonly PlatformOutcome[];
  readonly briefs: readonly PlatformCreativeBrief[];
  readonly packagePlan: CrossPlatformPackagePlan | null;

  readonly invariant: TruthInvariant | null;
  readonly invariantFindings: readonly InvariantFinding[];
  readonly escalations: readonly StrategyEscalation[];

  readonly noOpReason: DeliveryNoOpReason | null;
  readonly containsSyntheticInput: boolean;
  readonly limitations: readonly string[];
  readonly resultHash: string;
}

export interface DeliveryPassInput {
  readonly runId: string;
  readonly strategyRunId: string;
  readonly mission: ContentMission | null;
  readonly contract: ResearchCreativeContract;
  readonly research: ResearchResult;
  readonly audienceSignals: AudienceSignalBundle;
  readonly platforms?: readonly PlatformId[];
  readonly startedAt: Date;
  readonly now: Date;
  readonly producedBy: string;
  /** Reused so analytics identity stays stable across the Content OS. */
  readonly creativeId: string;
}

/**
 * Run the pass.
 *
 * Note what happens with a null mission: the pass succeeds and produces
 * nothing. MASTER #3 deciding to publish nothing is not an error state for
 * MASTER #4 to work around.
 */
export function runDeliveryPass(input: DeliveryPassInput): DeliveryResult {
  const { mission, contract, research, now } = input;
  const platforms = input.platforms ?? PLATFORM_IDS;
  const synthetic = input.audienceSignals.provenance.synthetic;

  if (mission === null) {
    return emptyResult(input, "no-mission-authorised", [
      "MASTER #3 authorised no mission, so there is nothing to deliver. Producing a brief anyway would mean creating " +
        "content that strategy explicitly declined to approve.",
    ]);
  }

  const invariant = extractTruthInvariant(mission, contract, research);

  // MASTER #2 proof: whatever we are about to package must be claims research
  // approved. Checked before any brief is built, not after.
  const upgradeFindings = assertNoEvidenceUpgrade(contract, invariant.allowedClaims.map((claim) => claim.claimId));

  const hypotheses = proposeStandingHypotheses(mission, input.now, synthetic, input.producedBy);
  const profile = buildAudienceProfile({
    mission,
    contract,
    research,
    signals: input.audienceSignals,
    hypotheses,
    now,
    producedBy: input.producedBy,
  });
  const audienceFit = assessAudienceFit(profile, mission);

  const baselines = baselineSnapshots(now.toISOString());
  const snapshots = platforms.map((platform) => refreshSnapshot(baselines[platform], now));

  const outcomes: PlatformOutcome[] = [];
  const briefs: PlatformCreativeBrief[] = [];
  const invariantFindings: InvariantFinding[] = [...upgradeFindings];

  for (const snapshot of snapshots) {
    const fit = assessAudiencePlatformFit({
      mission,
      profile,
      audienceFit,
      invariant,
      snapshot,
      postingTime: postingTimeFor(snapshot.platform),
      trend: trendFor(snapshot.platform),
      now,
    });

    if (fit.verdict === "refuse") {
      outcomes.push({
        platform: snapshot.platform,
        fit,
        brief: null,
        refusedBecause: fit.refusals.map((reason) => `${reason.code}: ${reason.explanation}`).join(" "),
      });
      continue;
    }

    try {
      const brief = buildPlatformBrief({
        mission,
        invariant,
        profile,
        fit,
        snapshot,
        hypotheses,
        strategyRunId: input.strategyRunId,
        creativeId: input.creativeId,
        now,
        producedBy: input.producedBy,
      });

      // Every brief re-proves that it did not move the mission. The adaptation
      // is described from the brief itself, so this checks the artifact that
      // will actually be handed on rather than the intention behind it.
      const missionFindings = assertMissionPreserved(mission, {
        platform: brief.platform,
        objective: brief.objective,
        angleId: mission.angle.angleId,
        thesis: brief.thesis,
        permittedClaimIds: brief.allowedClaims.map((claim) => claim.claimId),
        forbiddenPropositions: brief.forbiddenClaims.map((claim) => claim.proposition),
        requiredWording: brief.requiredWording,
        productRoute: mission.productRoute,
        resourcePosture: mission.resourcePosture,
        successHypothesisId: mission.successHypothesisId,
      });
      invariantFindings.push(...missionFindings);

      briefs.push(brief);
      outcomes.push({ platform: snapshot.platform, fit, brief, refusedBecause: null });
    } catch (error) {
      if (!(error instanceof BriefRefusedError)) throw error;
      outcomes.push({ platform: snapshot.platform, fit, brief: null, refusedBecause: `${error.code}: ${error.message}` });
    }
  }

  const packagePlan = briefs.length > 0
    ? buildCrossPlatformPlan({ missionId: mission.missionId, invariant, briefs, fits: outcomes.map((o) => o.fit), now })
    : null;

  const noOpReason: DeliveryNoOpReason | null =
    briefs.length > 0 ? null : audienceFit.verdict === "ungrounded" ? "audience-ungrounded" : "every-platform-refused";

  const result: DeliveryResult = {
    version: "delivery-result-v1",
    runId: input.runId,
    missionId: mission.missionId,
    researchQuestionId: contract.questionId,
    strategyRunId: input.strategyRunId,
    startedAt: input.startedAt.toISOString(),
    completedAt: now.toISOString(),
    audienceProfile: profile,
    audienceFit,
    hypotheses,
    snapshots,
    outcomes,
    briefs,
    packagePlan,
    invariant,
    invariantFindings,
    escalations: detectEscalations(mission, profile, audienceFit, outcomes),
    noOpReason,
    containsSyntheticInput: synthetic,
    limitations: buildLimitations(profile, outcomes, synthetic),
    resultHash: "",
  };

  return { ...result, resultHash: hashResult(result) };
}

/**
 * The hypotheses this layer always holds, stated explicitly rather than
 * embedded silently in the pacing numbers.
 *
 * These are the beliefs the adaptation logic acts on. Writing them down as
 * falsifiable propositions is what lets MASTER #5 eventually test them instead
 * of inheriting them as unexamined constants.
 */
function proposeStandingHypotheses(
  mission: ContentMission,
  now: Date,
  synthetic: boolean,
  producedBy: string,
): readonly AudienceHypothesis[] {
  const hypotheses: AudienceHypothesis[] = [
    proposeAudienceHypothesis({
      hypothesisId: `hyp-early-payoff-${mission.missionId}`,
      proposition:
        "A beginner audience deciding between components understands the comparison faster when the result appears before the terminology that explains it.",
      whyBelieved:
        "The mission's own audience problem is a decision, and a decision-maker needs the outcome before the mechanism to know whether the mechanism matters to them.",
      uncertainty:
        "Untested. It is equally arguable that leading with an unexplained figure produces a number the viewer cannot interpret and therefore does not trust.",
      audienceScope: `Viewers matching this mission's audience level (${mission.audienceLevel}) on short-form vertical video.`,
      creativeImplication: "Order the opening so the result precedes the explanation of the mechanism.",
      falsificationCondition:
        "Retention or comprehension is no better for result-first cuts than for mechanism-first cuts across a matched set of creatives.",
      measurementRequirement:
        "Matched pairs of creatives differing only in opening order, with retention curves for both, which requires MASTER #5 and real published analytics.",
      now,
      synthetic,
      producedBy,
    }),
    proposeAudienceHypothesis({
      hypothesisId: `hyp-caveat-placement-${mission.missionId}`,
      proposition:
        "Attaching an estimate label visually to the figure retains more of its meaning than stating it only in narration.",
      whyBelieved:
        "Short-form viewers screenshot and re-share figures without their audio, so a spoken-only caveat does not travel with the number.",
      uncertainty: "Untested as a comprehension claim. The sharing behaviour is well known; the comprehension effect is not measured.",
      audienceScope: "Any audience receiving an estimated figure on a short-form vertical surface.",
      creativeImplication: "Place the estimate label in the same on-screen element as the figure rather than beside it in narration.",
      falsificationCondition:
        "Viewers shown the label only in narration describe the figure's status as accurately as those shown it on screen.",
      measurementRequirement:
        "A comprehension probe comparing on-screen and narration-only label placement, which this repository cannot run today.",
      now,
      synthetic,
      producedBy,
    }),
  ];
  return hypotheses;
}

/**
 * Contradictions that are Strategy's to resolve, not ours.
 *
 * Each one is a case where doing the obvious thing would mean quietly
 * overriding a MASTER #3 decision.
 */
function detectEscalations(
  mission: ContentMission,
  profile: AudienceProfile,
  audienceFit: AudienceFit,
  outcomes: readonly PlatformOutcome[],
): readonly StrategyEscalation[] {
  const escalations: StrategyEscalation[] = [];

  if (profile.segmentsConflict) {
    escalations.push({
      code: "audience-segments-conflict",
      missionId: mission.missionId,
      contradiction: profile.segmentConflictReason ?? "Two segments cannot share one creative.",
      whatStrategyMustDecide:
        "Whether this mission targets one segment or becomes two missions. MASTER #4 has scoped the brief to the primary " +
        "segment rather than splitting the mission itself, because deciding what a mission is for belongs to Strategy.",
    });
  }

  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.brief === null)) {
    escalations.push({
      code: "no-platform-can-carry-mission",
      missionId: mission.missionId,
      contradiction:
        "Every available platform was refused. The evidence this mission must carry cannot be delivered honestly on any " +
        "surface SpecSmith publishes to.",
      whatStrategyMustDecide:
        "Whether this belongs in a longer format, whether the evidence base should be strengthened first, or whether the " +
        "mission should be withdrawn. MASTER #4 will not produce a degraded version to keep the pipeline busy.",
    });
  }

  if (audienceFit.verdict === "weakly-grounded" && mission.productRoute !== null) {
    escalations.push({
      code: "commercial-intent-without-audience-grounding",
      missionId: mission.missionId,
      contradiction:
        "This mission points an audience toward a product surface, but who that audience is has not been established by any observation.",
      whatStrategyMustDecide:
        "Whether a commercial mission should proceed on an unobserved audience. MASTER #4 records the CTA as the mission " +
        "specified it and does not remove or strengthen it on its own judgment.",
    });
  }

  return escalations;
}

function buildLimitations(
  profile: AudienceProfile,
  outcomes: readonly PlatformOutcome[],
  synthetic: boolean,
): readonly string[] {
  const limitations = [...profile.limitations];
  if (synthetic) {
    limitations.push("This delivery pass rests on engineering fixture input and is not a production delivery decision.");
  }
  limitations.push(
    "No platform ranking, distribution or algorithm behaviour is modelled anywhere in this pass. Adaptations reflect what a " +
      "platform can structurally carry, never what it is believed to reward.",
  );
  limitations.push(
    "No analytics exist for any platform, so nothing in this pass has been validated against real performance. Every pacing " +
      "and placement recommendation is a hypothesis awaiting MASTER #5.",
  );
  const refused = outcomes.filter((outcome) => outcome.brief === null).length;
  if (refused > 0) {
    limitations.push(`${refused} platform(s) refused rather than served with a version that could not carry the evidence.`);
  }
  return limitations;
}

function emptyResult(
  input: DeliveryPassInput,
  reason: DeliveryNoOpReason,
  limitations: readonly string[],
): DeliveryResult {
  const result: DeliveryResult = {
    version: "delivery-result-v1",
    runId: input.runId,
    missionId: null,
    researchQuestionId: input.contract.questionId,
    strategyRunId: input.strategyRunId,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.now.toISOString(),
    audienceProfile: null,
    audienceFit: null,
    hypotheses: [],
    snapshots: [],
    outcomes: [],
    briefs: [],
    packagePlan: null,
    invariant: null,
    invariantFindings: [],
    escalations: [],
    noOpReason: reason,
    containsSyntheticInput: input.audienceSignals.provenance.synthetic,
    limitations,
    resultHash: "",
  };
  return { ...result, resultHash: hashResult(result) };
}

/** Stable hash over the decision-bearing fields, for idempotency checks. */
export function hashResult(result: DeliveryResult): string {
  const material = JSON.stringify({
    missionId: result.missionId,
    briefs: result.briefs.map((brief) => ({
      id: brief.briefId,
      platform: brief.platform,
      claims: brief.allowedClaims.map((claim) => claim.claimId),
      wording: brief.requiredWording,
      metadata: brief.metadata,
      depth: brief.explanationDepth,
    })),
    outcomes: result.outcomes.map((outcome) => ({ platform: outcome.platform, verdict: outcome.fit.verdict, refused: outcome.refusedBecause })),
    noOpReason: result.noOpReason,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/**
 * The zero-cost assertion (section 30).
 *
 * MASTER #4 adds no provider. This proves the delivery path reached its
 * conclusion without any paid access being required — and it is called by the
 * pipeline rather than merely being available.
 */
export function assertZeroCostDelivery(result: DeliveryResult): { readonly ok: boolean; readonly reason: string } {
  const paidPostures = result.briefs.filter((brief) => brief.provenance.producedBy.includes("paid"));
  if (paidPostures.length > 0) {
    return { ok: false, reason: `${paidPostures.length} brief(s) were produced by a paid path.` };
  }
  return {
    ok: true,
    reason:
      `${result.briefs.length} brief(s) produced with no provider call of any kind. Audience intelligence reads a local ` +
      "signal bundle, platform intelligence reads a local registry, and neither requires credentials, network access or quota.",
  };
}

export function formatDeliveryReport(result: DeliveryResult): string {
  const lines: string[] = [];
  lines.push(`DELIVERY RESULT — ${result.runId} (${result.resultHash})`);

  if (result.audienceProfile === null) {
    lines.push(`  no-op: ${result.noOpReason}`);
    for (const limitation of result.limitations) lines.push(`  limitation: ${limitation}`);
    return lines.join("\n");
  }

  const profile = result.audienceProfile;
  lines.push("  AUDIENCE");
  lines.push(`    expertise: ${profile.expertise.value ?? "unknown"} [${profile.expertise.state}] — ${profile.expertise.basis}`);
  lines.push(`    job: ${profile.job.value ?? "unknown"} [${profile.job.state}]`);
  lines.push(`    intent: ${profile.intent.value ?? "unknown"} [${profile.intent.state}]`);
  lines.push(`    readiness: ${profile.readiness.value ?? "unknown"} [${profile.readiness.state}]`);
  lines.push(`    demographics: unknown (no collector; not strategically relevant)`);
  lines.push(`    segments: ${profile.segments.length}${profile.segmentsConflict ? " — CONFLICT: " + profile.segmentConflictReason : ""}`);
  lines.push(`    audience fit: ${result.audienceFit?.verdict}`);
  for (const reason of result.audienceFit?.reasons ?? []) lines.push(`      ${reason}`);

  lines.push(`  AUDIENCE UNKNOWNS (${profile.unknowns.length})`);
  for (const unknown of profile.unknowns.slice(0, 5)) lines.push(`    ${unknown}`);

  lines.push(`  AUDIENCE HYPOTHESES (${result.hypotheses.length}, all untested)`);
  for (const hypothesis of result.hypotheses) {
    lines.push(`    [${hypothesis.status}] ${hypothesis.proposition}`);
    lines.push(`      falsified by: ${hypothesis.falsificationCondition}`);
  }

  lines.push("  PLATFORMS");
  for (const outcome of result.outcomes) {
    lines.push(`    ${outcome.platform}: ${outcome.fit.verdict}`);
    for (const reason of outcome.fit.reasons) lines.push(`      ${reason}`);
    for (const conflict of outcome.fit.conflicts) {
      lines.push(`      conflict ${conflict.code} -> ${conflict.resolution}: ${conflict.explanation}`);
    }
    if (outcome.refusedBecause !== null) lines.push(`      REFUSED: ${outcome.refusedBecause}`);
    lines.push(`      posting time: ${outcome.fit.postingTime.state} — ${outcome.fit.postingTime.state === "unknown" ? outcome.fit.postingTime.reason : ""}`);
    lines.push(`      trend: ${outcome.fit.trend.state}`);
  }

  lines.push(`  TRUTH INVARIANTS (${result.invariantFindings.length} finding(s))`);
  if (result.invariantFindings.length === 0) {
    lines.push("    All preserved: no claim was upgraded, no required wording dropped, no mission field changed.");
  } else {
    for (const finding of result.invariantFindings) lines.push(`    ${finding.severity} ${finding.code}: ${finding.message}`);
  }

  if (result.escalations.length > 0) {
    lines.push("  ESCALATIONS TO STRATEGY");
    for (const escalation of result.escalations) {
      lines.push(`    ${escalation.code}: ${escalation.contradiction}`);
      lines.push(`      strategy must decide: ${escalation.whatStrategyMustDecide}`);
    }
  }

  lines.push(`  BRIEFS PRODUCED: ${result.briefs.length}`);
  for (const limitation of result.limitations) lines.push(`  limitation: ${limitation}`);
  return lines.join("\n");
}
