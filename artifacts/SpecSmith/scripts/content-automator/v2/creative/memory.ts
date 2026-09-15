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
import type { Experiment, ExperimentScope } from "../experiment/model.ts";
import type { ExperimentResult } from "../experiment/experimentPass.ts";
import { MANDATORY_GUARDRAIL_IDS } from "../experiment/metrics.ts";

/** Resolved from the experiment store, never supplied as a strength label. */
export interface CreativeEvidenceSource {
  readonly experiment: Experiment;
  readonly result: ExperimentResult;
  readonly invalidated?: boolean;
}

export function sameCreativeScope(a: ExperimentScope, b: ExperimentScope): boolean {
  return a.platform === b.platform && a.audienceProfileId === b.audienceProfileId &&
    a.audienceWasUnknown === b.audienceWasUnknown && a.audienceDescription === b.audienceDescription &&
    a.topicFamily === b.topicFamily && a.missionFamily === b.missionFamily && a.objective === b.objective;
}

function checkedSource(source: CreativeEvidenceSource | undefined, experimentId: string, allowSynthetic: boolean) {
  if (!source || source.invalidated) throw new CreativeMemoryError("Missing or invalidated experiment evidence.");
  const { experiment, result } = source;
  const interpretation = result.interpretation;
  const candidate = result.learningCandidate;
  if (experiment.status === "invalidated" || experiment.experimentId !== experimentId || result.experimentId !== experimentId ||
      result.experimentRevision !== experiment.revision || result.designHash !== experiment.designHash ||
      result.window !== experiment.observationWindow || !interpretation || !candidate ||
      interpretation.experimentId !== experimentId || interpretation.designHash !== result.designHash ||
      interpretation.experimentRevision !== experiment.revision ||
      candidate.evidenceStrength !== interpretation.evidence.strength ||
      !sameCreativeScope(candidate.scope, experiment.scope) ||
      !interpretation.guardrails.allPassed || !MANDATORY_GUARDRAIL_IDS.every((id) => interpretation.guardrails.results.some((guardrail) => guardrail.guardrailId === id && guardrail.passed)) || interpretation.validity.state === "invalid" ||
      candidate.recommendedMemoryAction === "do-not-store" || !result.resultHash) {
    throw new CreativeMemoryError("Experiment evidence identity, permission or candidate validation failed.");
  }
  if (!allowSynthetic && (experiment.provenance.synthetic || result.synthetic || interpretation.synthetic || candidate.synthetic)) {
    throw new CreativeMemoryError("Synthetic experiment evidence cannot enter production memory.");
  }
  return { experiment, result, interpretation, candidate };
}

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
  | "disclosure-placement"
  | "hook-form";

function decisionSupported(decision: CreativeDecision, experiment: Experiment): boolean {
  const dimensions: Record<CreativeDecisionKind, readonly string[]> = {
    "explanatory-structure": ["before-after-structure", "result-first-vs-context-first", "claim-order"],
    "visual-mechanism": ["first-visual-type", "screen-capture-vs-motion-graphic", "comparison-layout"],
    "audience-experience": ["question-vs-statement"],
    "disclosure-placement": [], // required disclosures are not experimental variables
    "hook-form": ["hook-form"],
  };
  return experiment.variants.filter((variant) => !variant.isControl).some((variant) =>
    variant.differences.some((difference) => dimensions[decision.kind]?.includes(difference.dimension) && difference.variant === decision.value));
}

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
  readonly evidenceReference?: { readonly experimentId: string; readonly resultId: string; readonly resultHash: string };
  readonly scope?: ExperimentScope;
  readonly memoryAction?: string;
  readonly reusePermitted?: boolean;
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
  readonly evidenceSource?: CreativeEvidenceSource;
  readonly allowSynthetic?: boolean;
}

/**
 * Build a memory entry, refusing the combinations that turn memory into
 * superstition.
 */
export function recordCreativeDecision(input: RecordInput): CreativeMemoryEntry {
  const { outcome, evidenceStrength } = input;
  if (input.synthetic && !input.allowSynthetic) throw new CreativeMemoryError("Synthetic memory requires an isolated engineering environment.");

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

  const source = outcome.state === "measured" ? checkedSource(input.evidenceSource, outcome.experimentId, input.allowSynthetic === true) : undefined;
  if (source && !decisionSupported(input.decision, source.experiment)) {
    throw new CreativeMemoryError("Experiment does not test this creative decision and value.");
  }
  if (source && (source.interpretation.evidence.strength !== evidenceStrength ||
      source.result.synthetic !== input.synthetic)) {
    throw new CreativeMemoryError("Caller-supplied evidence strength or provenance differs from the experiment result.");
  }

  return {
    version: CREATIVE_MEMORY_VERSION,
    entryId: input.entryId,
    recordedAt: input.now.toISOString(),
    conceptId: input.conceptId,
    decision: input.decision,
    outcome: source ? { state: "measured", experimentId: source.experiment.experimentId, observation: source.interpretation.whatHappened } : outcome,
    evidenceStrength,
    synthetic: input.synthetic,
    note: input.note,
    ...(source ? {
      scope: structuredClone(source.experiment.scope),
      memoryAction: source.candidate.recommendedMemoryAction,
      reusePermitted: source.interpretation.primaryComparison.outcome === "variant-higher",
      evidenceReference: { experimentId: source.result.experimentId, resultId: source.result.resultId, resultHash: source.result.resultHash },
    } : {}),
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
  readonly scope?: ExperimentScope;
  /** Re-resolve current evidence so withdrawn or superseded results cannot guide. */
  readonly evidenceSources?: ReadonlyMap<string, CreativeEvidenceSource>;
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
  if (entry.outcome.state !== "measured") return "context";
  if (entry.reusePermitted === true && entry.memoryAction === "store-as-replicated" && strengthPermitsReuse(entry.evidenceStrength)) return "guidance";
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
  const seen = new Set<string>();
  const verified = usable.filter((entry) => {
    const key = entry.outcome.state === "measured" ? `${entry.evidenceReference?.experimentId}:${entry.decision.kind}:${entry.decision.value}` : entry.entryId;
    if (seen.has(key)) return false;
    if (entry.outcome.state === "measured") {
      if (!entry.scope || !query.scope || !sameCreativeScope(entry.scope, query.scope) || !entry.evidenceReference) return false;
      try {
        const source = checkedSource(query.evidenceSources?.get(entry.outcome.experimentId), entry.outcome.experimentId, query.allowSynthetic);
        if (!decisionSupported(entry.decision, source.experiment) || entry.reusePermitted !== (source.interpretation.primaryComparison.outcome === "variant-higher")) return false;
        if (source.result.resultId !== entry.evidenceReference.resultId || source.result.resultHash !== entry.evidenceReference.resultHash ||
            source.interpretation.evidence.strength !== entry.evidenceStrength || !sameCreativeScope(source.experiment.scope, entry.scope) ||
            source.interpretation.whatHappened !== entry.outcome.observation || source.result.synthetic !== entry.synthetic ||
            source.candidate.recommendedMemoryAction !== entry.memoryAction) return false;
      } catch { return false; }
    }
    seen.add(key);
    return true;
  });
  const observations = verified.map((entry) => {
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
