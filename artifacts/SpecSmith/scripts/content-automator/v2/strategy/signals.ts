// The strategic signal boundary.
//
// WHY THIS FILE IS MOSTLY REFUSALS
// --------------------------------
// A strategy layer wants search demand, trend direction, competitor coverage and
// community pain. SpecSmith has none of them: there is no Search Console
// connection, no social analytics, no community collector, no published history,
// and no autonomous web access. MASTER #2 established that and it has not
// changed.
//
// So this module's job is to make the absence STRUCTURAL rather than a habit.
// Every accessor returns `unknown` plus the reason it is unknown, and there is
// deliberately no code path that turns absence into a number. The alternative —
// defaulting trend to "stable", search demand to "low", competitor coverage to
// "whitespace" — would let the strategy layer assert things nobody observed,
// which is the exact failure the brief forbids.
//
// WHEN A REAL SOURCE ARRIVES
// --------------------------
// It arrives as an ingested SignalBundle through `parseSignalBundle`, which is
// strict for the same reasons MASTER #2's ingestion is strict. Nothing here
// fetches anything, and there is no HTTP client in this module or anywhere else
// in the strategy layer.

import type {
  CommunityPainState,
  CompetitorCoverageState,
  ProductReadiness,
  SearchDemandState,
  SignalOrigin,
  StrategyProvenance,
  TrendState,
} from "./model.ts";

export class SignalIngestionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SignalIngestionError";
    this.code = code;
  }
}

/** Why a signal is unavailable. Named so the report can say which blocker it is. */
export type UnavailableReason =
  | "not-configured"
  | "blocked-external"
  | "no-published-history"
  | "insufficient-sample";

export interface SignalAvailability<T> {
  readonly state: T;
  readonly available: boolean;
  readonly reason: UnavailableReason | "available";
  readonly explanation: string;
}

/**
 * The smallest sample that may be called a signal.
 *
 * One impression is not demand and one forum post is not a trend. A strategy
 * layer without a floor like this will confidently promote noise, and the
 * promotion is invisible because the arithmetic is correct — it is the input
 * that was meaningless.
 */
export const MIN_SEARCH_IMPRESSIONS = 50;
export const MIN_COMMUNITY_OBSERVATIONS = 3;
export const MIN_TREND_POINTS = 3;

export interface SearchSignal {
  readonly query: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly position: number | null;
  readonly observedAt: string;
  /** Impressions in the previous comparable window, when known. */
  readonly previousImpressions: number | null;
}

export interface CommunitySignal {
  readonly question: string;
  /** Distinct observations of this question being asked. */
  readonly observationCount: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
}

export interface TrendSignal {
  readonly subject: string;
  /** At least MIN_TREND_POINTS points, or it cannot describe a direction. */
  readonly series: readonly { readonly at: string; readonly value: number }[];
}

export interface CompetitorSignal {
  readonly question: string;
  /** Observed pieces covering it. Zero observed is NOT zero existing. */
  readonly observedCoveringPieces: number;
  readonly weaknessesObserved: readonly string[];
}

export interface ProductStateSignal {
  readonly surface: string;
  readonly readiness: ProductReadiness;
  /** The route, when shipped. Absent for anything not shipped. */
  readonly route?: string;
  readonly evidence: string;
}

/** Everything a strategy pass may know about the world outside the repository. */
export interface SignalBundle {
  readonly bundleId: string;
  readonly capturedAt: string;
  readonly search: readonly SearchSignal[];
  readonly community: readonly CommunitySignal[];
  readonly trends: readonly TrendSignal[];
  readonly competitors: readonly CompetitorSignal[];
  readonly productState: readonly ProductStateSignal[];
  readonly provenance: StrategyProvenance;
}

/**
 * The bundle used when nothing is connected, which is the current reality.
 *
 * Note it is EMPTY rather than optimistic. Downstream accessors then report
 * `unknown` with a named reason, and the priority model treats that as a gap
 * rather than as a low score.
 */
export function unavailableSignalBundle(capturedAt: string): SignalBundle {
  return {
    bundleId: "signals-unavailable",
    capturedAt,
    search: [],
    community: [],
    trends: [],
    competitors: [],
    productState: [],
    provenance: { synthetic: false, producedBy: "no-signal-source-configured", producedAt: capturedAt },
  };
}

/**
 * A genuinely NON-synthetic bundle carrying only SpecSmith's own product state.
 *
 * This is the one strategic signal SpecSmith really has today: it can see which
 * of its own routes are shipped, because the prerender writes them. Everything
 * else stays empty and therefore `unknown`.
 *
 * It is deliberately not marked synthetic — inventing a synthetic flag for real
 * first-party observation would be as dishonest as the reverse, and would make
 * every strategy pass refuse itself forever.
 */
export function firstPartyProductSignals(
  capturedAt: string,
  surfaces: readonly { readonly surface: string; readonly route: string; readonly evidence: string }[],
): SignalBundle {
  return {
    bundleId: "signals-first-party-product-state",
    capturedAt,
    search: [],
    community: [],
    trends: [],
    competitors: [],
    productState: surfaces.map((entry) => ({
      surface: entry.surface,
      readiness: "shipped" as const,
      route: entry.route,
      evidence: entry.evidence,
    })),
    provenance: { synthetic: false, producedBy: "specsmith-first-party-route-observation", producedAt: capturedAt },
  };
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignalIngestionError("malformed", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SignalIngestionError("malformed", `${field} must be a non-empty string.`);
  }
  return value;
}

function requireInstant(value: unknown, field: string): string {
  const raw = requireString(value, field);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new SignalIngestionError("malformed", `${field} must be an ISO-8601 instant.`);
  }
  return new Date(parsed).toISOString();
}

function requireCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new SignalIngestionError("malformed", `${field} must be a non-negative integer.`);
  }
  return value;
}

/** Nullable-but-present numbers, where null genuinely means "not known". */
function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SignalIngestionError("malformed", `${field}, when present, must be a finite number or null.`);
  }
  return value;
}

export interface SignalEnvironment {
  /** True only in engineering tests. Production callers pass false. */
  readonly allowSynthetic: boolean;
}

/**
 * Parses an ingested bundle strictly.
 *
 * The synthetic refusal mirrors MASTER #2's exactly, and for the same reason: a
 * fixture that can reach production strategy is a fixture that can produce a
 * real video about a launch that never happened.
 */
export function parseSignalBundle(input: unknown, environment: SignalEnvironment): SignalBundle {
  const raw = requireObject(input, "bundle");
  const provenanceRaw = requireObject(raw.provenance, "bundle.provenance");
  if (typeof provenanceRaw.synthetic !== "boolean") {
    throw new SignalIngestionError(
      "missing-provenance",
      "bundle.provenance.synthetic must be an explicit boolean; a bundle that does not say whether it is fixture data cannot be trusted either way.",
    );
  }
  const provenance: StrategyProvenance = {
    synthetic: provenanceRaw.synthetic,
    producedBy: requireString(provenanceRaw.producedBy, "bundle.provenance.producedBy"),
    producedAt: requireInstant(provenanceRaw.producedAt, "bundle.provenance.producedAt"),
  };
  if (provenance.synthetic && !environment.allowSynthetic) {
    throw new SignalIngestionError(
      "synthetic-in-production",
      "This signal bundle is marked synthetic. Synthetic strategic signals are engineering fixture data and may never drive production strategy.",
    );
  }

  const capturedAt = requireInstant(raw.capturedAt, "bundle.capturedAt");
  const array = (value: unknown, field: string): unknown[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new SignalIngestionError("malformed", `${field} must be an array.`);
    return value;
  };

  const search: SearchSignal[] = array(raw.search, "bundle.search").map((entry, index) => {
    const row = requireObject(entry, `bundle.search[${index}]`);
    const clicks = requireCount(row.clicks, `bundle.search[${index}].clicks`);
    const impressions = requireCount(row.impressions, `bundle.search[${index}].impressions`);
    if (clicks > impressions) {
      throw new SignalIngestionError(
        "impossible-metric",
        `bundle.search[${index}] reports more clicks (${clicks}) than impressions (${impressions}).`,
      );
    }
    return {
      query: requireString(row.query, `bundle.search[${index}].query`),
      impressions,
      clicks,
      position: optionalNumber(row.position, `bundle.search[${index}].position`),
      observedAt: requireInstant(row.observedAt, `bundle.search[${index}].observedAt`),
      previousImpressions: optionalNumber(row.previousImpressions, `bundle.search[${index}].previousImpressions`),
    };
  });

  const community: CommunitySignal[] = array(raw.community, "bundle.community").map((entry, index) => {
    const row = requireObject(entry, `bundle.community[${index}]`);
    const first = requireInstant(row.firstObservedAt, `bundle.community[${index}].firstObservedAt`);
    const last = requireInstant(row.lastObservedAt, `bundle.community[${index}].lastObservedAt`);
    if (Date.parse(last) < Date.parse(first)) {
      throw new SignalIngestionError("impossible-metric", `bundle.community[${index}] was last observed before it was first observed.`);
    }
    return {
      question: requireString(row.question, `bundle.community[${index}].question`),
      observationCount: requireCount(row.observationCount, `bundle.community[${index}].observationCount`),
      firstObservedAt: first,
      lastObservedAt: last,
    };
  });

  const trends: TrendSignal[] = array(raw.trends, "bundle.trends").map((entry, index) => {
    const row = requireObject(entry, `bundle.trends[${index}]`);
    const series = array(row.series, `bundle.trends[${index}].series`).map((point, pointIndex) => {
      const p = requireObject(point, `bundle.trends[${index}].series[${pointIndex}]`);
      return {
        at: requireInstant(p.at, `bundle.trends[${index}].series[${pointIndex}].at`),
        value: requireCount(p.value, `bundle.trends[${index}].series[${pointIndex}].value`),
      };
    });
    return { subject: requireString(row.subject, `bundle.trends[${index}].subject`), series };
  });

  const competitors: CompetitorSignal[] = array(raw.competitors, "bundle.competitors").map((entry, index) => {
    const row = requireObject(entry, `bundle.competitors[${index}]`);
    return {
      question: requireString(row.question, `bundle.competitors[${index}].question`),
      observedCoveringPieces: requireCount(row.observedCoveringPieces, `bundle.competitors[${index}].observedCoveringPieces`),
      weaknessesObserved: array(row.weaknessesObserved, `bundle.competitors[${index}].weaknessesObserved`)
        .map((w, i) => requireString(w, `bundle.competitors[${index}].weaknessesObserved[${i}]`)),
    };
  });

  const productState: ProductStateSignal[] = array(raw.productState, "bundle.productState").map((entry, index) => {
    const row = requireObject(entry, `bundle.productState[${index}]`);
    const readiness = requireString(row.readiness, `bundle.productState[${index}].readiness`);
    if (!["shipped", "partial", "planned", "absent"].includes(readiness)) {
      throw new SignalIngestionError("unknown-enum", `bundle.productState[${index}].readiness must be shipped, partial, planned or absent.`);
    }
    const route = row.route === undefined ? undefined : requireString(row.route, `bundle.productState[${index}].route`);
    if (readiness !== "shipped" && route !== undefined) {
      throw new SignalIngestionError(
        "impossible-metric",
        `bundle.productState[${index}] declares a route but is ${readiness}; only a shipped surface has a route an audience can be sent to.`,
      );
    }
    return {
      surface: requireString(row.surface, `bundle.productState[${index}].surface`),
      readiness: readiness as ProductReadiness,
      route,
      evidence: requireString(row.evidence, `bundle.productState[${index}].evidence`),
    };
  });

  return { bundleId: requireString(raw.bundleId, "bundle.bundleId"), capturedAt, search, community, trends, competitors, productState, provenance };
}

/**
 * Search demand for a question.
 *
 * Below MIN_SEARCH_IMPRESSIONS the answer is `unknown` with reason
 * `insufficient-sample`, NOT `low`. "We saw three impressions" and "few people
 * search this" are different statements, and only the first is true.
 */
export function searchDemandFor(bundle: SignalBundle, question: string): SignalAvailability<SearchDemandState> {
  if (bundle.search.length === 0) {
    return {
      state: "unknown", available: false, reason: "not-configured",
      explanation: "No search data source is connected, so search demand is unobserved rather than low.",
    };
  }
  const matches = bundle.search.filter((row) => sharesSubject(row.query, question));
  if (matches.length === 0) {
    return {
      state: "unknown", available: false, reason: "insufficient-sample",
      explanation: "The connected search data contains no rows for this question; absence of a row is not absence of demand.",
    };
  }
  const impressions = matches.reduce((sum, row) => sum + row.impressions, 0);
  if (impressions < MIN_SEARCH_IMPRESSIONS) {
    return {
      state: "unknown", available: false, reason: "insufficient-sample",
      explanation: `${impressions} impression(s) is below the ${MIN_SEARCH_IMPRESSIONS} floor; this is noise, not a demand signal.`,
    };
  }
  const state: SearchDemandState = impressions >= 1000 ? "high" : impressions >= 200 ? "moderate" : "low";
  return { state, available: true, reason: "available", explanation: `${impressions} impressions across ${matches.length} matching query row(s).` };
}

/** Trend direction, which needs a time series rather than a single reading. */
export function trendFor(bundle: SignalBundle, subject: string): SignalAvailability<TrendState> {
  if (bundle.trends.length === 0) {
    return {
      state: "unknown", available: false, reason: "not-configured",
      explanation: "No trend collector is connected. This is why nothing here may be described as trending.",
    };
  }
  const match = bestMatch(bundle.trends, subject, (row) => row.subject);
  if (!match) {
    return { state: "unknown", available: false, reason: "insufficient-sample", explanation: "No trend series covers this subject." };
  }
  if (match.series.length < MIN_TREND_POINTS) {
    return {
      state: "unknown", available: false, reason: "insufficient-sample",
      explanation: `${match.series.length} data point(s) cannot describe a direction; ${MIN_TREND_POINTS} are required.`,
    };
  }
  const ordered = [...match.series].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = ordered[0].value;
  const last = ordered[ordered.length - 1].value;
  if (first === 0) {
    return {
      state: last > 0 ? "rising" : "unknown", available: last > 0, reason: last > 0 ? "available" : "insufficient-sample",
      explanation: last > 0 ? "Series began at zero and is now non-zero." : "Series is entirely zero.",
    };
  }
  const change = (last - first) / first;
  const state: TrendState = change > 0.25 ? "rising" : change < -0.25 ? "falling" : "stable";
  return { state, available: true, reason: "available", explanation: `Series moved ${Math.round(change * 100)}% across ${ordered.length} points.` };
}

/** How often a question is actually asked, when a collector exists. */
export function communityPainFor(bundle: SignalBundle, question: string): SignalAvailability<CommunityPainState> {
  if (bundle.community.length === 0) {
    return {
      state: "unknown", available: false, reason: "not-configured",
      explanation: "No community collector is connected, so nothing may be described as widely asked.",
    };
  }
  const match = bestMatch(bundle.community, question, (row) => row.question);
  if (!match) {
    return { state: "unknown", available: false, reason: "insufficient-sample", explanation: "No community observation covers this question." };
  }
  if (match.observationCount < MIN_COMMUNITY_OBSERVATIONS) {
    return {
      state: "unknown", available: false, reason: "insufficient-sample",
      explanation: `${match.observationCount} observation(s) is below the ${MIN_COMMUNITY_OBSERVATIONS} floor. One person asking is not a pain cluster.`,
    };
  }
  const state: CommunityPainState = match.observationCount >= 25 ? "widespread" : match.observationCount >= 8 ? "occasional" : "rare";
  return { state, available: true, reason: "available", explanation: `${match.observationCount} distinct observations of this question.` };
}

/**
 * Competitor coverage.
 *
 * Zero observed pieces is `unknown`, never `whitespace`. "We did not look" and
 * "nobody covers this" are different claims, and only a real survey supports
 * the second.
 */
export function competitorCoverageFor(bundle: SignalBundle, question: string): SignalAvailability<CompetitorCoverageState> {
  if (bundle.competitors.length === 0) {
    return {
      state: "unknown", available: false, reason: "not-configured",
      explanation: "No competitor survey exists. Claiming whitespace without one would assert that nobody covers this, which nobody checked.",
    };
  }
  const match = bestMatch(bundle.competitors, question, (row) => row.question);
  if (!match) {
    return { state: "unknown", available: false, reason: "insufficient-sample", explanation: "The survey does not cover this question." };
  }
  const state: CompetitorCoverageState =
    match.observedCoveringPieces === 0
      ? "whitespace"
      : match.weaknessesObserved.length > 0 && match.observedCoveringPieces <= 3
        ? "mixed"
        : "crowded";
  return {
    state, available: true, reason: "available",
    explanation: `${match.observedCoveringPieces} observed piece(s)${match.weaknessesObserved.length ? `, with observed weaknesses: ${match.weaknessesObserved.join("; ")}` : ""}.`,
  };
}

/** Product readiness for a surface, from real product state only. */
export function productReadinessFor(bundle: SignalBundle, surface: string | null): { readiness: ProductReadiness; route: string | null; evidence: string } {
  if (surface === null) {
    return { readiness: "absent", route: null, evidence: "This pillar names no SpecSmith surface." };
  }
  const match = bundle.productState.find((row) => row.surface === surface);
  if (!match) {
    return {
      readiness: "absent", route: null,
      evidence: `No product-state signal describes the ${surface} surface, so it may not be promised to an audience.`,
    };
  }
  return { readiness: match.readiness, route: match.route ?? null, evidence: match.evidence };
}

/**
 * Whether two strings are about the same thing.
 *
 * Deliberately conservative: shared distinctive words only, so "psu wattage"
 * does not match "gpu wattage". This is matching for signal lookup, not for the
 * evidence gate — a miss here produces `unknown`, which is safe, whereas a miss
 * in MASTER #2's matcher would let an unsupported claim through.
 */
const LOOKUP_STOP = new Set([
  "the", "a", "an", "is", "are", "do", "does", "what", "which", "how", "much",
  "will", "my", "i", "should", "can", "for", "to", "of", "in", "on", "and", "or", "it",
]);

function lookupTokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().split(/[^a-z0-9-]+/).filter((token) => token.length > 2 && !LOOKUP_STOP.has(token)),
  );
}

/**
 * How much two questions overlap, as a share of the shorter one.
 *
 * A ratio rather than a count, because a raw count of two shared tokens made
 * "example gpu-a coil whine" match "example gpu-a upgrade worth it" — the same
 * product, a completely different question — and the signal for one was then
 * read as the signal for the other.
 */
const LOOKUP_MATCH_RATIO = 0.6;

function subjectOverlap(left: string, right: string): number {
  const a = lookupTokens(left);
  const b = lookupTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function sharesSubject(left: string, right: string): boolean {
  return subjectOverlap(left, right) >= LOOKUP_MATCH_RATIO;
}

/**
 * The best-matching row, not the first acceptable one.
 *
 * Taking the first match meant row order decided which signal a question got.
 */
function bestMatch<T>(rows: readonly T[], question: string, key: (row: T) => string): T | undefined {
  let best: T | undefined;
  let bestScore = 0;
  for (const row of rows) {
    const score = subjectOverlap(key(row), question);
    if (score >= LOOKUP_MATCH_RATIO && score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/** Records where a signal came from, for the opportunity's provenance chain. */
export function signalOrigin(
  signalId: string,
  kind: SignalOrigin["kind"],
  sourceRef: string,
  observedAt: string,
  provenance: StrategyProvenance,
): SignalOrigin {
  return { signalId, kind, sourceRef, observedAt, provenance };
}
