// MASTER #5 — Learning candidates, replication, contradiction and failure
// (sections 21, 38, 39, 40, 41, 42, 43, 79, 80, 81, 99).
//
// MASTER #5 does not write memory. It emits CANDIDATES — proposals with their
// evidence, their scope, their caveats and an explicit list of the
// overgeneralizations that must not be made from them. MASTER #6 decides what
// becomes durable belief. That boundary matters: a system that writes its own
// beliefs from its own results has no independent check on what it comes to
// think, and the failure compounds silently.
//
// The contradiction rules are the other half. When two experiments disagree,
// the wrong move is to average them into "slightly better" — which describes
// neither and cannot be argued with. The right move is to record the conflict,
// ask what differed between them, and design the experiment that would tell
// those explanations apart.
//
// Failures and nulls are first class. An experiment that broke teaches
// something about how to run experiments; a null teaches that a dimension may
// not matter much in this scope. Discarding either leaves only wins, and a
// record of only wins is indistinguishable from not having learned anything.

import {
  generalizationPermitted,
  widestPermittedGeneralization,
  type EvidenceStrength,
  type Experiment,
  type ExperimentScope,
  type GeneralizationLevel,
  type ValidityState,
} from "./model.ts";
import type { PerformanceInterpretation } from "./interpretation.ts";
import { checkScopeClaims, type ScopeViolation } from "./validity.ts";

// ---------------------------------------------------------------------------
// Replication (section 21)
// ---------------------------------------------------------------------------

/**
 * What kind of replication an experiment provides for another.
 *
 * The distinction carries weight: a TikTok replication does NOT validate a
 * YouTube finding, it establishes a separate TikTok finding. Treating it as
 * confirmation is how a platform-specific result becomes a house rule.
 */
export type ReplicationKind =
  /** Same everything. Tests reliability, not generality. */
  | "exact"
  /** Same design, different topic. The most useful kind here. */
  | "topic"
  /** Same design, different audience. */
  | "audience"
  /** Same design, different platform. Establishes THAT platform separately. */
  | "platform"
  /** Same design, different mission family. */
  | "mission-family"
  /** Not a replication of this hypothesis at all. */
  | "not-a-replication";

export const REPLICATION_KINDS: readonly ReplicationKind[] = [
  "exact", "topic", "audience", "platform", "mission-family", "not-a-replication",
];

export interface ReplicationRecord {
  readonly originalExperimentId: string;
  readonly replicationExperimentId: string;
  readonly kind: ReplicationKind;
  readonly agrees: boolean;
  /** Whether this replication widens the scope of the original finding. */
  readonly extendsScope: boolean;
  readonly explanation: string;
}

/**
 * Classify one experiment as a replication of another.
 *
 * Deliberately conservative about `exact`: identical scope on every axis is
 * required, because anything less is a different test wearing the same name.
 */
export function classifyReplication(
  original: Experiment,
  candidate: Experiment,
  agrees: boolean,
): ReplicationRecord {
  const base = { originalExperimentId: original.experimentId, replicationExperimentId: candidate.experimentId, agrees };

  const sameHypothesis =
    original.hypothesis.primaryMetricId === candidate.hypothesis.primaryMetricId &&
    normalizedDimensions(original) === normalizedDimensions(candidate);

  if (!sameHypothesis) {
    return {
      ...base,
      kind: "not-a-replication",
      extendsScope: false,
      explanation:
        "The experiments test different variables or decide on different metrics, so neither replicates the other. " +
        "Counting it as confirmation would treat an unrelated result as support.",
    };
  }

  const scopeA = original.scope;
  const scopeB = candidate.scope;

  if (scopeA.platform !== scopeB.platform) {
    return {
      ...base,
      kind: "platform",
      extendsScope: agrees,
      explanation:
        `Same design on ${scopeB.platform} rather than ${scopeA.platform}. This establishes a ${scopeB.platform} finding ` +
        `in its own right; it does NOT confirm the ${scopeA.platform} one, because the platforms distribute and measure differently.`,
    };
  }
  if (scopeA.objective !== scopeB.objective || scopeA.missionFamily !== scopeB.missionFamily) {
    return {
      ...base,
      kind: "mission-family",
      extendsScope: agrees,
      explanation: `Same design under a different mission family ("${scopeB.missionFamily}"), which extends scope rather than confirming the original.`,
    };
  }
  if (scopeA.audienceProfileId !== scopeB.audienceProfileId) {
    return {
      ...base,
      kind: "audience",
      extendsScope: agrees,
      explanation: "Same design with a different audience, which tests whether the finding survives an audience change.",
    };
  }
  if (scopeA.topicFamily !== scopeB.topicFamily) {
    return {
      ...base,
      kind: "topic",
      extendsScope: agrees,
      explanation:
        `Same design on topic family "${scopeB.topicFamily}" rather than "${scopeA.topicFamily}". Because topic effects are ` +
        "large, this is the most informative replication available: agreement here means the result survived the biggest confounder.",
    };
  }

  return {
    ...base,
    kind: "exact",
    extendsScope: false,
    explanation:
      "Identical scope on every axis. This tests whether the original result was reliable rather than whether it generalizes.",
  };
}

function normalizedDimensions(experiment: Experiment): string {
  return [
    ...new Set(experiment.variants.filter((variant) => !variant.isControl).flatMap((variant) => variant.differences.map((d) => d.dimension))),
  ]
    .sort()
    .join(",");
}

// ---------------------------------------------------------------------------
// Contradiction matrix (sections 38, 79)
// ---------------------------------------------------------------------------

export type ContradictionStance = "supports" | "contradicts" | "neutral" | "invalid" | "out-of-scope";

export interface ContradictionEntry {
  readonly experimentId: string;
  readonly stance: ContradictionStance;
  readonly scope: ExperimentScope;
  readonly validity: ValidityState;
  readonly explanation: string;
}

export interface ContradictionMatrix {
  readonly hypothesisId: string;
  readonly entries: readonly ContradictionEntry[];
  readonly supportCount: number;
  readonly contradictCount: number;
  readonly hasConflict: boolean;
  /** Questions that could explain WHY the results disagree. */
  readonly discriminatingQuestions: readonly string[];
  readonly explanation: string;
}

/**
 * Lay out every experiment bearing on one hypothesis, side by side.
 *
 * Emphatically does not collapse them into a score. When results conflict, the
 * output is the conflict plus the questions that could resolve it — because
 * "which of these differences explains the disagreement?" is answerable by a
 * further experiment, and "on average it slightly helps" is not answerable by
 * anything.
 */
export function buildContradictionMatrix(
  hypothesisId: string,
  entries: readonly ContradictionEntry[],
): ContradictionMatrix {
  const supportCount = entries.filter((entry) => entry.stance === "supports").length;
  const contradictCount = entries.filter((entry) => entry.stance === "contradicts").length;
  const hasConflict = supportCount > 0 && contradictCount > 0;

  const discriminatingQuestions: string[] = [];
  if (hasConflict) {
    const supporting = entries.filter((entry) => entry.stance === "supports");
    const contradicting = entries.filter((entry) => entry.stance === "contradicts");

    const axes: readonly { readonly name: string; readonly of: (scope: ExperimentScope) => string }[] = [
      { name: "topic family", of: (scope) => scope.topicFamily },
      { name: "platform", of: (scope) => scope.platform },
      { name: "objective", of: (scope) => scope.objective },
      { name: "mission family", of: (scope) => scope.missionFamily },
      { name: "audience", of: (scope) => scope.audienceProfileId ?? "unknown" },
    ];

    for (const axis of axes) {
      const supportValues = new Set(supporting.map((entry) => axis.of(entry.scope)));
      const contradictValues = new Set(contradicting.map((entry) => axis.of(entry.scope)));
      const disjoint = [...supportValues].every((value) => !contradictValues.has(value));
      if (disjoint && supportValues.size > 0 && contradictValues.size > 0) {
        discriminatingQuestions.push(
          `Does ${axis.name} explain it? Supporting experiments ran on ${[...supportValues].join(", ")} and contradicting ones ` +
            `on ${[...contradictValues].join(", ")} — these do not overlap, so ${axis.name} is a live explanation for the disagreement.`,
        );
      }
    }

    if (entries.some((entry) => entry.validity !== "clean-controlled")) {
      discriminatingQuestions.push(
        "Does design quality explain it? Not every experiment here was cleanly controlled, so the disagreement may be between " +
          "a real effect and a confounded one rather than between two real effects.",
      );
    }

    discriminatingQuestions.push(
      "Is it noise? At these sample sizes, two experiments disagreeing is an entirely ordinary outcome even when the true " +
        "effect is identical in both. Replication with more units would distinguish this from a genuine scope difference.",
    );
  }

  return {
    hypothesisId,
    entries: [...entries].sort((a, b) => a.experimentId.localeCompare(b.experimentId)),
    supportCount,
    contradictCount,
    hasConflict,
    discriminatingQuestions,
    explanation: hasConflict
      ? `${supportCount} experiment(s) support and ${contradictCount} contradict this hypothesis. These are NOT averaged: ` +
        "the disagreement is recorded as the current state of knowledge, and the questions above are what would resolve it."
      : `${entries.length} experiment(s) bear on this hypothesis with no direct conflict (${supportCount} supporting, ` +
        `${entries.filter((e) => e.stance === "neutral").length} neutral).`,
  };
}

// ---------------------------------------------------------------------------
// Evidence accumulation by scope (section 39)
// ---------------------------------------------------------------------------

export interface ScopedEvidence {
  readonly scopeLabel: string;
  readonly strength: EvidenceStrength;
  readonly experimentIds: readonly string[];
  readonly explanation: string;
}

export interface EvidenceMap {
  readonly supportedIn: readonly ScopedEvidence[];
  readonly conflictingIn: readonly ScopedEvidence[];
  readonly unknownIn: readonly string[];
  readonly explanation: string;
}

/**
 * Where a hypothesis stands, scope by scope.
 *
 * `unknownIn` is the interesting half: it names the scopes nobody has tested,
 * so that "we have no idea whether this works on TikTok" is visible rather than
 * being silently filled in by the YouTube result.
 */
export function accumulateEvidence(
  entries: readonly ContradictionEntry[],
  untestedScopes: readonly string[],
): EvidenceMap {
  const byScope = new Map<string, ContradictionEntry[]>();
  for (const entry of entries) {
    const label = `${entry.scope.platform} / ${entry.scope.topicFamily} / ${entry.scope.objective}`;
    const group = byScope.get(label) ?? [];
    group.push(entry);
    byScope.set(label, group);
  }

  const supportedIn: ScopedEvidence[] = [];
  const conflictingIn: ScopedEvidence[] = [];

  for (const [label, group] of [...byScope.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const supports = group.filter((entry) => entry.stance === "supports");
    const contradicts = group.filter((entry) => entry.stance === "contradicts");
    const experimentIds = group.map((entry) => entry.experimentId).sort();

    if (supports.length > 0 && contradicts.length > 0) {
      conflictingIn.push({
        scopeLabel: label,
        strength: "conflicting",
        experimentIds,
        explanation: `${supports.length} supporting and ${contradicts.length} contradicting result(s) within the same scope.`,
      });
      continue;
    }
    if (supports.length === 0) continue;

    const clean = supports.every((entry) => entry.validity === "clean-controlled");
    const strength: EvidenceStrength =
      supports.length >= 3 && clean ? "strong-within-scope" : supports.length >= 2 ? "replicated" : "replication-needed";

    supportedIn.push({
      scopeLabel: label,
      strength,
      experimentIds,
      explanation: `${supports.length} supporting result(s)${clean ? ", all cleanly controlled" : ""}.`,
    });
  }

  return {
    supportedIn,
    conflictingIn,
    unknownIn: [...untestedScopes].sort(),
    explanation:
      `Supported in ${supportedIn.length} scope(s), conflicting in ${conflictingIn.length}, and untested in ` +
      `${untestedScopes.length}. Nothing is generalized past the scopes actually tested — an untested scope is unknown, ` +
      "not assumed to behave like a tested one.",
  };
}

// ---------------------------------------------------------------------------
// Learning candidates (section 40)
// ---------------------------------------------------------------------------

/**
 * What MASTER #6 should do with this, when it exists.
 *
 * MASTER #5 recommends; it does not write. `conflicting-do-not-collapse` is the
 * important one: it instructs memory to keep the disagreement intact rather
 * than resolving it into a single belief.
 */
export type MemoryAction =
  | "do-not-store"
  | "store-as-hypothesis"
  | "store-as-directional"
  | "store-as-replicated"
  | "needs-more-data"
  | "conflicting-do-not-collapse";

export const MEMORY_ACTIONS: readonly MemoryAction[] = [
  "do-not-store", "store-as-hypothesis", "store-as-directional",
  "store-as-replicated", "needs-more-data", "conflicting-do-not-collapse",
];

export interface LearningCandidate {
  readonly version: "learning-candidate-v1";
  readonly candidateId: string;
  readonly proposition: string;
  readonly generalizationLevel: GeneralizationLevel;
  readonly scope: ExperimentScope;
  readonly evidenceSummary: string;
  readonly supportingExperimentIds: readonly string[];
  readonly conflictingExperimentIds: readonly string[];
  readonly evidenceStrength: EvidenceStrength;
  readonly replicationStatus: string;
  readonly caveats: readonly string[];
  /** Sentences that must NOT be derived from this. Never empty. */
  readonly prohibitedOvergeneralizations: readonly string[];
  readonly recommendedMemoryAction: MemoryAction;
  readonly synthetic: boolean;
  readonly provenance: { readonly producedBy: string; readonly producedAt: string };
  readonly createdAt: string;
}

export class LearningCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningCandidateError";
  }
}

export interface CandidateInput {
  readonly experiment: Experiment;
  readonly interpretation: PerformanceInterpretation;
  readonly supportingExperimentIds: readonly string[];
  readonly conflictingExperimentIds: readonly string[];
  readonly replications: readonly ReplicationRecord[];
  readonly now: Date;
  readonly producedBy: string;
}

/**
 * Propose a learning candidate.
 *
 * The generalization level is derived from evidence strength rather than
 * chosen, and the proposition is WRITTEN at that level — so a weak result
 * produces a narrow sentence rather than a broad sentence with a quiet caveat.
 */
export function proposeLearningCandidate(input: CandidateInput): LearningCandidate {
  const { experiment, interpretation } = input;
  const strength = interpretation.evidence.strength;

  const level = deriveGeneralizationLevel(strength, interpretation.validity.state, input.replications);
  const action = deriveMemoryAction(strength, interpretation, input.conflictingExperimentIds.length);

  const dimensions = interpretation.validity.declaredDifferences.map((d) => `${d.dimension} (${d.control} -> ${d.variant})`).join(", ");
  const proposition = writeProposition(experiment, dimensions, interpretation, level);

  const candidate: LearningCandidate = {
    version: "learning-candidate-v1",
    candidateId: `candidate-${experiment.experimentId}-r${experiment.revision}`,
    proposition,
    generalizationLevel: level,
    scope: experiment.scope,
    evidenceSummary: `${strength}: ${interpretation.evidence.explanation}`,
    supportingExperimentIds: [...input.supportingExperimentIds].sort(),
    conflictingExperimentIds: [...input.conflictingExperimentIds].sort(),
    evidenceStrength: strength,
    replicationStatus: describeReplication(input.replications),
    caveats: buildCaveats(interpretation),
    prohibitedOvergeneralizations: buildProhibitions(experiment, interpretation),
    recommendedMemoryAction: action,
    synthetic: interpretation.synthetic,
    provenance: { producedBy: input.producedBy, producedAt: input.now.toISOString() },
    createdAt: input.now.toISOString(),
  };

  // The candidate must not claim more breadth than its own evidence allows.
  if (!generalizationPermitted(candidate.generalizationLevel, strength) && action !== "do-not-store") {
    throw new LearningCandidateError(
      `Candidate ${candidate.candidateId} claims generalization "${candidate.generalizationLevel}" on ${strength} evidence, ` +
        "which is more breadth than the evidence supports.",
    );
  }

  return candidate;
}

function deriveGeneralizationLevel(
  strength: EvidenceStrength,
  validity: ValidityState,
  replications: readonly ReplicationRecord[],
): GeneralizationLevel {
  if (strength === "conflicting" || strength === "insufficient") return "exact-experiment";
  if (validity === "confounded" || validity === "invalid") return "exact-experiment";

  const widest = widestPermittedGeneralization(strength) ?? "exact-experiment";

  // A platform replication widens scope only if one actually happened and
  // agreed. Otherwise a cross-platform claim is a guess about the other
  // platform, whatever the strength says.
  const crossPlatformAgreed = replications.some((record) => record.kind === "platform" && record.agrees);
  if (widest === "cross-platform" && !crossPlatformAgreed) return "platform";
  if ((widest === "platform" || widest === "audience-platform") && replications.length === 0) return "topic-family";

  return widest;
}

function deriveMemoryAction(
  strength: EvidenceStrength,
  interpretation: PerformanceInterpretation,
  conflictCount: number,
): MemoryAction {
  if (!interpretation.guardrails.allPassed) return "do-not-store";
  if (interpretation.validity.state === "invalid") return "do-not-store";
  if (conflictCount > 0 || strength === "conflicting") return "conflicting-do-not-collapse";
  if (strength === "insufficient") return "do-not-store";
  if (strength === "anecdotal") return "store-as-hypothesis";
  if (strength === "directional" || strength === "replication-needed") return "store-as-directional";
  if (strength === "replicated" || strength === "strong-within-scope") return "store-as-replicated";
  return "needs-more-data";
}

function writeProposition(
  experiment: Experiment,
  dimensions: string,
  interpretation: PerformanceInterpretation,
  level: GeneralizationLevel,
): string {
  const scopeClause =
    level === "exact-experiment"
      ? `In experiment ${experiment.experimentId} only`
      : level === "topic-family"
        ? `For ${experiment.scope.topicFamily} content on ${experiment.scope.platform}`
        : `For ${experiment.scope.objective} content on ${experiment.scope.platform}`;

  if (!interpretation.guardrails.allPassed) {
    return `${scopeClause}, this variant failed a guardrail and must not be reused regardless of its performance.`;
  }

  if (interpretation.primaryComparison.outcome === "indistinguishable") {
    return (
      `${scopeClause}, changing ${dimensions || "this dimension"} made no distinguishable difference to ` +
      `${experiment.primaryMetricId} at ${experiment.observationWindow}.`
    );
  }

  if (!interpretation.validity.causalReadingPermitted) {
    return (
      `${scopeClause}, a difference in ${experiment.primaryMetricId} was observed, but multiple dimensions changed so it ` +
      "cannot be attributed to any one of them."
    );
  }

  const direction = interpretation.primaryComparison.outcome === "variant-higher" ? "raised" : "lowered";
  return (
    `${scopeClause}, ${dimensions || "the tested change"} ${direction} ${experiment.primaryMetricId} at ` +
    `${experiment.observationWindow} — ${interpretation.evidence.strength} evidence.`
  );
}

function describeReplication(replications: readonly ReplicationRecord[]): string {
  if (replications.length === 0) return "No replication attempted.";
  const agreeing = replications.filter((record) => record.agrees);
  const kinds = [...new Set(replications.map((record) => record.kind))].sort().join(", ");
  return `${agreeing.length}/${replications.length} replication(s) agree (kinds: ${kinds}).`;
}

function buildCaveats(interpretation: PerformanceInterpretation): readonly string[] {
  const caveats: string[] = [...interpretation.limitations];
  for (const explanation of interpretation.alternativeExplanations.slice(0, 3)) {
    caveats.push(`Alternative explanation not ruled out: ${explanation}`);
  }
  if (interpretation.synthetic) {
    caveats.push("Synthetic fixture input: this candidate is an engineering artifact and must never enter production memory.");
  }
  return caveats;
}

/**
 * The sentences this result must not become.
 *
 * Concrete and quotable, because an abstract warning ("do not overgeneralize")
 * is easy to agree with and easy to ignore, whereas a specific forbidden
 * sentence is checkable.
 */
function buildProhibitions(experiment: Experiment, interpretation: PerformanceInterpretation): readonly string[] {
  const dimension = interpretation.validity.declaredDifferences[0]?.dimension ?? "this dimension";
  const prohibitions: string[] = [
    `"${dimension} is better" — unscoped, and this ran on one platform, one topic family and one objective.`,
    `"Always use this ${dimension}" — a rule this evidence cannot support at any strength reachable here.`,
    `Any claim about platforms other than ${experiment.scope.platform}.`,
    `Any claim about topics outside "${experiment.scope.topicFamily}".`,
    `Any claim about objectives other than "${experiment.scope.objective}".`,
  ];

  if (experiment.scope.audienceWasUnknown) {
    prohibitions.push(
      "Any claim about which audience this worked for. MASTER #4 recorded the audience as unknown, so attributing the " +
        "result to beginners or any other group would invent the population it applies to.",
    );
  }
  if (interpretation.validity.state === "confounded") {
    prohibitions.push(`Any claim that ${dimension} specifically caused the difference — it was confounded with other changes.`);
  }
  if (!interpretation.sample.meetsMinimum) {
    prohibitions.push("Any claim that this would repeat; the minimum evidence requirement was not met.");
  }

  return prohibitions;
}

/** Validate a candidate's scope claims against the experiment that produced it. */
export function validateCandidateScope(candidate: LearningCandidate, experiment: Experiment): readonly ScopeViolation[] {
  return checkScopeClaims(experiment, {
    platforms: [candidate.scope.platform],
    audienceDescription: experiment.scope.audienceWasUnknown ? null : candidate.scope.audienceDescription,
    objective: candidate.scope.objective,
    topicFamily: candidate.scope.topicFamily,
  });
}

// ---------------------------------------------------------------------------
// Failure records (section 41)
// ---------------------------------------------------------------------------

export type FailureCode =
  | "design-invalid"
  | "wrong-window"
  | "missing-analytics"
  | "bad-assignment"
  | "too-many-variables-changed"
  | "integrity-gate-failed"
  | "platform-metadata-unavailable"
  | "topic-too-weak-to-interpret"
  | "collection-failed"
  | "sample-too-small"
  | "preregistration-violated";

export const FAILURE_CODES: readonly FailureCode[] = [
  "design-invalid", "wrong-window", "missing-analytics", "bad-assignment",
  "too-many-variables-changed", "integrity-gate-failed", "platform-metadata-unavailable",
  "topic-too-weak-to-interpret", "collection-failed", "sample-too-small", "preregistration-violated",
];

/**
 * A broken experiment, recorded rather than discarded.
 *
 * Silently dropping failures leaves a record of only the experiments that
 * worked, which makes the process look far more reliable than it is and hides
 * the recurring design mistakes worth fixing.
 */
export interface ExperimentFailureRecord {
  readonly version: "experiment-failure-v1";
  readonly failureId: string;
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly code: FailureCode;
  readonly whatWentWrong: string;
  readonly whatThisTeaches: string;
  readonly preventableBy: string;
  readonly recordedAt: string;
  readonly synthetic: boolean;
}

export function recordFailure(input: {
  readonly experiment: Experiment;
  readonly code: FailureCode;
  readonly detail: string;
  readonly now: Date;
  readonly synthetic: boolean;
}): ExperimentFailureRecord {
  return {
    version: "experiment-failure-v1",
    failureId: `failure-${input.experiment.experimentId}-r${input.experiment.revision}-${input.code}`,
    experimentId: input.experiment.experimentId,
    experimentRevision: input.experiment.revision,
    code: input.code,
    whatWentWrong: input.detail,
    whatThisTeaches: TEACHING[input.code],
    preventableBy: PREVENTION[input.code],
    recordedAt: input.now.toISOString(),
    synthetic: input.synthetic,
  };
}

const TEACHING: Record<FailureCode, string> = {
  "design-invalid": "The design could not have produced an interpretable result, which is cheaper to find before publishing than after.",
  "wrong-window": "The comparison window is part of experiment identity, and a mismatch makes the numbers incomparable.",
  "missing-analytics": "An experiment cannot conclude without measurements; the absence is a collection fact, not a performance result.",
  "bad-assignment": "Without a correct binding from creative to variant, no observation can be attributed to anything.",
  "too-many-variables-changed": "Changing several things at once produces a real difference that explains nothing.",
  "integrity-gate-failed": "A variant that breaches an integrity gate has no usable performance result, whatever its numbers.",
  "platform-metadata-unavailable": "Some platform facts needed to interpret a result are simply not available here.",
  "topic-too-weak-to-interpret": "With too little reach, rate metrics describe noise rather than the creative.",
  "collection-failed": "A failed collection must never become a zero-performance record.",
  "sample-too-small": "Below the declared minimum, no direction can be claimed however clean the design.",
  "preregistration-violated": "A design that changed after registration cannot be evaluated as the experiment that was registered.",
};

const PREVENTION: Record<FailureCode, string> = {
  "design-invalid": "Run validateDesign before registering, and fix every hard failure it reports.",
  "wrong-window": "Register the observation window in the design and refuse observations at any other window.",
  "missing-analytics": "Check window-due status before evaluating, and report missed windows rather than substituting neighbours.",
  "bad-assignment": "Bind assignments before publication, including the media SHA and provider post id.",
  "too-many-variables-changed": "Declare exactly one controlled difference and verify at result time that only it changed.",
  "integrity-gate-failed": "Keep integrity dimensions out of the experimental taxonomy entirely, so they cannot be proposed as variables.",
  "platform-metadata-unavailable": "Choose a primary metric the connected provider actually supplies.",
  "topic-too-weak-to-interpret": "Set a minimum reach threshold below which rates are not interpreted.",
  "collection-failed": "Represent collection failure as its own metric state rather than as a value.",
  "sample-too-small": "Declare a minimum independent-unit requirement at design time and hold to it.",
  "preregistration-violated": "Create a new revision instead of editing a frozen design.",
};

export function formatLearningCandidate(candidate: LearningCandidate): string {
  const lines: string[] = [];
  lines.push(`  ${candidate.candidateId}`);
  lines.push(`    proposition: ${candidate.proposition}`);
  lines.push(`    generalization: ${candidate.generalizationLevel} (evidence: ${candidate.evidenceStrength})`);
  lines.push(`    memory action: ${candidate.recommendedMemoryAction}`);
  lines.push(`    replication: ${candidate.replicationStatus}`);
  lines.push("    must NOT become:");
  for (const prohibition of candidate.prohibitedOvergeneralizations) lines.push(`      x ${prohibition}`);
  if (candidate.synthetic) lines.push("    SYNTHETIC: engineering fixture, never production memory.");
  return lines.join("\n");
}
