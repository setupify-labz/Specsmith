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

/**
 * Reads one raw cell as a number.
 *
 * A trailing "%" is stripped without changing the magnitude: "0.8%" parses to
 * 0.8. What that 0.8 MEANS is decided by the field it came from, not by how
 * the export happened to format it — see percentagePointRatioFrom.
 */
function parseMetric(value: unknown): number | undefined {
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
    const direct = parseMetric(row[key]);
    if (direct !== undefined) return direct;
  }
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (!lowerKeys.has(key.toLowerCase())) continue;
    const parsed = parseMetric(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/**
 * Converts a field the provider reports in PERCENTAGE POINTS to a 0-1 ratio.
 *
 * IGRE27, IGRE28 and TKPO13 are percentage-point fields: the provider reports
 * 0.8 to mean 0.8%, i.e. 0.008. So the unit is a property of the FIELD and is
 * known ahead of time — it is not something to be inferred per row.
 *
 * Both earlier versions inferred it. The magnitude heuristic
 * (`value > 1 ? value / 100 : value`) read 0.8 as the ratio 0.8 — a 100x
 * overstatement of a retention rate, and worse on exactly the small rates that
 * matter. Honouring a trailing "%" fixed the string case but left bare numerics
 * on the same broken heuristic, so whether a rate was correct depended on
 * whether the export happened to be formatted. Here the divisor is
 * unconditional: "0.8%", "0.8" and 0.8 all yield 0.008.
 *
 * A trailing "%" is stripped by parseMetric without rescaling, so a marked and
 * an unmarked value of the same magnitude land on the same ratio.
 */
function percentagePointRatioFrom(value: number | undefined): number | undefined {
  if (value === undefined || value < 0 || !Number.isFinite(value)) return undefined;
  return value / 100;
}

function durationBucket(seconds: number): VideoPerformanceRecord["durationBucket"] {
  if (seconds < 20) return "under-20";
  if (seconds < 30) return "20-29";
  if (seconds < 45) return "30-44";
  return "45-plus";
}

/**
 * A performance record with no view count is not a zero-view record.
 *
 * Defaulting to 0 fabricated a datapoint the learner then treated as a real
 * observation of a video nobody watched, which drags every factor average
 * down. An absent metric is a collection failure and must surface as one.
 */
function requireViews(views: number | undefined, context: MetricoolAnalyticsContext): number {
  if (views === undefined) {
    throw new Error(
      `Metricool row for ${context.creativeId} (${context.platform}, ${context.window}) has no view count. Refusing to record a fabricated zero-view observation.`,
    );
  }
  if (!Number.isFinite(views) || views < 0) throw new Error(`Metricool view count for ${context.creativeId} is invalid: ${views}.`);
  return views;
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
    averagePercentageViewed = percentagePointRatioFrom(numberFrom(row, ["IGRE27", "Retention"]));
    stayedToWatchRate = percentagePointRatioFrom(numberFrom(row, ["IGRE28", "Reel view rate"]));
    likes = numberFrom(row, ["IGRE10", "Likes"]);
    comments = numberFrom(row, ["IGRE07", "Comments"]);
    shares = numberFrom(row, ["IGRE21", "Shares"]);
    saves = numberFrom(row, ["IGRE12", "Saved"]);
    reposts = numberFrom(row, ["IGRE29", "Reposts"]);
  } else if (context.platform === "tiktok") {
    views = numberFrom(row, ["TKPO07", "Views"]);
    reach = numberFrom(row, ["TKPO11", "Reach"]);
    averageViewDurationSeconds = numberFrom(row, ["TKPO15", "Average time watched"]);
    fullVideoWatchedRate = percentagePointRatioFrom(numberFrom(row, ["TKPO13", "Full video watched rate"]));
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

  // No synthetic retention curve. TikTok's "full video watched rate" means
  // watched to 100%, so publishing it as a curve point at elapsedRatio 0.95
  // invented a measurement methodology. performance.ts already falls back to
  // fullVideoWatchedRate when no curve exists, so nothing downstream is lost.
  const retentionCurve = undefined;

  const record: VideoPerformanceRecord = {
    videoId: context.videoId,
    creativeId: context.creativeId,
    ideaId: context.ideaId,
    platform: context.platform,
    publishedAt: context.publishedAt,
    durationSeconds: context.durationSeconds,
    views: requireViews(views, context),
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

/**
 * The window a capture taken right now would legitimately represent.
 *
 * The window is chosen by the CLOCK ALONE — the latest window whose moment has
 * passed — and only then checked against what has already been captured. If
 * that window is already recorded there is nothing due, and the answer is
 * null.
 *
 * The ordering matters, and getting it backwards is what the previous version
 * did: it walked the windows and kept the last UNCAPTURED due one, so with 7d
 * already recorded and 24h missed it returned "24h" and a capture taken today
 * would be filed as a week-old reading. A missed window cannot be backfilled —
 * the moment it describes is gone, and stamping present-day numbers onto it
 * corrupts every window-to-window comparison the learner makes. Selecting
 * strictly by elapsed time makes an older window unreachable by construction.
 */
export function nextDueSnapshotWindow(
  publishedAt: string,
  existing: AnalyticsSnapshot[],
  now = new Date(),
): SnapshotWindow | null {
  let latestDue: SnapshotWindow | null = null;
  for (const window of SNAPSHOT_ORDER) {
    if (now.getTime() < Date.parse(snapshotDueAt(publishedAt, window))) break;
    latestDue = window;
  }
  if (latestDue === null) return null;
  const captured = new Set(existing.map((snapshot) => snapshot.window));
  return captured.has(latestDue) ? null : latestDue;
}

/** Windows whose moment passed without a capture. They cannot be backfilled. */
export function missedSnapshotWindows(
  publishedAt: string,
  existing: AnalyticsSnapshot[],
  now = new Date(),
): SnapshotWindow[] {
  const captured = new Set(existing.map((snapshot) => snapshot.window));
  const current = nextDueSnapshotWindow(publishedAt, existing, now);
  const missed: SnapshotWindow[] = [];
  for (const window of SNAPSHOT_ORDER) {
    if (now.getTime() < Date.parse(snapshotDueAt(publishedAt, window))) break;
    if (!captured.has(window) && window !== current) missed.push(window);
  }
  return missed;
}

/**
 * Records a snapshot, keeping captured windows immutable.
 *
 * A snapshot is a point-in-time fact: "at 1h after publication this video had
 * N views". Overwriting it with a later reading silently rewrites history and
 * makes velocity between windows meaningless, so a differing re-capture of an
 * already-recorded window is refused. An identical re-capture is accepted so
 * retries stay idempotent.
 */
export function recordAnalyticsSnapshot(
  snapshots: AnalyticsSnapshot[],
  incoming: AnalyticsSnapshot,
): AnalyticsSnapshot[] {
  const existing = snapshots.find((snapshot) => (
    snapshot.creativeId === incoming.creativeId &&
    snapshot.platform === incoming.platform &&
    snapshot.window === incoming.window
  ));
  if (existing) {
    if (JSON.stringify(existing.record) === JSON.stringify(incoming.record)) return snapshots;
    throw new Error(
      `Snapshot ${incoming.window} for ${incoming.creativeId} (${incoming.platform}) is already recorded and immutable. Captured ${existing.capturedAt} with ${existing.record.views} views; refusing to overwrite with ${incoming.record.views}.`,
    );
  }
  return [...snapshots, incoming].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
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
