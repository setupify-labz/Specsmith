import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AudioTrendSnapshot, TrendingAudioCandidate } from "./audioTrend.ts";

export type TikTokTrendDateRange = "1DAY" | "7DAY" | "30DAY" | "90DAY";

export interface TikTokTrendSourceConfig {
  accessToken: string;
  businessId: string;
  countryCode: string;
  genre: string;
  dateRange: TikTokTrendDateRange;
  endpoint: string;
  timeoutMs: number;
}

export interface TrendRefreshResult {
  snapshot?: AudioTrendSnapshot;
  status: "refreshed" | "cache-fresh" | "not-configured" | "failed-cache" | "failed-no-cache";
  source: "tiktok-cml";
  message: string;
  fetchedCandidates: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TikTokRankValue = number | string | null | undefined;

interface TikTokTrendingHistoryPoint {
  date?: string;
  rank_position_daily?: TikTokRankValue;
  views_daily?: number | string | null;
}

interface TikTokSongClip {
  song_clip_id?: string;
  preview_url?: string;
  duration?: number;
}

interface TikTokCommercialMusicTrack {
  commercial_music_id?: string;
  commercial_music_name?: string;
  artist?: string;
  duration?: number;
  preview_url?: string;
  genres?: string[];
  rank_position?: TikTokRankValue;
  trending_history?: TikTokTrendingHistoryPoint[];
  full_duration_song_clip?: TikTokSongClip;
  trending_song_clip?: TikTokSongClip;
}

interface TikTokCmlResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    list?: TikTokCommercialMusicTrack[];
  };
}

const DEFAULT_ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/discovery/cml/trending_list/";
const OFFICIAL_SOURCE_PREFIX = "tiktok-business-api:cml";
const DEFAULT_REFRESH_HOURS = 6;
const MAX_REFRESH_HOURS = 48;

const clamp100 = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function positiveNumber(value: TikTokRankValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function nonNegativeNumber(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function rankPopularity(rank: number): number {
  return round(clamp100(100 - Math.min(90, Math.max(0, rank - 1) * 0.9)));
}

function sortedHistory(track: TikTokCommercialMusicTrack): TikTokTrendingHistoryPoint[] {
  return [...(track.trending_history ?? [])]
    .filter((entry) => typeof entry.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function velocityScore(track: TikTokCommercialMusicTrack, currentRank: number): number {
  const history = sortedHistory(track);
  const ranked = history
    .map((entry) => ({ rank: positiveNumber(entry.rank_position_daily), views: nonNegativeNumber(entry.views_daily) }))
    .filter((entry): entry is { rank: number; views: number | undefined } => entry.rank !== undefined);

  if (ranked.length === 0) return 50;

  const previous = ranked[0];
  const latest = ranked[ranked.length - 1];
  const comparisonRank = latest.rank || currentRank;
  const rankDelta = previous.rank - comparisonRank;
  const rankComponent = clamp100(50 + rankDelta * 1.8);

  const viewed = history
    .map((entry) => nonNegativeNumber(entry.views_daily))
    .filter((value): value is number => value !== undefined && value > 0);
  if (viewed.length < 2) return round(rankComponent);

  const firstViews = viewed[0];
  const lastViews = viewed[viewed.length - 1];
  const relativeChange = (lastViews - firstViews) / Math.max(firstViews, 1);
  const viewComponent = clamp100(50 + Math.max(-1, Math.min(1, relativeChange)) * 35);
  return round(rankComponent * 0.7 + viewComponent * 0.3);
}

function saturationScore(popularityScore: number): number {
  // TikTok does not expose a direct "saturation" metric here. Treat rank/popularity only as a
  // conservative proxy so highly ubiquitous tracks receive a small diversity penalty downstream.
  return round(clamp100(25 + popularityScore * 0.65));
}

function semanticTags(genres: string[], velocity: number): string[] {
  const tags = new Set<string>(["trending", "commercial-music", "platform-native"]);
  for (const genre of genres) {
    const normalized = genre.trim().toLowerCase();
    if (!normalized) continue;
    tags.add(normalized);
    if (/electronic|edm|dance|house|techno/.test(normalized)) {
      ["energy", "drop", "impact", "reveal", "game"].forEach((tag) => tags.add(tag));
    }
    if (/hip.?hop|rap|trap/.test(normalized)) {
      ["impact", "tension", "confidence", "reveal"].forEach((tag) => tags.add(tag));
    }
    if (/pop/.test(normalized)) {
      ["upbeat", "clean", "reveal"].forEach((tag) => tags.add(tag));
    }
    if (/rock|metal/.test(normalized)) {
      ["energy", "impact", "tension"].forEach((tag) => tags.add(tag));
    }
    if (/cinematic|soundtrack|orchestral/.test(normalized)) {
      ["tension", "dramatic", "reveal", "build"].forEach((tag) => tags.add(tag));
    }
    if (/ambient|lofi|lo-fi|chill/.test(normalized)) {
      ["calm", "clean", "background"].forEach((tag) => tags.add(tag));
    }
  }
  if (velocity >= 62) tags.add("rising");
  if (velocity >= 78) tags.add("fast-rising");
  return [...tags];
}

function normalizeTrack(
  track: TikTokCommercialMusicTrack,
  index: number,
  capturedAt: string,
  config: TikTokTrendSourceConfig,
): TrendingAudioCandidate | undefined {
  const title = track.commercial_music_name?.trim();
  const commercialMusicId = track.commercial_music_id?.trim();
  const songClip = track.trending_song_clip ?? track.full_duration_song_clip;
  const platformAudioId = songClip?.song_clip_id?.trim() || commercialMusicId;
  if (!title || !platformAudioId) return undefined;

  const rank = positiveNumber(track.rank_position) ?? index + 1;
  const popularity = rankPopularity(rank);
  const velocity = velocityScore(track, rank);
  const genres = Array.isArray(track.genres) ? track.genres.filter((genre): genre is string => typeof genre === "string") : [];
  const duration = songClip?.duration ?? track.duration;
  const previewUrl = songClip?.preview_url ?? track.preview_url;

  return {
    id: `tiktok:${platformAudioId}`,
    platform: "tiktok",
    title,
    artist: track.artist?.trim() || undefined,
    capturedAt,
    rightsStatus: "platform-cleared",
    popularityScore: popularity,
    velocityScore: velocity,
    saturationScore: saturationScore(popularity),
    tags: semanticTags(genres, velocity),
    source: `${OFFICIAL_SOURCE_PREFIX}:${config.countryCode}:${config.dateRange}`,
    platformAudioId,
    commercialMusicId,
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : undefined,
    previewUrl: typeof previewUrl === "string" && previewUrl.length > 0 ? previewUrl : undefined,
    region: config.countryCode,
    rankPosition: rank,
  };
}

export function tiktokTrendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TikTokTrendSourceConfig | undefined {
  const accessToken = env.TIKTOK_BUSINESS_ACCESS_TOKEN?.trim();
  const businessId = env.TIKTOK_BUSINESS_ID?.trim();
  if (!accessToken || !businessId) return undefined;

  const dateRangeRaw = env.TIKTOK_TREND_DATE_RANGE?.trim().toUpperCase();
  const dateRange: TikTokTrendDateRange = ["1DAY", "7DAY", "30DAY", "90DAY"].includes(dateRangeRaw ?? "")
    ? dateRangeRaw as TikTokTrendDateRange
    : "7DAY";

  const timeout = Number(env.TIKTOK_TREND_TIMEOUT_MS ?? 12000);
  return {
    accessToken,
    businessId,
    countryCode: env.TIKTOK_TREND_COUNTRY?.trim().toUpperCase() || "US",
    genre: env.TIKTOK_TREND_GENRE?.trim().toUpperCase() || "ALL",
    dateRange,
    endpoint: env.TIKTOK_TREND_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 60000 ? timeout : 12000,
  };
}

export async function fetchTikTokCommercialMusicTrends(
  config: TikTokTrendSourceConfig,
  now = new Date(),
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AudioTrendSnapshot> {
  if (!config.accessToken || !config.businessId) throw new Error("TikTok trend source requires accessToken and businessId");
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for TikTok trend source");

  const url = new URL(config.endpoint);
  url.searchParams.set("business_id", config.businessId);
  url.searchParams.set("country_code", config.countryCode);
  url.searchParams.set("genre", config.genre);
  url.searchParams.set("date_range", config.dateRange);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Access-Token": config.accessToken,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`TikTok CML trend request failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as TikTokCmlResponse;
  if (payload.code !== 0) {
    throw new Error(`TikTok CML trend API error ${payload.code ?? "unknown"}: ${payload.message ?? "unknown error"}`);
  }

  const tracks = payload.data?.list;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error("TikTok CML trend API returned no tracks");
  }

  const capturedAt = now.toISOString();
  const candidates = tracks
    .map((track, index) => normalizeTrack(track, index, capturedAt, config))
    .filter((candidate): candidate is TrendingAudioCandidate => candidate !== undefined);

  if (candidates.length === 0) {
    throw new Error("TikTok CML trend API returned tracks but none had a usable title/audio id");
  }

  return { capturedAt, candidates };
}

export function mergeTikTokSnapshot(
  cached: AudioTrendSnapshot | undefined,
  tiktok: AudioTrendSnapshot,
): AudioTrendSnapshot {
  const preserved = (cached?.candidates ?? []).filter((candidate) => !candidate.source?.startsWith(OFFICIAL_SOURCE_PREFIX));
  const deduped = new Map<string, TrendingAudioCandidate>();
  for (const candidate of [...preserved, ...tiktok.candidates]) {
    deduped.set(`${candidate.platform}:${candidate.id}`, candidate);
  }
  return {
    capturedAt: tiktok.capturedAt,
    candidates: [...deduped.values()],
  };
}

export async function readAudioTrendSnapshot(cachePath: string): Promise<AudioTrendSnapshot | undefined> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AudioTrendSnapshot>;
    if (typeof parsed.capturedAt !== "string" || !Array.isArray(parsed.candidates)) {
      throw new Error("audio trend cache must contain { capturedAt, candidates[] }");
    }
    return parsed as AudioTrendSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeAudioTrendSnapshot(cachePath: string, snapshot: AudioTrendSnapshot): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, cachePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

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

function hasFreshOfficialTikTokData(snapshot: AudioTrendSnapshot | undefined, now: Date, refreshHours: number): boolean {
  if (!snapshot) return false;
  return snapshot.candidates.some((candidate) =>
    candidate.platform === "tiktok" &&
    candidate.source?.startsWith(OFFICIAL_SOURCE_PREFIX) &&
    hoursOld(candidate.capturedAt, now) <= refreshHours,
  );
}

export async function refreshAudioTrendCache(options: {
  cachePath: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  force?: boolean;
}): Promise<TrendRefreshResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const cached = await readAudioTrendSnapshot(options.cachePath);
  const config = tiktokTrendConfigFromEnv(env);

  if (!config) {
    return {
      snapshot: cached,
      status: "not-configured",
      source: "tiktok-cml",
      message: "TikTok trend source is not configured; using the existing cache/original-audio fallback.",
      fetchedCandidates: 0,
    };
  }

  const refreshHours = refreshHoursFromEnv(env);
  if (!options.force && hasFreshOfficialTikTokData(cached, now, refreshHours)) {
    return {
      snapshot: cached,
      status: "cache-fresh",
      source: "tiktok-cml",
      message: `TikTok trend cache is newer than ${refreshHours}h; skipped an unnecessary API call.`,
      fetchedCandidates: 0,
    };
  }

  try {
    const fresh = await fetchTikTokCommercialMusicTrends(config, now, options.fetchImpl ?? globalThis.fetch);
    const merged = mergeTikTokSnapshot(cached, fresh);
    await writeAudioTrendSnapshot(options.cachePath, merged);
    return {
      snapshot: merged,
      status: "refreshed",
      source: "tiktok-cml",
      message: `Refreshed TikTok Commercial Music Library trends for ${config.countryCode}/${config.dateRange}.`,
      fetchedCandidates: fresh.candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached) {
      return {
        snapshot: cached,
        status: "failed-cache",
        source: "tiktok-cml",
        message: `Live TikTok trend refresh failed (${message}); kept the previous cache instead of guessing.`,
        fetchedCandidates: 0,
      };
    }
    return {
      status: "failed-no-cache",
      source: "tiktok-cml",
      message: `Live TikTok trend refresh failed (${message}) and no cache exists; audio selector will use safe original/licensed audio.`,
      fetchedCandidates: 0,
    };
  }
}
