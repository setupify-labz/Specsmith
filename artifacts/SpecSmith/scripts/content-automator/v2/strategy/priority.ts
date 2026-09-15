// Priority: which opportunity wins, and why.
//
// WHY THIS IS NOT A WEIGHTED AVERAGE
// ----------------------------------
// A weighted average has one fatal property: everything is tradeable against
// everything else. A high enough reach score buys its way past weak evidence, a
// strong product fit buys its way past a stale price, and a big commission buys
// its way past bad advice. Each of those is a real failure and all three come
// from the same design choice.
//
// So the model has two stages that cannot be blurred:
//
//   1. VETOES. Any blocking risk refuses the opportunity outright. There is no
//      score high enough to survive one, because the thing being refused is not
//      "a weak bet" but "a claim SpecSmith cannot make".
//   2. DIMENSIONS. Only opportunities that survive stage 1 are ranked, and they
//      are ranked on interpretable bands with the reasons attached.
//
// WHY BANDS, NOT A FLOAT
// ----------------------
// `priority = 87.493` implies measurement precision that none of these inputs
// have. Most of the dimensions here are `unknown` in the current repository.
// Bands say what is actually known; a float would launder ignorance into
// apparent rigour.
//
// THE COMMERCIAL GUARD
// --------------------
// Commercial intent is allowed to be a dimension and is explicitly forbidden
// from being a tiebreaker. `affiliate-intent-traffic` cannot raise a band, and
// an opportunity whose ONLY strength is commercial is refused. That is a
// deliberate asymmetry, not an oversight: commission is the one input whose
// interests are not the viewer's.

import {
  objectiveProfile,
  PRODUCING_ACTIONS,
  type StrategicAction,
  type StrategicOpportunity,
  type StrategicRisk,
} from "./model.ts";
import { opportunityFreshness } from "./opportunity.ts";
import type {
  CannibalizationFinding,
  DuplicationFinding,
  NoveltyFinding,
  SaturationFinding,
} from "./portfolio.ts";

/** An interpretable band. `unknown` is a distinct value, never a low score. */
export type Band = "strong" | "moderate" | "weak" | "unknown";

const BAND_VALUE: Record<Band, number> = { strong: 3, moderate: 2, weak: 1, unknown: 0 };

export interface Dimension {
  readonly name: string;
  readonly band: Band;
  readonly reason: string;
  /** False when the band reflects a real gap rather than a real assessment. */
  readonly measured: boolean;
}

export type PriorityTier =
  | "produce-now"
  | "produce-next"
  | "backlog"
  | "hold"
  | "reject";

export interface Tradeoff {
  readonly strongestUpside: string;
  readonly majorDownside: string;
  readonly tension: string;
  readonly resolution: string;
}

export interface PriorityAssessment {
  readonly opportunityId: string;
  readonly tier: PriorityTier;
  readonly action: StrategicAction;
  readonly dimensions: readonly Dimension[];
  /** Vetoes that fired. Non-empty means the tier is `reject` or `hold`. */
  readonly vetoes: readonly StrategicRisk[];
  readonly tradeoffs: readonly Tradeoff[];
  /** The plain-language case. This is the output a human actually reads. */
  readonly reasonsToAct: readonly string[];
  readonly reasonsNotToAct: readonly string[];
  readonly explanation: string;
}

export interface PriorityInput {
  readonly opportunity: StrategicOpportunity;
  readonly duplication: DuplicationFinding;
  readonly saturation: SaturationFinding;
  readonly novelty: NoveltyFinding;
  readonly cannibalization: CannibalizationFinding;
  readonly now: Date;
}

/**
 * Objectives whose pursuit must never by itself justify production.
 *
 * Commission is a consequence of good advice, not a reason for it. An
 * opportunity whose only strong dimension is commercial is refused below.
 */
const COMMERCIAL_OBJECTIVES = new Set(["affiliate-intent-traffic"]);

export function assessPriority(input: PriorityInput): PriorityAssessment {
  const { opportunity, duplication, saturation, novelty, cannibalization, now } = input;
  const dimensions: Dimension[] = [];
  const reasonsToAct: string[] = [];
  const reasonsNotToAct: string[] = [];
  const tradeoffs: Tradeoff[] = [];

  // ---- STAGE 1: VETOES ------------------------------------------------------
  const vetoes = opportunity.risks.filter((risk) => risk.blocking);

  const freshness = opportunityFreshness(opportunity, now);
  if (freshness.status === "expired") {
    vetoes.push({ code: "duplicate-of-recent", blocking: true, detail: `Opportunity has expired. ${freshness.reason}` });
  }
  if (duplication.verdict === "same-thesis") {
    vetoes.push({ code: "duplicate-of-recent", blocking: true, detail: duplication.reason });
  }
  if (cannibalization.verdict === "adds-little") {
    vetoes.push({ code: "cannibalises-existing", blocking: true, detail: cannibalization.reason });
  }
  if (opportunity.resourcePosture === "blocked-without-paid") {
    vetoes.push({ code: "excessive-production-cost", blocking: true, detail: "Cannot be produced without paid access, and the Content OS operates at zero incremental spend." });
  }

  // ---- STAGE 2: DIMENSIONS -------------------------------------------------
  const evidenceBand: Band =
    opportunity.evidenceState === "known" || opportunity.evidenceState === "strongly-supported" ? "strong"
      : opportunity.evidenceState === "likely" ? "moderate"
        : opportunity.evidenceState === "unknown" ? "unknown" : "weak";
  dimensions.push({
    name: "evidence-strength", band: evidenceBand, measured: opportunity.evidenceState !== "unknown",
    reason: `MASTER #2 rated the underlying claim ${opportunity.evidenceState}.`,
  });
  if (evidenceBand === "strong") reasonsToAct.push("The factual basis is established and current.");
  else reasonsNotToAct.push(`The factual basis is ${opportunity.evidenceState}.`);

  const productBand: Band =
    opportunity.productSurface === null ? "weak"
      : opportunity.productReadiness === "shipped" ? "strong" : "unknown";
  dimensions.push({
    name: "product-fit", band: productBand, measured: opportunity.productSurface !== null,
    reason: opportunity.productSurface === null
      ? "This pillar demonstrates no SpecSmith surface."
      : `The ${opportunity.productSurface} surface is ${opportunity.productReadiness}.`,
  });
  if (productBand === "strong") reasonsToAct.push(`Naturally demonstrates the ${opportunity.productSurface} surface, which is shipped.`);

  const urgencyBand: Band =
    opportunity.whyNow === "time-sensitive" || opportunity.whyNow === "recently-emerging" ? "strong"
      : opportunity.whyNow === "temporarily-relevant" ? "moderate"
        : opportunity.whyNow === "evergreen" ? "moderate"
          : "unknown";
  dimensions.push({
    name: "why-now", band: urgencyBand,
    measured: opportunity.whyNow !== "unknown" && opportunity.whyNow !== "insufficient-evidence",
    reason: opportunity.whyNowReason,
  });
  if (opportunity.whyNow === "evergreen") reasonsToAct.push("Evergreen: it can be produced whenever there is capacity, and it does not decay.");
  if (opportunity.whyNow === "insufficient-evidence") reasonsNotToAct.push("Nothing observed supports acting now rather than later.");

  const demandBand: Band =
    opportunity.communityPain === "widespread" ? "strong"
      : opportunity.communityPain === "occasional" ? "moderate"
        : opportunity.searchDemand === "high" ? "strong"
          : opportunity.searchDemand === "moderate" ? "moderate"
            : "unknown";
  dimensions.push({
    name: "audience-demand", band: demandBand,
    measured: opportunity.communityPain !== "unknown" || opportunity.searchDemand !== "unknown",
    reason: `Community pain: ${opportunity.communityPain}. Search demand: ${opportunity.searchDemand}.`,
  });
  if (demandBand === "unknown") reasonsNotToAct.push("No connected signal shows an audience asking for this.");

  const differentiationBand: Band =
    opportunity.competitorCoverage === "whitespace" ? "strong"
      : opportunity.competitorCoverage === "mixed" ? "moderate"
        : opportunity.competitorCoverage === "crowded" ? "weak" : "unknown";
  dimensions.push({
    name: "differentiation", band: differentiationBand, measured: opportunity.competitorCoverage !== "unknown",
    reason: `Competitor coverage: ${opportunity.competitorCoverage}.`,
  });

  const noveltyBand: Band = novelty.isNovel ? "strong" : duplication.verdict === "unknown" ? "unknown" : "weak";
  dimensions.push({ name: "novelty", band: noveltyBand, measured: duplication.verdict !== "unknown", reason: novelty.reason });
  if (noveltyBand === "weak") reasonsNotToAct.push(novelty.reason);

  const saturationBand: Band =
    saturation.verdict === "fresh" ? "strong"
      : saturation.verdict === "warm" ? "moderate"
        : saturation.verdict === "saturated" ? "weak" : "unknown";
  dimensions.push({ name: "portfolio-room", band: saturationBand, measured: saturation.verdict !== "unknown", reason: saturation.reason });
  if (saturation.verdict === "saturated") reasonsNotToAct.push(saturation.reason);

  const feasibilityBand: Band = opportunity.resourcePosture === "local-free" ? "strong"
    : opportunity.resourcePosture === "free-tier-helpful" || opportunity.resourcePosture === "quota-consuming" ? "moderate"
      : "weak";
  dimensions.push({
    name: "feasibility", band: feasibilityBand, measured: true,
    reason: `Resource posture is ${opportunity.resourcePosture}.`,
  });
  if (opportunity.resourcePosture === "local-free") reasonsToAct.push("Producible entirely with local free tooling.");

  const profile = objectiveProfile(opportunity.primaryObjective);
  dimensions.push({
    name: "objective-measurability",
    band: profile.measurability === "first-party-available" ? "strong" : "unknown",
    measured: profile.measurability === "first-party-available",
    reason: `${opportunity.primaryObjective} is ${profile.measurability}. ${profile.why}`,
  });
  if (profile.measurability !== "first-party-available") {
    reasonsNotToAct.push(`Success against ${opportunity.primaryObjective} could not be measured even after publishing (${profile.measurability}).`);
  }

  // ---- THE COMMERCIAL GUARD ------------------------------------------------
  // Checked as a rule rather than as a weight, so no amount of commercial
  // upside can substitute for user value.
  const commercialOnly =
    COMMERCIAL_OBJECTIVES.has(opportunity.primaryObjective) &&
    evidenceBand !== "strong" &&
    demandBand === "unknown";
  if (commercialOnly) {
    vetoes.push({
      code: "commercial-bias",
      blocking: true,
      detail: "The only case for this opportunity is commercial intent: the evidence is not strong and no audience demand is observed. Commission is never a sufficient reason to publish.",
    });
  }

  // ---- TRADEOFFS -----------------------------------------------------------
  for (const tension of profile.tensions) {
    if (opportunity.secondaryObjectives.includes(tension)) {
      tradeoffs.push({
        strongestUpside: `Serves ${opportunity.primaryObjective}.`,
        majorDownside: `Pulls against ${tension}, which it also claims to serve.`,
        tension: objectiveProfile(tension).why,
        resolution: `Primary objective ${opportunity.primaryObjective} governs; ${tension} must not be used to justify weakening it.`,
      });
    }
  }
  if (COMMERCIAL_OBJECTIVES.has(opportunity.primaryObjective) || opportunity.secondaryObjectives.some((entry) => COMMERCIAL_OBJECTIVES.has(entry))) {
    tradeoffs.push({
      strongestUpside: "Carries commercial intent, which funds the work.",
      majorDownside: "Commercial intent pulls against disinterested advice and against trust.",
      tension: "A recommendation that earns commission is indistinguishable, to the viewer, from one that does not — which is exactly why it must be evidence-led.",
      resolution: "Commercial value is recorded as a dimension and is never permitted to raise the tier or break a tie.",
    });
  }
  if (evidenceBand === "strong" && demandBand === "unknown") {
    tradeoffs.push({
      strongestUpside: "The claim is solid, so the content can be made safely.",
      majorDownside: "Nobody has shown that an audience wants it.",
      tension: "Publishing well-evidenced content nobody asked for is cheap but not free: it consumes the portfolio's attention.",
      resolution: "Acceptable for an evergreen backlog piece; not a reason to prioritise over a demonstrated need.",
    });
  }

  // ---- TIER ---------------------------------------------------------------
  const { tier, action, explanation } = deriveTier({
    vetoes, dimensions, opportunity, freshnessStatus: freshness.status,
    cannibalization, duplication, saturation,
  });

  return {
    opportunityId: opportunity.opportunityId,
    tier, action, dimensions, vetoes, tradeoffs,
    reasonsToAct, reasonsNotToAct,
    explanation,
  };
}

function deriveTier(input: {
  vetoes: readonly StrategicRisk[];
  dimensions: readonly Dimension[];
  opportunity: StrategicOpportunity;
  freshnessStatus: ReturnType<typeof opportunityFreshness>["status"];
  cannibalization: CannibalizationFinding;
  duplication: DuplicationFinding;
  saturation: SaturationFinding;
}): { tier: PriorityTier; action: StrategicAction; explanation: string } {
  // A veto is terminal. The only question is which kind of refusal it is, since
  // "we cannot say this yet" and "we will never say this" need different queues.
  if (input.vetoes.length > 0) {
    const codes = input.vetoes.map((veto) => veto.code);
    if (codes.includes("synthetic-evidence")) {
      return { tier: "reject", action: "reject-risk", explanation: `Refused: rests on engineering fixture data. ${input.vetoes.map((v) => v.detail).join(" ")}` };
    }
    if (codes.includes("product-not-ready")) {
      return { tier: "hold", action: "hold-for-product", explanation: `Held: ${input.vetoes.find((v) => v.code === "product-not-ready")!.detail}` };
    }
    if (codes.includes("evidence-insufficient") || codes.includes("evidence-stale") || codes.includes("evidence-disputed")) {
      return { tier: "hold", action: "hold-for-evidence", explanation: `Held for evidence: ${input.vetoes.filter((v) => v.code.startsWith("evidence")).map((v) => v.detail).join(" ")}` };
    }
    if (codes.includes("duplicate-of-recent")) {
      const expired = input.freshnessStatus === "expired";
      return expired
        ? { tier: "reject", action: "retire-stale", explanation: "Retired: the opportunity window has closed." }
        : { tier: "reject", action: "reject-duplicate", explanation: `Refused as a duplicate: ${input.duplication.reason}` };
    }
    if (codes.includes("cannibalises-existing")) {
      return { tier: "reject", action: "reject-duplicate", explanation: `Refused: ${input.cannibalization.reason}` };
    }
    if (codes.includes("commercial-bias")) {
      return { tier: "reject", action: "reject-risk", explanation: `Refused: ${input.vetoes.find((v) => v.code === "commercial-bias")!.detail}` };
    }
    if (codes.includes("manufactured-urgency") || codes.includes("manufactured-demand")) {
      return { tier: "hold", action: "hold-for-evidence", explanation: `Held: ${input.vetoes.map((v) => v.detail).join(" ")}` };
    }
    return { tier: "reject", action: "reject-risk", explanation: `Refused: ${input.vetoes.map((v) => v.detail).join(" ")}` };
  }

  const strong = input.dimensions.filter((dimension) => dimension.band === "strong").length;
  const unknowns = input.dimensions.filter((dimension) => !dimension.measured).length;
  const evidence = input.dimensions.find((dimension) => dimension.name === "evidence-strength")!;

  // Nothing is produced on evidence weaker than strong. This mirrors MASTER #2's
  // own rule rather than inventing a second, looser one.
  if (evidence.band !== "strong") {
    return {
      tier: "hold", action: "hold-for-evidence",
      explanation: `Held: no opportunity is produced on ${input.opportunity.evidenceState} evidence, whatever else is in its favour.`,
    };
  }

  if (input.saturation.verdict === "saturated") {
    return { tier: "backlog", action: "backlog-evergreen", explanation: `Sound, but the pillar is over-used right now: ${input.saturation.reason}` };
  }

  if (strong >= 4 && unknowns <= 3 && input.opportunity.whyNow !== "insufficient-evidence") {
    return {
      tier: "produce-now", action: "produce-now",
      explanation: `${strong} dimension(s) are strong, evidence is established, and nothing vetoes it.`,
    };
  }
  if (strong >= 3) {
    return { tier: "produce-next", action: "produce-next", explanation: `${strong} strong dimension(s) with ${unknowns} unmeasured; worth producing but not ahead of a clearer case.` };
  }
  return {
    tier: "backlog", action: "backlog-evergreen",
    explanation: `Evidence is sound but only ${strong} dimension(s) are strong and ${unknowns} are unmeasured; this belongs in the evergreen backlog rather than the front of the queue.`,
  };
}

/** Ranks assessments deterministically, best first. */
export function rankAssessments(assessments: readonly PriorityAssessment[]): PriorityAssessment[] {
  const TIER_ORDER: Record<PriorityTier, number> = { "produce-now": 4, "produce-next": 3, backlog: 2, hold: 1, reject: 0 };
  return [...assessments].sort((a, b) => {
    const tier = TIER_ORDER[b.tier] - TIER_ORDER[a.tier];
    if (tier !== 0) return tier;
    const score = (entry: PriorityAssessment) =>
      entry.dimensions.reduce((sum, dimension) => sum + BAND_VALUE[dimension.band], 0);
    const bands = score(b) - score(a);
    if (bands !== 0) return bands;
    const measured = b.dimensions.filter((d) => d.measured).length - a.dimensions.filter((d) => d.measured).length;
    if (measured !== 0) return measured;
    return a.opportunityId.localeCompare(b.opportunityId);
  });
}

/** Whether any assessment authorises production. */
export function anyProducible(assessments: readonly PriorityAssessment[]): boolean {
  return assessments.some((assessment) => PRODUCING_ACTIONS.includes(assessment.action));
}
