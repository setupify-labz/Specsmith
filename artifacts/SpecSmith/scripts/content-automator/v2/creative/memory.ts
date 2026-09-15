// MASTER #6 — Creative memory and grounded retrieval (capabilities #7 and #8).
//
// WHY THIS EXISTS
//
// `publishingStore` remembers publications and analytics snapshots. It does not
// remember creative DECISIONS. Section 1's most valuable observation has nowhere
// to live today:
//
//   "elimination-then-substitution structures get hollowed out by the evidence
//    gate at their payoff beat"
//
// That is a claim about an explanatory STRUCTURE, tied to an outcome. It is the
// kind of thing that should make the next brief better. It is also exactly the
// kind of thing that becomes superstition the moment it is remembered without
// its evidence — one video underperforms, someone writes down "hooks under three
// seconds do not work", and a year later that is house style.
//
// So memory here is deliberately austere:
//
//   1. An entry records a decision (axes + mechanism) against an outcome, and
//      the outcome may be `unknown`. Unknown is first-class and is never
//      defaulted to neutral, zero, or "fine".
//   2. Every entry carries MASTER #5's `EvidenceStrength`, assigned from the
//      evidence that actually exists, not asserted by the writer.
//   3. Retrieval NEVER returns a rule. It returns observations with their
//      strength attached, and it refuses to let a weak observation be phrased
//      as guidance. `strengthPermitsReuse` from MASTER #5 is the gate, reused
//      rather than re-invented, so creative memory and experiment memory cannot
//      drift to different standards of proof.
//
// Determinism: `now` is always an argument. This module reads no clock and
// performs no I/O; persistence uses `publishingStore`'s conventions at the call
// site so the store stays one place.

import {
  strengthPermitsReuse,
  type EvidenceStrength,
} from "../experiment/model.ts";
import type { AudienceExperience, ExplanatoryStructure, VisualMechanism } from "./concept.ts";

export const CREATIVE_MEMORY_VERSION = "creative-memory-v1";

/**
 * What a memory entry is about.
 *
 * Narrow on purpose. A memory that can be about anything is a memory that can
 * justify anything.
 */
export type CreativeDecisionKind =
  | "explanatory-structure"
  | "visual-mechanism"
  | "audience-experience"
  | "disclosure-placement";

export interface CreativeDecision {
  readonly kind: CreativeDecisionKind;
  /** The specific value chosen, e.g. "elimination-then-substitution". */
  readonly value: ExplanatoryStructure | VisualMechanism | AudienceExperience | string;
}

/**
 * The outcome of a decision.
 *
 * `unknown` is the default state of the world and is not a failure. Most
 * creative decisions in this repository have no measured outcome at all, and
 * saying so is the honest record.
 */
export type CreativeOutcome =
  | { readonly state: "unknown"; readonly reason: string }
  /** Something observable happened inside the pipeline, not on a platform. */
  | { readonly state: "process"; readonly observation: string }
  /** A measured result arrived through MASTER #5's analytics path. */
  | { readonly state: "measured"; readonly observation: string; readonly experimentId: string };

export interface CreativeMemoryEntry {
  readonly version: typeof CREATIVE_MEMORY_VERSION;
  readonly entryId: string;
  readonly recordedAt: string;
  readonly conceptId: string;
  readonly decision: CreativeDecision;
  readonly outcome: CreativeOutcome;
  readonly evidenceStrength: EvidenceStrength;
  /** Whether this entry came from synthetic engineering input. */
  readonly synthetic: boolean;
  /** Free text, for a human reading the ledger later. */
  readonly note: string;
}

export class CreativeMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreativeMemoryError";
  }
}

export interface RecordInput {
  readonly entryId: string;
  readonly conceptId: string;
  readonly decision: CreativeDecision;
  readonly outcome: CreativeOutcome;
  readonly evidenceStrength: EvidenceStrength;
  readonly synthetic: boolean;
  readonly note: string;
  readonly now: Date;
}

/**
 * Build a memory entry, refusing the combinations that turn memory into
 * superstition.
 */
export function recordCreativeDecision(input: RecordInput): CreativeMemoryEntry {
  const { outcome, evidenceStrength } = input;

  // An unknown outcome cannot support any evidence at all. This is the single
  // most important rule here: it is what stops "we did this and then stopped
  // paying attention" from becoming "this works".
  if (outcome.state === "unknown" && evidenceStrength !== "insufficient") {
    throw new CreativeMemoryError(
      `An outcome of "unknown" cannot carry evidence strength "${evidenceStrength}". ` +
        "Not having looked is not a weak result; it is no result.",
    );
  }

  // A process observation is something we watched happen inside our own
  // pipeline. It can be real and useful, but it is one observation about one
  // concept and it can never generalize on its own.
  if (outcome.state === "process" && strengthPermitsReuse(evidenceStrength)) {
    throw new CreativeMemoryError(
      `A process observation cannot reach "${evidenceStrength}". Watching our own pipeline behave a certain way ` +
        "once is not a replicated result about audiences.",
    );
  }

  if (outcome.state === "measured" && outcome.experimentId.trim() === "") {
    throw new CreativeMemoryError(
      "A measured outcome must name the experiment it came from, or it cannot be checked and is not measured.",
    );
  }

  return {
    version: CREATIVE_MEMORY_VERSION,
    entryId: input.entryId,
    recordedAt: input.now.toISOString(),
    conceptId: input.conceptId,
    decision: input.decision,
    outcome,
    evidenceStrength,
    synthetic: input.synthetic,
    note: input.note,
  };
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface RetrievalQuery {
  readonly kind: CreativeDecisionKind;
  readonly value?: string;
  /**
   * Whether synthetic entries may be returned. Production retrieval must pass
   * false: an engineering fixture must never become creative guidance.
   */
  readonly allowSynthetic: boolean;
}

export interface RetrievedObservation {
  readonly entry: CreativeMemoryEntry;
  /**
   * How this may be used in a brief.
   *
   *   guidance   strong enough to justify reusing the pattern
   *   context    real, but the brief must still decide for itself
   *   nothing    recorded, but carries no weight; returned so a human can see
   *              that the question was asked and came back empty
   */
  readonly usage: "guidance" | "context" | "nothing";
  /** Sentence safe to put in a brief verbatim, with its hedging attached. */
  readonly phrasing: string;
}

export interface RetrievalResult {
  readonly observations: readonly RetrievedObservation[];
  /** True when nothing retrieved may be used as guidance. */
  readonly noGuidanceAvailable: boolean;
  readonly excludedSyntheticCount: number;
}

function usageFor(entry: CreativeMemoryEntry): RetrievedObservation["usage"] {
  if (entry.outcome.state === "unknown") return "nothing";
  if (strengthPermitsReuse(entry.evidenceStrength)) return "guidance";
  return "context";
}

function phrasingFor(entry: CreativeMemoryEntry, usage: RetrievedObservation["usage"]): string {
  const subject = `${entry.decision.kind} "${entry.decision.value}"`;
  if (usage === "nothing") {
    const reason = entry.outcome.state === "unknown" ? entry.outcome.reason : "no outcome was recorded";
    return `SpecSmith has used ${subject} before but does not know how it did: ${reason}. This is not a reason to repeat or avoid it.`;
  }
  if (usage === "context") {
    const observation = entry.outcome.state === "unknown" ? "" : entry.outcome.observation;
    return `One prior observation about ${subject}: ${observation} Evidence strength is "${entry.evidenceStrength}", so this is context for a decision, not a rule.`;
  }
  const observation = entry.outcome.state === "unknown" ? "" : entry.outcome.observation;
  return `${subject}: ${observation} This reached "${entry.evidenceStrength}" within its stated scope and may be reused, within that scope only.`;
}

/**
 * Retrieve prior decisions, with their evidence bound to them.
 *
 * Deterministic: entries are returned in the order they were recorded, and no
 * ranking or relevance score is applied. A relevance score would be an
 * unevidenced judgement about which memory matters, which is the failure mode
 * this module exists to prevent.
 */
export function retrieveCreativeMemory(
  entries: readonly CreativeMemoryEntry[],
  query: RetrievalQuery,
): RetrievalResult {
  const matching = entries.filter((entry) => {
    if (entry.decision.kind !== query.kind) return false;
    if (query.value !== undefined && entry.decision.value !== query.value) return false;
    return true;
  });

  const excludedSyntheticCount = query.allowSynthetic ? 0 : matching.filter((entry) => entry.synthetic).length;
  const usable = query.allowSynthetic ? matching : matching.filter((entry) => !entry.synthetic);

  const observations = usable.map((entry) => {
    const usage = usageFor(entry);
    return { entry, usage, phrasing: phrasingFor(entry, usage) };
  });

  return {
    observations,
    noGuidanceAvailable: !observations.some((observation) => observation.usage === "guidance"),
    excludedSyntheticCount,
  };
}

/**
 * Translate retrieval into the lines a brief may carry.
 *
 * Returns nothing at all when there is nothing to say, rather than a
 * reassuring sentence. An empty memory must feel empty.
 */
export function briefLinesFromMemory(result: RetrievalResult): readonly string[] {
  return result.observations
    .filter((observation) => observation.usage !== "nothing")
    .map((observation) => observation.phrasing);
}
