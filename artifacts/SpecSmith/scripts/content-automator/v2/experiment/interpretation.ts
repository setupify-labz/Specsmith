// MASTER #5 — Interpretation, causal language and diagnosis
// (sections 1, 26, 27, 28, 37, 49, 60, 82, 83).
//
// The separation this file enforces, one step at a time:
//
//   OBSERVED       "control 0.54, variant 0.68 on stayed-to-watch at 24h"
//   CAN INFER      "within this pair, the variant did better on the primary metric"
//   CANNOT INFER   "result-first hooks are better"
//   NEXT           "replicate on another GPU topic, same platform"
//
// The third line is the one that gets skipped, and skipping it is how a content
// system acquires confident opinions it cannot defend. `cannotInfer` is
// therefore never empty: there is always something this result does not show,
// and stating it costs nothing.
//
// The causal language gate is mechanical rather than advisory. Phrasing like
// "X improves Y" requires a validity state and evidence strength that permit
// it; below that bar the permitted phrasing is narrower, and the gate says
// which sentence is allowed rather than trusting a writer to feel the
// difference.

import {
  outcomeHasDirection,
  validityPermitsCausalReading,
  widestPermittedGeneralization,
  type ComparisonOutcome,
  type EvidenceStrength,
  type Experiment,
  type ExperimentDecision,
  type GeneralizationLevel,
  type ValidityState,
} from "./model.ts";
import type { EvidenceAssessment, GuardrailVerdict, MetricComparison, SampleAccounting } from "./comparison.ts";
import type { ValidityAssessment } from "./validity.ts";
import { measuredValue, type MetricReading } from "./metrics.ts";
import type { PerformanceObservation } from "./observation.ts";

// ---------------------------------------------------------------------------
// Causal language gate (sections 27, 28)
// ---------------------------------------------------------------------------

/**
 * How strongly a result may be phrased.
 *
 * Ordered weakest to strongest. `causal` is reachable only from a clean
 * controlled experiment that has been replicated — and even then it is bounded
 * to the experiment's scope, because "causes" without a scope is a universal
 * claim in disguise.
 */
export type CausalStrength =
  /** "Control measured 0.54, variant 0.68." Nothing beyond the numbers. */
  | "observation-only"
  /** "The variant performed better in this comparison." */
  | "comparative-within-experiment"
  /** "This direction is supported within this scope." */
  | "directional-within-scope"
  /** "Within this scope, X appears to improve Y." Replicated and controlled. */
  | "causal-within-scope";

export const CAUSAL_STRENGTHS: readonly CausalStrength[] = [
  "observation-only", "comparative-within-experiment", "directional-within-scope", "causal-within-scope",
];

export interface CausalPermission {
  readonly strength: CausalStrength;
  readonly permittedPhrasings: readonly string[];
  readonly forbiddenPhrasings: readonly string[];
  readonly reason: string;
}

/**
 * Decide what may be SAID about a result.
 *
 * Defaults conservative at every branch. The forbidden list is concrete rather
 * than abstract — a reviewer can check a sentence against it — and the phrases
 * it names are the ones that actually get written.
 */
export function causalPermission(
  validity: ValidityState,
  evidence: EvidenceStrength,
  outcome: ComparisonOutcome,
  guardrails: GuardrailVerdict,
): CausalPermission {
  const universal = [
    '"X is better" — unscoped, so it claims every topic, platform and audience at once.',
    '"X works" — no metric, no scope, no way to be wrong.',
    '"X caused Y" without naming the scope this was established in.',
    '"always" / "never" / "universally" about any creative choice.',
  ];

  if (!guardrails.allPassed) {
    return {
      strength: "observation-only",
      permittedPhrasings: ["The numbers may be reported as numbers, with the guardrail failure stated alongside them."],
      forbiddenPhrasings: [...universal, "Any phrasing that presents this variant as successful."],
      reason:
        "A guardrail failed. The performance figures still exist, but nothing may be concluded in favour of the variant: " +
        "integrity is not a dimension performance can trade against.",
    };
  }

  if (validity === "invalid" || !outcomeHasDirection(outcome)) {
    return {
      strength: "observation-only",
      permittedPhrasings: [
        "What was measured, stated as measurement.",
        outcome === "indistinguishable"
          ? '"The variants were indistinguishable on the primary metric at this window." — a null result, worth recording.'
          : `"The comparison produced ${outcome}."`,
      ],
      forbiddenPhrasings: [...universal, "Any directional claim; no direction was established."],
      reason: `Validity is ${validity} and the outcome is ${outcome}, so only the observations themselves may be reported.`,
    };
  }

  if (!validityPermitsCausalReading(validity)) {
    return {
      strength: "comparative-within-experiment",
      permittedPhrasings: [
        '"In this comparison, one side measured higher on the primary metric."',
        '"This is worth a controlled test." — observational results motivate experiments.',
      ],
      forbiddenPhrasings: [
        ...universal,
        '"X improved Y" — this was not a controlled comparison, so the improvement cannot be attributed to X.',
        "Any phrasing implying the declared variable was responsible.",
      ],
      reason:
        validity === "confounded"
          ? "Multiple dimensions changed together, so the difference cannot be attributed to any one of them."
          : "This was an observational comparison, which can suggest a hypothesis but cannot test one.",
    };
  }

  if (evidence === "conflicting") {
    return {
      strength: "observation-only",
      permittedPhrasings: ['"Experiments addressing this disagree." — the disagreement is the finding.'],
      forbiddenPhrasings: [...universal, "Any summary that averages the conflicting results into one direction."],
      reason: "Evidence conflicts. Averaging opposite findings produces a number that describes neither.",
    };
  }

  if (evidence === "anecdotal" || evidence === "insufficient") {
    return {
      strength: "comparative-within-experiment",
      permittedPhrasings: [
        '"In this single comparison, the variant measured higher on the primary metric."',
        '"This is interesting enough to test again."',
      ],
      forbiddenPhrasings: [
        ...universal,
        '"X is directionally supported" — one comparison is not a direction, it is a data point.',
      ],
      reason: `Evidence is ${evidence}: a single comparison describes itself and nothing wider.`,
    };
  }

  if (validity !== "clean-controlled" || evidence === "directional" || evidence === "replication-needed") {
    return {
      strength: "directional-within-scope",
      permittedPhrasings: [
        '"Within this platform, audience and topic family, this direction is supported."',
        '"This result is worth replicating before it is reused."',
      ],
      forbiddenPhrasings: [
        ...universal,
        '"X improves Y" — improvement language needs replication behind it.',
        "Any claim extending past the platform and topic family this ran in.",
      ],
      reason: `Evidence is ${evidence} under a ${validity} design: a direction inside one scope, not yet a reusable finding.`,
    };
  }

  return {
    strength: "causal-within-scope",
    permittedPhrasings: [
      '"Within this platform, audience and objective, X appears to improve Y." — scope stated explicitly.',
      '"This may be reused cautiously inside this scope."',
    ],
    forbiddenPhrasings: [
      ...universal,
      "Any statement of this finding that omits the scope it was established in.",
    ],
    reason:
      `Evidence is ${evidence} under a ${validity} design. This is the strongest position this system can reach, and it is ` +
      "still bounded: nothing here establishes anything outside the scope tested.",
  };
}

// ---------------------------------------------------------------------------
// Diagnosis (section 60)
// ---------------------------------------------------------------------------

/**
 * Descriptive readings of a performance shape.
 *
 * Diagnoses, not causes. "Weak opening" says where in the video attention was
 * lost; it does not say the hook was at fault, because the topic, the thumbnail
 * and the platform's own distribution all shape the same number.
 */
export type PerformanceDiagnosis =
  | "weak-opening"
  | "early-drop"
  | "strong-hook-weak-completion"
  | "good-retention-low-distribution"
  | "strong-engagement-weak-clickthrough"
  | "high-views-low-downstream-action"
  | "high-clicks-low-retention"
  | "strong-save-share-behaviour"
  | "insufficient-reach-to-interpret"
  | "metric-unavailable";

export interface DiagnosisResult {
  readonly diagnosis: PerformanceDiagnosis;
  readonly explanation: string;
}

/** Below this view count, a per-creative rate is too noisy to read. */
export const MINIMUM_VIEWS_TO_INTERPRET = 100;

export function diagnose(observation: PerformanceObservation): DiagnosisResult {
  const get = (metricId: string): MetricReading | undefined => observation.metrics.get(metricId);
  const value = (metricId: string): number | null => {
    const reading = get(metricId);
    return reading === undefined ? null : measuredValue(reading);
  };

  const views = value("views");
  if (views === null) {
    return {
      diagnosis: "metric-unavailable",
      explanation: "Views were not measured, so no rate on this creative can be interpreted. This is a collection fact, not a performance fact.",
    };
  }
  if (views < MINIMUM_VIEWS_TO_INTERPRET) {
    return {
      diagnosis: "insufficient-reach-to-interpret",
      explanation:
        `Only ${views} view(s). Rates computed on this few viewers move enormously with single viewers, so any retention or ` +
        "engagement reading here describes noise rather than the creative.",
    };
  }

  const early = value("stayed-to-watch-rate");
  const completion = value("average-percentage-viewed");
  const clicks = value("site-clicks");
  const saves = value("saves");
  const shares = value("shares");

  if (early !== null && early < 0.4) {
    return {
      diagnosis: "weak-opening",
      explanation:
        `Early retention is ${(early * 100).toFixed(0)}%, so most viewers left in the opening seconds. This locates WHERE ` +
        "attention was lost; it does not establish that the hook form is why, since topic demand shapes this number too.",
    };
  }

  if (early !== null && completion !== null && early > 0.6 && completion < 0.35) {
    return {
      diagnosis: "strong-hook-weak-completion",
      explanation:
        `Early retention is ${(early * 100).toFixed(0)}% but average completion is ${(completion * 100).toFixed(0)}%: the opening ` +
        "held people and the middle did not. Consistent with pacing or payoff placement, neither of which this measures.",
    };
  }

  if (completion !== null && completion > 0.5 && views < 1000) {
    return {
      diagnosis: "good-retention-low-distribution",
      explanation:
        `Completion is ${(completion * 100).toFixed(0)}% on ${views} views: the people who saw it mostly watched it, and few ` +
        "people saw it. Distribution is outside SpecSmith's control and is not a creative result.",
    };
  }

  if ((saves !== null && saves > 0) || (shares !== null && shares > 0)) {
    const parts = [saves !== null ? `${saves} save(s)` : null, shares !== null ? `${shares} share(s)` : null].filter(Boolean);
    if (clicks !== null && clicks === 0) {
      return {
        diagnosis: "strong-engagement-weak-clickthrough",
        explanation: `${parts.join(" and ")} but no site clicks: viewers valued the content itself without acting on the CTA.`,
      };
    }
    return {
      diagnosis: "strong-save-share-behaviour",
      explanation: `${parts.join(" and ")} recorded — viewers treated this as worth keeping or passing on.`,
    };
  }

  if (clicks !== null && clicks > 0 && early !== null && early < 0.5) {
    return {
      diagnosis: "high-clicks-low-retention",
      explanation:
        `${clicks} click(s) with ${(early * 100).toFixed(0)}% early retention. Worth checking the CTA is not over-promising, ` +
        "since clicks earned by a misleading promise are a cost rather than a result.",
    };
  }

  return {
    diagnosis: "high-views-low-downstream-action",
    explanation: `${views} views with no distinctive engagement or downstream signal.`,
  };
}

// ---------------------------------------------------------------------------
// Interpretation (sections 26, 37, 49)
// ---------------------------------------------------------------------------

/**
 * What MASTER #5 concluded, at a moment in time.
 *
 * Stored separately from the observations (section 37): later data produces a
 * NEW interpretation and the old one stays reconstructable, because the
 * reasoning that justified a past decision is part of the audit trail.
 */
export interface PerformanceInterpretation {
  readonly version: "performance-interpretation-v1";
  readonly interpretationId: string;
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly designHash: string;
  readonly createdAt: string;

  readonly whatHappened: string;
  readonly primaryComparison: MetricComparison;
  readonly secondaryComparisons: readonly MetricComparison[];
  readonly diagnoses: readonly { readonly creativeId: string; readonly result: DiagnosisResult }[];

  readonly validity: ValidityAssessment;
  readonly sample: SampleAccounting;
  readonly evidence: EvidenceAssessment;
  readonly guardrails: GuardrailVerdict;
  readonly causal: CausalPermission;

  readonly canInfer: readonly string[];
  /** Never empty. There is always something a result does not show. */
  readonly cannotInfer: readonly string[];
  readonly alternativeExplanations: readonly string[];
  readonly counterfactuals: readonly string[];
  readonly widestJustifiedGeneralization: GeneralizationLevel | null;

  readonly needsReplication: boolean;
  readonly conflictsWithPrior: boolean;
  readonly recommendedDecision: ExperimentDecision;
  readonly limitations: readonly string[];
  readonly synthetic: boolean;
  readonly provenance: { readonly producedBy: string; readonly producedAt: string };
}

export interface InterpretationInput {
  readonly experiment: Experiment;
  readonly primary: MetricComparison;
  readonly secondaries: readonly MetricComparison[];
  readonly validity: ValidityAssessment;
  readonly sample: SampleAccounting;
  readonly evidence: EvidenceAssessment;
  readonly guardrails: GuardrailVerdict;
  readonly observations: readonly PerformanceObservation[];
  readonly conflictsWithPrior: boolean;
  readonly synthetic: boolean;
  readonly now: Date;
  readonly producedBy: string;
}

export function interpret(input: InterpretationInput): PerformanceInterpretation {
  const { experiment, primary, validity, evidence, guardrails } = input;

  const causal = causalPermission(validity.state, evidence.strength, primary.outcome, guardrails);
  const canInfer = buildCanInfer(input, causal);
  const cannotInfer = buildCannotInfer(input, causal);
  const widest = guardrails.allPassed ? widestPermittedGeneralization(evidence.strength) : null;

  return {
    version: "performance-interpretation-v1",
    interpretationId: `interp-${experiment.experimentId}-r${experiment.revision}-${input.now.toISOString()}`,
    experimentId: experiment.experimentId,
    experimentRevision: experiment.revision,
    designHash: experiment.designHash,
    createdAt: input.now.toISOString(),

    whatHappened: primary.explanation,
    primaryComparison: primary,
    secondaryComparisons: input.secondaries,
    diagnoses: input.observations.map((observation) => ({ creativeId: observation.creativeId, result: diagnose(observation) })),

    validity,
    sample: input.sample,
    evidence,
    guardrails,
    causal,

    canInfer,
    cannotInfer,
    alternativeExplanations: validity.alternativeExplanations,
    counterfactuals: buildCounterfactuals(input),
    widestJustifiedGeneralization: widest,

    needsReplication: evidence.strength === "replication-needed" || evidence.strength === "directional",
    conflictsWithPrior: input.conflictsWithPrior,
    recommendedDecision: recommendDecision(input, evidence.strength),
    limitations: buildLimitations(input),
    synthetic: input.synthetic,
    provenance: { producedBy: input.producedBy, producedAt: input.now.toISOString() },
  };
}

function buildCanInfer(input: InterpretationInput, causal: CausalPermission): readonly string[] {
  const statements: string[] = [];
  const { experiment, primary, validity, evidence } = input;

  if (!input.guardrails.allPassed) {
    statements.push("Nothing in favour of the variant: a guardrail failed, which overrides the performance result.");
    return statements;
  }

  if (outcomeHasDirection(primary.outcome)) {
    const side = primary.outcome === "variant-higher" ? "variant" : "control";
    statements.push(
      `Within this comparison, the ${side} measured higher on the primary metric "${experiment.primaryMetricId}" at the ` +
        `${experiment.observationWindow} window.`,
    );
  } else if (primary.outcome === "indistinguishable") {
    statements.push(
      `The variants were indistinguishable on "${experiment.primaryMetricId}". Changing ` +
        `${validity.declaredDifferences.map((d) => d.dimension).join(", ") || "this dimension"} may not matter much within this scope.`,
    );
  }

  if (causal.strength === "directional-within-scope" || causal.strength === "causal-within-scope") {
    statements.push(
      `The direction is supported within ${experiment.scope.platform}, topic family "${experiment.scope.topicFamily}", ` +
        `objective "${experiment.scope.objective}"` +
        (experiment.scope.audienceWasUnknown ? " — with the audience unestablished." : `, audience "${experiment.scope.audienceDescription}".`),
    );
  }

  if (evidence.strength === "conflicting") {
    statements.push("That experiments addressing this hypothesis disagree, which is itself a finding worth acting on.");
  }

  if (statements.length === 0) {
    statements.push("Only that these measurements were taken. No comparative conclusion is supported.");
  }
  return statements;
}

/**
 * What this result does NOT show.
 *
 * Guaranteed non-empty. Every branch appends, and the scope limits at the end
 * always apply, because no experiment in this system is ever broad enough to
 * have ruled out the things listed there.
 */
function buildCannotInfer(input: InterpretationInput, causal: CausalPermission): readonly string[] {
  const statements: string[] = [];
  const { experiment, validity, evidence } = input;

  if (validity.state === "confounded") {
    statements.push(
      `That ${validity.declaredDifferences.map((d) => d.dimension).join(", ") || "the intended variable"} caused the difference — ` +
        `${validity.confounders.length} dimension(s) changed together, and any of them could be responsible.`,
    );
  }
  if (validity.state === "observational-comparison") {
    statements.push("Anything causal: nothing was controlled, so this can only motivate an experiment.");
  }
  if (evidence.strength === "anecdotal" || evidence.strength === "insufficient") {
    statements.push("That this direction would repeat. One comparison does not establish a tendency.");
  }
  if (!input.sample.meetsMinimum) {
    statements.push(`That the sample supports a decision — the design required ${experiment.minimumEvidence.minimumIndependentUnitsPerVariant} independent unit(s) per variant and that was not met.`);
  }

  // Always applicable, because no experiment here ever covered these.
  statements.push(`That this holds on any platform other than ${experiment.scope.platform}.`);
  statements.push(`That this holds for topics outside "${experiment.scope.topicFamily}".`);
  statements.push(`That this holds for objectives other than "${experiment.scope.objective}".`);
  if (experiment.scope.audienceWasUnknown) {
    statements.push(
      "Anything about WHO this worked for: MASTER #4 could not establish the audience, so the result cannot be attributed to " +
        "beginners or to any other group.",
    );
  }
  statements.push(...causal.forbiddenPhrasings.map((phrasing) => `Any claim of the form ${phrasing}`));

  return statements;
}

/**
 * Counterfactual questions (section 82).
 *
 * Asked, not answered. The value is in making a reader notice that a different
 * plausible number would have produced a different decision — which is a
 * property of the decision rule, and worth seeing.
 */
function buildCounterfactuals(input: InterpretationInput): readonly string[] {
  const { experiment, primary, validity } = input;
  const questions: string[] = [];

  questions.push(
    `What result would have changed the decision? A primary-metric difference below ` +
      `${(0.1 * 100).toFixed(0)}% would have read as indistinguishable, and the recommendation would have been to record a null result.`,
  );

  if (validity.confounders.length > 0) {
    questions.push(
      `What variable remains uncontrolled? ${validity.confounders.map((c) => c.dimension).join(", ")} — holding ` +
        `${validity.confounders[0].dimension} constant is the single change that would most improve the next test.`,
    );
  } else {
    questions.push("What variable remains uncontrolled? Posting conditions and platform distribution, neither of which is measured here.");
  }

  if (primary.controlMean !== null && primary.variantMean !== null) {
    questions.push(
      `What alternative explanation fits equally well? At these sample sizes, random variation produces differences of this ` +
        `size routinely; nothing in this comparison distinguishes that from a real effect of ` +
        `${validity.declaredDifferences.map((d) => d.dimension).join(", ") || "the variable under test"}.`,
    );
  }

  questions.push(
    `Would the opposite result have been believed as readily? If the ${experiment.primaryMetricId} difference had pointed the ` +
      "other way, the same design and the same sample would have produced an equally confident-looking conclusion — which is a " +
      "reason to weight replication over this single result.",
  );

  return questions;
}

function recommendDecision(input: InterpretationInput, strength: EvidenceStrength): ExperimentDecision {
  if (!input.guardrails.allPassed) return "blocked-by-guardrail";
  if (input.validity.state === "invalid") return "invalidated";
  if (strength === "conflicting") return "replicate";
  if (strength === "insufficient") return "inconclusive";
  if (!input.sample.meetsMinimum) return "continue-collecting";
  if (strength === "anecdotal") return "continue-collecting";
  if (strength === "replication-needed" || strength === "directional") return "replicate";
  if (strength === "replicated" || strength === "strong-within-scope") return "exploit-cautiously";
  return "inconclusive";
}

function buildLimitations(input: InterpretationInput): readonly string[] {
  const limitations: string[] = [];

  if (input.synthetic) {
    limitations.push("This interpretation rests on synthetic engineering fixture analytics and is not a real performance finding.");
  }
  limitations.push(
    "No statistical significance is computed anywhere in this layer. At these sample sizes the assumptions behind a " +
      "significance test are not satisfied, so a p-value would be a number produced by an inapplicable procedure.",
  );
  limitations.push(
    `Evidence strength is a named state (${input.evidence.strength}), not a probability. It is a judgment about the shape of ` +
      "the evidence and is open to argument.",
  );
  if (input.validity.undeclaredChanges.length > 0) {
    limitations.push(`${input.validity.undeclaredChanges.length} dimension(s) changed without being declared: ${input.validity.undeclaredChanges.join(", ")}.`);
  }
  if (input.observations.some((observation) => observation.collectionStatus !== "collected")) {
    limitations.push("Some observations are partial: not every metric was collected, and the missing ones are unknown rather than zero.");
  }
  return limitations;
}

export function formatInterpretation(interpretation: PerformanceInterpretation): string {
  const lines: string[] = [];
  lines.push(`  WHAT HAPPENED: ${interpretation.whatHappened}`);
  lines.push(`  VALIDITY: ${interpretation.validity.state} — ${interpretation.validity.explanation}`);
  lines.push(`  SAMPLE: ${interpretation.sample.explanation}`);
  lines.push(`  EVIDENCE: ${interpretation.evidence.strength} — ${interpretation.evidence.explanation}`);
  lines.push(`  GUARDRAILS: ${interpretation.guardrails.explanation}`);
  lines.push(`  CAUSAL LANGUAGE: ${interpretation.causal.strength} — ${interpretation.causal.reason}`);
  lines.push("  WHAT WE CAN SAY:");
  for (const statement of interpretation.canInfer) lines.push(`    + ${statement}`);
  lines.push("  WHAT WE CANNOT SAY:");
  for (const statement of interpretation.cannotInfer) lines.push(`    - ${statement}`);
  if (interpretation.validity.confounders.length > 0) {
    lines.push("  CONFOUNDERS:");
    for (const confounder of interpretation.validity.confounders) {
      lines.push(`    [${confounder.severity}] ${confounder.dimension}: ${confounder.explanation}`);
    }
  }
  lines.push("  ALTERNATIVE EXPLANATIONS:");
  for (const explanation of interpretation.alternativeExplanations) lines.push(`    ? ${explanation}`);
  lines.push("  COUNTERFACTUALS:");
  for (const question of interpretation.counterfactuals) lines.push(`    ? ${question}`);
  lines.push(`  DECISION: ${interpretation.recommendedDecision}`);
  lines.push(`  WIDEST JUSTIFIED GENERALIZATION: ${interpretation.widestJustifiedGeneralization ?? "none"}`);
  for (const limitation of interpretation.limitations) lines.push(`  limitation: ${limitation}`);
  return lines.join("\n");
}
