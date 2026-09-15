// One strategy pass: research in, missions or a reasoned no-op out.
//
// THE WHOLE CHAIN, IN ORDER
// -------------------------
//   RESEARCH_RESULT -> opportunities -> portfolio checks -> priority (vetoes
//   first) -> adversarial critic -> counterfactuals -> hypothesis -> angle
//   -> CONTENT_MISSION, or a named refusal.
//
// THE OUTCOME THAT MATTERS MOST
// -----------------------------
// `no-strategic-opportunity` is a SUCCESSFUL result. A strategy system that must
// always name a winner will always name one, and the winner will sometimes be a
// video resting on a disputed claim about a product that is not shipped. The
// no-op path is therefore not an error branch — it is the expected outcome
// whenever the evidence, the product state and the signals do not line up, which
// today is most of the time.
//
// DETERMINISM
// -----------
// No clock is read: `now` is an argument. No network is touched. Ranking breaks
// ties on identity. The same input snapshot produces byte-identical output, and
// a test asserts it.

import { createHash } from "node:crypto";

import type { ResearchResult } from "../research/researchPass.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import {
  PRODUCING_ACTIONS,
  type StrategicOpportunity,
  type StrategyProvenance,
} from "./model.ts";
import { clusterOpportunities, detectOpportunities } from "./opportunity.ts";
import {
  assessBalance,
  assessNovelty,
  detectCannibalization,
  detectDuplication,
  detectSaturation,
  emptyPortfolioHistory,
  type PortfolioBalance,
  type PortfolioHistory,
} from "./portfolio.ts";
import { anyProducible, assessPriority, rankAssessments, type PriorityAssessment } from "./priority.ts";
import { buildContentMission, proposeAngles, type ContentMission, type StrategicAngle } from "./contentMission.ts";
import {
  challengeOpportunity,
  criticBlocks,
  escalateToResearch,
  exploreCounterfactuals,
  researchWorthPursuing,
  type Challenge,
  type Counterfactual,
  type ResearchRequest,
} from "./critic.ts";
import { HypothesisRegistry, proposeHypothesis, type StrategicHypothesis } from "./hypotheses.ts";
import { productReadinessFor, type SignalBundle } from "./signals.ts";

/** Why a pass produced nothing. Each is a different corrective action. */
export type NoOpReason =
  | "no-opportunities-detected"
  | "all-blocked-by-evidence"
  | "all-blocked-by-product-readiness"
  | "all-duplicates"
  | "all-rejected-by-critic"
  | "synthetic-input-refused";

export interface OpportunityDecision {
  readonly opportunity: StrategicOpportunity;
  readonly assessment: PriorityAssessment;
  readonly challenges: readonly Challenge[];
  readonly counterfactuals: readonly Counterfactual[];
  readonly anglesConsidered: readonly StrategicAngle[];
  readonly angleReason: string;
  readonly mission: ContentMission | null;
  readonly missionRefusedBecause: string | null;
  readonly researchRequest: ResearchRequest | null;
}

export interface StrategyResult {
  readonly version: "strategy-result-v1";
  readonly runId: string;
  /** The exact research pass this rests on. */
  readonly researchId: string;
  readonly researchStoppingReason: ResearchResult["stoppingReason"];
  readonly signalBundleId: string;
  readonly startedAt: string;
  readonly completedAt: string;

  readonly decisions: readonly OpportunityDecision[];
  /** Missions authorised, best first. Often empty, and that is correct. */
  readonly missions: readonly ContentMission[];
  readonly clusters: ReturnType<typeof clusterOpportunities>;
  readonly hypotheses: readonly StrategicHypothesis[];
  readonly researchRequests: readonly ResearchRequest[];
  readonly portfolioBalance: PortfolioBalance;

  /** Null when at least one mission was authorised. */
  readonly noOpReason: NoOpReason | null;
  readonly containsSyntheticInput: boolean;
  readonly limitations: readonly string[];
  /** Deterministic digest of the decision-relevant output. */
  readonly resultHash: string;
}

export interface StrategyPassInput {
  readonly runId: string;
  readonly research: ResearchResult;
  readonly contract: ResearchCreativeContract;
  readonly signals: SignalBundle;
  readonly history?: PortfolioHistory;
  readonly startedAt: Date;
  readonly now: Date;
  readonly provenance: StrategyProvenance;
}

export function runStrategyPass(input: StrategyPassInput): StrategyResult {
  const { research, contract, signals, now, provenance } = input;
  const history = input.history ?? emptyPortfolioHistory();

  const containsSyntheticInput = research.containsSyntheticEvidence || signals.provenance.synthetic || provenance.synthetic;

  const opportunities = detectOpportunities({ research, signals, now, provenance });

  // Pass one: assess every opportunity, so the critic can compare siblings.
  const assessments = new Map<string, PriorityAssessment>();
  for (const opportunity of opportunities) {
    const subjectIds = research.claims
      .filter((claim) => opportunity.dependsOnClaimIds.includes(claim.claimId))
      .flatMap((claim) => claim.subjectIds);
    const duplication = detectDuplication(opportunity, subjectIds, history);
    const saturation = detectSaturation(opportunity.pillar, history, now);
    const angles = proposeAngles(opportunity, contract);
    const novelty = assessNovelty(
      opportunity,
      {
        subjectIds,
        angleId: angles.chosen?.angleId ?? "none",
        formatClass: angles.chosen?.formatClass ?? "quick-explainer",
      },
      history,
    );
    const cannibalization = detectCannibalization(opportunity, subjectIds, history, novelty);
    assessments.set(
      opportunity.opportunityId,
      assessPriority({ opportunity, duplication, saturation, novelty, cannibalization, now }),
    );
  }

  const siblings = [...assessments.entries()].map(([opportunityId, assessment]) => ({ opportunityId, assessment }));
  const registry = new HypothesisRegistry();
  const decisions: OpportunityDecision[] = [];
  const researchRequests: ResearchRequest[] = [];

  for (const opportunity of opportunities) {
    const assessment = assessments.get(opportunity.opportunityId)!;
    const challenges = challengeOpportunity({ opportunity, assessment, contract, siblings });
    const counterfactuals = exploreCounterfactuals(opportunity, assessment);
    const angles = proposeAngles(opportunity, contract);

    const claim = research.claims.find((entry) => opportunity.dependsOnClaimIds.includes(entry.claimId));
    const request = claim ? escalateToResearch(opportunity, contract, claim.kind, claim.proposition) : null;
    if (request && !researchRequests.some((existing) => existing.requestId === request.requestId)) {
      const worth = researchWorthPursuing(opportunity, request);
      researchRequests.push({ ...request, strategicValue: `${request.strategicValue} ${worth.reason}` });
    }

    let mission: ContentMission | null = null;
    let refused: string | null = null;
    let hypothesis: StrategicHypothesis | null = null;

    if (!PRODUCING_ACTIONS.includes(assessment.action)) {
      refused = `Strategy resolved to ${assessment.action}. ${assessment.explanation}`;
    } else if (criticBlocks(challenges)) {
      refused = `The adversarial critic raised a fatal challenge: ${challenges.filter((entry) => entry.fatal).map((entry) => `${entry.code} — ${entry.finding}`).join(" ")}`;
    } else if (angles.chosen === null) {
      refused = angles.reason;
    } else {
      // The bet this mission makes, recorded before it is made rather than
      // reconstructed afterwards.
      hypothesis = registry.record(proposeHypothesis({
        proposition: `Publishing "${angles.chosen.thesis}" for ${opportunity.audienceLevel} viewers with the problem "${opportunity.problem}" will advance ${opportunity.primaryObjective}.`,
        expectedMechanism: `${angles.chosen.rationale} The viewer recognises their own problem, and ${opportunity.productSurface ? `the ${opportunity.productSurface} surface lets them continue with their own parts.` : "the explanation is self-contained."}`,
        audience: `${opportunity.audienceLevel} builders asking: ${opportunity.problem}`,
        objective: opportunity.primaryObjective,
        falsificationCriteria: `If published and measured, this is wrong if ${opportunity.primaryObjective} shows no movement relative to comparable pieces, or if viewers who see it are no more likely to reach ${opportunity.productSurface ?? "the site"} than those who do not.`,
        measurementRequirement: "Published performance data broken down by creative, which requires at least one real publication and an analytics window.",
        measurementAvailable: false,
        assumptions: [
          "The audience problem is real, which is unverified while no community signal is connected.",
          "The chosen angle communicates the thesis better than the alternatives, which is untested.",
        ],
        now,
        provenance,
      }));

      const product = productReadinessFor(signals, opportunity.productSurface);
      try {
        mission = buildContentMission({
          opportunity, assessment, contract,
          angle: angles.chosen,
          productRoute: product.route,
          hypothesisId: hypothesis.hypothesisId,
          now,
        });
      } catch (error) {
        refused = (error as Error).message;
      }
    }

    decisions.push({
      opportunity, assessment, challenges, counterfactuals,
      anglesConsidered: angles.considered,
      angleReason: angles.reason,
      mission, missionRefusedBecause: refused,
      researchRequest: request,
    });
  }

  const ranked = rankAssessments([...assessments.values()]);
  const missions = ranked
    .map((assessment) => decisions.find((decision) => decision.opportunity.opportunityId === assessment.opportunityId)?.mission)
    .filter((mission): mission is ContentMission => mission !== null && mission !== undefined);

  const limitations: string[] = [];
  if (containsSyntheticInput) {
    limitations.push("This pass rests on engineering fixture input and is not a production strategy result.");
  }
  if (!history.complete) limitations.push(history.note);
  if (signals.search.length === 0) limitations.push("No search data source is connected; search demand is unobserved throughout.");
  if (signals.trends.length === 0) limitations.push("No trend collector is connected; nothing in this pass may be described as trending.");
  if (signals.community.length === 0) limitations.push("No community collector is connected; audience need is unverified throughout.");
  if (signals.competitors.length === 0) limitations.push("No competitor survey exists; differentiation is unassessed throughout.");

  const result: Omit<StrategyResult, "resultHash"> = {
    version: "strategy-result-v1",
    runId: input.runId,
    researchId: research.researchId,
    researchStoppingReason: research.stoppingReason,
    signalBundleId: signals.bundleId,
    startedAt: input.startedAt.toISOString(),
    completedAt: now.toISOString(),
    decisions,
    missions,
    clusters: clusterOpportunities(opportunities),
    hypotheses: registry.all(),
    researchRequests,
    portfolioBalance: assessBalance(history),
    noOpReason: missions.length > 0 ? null : deriveNoOpReason(opportunities, [...assessments.values()], decisions, containsSyntheticInput),
    containsSyntheticInput,
    limitations,
  };

  return { ...result, resultHash: hashResult(result) };
}

/**
 * Names WHY nothing is being produced.
 *
 * "No opportunity" and "every opportunity is blocked on evidence" call for
 * completely different responses — the first means look elsewhere, the second
 * means go and research. Collapsing them into one silent empty list would lose
 * the only actionable part of a no-op.
 */
function deriveNoOpReason(
  opportunities: readonly StrategicOpportunity[],
  assessments: readonly PriorityAssessment[],
  decisions: readonly OpportunityDecision[],
  synthetic: boolean,
): NoOpReason {
  if (synthetic) return "synthetic-input-refused";
  if (opportunities.length === 0) return "no-opportunities-detected";

  const codes = assessments.flatMap((assessment) => assessment.vetoes.map((veto) => veto.code));
  if (codes.some((code) => code.startsWith("evidence"))) return "all-blocked-by-evidence";
  if (codes.includes("product-not-ready")) return "all-blocked-by-product-readiness";
  if (codes.includes("duplicate-of-recent") || codes.includes("cannibalises-existing")) return "all-duplicates";
  if (decisions.some((decision) => criticBlocks(decision.challenges))) return "all-rejected-by-critic";
  return "all-blocked-by-evidence";
}

/** Deterministic identity over the decision-relevant fields. */
function hashResult(result: Omit<StrategyResult, "resultHash">): string {
  const material = JSON.stringify({
    researchId: result.researchId,
    signalBundleId: result.signalBundleId,
    decisions: result.decisions.map((decision) => ({
      opportunityId: decision.opportunity.opportunityId,
      action: decision.assessment.action,
      tier: decision.assessment.tier,
      missionId: decision.mission?.missionId ?? null,
      challenges: decision.challenges.map((challenge) => challenge.code).sort(),
    })),
    noOpReason: result.noOpReason,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Whether the strategy core needs anything paid.
 *
 * Asserted rather than claimed: the strategy modules contain no HTTP client, no
 * credential read, and no provider import, and a test greps for exactly that.
 */
export function assertZeroCostCore(result: StrategyResult): { readonly ok: boolean; readonly reason: string } {
  const paid = result.decisions.filter((decision) => decision.opportunity.resourcePosture === "blocked-without-paid");
  if (paid.length > 0) {
    return {
      ok: false,
      reason: `${paid.length} opportunity/opportunities require paid access: ${paid.map((decision) => decision.opportunity.opportunityId).join(", ")}.`,
    };
  }
  const producedByPaid = result.missions.filter((mission) => mission.resourcePosture === "blocked-without-paid");
  if (producedByPaid.length > 0) {
    return { ok: false, reason: `${producedByPaid.length} authorised mission(s) require paid access.` };
  }
  return {
    ok: true,
    reason: `${result.missions.length} authorised mission(s), none requiring paid access; every producible posture is local-free.`,
  };
}

/** The human-readable strategy report. */
export function formatStrategyReport(result: StrategyResult): string {
  const lines: string[] = [];
  lines.push(`CONTENT_STRATEGY_REPORT ${result.runId}`);
  lines.push(`  research pass:   ${result.researchId} (stopped: ${result.researchStoppingReason})`);
  lines.push(`  signals:         ${result.signalBundleId}`);
  lines.push(`  opportunities:   ${result.decisions.length}`);
  lines.push(`  result hash:     ${result.resultHash}`);
  if (result.containsSyntheticInput) lines.push("  SYNTHETIC:       this pass rests on engineering fixture input and is not production strategy");

  if (result.noOpReason) {
    lines.push("");
    lines.push(`  DECISION: PRODUCE NOTHING (${result.noOpReason})`);
    lines.push("  This is a successful strategic outcome, not a failure to find ideas.");
  } else {
    lines.push("");
    lines.push(`  DECISION: ${result.missions.length} mission(s) authorised`);
    for (const mission of result.missions) {
      lines.push(`    ${mission.missionId}: ${mission.angle.name} — ${mission.primaryObjective}`);
      lines.push(`      because: ${mission.whyThisDeservesProduction}`);
    }
  }

  const ranked = rankAssessments(result.decisions.map((decision) => decision.assessment));
  lines.push("");
  lines.push("  PER-OPPORTUNITY");
  for (const assessment of ranked) {
    const decision = result.decisions.find((entry) => entry.opportunity.opportunityId === assessment.opportunityId)!;
    lines.push(`    [${assessment.tier}] ${decision.opportunity.problem}`);
    lines.push(`      pillar ${decision.opportunity.pillar}, objective ${decision.opportunity.primaryObjective}, why-now ${decision.opportunity.whyNow}`);
    lines.push(`      ${assessment.explanation}`);
    for (const veto of assessment.vetoes) lines.push(`      VETO ${veto.code}: ${veto.detail}`);
    for (const reason of assessment.reasonsToAct) lines.push(`      + ${reason}`);
    for (const reason of assessment.reasonsNotToAct) lines.push(`      - ${reason}`);
    for (const challenge of decision.challenges) {
      lines.push(`      ${challenge.fatal ? "FATAL" : "challenge"} ${challenge.code}: ${challenge.finding}`);
    }
    for (const tradeoff of assessment.tradeoffs) {
      lines.push(`      tradeoff: ${tradeoff.strongestUpside} BUT ${tradeoff.majorDownside} -> ${tradeoff.resolution}`);
    }
    if (decision.missionRefusedBecause) lines.push(`      no mission: ${decision.missionRefusedBecause}`);
  }

  if (result.researchRequests.length > 0) {
    lines.push("");
    lines.push("  RESEARCH NEEDED");
    for (const request of result.researchRequests) {
      lines.push(`    ${request.claim}`);
      lines.push(`      needs: ${request.requiredSourceQuality}`);
      lines.push(`      fresh: ${request.freshnessRequirement}`);
      lines.push(`      obtainable now: ${request.obtainableNow} — ${request.obtainabilityNote}`);
    }
  }

  if (result.hypotheses.length > 0) {
    lines.push("");
    lines.push("  STRATEGIC HYPOTHESES (untested until performance data exists)");
    for (const hypothesis of result.hypotheses) {
      lines.push(`    [${hypothesis.status}] ${hypothesis.proposition}`);
      lines.push(`      falsified if: ${hypothesis.falsificationCriteria}`);
    }
  }

  lines.push("");
  lines.push(`  PORTFOLIO: ${result.portfolioBalance.note}`);
  for (const limitation of result.limitations) lines.push(`  limitation: ${limitation}`);
  return lines.join("\n");
}
