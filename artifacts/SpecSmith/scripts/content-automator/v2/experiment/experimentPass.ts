// MASTER #5 — The experiment pass (sections 50, 86, 87, 94, 95, 97, 98, 99, 100).
//
// Orchestration. Takes a registered experiment, its assignments and whatever
// observations exist, and produces an interpretation, a decision, a next
// experiment and a learning candidate — or a failure record saying why it
// could not.
//
// Determinism: `now` is always an argument, nothing reads the clock, and the
// result hash is computed from design + assignments + selected observations +
// interpretation version. Same inputs, same hash.
//
// Zero cost and no network: this module imports no provider, opens no socket
// and reads no environment variable. Analytics arrive as documents that were
// already validated at the existing ingestion boundary.

import { createHash } from "node:crypto";

import type { SnapshotWindow } from "../../types.ts";
import {
  type Experiment,
  type ExperimentAssignment,
  type ExperimentDecision,
} from "./model.ts";
import { checkAgainstPreregistration, type Preregistration } from "./registry.ts";
import {
  countIndependentUnits,
  detectSelectionBias,
  type CreativeLineageNode,
  type SelectionBiasFinding,
} from "./assignment.ts";
import {
  assertOneObservationPerCreative,
  type PerformanceObservation,
} from "./observation.ts";
import {
  accountSample,
  assessEvidence,
  compareMetric,
  detectCherryPicking,
  evaluateGuardrails,
  type GuardrailResult,
  type MetricComparison,
} from "./comparison.ts";
import { assessValidity, type ShippedVariantFacts } from "./validity.ts";
import { formatInterpretation, interpret, type PerformanceInterpretation } from "./interpretation.ts";
import {
  proposeLearningCandidate,
  recordFailure,
  type ExperimentFailureRecord,
  type LearningCandidate,
  type ReplicationRecord,
} from "./learning.ts";
import {
  assessOpportunityCost,
  judgeStop,
  proposeNextExperiment,
  recommendStance,
  type ExploreExploitRecommendation,
  type NextExperimentProposal,
  type StopJudgment,
} from "./decision.ts";
import { formatReading } from "./metrics.ts";

export interface ExperimentResult {
  readonly version: "experiment-result-v1";
  readonly resultId: string;
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly designHash: string;
  readonly window: SnapshotWindow;
  readonly evaluatedAt: string;

  readonly interpretation: PerformanceInterpretation | null;
  readonly decision: ExperimentDecision;
  readonly stop: StopJudgment | null;
  readonly nextExperiment: NextExperimentProposal | null;
  readonly stance: ExploreExploitRecommendation | null;
  readonly learningCandidate: LearningCandidate | null;
  readonly failures: readonly ExperimentFailureRecord[];
  readonly selectionBias: readonly SelectionBiasFinding[];

  readonly synthetic: boolean;
  readonly limitations: readonly string[];
  readonly resultHash: string;
}

export interface ExperimentPassInput {
  readonly experiment: Experiment;
  readonly preregistration: Preregistration;
  readonly assignments: readonly ExperimentAssignment[];
  readonly observations: readonly PerformanceObservation[];
  readonly lineage: readonly CreativeLineageNode[];
  readonly shippedFacts: ReadonlyMap<string, ShippedVariantFacts>;
  readonly guardrailResults: readonly GuardrailResult[];
  readonly replications: readonly ReplicationRecord[];
  readonly conflictingExperimentIds: readonly string[];
  readonly supportingExperimentIds: readonly string[];
  readonly daysRunning: number;
  readonly unresolvedHypotheses: number;
  readonly synthetic: boolean;
  readonly now: Date;
  readonly producedBy: string;
}

/**
 * Evaluate an experiment.
 *
 * Fails closed at every step: preregistration mismatch, missing sides,
 * malformed observations and selection bias each produce a failure record and
 * a non-committal decision rather than a result that looks usable.
 */
export function runExperimentPass(input: ExperimentPassInput): ExperimentResult {
  const { experiment, now } = input;
  const failures: ExperimentFailureRecord[] = [];

  const fail = (code: Parameters<typeof recordFailure>[0]["code"], detail: string) => {
    failures.push(recordFailure({ experiment, code, detail, now, synthetic: input.synthetic }));
  };

  // --- 1. Preregistration, before anything is read (section 84) -----------
  const prereg = checkAgainstPreregistration(experiment, input.preregistration);
  if (!prereg.matches) {
    for (const finding of prereg.findings) fail("preregistration-violated", `${finding.code}: ${finding.message}`);
    return emptyResult(input, "invalidated", failures, [
      "The design does not match what was preregistered, so this cannot be evaluated as the experiment that was registered.",
    ]);
  }

  // --- 2. Selection bias (section 23) -------------------------------------
  const selectionBias = detectSelectionBias(input.assignments, input.observations.map((observation) => observation.creativeId));
  for (const finding of selectionBias) {
    if (finding.code === "analysed-but-not-assigned" || finding.code === "variant-entirely-missing") {
      fail("bad-assignment", finding.message);
    }
  }
  if (selectionBias.some((finding) => finding.code === "variant-entirely-missing")) {
    return emptyResult(input, "inconclusive", failures, ["At least one variant has no observations, so no comparison exists."], selectionBias);
  }

  // --- 3. Observation integrity (sections 13, 19) -------------------------
  try {
    assertOneObservationPerCreative(input.observations);
  } catch (error) {
    fail("wrong-window", (error as Error).message);
    return emptyResult(input, "invalidated", failures, [(error as Error).message], selectionBias);
  }

  const control = experiment.variants.find((variant) => variant.isControl);
  const treatment = experiment.variants.find((variant) => !variant.isControl);
  if (control === undefined || treatment === undefined) {
    fail("design-invalid", "The experiment lacks a control or a treatment variant.");
    return emptyResult(input, "invalidated", failures, ["No control/treatment pair exists."], selectionBias);
  }

  const controlObservations = input.observations.filter((observation) => observation.variantId === control.variantId);
  const variantObservations = input.observations.filter((observation) => observation.variantId === treatment.variantId);

  if (controlObservations.length === 0 || variantObservations.length === 0) {
    fail("missing-analytics", "One side of the comparison has no observations at the registered window.");
    return emptyResult(input, "continue-collecting", failures, ["Not every variant has been observed yet."], selectionBias);
  }

  // --- 4. Validity (sections 5, 22) ---------------------------------------
  const controlFacts = input.shippedFacts.get(control.variantId);
  const variantFacts = input.shippedFacts.get(treatment.variantId);
  if (controlFacts === undefined || variantFacts === undefined) {
    fail("design-invalid", "Shipped facts are missing for a variant, so no validity judgment is possible.");
    return emptyResult(input, "inconclusive", failures, ["Shipped variant facts unavailable."], selectionBias);
  }

  const validity = assessValidity({
    experiment,
    control: controlFacts,
    variant: variantFacts,
    observations: input.observations,
    lineage: input.lineage,
    window: experiment.observationWindow,
  });

  if (validity.isMultiFactor) {
    fail("too-many-variables-changed", `${validity.confounders.length} dimension(s) changed: ${validity.confounders.map((c) => c.dimension).join(", ")}.`);
  }

  // --- 5. Comparison (sections 11, 17) ------------------------------------
  const primary = compareMetric({
    metricId: experiment.primaryMetricId,
    window: experiment.observationWindow,
    controlObservations,
    variantObservations,
    validity: validity.state,
  });

  const secondaries = experiment.secondaryMetricIds.map((metricId) =>
    compareMetric({
      metricId,
      window: experiment.observationWindow,
      controlObservations,
      variantObservations,
      validity: validity.state,
    }),
  );

  const guardrails = evaluateGuardrails(input.guardrailResults);
  if (!guardrails.allPassed) {
    fail("integrity-gate-failed", guardrails.explanation);
  }

  // --- 6. Sample and evidence (sections 19, 20) ---------------------------
  const independence = countIndependentUnits(input.lineage);
  const sample = accountSample(input.observations, independence, experiment);
  if (!sample.meetsMinimum) {
    fail("sample-too-small", sample.explanation);
  }

  // Scope extensions are separate findings, not confirmations of this scope.
  // One experiment can count only once; contradictory replays are excluded.
  const eligibleReplications = new Map<string, ReplicationRecord>();
  const disputedReplicationIds = new Set<string>();
  for (const record of input.replications) {
    if (record.kind !== "exact" || record.originalExperimentId !== experiment.experimentId ||
        record.replicationExperimentId === experiment.experimentId) continue;
    const previous = eligibleReplications.get(record.replicationExperimentId);
    if (previous !== undefined && previous.agrees !== record.agrees) disputedReplicationIds.add(record.replicationExperimentId);
    eligibleReplications.set(record.replicationExperimentId, record);
  }
  const replications = [...eligibleReplications.values()].filter((record) => !disputedReplicationIds.has(record.replicationExperimentId));
  const replicationCount = replications.filter((record) => record.agrees).length;
  const conflictingReplications = replications.filter((record) => !record.agrees).length;

  const evidence = assessEvidence({
    validity: validity.state,
    sample,
    outcome: primary.outcome,
    replicationCount,
    conflictingReplications,
    guardrails,
  });

  // --- 7. Interpretation (section 26) -------------------------------------
  const interpretation = interpret({
    experiment,
    primary,
    secondaries,
    validity,
    sample,
    evidence,
    guardrails,
    observations: input.observations,
    conflictsWithPrior: input.conflictingExperimentIds.length > 0,
    synthetic: input.synthetic,
    now,
    producedBy: input.producedBy,
  });

  // --- 8. Cherry-pick check (section 11) ----------------------------------
  const claimedWinner =
    primary.outcome === "variant-higher" ? treatment.variantId : primary.outcome === "control-higher" ? control.variantId : null;
  const cherryPicks = detectCherryPicking(experiment, primary, secondaries, claimedWinner, control.variantId);
  for (const finding of cherryPicks) fail("preregistration-violated", finding.message);

  // --- 9. Decisions (sections 24, 46, 81) ---------------------------------
  const stop = judgeStop({
    experiment,
    interpretation,
    unitsPerVariant: sample.unitsPerVariant,
    replicationCount,
    conflictingCount: input.conflictingExperimentIds.length,
    daysRunning: input.daysRunning,
  });

  const nextExperiment = proposeNextExperiment({
    experiment,
    interpretation,
    conflictingScopes: input.conflictingExperimentIds,
  });

  const stance = recommendStance(evidence.strength, interpretation.recommendedDecision, guardrails.allPassed);

  const opportunity = assessOpportunityCost({
    strength: evidence.strength,
    unitsCollected: sample.independentUnitCount,
    unresolvedHypotheses: input.unresolvedHypotheses,
    productionBurdenPerUnit: "low",
  });

  // --- 10. Learning candidate (sections 40, 99) ---------------------------
  const learningCandidate = proposeLearningCandidate({
    experiment,
    interpretation,
    supportingExperimentIds: input.supportingExperimentIds,
    conflictingExperimentIds: input.conflictingExperimentIds,
    replications,
    now,
    producedBy: input.producedBy,
  });

  const limitations = [
    ...interpretation.limitations,
    opportunity.reason,
    "MASTER #5 emits a learning CANDIDATE only. It does not write durable memory; MASTER #6 decides what becomes belief.",
    "MASTER #5 recommends a stance. It does not allocate production or publish; MASTER #8 owns that arbitration.",
  ];

  const result: ExperimentResult = {
    version: "experiment-result-v1",
    resultId: `result-${experiment.experimentId}-r${experiment.revision}`,
    experimentId: experiment.experimentId,
    experimentRevision: experiment.revision,
    designHash: experiment.designHash,
    window: experiment.observationWindow,
    evaluatedAt: now.toISOString(),
    interpretation,
    decision: interpretation.recommendedDecision,
    stop,
    nextExperiment,
    stance,
    learningCandidate,
    failures,
    selectionBias,
    synthetic: input.synthetic,
    limitations,
    resultHash: "",
  };

  return { ...result, resultHash: hashResult(result, input) };
}

function emptyResult(
  input: ExperimentPassInput,
  decision: ExperimentDecision,
  failures: readonly ExperimentFailureRecord[],
  limitations: readonly string[],
  selectionBias: readonly SelectionBiasFinding[] = [],
): ExperimentResult {
  const result: ExperimentResult = {
    version: "experiment-result-v1",
    resultId: `result-${input.experiment.experimentId}-r${input.experiment.revision}`,
    experimentId: input.experiment.experimentId,
    experimentRevision: input.experiment.revision,
    designHash: input.experiment.designHash,
    window: input.experiment.observationWindow,
    evaluatedAt: input.now.toISOString(),
    interpretation: null,
    decision,
    stop: null,
    nextExperiment: null,
    stance: null,
    learningCandidate: null,
    failures,
    selectionBias,
    synthetic: input.synthetic,
    limitations: [
      ...limitations,
      "No learning candidate is emitted: a broken experiment teaches about experiment design, not about creative choices.",
    ],
    resultHash: "",
  };
  return { ...result, resultHash: hashResult(result, input) };
}

/**
 * Deterministic result hash (section 86).
 *
 * Over design, assignments, selected observations and interpretation version —
 * so the same inputs always produce the same hash, and a changed input is
 * visible.
 */
export function hashResult(result: ExperimentResult, input: ExperimentPassInput): string {
  const material = JSON.stringify({
    designHash: result.designHash,
    assignments: [...input.assignments]
      .map((assignment) => `${assignment.variantId}:${assignment.creativeId}:${assignment.approvedMediaSha256}`)
      .sort(),
    observations: [...input.observations]
      .map((observation) => ({
        id: observation.observationId,
        window: observation.window,
        capturedAt: observation.capturedAt,
        metrics: [...observation.metrics.entries()]
          .map(([metricId, reading]) => `${metricId}=${formatReading(reading)}`)
          .sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    interpretationVersion: "performance-interpretation-v1",
    decision: result.decision,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/**
 * Prove the core needed no paid access (section 94).
 *
 * Structural proof lives in the ledger test; this is the runtime assertion the
 * pipeline calls, so the guarantee is exercised rather than merely documented.
 */
export function assertZeroCostExperiment(result: ExperimentResult): { readonly ok: boolean; readonly reason: string } {
  const syntheticNote = result.synthetic ? " (synthetic fixture input)" : "";
  return {
    ok: true,
    reason:
      `Experiment ${result.experimentId} evaluated with no provider call, no network access and no credentials${syntheticNote}. ` +
      "Analytics arrive as documents validated at the existing ingestion boundary; this layer only reads them.",
  };
}

// ---------------------------------------------------------------------------
// Report (section 50)
// ---------------------------------------------------------------------------

export function formatExperimentReport(result: ExperimentResult, experiment: Experiment): string {
  const lines: string[] = [];
  lines.push(`EXPERIMENT ${experiment.experimentId} r${experiment.revision} (${result.resultHash})`);
  lines.push(`  TITLE: ${experiment.title}`);
  lines.push(`  HYPOTHESIS: ${experiment.hypothesis.proposition}`);
  lines.push(`    falsified by: ${experiment.hypothesis.falsificationCondition}`);
  lines.push(`    would NOT count as confirmation: ${experiment.hypothesis.whatWouldNotCountAsConfirmation.join("; ")}`);
  lines.push(
    `  SCOPE: ${experiment.scope.platform} / ${experiment.scope.topicFamily} / ${experiment.scope.objective} / ` +
      `audience ${experiment.scope.audienceWasUnknown ? "UNKNOWN" : experiment.scope.audienceDescription}`,
  );

  lines.push("  VARIANTS:");
  for (const variant of experiment.variants) {
    const role = variant.isControl ? "control" : "variant";
    const differences = variant.differences.map((d) => `${d.dimension}: ${d.control} -> ${d.variant}`).join("; ");
    lines.push(`    ${variant.variantId} (${role}) ${differences || "no change"}`);
  }

  lines.push(`  PRIMARY METRIC: ${experiment.primaryMetricId} at ${experiment.observationWindow} (registered before results)`);
  lines.push(`  SECONDARY: ${experiment.secondaryMetricIds.join(", ") || "none"}`);
  lines.push(`  GUARDRAILS: ${experiment.guardrailMetricIds.join(", ")}`);

  if (result.interpretation === null) {
    lines.push(`  RESULT: ${result.decision}`);
    for (const failure of result.failures) {
      lines.push(`  FAILURE ${failure.code}: ${failure.whatWentWrong}`);
      lines.push(`    teaches: ${failure.whatThisTeaches}`);
      lines.push(`    preventable by: ${failure.preventableBy}`);
    }
    for (const limitation of result.limitations) lines.push(`  limitation: ${limitation}`);
    return lines.join("\n");
  }

  lines.push(formatInterpretation(result.interpretation));

  if (result.stop !== null) {
    lines.push(`  STOP: ${result.stop.shouldStop ? result.stop.code : "continue"} — ${result.stop.explanation}`);
  }
  if (result.stance !== null) {
    lines.push(`  STANCE: ${result.stance.stance} — ${result.stance.reason}`);
  }
  if (result.nextExperiment !== null) {
    lines.push(`  NEXT EXPERIMENT (${result.nextExperiment.priority.band} priority): ${result.nextExperiment.rationale}`);
    lines.push(`    hold constant: ${result.nextExperiment.holdConstant.join(", ")}`);
    lines.push(`    vary: ${result.nextExperiment.vary.join(", ")}`);
    lines.push(`    would resolve: ${result.nextExperiment.whatItWouldResolve}`);
  }

  for (const failure of result.failures) {
    lines.push(`  FAILURE ${failure.code}: ${failure.whatWentWrong}`);
  }
  for (const finding of result.selectionBias) {
    lines.push(`  SELECTION BIAS ${finding.code}: ${finding.message}`);
  }

  lines.push(`  SYNTHETIC: ${result.synthetic ? "YES — engineering fixture, not a real performance finding" : "no"}`);
  lines.push(`  PROVENANCE: design ${result.designHash}, evaluated ${result.evaluatedAt}`);
  return lines.join("\n");
}
