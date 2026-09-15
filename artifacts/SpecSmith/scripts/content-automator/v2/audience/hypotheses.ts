// MASTER #4 — Audience hypotheses (section 3).
//
// Most of what anyone believes about an audience is unproven. Pretending
// otherwise is how content systems end up confidently wrong, so unproven
// beliefs get a type of their own rather than being quietly mixed into the
// profile as facts.
//
// A hypothesis here cannot exist without a falsification condition and a
// measurement requirement. If you cannot say what would prove it wrong and what
// you would have to measure, you do not have a hypothesis — you have a
// preference, and preferences do not shape creative decisions on the record.

import type { AudienceKnowledgeState } from "./model.ts";

export type AudienceHypothesisStatus =
  | "untested"
  /** MASTER #5 is measuring it. No verdict yet. */
  | "under-measurement"
  | "supported-by-measurement"
  | "contradicted-by-measurement"
  /** Measured, and the result was too weak to call either way. */
  | "inconclusive"
  | "abandoned";

/** Statuses that assert a measurement actually happened. */
const MEASURED_STATUSES = new Set<AudienceHypothesisStatus>([
  "supported-by-measurement", "contradicted-by-measurement", "inconclusive",
]);

export interface AudienceHypothesis {
  readonly hypothesisId: string;
  readonly version: number;
  readonly proposition: string;
  /** Why anyone believes this. Not evidence — reasoning. */
  readonly whyBelieved: string;
  readonly supportingObservationIds: readonly string[];
  readonly conflictingObservationIds: readonly string[];
  readonly uncertainty: string;
  /** Who this is believed to apply to. A hypothesis is never universal. */
  readonly audienceScope: string;
  /** What creative would do differently if this were true. */
  readonly creativeImplication: string;
  /** What observation would prove it false. */
  readonly falsificationCondition: string;
  /** What would have to be measured to test it at all. */
  readonly measurementRequirement: string;
  readonly status: AudienceHypothesisStatus;
  /** Set only when a measured status is reached. */
  readonly measurementRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: { readonly synthetic: boolean; readonly producedBy: string };
}

export class HypothesisIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HypothesisIntegrityError";
  }
}

export interface HypothesisInput {
  readonly hypothesisId: string;
  readonly proposition: string;
  readonly whyBelieved: string;
  readonly supportingObservationIds?: readonly string[];
  readonly conflictingObservationIds?: readonly string[];
  readonly uncertainty: string;
  readonly audienceScope: string;
  readonly creativeImplication: string;
  readonly falsificationCondition: string;
  readonly measurementRequirement: string;
  readonly now: Date;
  readonly synthetic: boolean;
  readonly producedBy: string;
}

/**
 * Create a hypothesis. It is born untested and there is no way around that.
 *
 * The length checks are not bureaucracy: a one-word falsification condition is
 * a way of satisfying the field without doing the thinking, and the whole
 * mechanism depends on that thinking having happened.
 */
export function proposeAudienceHypothesis(input: HypothesisInput): AudienceHypothesis {
  if (input.falsificationCondition.trim().length < 12) {
    throw new HypothesisIntegrityError(
      `Hypothesis "${input.proposition}" has no usable falsification condition. ` +
        "A belief that cannot be proven wrong is not a hypothesis and may not influence creative decisions.",
    );
  }
  if (input.measurementRequirement.trim().length < 12) {
    throw new HypothesisIntegrityError(
      `Hypothesis "${input.proposition}" does not say what would have to be measured to test it.`,
    );
  }
  if (input.creativeImplication.trim().length < 8) {
    throw new HypothesisIntegrityError(
      `Hypothesis "${input.proposition}" does not say what creative would do differently if it were true, so it cannot justify any adaptation.`,
    );
  }

  const timestamp = input.now.toISOString();
  return {
    hypothesisId: input.hypothesisId,
    version: 1,
    proposition: input.proposition,
    whyBelieved: input.whyBelieved,
    supportingObservationIds: input.supportingObservationIds ?? [],
    conflictingObservationIds: input.conflictingObservationIds ?? [],
    uncertainty: input.uncertainty,
    audienceScope: input.audienceScope,
    creativeImplication: input.creativeImplication,
    falsificationCondition: input.falsificationCondition,
    measurementRequirement: input.measurementRequirement,
    status: "untested",
    measurementRef: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: { synthetic: input.synthetic, producedBy: input.producedBy },
  };
}

/**
 * Advance a hypothesis. Immutably — a new version, never a mutation.
 *
 * A measured status requires a measurement reference. This is the rule that
 * stops "we shipped it and it felt fine" becoming evidence, and it is MASTER
 * #5's job to supply the reference, not this layer's.
 */
export function updateAudienceHypothesis(
  hypothesis: AudienceHypothesis,
  next: { readonly status: AudienceHypothesisStatus; readonly measurementRef?: string | null; readonly now: Date },
): AudienceHypothesis {
  if (MEASURED_STATUSES.has(next.status)) {
    const ref = next.measurementRef ?? null;
    if (ref === null || ref.trim() === "") {
      throw new HypothesisIntegrityError(
        `Cannot move "${hypothesis.proposition}" to "${next.status}" without a measurement reference. ` +
          "An audience hypothesis does not become a finding because it was used a few times.",
      );
    }
  }
  return {
    ...hypothesis,
    version: hypothesis.version + 1,
    status: next.status,
    measurementRef: next.measurementRef ?? hypothesis.measurementRef,
    updatedAt: next.now.toISOString(),
  };
}

/**
 * The knowledge state a hypothesis contributes to a profile.
 *
 * Note what is absent: no status maps to `observed`. A measured hypothesis is a
 * supported inference at best, because the measurement tested the effect, not
 * the mechanism claimed for it.
 */
export function hypothesisKnowledgeState(hypothesis: AudienceHypothesis): AudienceKnowledgeState {
  switch (hypothesis.status) {
    case "supported-by-measurement":
      return "supported-inference";
    case "contradicted-by-measurement":
    case "abandoned":
      return "unknown";
    case "inconclusive":
      return "insufficient-data";
    default:
      return "hypothesis";
  }
}

/** An immutable registry. Updates append versions rather than overwriting. */
export class AudienceHypothesisRegistry {
  private readonly entries = new Map<string, AudienceHypothesis[]>();

  add(hypothesis: AudienceHypothesis): void {
    const history = this.entries.get(hypothesis.hypothesisId) ?? [];
    if (history.length > 0 && history[history.length - 1].version >= hypothesis.version) {
      throw new HypothesisIntegrityError(
        `Hypothesis ${hypothesis.hypothesisId} version ${hypothesis.version} does not advance the recorded history. History is not rewritten.`,
      );
    }
    history.push(hypothesis);
    this.entries.set(hypothesis.hypothesisId, history);
  }

  current(hypothesisId: string): AudienceHypothesis | null {
    const history = this.entries.get(hypothesisId);
    return history === undefined || history.length === 0 ? null : history[history.length - 1];
  }

  /** Every version, for reconstructing what was believed at a past moment. */
  history(hypothesisId: string): readonly AudienceHypothesis[] {
    return this.entries.get(hypothesisId) ?? [];
  }

  all(): readonly AudienceHypothesis[] {
    return [...this.entries.keys()].sort().map((id) => this.current(id)).filter((h): h is AudienceHypothesis => h !== null);
  }

  /** Hypotheses MASTER #5 could test, in a stable order. */
  testable(): readonly AudienceHypothesis[] {
    return this.all().filter((h) => h.status === "untested");
  }
}
