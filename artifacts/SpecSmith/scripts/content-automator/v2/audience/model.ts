// MASTER #4 — Audience intelligence model.
//
// The whole point of this file is that it is HARD to state something about an
// audience. Every audience dimension is a `Held<T>`: a value that cannot exist
// without a knowledge state and a provenance trail. There is no field you can
// set to "beginner" by typing "beginner" — you must say how you know.
//
// This is deliberately not a persona generator. A persona is a story told about
// a person nobody observed. The states below make the difference between
// "observed" and "made up" a type error rather than a matter of taste.

import type { ClaimKind } from "../research/model.ts";

/**
 * How well we know an audience fact.
 *
 * These are not confidence percentages. They are different KINDS of knowing,
 * and they do not collapse into one another: a hypothesis repeated ten times is
 * still a hypothesis, and `unknown` is never a quiet way of saying "no".
 */
export type AudienceKnowledgeState =
  /** Structurally true by construction. "This page exists" is known. */
  | "known"
  /** A real signal from a real collector observed it. */
  | "observed"
  /** Not observed, but follows from something observed, and the step is stated. */
  | "supported-inference"
  /** Believed, not established. Must carry a falsification condition. */
  | "hypothesis"
  /** Nobody looked, or looking found nothing. NEVER the same as false or zero. */
  | "unknown"
  /** Two real signals disagree. Not averaged, not resolved by preference. */
  | "conflicting"
  /** Was observed, but the observation is past its usable window. */
  | "stale"
  /** A collector exists and returned too little to say anything. */
  | "insufficient-data";

export const AUDIENCE_KNOWLEDGE_STATES: readonly AudienceKnowledgeState[] = [
  "known", "observed", "supported-inference", "hypothesis",
  "unknown", "conflicting", "stale", "insufficient-data",
];

/**
 * States in which a value may actually be present.
 *
 * `unknown`, `insufficient-data` and `stale` carry no usable value — a stale
 * observation is retained for audit but must not be read as current fact.
 */
const STATES_WITH_VALUE = new Set<AudienceKnowledgeState>([
  "known", "observed", "supported-inference", "hypothesis", "conflicting",
]);

export function stateCarriesValue(state: AudienceKnowledgeState): boolean {
  return STATES_WITH_VALUE.has(state);
}

/**
 * States a creative execution is allowed to rely on without hedging.
 *
 * A hypothesis may shape execution, but the brief must say it is a hypothesis.
 * That distinction is what section 6 calls "strategically useful for a logical
 * audience" versus "we observed this audience demanding it".
 */
const RELIABLE_STATES = new Set<AudienceKnowledgeState>(["known", "observed", "supported-inference"]);

export function stateIsReliable(state: AudienceKnowledgeState): boolean {
  return RELIABLE_STATES.has(state);
}

/**
 * A value that cannot be stated without saying how it is known.
 *
 * `value` is null in exactly the states that carry no value. `buildHeld`
 * enforces that; the type alone cannot, but every construction path in MASTER #4
 * goes through it.
 */
export interface Held<T> {
  readonly value: T | null;
  readonly state: AudienceKnowledgeState;
  /** Signal IDs that support this. Empty for unknown/hypothesis-without-signal. */
  readonly signalIds: readonly string[];
  /** Why we believe it, in a sentence an auditor can check. */
  readonly basis: string;
}

export class AudienceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudienceStateError";
  }
}

/**
 * The only way to construct a Held value.
 *
 * Refuses the two failure modes that matter: claiming a value in a state that
 * carries none, and claiming an observation with nothing observed. The second
 * is what stops `observed` being used as a synonym for "I am confident".
 */
export function buildHeld<T>(input: {
  readonly value: T | null;
  readonly state: AudienceKnowledgeState;
  readonly signalIds?: readonly string[];
  readonly basis: string;
}): Held<T> {
  const signalIds = input.signalIds ?? [];
  const carries = stateCarriesValue(input.state);

  if (!carries && input.value !== null) {
    throw new AudienceStateError(
      `State "${input.state}" carries no value, but one was supplied (${JSON.stringify(input.value)}). ` +
        "Unknown is not zero, not a default and not an average; it has no value at all.",
    );
  }
  if (carries && input.value === null) {
    throw new AudienceStateError(
      `State "${input.state}" asserts a value but none was supplied. Use "unknown" when nothing is known.`,
    );
  }
  if ((input.state === "observed" || input.state === "conflicting" || input.state === "stale") && signalIds.length === 0) {
    throw new AudienceStateError(
      `State "${input.state}" claims a real observation but cites no signal. An observation with no signal is an invention.`,
    );
  }
  if (input.state === "conflicting" && signalIds.length < 2) {
    throw new AudienceStateError(
      "A conflict requires at least two signals to disagree; one signal cannot conflict with itself.",
    );
  }
  if (input.basis.trim().length < 8) {
    throw new AudienceStateError("Every audience value must carry a basis an auditor can check.");
  }

  return { value: input.value, state: input.state, signalIds, basis: input.basis.trim() };
}

/** The unknown of a given dimension. The most common honest answer. */
export function unknownHeld<T>(basis: string): Held<T> {
  return buildHeld<T>({ value: null, state: "unknown", basis });
}

// ---------------------------------------------------------------------------
// Audience dimensions (section 1)
// ---------------------------------------------------------------------------

export type ExpertiseLevel = "beginner" | "intermediate" | "advanced" | "mixed";

export type JobToBeDone =
  | "build-first-pc"
  | "choose-between-components"
  | "diagnose-poor-performance"
  | "estimate-fps"
  | "understand-confusing-concept"
  | "determine-upgrade-path"
  | "avoid-compatibility-mistake"
  | "optimize-existing-system"
  | "learn-without-buying";

export const JOBS_TO_BE_DONE: readonly JobToBeDone[] = [
  "build-first-pc", "choose-between-components", "diagnose-poor-performance",
  "estimate-fps", "understand-confusing-concept", "determine-upgrade-path",
  "avoid-compatibility-mistake", "optimize-existing-system", "learn-without-buying",
];

export type AudienceIntent =
  | "informational" | "comparison" | "troubleshooting" | "purchasing-research"
  | "configuration" | "curiosity" | "validation" | "discovery";

export const AUDIENCE_INTENTS: readonly AudienceIntent[] = [
  "informational", "comparison", "troubleshooting", "purchasing-research",
  "configuration", "curiosity", "validation", "discovery",
];

export type ReadinessState =
  | "researching" | "deciding" | "building" | "upgrading"
  | "troubleshooting" | "post-purchase" | "unknown";

export type RiskSensitivity =
  | "purchase-risk" | "compatibility-risk" | "performance-risk"
  | "low-risk-educational" | "unknown";

export type TrustRequirement =
  | "requires-evidence"
  | "requires-demonstration"
  | "requires-caveat"
  | "requires-configuration-disclosure"
  | "requires-source-disclosure";

export const TRUST_REQUIREMENTS: readonly TrustRequirement[] = [
  "requires-evidence", "requires-demonstration", "requires-caveat",
  "requires-configuration-disclosure", "requires-source-disclosure",
];

export type NextUsefulAction =
  | "continue-learning" | "compare" | "inspect-builder" | "check-compatibility"
  | "test-fps-estimate" | "inspect-upgrade-tool" | "no-cta";

/**
 * What the viewer probably already understands, and what may not be assumed.
 *
 * `cannotAssume` is the load-bearing half. A creative that assumes a term is
 * understood when it is not has failed the audience even if every fact in it is
 * true.
 */
export interface KnowledgeState {
  readonly likelyUnderstood: Held<readonly string[]>;
  readonly cannotAssume: Held<readonly string[]>;
  readonly prerequisiteConcepts: Held<readonly string[]>;
  readonly terminologyFamiliarity: Held<readonly string[]>;
}

/**
 * Confusion the audience actually has.
 *
 * A misconception may only be asserted when MASTER #2 supports that it EXISTS —
 * that is what the `misconception-exists` claim kind is for. We do not get to
 * decide that our audience is confused because it makes a better hook.
 */
export interface ConfusionState {
  readonly supportedConfusions: Held<readonly string[]>;
  readonly unresolvedQuestions: Held<readonly string[]>;
  readonly ambiguousTerminology: Held<readonly string[]>;
  /** Only ever populated from a `misconception-exists` claim MASTER #2 approved. */
  readonly evidencedMisconceptions: Held<readonly string[]>;
}

/**
 * Demographics.
 *
 * Every field is permanently `unknown` in this repository: no collector
 * produces age, gender, income, location or occupation, and none of them is
 * strategically relevant to explaining whether VRAM determines frame rate.
 * The type exists so that "we do not know this" is recorded explicitly rather
 * than being an absence someone later fills with a persona.
 */
export interface DemographicState {
  readonly age: Held<string>;
  readonly gender: Held<string>;
  readonly income: Held<string>;
  readonly location: Held<string>;
  readonly occupation: Held<string>;
}

export function unknownDemographics(): DemographicState {
  const basis =
    "No demographic collector exists in this repository, and no demographic dimension is strategically " +
    "relevant to this content. Inventing one would be a persona, not an audience.";
  return {
    age: unknownHeld<string>(basis),
    gender: unknownHeld<string>(basis),
    income: unknownHeld<string>(basis),
    location: unknownHeld<string>(basis),
    occupation: unknownHeld<string>(basis),
  };
}

/**
 * An operational audience segment (section 5).
 *
 * Defined by problem, intent, knowledge, readiness and risk — never by a
 * biography. `segmentId` is derived from those axes so two derivations of the
 * same segment collide rather than multiplying.
 */
export interface AudienceSegment {
  readonly segmentId: string;
  readonly name: string;
  readonly job: JobToBeDone;
  readonly intent: AudienceIntent;
  readonly expertise: ExpertiseLevel;
  readonly readiness: ReadinessState;
  readonly riskSensitivity: RiskSensitivity;
  /** Why this segment was derived at all, tied to the inputs that justified it. */
  readonly derivedFrom: string;
  readonly state: AudienceKnowledgeState;
}

/**
 * The immutable audience snapshot a brief is built from (sections 1, 29).
 *
 * Immutable by contract: later analytics create a new version rather than
 * rewriting what was believed at decision time.
 */
export interface AudienceProfile {
  readonly version: "audience-profile-v1";
  readonly profileId: string;
  readonly revision: number;
  readonly missionId: string;
  readonly createdAt: string;

  readonly expertise: Held<ExpertiseLevel>;
  readonly job: Held<JobToBeDone>;
  readonly intent: Held<AudienceIntent>;
  readonly readiness: Held<ReadinessState>;
  readonly riskSensitivity: Held<RiskSensitivity>;
  readonly knowledge: KnowledgeState;
  readonly confusion: ConfusionState;
  readonly demographics: DemographicState;

  readonly trustRequirements: Held<readonly TrustRequirement[]>;
  /** Only observed or evidence-supported objections. Guesses live in hypotheses. */
  readonly objections: Held<readonly string[]>;
  readonly nextUsefulAction: Held<NextUsefulAction>;

  readonly segments: readonly AudienceSegment[];
  /** True when the segments cannot be served cleanly by one creative. */
  readonly segmentsConflict: boolean;
  readonly segmentConflictReason: string | null;

  readonly hypothesisIds: readonly string[];
  readonly unknowns: readonly string[];
  readonly limitations: readonly string[];
  readonly provenance: AudienceProvenance;
}

export interface AudienceProvenance {
  readonly synthetic: boolean;
  readonly producedBy: string;
  readonly producedAt: string;
  /** Signal bundle this profile was derived from, for reconstruction. */
  readonly signalBundleId: string;
}

/**
 * Claim kinds that carry audience facts.
 *
 * MASTER #2 already owns these. MASTER #4 reads them; it does not invent a
 * second evidence system for statements about people.
 */
export const AUDIENCE_CLAIM_KINDS: readonly ClaimKind[] = ["audience-behaviour", "misconception-exists"];

/** Every dimension of a profile, for reporting and for the unknown audit. */
export function profileDimensions(profile: AudienceProfile): readonly { readonly name: string; readonly held: Held<unknown> }[] {
  return [
    { name: "expertise", held: profile.expertise },
    { name: "job", held: profile.job },
    { name: "intent", held: profile.intent },
    { name: "readiness", held: profile.readiness },
    { name: "riskSensitivity", held: profile.riskSensitivity },
    { name: "knowledge.likelyUnderstood", held: profile.knowledge.likelyUnderstood },
    { name: "knowledge.cannotAssume", held: profile.knowledge.cannotAssume },
    { name: "knowledge.prerequisiteConcepts", held: profile.knowledge.prerequisiteConcepts },
    { name: "knowledge.terminologyFamiliarity", held: profile.knowledge.terminologyFamiliarity },
    { name: "confusion.supportedConfusions", held: profile.confusion.supportedConfusions },
    { name: "confusion.unresolvedQuestions", held: profile.confusion.unresolvedQuestions },
    { name: "confusion.ambiguousTerminology", held: profile.confusion.ambiguousTerminology },
    { name: "confusion.evidencedMisconceptions", held: profile.confusion.evidencedMisconceptions },
    { name: "demographics.age", held: profile.demographics.age },
    { name: "demographics.gender", held: profile.demographics.gender },
    { name: "demographics.income", held: profile.demographics.income },
    { name: "demographics.location", held: profile.demographics.location },
    { name: "demographics.occupation", held: profile.demographics.occupation },
    { name: "trustRequirements", held: profile.trustRequirements },
    { name: "objections", held: profile.objections },
    { name: "nextUsefulAction", held: profile.nextUsefulAction },
  ];
}
