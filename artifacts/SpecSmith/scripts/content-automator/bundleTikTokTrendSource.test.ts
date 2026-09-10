import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleTikTokTrendConfigFromEnv,
  fetchBundleTikTokCommercialMusicTrends,
  refreshBundleTikTokTrendCache,
  resolveBundleTeamId,
  type BundleTikTokTrendConfig,
} from "./bundleTikTokTrendSource.ts";

const now = new Date("2026-08-23T00:00:00Z");
const config: BundleTikTokTrendConfig = {
  apiKey: "bundle-test-key",
  endpoint: "https://api.bundle.social/api/v1/misc/tiktok/cml/trending-list",
  teamEndpoint: "https://api.bundle.social/api/v1/team/",
  teamId: "team-123",
  genre: "POP",
  dateRange: "7DAY",
  timeoutMs: 5000,
};

const tracks = [
  {
    commercial_music_id: "music-1",
    commercial_music_name: "Reveal Pop",
    artist: "Artist A",
    duration: 183,
    genres: ["POP"],
    rank_position: "1",
    trending_history: [
      { date: "2026-08-20", rank_position_daily: "8" },
      { date: "2026-08-22", rank_position_daily: "1" },
    ],
    trending_song_clip: { song_clip_id: "clip-1", duration: 25, preview_url: "https://cdn.test/clip-1.mp3" },
  },
  {
    commercial_music_id: "music-2",
    commercial_music_name: "Energy Track",
    artist: "Artist B",
    duration: 150,
    genres: ["ELECTRONIC", "DANCE_POP"],
    rank_position: "2",
    trending_history: [{ date: "2026-08-22", rank_position_daily: "2" }],
    full_duration_song_clip: { song_clip_id: "clip-2", duration: 150 },
  },
];

function successfulFetch(calls: Array<{ url: URL; apiKey?: string }> = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, apiKey: headers.get("x-api-key") ?? undefined });

    if (url.pathname === "/api/v1/team/") {
      return new Response(JSON.stringify({ items: [{ id: "team-123", name: "specsmith" }], total: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/v1/misc/tiktok/cml/trending-list") {
      return new Response(JSON.stringify(tracks), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response("not found", { status: 404 });
  };
}

describe("bundle.social TikTok Commercial Music Library source", () => {
  it("reads current CML configuration safely", () => {
    const resolved = bundleTikTokTrendConfigFromEnv({
      BUNDLE_SOCIAL_API_KEY: "secret",
      BUNDLE_TIKTOK_TREND_GENRE: "hip_hop/rap",
      BUNDLE_TIKTOK_TREND_DATE_RANGE: "30day",
      BUNDLE_SOCIAL_TEAM_NAME: "specsmith",
    });
    expect(resolved?.genre).toBe("HIP_HOP/RAP");
    expect(resolved?.dateRange).toBe("30DAY");
    expect(resolved?.teamName).toBe("specsmith");
    expect(resolved?.endpoint).toContain("/api/v1/misc/tiktok/cml/trending-list");
    expect(bundleTikTokTrendConfigFromEnv({})).toBeUndefined();
  });

  it("discovers the only Bundle team when no team id is configured", async () => {
    const resolvedConfig = { ...config, teamId: undefined };
    const calls: Array<{ url: URL; apiKey?: string }> = [];
    const teamId = await resolveBundleTeamId(resolvedConfig, successfulFetch(calls));
    expect(teamId).toBe("team-123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/api/v1/team/");
    expect(calls[0].apiKey).toBe("bundle-test-key");
  });

  it("uses the documented teamId/genre/dateRange query and normalizes CML tracks", async () => {
    const calls: Array<{ url: URL; apiKey?: string }> = [];
    const snapshot = await fetchBundleTikTokCommercialMusicTrends(config, now, successfulFetch(calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe("bundle-test-key");
    expect(calls[0].url.pathname).toBe("/api/v1/misc/tiktok/cml/trending-list");
    expect(calls[0].url.searchParams.get("teamId")).toBe("team-123");
    expect(calls[0].url.searchParams.get("genre")).toBe("POP");
    expect(calls[0].url.searchParams.get("dateRange")).toBe("7DAY");
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates[0]).toMatchObject({
      platform: "tiktok",
      rightsStatus: "platform-cleared",
      platformAudioId: "clip-1",
      commercialMusicId: "music-1",
      rankPosition: 1,
    });
    expect(snapshot.candidates[0].velocityScore).toBeGreaterThan(50);
  });

  it("keeps cached CML data if Bundle later fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-bundle-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const first = await refreshBundleTikTokTrendCache({
        cachePath,
        now,
        force: true,
        env: { BUNDLE_SOCIAL_API_KEY: "secret", BUNDLE_SOCIAL_TEAM_ID: "team-123" },
        fetchImpl: successfulFetch(),
      });
      expect(first.status).toBe("refreshed");
      expect(first.snapshot?.candidates).toHaveLength(2);

      const failed = await refreshBundleTikTokTrendCache({
        cachePath,
        now: new Date("2026-08-23T12:00:00Z"),
        force: true,
        env: { BUNDLE_SOCIAL_API_KEY: "secret", BUNDLE_SOCIAL_TEAM_ID: "team-123" },
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      });
      expect(failed.status).toBe("failed-cache");
      expect(failed.snapshot?.candidates).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips repeat Bundle calls while its cache is fresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-bundle-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    let calls = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return successfulFetch()(input, init);
    };
    try {
      await refreshBundleTikTokTrendCache({
        cachePath,
        now,
        force: true,
        env: { BUNDLE_SOCIAL_API_KEY: "secret", BUNDLE_SOCIAL_TEAM_ID: "team-123", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      const second = await refreshBundleTikTokTrendCache({
        cachePath,
        now: new Date("2026-08-23T02:00:00Z"),
        env: { BUNDLE_SOCIAL_API_KEY: "secret", BUNDLE_SOCIAL_TEAM_ID: "team-123", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      expect(second.status).toBe("cache-fresh");
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
