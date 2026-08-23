import type { AudioTrendSnapshot, TrendingAudioCandidate } from "./audioTrend.ts";
import { readAudioTrendSnapshot, writeAudioTrendSnapshot } from "./trendSource.ts";

export interface BundleTikTokTrendConfig {
  apiKey: string;
  endpoint: string;
  genre?: string;
  limit: number;
  timeoutMs: number;
}

export interface BundleTikTokTrendRefreshResult {
  snapshot?: AudioTrendSnapshot;
  status: "refreshed" | "cache-fresh" | "not-configured" | "failed-cache" | "failed-no-cache";
  source: "bundle-social-tiktok-cml";
  message: string;
  fetchedCandidates: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface BundleSong {
  id?: string;
  title?: string;
  artist?: string;
  duration?: number;
  genre?: string | string[];
}

interface BundleTrendingResponse {
  songs?: BundleSong[];
  error?: string;
  message?: string;
}

const DEFAULT_ENDPOINT = "https://api.bundle.social/api/v1/music/tiktok/trending";
const SOURCE_PREFIX = "bundle-social:tiktok-cml";
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

function tagsForGenre(genreValue: string | string[] | undefined): string[] {
  const genres = Array.isArray(genreValue) ? genreValue : genreValue ? [genreValue] : [];
  const tags = new Set<string>(["trending", "commercial-music", "platform-native"]);
  for (const genre of genres) {
    const normalized = genre.trim().toLowerCase();
    if (!normalized) continue;
    tags.add(normalized);
    if (/electronic|edm|dance|house|techno/.test(normalized)) ["energy", "drop", "impact", "reveal", "game"].forEach((tag) => tags.add(tag));
    if (/hip.?hop|rap|trap/.test(normalized)) ["impact", "tension", "confidence", "reveal"].forEach((tag) => tags.add(tag));
    if (/pop/.test(normalized)) ["upbeat", "clean", "reveal"].forEach((tag) => tags.add(tag));
    if (/rock|metal/.test(normalized)) ["energy", "impact", "tension"].forEach((tag) => tags.add(tag));
    if (/ambient|lofi|lo-fi|chill/.test(normalized)) ["calm", "clean", "background"].forEach((tag) => tags.add(tag));
  }
  return [...tags];
}

function normalizeSong(song: BundleSong, index: number, total: number, capturedAt: string): TrendingAudioCandidate | undefined {
  const platformAudioId = song.id?.trim();
  const title = song.title?.trim();
  if (!platformAudioId || !title) return undefined;

  // Bundle's public endpoint documents ordered trending songs but does not expose a direct
  // velocity/saturation metric. Keep those signals conservative rather than inventing precision.
  const rankPosition = index + 1;
  const popularityScore = total <= 1 ? 100 : round(clamp100(100 - (index / Math.max(total - 1, 1)) * 45));
  const velocityScore = 60;
  const saturationScore = round(clamp100(25 + popularityScore * 0.55));

  return {
    id: `bundle-tiktok:${platformAudioId}`,
    platform: "tiktok",
    title,
    artist: song.artist?.trim() || undefined,
    capturedAt,
    rightsStatus: "platform-cleared",
    popularityScore,
    velocityScore,
    saturationScore,
    tags: tagsForGenre(song.genre),
    source: SOURCE_PREFIX,
    sourceContentId: platformAudioId,
    platformAudioId,
    durationSeconds: typeof song.duration === "number" && Number.isFinite(song.duration) && song.duration > 0 ? song.duration : undefined,
    rankPosition,
  };
}

export function bundleTikTokTrendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BundleTikTokTrendConfig | undefined {
  const apiKey = env.BUNDLE_SOCIAL_API_KEY?.trim();
  if (!apiKey) return undefined;

  const limitRaw = Number(env.BUNDLE_TIKTOK_TREND_LIMIT ?? 30);
  const timeoutRaw = Number(env.BUNDLE_TIKTOK_TREND_TIMEOUT_MS ?? 12000);
  return {
    apiKey,
    endpoint: env.BUNDLE_TIKTOK_TREND_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    genre: env.BUNDLE_TIKTOK_TREND_GENRE?.trim() || undefined,
    limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60000 ? timeoutRaw : 12000,
  };
}

export async function fetchBundleTikTokCommercialMusicTrends(
  config: BundleTikTokTrendConfig,
  now = new Date(),
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AudioTrendSnapshot> {
  if (!config.apiKey) throw new Error("Bundle TikTok trend source requires an API key");
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for Bundle TikTok trend source");

  const url = new URL(config.endpoint);
  url.searchParams.set("limit", String(config.limit));
  if (config.genre) url.searchParams.set("genre", config.genre);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "x-api-key": config.apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bundle TikTok CML request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
  }

  const payload = await response.json() as BundleTrendingResponse;
  if (payload.error) throw new Error(`Bundle TikTok CML API error: ${payload.error}`);
  const songs = payload.songs;
  if (!Array.isArray(songs) || songs.length === 0) {
    throw new Error(payload.message ? `Bundle TikTok CML returned no songs: ${payload.message}` : "Bundle TikTok CML returned no songs");
  }

  const capturedAt = now.toISOString();
  const candidates = songs
    .map((song, index) => normalizeSong(song, index, songs.length, capturedAt))
    .filter((candidate): candidate is TrendingAudioCandidate => candidate !== undefined);

  if (candidates.length === 0) throw new Error("Bundle TikTok CML returned songs but none had usable ids/titles");
  return { capturedAt, candidates };
}

export function mergeBundleTikTokSnapshot(
  cached: AudioTrendSnapshot | undefined,
  bundle: AudioTrendSnapshot,
): AudioTrendSnapshot {
  const incomingIds = new Set(bundle.candidates.map((candidate) => candidate.platformAudioId).filter(Boolean));
  const preserved = (cached?.candidates ?? []).filter((candidate) => {
    if (candidate.source?.startsWith(SOURCE_PREFIX)) return false;
    if (candidate.platform === "tiktok" && candidate.platformAudioId && incomingIds.has(candidate.platformAudioId)) return false;
    return true;
  });
  return { capturedAt: bundle.capturedAt, candidates: [...preserved, ...bundle.candidates] };
}

function hasFreshBundleTikTokData(snapshot: AudioTrendSnapshot | undefined, now: Date, refreshHours: number): boolean {
  return Boolean(snapshot?.candidates.some((candidate) =>
    candidate.platform === "tiktok" &&
    candidate.source?.startsWith(SOURCE_PREFIX) &&
    hoursOld(candidate.capturedAt, now) <= refreshHours,
  ));
}

export async function refreshBundleTikTokTrendCache(options: {
  cachePath: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  force?: boolean;
}): Promise<BundleTikTokTrendRefreshResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const cached = await readAudioTrendSnapshot(options.cachePath);
  const config = bundleTikTokTrendConfigFromEnv(env);

  if (!config) {
    return {
      snapshot: cached,
      status: "not-configured",
      source: "bundle-social-tiktok-cml",
      message: "Bundle TikTok CML source is not configured; kept existing TikTok cache/fallback behavior.",
      fetchedCandidates: 0,
    };
  }

  const refreshHours = refreshHoursFromEnv(env);
  if (!options.force && hasFreshBundleTikTokData(cached, now, refreshHours)) {
    return {
      snapshot: cached,
      status: "cache-fresh",
      source: "bundle-social-tiktok-cml",
      message: `Bundle TikTok CML cache is newer than ${refreshHours}h; skipped an unnecessary API call.`,
      fetchedCandidates: 0,
    };
  }

  try {
    const fresh = await fetchBundleTikTokCommercialMusicTrends(config, now, options.fetchImpl ?? globalThis.fetch);
    const merged = mergeBundleTikTokSnapshot(cached, fresh);
    await writeAudioTrendSnapshot(options.cachePath, merged);
    return {
      snapshot: merged,
      status: "refreshed",
      source: "bundle-social-tiktok-cml",
      message: `Refreshed ${fresh.candidates.length} TikTok Commercial Music Library tracks through bundle.social.`,
      fetchedCandidates: fresh.candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cached
      ? {
          snapshot: cached,
          status: "failed-cache",
          source: "bundle-social-tiktok-cml",
          message: `Bundle TikTok CML refresh failed (${message}); kept the previous cache.`,
          fetchedCandidates: 0,
        }
      : {
          status: "failed-no-cache",
          source: "bundle-social-tiktok-cml",
          message: `Bundle TikTok CML refresh failed (${message}) and no cache exists; safe audio fallback remains active.`,
          fetchedCandidates: 0,
        };
  }
}
