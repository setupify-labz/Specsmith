import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleTikTokTrendConfigFromEnv,
  fetchBundleTikTokCommercialMusicTrends,
  refreshBundleTikTokTrendCache,
  type BundleTikTokTrendConfig,
} from "./bundleTikTokTrendSource.ts";

const now = new Date("2026-08-23T00:00:00Z");
const config: BundleTikTokTrendConfig = {
  apiKey: "bundle-test-key",
  endpoint: "https://api.bundle.social/api/v1/music/tiktok/trending",
  genre: "pop",
  limit: 20,
  timeoutMs: 5000,
};

function successfulFetch(calls: Array<{ url: URL; apiKey?: string }> = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ url: new URL(String(input)), apiKey: headers.get("x-api-key") ?? undefined });
    return new Response(JSON.stringify({
      songs: [
        { id: "clip-1", title: "Reveal Pop", artist: "Artist A", duration: 25, genre: "pop" },
        { id: "clip-2", title: "Energy Track", artist: "Artist B", duration: 30, genre: ["dance", "pop"] },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

describe("bundle.social TikTok Commercial Music Library source", () => {
  it("reads configuration from the secret and clamps limits", () => {
    const resolved = bundleTikTokTrendConfigFromEnv({
      BUNDLE_SOCIAL_API_KEY: "secret",
      BUNDLE_TIKTOK_TREND_GENRE: "hiphop",
      BUNDLE_TIKTOK_TREND_LIMIT: "999",
    });
    expect(resolved?.genre).toBe("hiphop");
    expect(resolved?.limit).toBe(100);
    expect(bundleTikTokTrendConfigFromEnv({})).toBeUndefined();
  });

  it("uses x-api-key and normalizes CML songs as platform-cleared TikTok audio", async () => {
    const calls: Array<{ url: URL; apiKey?: string }> = [];
    const snapshot = await fetchBundleTikTokCommercialMusicTrends(config, now, successfulFetch(calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe("bundle-test-key");
    expect(calls[0].url.searchParams.get("genre")).toBe("pop");
    expect(calls[0].url.searchParams.get("limit")).toBe("20");
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates[0]).toMatchObject({
      platform: "tiktok",
      rightsStatus: "platform-cleared",
      platformAudioId: "clip-1",
      rankPosition: 1,
    });
  });

  it("keeps cached CML data if Bundle later fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-bundle-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const first = await refreshBundleTikTokTrendCache({
        cachePath,
        now,
        force: true,
        env: { BUNDLE_SOCIAL_API_KEY: "secret" },
        fetchImpl: successfulFetch(),
      });
      expect(first.status).toBe("refreshed");
      expect(first.snapshot?.candidates).toHaveLength(2);

      const failed = await refreshBundleTikTokTrendCache({
        cachePath,
        now: new Date("2026-08-23T12:00:00Z"),
        force: true,
        env: { BUNDLE_SOCIAL_API_KEY: "secret" },
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
        env: { BUNDLE_SOCIAL_API_KEY: "secret", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      const second = await refreshBundleTikTokTrendCache({
        cachePath,
        now: new Date("2026-08-23T02:00:00Z"),
        env: { BUNDLE_SOCIAL_API_KEY: "secret", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      expect(second.status).toBe("cache-fresh");
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
