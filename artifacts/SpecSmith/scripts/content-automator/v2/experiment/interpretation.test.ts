// MASTER #5 — Interpretation, validity, causal language and learning tests.
//
// These are the tests that decide whether this layer is a scientific brain or
// a results dashboard. The attacks:
//
//   - call a five-variable comparison a hook-form result
//   - promote one winning pair into a global rule
//   - let a secondary metric pick the winner
//   - learn "remove the estimate label" because it raised retention
//   - average two conflicting experiments into "slightly better"
//   - describe a result as being about beginners when nobody observed one

import { describe, expect, it } from "vitest";
import { runExperimentPass } from "./experimentPass.ts";

import {
  assessValidity,
  checkScopeClaims,
  invariantsHeld,
  MATERIAL_DURATION_RATIO,
} from "./validity.ts";
import {
  accountSample,
  assessEvidence,
  assessOutlier,
  compareMetric,
  detectCherryPicking,
  evaluateGuardrails,
  INDISTINGUISHABLE_RELATIVE_DIFFERENCE,
  type GuardrailResult,
} from "./comparison.ts";
import { causalPermission, diagnose, interpret, MINIMUM_VIEWS_TO_INTERPRET } from "./interpretation.ts";
import { metricsAreComparable } from "./metrics.ts";
import {
  accumulateEvidence,
  buildContradictionMatrix,
  classifyReplication,
  proposeLearningCandidate,
  recordFailure,
  type ContradictionEntry,
} from "./learning.ts";
import { assessOpportunityCost, judgeStop, proposeNextExperiment, recommendStance, scorePriority } from "./decision.ts";
import { countIndependentUnits } from "./assignment.ts";
import { buildObservation, ObservationStore } from "./observation.ts";
import { AssignmentLedger } from "./assignment.ts";
import { checkAgainstPreregistration, registerExperiment } from "./registry.ts";
import {
  FIXTURE_IDS,
  FIXTURE_PUBLISHED_AT,
  FIXTURE_SHAS,
  fixtureCleanExperiment,
  fixtureCleanShippedFacts,
  fixtureConfoundedShippedFacts,
  fixtureControlAnalytics,
  fixtureCorrelatedLineage,
  fixtureGuardrailsFailing,
  fixtureGuardrailsPassing,
  fixtureLineage,
  fixtureUnavailablePrimaryAnalytics,
  fixtureVariantAnalytics,
} from "./engineeringFixture.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;

function ledger(): AssignmentLedger {
  const store = new AssignmentLedger();
  const assignedAt = new Date("2026-08-31T12:00:00.000Z");
  store.bind({
    experimentId: FIXTURE_IDS.experimentId, experimentRevision: 1, variantId: FIXTURE_IDS.controlVariantId,
    creativeId: FIXTURE_IDS.controlCreativeId, creativeLineageId: FIXTURE_IDS.controlLineageId,
    platform: "youtube-shorts", packageId: FIXTURE_IDS.packageId, approvedMediaSha256: FIXTURE_SHAS.control,
    providerPostId: FIXTURE_IDS.controlPostId, publishedAt: FIXTURE_PUBLISHED_AT, now: assignedAt,
  });
  store.bind({
    experimentId: FIXTURE_IDS.experimentId, experimentRevision: 1, variantId: FIXTURE_IDS.variantId,
    creativeId: FIXTURE_IDS.variantCreativeId, creativeLineageId: FIXTURE_IDS.variantLineageId,
    platform: "youtube-shorts", packageId: FIXTURE_IDS.packageId, approvedMediaSha256: FIXTURE_SHAS.variant,
    providerPostId: FIXTURE_IDS.variantPostId, publishedAt: FIXTURE_PUBLISHED_AT, now: assignedAt,
  });
  return store;
}

function observations(variantAnalytics = fixtureVariantAnalytics()) {
  const assignments = ledger();
  const store = new ObservationStore();
  const control = store.record(
    buildObservation({
      analytics: fixtureControlAnalytics(), assignment: assignments.forCreative(FIXTURE_IDS.controlCreativeId)!,
      expectedWindow: "24h", synthetic: true, environment: ENGINEERING, now: NOW, producedBy: "test",
    }),
  );
  const variant = store.record(
    buildObservation({
      analytics: variantAnalytics, assignment: assignments.forCreative(FIXTURE_IDS.variantCreativeId)!,
      expectedWindow: "24h", synthetic: true, environment: ENGINEERING, now: NOW, producedBy: "test",
    }),
  );
  return { control: [control], variant: [variant], all: [control, variant] };
}

const experiment = () => registerExperiment(fixtureCleanExperiment(NOW), NOW).experiment;

function cleanValidity() {
  const facts = fixtureCleanShippedFacts();
  return assessValidity({
    experiment: experiment(),
    control: facts.get(FIXTURE_IDS.controlVariantId)!,
    variant: facts.get(FIXTURE_IDS.variantId)!,
    observations: observations().all,
    lineage: fixtureLineage(),
    window: "24h",
  });
}

function confoundedValidity() {
  const facts = fixtureConfoundedShippedFacts();
  return assessValidity({
    experiment: experiment(),
    control: facts.get(FIXTURE_IDS.controlVariantId)!,
    variant: facts.get(FIXTURE_IDS.variantId)!,
    observations: observations().all,
    lineage: fixtureLineage(),
    window: "24h",
  });
}

describe("confounding detection is the central responsibility", () => {
  it("calls a single-variable comparison clean", () => {
    const validity = cleanValidity();
    expect(validity.state).toBe("clean-controlled");
    expect(validity.isMultiFactor).toBe(false);
    expect(validity.causalReadingPermitted).toBe(true);
  });

  it("refuses to call a five-variable comparison a hook-form result", () => {
    const validity = confoundedValidity();
    expect(validity.state).toBe("confounded");
    expect(validity.isMultiFactor).toBe(true);
    expect(validity.causalReadingPermitted).toBe(false);
    expect(validity.explanation).toMatch(/NOT attributable to any single one of them/);
  });

  it("treats a topic change as fatal, because topic swamps execution", () => {
    const validity = confoundedValidity();
    const topic = validity.confounders.find((c) => c.dimension === "topicId");
    expect(topic?.severity).toBe("fatal");
    expect(topic?.explanation).toMatch(/No creative conclusion survives a topic change/);
  });

  it("flags a materially different duration", () => {
    const validity = confoundedValidity();
    const duration = validity.confounders.find((c) => c.dimension === "durationSeconds");
    expect(duration).toBeDefined();
    expect(duration?.explanation).toContain(`${Math.round(MATERIAL_DURATION_RATIO * 100)}%`);
  });

  it("flags dimensions that changed without being declared", () => {
    const validity = confoundedValidity();
    expect(validity.undeclaredChanges).toContain("caption-density");
    expect(validity.undeclaredChanges).toContain("pacing");
  });

  it("lists alternative explanations and never picks one", () => {
    const validity = confoundedValidity();
    expect(validity.alternativeExplanations.length).toBeGreaterThan(2);
    expect(validity.alternativeExplanations.join(" ")).toMatch(/Random variation/);
    expect(validity.alternativeExplanations.join(" ")).toMatch(/different days of the week/);
  });

  it("detects invariants that did not hold", () => {
    const facts = fixtureConfoundedShippedFacts();
    const breaches = invariantsHeld(fixtureCleanExperiment(NOW).invariants, facts.get(FIXTURE_IDS.variantId)!);
    expect(breaches.join(" ")).toMatch(/topic/);
  });
});

describe("comparison refuses to force a winner", () => {
  it("reports a direction on a clean comparison", () => {
    const obs = observations();
    const comparison = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    expect(comparison.outcome).toBe("variant-higher");
    expect(comparison.explanation).toMatch(/not a general finding/);
  });

  it("reports indistinguishable rather than a tiny direction", () => {
    const obs = observations(fixtureVariantAnalytics({ stayedToWatchRate: 0.56 }));
    const comparison = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    expect(comparison.outcome).toBe("indistinguishable");
    expect(comparison.explanation).toMatch(/This is a null result, which is a result/);
    expect(Math.abs(comparison.relativeDifference!)).toBeLessThan(INDISTINGUISHABLE_RELATIVE_DIFFERENCE);
  });

  it("reports unavailable rather than treating a missing metric as zero", () => {
    const obs = observations(fixtureUnavailablePrimaryAnalytics());
    const comparison = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    expect(comparison.outcome).toBe("comparison-unavailable");
    expect(comparison.variantMean).toBeNull();
    expect(comparison.explanation).toMatch(/not zero, so no comparison is produced rather than a fabricated loss/);
  });

  it("marks a confounded comparison as confounded even with real numbers", () => {
    const obs = observations();
    const comparison = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "confounded",
    });
    expect(comparison.outcome).toBe("comparison-confounded");
    expect(comparison.controlMean).toBe(0.54);
  });
});

describe("sample size is never inflated", () => {
  it("reduces four placements to two units", () => {
    const obs = observations();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureCorrelatedLineage()), experiment());
    expect(sample.rawObservationCount).toBe(2);
    expect(sample.independentUnitCount).toBe(2);
    expect(sample.explanation).toMatch(/never counted as separate samples/);
  });

  it("reports when the minimum is not met", () => {
    const obs = observations();
    const demanding = { ...experiment(), minimumEvidence: { minimumIndependentUnitsPerVariant: 3, minimumReplications: 1, explanation: "x" } };
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), demanding);
    expect(sample.meetsMinimum).toBe(false);
    expect(sample.explanation).toMatch(/no variant may be declared a winner/);
  });
});

describe("guardrails override performance", () => {
  it("passes when every guardrail passes", () => {
    expect(evaluateGuardrails(fixtureGuardrailsPassing()).allPassed).toBe(true);
  });

  it("cancels a win when a required caveat was dropped", () => {
    const verdict = evaluateGuardrails(fixtureGuardrailsFailing());
    expect(verdict.allPassed).toBe(false);
    expect(verdict.explanation).toMatch(/Performance never authorises lower integrity/);
  });

  it("yields no usable evidence when a guardrail failed", () => {
    const obs = observations();
    const assessment = assessEvidence({
      validity: "clean-controlled",
      sample: accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment()),
      outcome: "variant-higher",
      replicationCount: 3,
      conflictingReplications: 0,
      guardrails: evaluateGuardrails(fixtureGuardrailsFailing()),
    });
    expect(assessment.strength).toBe("insufficient");
  });

  it("does NOT learn to remove an estimate label even when retention rose", () => {
    const obs = observations();
    const validity = cleanValidity();
    const interpretation = interpret({
      experiment: experiment(),
      primary: compareMetric({
        metricId: "stayed-to-watch-rate", window: "24h",
        controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
      }),
      secondaries: [],
      validity,
      sample: accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment()),
      evidence: assessEvidence({
        validity: "clean-controlled",
        sample: accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment()),
        outcome: "variant-higher", replicationCount: 0, conflictingReplications: 0,
        guardrails: evaluateGuardrails(fixtureGuardrailsFailing()),
      }),
      guardrails: evaluateGuardrails(fixtureGuardrailsFailing()),
      observations: obs.all,
      conflictsWithPrior: false, synthetic: true, now: NOW, producedBy: "test",
    });

    expect(interpretation.recommendedDecision).toBe("blocked-by-guardrail");
    expect(interpretation.canInfer.join(" ")).toMatch(/Nothing in favour of the variant/);
    expect(interpretation.widestJustifiedGeneralization).toBeNull();

    const candidate = proposeLearningCandidate({
      experiment: experiment(), interpretation,
      supportingExperimentIds: [], conflictingExperimentIds: [], replications: [], now: NOW, producedBy: "test",
    });
    expect(candidate.recommendedMemoryAction).toBe("do-not-store");
    expect(candidate.proposition).toMatch(/must not be reused regardless of its performance/);
  });

  it("recommends abandoning a direction that failed a guardrail", () => {
    const stance = recommendStance("strong-within-scope", "blocked-by-guardrail", false);
    expect(stance.stance).toBe("abandon");
    expect(stance.reason).toMatch(/integrity is not tradeable/);
  });
});

describe("the causal language gate defaults conservative", () => {
  it("permits only observation language on a confounded result", () => {
    const permission = causalPermission("confounded", "anecdotal", "variant-higher", evaluateGuardrails(fixtureGuardrailsPassing()));
    expect(permission.strength).toBe("comparative-within-experiment");
    expect(permission.forbiddenPhrasings.join(" ")).toMatch(/improved/);
  });

  it("forbids unscoped claims at every strength", () => {
    for (const strength of ["anecdotal", "directional", "replicated", "strong-within-scope"] as const) {
      const permission = causalPermission("clean-controlled", strength, "variant-higher", evaluateGuardrails(fixtureGuardrailsPassing()));
      expect(permission.forbiddenPhrasings.join(" "), strength).toMatch(/"X is better"/);
    }
  });

  it("reaches causal-within-scope only when replicated and controlled", () => {
    const passing = evaluateGuardrails(fixtureGuardrailsPassing());
    expect(causalPermission("clean-controlled", "replicated", "variant-higher", passing).strength).toBe("causal-within-scope");
    expect(causalPermission("clean-controlled", "replication-needed", "variant-higher", passing).strength).toBe("directional-within-scope");
    expect(causalPermission("clean-controlled", "anecdotal", "variant-higher", passing).strength).toBe("comparative-within-experiment");
  });

  it("refuses to average conflicting evidence into a direction", () => {
    const permission = causalPermission("clean-controlled", "conflicting", "variant-higher", evaluateGuardrails(fixtureGuardrailsPassing()));
    expect(permission.strength).toBe("observation-only");
    expect(permission.forbiddenPhrasings.join(" ")).toMatch(/averages the conflicting results/);
  });
});

describe("interpretation always states what it cannot show", () => {
  function interpretation(validityState: "clean" | "confounded") {
    const obs = observations();
    const validity = validityState === "clean" ? cleanValidity() : confoundedValidity();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const guardrails = evaluateGuardrails(fixtureGuardrailsPassing());
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: validity.state,
    });
    return interpret({
      experiment: experiment(), primary, secondaries: [], validity, sample,
      evidence: assessEvidence({
        validity: validity.state, sample, outcome: primary.outcome,
        replicationCount: 0, conflictingReplications: 0, guardrails,
      }),
      guardrails, observations: obs.all, conflictsWithPrior: false,
      synthetic: true, now: NOW, producedBy: "test",
    });
  }

  it("never leaves cannotInfer empty", () => {
    expect(interpretation("clean").cannotInfer.length).toBeGreaterThan(3);
    expect(interpretation("confounded").cannotInfer.length).toBeGreaterThan(3);
  });

  it("always denies other platforms, topics and objectives", () => {
    const text = interpretation("clean").cannotInfer.join(" ");
    expect(text).toMatch(/any platform other than youtube-shorts/i);
    expect(text).toMatch(/topics outside/);
    expect(text).toMatch(/objectives other than/);
  });

  it("denies attribution to the variable on a confounded result", () => {
    expect(interpretation("confounded").cannotInfer.join(" ")).toMatch(/could be responsible/);
  });

  it("asks counterfactual questions without answering them", () => {
    const counterfactuals = interpretation("clean").counterfactuals;
    expect(counterfactuals.length).toBeGreaterThan(2);
    expect(counterfactuals.join(" ")).toMatch(/What result would have changed the decision/);
    expect(counterfactuals.join(" ")).toMatch(/Would the opposite result have been believed as readily/);
  });

  it("records that no significance was computed", () => {
    expect(interpretation("clean").limitations.join(" ")).toMatch(/No statistical significance is computed/);
  });

  it("recommends replication rather than reuse after one clean result", () => {
    expect(interpretation("clean").recommendedDecision).toBe("replicate");
  });
});

describe("cherry-picking is detected", () => {
  it("catches a winner claimed when the primary metric shows no direction", () => {
    const obs = observations(fixtureVariantAnalytics({ stayedToWatchRate: 0.56 }));
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    const secondary = compareMetric({
      metricId: "saves", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    const findings = detectCherryPicking(experiment(), primary, [secondary], FIXTURE_IDS.variantId, FIXTURE_IDS.controlVariantId);
    expect(findings.map((f) => f.code)).toContain("winner-without-primary-direction");
    expect(findings[0].message).toMatch(/cherry-pick the primary metric was registered in advance to prevent/);
  });

  it("catches a winner that contradicts the primary metric", () => {
    const obs = observations();
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    const findings = detectCherryPicking(experiment(), primary, [], FIXTURE_IDS.controlVariantId, FIXTURE_IDS.controlVariantId);
    expect(findings.map((f) => f.code)).toContain("winner-contradicts-primary-metric");
  });

  it("accepts a winner that the primary metric supports", () => {
    const obs = observations();
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    expect(detectCherryPicking(experiment(), primary, [], FIXTURE_IDS.variantId, FIXTURE_IDS.controlVariantId)).toEqual([]);
  });
});

describe("scope survives the experiment", () => {
  it("refuses a claim about another platform", () => {
    const violations = checkScopeClaims(experiment(), {
      platforms: ["youtube-shorts", "tiktok"], audienceDescription: null, objective: null, topicFamily: null,
    });
    expect(violations.map((v) => v.code)).toContain("platform-scope-exceeded");
  });

  it("refuses an invented audience when the audience was unknown", () => {
    const unknownAudience = { ...experiment(), scope: { ...experiment().scope, audienceWasUnknown: true } };
    const violations = checkScopeClaims(unknownAudience, {
      platforms: ["youtube-shorts"], audienceDescription: "beginners", objective: null, topicFamily: null,
    });
    expect(violations.map((v) => v.code)).toContain("audience-scope-invented");
    expect(violations[0].message).toMatch(/cannot be the subject of a finding/);
  });

  it("refuses a claim about another objective", () => {
    const violations = checkScopeClaims(experiment(), {
      platforms: ["youtube-shorts"], audienceDescription: null, objective: "drive-builder-usage", topicFamily: null,
    });
    expect(violations.map((v) => v.code)).toContain("objective-scope-exceeded");
  });
});

describe("replication is scoped", () => {
  it("treats a platform replication as extending scope, not confirming", () => {
    const original = experiment();
    const other = { ...original, experimentId: "other", scope: { ...original.scope, platform: "tiktok" as const } };
    const record = classifyReplication(original, other, true);
    expect(record.kind).toBe("platform");
    expect(record.explanation).toMatch(/does NOT confirm/);
  });

  it("treats a topic replication as the most informative kind", () => {
    const original = experiment();
    const other = { ...original, experimentId: "other", scope: { ...original.scope, topicFamily: "other-topic" } };
    const record = classifyReplication(original, other, true);
    expect(record.kind).toBe("topic");
    expect(record.explanation).toMatch(/most informative replication available/);
  });

  it("refuses to treat an unrelated experiment as a replication", () => {
    const original = experiment();
    const other = { ...original, experimentId: "other", primaryMetricId: "saves", hypothesis: { ...original.hypothesis, primaryMetricId: "saves" } };
    expect(classifyReplication(original, other, true).kind).toBe("not-a-replication");
  });
});

describe("contradictions are preserved, never averaged", () => {
  function entry(id: string, stance: ContradictionEntry["stance"], topicFamily: string): ContradictionEntry {
    return {
      experimentId: id, stance, validity: "clean-controlled",
      scope: { ...experiment().scope, topicFamily },
      explanation: "fixture",
    };
  }

  it("records a conflict rather than resolving it", () => {
    const matrix = buildContradictionMatrix("hyp-1", [
      entry("exp-1", "supports", "topic-a"),
      entry("exp-2", "contradicts", "topic-b"),
    ]);
    expect(matrix.hasConflict).toBe(true);
    expect(matrix.explanation).toMatch(/These are NOT averaged/);
  });

  it("proposes the axis that could explain the disagreement", () => {
    const matrix = buildContradictionMatrix("hyp-1", [
      entry("exp-1", "supports", "topic-a"),
      entry("exp-2", "contradicts", "topic-b"),
    ]);
    expect(matrix.discriminatingQuestions.join(" ")).toMatch(/Does topic family explain it/);
    expect(matrix.discriminatingQuestions.join(" ")).toMatch(/Is it noise/);
  });

  it("names untested scopes as unknown rather than assuming them", () => {
    const map = accumulateEvidence([entry("exp-1", "supports", "topic-a")], ["tiktok / topic-a", "instagram-reels / topic-a"]);
    expect(map.unknownIn).toHaveLength(2);
    expect(map.explanation).toMatch(/an untested scope is unknown/);
  });
});

describe("learning candidates stay narrow", () => {
  function candidateFor(strength: "one-result" | "replicated") {
    const obs = observations();
    const validity = cleanValidity();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const guardrails = evaluateGuardrails(fixtureGuardrailsPassing());
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    const replications = strength === "replicated"
      ? [{ originalExperimentId: "a", replicationExperimentId: "b", kind: "topic" as const, agrees: true, extendsScope: true, explanation: "x" }]
      : [];
    const interpretation = interpret({
      experiment: experiment(), primary, secondaries: [], validity, sample,
      evidence: assessEvidence({
        validity: "clean-controlled", sample, outcome: primary.outcome,
        replicationCount: replications.length, conflictingReplications: 0, guardrails,
      }),
      guardrails, observations: obs.all, conflictsWithPrior: false,
      synthetic: true, now: NOW, producedBy: "test",
    });
    return proposeLearningCandidate({
      experiment: experiment(), interpretation,
      supportingExperimentIds: [], conflictingExperimentIds: [], replications, now: NOW, producedBy: "test",
    });
  }

  it("does not promote one winning pair to a global rule", () => {
    const candidate = candidateFor("one-result");
    expect(candidate.generalizationLevel).not.toBe("global");
    expect(candidate.generalizationLevel).not.toBe("cross-platform");
    expect(candidate.recommendedMemoryAction).toBe("store-as-directional");
  });

  it("always lists prohibited overgeneralizations", () => {
    const candidate = candidateFor("one-result");
    expect(candidate.prohibitedOvergeneralizations.length).toBeGreaterThan(3);
    expect(candidate.prohibitedOvergeneralizations.join(" ")).toMatch(/is better" — unscoped/);
    expect(candidate.prohibitedOvergeneralizations.join(" ")).toMatch(/platforms other than youtube-shorts/);
  });

  it("does not claim cross-platform without a platform replication", () => {
    const candidate = candidateFor("replicated");
    expect(candidate.generalizationLevel).not.toBe("cross-platform");
  });

  it("writes the proposition at the level the evidence supports", () => {
    expect(candidateFor("one-result").proposition).toMatch(/For SYNTHETIC_ENGINEERING_FIXTURE-gpu-comparison content on youtube-shorts/);
  });

  it("marks a synthetic candidate as never for production memory", () => {
    expect(candidateFor("one-result").caveats.join(" ")).toMatch(/never enter production memory/);
  });
});

describe("failures and nulls are recorded", () => {
  it("records a failure with what it teaches", () => {
    const failure = recordFailure({
      experiment: experiment(), code: "too-many-variables-changed",
      detail: "five dimensions changed", now: NOW, synthetic: true,
    });
    expect(failure.whatThisTeaches).toMatch(/real difference that explains nothing/);
    expect(failure.preventableBy).toMatch(/Declare exactly one controlled difference/);
  });

  it("treats a null result as evidence rather than a failure", () => {
    const obs = observations(fixtureVariantAnalytics({ stayedToWatchRate: 0.56 }));
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const assessment = assessEvidence({
      validity: "clean-controlled", sample, outcome: "indistinguishable",
      replicationCount: 0, conflictingReplications: 0, guardrails: evaluateGuardrails(fixtureGuardrailsPassing()),
    });
    expect(assessment.explanation).toMatch(/A null result is evidence/);
    expect(assessment.explanation).toMatch(/not evidence that it never matters anywhere/);
  });
});

describe("stopping rules are declared in advance", () => {
  function interpretationFor(guardrails: readonly GuardrailResult[]) {
    const obs = observations();
    const validity = cleanValidity();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const verdict = evaluateGuardrails(guardrails);
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: "clean-controlled",
    });
    return interpret({
      experiment: experiment(), primary, secondaries: [], validity, sample,
      evidence: assessEvidence({
        validity: "clean-controlled", sample, outcome: primary.outcome,
        replicationCount: 0, conflictingReplications: 0, guardrails: verdict,
      }),
      guardrails: verdict, observations: obs.all, conflictsWithPrior: false,
      synthetic: true, now: NOW, producedBy: "test",
    });
  }

  it("stops immediately on a guardrail failure", () => {
    const judgment = judgeStop({
      experiment: experiment(), interpretation: interpretationFor(fixtureGuardrailsFailing()),
      unitsPerVariant: new Map(), replicationCount: 0, conflictingCount: 0, daysRunning: 1,
    });
    expect(judgment.shouldStop).toBe(true);
    expect(judgment.code).toBe("guardrail-failure");
    expect(judgment.permitted).toBe(true);
  });

  it("does not stop because early numbers look good", () => {
    const judgment = judgeStop({
      experiment: { ...experiment(), minimumEvidence: { minimumIndependentUnitsPerVariant: 5, minimumReplications: 2, explanation: "x" } },
      interpretation: interpretationFor(fixtureGuardrailsPassing()),
      unitsPerVariant: new Map([[FIXTURE_IDS.controlVariantId, 1], [FIXTURE_IDS.variantId, 1]]),
      replicationCount: 0, conflictingCount: 0, daysRunning: 2,
    });
    expect(judgment.shouldStop).toBe(false);
    expect(judgment.explanation).toMatch(/exciting early number is explicitly not a reason to stop/);
  });
});

describe("the next experiment reduces uncertainty", () => {
  it("proposes holding the confounder constant", () => {
    const obs = observations();
    const validity = confoundedValidity();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const guardrails = evaluateGuardrails(fixtureGuardrailsPassing());
    const primary = compareMetric({
      metricId: "stayed-to-watch-rate", window: "24h",
      controlObservations: obs.control, variantObservations: obs.variant, validity: validity.state,
    });
    const interpretation = interpret({
      experiment: experiment(), primary, secondaries: [], validity, sample,
      evidence: assessEvidence({ validity: validity.state, sample, outcome: primary.outcome, replicationCount: 0, conflictingReplications: 0, guardrails }),
      guardrails, observations: obs.all, conflictsWithPrior: false, synthetic: true, now: NOW, producedBy: "test",
    });
    const proposal = proposeNextExperiment({ experiment: experiment(), interpretation, conflictingScopes: [] });
    expect(proposal.holdConstant).toContain("topicId");
    expect(proposal.whatItWouldResolve).toMatch(/intended to answer and did not/);
  });

  it("explains its priority heuristic rather than scoring opaquely", () => {
    const priority = scorePriority({ uncertainty: "high", isolationPossible: true, strategicRelevance: "high", cost: "low" });
    expect(priority.band).toBe("high");
    expect(priority.heuristicExplanation).toMatch(/not expected-value mathematics/);
    expect(priority.considerations.length).toBe(4);
  });

  it("always defers volume decisions to executive arbitration", () => {
    for (const strength of ["anecdotal", "directional", "replicated", "strong-within-scope", "conflicting"] as const) {
      expect(recommendStance(strength, "replicate", true).requiresExecutiveArbitration, strength).toBe(true);
    }
  });

  it("stops investing when several units produced no direction", () => {
    const assessment = assessOpportunityCost({
      strength: "anecdotal", unitsCollected: 8, unresolvedHypotheses: 2, productionBurdenPerUnit: "low",
    });
    expect(assessment.worthContinuing).toBe(false);
    expect(assessment.reason).toMatch(/small relative to the noise/);
  });
});

describe("diagnosis is descriptive, not causal", () => {
  it("refuses to interpret rates below a reach threshold", () => {
    const assignments = ledger();
    const observation = buildObservation({
      analytics: fixtureControlAnalytics({ views: 40 }),
      assignment: assignments.forCreative(FIXTURE_IDS.controlCreativeId)!,
      expectedWindow: "24h", synthetic: true, environment: ENGINEERING, now: NOW, producedBy: "test",
    });
    const result = diagnose(observation);
    expect(result.diagnosis).toBe("insufficient-reach-to-interpret");
    expect(result.explanation).toContain(String(MINIMUM_VIEWS_TO_INTERPRET - (MINIMUM_VIEWS_TO_INTERPRET - 40)));
  });

  it("locates where attention was lost without blaming the hook", () => {
    const assignments = ledger();
    const observation = buildObservation({
      analytics: fixtureControlAnalytics({ stayedToWatchRate: 0.25 }),
      assignment: assignments.forCreative(FIXTURE_IDS.controlCreativeId)!,
      expectedWindow: "24h", synthetic: true, environment: ENGINEERING, now: NOW, producedBy: "test",
    });
    const result = diagnose(observation);
    expect(result.diagnosis).toBe("weak-opening");
    expect(result.explanation).toMatch(/does not establish that the hook form is why/);
  });
});

describe("outliers are flagged, not universalised", () => {
  it("reports no baseline rather than calling a result normal", () => {
    const assessment = assessOutlier(5000, [], null, NOW);
    expect(assessment.state).toBe("no-baseline");
    expect(assessment.explanation).toMatch(/has no referent/);
  });

  it("flags an extreme result for replication rather than acting on it", () => {
    const assessment = assessOutlier(5000, [400, 500, 600], NOW.toISOString(), NOW);
    expect(assessment.state).toBe("outlier-needs-replication");
    expect(assessment.explanation).toMatch(/novelty alone/);
  });

  it("treats a stale baseline as no baseline", () => {
    const assessment = assessOutlier(5000, [400, 500], "2026-01-01T00:00:00.000Z", NOW);
    expect(assessment.state).toBe("no-baseline");
    expect(assessment.explanation).toMatch(/cannot establish what is normal now/);
  });
});

// ---------------------------------------------------------------------------
// Guards that nothing else reached
//
// Each of these was a negative control that broke no test when its guard was
// disabled — which means the guard was not load-bearing, whatever the source
// said. These exercise them directly.
// ---------------------------------------------------------------------------

describe("guards that need direct exercise", () => {
  it("refuses cross-platform metric comparison at the registry level", () => {
    // compareMetric has its own platform check, so this one was unreached.
    const same = metricsAreComparable(
      { platform: "youtube-shorts", metricId: "stayed-to-watch-rate" },
      { platform: "youtube-shorts", metricId: "stayed-to-watch-rate" },
    );
    expect(same.comparable).toBe(true);

    const cross = metricsAreComparable(
      { platform: "youtube-shorts", metricId: "stayed-to-watch-rate" },
      { platform: "tiktok", metricId: "stayed-to-watch-rate" },
    );
    expect(cross.comparable).toBe(false);
    expect(cross.reason).toMatch(/no justified normalization exists/);

    const different = metricsAreComparable(
      { platform: "tiktok", metricId: "saves" },
      { platform: "tiktok", metricId: "shares" },
    );
    expect(different.comparable).toBe(false);
  });

  it("catches a design change that only the hash can see", () => {
    // The named checks cover metric, window and variants. A change to the
    // invariants or the minimum-evidence rule is caught by nothing else.
    const { experiment: registeredExp, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);

    const loosened = {
      ...registeredExp,
      minimumEvidence: { minimumIndependentUnitsPerVariant: 1, minimumReplications: 0, explanation: "loosened after the fact" },
    };
    const check = checkAgainstPreregistration(loosened, preregistration);
    expect(check.matches).toBe(false);
    expect(check.findings.map((f) => f.code)).toContain("design-hash-mismatch");
    expect(check.findings.find((f) => f.code === "design-hash-mismatch")?.message)
      .toMatch(/requires a new revision, not an edit/);
  });

  it("catches a controlled-difference value edited after registration", () => {
    const { experiment: registeredExp, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    const edited = {
      ...registeredExp,
      variants: registeredExp.variants.map((variant) =>
        variant.isControl
          ? variant
          : { ...variant, differences: [{ ...variant.differences[0], variant: "something-else" }] },
      ),
    };
    expect(checkAgainstPreregistration(edited, preregistration).findings.map((f) => f.code))
      .toContain("design-hash-mismatch");
  });

  it("refuses analytics carrying the wrong package id", () => {
    const assignments = ledger();
    expect(() =>
      buildObservation({
        analytics: { ...fixtureControlAnalytics(), packageId: "a-different-package" },
        assignment: assignments.forCreative(FIXTURE_IDS.controlCreativeId)!,
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(/Performance must bind to the exact package that shipped/);
  });

  it("reports conflicting evidence rather than averaging it into a direction", () => {
    const obs = observations();
    const sample = accountSample(obs.all, countIndependentUnits(fixtureLineage()), experiment());
    const assessment = assessEvidence({
      validity: "clean-controlled",
      sample,
      outcome: "variant-higher",
      // Two replications agree, one points the other way. A naive summary would
      // call this "mostly supported"; the honest state is that it conflicts.
      replicationCount: 2,
      conflictingReplications: 1,
      guardrails: evaluateGuardrails(fixtureGuardrailsPassing()),
    });
    expect(assessment.strength).toBe("conflicting");
    expect(assessment.reasons.join(" ")).toMatch(/never averaged into a middle position/);
    expect(assessment.explanation).toMatch(/not a summary that hides it/);
  });
});


describe("independent audit: full experiment pass evidence boundaries", () => {
  function evaluate(replications: import("./learning.ts").ReplicationRecord[] = [], change = "registered", minimum = 1) {
    const definition = fixtureCleanExperiment(NOW);
    const registered = registerExperiment({ ...definition, minimumEvidence: { ...definition.minimumEvidence, minimumIndependentUnitsPerVariant: minimum } }, NOW);
    const facts = new Map(fixtureCleanShippedFacts());
    const treatment = facts.get(FIXTURE_IDS.variantId)!;
    if (change !== "registered") {
      const values = { ...treatment.dimensionValues };
      if (change === "missing") delete values["hook-form"];
      else values["hook-form"] = change;
      facts.set(FIXTURE_IDS.variantId, { ...treatment, dimensionValues: values });
    }
    return runExperimentPass({
      experiment: registered.experiment, preregistration: registered.preregistration,
      assignments: ledger().all(), observations: observations().all, lineage: fixtureLineage(),
      shippedFacts: facts, guardrailResults: fixtureGuardrailsPassing(), replications,
      conflictingExperimentIds: [], supportingExperimentIds: [], daysRunning: 2,
      unresolvedHypotheses: 1, synthetic: true, now: NOW, producedBy: "independent-audit",
    });
  }
  const replication = (kind: import("./learning.ts").ReplicationKind, id = "independent-1", agrees = true): import("./learning.ts").ReplicationRecord => ({
    originalExperimentId: FIXTURE_IDS.experimentId, replicationExperimentId: id,
    kind, agrees, extendsScope: kind !== "exact", explanation: "Synthetic audit fixture",
  });

  it.each(["not-a-replication", "platform", "topic", "audience", "mission-family"] as const)("does not promote %s into confirmation of the original scope", (kind) => {
    const result = evaluate([replication(kind), replication(kind, "independent-2")]);
    expect(result.interpretation!.evidence.strength).toBe("replication-needed");
    expect(result.decision).toBe("replicate");
    expect(result.learningCandidate!.recommendedMemoryAction).not.toBe("store-as-replicated");
  });
  it("does not classify a different window or changed values as the same hypothesis", () => {
    const original = fixtureCleanExperiment(NOW);
    const candidate = { ...original, experimentId: "independent-candidate" };
    expect(classifyReplication(original, { ...candidate, observationWindow: "72h" }, true).kind).toBe("not-a-replication");
    const variants = candidate.variants.map((variant) => ({ ...variant, differences: variant.differences.map((difference) => ({ ...difference, variant: "different-treatment" })) }));
    expect(classifyReplication(original, { ...candidate, variants }, true).kind).toBe("not-a-replication");
    expect(classifyReplication(original, original, true).kind).toBe("not-a-replication");
  });
  it("does not permit causal language for a partially controlled replicated result", () => {
    expect(causalPermission("partially-controlled", "replicated", "variant-higher", evaluateGuardrails(fixtureGuardrailsPassing())).strength).toBe("directional-within-scope");
  });
  it("counts duplicate confirmations only once", () => {
    expect(evaluate([replication("exact"), replication("exact")]).interpretation!.evidence.strength).toBe("replicated");
  });
  it("rejects self-confirmation and records targeting another experiment", () => {
    const other = { ...replication("exact"), originalExperimentId: "other-experiment" };
    expect(evaluate([replication("exact", FIXTURE_IDS.experimentId), other]).decision).toBe("replicate");
  });
  it("does not count contradictory replays as confirmation", () => {
    expect(evaluate([replication("exact"), replication("exact", "independent-1", false)]).decision).toBe("replicate");
  });
  it("retains independent same-scope confirmation", () => {
    const result = evaluate([replication("exact")]);
    expect(result.interpretation!.evidence.strength).toBe("replicated");
    expect(result.decision).toBe("exploit-cautiously");
    expect(result.learningCandidate!.proposition).toContain("appears to have raised");
  });
  it.each(["question-first", "missing", "unregistered-value"])("refuses a controlled reading when shipped change is %s", (change) => {
    const result = evaluate([replication("exact")], change);
    expect(result.interpretation!.validity.state).toBe("invalid");
    expect(result.decision).toBe("invalidated");
    expect(result.learningCandidate!.recommendedMemoryAction).toBe("do-not-store");
  });
  it.each([1, 2])("keeps unreplicated learning descriptive at minimum %s", (minimum) => {
    const result = evaluate([], "registered", minimum);
    expect(result.learningCandidate!.proposition).not.toMatch(/\b(raised|lowered|improved)\b/);
    expect(result.learningCandidate!.proposition).toContain("comparison produced");
  });
});
