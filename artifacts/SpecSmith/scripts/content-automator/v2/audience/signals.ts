// MASTER #4 — Audience signal ingestion (sections 2, 31).
//
// The boundary where outside claims about people become typed observations, or
// are refused. Everything here fails closed: a malformed signal is rejected
// rather than repaired, a missing sample size stays missing rather than
// becoming zero, and a bundle that does not say whether it is synthetic is not
// trusted in either direction.
//
// No collector for any of these families exists in this repository today. That
// is why almost every production read returns `unknown` — which is the correct
// answer, not a gap to paper over.

import type { AudienceKnowledgeState } from "./model.ts";

/** Where an audience observation could come from. */
export type AudienceSourceFamily =
  | "specsmith-search-query"
  | "specsmith-internal-search"
  | "specsmith-page-visit"
  | "specsmith-tool-usage"
  | "specsmith-builder-behaviour"
  | "specsmith-returning-user"
  | "published-creative-analytics"
  | "community-discussion"
  | "comment-thread"
  | "question-dataset"
  | "user-feedback"
  | "support-message"
  | "search-console-query"
  | "verified-external-research";

export const AUDIENCE_SOURCE_FAMILIES: readonly AudienceSourceFamily[] = [
  "specsmith-search-query", "specsmith-internal-search", "specsmith-page-visit",
  "specsmith-tool-usage", "specsmith-builder-behaviour", "specsmith-returning-user",
  "published-creative-analytics", "community-discussion", "comment-thread",
  "question-dataset", "user-feedback", "support-message", "search-console-query",
  "verified-external-research",
];

/**
 * Source families that can establish a demographic fact.
 *
 * Deliberately empty. No source family in this repository establishes age,
 * gender, income, location or occupation, so the ingestion path has no way to
 * populate a demographic dimension at all. This is a structural guarantee, not
 * a policy someone can forget.
 */
export const DEMOGRAPHIC_CAPABLE_FAMILIES: readonly AudienceSourceFamily[] = [];

/** How long an observation from each family stays usable. */
const FRESHNESS_DAYS: Record<AudienceSourceFamily, number | null> = {
  // Query language shifts with product naming cycles, but not weekly.
  "specsmith-search-query": 180,
  "specsmith-internal-search": 180,
  "specsmith-page-visit": 90,
  "specsmith-tool-usage": 90,
  "specsmith-builder-behaviour": 90,
  "specsmith-returning-user": 90,
  // Performance data ages with the creative and the platform alike.
  "published-creative-analytics": 60,
  "community-discussion": 120,
  "comment-thread": 120,
  // A curated question set is about the domain, not about a moment.
  "question-dataset": null,
  "user-feedback": 180,
  "support-message": 180,
  "search-console-query": 90,
  "verified-external-research": 365,
};

export interface AudienceSignal {
  readonly signalId: string;
  readonly sourceFamily: AudienceSourceFamily;
  /** Where exactly: a URL, a dataset name, a console property. */
  readonly sourceReference: string;
  readonly capturedAt: string;
  /** When the behaviour happened, if that differs from when it was captured. */
  readonly observedAt: string | null;
  /** What population this covers. Never assume it generalises past this. */
  readonly scope: string;
  /**
   * How many observations. `null` means genuinely unknown.
   * It is NEVER 0 — zero would assert that we looked and found none.
   */
  readonly sampleSize: number | null;
  readonly limitations: readonly string[];
  readonly evidenceState: AudienceKnowledgeState;
  /** Which audience dimensions this signal can speak to. */
  readonly dimensions: readonly string[];
  /** The observation itself, as text. */
  readonly observation: string;
}

export interface AudienceSignalBundle {
  readonly version: "audience-signal-result-v1";
  readonly bundleId: string;
  readonly capturedAt: string;
  readonly signals: readonly AudienceSignal[];
  readonly provenance: AudienceSignalProvenance;
  /** Families that have no collector at all. Their absence is recorded. */
  readonly unavailableFamilies: readonly AudienceSourceFamily[];
}

export interface AudienceSignalProvenance {
  readonly synthetic: boolean;
  readonly producedBy: string;
  readonly producedAt: string;
}

export class AudienceIngestionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AudienceIngestionError";
    this.code = code;
  }
}

export interface AudienceEnvironment {
  /** False on every production path. Fixtures are engineering-only. */
  readonly allowSynthetic: boolean;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AudienceIngestionError("malformed", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AudienceIngestionError("malformed", `${path} must be a non-empty string.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new AudienceIngestionError("malformed", `${path} must be an array.`);
  }
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (Number.isNaN(Date.parse(text))) {
    throw new AudienceIngestionError("malformed", `${path} must be a parseable timestamp; got "${text}".`);
  }
  return text;
}

/**
 * Sample size, or genuinely unknown.
 *
 * The one rule that matters: `undefined`/`null` stays null. A collector that
 * did not report how many people it saw has not told us it saw none.
 */
function parseSampleSize(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AudienceIngestionError("malformed", `${path} must be a non-negative integer or null; got ${JSON.stringify(value)}.`);
  }
  if (value === 0) {
    throw new AudienceIngestionError(
      "zero-sample",
      `${path} is 0, which asserts that a collector looked and found nothing. If the count is simply not reported, it must be null — unknown is not zero.`,
    );
  }
  return value;
}

function parseKnowledgeState(value: unknown, path: string): AudienceKnowledgeState {
  const text = requireString(value, path);
  const allowed: readonly string[] = [
    "known", "observed", "supported-inference", "hypothesis",
    "unknown", "conflicting", "stale", "insufficient-data",
  ];
  if (!allowed.includes(text)) {
    throw new AudienceIngestionError(
      "unknown-state",
      `${path} is "${text}", which is not a recognised audience knowledge state. An unrecognised state is refused rather than defaulted.`,
    );
  }
  return text as AudienceKnowledgeState;
}

function parseSourceFamily(value: unknown, path: string): AudienceSourceFamily {
  const text = requireString(value, path);
  if (!AUDIENCE_SOURCE_FAMILIES.includes(text as AudienceSourceFamily)) {
    throw new AudienceIngestionError(
      "unknown-source-family",
      `${path} is "${text}", which is not a recognised audience source family.`,
    );
  }
  return text as AudienceSourceFamily;
}

/**
 * Parse an AUDIENCE_SIGNAL_RESULT document.
 *
 * Idempotent and order-independent: the same document parses to the same
 * bundle, and duplicate signal IDs are refused rather than silently merged
 * (two different observations sharing an ID would make the audit trail a lie).
 */
export function parseAudienceSignalBundle(raw: unknown, environment: AudienceEnvironment): AudienceSignalBundle {
  const root = requireObject(raw, "bundle");

  if (root.version !== "audience-signal-result-v1") {
    throw new AudienceIngestionError(
      "unknown-version",
      `bundle.version must be "audience-signal-result-v1"; got ${JSON.stringify(root.version)}.`,
    );
  }

  const provenanceRaw = requireObject(root.provenance, "bundle.provenance");
  if (typeof provenanceRaw.synthetic !== "boolean") {
    throw new AudienceIngestionError(
      "missing-provenance",
      "bundle.provenance.synthetic must be an explicit boolean; a bundle that does not say whether it is fixture data cannot be trusted either way.",
    );
  }
  const provenance: AudienceSignalProvenance = {
    synthetic: provenanceRaw.synthetic,
    producedBy: requireString(provenanceRaw.producedBy, "bundle.provenance.producedBy"),
    producedAt: requireTimestamp(provenanceRaw.producedAt, "bundle.provenance.producedAt"),
  };

  if (provenance.synthetic && !environment.allowSynthetic) {
    throw new AudienceIngestionError(
      "synthetic-in-production",
      "This audience signal bundle is marked synthetic. Synthetic audience signals are engineering fixture data and may never become observed audience evidence in production.",
    );
  }

  const capturedAt = requireTimestamp(root.capturedAt, "bundle.capturedAt");
  const bundleId = requireString(root.bundleId, "bundle.bundleId");

  const seen = new Set<string>();
  const signals = requireArray(root.signals, "bundle.signals").map((entry, index) => {
    const path = `bundle.signals[${index}]`;
    const record = requireObject(entry, path);

    const signalId = requireString(record.signalId, `${path}.signalId`);
    if (seen.has(signalId)) {
      throw new AudienceIngestionError(
        "duplicate-signal",
        `${path}.signalId "${signalId}" appears twice. Two observations sharing an identifier cannot both be reconstructed, so the bundle is refused rather than deduplicated by guess.`,
      );
    }
    seen.add(signalId);

    const sourceFamily = parseSourceFamily(record.sourceFamily, `${path}.sourceFamily`);
    const signalCapturedAt = requireTimestamp(record.capturedAt, `${path}.capturedAt`);
    const observedAt = record.observedAt === null || record.observedAt === undefined
      ? null
      : requireTimestamp(record.observedAt, `${path}.observedAt`);

    if (observedAt !== null && Date.parse(observedAt) > Date.parse(signalCapturedAt)) {
      throw new AudienceIngestionError(
        "impossible-timing",
        `${path} was observed after it was captured, which cannot have happened.`,
      );
    }

    const evidenceState = parseKnowledgeState(record.evidenceState, `${path}.evidenceState`);

    // A demographic dimension can only be established by a family capable of it,
    // and no family is. This closes the persona door at ingestion rather than
    // downstream, where a later caller could forget the rule.
    const dimensions = requireArray(record.dimensions, `${path}.dimensions`).map((value, dimIndex) =>
      requireString(value, `${path}.dimensions[${dimIndex}]`),
    );
    const demographic = dimensions.filter((dimension) => dimension.startsWith("demographics."));
    if (demographic.length > 0 && !DEMOGRAPHIC_CAPABLE_FAMILIES.includes(sourceFamily)) {
      throw new AudienceIngestionError(
        "demographic-not-establishable",
        `${path} claims to establish ${demographic.join(", ")}, but source family "${sourceFamily}" cannot establish a demographic fact. ` +
          "No configured source can. Demographics remain unknown rather than being inferred from behaviour.",
      );
    }

    return {
      signalId,
      sourceFamily,
      sourceReference: requireString(record.sourceReference, `${path}.sourceReference`),
      capturedAt: signalCapturedAt,
      observedAt,
      scope: requireString(record.scope, `${path}.scope`),
      sampleSize: parseSampleSize(record.sampleSize, `${path}.sampleSize`),
      limitations: requireArray(record.limitations ?? [], `${path}.limitations`).map((value, limitIndex) =>
        requireString(value, `${path}.limitations[${limitIndex}]`),
      ),
      evidenceState,
      dimensions,
      observation: requireString(record.observation, `${path}.observation`),
    } satisfies AudienceSignal;
  });

  const unavailableFamilies = requireArray(root.unavailableFamilies ?? [], "bundle.unavailableFamilies").map(
    (value, index) => parseSourceFamily(value, `bundle.unavailableFamilies[${index}]`),
  );

  return {
    version: "audience-signal-result-v1",
    bundleId,
    capturedAt,
    signals: [...signals].sort((a, b) => a.signalId.localeCompare(b.signalId)),
    provenance,
    unavailableFamilies,
  };
}

/**
 * The honest production bundle: nothing connected.
 *
 * Every family is listed as unavailable so that downstream `unknown` values can
 * explain themselves — "nobody looked" rather than an unexplained blank.
 */
export function unavailableAudienceSignals(capturedAt: string): AudienceSignalBundle {
  return {
    version: "audience-signal-result-v1",
    bundleId: "audience-none-configured",
    capturedAt,
    signals: [],
    provenance: {
      synthetic: false,
      producedBy: "no-audience-collector-configured",
      producedAt: capturedAt,
    },
    unavailableFamilies: AUDIENCE_SOURCE_FAMILIES,
  };
}

export interface SignalLookup {
  readonly state: AudienceKnowledgeState;
  readonly signals: readonly AudienceSignal[];
  readonly explanation: string;
}

/**
 * Find the signals that speak to a dimension, and say what they establish.
 *
 * Staleness is applied here rather than at ingestion: a signal is not wrong for
 * being old, it is simply no longer usable as current fact, and the bundle
 * keeps it for audit either way.
 */
export function signalsForDimension(
  bundle: AudienceSignalBundle,
  dimension: string,
  now: Date,
): SignalLookup {
  const matching = bundle.signals.filter((signal) => signal.dimensions.includes(dimension));

  if (matching.length === 0) {
    const familyNote = bundle.unavailableFamilies.length > 0
      ? `No collector is configured for ${bundle.unavailableFamilies.length} source families.`
      : "No configured collector reported on this dimension.";
    return {
      state: "unknown",
      signals: [],
      explanation: `Nothing observed for "${dimension}". ${familyNote} This is unobserved, not absent, and must never be read as a default.`,
    };
  }

  const fresh: AudienceSignal[] = [];
  const stale: AudienceSignal[] = [];
  for (const signal of matching) {
    const windowDays = FRESHNESS_DAYS[signal.sourceFamily];
    if (windowDays === null) {
      fresh.push(signal);
      continue;
    }
    const basis = Date.parse(signal.observedAt ?? signal.capturedAt);
    const ageDays = (now.getTime() - basis) / 86_400_000;
    (ageDays > windowDays ? stale : fresh).push(signal);
  }

  if (fresh.length === 0) {
    return {
      state: "stale",
      signals: stale,
      explanation: `Every observation for "${dimension}" is past its usable window. Stale audience evidence is not current fact.`,
    };
  }

  // Genuine disagreement is preserved rather than resolved by majority. Two
  // sources saying different things is information; averaging it destroys that.
  const distinct = new Set(fresh.map((signal) => signal.observation));
  if (distinct.size > 1) {
    return {
      state: "conflicting",
      signals: fresh,
      explanation: `${fresh.length} fresh observations for "${dimension}" disagree: ${[...distinct].join(" | ")}. A conflict is reported, never averaged.`,
    };
  }

  const strongest = fresh.some((signal) => signal.evidenceState === "observed") ? "observed" : fresh[0].evidenceState;
  return {
    state: strongest,
    signals: fresh,
    explanation: `${fresh.length} fresh observation(s) for "${dimension}" from ${[...new Set(fresh.map((s) => s.sourceFamily))].join(", ")}.`,
  };
}
