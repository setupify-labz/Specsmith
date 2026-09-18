// MASTER #5 — Stopping, next experiment, explore/exploit (sections 24, 25, 44, 45, 46, 81, 100).
//
// MASTER #5 RECOMMENDS. It does not allocate production capacity, decide what
// gets made, or publish anything — that is MASTER #8's arbitration, and the
// boundary is kept clean deliberately (section 100).
//
// The two useful outputs here are a stopping judgment and a next experiment.
// The second matters more than it looks: after a confounded or conflicting
// result, the valuable move is not "make another video" but "hold topic
// constant and change only the hook", and naming that specific next test is
// how uncertainty actually gets reduced rather than accumulated.
//
// The priority heuristic is transparent and explicitly NOT expected-value
// mathematics (section 45). It is a small set of named considerations with
// stated weights, and it says so, because dressing a judgment up as a
// calculation makes it harder to argue with rather than better.

import {
  earlyStopPermitted,
  type EvidenceStrength,
  type Experiment,
  type ExperimentDecision,
  type StopConditionCode,
} from "./model.ts";
import type { PerformanceInterpretation } from "./interpretation.ts";
import type { Confounder } from "./validity.ts";

// ---------------------------------------------------------------------------
// Stopping (sections 24, 25)
// ---------------------------------------------------------------------------

export interface StopJudgment {
  readonly shouldStop: boolean;
  readonly code: StopConditionCode | null;
  readonly isEarlyStop: boolean;
  readonly permitted: boolean;
  readonly explanation: string;
}

/**
 * Should this experiment stop, and is stopping legitimate?
 *
 * Checked against the conditions the design declared BEFORE results existed.
 * An undeclared reason cannot stop an experiment: that is the whole mechanism,
 * because the reason people actually stop early is that they like the numbers,
 * and "we like the numbers" never appears on a preregistered list.
 */
export function judgeStop(input: {
  readonly experiment: Experiment;
  readonly interpretation: PerformanceInterpretation;
  readonly unitsPerVariant: ReadonlyMap<string, number>;
  readonly replicationCount: number;
  readonly conflictingCount: number;
  readonly daysRunning: number;
}): StopJudgment {
  const { experiment, interpretation } = input;
  const declared = new Set(experiment.stopConditions.map((condition) => condition.code));

  const consider = (code: StopConditionCode, explanation: string): StopJudgment => {
    const early = earlyStopPermitted(code);
    const wasDeclared = declared.has(code);
    // Integrity and validity stops apply whether or not they were declared:
    // continuing a broken or unsafe experiment is never the right call.
    const permitted = wasDeclared || early;
    return {
      shouldStop: true,
      code,
      isEarlyStop: early,
      permitted,
      explanation: permitted
        ? explanation
        : `${explanation} However, "${code}" was not among the declared stop conditions, so stopping for it now would be a ` +
          "post-hoc rule. Record the reason and continue, or revise the design explicitly.",
    };
  };

  if (!interpretation.guardrails.allPassed) {
    return consider(
      "guardrail-failure",
      `A guardrail failed (${interpretation.guardrails.failures.map((f) => f.guardrailId).join(", ")}). ` +
        "An integrity failure stops an experiment regardless of its performance.",
    );
  }

  if (interpretation.validity.state === "invalid") {
    return consider("design-invalidated", "The comparison is invalid on identity, window or timing grounds, so further collection adds nothing.");
  }

  const required = experiment.minimumEvidence.minimumIndependentUnitsPerVariant;
  const allMet = experiment.variants.every((variant) => (input.unitsPerVariant.get(variant.variantId) ?? 0) >= required);
  if (allMet && input.replicationCount >= experiment.minimumEvidence.minimumReplications) {
    return consider(
      "replication-achieved",
      `Every variant reached ${required} independent unit(s) and ${input.replicationCount} replication(s) were achieved, which is what the design asked for.`,
    );
  }
  if (allMet) {
    return consider("planned-units-reached", `Every variant reached the planned ${required} independent unit(s).`);
  }

  if (input.conflictingCount >= 2) {
    return consider(
      "direction-repeatedly-conflicts",
      `${input.conflictingCount} experiments point in conflicting directions. More of the same design will not resolve that; ` +
        "a discriminating experiment will.",
    );
  }

  if (input.daysRunning > 60 && interpretation.sample.independentUnitCount === 0) {
    return consider("insufficient-traffic", `${Math.round(input.daysRunning)} days have produced no usable observations.`);
  }

  return {
    shouldStop: false,
    code: null,
    isEarlyStop: false,
    permitted: true,
    explanation:
      `No declared stop condition is met. ${interpretation.sample.explanation} Continuing to collect is the correct action, ` +
      "and an exciting early number is explicitly not a reason to stop.",
  };
}

// ---------------------------------------------------------------------------
// Next experiment (section 81)
// ---------------------------------------------------------------------------

export interface NextExperimentProposal {
  readonly rationale: string;
  readonly holdConstant: readonly string[];
  readonly vary: readonly string[];
  readonly suggestedScope: string;
  readonly whatItWouldResolve: string;
  readonly priority: ExperimentPriority;
}

/**
 * Propose the experiment that would most reduce uncertainty.
 *
 * Branches on WHY the current result is unsatisfying, because the right next
 * test is different in each case: a confounded result needs the confounder held
 * constant, a conflicting one needs the axis that distinguishes the conflicting
 * scopes, and a promising one needs a different topic to see whether it
 * survives the biggest confounder there is.
 */
export function proposeNextExperiment(input: {
  readonly experiment: Experiment;
  readonly interpretation: PerformanceInterpretation;
  readonly conflictingScopes: readonly string[];
}): NextExperimentProposal {
  const { experiment, interpretation } = input;
  const validity = interpretation.validity;
  const testedDimension = validity.declaredDifferences[0]?.dimension ?? "the intended variable";

  if (validity.confounders.length > 0) {
    const worst = worstConfounder(validity.confounders);
    return {
      rationale:
        `The result could not be attributed to ${testedDimension} because ${worst.dimension} also changed ` +
        `(${worst.controlValue} vs ${worst.variantValue}).`,
      holdConstant: [worst.dimension, ...validity.confounders.slice(1, 4).map((confounder) => confounder.dimension)],
      vary: [testedDimension],
      suggestedScope: `${experiment.scope.platform}, topic family "${experiment.scope.topicFamily}", same mission family`,
      whatItWouldResolve:
        `Whether ${testedDimension} does anything at all once ${worst.dimension} is held constant. That is the question this ` +
        "experiment intended to answer and did not.",
      priority: scorePriority({ uncertainty: "high", isolationPossible: true, strategicRelevance: "high", cost: "low" }),
    };
  }

  if (interpretation.evidence.strength === "conflicting" && input.conflictingScopes.length > 0) {
    return {
      rationale: `Experiments disagree across ${input.conflictingScopes.join(" and ")}.`,
      holdConstant: [testedDimension, "platform", "objective"],
      vary: ["the axis that differs between the conflicting scopes"],
      suggestedScope: input.conflictingScopes.join(" vs "),
      whatItWouldResolve:
        "Whether the disagreement is a real scope difference or ordinary noise. Averaging the existing results would hide " +
        "exactly this distinction.",
      priority: scorePriority({ uncertainty: "high", isolationPossible: true, strategicRelevance: "high", cost: "moderate" }),
    };
  }

  if (interpretation.evidence.strength === "replication-needed" || interpretation.evidence.strength === "directional") {
    return {
      rationale: `A controlled result favours one side on ${experiment.primaryMetricId}, but one experiment is not a finding.`,
      holdConstant: [testedDimension, "platform", "objective", "audience"],
      vary: ["topic"],
      suggestedScope: `${experiment.scope.platform}, a DIFFERENT topic in the same family`,
      whatItWouldResolve:
        "Whether the effect survives a topic change. Topic demand is the largest confounder in short-form content, so a " +
        "topic replication is the most informative next test available.",
      priority: scorePriority({ uncertainty: "moderate", isolationPossible: true, strategicRelevance: "high", cost: "low" }),
    };
  }

  if (interpretation.primaryComparison.outcome === "indistinguishable") {
    return {
      rationale: `Changing ${testedDimension} made no distinguishable difference, which is a useful negative result.`,
      holdConstant: ["topic", "platform", "objective"],
      vary: ["a different dimension with a larger expected effect"],
      suggestedScope: `${experiment.scope.platform}, same topic family`,
      whatItWouldResolve:
        `Whether anything in this creative family moves ${experiment.primaryMetricId} at all. If ${testedDimension} does not ` +
        "matter here, effort is better spent on a dimension that might.",
      priority: scorePriority({ uncertainty: "moderate", isolationPossible: true, strategicRelevance: "moderate", cost: "low" }),
    };
  }

  return {
    rationale: "The current experiment has not produced an interpretable result.",
    holdConstant: ["topic", "platform", "objective", "audience"],
    vary: [testedDimension],
    suggestedScope: `${experiment.scope.platform}, same topic family`,
    whatItWouldResolve: `Whether ${testedDimension} has an effect under conditions tight enough to detect one.`,
    priority: scorePriority({ uncertainty: "high", isolationPossible: true, strategicRelevance: "moderate", cost: "low" }),
  };
}

function worstConfounder(confounders: readonly Confounder[]): Confounder {
  const fatal = confounders.find((confounder) => confounder.severity === "fatal");
  return fatal ?? confounders[0];
}

// ---------------------------------------------------------------------------
// Priority heuristic (section 45)
// ---------------------------------------------------------------------------

export type PriorityBand = "high" | "moderate" | "low";

export interface ExperimentPriority {
  readonly band: PriorityBand;
  readonly considerations: readonly string[];
  readonly heuristicExplanation: string;
}

/**
 * A transparent heuristic. NOT expected-value mathematics.
 *
 * Four named considerations, each contributing a stated amount. The total is
 * not a probability, an expected value or a score to be compared across
 * unrelated things — it is a way of writing down a judgment so it can be
 * disagreed with. Section 45 asks for exactly this and asks that it not pretend
 * to be more.
 */
export function scorePriority(input: {
  readonly uncertainty: "high" | "moderate" | "low";
  readonly isolationPossible: boolean;
  readonly strategicRelevance: "high" | "moderate" | "low";
  readonly cost: "low" | "moderate" | "high";
}): ExperimentPriority {
  const considerations: string[] = [];
  let points = 0;

  const uncertaintyPoints = input.uncertainty === "high" ? 2 : input.uncertainty === "moderate" ? 1 : 0;
  points += uncertaintyPoints;
  considerations.push(`Uncertainty ${input.uncertainty} (+${uncertaintyPoints}): an experiment that resolves more uncertainty is worth more.`);

  const isolationPoints = input.isolationPossible ? 2 : 0;
  points += isolationPoints;
  considerations.push(
    `Variable isolation ${input.isolationPossible ? "possible" : "not possible"} (+${isolationPoints}): a test that cannot isolate ` +
      "its variable produces another confounded result.",
  );

  const relevancePoints = input.strategicRelevance === "high" ? 2 : input.strategicRelevance === "moderate" ? 1 : 0;
  points += relevancePoints;
  considerations.push(`Strategic relevance ${input.strategicRelevance} (+${relevancePoints}): reusability across future content.`);

  const costPoints = input.cost === "low" ? 1 : input.cost === "moderate" ? 0 : -1;
  points += costPoints;
  considerations.push(`Cost ${input.cost} (${costPoints >= 0 ? "+" : ""}${costPoints}): production burden, with no paid provider involved.`);

  const band: PriorityBand = points >= 6 ? "high" : points >= 3 ? "moderate" : "low";

  return {
    band,
    considerations,
    heuristicExplanation:
      `Four considerations summed to ${points}, giving band "${band}" (>=6 high, >=3 moderate). This is a documented ` +
      "heuristic for ordering work, not expected-value mathematics: the weights are judgments and the total is not a " +
      "probability of anything.",
  };
}

// ---------------------------------------------------------------------------
// Explore vs exploit (section 46)
// ---------------------------------------------------------------------------

export type ExploreExploitStance = "explore" | "exploit-cautiously" | "replicate" | "pause" | "abandon";

export interface ExploreExploitRecommendation {
  readonly stance: ExploreExploitStance;
  readonly reason: string;
  /** Always true: MASTER #5 never decides production volume itself. */
  readonly requiresExecutiveArbitration: true;
}

/**
 * Recommend a posture.
 *
 * `requiresExecutiveArbitration` is hard-coded true because this layer must not
 * be able to express "and therefore make twelve of these". Reckless automatic
 * volume decisions are exactly what section 46 forbids, and MASTER #8 owns the
 * trade-off against everything else the system could be doing.
 */
export function recommendStance(
  strength: EvidenceStrength,
  decision: ExperimentDecision,
  guardrailsPassed: boolean,
): ExploreExploitRecommendation {
  if (!guardrailsPassed) {
    return {
      stance: "abandon",
      reason: "A guardrail failed. This direction is abandoned regardless of its performance; integrity is not tradeable.",
      requiresExecutiveArbitration: true,
    };
  }
  if (decision === "invalidated") {
    return { stance: "abandon", reason: "The experiment was invalid, so there is nothing to carry forward from it.", requiresExecutiveArbitration: true };
  }
  if (strength === "conflicting") {
    return {
      stance: "replicate",
      reason: "Evidence conflicts. A discriminating experiment is worth more than either continuing or committing.",
      requiresExecutiveArbitration: true,
    };
  }
  if (strength === "strong-within-scope" || strength === "replicated") {
    return {
      stance: "exploit-cautiously",
      reason:
        "Replicated within one scope. Reuse is defensible INSIDE that scope, and remains cautious because scope creep is how " +
        "a local finding becomes a house rule that was never tested.",
      requiresExecutiveArbitration: true,
    };
  }
  if (strength === "replication-needed" || strength === "directional") {
    return { stance: "replicate", reason: "A promising direction that has not been reproduced. Replication before reuse.", requiresExecutiveArbitration: true };
  }
  if (strength === "anecdotal") {
    return { stance: "explore", reason: "One interesting comparison. Worth exploring further, not worth building on.", requiresExecutiveArbitration: true };
  }
  return { stance: "pause", reason: "Insufficient evidence to justify further investment in this direction right now.", requiresExecutiveArbitration: true };
}

// ---------------------------------------------------------------------------
// Opportunity cost (section 44)
// ---------------------------------------------------------------------------

export interface OpportunityCostAssessment {
  readonly worthContinuing: boolean;
  readonly reason: string;
  readonly considerations: readonly string[];
}

/**
 * Is continuing to test this worth the production it consumes?
 *
 * The diminishing-returns case is the one worth catching: an experiment that
 * has run several times without converging is unlikely to converge on the next
 * attempt, and the production could answer a question that is still open.
 */
export function assessOpportunityCost(input: {
  readonly strength: EvidenceStrength;
  readonly unitsCollected: number;
  readonly unresolvedHypotheses: number;
  readonly productionBurdenPerUnit: "low" | "moderate" | "high";
}): OpportunityCostAssessment {
  const considerations: string[] = [
    `Current evidence: ${input.strength}.`,
    `${input.unitsCollected} unit(s) collected so far.`,
    `${input.unresolvedHypotheses} other hypothesis/hypotheses are unresolved and competing for the same production.`,
    `Production burden per unit: ${input.productionBurdenPerUnit}. No paid provider is involved either way.`,
  ];

  if (input.strength === "strong-within-scope") {
    return {
      worthContinuing: false,
      reason: "The question is answered within its scope. Further units here buy little while other hypotheses remain untouched.",
      considerations,
    };
  }
  if (input.strength === "conflicting") {
    return {
      worthContinuing: true,
      reason: "An unresolved conflict is the most valuable thing to spend production on, because it is currently blocking any reuse.",
      considerations,
    };
  }
  if (input.unitsCollected >= 6 && (input.strength === "anecdotal" || input.strength === "insufficient")) {
    return {
      worthContinuing: false,
      reason:
        `${input.unitsCollected} units have not produced a direction. The effect, if any, is small relative to the noise at ` +
        "this sample size, and further units of the same design are unlikely to change that.",
      considerations,
    };
  }
  if (input.unresolvedHypotheses > 3 && input.strength === "anecdotal") {
    return {
      worthContinuing: false,
      reason:
        `${input.unresolvedHypotheses} hypotheses are unresolved. Spreading effort across untested questions gains more ` +
        "information than adding units to a weak one.",
      considerations,
    };
  }

  return {
    worthContinuing: true,
    reason: "This experiment is still the best available use of the production it consumes.",
    considerations,
  };
}
