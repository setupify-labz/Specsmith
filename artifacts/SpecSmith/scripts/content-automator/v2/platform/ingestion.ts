// MASTER #4 — Platform ingestion and freshness (sections 8, 10, 31).
//
// Where external platform observations become typed facts, or are refused.
//
// The rule that does the real work is `evaluateFreshness`: a volatile fact past
// its window becomes `stale` and stops being usable, rather than quietly
// continuing to look like current guidance. Systems rot by keeping old
// recommendations that were once true; this makes that rot visible.

import {
  CATEGORY_FRESHNESS_DAYS,
  categoryIsVolatile,
  isPlatformId,
  statusIsUsable,
  type PlatformFact,
  type PlatformFactCategory,
  type PlatformId,
  type PlatformKnowledgeStatus,
  type PlatformSnapshot,
  type PostingTimeState,
  type SourceQuality,
  type TrendState,
} from "./model.ts";

export class PlatformIngestionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlatformIngestionError";
    this.code = code;
  }
}

export interface PlatformEnvironment {
  readonly allowSynthetic: boolean;
}

const CATEGORIES: readonly PlatformFactCategory[] = [
  "media-constraint", "text-capability", "interaction-capability", "accessibility-capability",
  "publishing-capability", "analytics-capability", "distribution-guidance", "posting-time", "trend",
];

const STATUSES: readonly PlatformKnowledgeStatus[] = [
  "stable-constraint", "observed-capability", "current-guidance", "hypothesis", "unknown", "stale", "deprecated",
];

const QUALITIES: readonly SourceQuality[] = [
  "platform-official", "direct-observation", "first-party-analytics", "reputable-third-party", "anecdote",
];

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformIngestionError("malformed", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlatformIngestionError("malformed", `${path} must be a non-empty string.`);
  }
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (Number.isNaN(Date.parse(text))) {
    throw new PlatformIngestionError("malformed", `${path} must be a parseable timestamp; got "${text}".`);
  }
  return text;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const text = requireString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new PlatformIngestionError(
      "unknown-enum",
      `${path} is "${text}", which is not recognised. An unrecognised value is refused rather than defaulted.`,
    );
  }
  return text as T;
}

/**
 * Parse one externally supplied platform fact.
 *
 * Two rules here are load-bearing beyond schema validation:
 *
 *  1. The expiry is COMPUTED from the category, never taken from the document.
 *     Otherwise a source could mark its own posting-time folklore as
 *     non-expiring and it would outlive every freshness check.
 *
 *  2. A volatile category may not claim a binding status. "Post at 7pm" cannot
 *     be submitted as a `stable-constraint` no matter who says it.
 */
export function parsePlatformFact(raw: unknown, path: string): PlatformFact {
  const record = requireObject(raw, path);

  const platformText = requireString(record.platform, `${path}.platform`);
  if (!isPlatformId(platformText)) {
    throw new PlatformIngestionError("unknown-platform", `${path}.platform is "${platformText}", which is not a known platform.`);
  }

  const category = requireEnum(record.category, CATEGORIES, `${path}.category`);
  const status = requireEnum(record.status, STATUSES, `${path}.status`);
  const sourceQuality = requireEnum(record.sourceQuality, QUALITIES, `${path}.sourceQuality`);
  const capturedAt = requireTimestamp(record.capturedAt, `${path}.capturedAt`);

  if (categoryIsVolatile(category) && (status === "stable-constraint" || status === "observed-capability")) {
    throw new PlatformIngestionError(
      "volatile-claimed-stable",
      `${path} submits a "${category}" fact with status "${status}". Distribution guidance, posting times and trends are volatile ` +
        "by nature and can never be stable constraints, however confident the source is.",
    );
  }

  if (sourceQuality === "anecdote" && (status === "stable-constraint" || status === "observed-capability")) {
    throw new PlatformIngestionError(
      "anecdote-claimed-binding",
      `${path} submits an anecdote as "${status}". An anecdote may be recorded as a hypothesis, never as a binding constraint.`,
    );
  }

  const effectiveAt = record.effectiveAt === null || record.effectiveAt === undefined
    ? null
    : requireTimestamp(record.effectiveAt, `${path}.effectiveAt`);

  const windowDays = CATEGORY_FRESHNESS_DAYS[category];
  const expiresAt = windowDays === null ? null : new Date(Date.parse(capturedAt) + windowDays * 86_400_000).toISOString();

  return {
    factId: requireString(record.factId, `${path}.factId`),
    platform: platformText,
    claim: requireString(record.claim, `${path}.claim`),
    category,
    status,
    source: requireString(record.source, `${path}.source`),
    sourceQuality,
    capturedAt,
    effectiveAt,
    expiresAt,
    confidence: requireEnum(record.confidence, ["high", "moderate", "low"] as const, `${path}.confidence`),
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

export interface PlatformGuidanceDocument {
  readonly version: "platform-guidance-result-v1";
  readonly documentId: string;
  readonly platform: PlatformId;
  readonly capturedAt: string;
  readonly facts: readonly PlatformFact[];
  readonly provenance: { readonly synthetic: boolean; readonly producedBy: string; readonly producedAt: string };
}

/**
 * Parse a PLATFORM_GUIDANCE_RESULT document.
 *
 * Idempotent: parsing the same document twice yields the same result, and
 * duplicate fact IDs are refused so that merging two ingestions cannot silently
 * drop one of two conflicting claims.
 */
export function parsePlatformGuidance(raw: unknown, environment: PlatformEnvironment): PlatformGuidanceDocument {
  const root = requireObject(raw, "document");

  if (root.version !== "platform-guidance-result-v1") {
    throw new PlatformIngestionError(
      "unknown-version",
      `document.version must be "platform-guidance-result-v1"; got ${JSON.stringify(root.version)}.`,
    );
  }

  const provenanceRaw = requireObject(root.provenance, "document.provenance");
  if (typeof provenanceRaw.synthetic !== "boolean") {
    throw new PlatformIngestionError(
      "missing-provenance",
      "document.provenance.synthetic must be an explicit boolean; a document that does not say whether it is fixture data cannot be trusted either way.",
    );
  }
  if (provenanceRaw.synthetic && !environment.allowSynthetic) {
    throw new PlatformIngestionError(
      "synthetic-in-production",
      "This platform guidance document is marked synthetic. Synthetic platform facts are engineering fixture data and may never become production platform intelligence.",
    );
  }

  const platformText = requireString(root.platform, "document.platform");
  if (!isPlatformId(platformText)) {
    throw new PlatformIngestionError("unknown-platform", `document.platform is "${platformText}", which is not a known platform.`);
  }

  if (!Array.isArray(root.facts)) {
    throw new PlatformIngestionError("malformed", "document.facts must be an array.");
  }

  const seen = new Set<string>();
  const facts = root.facts.map((entry, index) => {
    const parsed = parsePlatformFact(entry, `document.facts[${index}]`);
    if (seen.has(parsed.factId)) {
      throw new PlatformIngestionError(
        "duplicate-fact",
        `document.facts[${index}].factId "${parsed.factId}" appears twice. Two facts sharing an identifier cannot both be reconstructed.`,
      );
    }
    seen.add(parsed.factId);

    // A document may not smuggle in a fact about a different platform: that is
    // exactly how one platform's constraints leak into another's brief.
    if (parsed.platform !== platformText) {
      throw new PlatformIngestionError(
        "platform-mismatch",
        `document.facts[${index}] is about ${parsed.platform} but the document declares ${platformText}. ` +
          "A fact about one platform may never be filed under another.",
      );
    }
    return parsed;
  });

  return {
    version: "platform-guidance-result-v1",
    documentId: requireString(root.documentId, "document.documentId"),
    platform: platformText,
    capturedAt: requireTimestamp(root.capturedAt, "document.capturedAt"),
    facts: [...facts].sort((a, b) => a.factId.localeCompare(b.factId)),
    provenance: {
      synthetic: provenanceRaw.synthetic,
      producedBy: requireString(provenanceRaw.producedBy, "document.provenance.producedBy"),
      producedAt: requireTimestamp(provenanceRaw.producedAt, "document.provenance.producedAt"),
    },
  };
}

/**
 * Re-evaluate a fact against the current time.
 *
 * This is the fail-closed step. A fact that has passed its expiry becomes
 * `stale` regardless of what status it was stored with, so guidance captured
 * six months ago cannot present itself as current.
 */
export function evaluateFreshness(fact: PlatformFact, now: Date): PlatformFact {
  if (fact.expiresAt === null) return fact;
  if (now.getTime() <= Date.parse(fact.expiresAt)) return fact;
  if (fact.status === "stale" || fact.status === "deprecated") return fact;

  return {
    ...fact,
    status: "stale",
    notes:
      `${fact.notes} Expired at ${fact.expiresAt} and re-evaluated as stale at ${now.toISOString()}: ` +
      "volatile platform guidance fails closed rather than continuing to look current.",
  };
}

/** Apply freshness across a whole snapshot, producing a new immutable revision. */
export function refreshSnapshot(snapshot: PlatformSnapshot, now: Date): PlatformSnapshot {
  const facts = snapshot.facts.map((fact) => evaluateFreshness(fact, now));
  const changed = facts.some((fact, index) => fact.status !== snapshot.facts[index].status);
  if (!changed) return snapshot;

  // A new revision rather than a mutation: the old snapshot is what past briefs
  // referenced, and rewriting it would make their decisions unexplainable.
  return {
    ...snapshot,
    snapshotId: `${snapshot.snapshotId}-r${snapshot.revision + 1}`,
    revision: snapshot.revision + 1,
    facts,
  };
}

/** Facts that may actually be relied on right now. */
export function usableFacts(snapshot: PlatformSnapshot, now: Date): readonly PlatformFact[] {
  return snapshot.facts.map((fact) => evaluateFreshness(fact, now)).filter((fact) => statusIsUsable(fact.status));
}

/** Facts that exist but must not be relied on, with the reason. */
export function unusableFacts(snapshot: PlatformSnapshot, now: Date): readonly PlatformFact[] {
  return snapshot.facts.map((fact) => evaluateFreshness(fact, now)).filter((fact) => !statusIsUsable(fact.status));
}

// ---------------------------------------------------------------------------
// Volatile ingestion (sections 23, 24)
// ---------------------------------------------------------------------------

/**
 * Turn a real observed posting-time fact into a usable state.
 *
 * Requires first-party analytics about our own account: a third party's
 * industry-wide "best time" says nothing about when OUR audience watches, and
 * accepting one would be exactly the invented optimum section 23 forbids.
 */
export function ingestPostingTime(fact: PlatformFact, accountScope: string, now: Date): PostingTimeState {
  if (fact.category !== "posting-time") {
    return { state: "unknown", reason: `Fact ${fact.factId} is not a posting-time fact.` };
  }
  if (fact.sourceQuality !== "first-party-analytics") {
    return {
      state: "unknown",
      reason:
        `Fact ${fact.factId} claims a posting time from "${fact.sourceQuality}". Only first-party analytics about this ` +
        "account can establish when this audience actually watches; an industry average is not a measurement of us.",
    };
  }

  const evaluated = evaluateFreshness(fact, now);
  if (evaluated.status === "stale") {
    return { state: "stale", factId: fact.factId, reason: `Observed posting time expired at ${fact.expiresAt} and is no longer current.` };
  }

  const windows = fact.claim.split(";").map((part) => part.trim()).filter((part) => part !== "");
  if (windows.length === 0) {
    return { state: "unknown", reason: `Fact ${fact.factId} carries no parseable time window.` };
  }

  return { state: "observed", windows, factId: fact.factId, accountScope, observedAt: fact.capturedAt };
}

/** Turn a real observed trend into a usable state, or refuse it. */
export function ingestTrend(fact: PlatformFact, scope: string, now: Date): TrendState {
  if (fact.category !== "trend") {
    return { state: "unknown", reason: `Fact ${fact.factId} is not a trend fact.` };
  }
  if (fact.sourceQuality === "anecdote") {
    return {
      state: "unknown",
      reason: `Fact ${fact.factId} reports a trend from an anecdote. A trend needs an actual observation with a scope, not a claim that something feels popular.`,
    };
  }
  if (fact.expiresAt === null) {
    return { state: "unknown", reason: `Fact ${fact.factId} has no expiry, and a trend without an expiry is not a trend.` };
  }

  const evaluated = evaluateFreshness(fact, now);
  if (evaluated.status === "stale") {
    return { state: "expired", factId: fact.factId, reason: `Trend expired at ${fact.expiresAt}; a trend past its window is not current.` };
  }

  return { state: "observed", descriptor: fact.claim, factId: fact.factId, scope, observedAt: fact.capturedAt, expiresAt: fact.expiresAt };
}

// ---------------------------------------------------------------------------
// Analytics (section 9, 27)
// ---------------------------------------------------------------------------

export type MetricAvailability =
  | { readonly state: "available"; readonly value: number; readonly factId: string }
  | { readonly state: "unavailable"; readonly reason: string }
  | { readonly state: "unknown"; readonly reason: string };

/**
 * Read one metric.
 *
 * The one rule: a metric nobody reported is `unknown`, never 0. Zero means "we
 * measured and it was zero", which is a completely different statement and one
 * that would make an unpublished creative look like a failed one.
 */
export function readMetric(
  metrics: Record<string, unknown> | null,
  name: string,
  factId: string,
): MetricAvailability {
  if (metrics === null) {
    return {
      state: "unknown",
      reason: "No analytics document exists. Nothing was measured, which is not the same as having measured zero.",
    };
  }
  if (!(name in metrics)) {
    return {
      state: "unknown",
      reason: `The analytics document does not report "${name}". An unreported metric is unknown; converting it to 0 would fabricate a measurement.`,
    };
  }
  const value = metrics[name];
  if (value === null || value === undefined) {
    return {
      state: "unknown",
      reason: `"${name}" is present but null, which the provider uses for "not measured". It stays unknown rather than becoming 0.`,
    };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { state: "unavailable", reason: `"${name}" is not a finite number (${JSON.stringify(value)}), so it cannot be read as a measurement.` };
  }
  return { state: "available", value, factId };
}
