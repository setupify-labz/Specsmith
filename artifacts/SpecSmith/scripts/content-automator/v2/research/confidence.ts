// Confidence, derived from evidence rather than from how sure a model sounds.
//
// THE RULE THAT SHAPES THIS FILE
// -------------------------------
// Every confidence state here is reachable only by a stated path through real
// evidence properties, and every one carries the reasons that produced it plus
// what would change it. That is the difference between a system that can say
//
//   "likely — two independent benchmarks agree, but both predate the current
//    patch, so a post-patch measurement would settle it"
//
// and one that says `confidence: 0.72`. The first can be argued with by
// someone who knows more than the system does. The second cannot.
//
// WHAT CANNOT HAPPEN HERE
// ------------------------
//   - unknown never becomes 0
//   - missing evidence never becomes false
//   - absence of contradiction never becomes proof
//   - a conflict never averages into a confident middle
//
// Those four are the ways a research system manufactures certainty, and each
// one is refused explicitly below rather than merely not implemented.

import {
  CLAIM_RISK_ORDER,
  type AtomicClaim,
  type ClaimEvidenceLink,
  type ConfidenceAssessment,
  type Conflict,
  type Corroboration,
  type EpistemicState,
  type SourceAssessment,
} from "./model.ts";
import { weakestApplicability } from "./evidence.ts";

/**
 * How many independent origins a claim needs before it can be stated plainly.
 *
 * Risk drives this, not kind: one manufacturer page is enough for a VRAM
 * figure, and one enthusiast's number is not enough for "this card is faster".
 */
const REQUIRED_INDEPENDENT_ORIGINS: Record<AtomicClaim["risk"], number> = { low: 1, medium: 1, high: 2 };

export interface ConfidenceInput {
  readonly claim: AtomicClaim;
  readonly links: readonly ClaimEvidenceLink[];
  readonly assessments: readonly SourceAssessment[];
  readonly corroboration: Corroboration;
  readonly conflict: Conflict | null;
}

/**
 * Produces the epistemic state for one claim.
 *
 * The order of the checks below is the substance: each early return is a
 * condition that DOMINATES everything after it. An unresolved conflict makes a
 * claim disputed no matter how authoritative its sources are, because "two good
 * sources disagree" is not improved by both being good.
 */
export function assessConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const { claim, links, assessments, corroboration, conflict } = input;
  const drivers: string[] = [];
  const detractors: string[] = [];
  const wouldChangeIfs: string[] = [];

  const supporting = links.filter((link) => link.stance === "supports");
  const contradicting = links.filter((link) => link.stance === "contradicts");

  // 1. No evidence at all. Not false, not zero — unknown.
  if (links.length === 0) {
    return {
      state: "unknown",
      drivers: [],
      detractors: ["No evidence of any kind has been linked to this claim."],
      wouldChangeIfs: [`Any observation bearing on "${claim.proposition}" would establish a first position.`],
    };
  }

  // 2. Evidence exists but none of it is about this. True, of something else.
  const applicable = supporting.filter((link) => link.applicability !== "not-applicable");
  if (supporting.length > 0 && applicable.length === 0) {
    return {
      state: "insufficient-evidence",
      drivers: [],
      detractors: [
        `All ${supporting.length} supporting observation(s) were judged not-applicable to this claim's configuration.`,
        ...supporting.flatMap((link) => link.applicabilityReasons),
      ],
      wouldChangeIfs: ["Evidence measured under this claim's own configuration would apply."],
    };
  }

  // 3. A real disagreement. Preserved, never averaged.
  if (conflict && !conflict.resolved) {
    return {
      state: "disputed",
      drivers: [`${corroboration.independentOriginCount} independent origin(s) have reported on this.`],
      detractors: [`Sources disagree: ${conflict.whatConflicts}`, "No configuration or date difference explains the disagreement."],
      wouldChangeIfs: [
        "A source that states its methodology, and whose configuration matches this claim, would break the tie.",
        "Discovering that the sources measured different configurations would resolve it as a non-conflict.",
      ],
    };
  }
  if (conflict?.resolved) {
    drivers.push(`An apparent conflict was resolved: ${conflict.resolutionReason}`);
  }

  // 4. Contradicted by applicable evidence.
  const applicableContradictions = contradicting.filter((link) => link.applicability !== "not-applicable");
  if (applicableContradictions.length > 0 && applicable.length === 0) {
    return {
      state: "strongly-supported",
      drivers: ["Applicable evidence contradicts this claim; its negation is what is supported."],
      detractors: [`${applicableContradictions.length} applicable observation(s) contradict it.`],
      wouldChangeIfs: ["Applicable supporting evidence would reopen the question."],
    };
  }
  if (applicableContradictions.length > 0) {
    detractors.push(`${applicableContradictions.length} applicable observation(s) contradict this claim.`);
  }

  // 5. Freshness. Stale is its own state: it is not absence, and it is not
  //    currency. Saying "stale" is more informative than either.
  const freshnesses = applicable.map((link) => link.freshness);
  const anyUsable = freshnesses.some((value) => value === "current" || value === "timeless");
  const allStale = freshnesses.length > 0 && freshnesses.every((value) => value === "stale" || value === "expired");
  if (allStale) {
    return {
      state: "stale",
      drivers: [`${applicable.length} applicable observation(s) exist.`],
      detractors: [
        "Every applicable observation is past its usable window for this kind of claim.",
        ...applicable.map((link) => link.freshnessReason),
      ],
      wouldChangeIfs: ["A fresh observation of the same kind would make this usable again."],
    };
  }
  if (!anyUsable) {
    detractors.push("No applicable observation is fully current; the best available evidence is aging.");
    wouldChangeIfs.push("A current observation would remove the age caveat.");
  } else {
    drivers.push("At least one applicable observation is current or timeless.");
  }

  // 6. Independence. Three retellings of one press release are one source.
  const required = REQUIRED_INDEPENDENT_ORIGINS[claim.risk];
  if (corroboration.independentOriginCount < required) {
    detractors.push(
      `${corroboration.independentOriginCount} independent origin(s) for a ${claim.risk}-risk claim, which needs ${required}. ${corroboration.reason}`,
    );
    wouldChangeIfs.push(`An observation from a genuinely independent ${required > 1 ? "second " : ""}origin would meet the bar.`);
  } else {
    drivers.push(corroboration.reason);
  }

  // 7. Source strength for this question.
  const strong = assessments.filter(
    (entry) => entry.relevanceToClaimKind === "high" && entry.authority !== "low" && entry.materialObserved,
  );
  if (strong.length > 0) drivers.push(`${strong.length} source(s) are both well-suited to this question and were read directly.`);
  const unread = assessments.filter((entry) => !entry.materialObserved);
  if (unread.length > 0) {
    detractors.push(`${unread.length} source(s) were never read directly; those are reports about a source, not the source.`);
    wouldChangeIfs.push("Fetching those sources directly would remove the second-hand caveat.");
  }
  const conflicted = assessments.filter((entry) => entry.conflictOfInterest === "likely");
  if (conflicted.length > 0) {
    detractors.push(`${conflicted.length} source(s) have a commercial interest in this answer.`);
    wouldChangeIfs.push("An independent test would settle whether the interested sources are right.");
  }

  // 8. Generalization beyond what was observed.
  const leaping = applicable.filter((link) => link.generalisesBeyondObservation);
  if (leaping.length > 0) {
    detractors.push(`${leaping.length} observation(s) support a narrower statement than this claim makes.`);
    wouldChangeIfs.push("Narrowing the claim to what was actually observed would remove this objection.");
  }

  const applicabilityFloor = weakestApplicability(applicable);
  if (applicabilityFloor === "weak" || applicabilityFloor === "unknown") {
    detractors.push(`The best evidence applies only ${applicabilityFloor}ly to this claim's configuration.`);
  }

  // The state itself. Deliberately conservative: detractors outweigh drivers,
  // because being wrong in public costs more than being vague.
  const state = deriveState({
    hasStrongSource: strong.length > 0,
    independentOrigins: corroboration.independentOriginCount,
    required,
    anyUsable,
    applicability: applicabilityFloor,
    detractorCount: detractors.length,
    risk: claim.risk,
  });

  if (wouldChangeIfs.length === 0) {
    wouldChangeIfs.push("A contradicting observation from an applicable, independent, current source would reopen this.");
  }

  return { state, drivers, detractors, wouldChangeIfs };
}

function deriveState(input: {
  hasStrongSource: boolean;
  independentOrigins: number;
  required: number;
  anyUsable: boolean;
  applicability: ReturnType<typeof weakestApplicability>;
  detractorCount: number;
  risk: AtomicClaim["risk"];
}): EpistemicState {
  const meetsIndependence = input.independentOrigins >= input.required;
  const exactly = input.applicability === "exact";

  if (input.hasStrongSource && meetsIndependence && input.anyUsable && exactly && input.detractorCount === 0) {
    return "strongly-supported";
  }
  if (input.hasStrongSource && meetsIndependence && input.anyUsable && input.applicability !== "weak" && input.applicability !== "unknown") {
    return "likely";
  }
  // A high-risk claim never reaches "likely" on thin evidence. It falls through
  // to a state the creative contract refuses to publish.
  if (input.risk === "high" && (!meetsIndependence || !input.anyUsable)) {
    return "insufficient-evidence";
  }
  if (meetsIndependence && input.anyUsable) return "plausible";
  return "weakly-supported";
}

/**
 * Whether a state clears the uncertainty a question declared acceptable.
 *
 * Compared on an explicit ordering rather than by string equality, so a
 * question asking for "likely" is satisfied by "strongly-supported".
 */
const STATE_STRENGTH: Record<EpistemicState, number> = {
  known: 6,
  "strongly-supported": 5,
  likely: 4,
  plausible: 3,
  "weakly-supported": 2,
  stale: 1,
  disputed: 1,
  "insufficient-evidence": 0,
  unknown: 0,
  "requires-experiment": 0,
  "requires-human-judgment": 0,
};

export function meetsAcceptableUncertainty(actual: EpistemicState, acceptable: EpistemicState): boolean {
  return STATE_STRENGTH[actual] >= STATE_STRENGTH[acceptable];
}

export function stateStrength(state: EpistemicState): number {
  return STATE_STRENGTH[state];
}

/** The weakest state in a set — what a combined statement must inherit. */
export function weakestState(states: readonly EpistemicState[]): EpistemicState {
  if (states.length === 0) return "unknown";
  return states.reduce((worst, state) => (STATE_STRENGTH[state] < STATE_STRENGTH[worst] ? state : worst));
}

/**
 * Evidence strength a claim's risk demands before it may be asserted.
 *
 * `likely` is the floor for EVERY risk class, including low. An earlier version
 * returned `plausible` for low-risk claims, which contradicted
 * UNSAFE_FOR_CREATIVE — `plausible` is listed there as never assertable — and
 * the two rules disagreed about the same claim.
 *
 * Conservative is the right way to resolve that. `plausible` is what this
 * module produces when NO source well-suited to the question backs the claim,
 * and a genuinely low-risk claim does not land there: a manufacturer's own
 * documentation answering a specification question reaches
 * `strongly-supported` on one source. A low-risk claim stuck at `plausible` is
 * a claim nothing good supports, and saying it anyway is not made safe by the
 * subject being unimportant.
 *
 * Low and medium therefore share a threshold, and the risk classes separate on
 * the axis where the difference is real: a high-risk claim additionally needs
 * two independent origins (see REQUIRED_INDEPENDENT_ORIGINS) and cannot reach
 * `likely` on thin evidence at all.
 */
export function requiredStateForRisk(risk: AtomicClaim["risk"]): EpistemicState {
  return CLAIM_RISK_ORDER[risk] >= CLAIM_RISK_ORDER.high ? "strongly-supported" : "likely";
}
