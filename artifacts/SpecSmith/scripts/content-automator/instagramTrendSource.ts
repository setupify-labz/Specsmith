import type {
  AudioRightsStatus,
  AudioTrendSnapshot,
  TrendingAudioCandidate,
} from "./audioTrend.ts";
import { readAudioTrendSnapshot, writeAudioTrendSnapshot } from "./trendSource.ts";

export interface InstagramTrendFeedConfig {
  endpoint: string;
  bearerToken?: string;
  trustRights: boolean;
  timeoutMs: number;
}

export interface InstagramTrendRefreshResult {
  snapshot?: AudioTrendSnapshot;
  status: "refreshed" | "cache-fresh" | "not-configured" | "failed-cache" | "failed-no-cache";
  source: "instagram-configured-feed";
  message: string;
  fetchedCandidates: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface InstagramFeedItem {
  id?: string;
  title?: string;
  artist?: string;
  capturedAt?: string;
  popularityScore?: number;
  velocityScore?: number;
  saturationScore?: number;
  tags?: string[];
  rightsStatus?: AudioRightsStatus;
  platformAudioId?: string;
  previewUrl?: string;
  durationSeconds?: number;
  rankPosition?: number;
}

interface InstagramFeedPayload {
  capturedAt?: string;
  items?: InstagramFeedItem[];
  candidates?: InstagramFeedItem[];
}

const SOURCE_PREFIX = "instagram-configured-feed";
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

function finiteScore(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? round(clamp100(value))
    : fallback;
}

function safeCapturedAt(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeRights(status: AudioRightsStatus | undefined, trustRights: boolean): AudioRightsStatus {
  if (!trustRights) return "unknown";
  return status === "platform-cleared" || status === "commercial-cleared"
    ? status
    : status === "not-cleared"
      ? "not-cleared"
      : "unknown";
}

function sourceLabel(endpoint: string): string {
  try {
    return `${SOURCE_PREFIX}:${new URL(endpoint).hostname}`;
  } catch {
    return SOURCE_PREFIX;
  }
}

function normalizeItem(
  item: InstagramFeedItem,
  index: number,
  capturedAt: string,
  config: InstagramTrendFeedConfig,
): TrendingAudioCandidate | undefined {
  const id = item.id?.trim() || item.platformAudioId?.trim();
  const title = item.title?.trim();
  if (!id || !title) return undefined;

  const popularity = finiteScore(item.popularityScore, Math.max(50, 95 - index * 2));
  const velocity = finiteScore(item.velocityScore, 50);
  const saturation = finiteScore(item.saturationScore, round(clamp100(25 + popularity * 0.65)));
  const tags = new Set<string>(["instagram-reels", "configured-feed", "platform-native"]);
  for (const tag of item.tags ?? []) {
    const normalized = tag.trim().toLowerCase();
    if (normalized) tags.add(normalized);
  }

  return {
    id: `instagram:${id}`,
    platform: "instagram-reels",
    title,
    artist: item.artist?.trim() || undefined,
    capturedAt: safeCapturedAt(item.capturedAt, capturedAt),
    rightsStatus: normalizeRights(item.rightsStatus, config.trustRights),
    popularityScore: popularity,
    velocityScore: velocity,
    saturationScore: saturation,
    tags: [...tags].slice(0, 30),
    source: sourceLabel(config.endpoint),
    platformAudioId: item.platformAudioId?.trim() || undefined,
    previewUrl: item.previewUrl?.trim() || undefined,
    durationSeconds: typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds) && item.durationSeconds > 0
      ? item.durationSeconds
      : undefined,
    rankPosition: typeof item.rankPosition === "number" && Number.isFinite(item.rankPosition) && item.rankPosition > 0
      ? Math.floor(item.rankPosition)
      : index + 1,
  };
}

export function instagramTrendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): InstagramTrendFeedConfig | undefined {
  const endpoint = env.INSTAGRAM_AUDIO_TREND_FEED_URL?.trim();
  if (!endpoint) return undefined;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return undefined;

  const timeoutRaw = Number(env.INSTAGRAM_TREND_TIMEOUT_MS ?? 12000);
  return {
    endpoint: parsedUrl.toString(),
    bearerToken: env.INSTAGRAM_AUDIO_TREND_FEED_TOKEN?.trim() || undefined,
    trustRights: env.INSTAGRAM_TREND_FEED_RIGHTS_TRUSTED?.trim().toLowerCase() === "true",
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60000 ? timeoutRaw : 12000,
  };
}

export async function fetchInstagramTrendFeed(
  config: InstagramTrendFeedConfig,
  now = new Date(),
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AudioTrendSnapshot> {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for Instagram trend feed");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = new Headers({ Accept: "application/json" });
  if (config.bearerToken) headers.set("Authorization", `Bearer ${config.bearerToken}`);

  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, { method: "GET", headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`Instagram trend feed request failed with HTTP ${response.status}`);
  const payload = await response.json() as InstagramFeedPayload;
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.candidates) ? payload.candidates : undefined;
  if (!items || items.length === 0) throw new Error("Instagram trend feed returned no items");

  const capturedAt = safeCapturedAt(payload.capturedAt, now.toISOString());
  const candidates = items
    .map((item, index) => normalizeItem(item, index, capturedAt, config))
    .filter((candidate): candidate is TrendingAudioCandidate => candidate !== undefined);
  if (candidates.length === 0) throw new Error("Instagram trend feed returned items but none had usable ids/titles");

  return { capturedAt, candidates };
}

export function mergeInstagramSnapshot(
  cached: AudioTrendSnapshot | undefined,
  instagram: AudioTrendSnapshot,
): AudioTrendSnapshot {
  const preserved = (cached?.candidates ?? []).filter((candidate) => !candidate.source?.startsWith(SOURCE_PREFIX));
  const deduped = new Map<string, TrendingAudioCandidate>();
  for (const candidate of [...preserved, ...instagram.candidates]) deduped.set(`${candidate.platform}:${candidate.id}`, candidate);
  return { capturedAt: instagram.capturedAt, candidates: [...deduped.values()] };
}

function hasFreshInstagramData(snapshot: AudioTrendSnapshot | undefined, now: Date, refreshHours: number): boolean {
  return Boolean(snapshot?.candidates.some((candidate) =>
    candidate.platform === "instagram-reels" &&
    candidate.source?.startsWith(SOURCE_PREFIX) &&
    hoursOld(candidate.capturedAt, now) <= refreshHours,
  ));
}

export async function refreshInstagramTrendCache(options: {
  cachePath: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  force?: boolean;
}): Promise<InstagramTrendRefreshResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const cached = await readAudioTrendSnapshot(options.cachePath);
  const config = instagramTrendConfigFromEnv(env);

  if (!config) {
    return {
      snapshot: cached,
      status: "not-configured",
      source: "instagram-configured-feed",
      message: "Instagram audio trend feed is not configured; kept cache/fallback behavior.",
      fetchedCandidates: 0,
    };
  }

  const refreshHours = refreshHoursFromEnv(env);
  if (!options.force && hasFreshInstagramData(cached, now, refreshHours)) {
    return {
      snapshot: cached,
      status: "cache-fresh",
      source: "instagram-configured-feed",
      message: `Instagram audio trend cache is newer than ${refreshHours}h; skipped an unnecessary feed call.`,
      fetchedCandidates: 0,
    };
  }

  try {
    const fresh = await fetchInstagramTrendFeed(config, now, options.fetchImpl ?? globalThis.fetch);
    const merged = mergeInstagramSnapshot(cached, fresh);
    await writeAudioTrendSnapshot(options.cachePath, merged);
    return {
      snapshot: merged,
      status: "refreshed",
      source: "instagram-configured-feed",
      message: config.trustRights
        ? "Refreshed Instagram trend feed with explicit trusted rights metadata enabled."
        : "Refreshed Instagram trend feed in discovery-only mode; rights were forced to unknown so tracks cannot auto-publish.",
      fetchedCandidates: fresh.candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cached
      ? {
          snapshot: cached,
          status: "failed-cache",
          source: "instagram-configured-feed",
          message: `Instagram trend feed refresh failed (${message}); kept the previous cache.`,
          fetchedCandidates: 0,
        }
      : {
          status: "failed-no-cache",
          source: "instagram-configured-feed",
          message: `Instagram trend feed refresh failed (${message}) and no cache exists; safe audio fallback remains active.`,
          fetchedCandidates: 0,
        };
  }
}
