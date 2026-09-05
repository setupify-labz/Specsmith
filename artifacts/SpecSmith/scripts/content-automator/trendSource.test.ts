import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchTikTokCommercialMusicTrends,
  readAudioTrendSnapshot,
  refreshAudioTrendCache,
  tiktokTrendConfigFromEnv,
  type TikTokTrendSourceConfig,
} from "./trendSource.ts";

const now = new Date("2026-08-22T23:00:00Z");

const config: TikTokTrendSourceConfig = {
  accessToken: "test-token",
  businessId: "open-id-123",
  countryCode: "US",
  genre: "ALL",
  dateRange: "7DAY",
  endpoint: "https://business-api.tiktok.com/open_api/v1.3/discovery/cml/trending_list/",
  timeoutMs: 5000,
};

function successfulFetch(calls: { url?: URL; init?: RequestInit }[] = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        list: [
          {
            commercial_music_id: "commercial-1",
            commercial_music_name: "Voltage Drop",
            artist: "Test Artist",
            duration: 30,
            genres: ["Electronic"],
            rank_position: 4,
            trending_history: [
              { date: "2026-08-18", rank_position_daily: 19, views_daily: 100000 },
              { date: "2026-08-22", rank_position_daily: 4, views_daily: 180000 },
            ],
            trending_song_clip: {
              song_clip_id: "sound-123",
              duration: 24,
              preview_url: "https://example.test/preview.mp3",
            },
          },
          {
            commercial_music_id: "commercial-2",
            commercial_music_name: "Clean Reveal",
            genres: ["Pop"],
            rank_position: "12",
            trending_history: [
              { date: "2026-08-18", rank_position_daily: 16 },
              { date: "2026-08-22", rank_position_daily: 12 },
            ],
            full_duration_song_clip: { song_clip_id: "sound-456", duration: 20 },
          },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

describe("audio trend source", () => {
  it("reads TikTok credentials from environment without hardcoding secrets", () => {
    const resolved = tiktokTrendConfigFromEnv({
      TIKTOK_BUSINESS_ACCESS_TOKEN: "secret",
      TIKTOK_BUSINESS_ID: "business-open-id",
      TIKTOK_TREND_COUNTRY: "ca",
      TIKTOK_TREND_DATE_RANGE: "30day",
    });
    expect(resolved?.countryCode).toBe("CA");
    expect(resolved?.dateRange).toBe("30DAY");
    expect(tiktokTrendConfigFromEnv({})).toBeUndefined();
  });

  it("fetches the official CML endpoint and normalizes publishable platform audio ids", async () => {
    const calls: { url?: URL; init?: RequestInit }[] = [];
    const snapshot = await fetchTikTokCommercialMusicTrends(config, now, successfulFetch(calls));

    expect(calls).toHaveLength(1);
    expect(calls[0].url?.pathname).toContain("/discovery/cml/trending_list/");
    expect(calls[0].url?.searchParams.get("business_id")).toBe("open-id-123");
    expect(calls[0].url?.searchParams.get("country_code")).toBe("US");
    expect(new Headers(calls[0].init?.headers).get("Access-Token")).toBe("test-token");

    expect(snapshot.candidates).toHaveLength(2);
    const first = snapshot.candidates[0];
    expect(first.platform).toBe("tiktok");
    expect(first.rightsStatus).toBe("platform-cleared");
    expect(first.platformAudioId).toBe("sound-123");
    expect(first.id).toBe("tiktok:sound-123");
    expect(first.source).toContain("tiktok-business-api:cml");
    expect(first.tags).toContain("reveal");
    expect(first.velocityScore).toBeGreaterThan(50);
    expect(first.popularityScore).toBeGreaterThan(80);
  });

  it("keeps a previous cache when the live source fails instead of erasing trend data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const first = await refreshAudioTrendCache({
        cachePath,
        now,
        force: true,
        env: {
          TIKTOK_BUSINESS_ACCESS_TOKEN: "secret",
          TIKTOK_BUSINESS_ID: "business-open-id",
        },
        fetchImpl: successfulFetch(),
      });
      expect(first.status).toBe("refreshed");
      expect(first.snapshot?.candidates.length).toBe(2);

      const failed = await refreshAudioTrendCache({
        cachePath,
        now: new Date("2026-08-23T12:00:00Z"),
        force: true,
        env: {
          TIKTOK_BUSINESS_ACCESS_TOKEN: "secret",
          TIKTOK_BUSINESS_ID: "business-open-id",
        },
        fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
      });
      expect(failed.status).toBe("failed-cache");
      expect(failed.snapshot?.candidates.length).toBe(2);
      expect((await readAudioTrendSnapshot(cachePath))?.candidates.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not call the API again while the official TikTok cache is still fresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    let calls = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return successfulFetch()(input, init);
    };
    try {
      await refreshAudioTrendCache({
        cachePath,
        now,
        force: true,
        env: {
          TIKTOK_BUSINESS_ACCESS_TOKEN: "secret",
          TIKTOK_BUSINESS_ID: "business-open-id",
          AUDIO_TREND_REFRESH_HOURS: "6",
        },
        fetchImpl,
      });
      const second = await refreshAudioTrendCache({
        cachePath,
        now: new Date("2026-08-23T01:00:00Z"),
        env: {
          TIKTOK_BUSINESS_ACCESS_TOKEN: "secret",
          TIKTOK_BUSINESS_ID: "business-open-id",
          AUDIO_TREND_REFRESH_HOURS: "6",
        },
        fetchImpl,
      });
      expect(second.status).toBe("cache-fresh");
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
