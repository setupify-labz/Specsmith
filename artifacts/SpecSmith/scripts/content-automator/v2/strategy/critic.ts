// The adversarial strategic critic, and research escalation.
//
// WHY STRATEGY NEEDS A CRITIC AIMED AT ITSELF
// -------------------------------------------
// MASTER #2's adversarial checks are aimed at evidence: is this claim true
// enough to say? This one is aimed at the strategy's own reasoning: is this
// actually an opportunity, or a topic with a justification written after the
// fact? Those fail differently. A strategy layer with good evidence and bad
// reasoning produces impeccably-sourced videos about nothing anyone asked for.
//
// The questions below are the ones a sceptical Head of Content would ask, and
// each is answered from stored state rather than from prose. "Are we calling
// this a trend?" is answerable by looking at whether a trend source exists.
//
// HOW ESCALATION WORKS
// --------------------
// When strategy wants to act and cannot because evidence is missing, it does not
// lower its bar — it emits a ResearchRequest naming the exact claim and the
// exact evidence quality that would unblock it. That is the channel by which
// MASTER #3 talks back to MASTER #2, and it is the only sanctioned response to
// missing evidence.

import { createHash } from "node:crypto";

import type { ClaimKind } from "../research/model.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { StrategicOpportunity } from "./model.ts";
import type { PriorityAssessment } from "./priority.ts";

export type ChallengeCode =
  | "trend-without-trend-source"
  | "topic-not-opportunity"
  | "manufactured-urgency"
  | "not-specsmith-relevant"
  | "forced-product-cta"
  | "evidence-too-weak"
  | "reach-over-trust"
  | "repeats-recent-content"
  | "anyone-could-make-this"
  | "optimising-unmeasured-assumption"
  | "could-mislead-a-buyer"
  | "simpler-opportunity-exists";

export interface Challenge {
  readonly code: ChallengeCode;
  /** True when this challenge alone should stop the mission. */
  readonly fatal: boolean;
  readonly question: string;
  readonly finding: string;
}

export interface CriticInput {
  readonly opportunity: StrategicOpportunity;
  readonly assessment: PriorityAssessment;
  readonly contract: ResearchCreativeContract;
  /** The other opportunities in this pass, for the "simpler option" question. */
  readonly siblings: readonly { readonly opportunityId: string; readonly assessment: PriorityAssessment }[];
}

/**
 * Challenges an opportunity before it becomes a mission.
 *
 * Every finding is derived from stored state. Nothing here is a judgment call
 * written in prose and then asserted — which is exactly the failure mode a
 * "critic" module is most likely to have.
 */
export function challengeOpportunity(input: CriticInput): Challenge[] {
  const { opportunity, assessment, contract, siblings } = input;
  const challenges: Challenge[] = [];

  // Is something being called a trend with no trend source connected?
  if (opportunity.trend === "unknown" && (opportunity.whyNow === "time-sensitive" || opportunity.whyNow === "recently-emerging")) {
    challenges.push({
      code: "trend-without-trend-source", fatal: true,
      question: "Are we calling this timely without trend evidence?",
      finding: "whyNow claims emergence while trend state is unknown. No trend collector is connected, so emergence would be asserted rather than observed.",
    });
  }

  // Is this an opportunity, or a topic with a story attached?
  const unmeasured = assessment.dimensions.filter((dimension) => !dimension.measured).length;
  if (unmeasured >= assessment.dimensions.length - 2) {
    challenges.push({
      code: "topic-not-opportunity", fatal: false,
      question: "Is this a real opportunity or just a topic?",
      finding: `${unmeasured} of ${assessment.dimensions.length} dimensions are unmeasured. The case for this rests almost entirely on things nobody has observed.`,
    });
  }

  if (opportunity.whyNow === "insufficient-evidence") {
    challenges.push({
      code: "manufactured-urgency", fatal: true,
      question: "Is the urgency manufactured?",
      finding: opportunity.whyNowReason,
    });
  }

  // Is SpecSmith the right publisher, or would any tech account do?
  if (opportunity.productSurface === null) {
    challenges.push({
      code: "anyone-could-make-this", fatal: false,
      question: "Could a generic tech creator make this equally well?",
      finding: "This pillar demonstrates no SpecSmith surface, so the content has no structural advantage over any other publisher's version.",
    });
  }

  // Is the CTA honest?
  if (opportunity.productSurface !== null && opportunity.productReadiness !== "shipped") {
    challenges.push({
      code: "forced-product-cta", fatal: true,
      question: "Is the product CTA forced?",
      finding: `The ${opportunity.productSurface} surface is ${opportunity.productReadiness}. Pointing an audience at it would promise something that is not shipped.`,
    });
  }

  if (contract.safeClaims.length === 0) {
    challenges.push({
      code: "evidence-too-weak", fatal: true,
      question: "Is the evidence strong enough to say anything at all?",
      finding: "The research contract approved zero claims. There is nothing this piece could assert.",
    });
  }

  // Is reach being bought with trust?
  const reachObjectives = new Set(["acquire-new-users", "shareable-comparison"]);
  if (reachObjectives.has(opportunity.primaryObjective) && opportunity.evidenceState !== "strongly-supported" && opportunity.evidenceState !== "known") {
    challenges.push({
      code: "reach-over-trust", fatal: false,
      question: "Are we chasing reach at the cost of trust?",
      finding: `Primary objective is ${opportunity.primaryObjective} while the evidence is only ${opportunity.evidenceState}. Reach-led content on thin evidence is the trade that costs most later.`,
    });
  }

  if (assessment.vetoes.some((veto) => veto.code === "duplicate-of-recent" || veto.code === "cannibalises-existing")) {
    challenges.push({
      code: "repeats-recent-content", fatal: true,
      question: "Are we repeating ourselves?",
      finding: assessment.vetoes.filter((v) => v.code === "duplicate-of-recent" || v.code === "cannibalises-existing").map((v) => v.detail).join(" "),
    });
  }

  // Is the objective one nobody can measure?
  const measurability = assessment.dimensions.find((dimension) => dimension.name === "objective-measurability");
  if (measurability && !measurability.measured) {
    challenges.push({
      code: "optimising-unmeasured-assumption", fatal: false,
      question: "Are we optimising for something we cannot observe?",
      finding: measurability.reason,
    });
  }

  if (opportunity.risks.some((risk) => risk.code === "misleading-buyer-advice")) {
    challenges.push({
      code: "could-mislead-a-buyer", fatal: true,
      question: "Could this cost a viewer money?",
      finding: opportunity.risks.find((risk) => risk.code === "misleading-buyer-advice")!.detail,
    });
  }

  // Is there a cleaner opportunity sitting right there?
  const better = siblings.find(
    (sibling) =>
      sibling.opportunityId !== opportunity.opportunityId &&
      sibling.assessment.vetoes.length === 0 &&
      sibling.assessment.dimensions.filter((d) => d.band === "strong").length >
        assessment.dimensions.filter((d) => d.band === "strong").length,
  );
  if (better) {
    challenges.push({
      code: "simpler-opportunity-exists", fatal: false,
      question: "Is there a higher-value opportunity available right now?",
      finding: `${better.opportunityId} has more strong dimensions and no vetoes. Producing this one first would be a choice, not a default.`,
    });
  }

  return challenges;
}

/** Whether the critic's findings should stop the mission. */
export function criticBlocks(challenges: readonly Challenge[]): boolean {
  return challenges.some((challenge) => challenge.fatal);
}

/** A counterfactual, to test whether the decision is actually load-bearing. */
export interface Counterfactual {
  readonly question: string;
  readonly answer: string;
  /** True when the answer reveals the decision is fragile. */
  readonly revealsFragility: boolean;
}

/**
 * Asks what would change the decision.
 *
 * Counterfactuals are marked as reasoning, never stored as observations — the
 * brief is explicit that they must not be mistaken for evidence, and the type
 * name is doing that work.
 */
export function exploreCounterfactuals(
  opportunity: StrategicOpportunity,
  assessment: PriorityAssessment,
): Counterfactual[] {
  const out: Counterfactual[] = [];

  out.push({
    question: "What changes if we wait a month?",
    answer: opportunity.expiresAt === null
      ? "Nothing: this opportunity does not expire, so waiting costs only the delay itself."
      : `The opportunity expires at ${opportunity.expiresAt}, so waiting forfeits it entirely.`,
    revealsFragility: opportunity.expiresAt !== null,
  });

  out.push({
    question: "What if the evidence weakens?",
    answer: opportunity.evidenceState === "strongly-supported" || opportunity.evidenceState === "known"
      ? "The whole piece becomes unpublishable: every permitted claim traces to this evidence, and the gate would refuse the script."
      : `The evidence is already ${opportunity.evidenceState}; it has no room to weaken further before this is unusable.`,
    revealsFragility: true,
  });

  out.push({
    question: "What if the product surface is not ready?",
    answer: opportunity.productSurface === null
      ? "No change: this content has no product connection to lose."
      : opportunity.productReadiness === "shipped"
        ? `The CTA to ${opportunity.productSurface} would have to be removed, and the piece would still stand as an explainer.`
        : `Already the case: the surface is ${opportunity.productReadiness} and no CTA may be made.`,
    revealsFragility: opportunity.productSurface !== null && opportunity.productReadiness !== "shipped",
  });

  out.push({
    question: "What if there is no social trend behind this?",
    answer: opportunity.trend === "unknown"
      ? "Already the case. Nothing in this decision rests on a trend, which is why it is not framed as timely."
      : `The observed trend is ${opportunity.trend}; removing it would drop the why-now case back to the pillar's default.`,
    revealsFragility: false,
  });

  out.push({
    question: "What if this angle already exists elsewhere?",
    answer: opportunity.competitorCoverage === "unknown"
      ? "Unknown, and unknowable without a competitor survey. The decision therefore does not claim whitespace."
      : `Competitor coverage is ${opportunity.competitorCoverage}.`,
    revealsFragility: opportunity.competitorCoverage === "crowded",
  });

  void assessment;
  return out;
}

/** Exactly what MASTER #2 would need to find to unblock this. */
export interface ResearchRequest {
  readonly requestId: string;
  readonly forOpportunityId: string;
  /** The specific claim that must be established. */
  readonly claim: string;
  readonly claimKind: ClaimKind;
  /** What would satisfy it. Named so the request is actionable, not a wish. */
  readonly requiredSourceQuality: string;
  readonly freshnessRequirement: string;
  readonly applicabilityRequirement: string;
  readonly acceptableEvidenceTypes: readonly string[];
  /** Why closing this gap is worth the effort. */
  readonly strategicValue: string;
  /** Whether it can be closed at all today. */
  readonly obtainableNow: boolean;
  readonly obtainabilityNote: string;
}

const EVIDENCE_EXPECTATIONS: Partial<Record<ClaimKind, { quality: string; freshness: string; types: readonly string[] }>> = {
  "current-price": {
    quality: "An exact retailer listing for the exact SKU, retrieved directly.",
    freshness: "Observed within six hours; a price claim is stale within a day.",
    types: ["retailer-listing"],
  },
  "performance-measured": {
    quality: "Two independent benchmarks that publish their method, on the desktop part, at the stated settings.",
    freshness: "On the current game version and driver; a version mismatch invalidates it regardless of age.",
    types: ["independent-benchmark", "independent-review", "first-party-specsmith"],
  },
  comparison: {
    quality: "Independent measurement of both subjects under one configuration.",
    freshness: "Same game version and driver for both sides.",
    types: ["independent-benchmark", "independent-review"],
  },
  specification: {
    quality: "Manufacturer documentation for the exact SKU, read directly.",
    freshness: "Timeless for a shipped product.",
    types: ["manufacturer-documentation"],
  },
  "misconception-exists": {
    quality: "Observed instances of the belief being expressed, from a community source.",
    freshness: "Within six months.",
    types: ["community-discussion"],
  },
  compatibility: {
    quality: "Manufacturer documentation or SpecSmith's own deterministic check.",
    freshness: "Timeless.",
    types: ["manufacturer-documentation", "first-party-specsmith"],
  },
};

/**
 * Turns a blocked opportunity into a precise research request.
 *
 * `obtainableNow` is the honest half: most of these cannot be closed today,
 * because there is no web access and no community collector. Saying so is what
 * makes the request a real queue entry rather than a task nobody can start.
 */
export function escalateToResearch(
  opportunity: StrategicOpportunity,
  contract: ResearchCreativeContract,
  claimKind: ClaimKind,
  /**
   * The proposition this opportunity actually depends on.
   *
   * Supplied rather than looked up: an earlier version took
   * `contract.unsafeClaims[0]`, so every request named whichever claim happened
   * to be first and a reader could not tell which gap belonged to which
   * opportunity.
   */
  claimProposition: string,
): ResearchRequest | null {
  const blocking = opportunity.risks.filter((risk) => risk.blocking && risk.code.startsWith("evidence"));
  if (blocking.length === 0) return null;

  const unsafe = contract.unsafeClaims.find((claim) => claim.proposition === claimProposition)
    ?? contract.disputedClaims.find((claim) => claim.proposition === claimProposition);
  const expectation = EVIDENCE_EXPECTATIONS[claimKind] ?? {
    quality: "A source well-suited to this kind of claim, read directly.",
    freshness: "Current for this claim kind.",
    types: ["independent-review"],
  };

  // Everything except SpecSmith's own state needs a source SpecSmith cannot reach.
  const firstPartyOnly = expectation.types.every((type) => type === "first-party-specsmith");

  return {
    // Identity is the GAP, not the opportunity: two opportunities blocked on
    // the same missing evidence are one research task.
    requestId: `research-req-${claimKind}-${createHash("sha256").update(claimProposition.toLowerCase()).digest("hex").slice(0, 12)}`,
    forOpportunityId: opportunity.opportunityId,
    claim: unsafe?.proposition ?? claimProposition,
    claimKind,
    requiredSourceQuality: expectation.quality,
    freshnessRequirement: expectation.freshness,
    applicabilityRequirement: "Evidence must be about the exact configuration the claim describes: desktop part, stated resolution and preset, matching SKU where the claim names one.",
    acceptableEvidenceTypes: expectation.types,
    strategicValue: `Closing this would move ${opportunity.opportunityId} from ${blocking[0].code} to producible. ${opportunity.problem}`,
    obtainableNow: firstPartyOnly,
    obtainabilityNote: firstPartyOnly
      ? "Satisfiable from SpecSmith's own catalogue and deterministic output without any external source."
      : "Not satisfiable today: this needs an external source, and the repository has no autonomous web access and no connected research provider. It must arrive through the MASTER #2 ingestion boundary.",
  };
}

/**
 * Whether further research is justified for this opportunity.
 *
 * Research is not free even at $0 — it costs attention and, where a connector
 * exists, metered quota. A low-value opportunity with a huge evidence gap is not
 * worth escalating; it is worth dropping.
 */
export function researchWorthPursuing(
  opportunity: StrategicOpportunity,
  request: ResearchRequest,
): { readonly pursue: boolean; readonly reason: string } {
  if (!request.obtainableNow) {
    return {
      pursue: false,
      reason: `Queued but not actionable: ${request.obtainabilityNote}`,
    };
  }
  const audienceUnknown = opportunity.communityPain === "unknown" && opportunity.searchDemand === "unknown";
  if (audienceUnknown && opportunity.productSurface === null) {
    return {
      pursue: false,
      reason: "No observed audience need and no product connection: closing this gap would not change any decision worth making.",
    };
  }
  return {
    pursue: true,
    reason: `Worth pursuing: ${opportunity.productSurface !== null ? `it would unblock content demonstrating the ${opportunity.productSurface} surface` : "an audience signal shows the question is asked"}, and the evidence is obtainable from first-party state.`,
  };
}
