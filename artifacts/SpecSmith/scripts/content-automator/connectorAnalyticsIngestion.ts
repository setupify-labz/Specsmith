// Analytics arriving through the ChatGPT/Metricool CONNECTOR.
//
// The founder's plan has no direct Metricool REST API, but the connected brand
// does expose analytics discovery and retrieval through the connector. So the
// learning loop is reachable today: ChatGPT reads real analytics, writes them
// into an ANALYTICS_RESULT document, and SpecSmith validates that document
// against what it already knows before a single number is stored.
//
// The direct REST collector stays optional and inert. This is the active read
// path, exactly as readyToPublishHandoff is the active write path.
//
// NO NETWORK, NO CREDENTIALS. This module contacts nothing. It reads a
// document someone else obtained and its whole job is refusing the ones that
// cannot be proven to describe a real publication of ours.
//
// "ABSENT" IS NOT "ZERO"
// ----------------------
// The single most dangerous thing this boundary could do is turn a metric the
// connector did not return into a 0. Zero views is a finding; an unreturned
// field is an absence, and averaging the two together silently rewrites how a
// creative performed. Metrics therefore arrive as an explicit union — a number
// or the literal "unavailable" — and an unavailable metric is left OFF the
// performance record rather than defaulted. A metric the document omits
// entirely is treated the same way as one explicitly marked unavailable.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { recordStoredAnalyticsSnapshot, loadStoredCreativeFingerprint, loadStoredPublicationLedger } from "./publishingStore.ts";
import { snapshotDueAt, type AnalyticsSnapshot } from "./analyticsIngestion.ts";
import type { PublicationLedger } from "./publishing.ts";
import type { SnapshotWindow, VideoPerformanceRecord, VideoPlatform } from "./types.ts";

export const ANALYTICS_RESULT_KIND = "ANALYTICS_RESULT" as const;
export const ANALYTICS_RESULT_VERSION = "analytics-result-v1";

/** A measurement, or an explicit statement that the connector did not return one. */
export type MetricValue = number | "unavailable";

/**
 * The metrics SpecSmith can learn from.
 *
 * `views` is the only required one: the existing learner scores everything
 * relative to reach, and a record without it is not a measurement. Every other
 * field may be "unavailable" — platforms differ in what they expose, and a
 * missing field is a fact about the platform, not about the creative.
 */
export interface ConnectorMetrics {
  readonly views: number;
  readonly shownOrImpressions?: MetricValue;
  readonly reach?: MetricValue;
  readonly engagedViews?: MetricValue;
  readonly stayedToWatchRate?: MetricValue;
  readonly fullVideoWatchedRate?: MetricValue;
  readonly averageViewDurationSeconds?: MetricValue;
  readonly averagePercentageViewed?: MetricValue;
  readonly likes?: MetricValue;
  readonly comments?: MetricValue;
  readonly shares?: MetricValue;
  readonly saves?: MetricValue;
  readonly reposts?: MetricValue;
  readonly followsGained?: MetricValue;
  readonly profileVisits?: MetricValue;
  readonly siteClicks?: MetricValue;
}

const OPTIONAL_METRICS = [
  "shownOrImpressions", "reach", "engagedViews", "stayedToWatchRate", "fullVideoWatchedRate",
  "averageViewDurationSeconds", "averagePercentageViewed", "likes", "comments", "shares",
  "saves", "reposts", "followsGained", "profileVisits", "siteClicks",
] as const;

export interface AnalyticsResultDocument {
  readonly kind: typeof ANALYTICS_RESULT_KIND;
  readonly version: typeof ANALYTICS_RESULT_VERSION;

  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly packageId: string;
  /** Must equal the provider post id the publication ledger recorded. */
  readonly providerPostId: string;
  readonly window: SnapshotWindow;
  /** When the connector actually read these numbers. */
  readonly capturedAt: string;
  readonly metrics: ConnectorMetrics;
  /** Free text from the operator; recorded verbatim, never parsed for values. */
  readonly note?: string;
}

export type AnalyticsResultRefusalCode =
  | "malformed-document"
  | "not-published"
  | "provider-post-mismatch"
  | "identity-mismatch"
  | "window-not-due"
  | "impossible-capture-time"
  | "no-stored-fingerprint"
  | "replayed-with-different-data";

export class AnalyticsResultRefusedError extends Error {
  readonly code: AnalyticsResultRefusalCode;
  constructor(code: AnalyticsResultRefusalCode, message: string) {
    super(message);
    this.name = "AnalyticsResultRefusedError";
    this.code = code;
  }
}

const WINDOWS: readonly SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];

/**
 * Validates one optional metric that is PRESENT in the document.
 *
 * The document is the trusted boundary, so it admits exactly two
 * representations of a metric: a non-negative finite number, or the literal
 * string "unavailable". Nothing else — not null, not "", not "n/a", not
 * "null", not a boolean.
 *
 * This deliberately does NOT normalize. An earlier version accepted null and
 * quietly dropped it, which meant the parser was doing a mapping job: the
 * document's own type said `number | "unavailable"` while the parser accepted a
 * third thing and made it vanish. A reader of the schema could not tell what a
 * stored document actually contained. Normalizing the connector's nulls is a
 * real job, but it belongs to connectorMetricsFrom() below, one step earlier,
 * where the ambiguity is visible and deliberate.
 */
function requirePresentMetric(raw: unknown, name: string): MetricValue {
  if (raw === "unavailable") return "unavailable";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw < 0) throw new AnalyticsResultRefusedError("malformed-document", `metrics.${name} cannot be negative.`);
    return raw;
  }
  throw new AnalyticsResultRefusedError(
    "malformed-document",
    `metrics.${name} must be a non-negative number or the string "unavailable"; got ${JSON.stringify(raw)}. `
    + "Map a connector null or missing field to \"unavailable\" with connectorMetricsFrom() before building the document; "
    + "never substitute 0 for a metric the connector did not return.",
  );
}

/**
 * The connector-to-document mapping step, and the ONLY place a null or missing
 * field becomes "unavailable".
 *
 * A real Metricool connector response will have nulls and absent keys in it.
 * That is normal, and turning them into an explicit "unavailable" is a genuine
 * translation — but it has to happen once, in the open, on the way IN, so that
 * what lands in ANALYTICS_RESULT is unambiguous and the parser can stay strict.
 *
 * A present non-numeric, non-null value is left alone rather than rescued: a
 * field reading "n/a" or "" is something this function does not understand, and
 * the parser will reject it by name rather than have it silently become
 * "unavailable" here.
 */
export function connectorMetricsFrom(raw: Record<string, unknown>): Record<string, unknown> {
  const views = raw.views;
  const mapped: Record<string, unknown> = { views };
  for (const name of OPTIONAL_METRICS) {
    const value = raw[name];
    mapped[name] = value === undefined || value === null ? "unavailable" : value;
  }
  return mapped;
}

/** Structural validation. A malformed document is refused, never coerced. */
export function parseAnalyticsResult(input: unknown): AnalyticsResultDocument {
  if (!input || typeof input !== "object") {
    throw new AnalyticsResultRefusedError("malformed-document", "ANALYTICS_RESULT must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const text = (name: string): string => {
    const value = raw[name];
    if (typeof value !== "string" || !value.trim()) {
      throw new AnalyticsResultRefusedError("malformed-document", `ANALYTICS_RESULT.${name} is required.`);
    }
    return value.trim();
  };

  if (raw.kind !== ANALYTICS_RESULT_KIND) {
    throw new AnalyticsResultRefusedError("malformed-document", `ANALYTICS_RESULT.kind must be ${ANALYTICS_RESULT_KIND}.`);
  }
  if (raw.version !== ANALYTICS_RESULT_VERSION) {
    throw new AnalyticsResultRefusedError("malformed-document", `ANALYTICS_RESULT.version must be ${ANALYTICS_RESULT_VERSION}.`);
  }

  const platform = raw.platform;
  if (platform !== "youtube-shorts" && platform !== "tiktok" && platform !== "instagram-reels") {
    throw new AnalyticsResultRefusedError("malformed-document", `ANALYTICS_RESULT.platform ${JSON.stringify(platform)} is not a SpecSmith platform.`);
  }

  const window = raw.window;
  if (typeof window !== "string" || !WINDOWS.includes(window as SnapshotWindow)) {
    throw new AnalyticsResultRefusedError("malformed-document", `ANALYTICS_RESULT.window must be one of ${WINDOWS.join(", ")}.`);
  }

  const capturedAt = text("capturedAt");
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new AnalyticsResultRefusedError("malformed-document", "ANALYTICS_RESULT.capturedAt must be a valid timestamp.");
  }

  const metricsRaw = raw.metrics;
  if (!metricsRaw || typeof metricsRaw !== "object") {
    throw new AnalyticsResultRefusedError("malformed-document", "ANALYTICS_RESULT.metrics is required.");
  }
  const m = metricsRaw as Record<string, unknown>;

  // views is the one metric a measurement cannot be without. "unavailable"
  // views means no measurement happened, which is not a snapshot.
  const views = m.views;
  if (typeof views !== "number" || !Number.isFinite(views) || views < 0) {
    throw new AnalyticsResultRefusedError(
      "malformed-document",
      `ANALYTICS_RESULT.metrics.views must be a non-negative number; got ${JSON.stringify(views)}. A result without a view count is not a measurement, and 0 must never be substituted for an absent one.`,
    );
  }

  const metrics: Record<string, MetricValue | number> = { views };
  for (const name of OPTIONAL_METRICS) {
    // A key that is genuinely absent stays absent — optional means optional.
    // A key that is PRESENT must be a real value; `null` is a present key
    // holding nothing, which is precisely the ambiguity this boundary exists
    // to refuse.
    if (!(name in m)) continue;
    metrics[name] = requirePresentMetric(m[name], name);
  }

  return {
    kind: ANALYTICS_RESULT_KIND,
    version: ANALYTICS_RESULT_VERSION,
    creativeId: text("creativeId"),
    platform,
    packageId: text("packageId"),
    providerPostId: text("providerPostId"),
    window: window as SnapshotWindow,
    capturedAt,
    metrics: metrics as unknown as ConnectorMetrics,
    ...(typeof raw.note === "string" && raw.note.trim() ? { note: raw.note.trim() } : {}),
  };
}

/**
 * Builds the performance record, leaving every unavailable metric OFF.
 *
 * This is where "absent is not zero" is actually enforced: a metric marked
 * "unavailable" (or simply not present) produces no property at all, so the
 * learner's optional-field handling sees an absence, exactly as it would for a
 * platform that never reports that field.
 */
function toPerformanceRecord(
  document: AnalyticsResultDocument,
  ledger: PublicationLedger,
  publishedAt: string,
  fingerprint: { ideaId: string; targetDurationSeconds: number; format: string; visualWorld: string; narrativeEngine: string; hookFamily: string; [key: string]: unknown },
): VideoPerformanceRecord {
  const record: Record<string, unknown> = {
    videoId: document.providerPostId,
    creativeId: document.creativeId,
    ideaId: fingerprint.ideaId,
    platform: document.platform,
    publishedAt,
    durationSeconds: fingerprint.targetDurationSeconds,
    views: document.metrics.views,
    snapshotWindow: document.window,
    format: fingerprint.format,
    visualWorld: fingerprint.visualWorld,
    narrativeEngine: fingerprint.narrativeEngine,
    hookFamily: fingerprint.hookFamily,
    durationBucket: fingerprint.durationBucket ?? bucketFor(fingerprint.targetDurationSeconds),
    firstVisualType: fingerprint.firstVisualType,
    editDensity: fingerprint.editDensity,
    captionDensity: fingerprint.captionDensity,
    ctaFamily: fingerprint.ctaFamily,
    hashtagStrategy: fingerprint.hashtagStrategy,
  };
  for (const name of OPTIONAL_METRICS) {
    const value = (document.metrics as unknown as Record<string, MetricValue | undefined>)[name];
    // The whole point: "unavailable" and undefined both mean no property.
    if (typeof value === "number") record[name] = value;
  }
  return record as unknown as VideoPerformanceRecord;
}

function bucketFor(seconds: number): string {
  if (seconds < 20) return "<20s";
  if (seconds <= 30) return "20-30s";
  if (seconds <= 45) return "31-45s";
  return ">45s";
}

function resultDirectory(root: string): string {
  return join(root, "analytics-results");
}

function resultPath(root: string, creativeId: string, platform: VideoPlatform, window: SnapshotWindow): string {
  return join(resultDirectory(root), `${creativeId}__${platform}__${window}.json`);
}

export async function loadStoredAnalyticsResult(
  root: string,
  creativeId: string,
  platform: VideoPlatform,
  window: SnapshotWindow,
): Promise<AnalyticsResultDocument | null> {
  try {
    return parseAnalyticsResult(JSON.parse(await readFile(resultPath(root, creativeId, platform, window), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameDocument(a: AnalyticsResultDocument, b: AnalyticsResultDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ConnectorIngestOutcome {
  readonly document: AnalyticsResultDocument;
  readonly snapshot: AnalyticsSnapshot;
  readonly replayed: boolean;
}

/**
 * Validates a connector analytics result and stores it as an immutable snapshot.
 *
 * Every check runs against durable state SpecSmith already holds, before any
 * write. Snapshots go through the existing recordStoredAnalyticsSnapshot, so
 * the existing immutability rule applies unchanged, and the records they carry
 * reach the learner through the existing selectLearnerRecords path. There is
 * no second learner and no second snapshot store.
 */
export async function ingestConnectorAnalytics(
  input: unknown,
  options: { storeRoot: string; now?: Date },
): Promise<ConnectorIngestOutcome> {
  const document = parseAnalyticsResult(input);
  const now = options.now ?? new Date();

  const ledger = await loadStoredPublicationLedger(options.storeRoot, document.creativeId);
  if (!ledger) {
    throw new AnalyticsResultRefusedError(
      "identity-mismatch",
      `No publication ledger exists for ${document.creativeId}; analytics cannot be attributed to a creative SpecSmith never published.`,
    );
  }

  if (ledger.platform !== document.platform) {
    throw new AnalyticsResultRefusedError(
      "identity-mismatch",
      `Ledger ${document.creativeId} is ${ledger.platform}, but the result claims ${document.platform}.`,
    );
  }
  if (ledger.packageId !== document.packageId) {
    throw new AnalyticsResultRefusedError(
      "identity-mismatch",
      `Ledger ${document.creativeId} belongs to package ${ledger.packageId}, but the result claims ${document.packageId}.`,
    );
  }

  const published = ledger.events.find((event) => event.status === "published");
  if (!published) {
    throw new AnalyticsResultRefusedError(
      "not-published",
      `Creative ${document.creativeId} has no published ledger event. There is nothing that could have been measured.`,
    );
  }

  const ledgerPostId = [...ledger.events].reverse().find((event) => event.providerPostId)?.providerPostId;
  if (!ledgerPostId) {
    throw new AnalyticsResultRefusedError(
      "provider-post-mismatch",
      `Creative ${document.creativeId} has no provider post id recorded; analytics cannot be bound to a publication.`,
    );
  }
  if (ledgerPostId !== document.providerPostId) {
    throw new AnalyticsResultRefusedError(
      "provider-post-mismatch",
      `Ledger ${document.creativeId} records provider post ${ledgerPostId}, but the result reports ${document.providerPostId}.`,
    );
  }

  // Capture time must be physically possible for the window it claims.
  const publishedMs = Date.parse(published.at);
  const capturedMs = Date.parse(document.capturedAt);
  if (capturedMs < publishedMs) {
    throw new AnalyticsResultRefusedError(
      "impossible-capture-time",
      `capturedAt ${document.capturedAt} precedes publication at ${published.at}.`,
    );
  }
  if (capturedMs > now.getTime()) {
    throw new AnalyticsResultRefusedError(
      "impossible-capture-time",
      `capturedAt ${document.capturedAt} is in the future.`,
    );
  }
  const dueMs = Date.parse(snapshotDueAt(published.at, document.window));
  if (capturedMs < dueMs) {
    // A 24h reading cannot exist one hour after publication. Accepting it
    // would file early numbers under a later window and corrupt every
    // comparison that window is used for.
    throw new AnalyticsResultRefusedError(
      "window-not-due",
      `The ${document.window} window is not due until ${new Date(dueMs).toISOString()}, but the result was captured at ${document.capturedAt}.`,
    );
  }

  // Replay, before any write.
  const stored = await loadStoredAnalyticsResult(options.storeRoot, document.creativeId, document.platform, document.window);
  if (stored) {
    if (sameDocument(stored, document)) {
      const existing = await snapshotFor(options.storeRoot, document, ledger, published.at);
      return { document: stored, snapshot: existing, replayed: true };
    }
    throw new AnalyticsResultRefusedError(
      "replayed-with-different-data",
      `A different ${document.window} analytics result was already recorded for ${document.creativeId}. Captured measurements are not editable.`,
    );
  }

  const snapshot = await snapshotFor(options.storeRoot, document, ledger, published.at);
  const persisted = await recordStoredAnalyticsSnapshot(options.storeRoot, snapshot);

  await mkdir(resultDirectory(options.storeRoot), { recursive: true });
  await writeFile(
    resultPath(options.storeRoot, document.creativeId, document.platform, document.window),
    `${JSON.stringify(document, null, 2)}\n`,
    { flag: "wx" },
  );

  return { document, snapshot: persisted, replayed: false };
}

async function snapshotFor(
  root: string,
  document: AnalyticsResultDocument,
  ledger: PublicationLedger,
  publishedAt: string,
): Promise<AnalyticsSnapshot> {
  const fingerprint = await loadStoredCreativeFingerprint(root, document.creativeId);
  if (!fingerprint) {
    throw new AnalyticsResultRefusedError(
      "no-stored-fingerprint",
      `Creative ${document.creativeId} has no stored fingerprint, so these metrics cannot be attributed to a creative. Refusing to record an unattributable measurement.`,
    );
  }
  return {
    creativeId: document.creativeId,
    videoId: document.providerPostId,
    platform: document.platform,
    source: "metricool",
    publishedAt,
    capturedAt: document.capturedAt,
    window: document.window,
    record: toPerformanceRecord(document, ledger, publishedAt, fingerprint as never),
  };
}

/**
 * The blank ChatGPT fills in from the connector's actual response.
 *
 * Identity fields are pre-filled from what SpecSmith already knows, so they
 * cannot be mistyped. Every metric is left as an instruction rather than a
 * value, and the instruction says what to do when the connector does not
 * return one: write "unavailable", never 0.
 */
export async function analyticsResultTemplate(
  root: string,
  creativeId: string,
  window: SnapshotWindow,
): Promise<Record<string, unknown>> {
  const ledger = await loadStoredPublicationLedger(root, creativeId);
  if (!ledger) throw new AnalyticsResultRefusedError("identity-mismatch", `No publication ledger exists for ${creativeId}.`);
  const published = ledger.events.find((event) => event.status === "published");
  if (!published) throw new AnalyticsResultRefusedError("not-published", `Creative ${creativeId} has not been published.`);
  const providerPostId = [...ledger.events].reverse().find((event) => event.providerPostId)?.providerPostId;
  if (!providerPostId) {
    throw new AnalyticsResultRefusedError("provider-post-mismatch", `Creative ${creativeId} has no provider post id recorded.`);
  }

  return {
    kind: ANALYTICS_RESULT_KIND,
    version: ANALYTICS_RESULT_VERSION,
    creativeId,
    platform: ledger.platform,
    packageId: ledger.packageId,
    providerPostId,
    window,
    capturedAt: "<ISO-8601 time you actually read these numbers from the connector>",
    metrics: {
      views: "<number the connector returned — REQUIRED; if the connector did not return views, do not submit this document>",
      ...Object.fromEntries(OPTIONAL_METRICS.map((name) => [
        name,
        '<number the connector returned, or the string "unavailable" — NEVER 0 for a metric it did not return>',
      ])),
    },
    note: "<optional: anything about this reading a reviewer should know>",
    _instructions: [
      `This window is due at ${snapshotDueAt(published.at, window)}; a reading taken before then is refused.`,
      "Copy numbers exactly as the connector reported them. Do not round, derive, or infer.",
      'A metric the connector did not return is "unavailable". Writing 0 instead states that nobody did that thing, which is a different and false claim.',
      "Remove any metric line you are unsure about rather than guessing; an omitted key is allowed and means the same as unavailable.",
      "A key that is present must hold a number or \"unavailable\". null, \"\", \"n/a\" and \"null\" are refused — run the connector response through connectorMetricsFrom() to turn its nulls into \"unavailable\" first.",
    ],
  };
}
