import type { AudioTrendSnapshot, TrendingAudioCandidate } from "./audioTrend.ts";
import { readAudioTrendSnapshot, writeAudioTrendSnapshot } from "./trendSource.ts";

export type BundleTikTokTrendDateRange = "1DAY" | "7DAY" | "30DAY";

export interface BundleTikTokTrendConfig {
  apiKey: string;
  endpoint: string;
  teamEndpoint: string;
  teamId?: string;
  teamName?: string;
  genre: string;
  dateRange: BundleTikTokTrendDateRange;
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
type RankValue = number | string | null | undefined;

interface BundleTeam {
  id?: string;
  name?: string;
}

interface BundleTeamListResponse {
  items?: BundleTeam[];
}

interface BundleTrendHistoryPoint {
  date?: string;
  rank_position_daily?: RankValue;
}

interface BundleSongClip {
  song_clip_id?: string;
  preview_url?: string;
  duration?: number;
}

interface BundleCmlTrack {
  commercial_music_id?: string;
  commercial_music_name?: string;
  artist?: string;
  duration?: number;
  thumbnail_url?: string;
  preview_url?: string;
  genres?: string[];
  rank_position?: RankValue;
  trending_history?: BundleTrendHistoryPoint[];
  full_duration_song_clip?: BundleSongClip;
  trending_song_clip?: BundleSongClip;
}

const DEFAULT_ENDPOINT = "https://api.bundle.social/api/v1/misc/tiktok/cml/trending-list";
const DEFAULT_TEAM_ENDPOINT = "https://api.bundle.social/api/v1/team/";
const SOURCE_PREFIX = "bundle-social:tiktok-cml";
const DEFAULT_REFRESH_HOURS = 6;
const MAX_REFRESH_HOURS = 48;

const clamp100 = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function positiveNumber(value: RankValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
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

function semanticTags(genres: string[], velocity: number): string[] {
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
  if (velocity >= 62) tags.add("rising");
  if (velocity >= 78) tags.add("fast-rising");
  return [...tags];
}

function rankPopularity(rank: number): number {
  return round(clamp100(100 - Math.min(90, Math.max(0, rank - 1) * 0.9)));
}

function velocityScore(track: BundleCmlTrack, currentRank: number): number {
  const history = [...(track.trending_history ?? [])]
    .filter((entry) => typeof entry.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((entry) => positiveNumber(entry.rank_position_daily))
    .filter((rank): rank is number => rank !== undefined);

  if (history.length < 2) return 50;
  const first = history[0];
  const latest = history[history.length - 1] || currentRank;
  return round(clamp100(50 + (first - latest) * 1.8));
}

function normalizeTrack(track: BundleCmlTrack, index: number, capturedAt: string): TrendingAudioCandidate | undefined {
  const title = track.commercial_music_name?.trim();
  const clip = track.trending_song_clip ?? track.full_duration_song_clip;
  const platformAudioId = clip?.song_clip_id?.trim();
  if (!title || !platformAudioId) return undefined;

  const rank = positiveNumber(track.rank_position) ?? index + 1;
  const popularity = rankPopularity(rank);
  const velocity = velocityScore(track, rank);
  const genres = Array.isArray(track.genres) ? track.genres.filter((genre): genre is string => typeof genre === "string") : [];
  const duration = clip?.duration ?? track.duration;
  const previewUrl = clip?.preview_url ?? track.preview_url;

  return {
    id: `bundle-tiktok:${platformAudioId}`,
    platform: "tiktok",
    title,
    artist: track.artist?.trim() || undefined,
    capturedAt,
    rightsStatus: "platform-cleared",
    popularityScore: popularity,
    velocityScore: velocity,
    saturationScore: round(clamp100(25 + popularity * 0.65)),
    tags: semanticTags(genres, velocity),
    source: SOURCE_PREFIX,
    sourceContentId: track.commercial_music_id?.trim() || platformAudioId,
    platformAudioId,
    commercialMusicId: track.commercial_music_id?.trim() || undefined,
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : undefined,
    previewUrl: typeof previewUrl === "string" && previewUrl.length > 0 ? previewUrl : undefined,
    rankPosition: rank,
  };
}

export function bundleTikTokTrendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BundleTikTokTrendConfig | undefined {
  const apiKey = env.BUNDLE_SOCIAL_API_KEY?.trim();
  if (!apiKey) return undefined;

  const dateRangeRaw = env.BUNDLE_TIKTOK_TREND_DATE_RANGE?.trim().toUpperCase();
  const dateRange: BundleTikTokTrendDateRange = ["1DAY", "7DAY", "30DAY"].includes(dateRangeRaw ?? "")
    ? dateRangeRaw as BundleTikTokTrendDateRange
    : "7DAY";
  const timeoutRaw = Number(env.BUNDLE_TIKTOK_TREND_TIMEOUT_MS ?? 12000);

  return {
    apiKey,
    endpoint: env.BUNDLE_TIKTOK_TREND_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    teamEndpoint: env.BUNDLE_SOCIAL_TEAM_ENDPOINT?.trim() || DEFAULT_TEAM_ENDPOINT,
    teamId: env.BUNDLE_SOCIAL_TEAM_ID?.trim() || undefined,
    teamName: env.BUNDLE_SOCIAL_TEAM_NAME?.trim() || undefined,
    genre: env.BUNDLE_TIKTOK_TREND_GENRE?.trim().toUpperCase() || "POP",
    dateRange,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60000 ? timeoutRaw : 12000,
  };
}

async function requestJson(
  url: URL,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bundle request to ${url.pathname} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
  }
  return response.json();
}

export async function resolveBundleTeamId(
  config: BundleTikTokTrendConfig,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<string> {
  if (config.teamId) return config.teamId;

  const payload = await requestJson(new URL(config.teamEndpoint), config.apiKey, config.timeoutMs, fetchImpl) as BundleTeamListResponse;
  const teams = Array.isArray(payload.items)
    ? payload.items.filter((team): team is BundleTeam & { id: string } => typeof team.id === "string" && team.id.trim().length > 0)
    : [];

  if (teams.length === 0) throw new Error("Bundle API key is valid but no teams were returned; create or connect a team first");

  if (config.teamName) {
    const wanted = config.teamName.toLowerCase();
    const matches = teams.filter((team) => team.name?.trim().toLowerCase() === wanted);
    if (matches.length === 1) return matches[0].id.trim();
    if (matches.length === 0) throw new Error(`Bundle team '${config.teamName}' was not found`);
    throw new Error(`Bundle team name '${config.teamName}' is ambiguous; set BUNDLE_SOCIAL_TEAM_ID`);
  }

  if (teams.length === 1) return teams[0].id.trim();

  const specsmithMatches = teams.filter((team) => team.name?.trim().toLowerCase() === "specsmith");
  if (specsmithMatches.length === 1) return specsmithMatches[0].id.trim();
  throw new Error("Bundle returned multiple teams; set BUNDLE_SOCIAL_TEAM_ID or BUNDLE_SOCIAL_TEAM_NAME so the CML request targets the right account");
}

export async function fetchBundleTikTokCommercialMusicTrends(
  config: BundleTikTokTrendConfig,
  now = new Date(),
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AudioTrendSnapshot> {
  if (!config.apiKey) throw new Error("Bundle TikTok trend source requires an API key");
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for Bundle TikTok trend source");

  const teamId = await resolveBundleTeamId(config, fetchImpl);
  const url = new URL(config.endpoint);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("genre", config.genre);
  url.searchParams.set("dateRange", config.dateRange);

  const payload = await requestJson(url, config.apiKey, config.timeoutMs, fetchImpl);
  if (!Array.isArray(payload) || payload.length === 0) throw new Error("Bundle TikTok CML returned no tracks for this team/genre/date range");

  const capturedAt = now.toISOString();
  const candidates = (payload as BundleCmlTrack[])
    .map((track, index) => normalizeTrack(track, index, capturedAt))
    .filter((candidate): candidate is TrendingAudioCandidate => candidate !== undefined);

  if (candidates.length === 0) throw new Error("Bundle TikTok CML returned tracks but none had usable title/song_clip_id values");
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
