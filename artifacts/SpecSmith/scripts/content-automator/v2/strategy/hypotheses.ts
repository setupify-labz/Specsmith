// The strategic hypothesis registry.
//
// A STRATEGIC HYPOTHESIS IS NOT A FACT AND NOT A RESEARCH CLAIM
// -------------------------------------------------------------
// MASTER #2's claims are about the world: "this card has 12GB". A strategic
// hypothesis is about SpecSmith's own mechanism: "if we explain X and tie it to
// the upgrade tool, people with problem Y are more likely to open it". Nobody
// can look that up. It is only ever settled by running the thing and measuring,
// which is MASTER #5's job.
//
// So every hypothesis here is born `untested` and there is deliberately NO code
// path that promotes one without a measured result. The registry exists now, one
// master early, because a mission produced today should record the bet it is
// making — otherwise when analytics eventually arrive there is nothing to
// compare them against and the learning is lost.
//
// WHY FALSIFICATION CRITERIA ARE REQUIRED
// ---------------------------------------
// A hypothesis you cannot lose is not a hypothesis. Requiring the criterion at
// construction time is what stops the registry filling with unfalsifiable
// statements like "good content builds the brand".

import { createHash } from "node:crypto";

import type { StrategicObjective, StrategyProvenance } from "./model.ts";

export type HypothesisStatus =
  /** Recorded, never tested. Every hypothesis starts here. */
  | "untested"
  /** A measured result supports it. Only MASTER #5 may set this. */
  | "supported"
  | "weakly-supported"
  /** Measured results conflict. */
  | "disputed"
  /** A measured result contradicts it. */
  | "rejected"
  /** No longer relevant; kept for history. */
  | "retired";

/** Statuses that require measured performance data to reach. */
export const REQUIRES_MEASUREMENT: readonly HypothesisStatus[] = [
  "supported", "weakly-supported", "disputed", "rejected",
];

export interface StrategicHypothesis {
  readonly hypothesisId: string;
  readonly version: number;
  readonly proposition: string;
  /** The causal story. Without one it is a wish, not a hypothesis. */
  readonly expectedMechanism: string;
  readonly audience: string;
  readonly objective: StrategicObjective;
  /** What would have to be observed for this to be wrong. Required. */
  readonly falsificationCriteria: string;
  /** What must be measured to settle it, and whether that is possible today. */
  readonly measurementRequirement: string;
  readonly measurementAvailable: boolean;
  readonly assumptions: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly opposingEvidence: readonly string[];
  readonly status: HypothesisStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: StrategyProvenance;
  /** Append-only history. Reasoning is never overwritten. */
  readonly history: readonly { readonly at: string; readonly status: HypothesisStatus; readonly why: string }[];
}

export class HypothesisError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HypothesisError";
    this.code = code;
  }
}

export interface ProposeHypothesisInput {
  readonly proposition: string;
  readonly expectedMechanism: string;
  readonly audience: string;
  readonly objective: StrategicObjective;
  readonly falsificationCriteria: string;
  readonly measurementRequirement: string;
  /** Whether SpecSmith can measure this today. Almost always false. */
  readonly measurementAvailable: boolean;
  readonly assumptions: readonly string[];
  readonly now: Date;
  readonly provenance: StrategyProvenance;
}

/** Creates a hypothesis. Always `untested`; there is no other entry point. */
export function proposeHypothesis(input: ProposeHypothesisInput): StrategicHypothesis {
  if (input.falsificationCriteria.trim().length < 10) {
    throw new HypothesisError(
      "unfalsifiable",
      `Hypothesis "${input.proposition}" has no falsification criteria. A hypothesis that cannot be wrong is not a hypothesis and may not enter the registry.`,
    );
  }
  if (input.expectedMechanism.trim().length < 10) {
    throw new HypothesisError(
      "no-mechanism",
      `Hypothesis "${input.proposition}" states no expected mechanism, so there is nothing to test even in principle.`,
    );
  }

  const hypothesisId = `hyp-${createHash("sha256").update(`${input.proposition}|${input.objective}`.toLowerCase()).digest("hex").slice(0, 16)}`;
  const at = input.now.toISOString();

  return {
    hypothesisId,
    version: 1,
    proposition: input.proposition,
    expectedMechanism: input.expectedMechanism,
    audience: input.audience,
    objective: input.objective,
    falsificationCriteria: input.falsificationCriteria,
    measurementRequirement: input.measurementRequirement,
    measurementAvailable: input.measurementAvailable,
    assumptions: input.assumptions,
    supportingEvidence: [],
    opposingEvidence: [],
    status: "untested",
    createdAt: at,
    updatedAt: at,
    provenance: input.provenance,
    history: [{ at, status: "untested", why: "Recorded at mission time. No performance data exists to settle it." }],
  };
}

/**
 * Advances a hypothesis on measured evidence.
 *
 * Refuses to reach any measured status without a measurement reference, which is
 * what stops the strategy layer marking its own bets as vindicated. Today every
 * call would be refused, because no creative has been published — and that
 * refusal is the correct behaviour rather than a gap to work around.
 */
export function updateHypothesisStatus(
  hypothesis: StrategicHypothesis,
  update: {
    readonly status: HypothesisStatus;
    readonly why: string;
    /** An identifier for the measured result. Required for measured statuses. */
    readonly measurementRef?: string;
    readonly now: Date;
  },
): StrategicHypothesis {
  if (REQUIRES_MEASUREMENT.includes(update.status) && !update.measurementRef) {
    throw new HypothesisError(
      "unmeasured-promotion",
      `Cannot move ${hypothesis.hypothesisId} to ${update.status} without a measurement reference. Strategy may not mark its own hypothesis supported; only a measured result can.`,
    );
  }
  const at = update.now.toISOString();
  return {
    ...hypothesis,
    version: hypothesis.version + 1,
    status: update.status,
    updatedAt: at,
    supportingEvidence: update.status === "supported" || update.status === "weakly-supported"
      ? [...hypothesis.supportingEvidence, update.measurementRef!]
      : hypothesis.supportingEvidence,
    opposingEvidence: update.status === "rejected"
      ? [...hypothesis.opposingEvidence, update.measurementRef!]
      : hypothesis.opposingEvidence,
    history: [...hypothesis.history, { at, status: update.status, why: update.why }],
  };
}

/** A small in-memory registry with deterministic ordering. */
export class HypothesisRegistry {
  private readonly byId = new Map<string, StrategicHypothesis>();

  /** Adds, or returns the existing record for an identical proposition. */
  record(hypothesis: StrategicHypothesis): StrategicHypothesis {
    const existing = this.byId.get(hypothesis.hypothesisId);
    if (existing) return existing;
    this.byId.set(hypothesis.hypothesisId, hypothesis);
    return hypothesis;
  }

  get(hypothesisId: string): StrategicHypothesis | undefined {
    return this.byId.get(hypothesisId);
  }

  all(): StrategicHypothesis[] {
    return [...this.byId.values()].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId));
  }

  byStatus(status: HypothesisStatus): StrategicHypothesis[] {
    return this.all().filter((entry) => entry.status === status);
  }
}
