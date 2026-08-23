import type {
  CreativeFingerprint,
  SnapshotWindow,
  TrafficSourceBreakdown,
  VideoPerformanceRecord,
  VideoPlatform,
} from "./types.ts";

export interface AnalyticsSnapshot {
  creativeId: string;
  videoId: string;
  platform: VideoPlatform;
  source: "metricool";
  publishedAt: string;
  capturedAt: string;
  window: SnapshotWindow;
  record: VideoPerformanceRecord;
}

export interface MetricoolAnalyticsContext {
  creativeId: string;
  videoId: string;
  ideaId: string;
  platform: VideoPlatform;
  publishedAt: string;
  durationSeconds: number;
  fingerprint: CreativeFingerprint;
  window: SnapshotWindow;
  capturedAt?: string;
}

const SNAPSHOT_HOURS: Record<SnapshotWindow, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "72h": 72,
  "7d": 24 * 7,
};

const SNAPSHOT_ORDER: SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];

function parseMetricNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return undefined;
  const numeric = Number(trimmed.replace(/%$/, ""));
  if (Number.isFinite(numeric)) return numeric;

  const duration = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (!duration) return undefined;
  const hours = Number(duration[1] ?? 0);
  const minutes = Number(duration[2]);
  const seconds = Number(`${duration[3]}.${duration[4] ?? 0}`);
  return hours * 3600 + minutes * 60 + seconds;
}

function numberFrom(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = parseMetricNumber(row[key]);
    if (direct !== undefined) return direct;
  }
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (!lowerKeys.has(key.toLowerCase())) continue;
    const parsed = parseMetricNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function asRatio(value: number | undefined): number | undefined {
  if (value === undefined || value < 0 || !Number.isFinite(value)) return undefined;
  return value > 1 ? value / 100 : value;
}

function durationBucket(seconds: number): VideoPerformanceRecord["durationBucket"] {
  if (seconds < 20) return "under-20";
  if (seconds < 30) return "20-29";
  if (seconds < 45) return "30-44";
  return "45-plus";
}

function validateContext(context: MetricoolAnalyticsContext): void {
  if (!context.creativeId.trim() || !context.videoId.trim() || !context.ideaId.trim()) {
    throw new Error("Analytics context requires creativeId, videoId, and ideaId.");
  }
  if (!Number.isFinite(Date.parse(context.publishedAt))) throw new Error("publishedAt must be a valid timestamp.");
  if (!Number.isFinite(context.durationSeconds) || context.durationSeconds <= 0) {
    throw new Error("durationSeconds must be positive.");
  }
  if (context.fingerprint.creativeId !== context.creativeId) {
    throw new Error(`Fingerprint ${context.fingerprint.creativeId} does not match analytics creative ${context.creativeId}.`);
  }
  if (context.fingerprint.platform !== context.platform || context.fingerprint.ideaId !== context.ideaId) {
    throw new Error("Fingerprint does not match analytics platform/idea.");
  }
}

function trafficSources(row: Record<string, unknown>): TrafficSourceBreakdown | undefined {
  const result: TrafficSourceBreakdown = {
    forYou: numberFrom(row, ["TKPO16", "For you"]),
    following: numberFrom(row, ["TKPO17", "Follow"]),
    hashtag: numberFrom(row, ["TKPO18", "Hashtag"]),
    sound: numberFrom(row, ["TKPO19", "Sound"]),
    profile: numberFrom(row, ["TKPO20", "Personal profile"]),
    search: numberFrom(row, ["TKPO21", "Search"]),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

export function normalizeMetricoolAnalyticsRow(
  row: Record<string, unknown>,
  context: MetricoolAnalyticsContext,
): AnalyticsSnapshot {
  validateContext(context);
  const fp = context.fingerprint;
  const capturedAt = context.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt must be a valid timestamp.");

  let views: number | undefined;
  let reach: number | undefined;
  let averageViewDurationSeconds: number | undefined;
  let averagePercentageViewed: number | undefined;
  let stayedToWatchRate: number | undefined;
  let fullVideoWatchedRate: number | undefined;
  let likes: number | undefined;
  let comments: number | undefined;
  let shares: number | undefined;
  let saves: number | undefined;
  let reposts: number | undefined;
  let sourceBreakdown: TrafficSourceBreakdown | undefined;

  if (context.platform === "instagram-reels") {
    views = numberFrom(row, ["IGRE23", "Views"]);
    reach = numberFrom(row, ["IGRE11", "Reach"]);
    averageViewDurationSeconds = numberFrom(row, ["IGRE24", "Average watch time"]);
    averagePercentageViewed = asRatio(numberFrom(row, ["IGRE27", "Retention"]));
    stayedToWatchRate = asRatio(numberFrom(row, ["IGRE28", "Reel view rate"]));
    likes = numberFrom(row, ["IGRE10", "Likes"]);
    comments = numberFrom(row, ["IGRE07", "Comments"]);
    shares = numberFrom(row, ["IGRE21", "Shares"]);
    saves = numberFrom(row, ["IGRE12", "Saved"]);
    reposts = numberFrom(row, ["IGRE29", "Reposts"]);
  } else if (context.platform === "tiktok") {
    views = numberFrom(row, ["TKPO07", "Views"]);
    reach = numberFrom(row, ["TKPO11", "Reach"]);
    averageViewDurationSeconds = numberFrom(row, ["TKPO15", "Average time watched"]);
    fullVideoWatchedRate = asRatio(numberFrom(row, ["TKPO13", "Full video watched rate"]));
    likes = numberFrom(row, ["TKPO08", "Likes"]);
    comments = numberFrom(row, ["TKPO09", "Comments"]);
    shares = numberFrom(row, ["TKPO10", "Shares"]);
    sourceBreakdown = trafficSources(row);
  } else {
    views = numberFrom(row, ["YTVP06", "Views"]);
    averageViewDurationSeconds = numberFrom(row, ["YTVP08", "Avg View Duration"]);
    likes = numberFrom(row, ["YTVP09", "Likes"]);
    comments = numberFrom(row, ["YTVP11", "Comments"]);
    shares = numberFrom(row, ["YTVP12", "Shares"]);
  }

  const retentionCurve = fullVideoWatchedRate === undefined
    ? undefined
    : [{ elapsedRatio: 0.95, audienceRatio: fullVideoWatchedRate }];

  const record: VideoPerformanceRecord = {
    videoId: context.videoId,
    creativeId: context.creativeId,
    ideaId: context.ideaId,
    platform: context.platform,
    publishedAt: context.publishedAt,
    durationSeconds: context.durationSeconds,
    views: Math.max(0, views ?? 0),
    reach,
    averageViewDurationSeconds,
    averagePercentageViewed,
    stayedToWatchRate,
    fullVideoWatchedRate,
    retentionCurve,
    likes,
    comments,
    shares,
    saves,
    reposts,
    trafficSources: sourceBreakdown,
    snapshotWindow: context.window,
    format: fp.format,
    visualWorld: fp.visualWorld,
    narrativeEngine: fp.narrativeEngine,
    hookFamily: fp.hookFamily,
    durationBucket: durationBucket(context.durationSeconds),
    firstVisualType: fp.firstVisualType,
    editDensity: fp.editDensity,
    captionDensity: fp.captionDensity,
    ctaFamily: fp.ctaFamily,
    experimentId: fp.experimentId,
    changedVariable: fp.changedVariable,
    parentCreativeId: fp.parentCreativeId,
    contentFreshness: fp.contentFreshness,
    voiceId: fp.voiceId,
    voiceName: fp.voiceName,
    generationCostUsd: fp.generationCostUsd,
    generationSeconds: fp.generationSeconds,
    hashtagStrategy: fp.hashtagStrategy,
    hashtags: [...fp.hashtags],
  };

  return {
    creativeId: context.creativeId,
    videoId: context.videoId,
    platform: context.platform,
    source: "metricool",
    publishedAt: context.publishedAt,
    capturedAt,
    window: context.window,
    record,
  };
}

export function snapshotDueAt(publishedAt: string, window: SnapshotWindow): string {
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) throw new Error("publishedAt must be a valid timestamp.");
  return new Date(publishedMs + SNAPSHOT_HOURS[window] * 60 * 60 * 1000).toISOString();
}

export function nextDueSnapshotWindow(
  publishedAt: string,
  existing: AnalyticsSnapshot[],
  now = new Date(),
): SnapshotWindow | null {
  const captured = new Set(existing.map((snapshot) => snapshot.window));
  for (const window of SNAPSHOT_ORDER) {
    if (captured.has(window)) continue;
    if (now.getTime() >= Date.parse(snapshotDueAt(publishedAt, window))) return window;
    return null;
  }
  return null;
}

export function upsertAnalyticsSnapshot(
  snapshots: AnalyticsSnapshot[],
  incoming: AnalyticsSnapshot,
): AnalyticsSnapshot[] {
  const filtered = snapshots.filter((snapshot) => !(
    snapshot.creativeId === incoming.creativeId &&
    snapshot.platform === incoming.platform &&
    snapshot.window === incoming.window
  ));
  return [...filtered, incoming].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

export function viewsPerHourBetween(earlier: AnalyticsSnapshot, later: AnalyticsSnapshot): number | null {
  if (earlier.creativeId !== later.creativeId || earlier.platform !== later.platform) {
    throw new Error("View velocity snapshots must belong to the same creative and platform.");
  }
  const hours = (Date.parse(later.capturedAt) - Date.parse(earlier.capturedAt)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const delta = later.record.views - earlier.record.views;
  return Number((delta / hours).toFixed(2));
}
