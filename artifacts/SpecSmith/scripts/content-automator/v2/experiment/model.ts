// MASTER #5 — Experiment and performance model (sections 1, 2, 3, 4, 33, 77, 78).
//
// The one idea this whole layer is built around:
//
//   OBSERVATION  is not  INTERPRETATION
//   INTERPRETATION is not  CAUSAL CLAIM
//   CAUSAL CLAIM  is not  DECISION
//   DECISION      is not  LEARNING
//
// Those are five different objects here, with five different types, and there
// is no function that turns one into the next without stating what justified
// the step. A system that collapses them will tell you "result-first hooks are
// better" after watching two videos, and it will be wrong in a way that is
// expensive and invisible.
//
// Nothing in this file encodes a p-value, a confidence percentage or a
// composite "content score". For the sample sizes short-form content actually
// produces, a decimal confidence figure is theatre: it converts "we saw one
// pair of videos" into something that looks like statistics. Evidence strength
// is a small set of named states instead, and every one of them is arguable.

import type { VideoPlatform } from "../../types.ts";
import type { StrategicObjective } from "../strategy/model.ts";

// ---------------------------------------------------------------------------
// Evidence strength (section 78)
// ---------------------------------------------------------------------------

/**
 * How much an accumulated body of evidence actually supports something.
 *
 * Ordered weakest to strongest, but NOT numeric: these are different kinds of
 * epistemic position, not points on a scale. `conflicting` is deliberately not
 * ranked between the others — evidence that disagrees with itself is its own
 * state, and averaging it away is the failure mode section 38 forbids.
 */
export type EvidenceStrength =
  /** Not enough observations to say anything at all. */
  | "insufficient"
  /** One comparison. Interesting, not generalizable. */
  | "anecdotal"
  /** A consistent direction within one scope, unreplicated. */
  | "directional"
  /** Promising enough that replication is the correct next step. */
  | "replication-needed"
  /** Reproduced in an independent experiment within the same scope. */
  | "replicated"
  /** Experiments disagree. Never averaged into a middle position. */
  | "conflicting"
  /** Replicated, unconflicted, and bounded to a stated scope. */
  | "strong-within-scope";

export const EVIDENCE_STRENGTHS: readonly EvidenceStrength[] = [
  "insufficient", "anecdotal", "directional", "replication-needed",
  "replicated", "conflicting", "strong-within-scope",
];

/** Strengths that may justify reusing a pattern rather than re-testing it. */
const REUSABLE_STRENGTHS = new Set<EvidenceStrength>(["replicated", "strong-within-scope"]);

export function strengthPermitsReuse(strength: EvidenceStrength): boolean {
  return REUSABLE_STRENGTHS.has(strength);
}

// ---------------------------------------------------------------------------
// Generalization (section 77)
// ---------------------------------------------------------------------------

/**
 * How far a finding is claimed to apply.
 *
 * Ordered narrow to broad. Each step up requires strictly more evidence, and
 * the default is always the narrowest level the evidence actually covers —
 * because the tempting move, every single time, is to jump from "this pair of
 * videos" to "this is how hooks work".
 */
export type GeneralizationLevel =
  | "exact-creative"
  | "exact-experiment"
  | "topic-family"
  | "mission-family"
  | "audience-platform"
  | "platform"
  | "cross-platform"
  | "global";

export const GENERALIZATION_LEVELS: readonly GeneralizationLevel[] = [
  "exact-creative", "exact-experiment", "topic-family", "mission-family",
  "audience-platform", "platform", "cross-platform", "global",
];

/**
 * The minimum evidence strength each generalization level requires.
 *
 * `global` is intentionally unreachable: there is no evidence state in this
 * system that unlocks it. A universal claim about how content works is not
 * something a handful of Shorts can establish, and leaving the door open would
 * mean it eventually gets walked through.
 */
export const GENERALIZATION_REQUIREMENTS: Record<GeneralizationLevel, EvidenceStrength | "unreachable"> = {
  "exact-creative": "anecdotal",
  "exact-experiment": "anecdotal",
  "topic-family": "directional",
  "mission-family": "replicated",
  "audience-platform": "replicated",
  platform: "replicated",
  "cross-platform": "strong-within-scope",
  global: "unreachable",
};

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  insufficient: 0,
  anecdotal: 1,
  directional: 2,
  "replication-needed": 2,
  conflicting: 0,
  replicated: 3,
  "strong-within-scope": 4,
};

/**
 * May this evidence support a claim at this breadth?
 *
 * Conflicting evidence supports nothing at any level — that is why its rank is
 * 0 rather than somewhere in the middle.
 */
export function generalizationPermitted(level: GeneralizationLevel, strength: EvidenceStrength): boolean {
  const required = GENERALIZATION_REQUIREMENTS[level];
  if (required === "unreachable") return false;
  if (strength === "conflicting") return false;
  return STRENGTH_RANK[strength] >= STRENGTH_RANK[required];
}

/** The broadest level this evidence actually justifies. */
export function widestPermittedGeneralization(strength: EvidenceStrength): GeneralizationLevel | null {
  let widest: GeneralizationLevel | null = null;
  for (const level of GENERALIZATION_LEVELS) {
    if (generalizationPermitted(level, strength)) widest = level;
  }
  return widest;
}

// ---------------------------------------------------------------------------
// Experimental dimensions (section 33)
// ---------------------------------------------------------------------------

/**
 * What a variant may deliberately change.
 *
 * Extensible by design and deliberately NOT exhaustive: a closed list would
 * quietly forbid testing anything its author did not think of. What matters is
 * that whatever changed is NAMED, so the controlled-difference check can tell
 * a one-variable test from a redesign.
 */
export type CreativeDimension =
  | "hook-form"
  | "hook-length"
  | "first-visual-type"
  | "claim-order"
  | "explanation-depth"
  | "pacing"
  | "beat-duration"
  | "visual-change-rate"
  | "caption-density"
  | "caption-style"
  | "voice-style"
  | "music-presence"
  | "sfx-density"
  | "cta-family"
  | "cta-timing"
  | "duration"
  | "comparison-layout"
  | "before-after-structure"
  | "result-first-vs-context-first"
  | "question-vs-statement"
  | "screen-capture-vs-motion-graphic"
  | "brand-presence"
  | "metadata-title"
  | "metadata-description"
  | "hashtag-set";

export const CREATIVE_DIMENSIONS: readonly CreativeDimension[] = [
  "hook-form", "hook-length", "first-visual-type", "claim-order", "explanation-depth",
  "pacing", "beat-duration", "visual-change-rate", "caption-density", "caption-style",
  "voice-style", "music-presence", "sfx-density", "cta-family", "cta-timing", "duration",
  "comparison-layout", "before-after-structure", "result-first-vs-context-first",
  "question-vs-statement", "screen-capture-vs-motion-graphic", "brand-presence",
  "metadata-title", "metadata-description", "hashtag-set",
];

/**
 * Dimensions MASTER #5 may never propose changing.
 *
 * These are not creative choices — they are the integrity guarantees MASTER
 * #1-#4 established. Section 47 is explicit: performance optimization is
 * subordinate to truth, rights and accessibility, and a retention gain is not
 * an argument for removing a caveat. Listing them here means an experiment that
 * tries is rejected at design time rather than argued about at result time.
 */
export const FORBIDDEN_EXPERIMENT_DIMENSIONS: readonly string[] = [
  "factual-claim",
  "claim-strength",
  "required-wording",
  "estimate-label",
  "measured-vs-estimated",
  "configuration-disclosure",
  "source-attribution",
  "caveat-presence",
  "accessibility-captions",
  "accessibility-contrast",
  "audio-independent-comprehension",
  "rights-clearance",
  "human-audio-review",
  "mission-objective",
  "forbidden-claim-list",
  "product-readiness",
];

export function dimensionIsForbidden(dimension: string): boolean {
  return FORBIDDEN_EXPERIMENT_DIMENSIONS.includes(dimension);
}

// ---------------------------------------------------------------------------
// Controlled differences and invariants (section 4)
// ---------------------------------------------------------------------------

/** One thing a variant changed, relative to the control. */
export interface ControlledDifference {
  readonly dimension: CreativeDimension;
  readonly control: string;
  readonly variant: string;
  /** Why this difference is the one worth testing. */
  readonly rationale: string;
}

/**
 * Everything that is supposed to stay fixed across variants.
 *
 * Declared up front, then CHECKED against what actually shipped. The gap
 * between "we intended to change one thing" and "one thing changed" is where
 * most bad content science lives.
 */
export interface InvariantSet {
  readonly missionId: string;
  readonly claimIds: readonly string[];
  readonly requiredWording: readonly string[];
  readonly audienceProfileId: string;
  readonly platform: VideoPlatform;
  readonly topicId: string;
  readonly productRoute: string | null;
  readonly objective: StrategicObjective;
  readonly targetDurationSecondsRange: readonly [number, number] | null;
  readonly ctaFamily: string | null;
  readonly voiceId: string | null;
  readonly postingAccount: string;
  readonly estimateStatusDisclosed: boolean;
}

// ---------------------------------------------------------------------------
// Observation windows (section 13)
// ---------------------------------------------------------------------------

/**
 * Re-exported from the existing Content Automator types rather than redeclared.
 *
 * A second window enum would be a second source of truth about what "24h"
 * means, and the whole point of section 13 is that the window is part of
 * experiment identity.
 */
export type { SnapshotWindow as ObservationWindow } from "../../types.ts";

// ---------------------------------------------------------------------------
// Experiment lifecycle (sections 2, 6)
// ---------------------------------------------------------------------------

export type ExperimentStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "invalidated"
  | "completed"
  | "abandoned"
  | "replication-needed"
  | "inconclusive";

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "draft", "ready", "running", "paused", "invalidated",
  "completed", "abandoned", "replication-needed", "inconclusive",
];

/** Statuses after which the design is frozen and may not be edited in place. */
const FROZEN_STATUSES = new Set<ExperimentStatus>([
  "running", "paused", "invalidated", "completed", "abandoned", "replication-needed", "inconclusive",
]);

export function designIsFrozen(status: ExperimentStatus): boolean {
  return FROZEN_STATUSES.has(status);
}

/** What MASTER #5 recommends doing next. It recommends; it does not act. */
export type ExperimentDecision =
  | "continue-collecting"
  | "replicate"
  | "explore-alternative"
  | "exploit-cautiously"
  | "pause"
  | "abandon"
  | "inconclusive"
  | "invalidated"
  | "blocked-by-guardrail";

export const EXPERIMENT_DECISIONS: readonly ExperimentDecision[] = [
  "continue-collecting", "replicate", "explore-alternative", "exploit-cautiously",
  "pause", "abandon", "inconclusive", "invalidated", "blocked-by-guardrail",
];

// ---------------------------------------------------------------------------
// Hypothesis (section 3)
// ---------------------------------------------------------------------------

export type ExpectedDirection = "variant-higher" | "variant-lower" | "no-difference" | "unknown";

/**
 * A scoped, falsifiable, metric-bound, window-bound proposition.
 *
 * NOT "result-first hooks are better". That sentence has no scope, no metric,
 * no window and no way to be wrong, so it can never be tested and will simply
 * accumulate believers.
 */
export interface ExperimentHypothesis {
  readonly hypothesisId: string;
  readonly proposition: string;
  readonly expectedDirection: ExpectedDirection;
  readonly whyThisMightBeTrue: string;
  readonly supportingEvidence: readonly string[];
  readonly conflictingEvidence: readonly string[];
  readonly uncertainty: string;
  readonly scope: ExperimentScope;
  readonly primaryMetricId: string;
  readonly measurementWindow: import("../../types.ts").SnapshotWindow;
  readonly falsificationCondition: string;
  /** Results that would look like support but must not be counted as it. */
  readonly whatWouldNotCountAsConfirmation: readonly string[];
  readonly triggersReplicationWhen: string;
  readonly triggersAbandonmentWhen: string;
}

/**
 * The boundary of a claim.
 *
 * Every field here narrows what a result may later be said to apply to. An
 * unknown audience means the finding can never be described as being about
 * beginners, however convenient that would be (section 31).
 */
export interface ExperimentScope {
  readonly platform: VideoPlatform;
  readonly audienceProfileId: string | null;
  readonly audienceDescription: string;
  /** True when MASTER #4 could not establish who this was for. */
  readonly audienceWasUnknown: boolean;
  readonly missionFamily: string;
  readonly objective: StrategicObjective;
  readonly topicFamily: string;
}

// ---------------------------------------------------------------------------
// Variants and assignment (sections 2, 7)
// ---------------------------------------------------------------------------

export interface ExperimentVariant {
  readonly variantId: string;
  readonly label: string;
  /** Exactly one variant per experiment is the control. */
  readonly isControl: boolean;
  readonly differences: readonly ControlledDifference[];
  readonly description: string;
}

export type AssignmentMethod =
  /** The only method available here: a human or a pass names the variant. */
  | "explicit-declaration"
  /** Reserved. Requires a seed and a stated randomization design. */
  | "deterministic-seeded";

/**
 * Binds one published creative to one variant, permanently.
 *
 * Every identity field is required because section 35 forbids loose matching:
 * there is no "probably this video". The media SHA is what makes the binding
 * survive a re-render — different bytes are a different creative.
 */
export interface ExperimentAssignment {
  readonly assignmentId: string;
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly variantId: string;
  readonly creativeId: string;
  readonly creativeLineageId: string;
  readonly platform: VideoPlatform;
  readonly packageId: string;
  readonly approvedMediaSha256: string;
  readonly providerPostId: string | null;
  readonly publishedAt: string | null;
  readonly assignedAt: string;
  readonly method: AssignmentMethod;
}

// ---------------------------------------------------------------------------
// Minimum evidence and stopping (sections 2, 24)
// ---------------------------------------------------------------------------

export interface MinimumEvidenceRequirement {
  /** Independent units, not snapshots and not metrics. */
  readonly minimumIndependentUnitsPerVariant: number;
  readonly minimumReplications: number;
  readonly explanation: string;
}

export type StopConditionCode =
  | "planned-units-reached"
  | "replication-achieved"
  | "guardrail-failure"
  | "design-invalidated"
  | "direction-repeatedly-conflicts"
  | "opportunity-expired"
  | "context-changed"
  | "insufficient-traffic"
  | "capability-changed"
  | "strategy-superseded";

export const STOP_CONDITION_CODES: readonly StopConditionCode[] = [
  "planned-units-reached", "replication-achieved", "guardrail-failure",
  "design-invalidated", "direction-repeatedly-conflicts", "opportunity-expired",
  "context-changed", "insufficient-traffic", "capability-changed", "strategy-superseded",
];

/**
 * Reasons an experiment may be stopped EARLY (section 25).
 *
 * Note what is absent: "the numbers look good". Stopping because early results
 * are exciting is how a random fluctuation becomes a house style.
 */
export const EARLY_STOP_CODES: readonly StopConditionCode[] = [
  "guardrail-failure", "design-invalidated", "capability-changed", "context-changed",
];

export function earlyStopPermitted(code: StopConditionCode): boolean {
  return EARLY_STOP_CODES.includes(code);
}

export interface StopCondition {
  readonly code: StopConditionCode;
  readonly description: string;
}

export interface InvalidationCondition {
  readonly code: string;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// The experiment (section 2)
// ---------------------------------------------------------------------------

export interface ExperimentProvenance {
  readonly synthetic: boolean;
  readonly producedBy: string;
  readonly producedAt: string;
}

export interface Experiment {
  readonly version: "experiment-definition-v1";
  readonly experimentId: string;
  readonly revision: number;
  readonly title: string;
  readonly familyId: string;

  readonly hypothesis: ExperimentHypothesis;
  readonly rationale: string;
  readonly scope: ExperimentScope;

  readonly primaryMetricId: string;
  readonly secondaryMetricIds: readonly string[];
  readonly guardrailMetricIds: readonly string[];

  readonly missionId: string;
  readonly creativeLineageId: string;
  readonly variants: readonly ExperimentVariant[];
  readonly invariants: InvariantSet;
  readonly assignmentMethod: AssignmentMethod;
  readonly observationWindow: import("../../types.ts").SnapshotWindow;

  readonly minimumEvidence: MinimumEvidenceRequirement;
  readonly stopConditions: readonly StopCondition[];
  readonly invalidationConditions: readonly InvalidationCondition[];

  readonly status: ExperimentStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly closedAt: string | null;
  /** Hash of the canonical design fields. Changes require a new revision. */
  readonly designHash: string;
  readonly registeredAt: string | null;
  readonly provenance: ExperimentProvenance;
}

// ---------------------------------------------------------------------------
// Comparison and validity vocabulary (sections 5, 17)
// ---------------------------------------------------------------------------

export type ValidityState =
  /** One declared variable changed; everything else held and verified. */
  | "clean-controlled"
  /** Intended as controlled; something minor drifted and is named. */
  | "partially-controlled"
  /** Not designed as an experiment. Useful for hypotheses, not for causes. */
  | "observational-comparison"
  /** Multiple things changed together; the effect cannot be attributed. */
  | "confounded"
  /** Broken: identity mismatch, wrong window, impossible timing. */
  | "invalid"
  /** Cannot tell yet, and saying so beats guessing. */
  | "insufficient-information";

export const VALIDITY_STATES: readonly ValidityState[] = [
  "clean-controlled", "partially-controlled", "observational-comparison",
  "confounded", "invalid", "insufficient-information",
];

/** Validity states from which a causal reading may even be considered. */
const CAUSAL_CAPABLE = new Set<ValidityState>(["clean-controlled", "partially-controlled"]);

export function validityPermitsCausalReading(state: ValidityState): boolean {
  return CAUSAL_CAPABLE.has(state);
}

export type ComparisonOutcome =
  | "control-higher"
  | "variant-higher"
  | "indistinguishable"
  | "comparison-unavailable"
  | "comparison-invalid"
  | "comparison-confounded"
  | "insufficient-observations"
  | "window-mismatch"
  | "identity-mismatch";

export const COMPARISON_OUTCOMES: readonly ComparisonOutcome[] = [
  "control-higher", "variant-higher", "indistinguishable", "comparison-unavailable",
  "comparison-invalid", "comparison-confounded", "insufficient-observations",
  "window-mismatch", "identity-mismatch",
];

/** Outcomes that actually name a direction. Everything else is a non-result. */
export function outcomeHasDirection(outcome: ComparisonOutcome): boolean {
  return outcome === "control-higher" || outcome === "variant-higher";
}

// ---------------------------------------------------------------------------
// Baselines (section 70)
// ---------------------------------------------------------------------------

/**
 * Not every comparison point is equally good.
 *
 * A historical baseline is not a control: the world moved between then and now,
 * and every difference between the two periods is a candidate explanation.
 */
export type BaselineKind =
  | "experimental-control"
  | "historical-baseline"
  | "platform-baseline"
  | "mission-family-baseline";

export const BASELINE_EVIDENTIARY_STRENGTH: Record<BaselineKind, ValidityState> = {
  "experimental-control": "clean-controlled",
  "historical-baseline": "observational-comparison",
  "platform-baseline": "observational-comparison",
  "mission-family-baseline": "observational-comparison",
};
