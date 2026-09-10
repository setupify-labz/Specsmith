import type { AudioTrendSnapshot } from "./audioTrend.ts";
import { refreshBundleTikTokTrendCache, type BundleTikTokTrendRefreshResult } from "./bundleTikTokTrendSource.ts";
import { refreshInstagramTrendCache, type InstagramTrendRefreshResult } from "./instagramTrendSource.ts";
import { readAudioTrendSnapshot, refreshAudioTrendCache, type TrendRefreshResult } from "./trendSource.ts";
import { refreshYouTubeTrendCache, type YouTubeTrendRefreshResult } from "./youtubeTrendSource.ts";

export type PlatformTrendRefreshResult =
  | TrendRefreshResult
  | BundleTikTokTrendRefreshResult
  | YouTubeTrendRefreshResult
  | InstagramTrendRefreshResult;

export interface MultiTrendRefreshResult {
  snapshot?: AudioTrendSnapshot;
  sources: PlatformTrendRefreshResult[];
  refreshedCandidates: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function refreshAllAudioTrendSources(options: {
  cachePath: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  force?: boolean;
}): Promise<MultiTrendRefreshResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const shared = {
    cachePath: options.cachePath,
    now,
    env,
    fetchImpl: options.fetchImpl,
    force: options.force,
  };

  // These intentionally run sequentially because every source atomically merges into the same cache.
  // Parallel writes would risk one platform overwriting another platform's freshly fetched candidates.
  const tiktok = await refreshAudioTrendCache(shared);

  // Prefer TikTok's direct Business API when it is healthy. Bundle is the fallback for accounts that
  // cannot complete TikTok Business verification yet, and also a backup if the direct source fails.
  const bundleTikTok = tiktok.status === "refreshed" || tiktok.status === "cache-fresh"
    ? undefined
    : await refreshBundleTikTokTrendCache(shared);

  const youtube = await refreshYouTubeTrendCache(shared);
  const instagram = await refreshInstagramTrendCache(shared);
  const snapshot = await readAudioTrendSnapshot(options.cachePath);

  const sources: PlatformTrendRefreshResult[] = [
    tiktok,
    ...(bundleTikTok ? [bundleTikTok] : []),
    youtube,
    instagram,
  ];
  return {
    snapshot: snapshot ?? instagram.snapshot ?? youtube.snapshot ?? bundleTikTok?.snapshot ?? tiktok.snapshot,
    sources,
    refreshedCandidates: sources.reduce((sum, source) => sum + source.fetchedCandidates, 0),
  };
}
