import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshAllAudioTrendSources } from "./multiTrendSource.ts";

const now = new Date("2026-08-22T23:00:00Z");

function multiPlatformFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));

  if (url.hostname === "business-api.tiktok.com") {
    return Promise.resolve(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        list: [
          {
            commercial_music_id: "tt-commercial",
            commercial_music_name: "TikTok Reveal",
            rank_position: 3,
            genres: ["Electronic"],
            trending_song_clip: { song_clip_id: "tt-audio", duration: 20 },
          },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }

  if (url.hostname === "www.googleapis.com") {
    return Promise.resolve(new Response(JSON.stringify({
      items: [
        {
          id: "yt-video",
          snippet: {
            title: "YouTube Music Trend",
            channelTitle: "Channel",
            publishedAt: "2026-08-22T12:00:00Z",
            tags: ["music", "reveal"],
          },
          statistics: { viewCount: "1000000" },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }

  if (url.hostname === "trends.example.test") {
    return Promise.resolve(new Response(JSON.stringify({
      capturedAt: now.toISOString(),
      items: [
        {
          id: "ig-feed-audio",
          platformAudioId: "ig-native",
          title: "Instagram Reveal",
          popularityScore: 90,
          velocityScore: 92,
          saturationScore: 30,
          rightsStatus: "platform-cleared",
          tags: ["reveal", "game"],
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }

  return Promise.resolve(new Response("not found", { status: 404 }));
}

describe("multi-platform audio trend refresh", () => {
  it("merges TikTok, YouTube, and Instagram without one source overwriting another", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-multi-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const result = await refreshAllAudioTrendSources({
        cachePath,
        now,
        force: true,
        env: {
          TIKTOK_BUSINESS_ACCESS_TOKEN: "tt-secret",
          TIKTOK_BUSINESS_ID: "tt-business",
          YOUTUBE_DATA_API_KEY: "yt-secret",
          INSTAGRAM_AUDIO_TREND_FEED_URL: "https://trends.example.test/instagram",
          INSTAGRAM_TREND_FEED_RIGHTS_TRUSTED: "true",
        },
        fetchImpl: multiPlatformFetch,
      });

      expect(result.sources).toHaveLength(3);
      expect(result.sources.every((source) => source.status === "refreshed")).toBe(true);
      expect(result.refreshedCandidates).toBe(3);
      expect(result.snapshot?.candidates).toHaveLength(3);
      expect(new Set(result.snapshot?.candidates.map((candidate) => candidate.platform))).toEqual(
        new Set(["tiktok", "youtube-shorts", "instagram-reels"]),
      );

      const youtube = result.snapshot?.candidates.find((candidate) => candidate.platform === "youtube-shorts");
      const instagram = result.snapshot?.candidates.find((candidate) => candidate.platform === "instagram-reels");
      expect(youtube?.rightsStatus).toBe("unknown");
      expect(instagram?.rightsStatus).toBe("platform-cleared");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is safe when none of the platform sources are configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-multi-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const result = await refreshAllAudioTrendSources({ cachePath, now, env: {} });
      expect(result.sources).toHaveLength(3);
      expect(result.sources.every((source) => source.status === "not-configured")).toBe(true);
      expect(result.snapshot).toBeUndefined();
      expect(result.refreshedCandidates).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
