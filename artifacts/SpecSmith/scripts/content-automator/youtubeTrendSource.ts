import type { AudioTrendSnapshot, TrendingAudioCandidate } from "./audioTrend.ts";
import { readAudioTrendSnapshot, writeAudioTrendSnapshot } from "./trendSource.ts";

export interface YouTubeTrendSourceConfig {
  apiKey: string;
  regionCode: string;
  maxResults: number;
  endpoint: string;
  timeoutMs: number;
}

export interface YouTubeTrendRefreshResult {
  snapshot?: AudioTrendSnapshot;
  status: "refreshed" | "cache-fresh" | "not-configured" | "failed-cache" | "failed-no-cache";
  source: "youtube-data-api-music-chart";
  message: string;
  fetchedCandidates: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface YouTubeVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    categoryId?: string;
    tags?: string[];
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoItem[];
  error?: {
    code?: number;
    message?: string;
  };
}

const DEFAULT_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const MUSIC_CATEGORY_ID = "10";
const OFFICIAL_SOURCE_PREFIX = "youtube-data-api:music-chart";
const DEFAULT_REFRESH_HOURS = 6;
const MAX_REFRESH_HOURS = 48;

const clamp100 = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function hoursOld(timestamp: string, now: Date): number {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - parsed.getTime()) / 3_600_000);
}

function refreshHoursFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.AUDIO_TREND_REFRESH_HOURS ?? DEFAULT_REFRESH_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REFRESH_HOURS;
  return Math.min(MAX_REFRESH_HOURS, parsed);
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function rankPopularity(index: number, total: number): number {
  if (total <= 1) return 100;
  return round(clamp100(100 - (index / Math.max(total - 1, 1)) * 45));
}

function discoveryVelocity(item: YouTubeVideoItem, popularity: number, now: Date): number {
  const publishedAt = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : undefined;
  const ageHours = publishedAt && !Number.isNaN(publishedAt.getTime())
    ? Math.max(1, (now.getTime() - publishedAt.getTime()) / 3_600_000)
    : undefined;
  const views = positiveInteger(item.statistics?.viewCount);

  // The Data API chart is a discovery signal, not an audio-usage trend API. Keep this deliberately
  // conservative: rank is the primary signal, and views/hour only nudges the score when available.
  if (ageHours === undefined || views === undefined) return round(popularity * 0.75);
  const viewsPerHour = views / ageHours;
  const viewRateScore = clamp100(35 + Math.log10(Math.max(1, viewsPerHour)) * 10);
  return round(popularity * 0.65 + viewRateScore * 0.35);
}

function semanticTags(item: YouTubeVideoItem): string[] {
  const tags = new Set<string>(["music", "youtube-chart", "discovery-only", "platform-native"]);
  for (const tag of item.snippet?.tags ?? []) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.length <= 32) tags.add(normalized);
  }

  const title = item.snippet?.title?.toLowerCase() ?? "";
  if (/remix|edit|sped up|slowed/.test(title)) tags.add("remix");
  if (/electronic|edm|dance|house|techno/.test(title)) ["energy", "drop", "reveal"].forEach((tag) => tags.add(tag));
  if (/hip.?hop|rap|trap/.test(title)) ["impact", "tension", "reveal"].forEach((tag) => tags.add(tag));
  if (/pop/.test(title)) ["upbeat", "clean", "reveal"].forEach((tag) => tags.add(tag));
  return [...tags].slice(0, 30);
}

function normalizeVideo(
  item: YouTubeVideoItem,
  index: number,
  total: number,
  capturedAt: string,
  config: YouTubeTrendSourceConfig,
  now: Date,
): TrendingAudioCandidate | undefined {
  const videoId = item.id?.trim();
  const title = item.snippet?.title?.trim();
  if (!videoId || !title) return undefined;

  const popularity = rankPopularity(index, total);
  return {
    id: `youtube-discovery:${videoId}`,
    platform: "youtube-shorts",
    title,
    artist: item.snippet?.channelTitle?.trim() || undefined,
    capturedAt,
    // IMPORTANT: appearing in YouTube's music chart does not grant SpecSmith permission to reuse
    // the underlying song. The selector intentionally rejects unknown-rights candidates.
    rightsStatus: "unknown",
    popularityScore: popularity,
    velocityScore: discoveryVelocity(item, popularity, now),
    saturationScore: round(clamp100(30 + popularity * 0.6)),
    tags: semanticTags(item),
    source: `${OFFICIAL_SOURCE_PREFIX}:${config.regionCode}`,
    region: config.regionCode,
    rankPosition: index + 1,
    sourceContentId: videoId,
  };
}

export function youtubeTrendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): YouTubeTrendSourceConfig | undefined {
  const apiKey = env.YOUTUBE_DATA_API_KEY?.trim();
  if (!apiKey) return undefined;

  const maxResultsRaw = Number(env.YOUTUBE_TREND_MAX_RESULTS ?? 50);
  const timeoutRaw = Number(env.YOUTUBE_TREND_TIMEOUT_MS ?? 12000);
  return {
    apiKey,
    regionCode: env.YOUTUBE_TREND_REGION?.trim().toUpperCase() || "US",
    maxResults: Number.isFinite(maxResultsRaw) ? Math.max(1, Math.min(50, Math.floor(maxResultsRaw))) : 50,
    endpoint: env.YOUTUBE_TREND_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60000 ? timeoutRaw : 12000,
  };
}

export async function fetchYouTubeMusicChart(
  config: YouTubeTrendSourceConfig,
  now = new Date(),
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AudioTrendSnapshot> {
  if (!config.apiKey) throw new Error("YouTube trend source requires an API key");
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for YouTube trend source");

  const url = new URL(config.endpoint);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("videoCategoryId", MUSIC_CATEGORY_ID);
  url.searchParams.set("regionCode", config.regionCode);
  url.searchParams.set("maxResults", String(config.maxResults));
  url.searchParams.set("key", config.apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`YouTube music chart request failed with HTTP ${response.status}`);
  const payload = await response.json() as YouTubeVideosResponse;
  if (payload.error) throw new Error(`YouTube Data API error ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "unknown error"}`);

  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) throw new Error("YouTube music chart returned no videos");

  const capturedAt = now.toISOString();
  const candidates = items
    .map((item, index) => normalizeVideo(item, index, items.length, capturedAt, config, now))
    .filter((candidate): candidate is TrendingAudioCandidate => candidate !== undefined);

  if (candidates.length === 0) throw new Error("YouTube music chart returned videos but none had usable ids/titles");
  return { capturedAt, candidates };
}

export function mergeYouTubeSnapshot(
  cached: AudioTrendSnapshot | undefined,
  youtube: AudioTrendSnapshot,
): AudioTrendSnapshot {
  const preserved = (cached?.candidates ?? []).filter((candidate) => !candidate.source?.startsWith(OFFICIAL_SOURCE_PREFIX));
  const deduped = new Map<string, TrendingAudioCandidate>();
  for (const candidate of [...preserved, ...youtube.candidates]) deduped.set(`${candidate.platform}:${candidate.id}`, candidate);
  return { capturedAt: youtube.capturedAt, candidates: [...deduped.values()] };
}

function hasFreshOfficialYouTubeData(snapshot: AudioTrendSnapshot | undefined, now: Date, refreshHours: number): boolean {
  return Boolean(snapshot?.candidates.some((candidate) =>
    candidate.platform === "youtube-shorts" &&
    candidate.source?.startsWith(OFFICIAL_SOURCE_PREFIX) &&
    hoursOld(candidate.capturedAt, now) <= refreshHours,
  ));
}

export async function refreshYouTubeTrendCache(options: {
  cachePath: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  force?: boolean;
}): Promise<YouTubeTrendRefreshResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const cached = await readAudioTrendSnapshot(options.cachePath);
  const config = youtubeTrendConfigFromEnv(env);

  if (!config) {
    return {
      snapshot: cached,
      status: "not-configured",
      source: "youtube-data-api-music-chart",
      message: "YouTube trend discovery is not configured; kept cache/fallback behavior.",
      fetchedCandidates: 0,
    };
  }

  const refreshHours = refreshHoursFromEnv(env);
  if (!options.force && hasFreshOfficialYouTubeData(cached, now, refreshHours)) {
    return {
      snapshot: cached,
      status: "cache-fresh",
      source: "youtube-data-api-music-chart",
      message: `YouTube music-chart cache is newer than ${refreshHours}h; skipped an unnecessary API call.`,
      fetchedCandidates: 0,
    };
  }

  try {
    const fresh = await fetchYouTubeMusicChart(config, now, options.fetchImpl ?? globalThis.fetch);
    const merged = mergeYouTubeSnapshot(cached, fresh);
    await writeAudioTrendSnapshot(options.cachePath, merged);
    return {
      snapshot: merged,
      status: "refreshed",
      source: "youtube-data-api-music-chart",
      message: `Refreshed YouTube most-popular Music chart for ${config.regionCode}. Discovery candidates stay rights=unknown and cannot be auto-used as audio.`,
      fetchedCandidates: fresh.candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cached
      ? {
          snapshot: cached,
          status: "failed-cache",
          source: "youtube-data-api-music-chart",
          message: `YouTube trend refresh failed (${message}); kept the previous cache.`,
          fetchedCandidates: 0,
        }
      : {
          status: "failed-no-cache",
          source: "youtube-data-api-music-chart",
          message: `YouTube trend refresh failed (${message}) and no cache exists; safe audio fallback remains active.`,
          fetchedCandidates: 0,
        };
  }
}
