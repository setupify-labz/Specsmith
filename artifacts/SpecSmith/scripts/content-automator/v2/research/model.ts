// The research object model.
//
// WHY THESE ARE SEPARATE TYPES AND NOT ONE "RESEARCH RESULT" BLOB
// ---------------------------------------------------------------
// The canonical chain is:
//
//   SOURCE -> OBSERVATION -> CLAIM -> HYPOTHESIS -> CREATIVE DECISION
//          -> EXPERIMENT -> RESULT -> UPDATED BELIEF
//
// Every one of those is a different epistemic category, and collapsing any two
// of them is how a research system becomes confidently wrong. A retailer page
// showing $549.99 is an OBSERVATION. "This listing was $549.99 at 14:02" is a
// CLAIM the observation supports. "The RTX 5070 costs $549.99" is a claim it
// does NOT support. "Price-led hooks retain better" is a HYPOTHESIS. None of
// them is the same thing, so none of them shares a type here.
//
// WHAT THIS FILE DELIBERATELY DOES NOT REDEFINE
// ----------------------------------------------
// SpecSmith already has canonical evidence structures, and re-expressing them
// here would create a second source of truth that drifts:
//
//   src/lib/benchmarks/types.ts   EvidenceQuality A/B/C/D, VerificationMethod
//                                 (search-summary vs direct-fetch),
//                                 BenchmarkSource, REQUIRED_PROVENANCE_FIELDS
//   src/lib/measured/types.ts     ObservationTier, the four evidence tiers that
//                                 never merge, the pinned 1%-low method
//   src/lib/measured/hardwareMatch.ts  form-factor classification and the
//                                 refusal to resolve an ambiguous part
//   src/lib/retail/offerSnapshot.ts    price freshness, oldest-stamp-decides
//
// This model references those semantics rather than restating them. Where a
// concept here overlaps one of theirs, the comment says which one it mirrors
// and why a separate spelling is needed at all.

/** How certain SpecSmith is, in words a person can check against evidence. */
export type EpistemicState =
  /** Directly observed by SpecSmith, or deterministically computed. */
  | "known"
  | "strongly-supported"
  | "likely"
  | "plausible"
  /** Sources genuinely disagree and nothing resolves it. Not an average. */
  | "disputed"
  /** Evidence exists and was once good, but not for the use at hand now. */
  | "stale"
  | "weakly-supported"
  /** Nobody looked, or looking found nothing. NEVER the same as false. */
  | "unknown"
  | "insufficient-evidence"
  | "requires-experiment"
  | "requires-human-judgment";

export const EPISTEMIC_STATES: readonly EpistemicState[] = [
  "known", "strongly-supported", "likely", "plausible", "disputed", "stale",
  "weakly-supported", "unknown", "insufficient-evidence", "requires-experiment",
  "requires-human-judgment",
];

/**
 * States that may never carry a factual assertion into a script.
 *
 * `stale` is in this list deliberately. Stale evidence is not absent evidence —
 * it is evidence that was true and may not be now — and presenting it as
 * current is the specific failure mode SpecSmith's price rules already forbid.
 */
export const UNSAFE_FOR_CREATIVE: readonly EpistemicState[] = [
  "disputed", "stale", "weakly-supported", "unknown", "insufficient-evidence",
  "requires-experiment", "requires-human-judgment", "plausible",
];

/**
 * How much scrutiny a claim has to survive before it may be said out loud.
 *
 * Risk is a property of the CLAIM, not of how confident the model feels. "This
 * card has 12GB of VRAM" and "this card is the best value in 2026" need
 * different evidence even if a generator is equally sure of both.
 */
export type ClaimRisk = "low" | "medium" | "high";

export const CLAIM_RISK_ORDER: Record<ClaimRisk, number> = { low: 0, medium: 1, high: 2 };

/**
 * What kind of thing a claim asserts.
 *
 * This drives freshness, applicability and evidence requirements, all of which
 * genuinely differ by kind: a socket type does not go stale, a price does so
 * within hours, and a benchmark is invalidated by a patch rather than by time.
 */
export type ClaimKind =
  | "specification"
  | "current-price"
  | "availability"
  | "performance-measured"
  | "performance-estimated"
  | "compatibility"
  | "comparison"
  | "recommendation"
  | "audience-behaviour"
  | "platform-guidance"
  | "specsmith-product"
  | "misconception-exists";

export const CLAIM_KINDS: readonly ClaimKind[] = [
  "specification", "current-price", "availability", "performance-measured",
  "performance-estimated", "compatibility", "comparison", "recommendation",
  "audience-behaviour", "platform-guidance", "specsmith-product",
  "misconception-exists",
];

/**
 * The floor risk each claim kind carries.
 *
 * A generator cannot talk its way below these: calling a price claim "low risk"
 * does not make a stale price safe to broadcast.
 */
export const MINIMUM_RISK_BY_KIND: Record<ClaimKind, ClaimRisk> = {
  specification: "low",
  "specsmith-product": "low",
  compatibility: "medium",
  "performance-estimated": "medium",
  comparison: "medium",
  "platform-guidance": "medium",
  "audience-behaviour": "medium",
  "misconception-exists": "medium",
  // Everything below can mislead someone into spending money.
  "current-price": "high",
  availability: "high",
  "performance-measured": "high",
  recommendation: "high",
};

/**
 * Where a piece of material came from, and how directly.
 *
 * `first-party-specsmith` is separate from everything else because SpecSmith's
 * own deterministic output answers a different question than any external page:
 * "what does SpecSmith itself know" must be answerable without external claims
 * contaminating it.
 */
export type SourceType =
  | "first-party-specsmith"
  | "manufacturer-documentation"
  | "manufacturer-marketing"
  | "retailer-listing"
  | "independent-review"
  | "independent-benchmark"
  | "editorial-article"
  | "community-discussion"
  | "social-post"
  | "platform-official-guidance"
  | "aggregator"
  | "unknown";

export const SOURCE_TYPES: readonly SourceType[] = [
  "first-party-specsmith", "manufacturer-documentation", "manufacturer-marketing",
  "retailer-listing", "independent-review", "independent-benchmark",
  "editorial-article", "community-discussion", "social-post",
  "platform-official-guidance", "aggregator", "unknown",
];

/** Did the evidence originate here, or is this a retelling? */
export type Directness = "primary" | "secondary" | "tertiary" | "unknown";

/**
 * How the material reached SpecSmith.
 *
 * Mirrors VerificationMethod in src/lib/benchmarks/types.ts, extended with the
 * two routes that type never had to describe: material a person transcribed,
 * and SpecSmith's own runtime. The distinction it exists to protect is the same
 * one — a reputable publication nobody actually read is not the same confidence
 * as one that was read.
 */
export type RetrievalMethod =
  | "direct-fetch"
  | "search-summary"
  | "connector-relay"
  | "human-transcription"
  | "specsmith-runtime";

/** Retrieval routes where nobody saw the underlying material itself. */
export const INDIRECT_RETRIEVAL: readonly RetrievalMethod[] = ["search-summary"];

/**
 * What form a piece of material is in.
 *
 * This is what stops a paraphrase acquiring quotation marks. A `paraphrase` or
 * `model-summary` can never be rendered as a quote, and the type is what makes
 * that checkable rather than a convention someone remembers.
 */
export type MaterialForm =
  | "exact-quote"
  | "structured-value"
  | "paraphrase"
  | "model-summary"
  | "inference";

export const QUOTABLE_FORMS: readonly MaterialForm[] = ["exact-quote", "structured-value"];

/** Whether evidence about one configuration says anything about another. */
export type Applicability = "exact" | "close" | "partial" | "weak" | "unknown" | "not-applicable";

export const APPLICABILITY_ORDER: Record<Applicability, number> = {
  exact: 5, close: 4, partial: 3, weak: 2, unknown: 1, "not-applicable": 0,
};

/** Whether evidence is still good enough for the use at hand. */
export type Freshness = "current" | "aging" | "stale" | "expired" | "timeless" | "unknown";

/** An interpretable grade. Deliberately not a float: see assessSource. */
export type Grade = "high" | "medium" | "low" | "unknown";

/**
 * Where a research object came from, carried on everything durable.
 *
 * `synthetic` is the load-bearing field. Engineering fixtures must never be
 * mistaken for production research, and a boolean that has to be checked is
 * better than a naming convention that has to be remembered.
 */
export interface ResearchProvenance {
  /** True for engineering fixtures. Production ingestion refuses these. */
  readonly synthetic: boolean;
  /** What produced this record, e.g. "specsmith-runtime", "connector-relay". */
  readonly producedBy: string;
  readonly producedAt: string;
}

export interface SourceIdentity {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  /** Canonical publisher/domain. Two URLs from one publisher are one origin. */
  readonly publisher: string;
  readonly url?: string;
  readonly title?: string;
}

/**
 * One retrieval of one source, frozen.
 *
 * Snapshots are append-only. If the page changes, that is a NEW snapshot with a
 * new hash, not an edit — otherwise a later reader cannot tell whether the
 * evidence they are auditing is the evidence a decision was made on.
 */
export interface SourceSnapshot {
  readonly snapshotId: string;
  readonly source: SourceIdentity;
  readonly retrievedAt: string;
  readonly retrievalMethod: RetrievalMethod;
  /** Hash of the exact material observed, where the material was captured. */
  readonly contentHash?: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  /** The parser/collector that read it, so a parsing bug is traceable. */
  readonly parserVersion?: string;
  /**
   * When this source is retelling another. Three articles sharing one
   * upstreamSourceId are one piece of evidence, not three.
   */
  readonly upstreamSourceId?: string;
  readonly provenance: ResearchProvenance;
}

/** An interpretable judgment about a source, for a particular question. */
export interface SourceAssessment {
  readonly snapshotId: string;
  readonly authority: Grade;
  readonly directness: Directness;
  readonly methodologicalTransparency: Grade;
  readonly independence: Grade;
  /** Does this source type answer THIS kind of question at all? */
  readonly relevanceToClaimKind: Grade;
  readonly conflictOfInterest: "none-known" | "possible" | "likely";
  /** Did anyone actually look at the underlying material? */
  readonly materialObserved: boolean;
  readonly limitations: readonly string[];
  /** Plain-language reasons, so the grade can be argued with. */
  readonly reasons: readonly string[];
}

/**
 * What the evidence literally contains.
 *
 * An observation makes no assertion about the world beyond itself. That is the
 * whole point of separating it from a claim.
 */
export interface Observation {
  readonly observationId: string;
  readonly snapshotId: string;
  readonly form: MaterialForm;
  /** The material itself: a quote, a structured value, or a summary. */
  readonly content: string;
  /** Structured fields where the source gave them, e.g. { priceUsd: 549.99 }. */
  readonly fields?: Readonly<Record<string, string | number | boolean>>;
  /** The configuration this observation is about, if any. */
  readonly configuration?: ClaimConfiguration;
  readonly observedAt: string;
  readonly provenance: ResearchProvenance;
}

/**
 * The exact conditions a hardware claim depends on.
 *
 * Almost every PC performance number is meaningless without these. Recording
 * them is what makes the difference between "a 4070 gets 90fps" (unsupportable)
 * and a statement someone can check.
 */
export interface ClaimConfiguration {
  readonly gpu?: string;
  readonly cpu?: string;
  readonly gameId?: string;
  readonly gameVersion?: string;
  readonly driverVersion?: string;
  readonly resolution?: string;
  readonly preset?: string;
  readonly rayTracing?: boolean;
  readonly upscaler?: string;
  readonly frameGeneration?: boolean;
  readonly formFactor?: "desktop" | "laptop" | "integrated";
  /** Exact SKU when the claim needs one, e.g. an MSI-specific listing. */
  readonly sku?: string;
}

/**
 * One indivisible assertion.
 *
 * "GPU A is 20% faster, cheaper and more efficient" is three claims with three
 * different evidence bases and three different confidences. Kept as one unit it
 * would inherit the confidence of whichever part was best evidenced, which is
 * exactly backwards.
 */
export interface AtomicClaim {
  readonly claimId: string;
  readonly questionId: string;
  /** The assertion, stated so it could in principle be falsified. */
  readonly proposition: string;
  readonly kind: ClaimKind;
  readonly risk: ClaimRisk;
  readonly configuration?: ClaimConfiguration;
  /** What the claim is about, for applicability checks. */
  readonly subjectIds: readonly string[];
  readonly provenance: ResearchProvenance;
}

/** What one observation does for one claim, and how strongly. */
export interface ClaimEvidenceLink {
  readonly claimId: string;
  readonly observationId: string;
  readonly stance: "supports" | "contradicts" | "qualifies" | "irrelevant";
  readonly applicability: Applicability;
  readonly applicabilityReasons: readonly string[];
  readonly freshness: Freshness;
  readonly freshnessReason: string;
  /**
   * True when the claim says more than the observation shows — a generalization
   * beyond what was observed. Recorded rather than silently permitted.
   */
  readonly generalisesBeyondObservation: boolean;
}

/** Sources that agree, and whether their agreement means anything. */
export interface Corroboration {
  readonly claimId: string;
  readonly snapshotIds: readonly string[];
  /** Distinct ORIGINS, after collapsing shared upstream sources. */
  readonly independentOriginCount: number;
  readonly dependentGroups: readonly (readonly string[])[];
  readonly reason: string;
}

/** A real disagreement, preserved rather than averaged away. */
export interface Conflict {
  readonly claimId: string;
  readonly snapshotIds: readonly string[];
  readonly whatConflicts: string;
  /** A difference that would explain the disagreement without either being wrong. */
  readonly explanation?: "different-configuration" | "different-date" | "different-methodology" | "different-scope";
  readonly resolved: boolean;
  readonly resolutionReason?: string;
}

/** Something SpecSmith does not know and would benefit from knowing. */
export interface KnowledgeGap {
  readonly gapId: string;
  readonly questionId: string;
  readonly code: string;
  readonly description: string;
  /** How much closing this gap could change the creative decision. */
  readonly decisionImpact: "blocking" | "high" | "medium" | "low";
}

/** An explicit question, with the conditions under which researching it stops. */
export interface ResearchQuestion {
  readonly questionId: string;
  readonly question: string;
  readonly purpose: string;
  /** The creative decision this informs. Research with no decision is a hobby. */
  readonly informsDecision: string;
  readonly claimKind: ClaimKind;
  readonly risk: ClaimRisk;
  readonly acceptableUncertainty: EpistemicState;
  readonly subjectIds: readonly string[];
  readonly configuration?: ClaimConfiguration;
  /** Sub-questions this decomposes into. Compound questions are not researchable. */
  readonly subQuestionIds?: readonly string[];
}

/** Why a research pass stopped. Not every pass ends in an answer. */
export type StoppingReason =
  | "sufficient-evidence"
  | "insufficient-evidence"
  | "conflicting-evidence"
  | "stale-evidence-only"
  | "quota-exhausted"
  | "inaccessible-source"
  | "human-review-required"
  | "diminishing-returns"
  | "question-invalid"
  | "evidence-not-applicable";

export const STOPPING_REASONS: readonly StoppingReason[] = [
  "sufficient-evidence", "insufficient-evidence", "conflicting-evidence",
  "stale-evidence-only", "quota-exhausted", "inaccessible-source",
  "human-review-required", "diminishing-returns", "question-invalid",
  "evidence-not-applicable",
];

/** Stopping reasons that are a correct outcome, not a failure to try. */
export const SUCCESSFUL_STOPS: readonly StoppingReason[] = [
  "sufficient-evidence", "insufficient-evidence", "conflicting-evidence",
  "stale-evidence-only", "evidence-not-applicable", "diminishing-returns",
];

/**
 * Confidence, with the reasons attached.
 *
 * A bare number cannot be argued with. This carries what drove it and what
 * would change it, so "why do we believe this" has an answer derived from
 * stored evidence rather than written afterwards.
 */
export interface ConfidenceAssessment {
  readonly state: EpistemicState;
  readonly drivers: readonly string[];
  readonly detractors: readonly string[];
  /** Concrete evidence that would move this. The falsification handle. */
  readonly wouldChangeIfs: readonly string[];
}

/** Research resource use. Tracked even at $0, because $0 is not free of limits. */
export interface ResearchBudget {
  readonly sourcesConsulted: number;
  readonly snapshotsIngested: number;
  readonly cachedReuseCount: number;
  readonly duplicateEvidenceCount: number;
  /** Named providers whose free quota was exhausted during this pass. */
  readonly quotaExhausted: readonly string[];
}
