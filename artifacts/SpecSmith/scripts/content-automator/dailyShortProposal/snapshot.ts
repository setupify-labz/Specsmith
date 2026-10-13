// The channel-metrics snapshot the daily proposal job reads.
//
// WHY A SNAPSHOT, NOT A LIVE CALL
// The owner's Metricool plan has no REST API (metricoolClient.ts) and vidIQ has
// no API in this repository: both are reachable only through connectors in an
// assistant session. So the numbers arrive the way connector analytics already
// do here (connectorAnalyticsIngestion.ts): a session with the connectors
// writes a dated document, and code validates it before anything uses it.
//
// WHAT IS REFUSED (the job fails, it never guesses)
// - a missing or unreadable file, the wrong kind or version;
// - a snapshot older than the allowed age (default 36 h): yesterday's numbers
//   are not today's evidence;
// - any NEEDED source (YouTube via vidIQ, TikTok and Instagram via Metricool)
//   absent or marked unavailable;
// - a metric that is neither a number nor the literal "unknown".
// A metric the provider did not return is "unknown", carried as such into the
// proposal's record; it is never filled in.

import { readFile } from "node:fs/promises";

export class DailyProposalError extends Error {
  constructor(readonly code: "snapshot-missing" | "snapshot-invalid" | "snapshot-stale" | "source-unavailable" | "renderer-unavailable" | "no-topic" | "bad-argument" | "output-not-empty" | "ledger-invalid", message: string) {
    super(message);
    this.name = "DailyProposalError";
  }
}

export type Metric = number | "unknown";
export const NEEDED_SOURCES = ["youtube", "tiktok", "instagram"] as const;
export type SourceName = (typeof NEEDED_SOURCES)[number];

export interface YouTubeVideo {
  readonly id: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly durationSeconds: Metric;
  readonly public: { readonly views: Metric; readonly likes: Metric; readonly comments: Metric };
  readonly analytics: {
    readonly views: Metric; readonly engagedViews: Metric; readonly averageViewPercentage: Metric;
    readonly averageViewDurationSeconds: Metric; readonly shares: Metric; readonly subscribersGained: Metric;
  };
}
export interface DayRow { readonly date: string; readonly [metric: string]: Metric | string }
export interface ChannelSnapshot {
  readonly kind: "channel-metrics-snapshot";
  readonly version: "channel-metrics-snapshot-v1";
  readonly collectedAt: string;
  readonly collectedBy: string;
  readonly brand: string;
  readonly cost?: Readonly<Record<string, unknown>>;
  readonly sources: {
    readonly youtube: { readonly status: "available"; readonly provider: string; readonly channelId: string; readonly subscribers: Metric; readonly videos: readonly YouTubeVideo[]; readonly analyticsWindow?: unknown };
    readonly tiktok: { readonly status: "available"; readonly provider: string; readonly followers: Metric; readonly byPublishDay: readonly DayRow[]; readonly note?: string };
    readonly instagram: { readonly status: "available"; readonly provider: string; readonly followers: Metric; readonly byPublishDay: readonly DayRow[]; readonly note?: string };
  };
}

// Each metric field has a kind. A count (views, likes, followers, a duration, a percentage) cannot be negative, so a
// negative value is malformed input and is refused. A net change (gained minus lost over a period) can be negative.
// Checked field by field on 2026-10-12: every metric YouTube (vidIQ) and Metricool supply today is a count; none is a
// net change (YouTube's subscribersGained is gains only). Average view percentage can exceed 100 on looping Shorts, so
// no metric has an upper bound.
export type MetricKind = "count" | "net-change";

/** A problem with one metric value of the given kind, or null if it is valid ("unknown" is always valid). */
export function metricProblem(value: unknown, kind: MetricKind): string | null {
  if (value === "unknown") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return `must be a number or "unknown", not ${JSON.stringify(value)}`;
  if (kind === "count" && value < 0) return `is a count and cannot be negative (${value})`;
  return null;
}

/** Metricool per-publish-day rows: every field a row may carry, with its kind. A field not listed is refused, so a new
 *  connector field is classified on purpose (count or net change) rather than assumed. */
export const DAY_ROW_FIELDS: Readonly<Record<string, MetricKind>> = Object.freeze({
  videos: "count", reels: "count", views: "count", likes: "count", comments: "count", shares: "count",
  saves: "count", reach: "count", interactions: "count",
});

function requireMetric(where: string, value: unknown, kind: MetricKind): void {
  const problem = metricProblem(value, kind);
  if (problem) throw new DailyProposalError("snapshot-invalid", `${where} ${problem}.`);
}

function requireMetrics(where: string, record: unknown, keys: readonly string[], kind: MetricKind = "count"): void {
  if (!record || typeof record !== "object") throw new DailyProposalError("snapshot-invalid", `${where} is missing.`);
  for (const key of keys) requireMetric(`${where}.${key}`, (record as Record<string, unknown>)[key], kind);
}

/** The account this job proposes for: a snapshot from any other brand or channel is refused, not ranked. */
export const EXPECTED_ACCOUNT = Object.freeze({ brand: "specsmithpc", youtubeChannelId: "UC1DBOCQ4F0y-BP9he39b3Kg" });

/** Validates a snapshot document; returns it typed, or throws a DailyProposalError saying exactly what is wrong. */
export function parseSnapshot(raw: unknown, now: Date, maxAgeHours = 36): ChannelSnapshot {
  const doc = raw as Record<string, any>;
  if (!doc || doc.kind !== "channel-metrics-snapshot" || doc.version !== "channel-metrics-snapshot-v1") {
    throw new DailyProposalError("snapshot-invalid", "Not a channel-metrics-snapshot-v1 document.");
  }
  if (doc.brand !== EXPECTED_ACCOUNT.brand) throw new DailyProposalError("snapshot-invalid", `The snapshot is for brand "${doc.brand}", not "${EXPECTED_ACCOUNT.brand}"; another account's data must not choose SpecSmith's Short.`);
  const youtube = doc.sources?.youtube;
  if (youtube?.status === "available" && youtube.channelId !== EXPECTED_ACCOUNT.youtubeChannelId) {
    throw new DailyProposalError("snapshot-invalid", `The snapshot's YouTube channel is "${youtube.channelId}", not SpecSmith's "${EXPECTED_ACCOUNT.youtubeChannelId}".`);
  }
  const collected = Date.parse(doc.collectedAt);
  if (!Number.isFinite(collected)) throw new DailyProposalError("snapshot-invalid", "collectedAt is not a timestamp.");
  const ageHours = (now.getTime() - collected) / 3_600_000;
  if (ageHours < -0.1) throw new DailyProposalError("snapshot-invalid", "collectedAt is in the future.");
  if (ageHours > maxAgeHours) {
    throw new DailyProposalError("snapshot-stale", `The snapshot is ${ageHours.toFixed(1)} h old; the limit is ${maxAgeHours} h. Collect a fresh one through the Metricool and vidIQ connectors.`);
  }
  for (const name of NEEDED_SOURCES) {
    const source = doc.sources?.[name];
    if (!source || source.status !== "available") {
      throw new DailyProposalError("source-unavailable", `The ${name} source is ${source ? `marked "${source.status}"` : "absent"}; the proposal needs it. ${source?.reason ?? ""}`.trim());
    }
  }
  const yt = doc.sources.youtube;
  if (!Array.isArray(yt.videos) || yt.videos.length === 0) throw new DailyProposalError("source-unavailable", "The YouTube source lists no videos; there is nothing to learn from.");
  requireMetric("youtube.subscribers", yt.subscribers, "count");
  yt.videos.forEach((video: any, i: number) => {
    if (typeof video.id !== "string" || typeof video.title !== "string" || !Number.isFinite(Date.parse(video.publishedAt))) {
      throw new DailyProposalError("snapshot-invalid", `youtube.videos[${i}] needs an id, a title and a publishedAt.`);
    }
    // Its counts were read at collectedAt, so a video published after that is a data error (e.g. a mistyped year), not a signal.
    if (Date.parse(video.publishedAt) > collected) {
      throw new DailyProposalError("snapshot-invalid", `youtube.videos[${i}] was published (${video.publishedAt}) after the snapshot was collected (${doc.collectedAt}).`);
    }
    requireMetrics(`youtube.videos[${i}]`, video, ["durationSeconds"]);
    requireMetrics(`youtube.videos[${i}].public`, video.public, ["views", "likes", "comments"]);
    requireMetrics(`youtube.videos[${i}].analytics`, video.analytics, ["views", "engagedViews", "averageViewPercentage", "averageViewDurationSeconds", "shares", "subscribersGained"]);
  });
  for (const name of ["tiktok", "instagram"] as const) {
    const source = doc.sources[name];
    requireMetric(`${name}.followers`, source.followers, "count");
    if (!Array.isArray(source.byPublishDay)) throw new DailyProposalError("snapshot-invalid", `${name}.byPublishDay must be a list (empty if nothing was published).`);
    source.byPublishDay.forEach((row: any, i: number) => {
      if (typeof row.date !== "string") throw new DailyProposalError("snapshot-invalid", `${name}.byPublishDay[${i}] needs a date.`);
      for (const [key, value] of Object.entries(row)) {
        if (key === "date") continue;
        const kind = Object.hasOwn(DAY_ROW_FIELDS, key) ? DAY_ROW_FIELDS[key] : undefined;
        if (!kind) throw new DailyProposalError("snapshot-invalid", `${name}.byPublishDay[${i}].${key} is not a known metric; classify it in DAY_ROW_FIELDS as a count or a net change before using it.`);
        requireMetric(`${name}.byPublishDay[${i}].${key}`, value, kind);
      }
    });
  }
  return doc as ChannelSnapshot;
}

export async function loadSnapshot(path: string | undefined, now: Date, maxAgeHours?: number): Promise<{ snapshot: ChannelSnapshot; bytes: Buffer }> {
  if (!path) throw new DailyProposalError("snapshot-missing", "No snapshot given. Pass --snapshot <file>, collected through the Metricool and vidIQ connectors (see dailyShortProposal/README.md).");
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new DailyProposalError("snapshot-missing", `The snapshot ${path} cannot be read.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DailyProposalError("snapshot-invalid", `The snapshot ${path} is not JSON.`);
  }
  return { snapshot: parseSnapshot(raw, now, maxAgeHours), bytes };
}
