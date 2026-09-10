import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectAudioForIdea } from "./audioTrend.ts";
import {
  fetchYouTubeMusicChart,
  refreshYouTubeTrendCache,
  youtubeTrendConfigFromEnv,
  type YouTubeTrendSourceConfig,
} from "./youtubeTrendSource.ts";
import type { ContentIdea } from "./types.ts";

const now = new Date("2026-08-22T23:00:00Z");

const config: YouTubeTrendSourceConfig = {
  apiKey: "test-key",
  regionCode: "US",
  maxResults: 25,
  endpoint: "https://www.googleapis.com/youtube/v3/videos",
  timeoutMs: 5000,
};

const idea: ContentIdea = {
  id: "yt-audio-test",
  format: "game",
  title: "Can you beat SpecSmith's GPU Price Guesser?",
  hook: "Lock your price before the reveal.",
  angle: "Fast countdown and reveal.",
  targetAudience: "PC buyers",
  requiredFacts: [],
  subjectIds: [],
  productConnection: {
    feature: "price-guesser",
    route: "/price-guesser",
    userProblem: "Prices change.",
    whySpecSmith: "SpecSmith powers the game.",
    continuationAction: "Play another round.",
    sitePayoff: "Continue on SpecSmith.",
  },
  creativeDNA: {
    conceptName: "Price Lock",
    visualWorld: "Price Guesser Countdown",
    narrativeEngine: "guess -> tension -> reveal",
    openingImage: "GPU on screen",
    patternInterrupt: "timer",
    retentionBeats: ["guess", "reveal"],
    payoff: "price reveal",
    audioDirection: "Countdown tension then reveal impact",
    originalityConstraint: "Fit the game",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 9,
    visualPotential: 9,
    purchaseIntent: 8,
    novelty: 9,
    originality: 9,
    retentionPotential: 9,
    shareability: 9,
    productFit: 10,
    siteContinuation: 10,
    total: 9.1,
  },
};

function successfulFetch(calls: URL[] = []) {
  return async (input: string | URL | Request): Promise<Response> => {
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify({
      items: [
        {
          id: "video-1",
          snippet: {
            title: "Big Reveal Track",
            channelTitle: "Music Channel",
            publishedAt: "2026-08-21T20:00:00Z",
            categoryId: "10",
            tags: ["music", "reveal", "countdown"],
          },
          statistics: { viewCount: "900000", likeCount: "12000" },
        },
        {
          id: "video-2",
          snippet: {
            title: "Second Track",
            channelTitle: "Another Channel",
            publishedAt: "2026-08-20T20:00:00Z",
            categoryId: "10",
            tags: ["music", "energy"],
          },
          statistics: { viewCount: "500000" },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

describe("YouTube trend discovery source", () => {
  it("reads API configuration safely and clamps max results", () => {
    const resolved = youtubeTrendConfigFromEnv({
      YOUTUBE_DATA_API_KEY: "secret",
      YOUTUBE_TREND_REGION: "ca",
      YOUTUBE_TREND_MAX_RESULTS: "999",
    });
    expect(resolved?.regionCode).toBe("CA");
    expect(resolved?.maxResults).toBe(50);
    expect(youtubeTrendConfigFromEnv({})).toBeUndefined();
  });

  it("requests the official mostPopular Music chart and normalizes it as discovery-only", async () => {
    const calls: URL[] = [];
    const snapshot = await fetchYouTubeMusicChart(config, now, successfulFetch(calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get("chart")).toBe("mostPopular");
    expect(calls[0].searchParams.get("videoCategoryId")).toBe("10");
    expect(calls[0].searchParams.get("regionCode")).toBe("US");
    expect(calls[0].searchParams.get("key")).toBe("test-key");
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates[0].platform).toBe("youtube-shorts");
    expect(snapshot.candidates[0].rightsStatus).toBe("unknown");
    expect(snapshot.candidates[0].sourceContentId).toBe("video-1");
    expect(snapshot.candidates[0].platformAudioId).toBeUndefined();
  });

  it("never lets chart discovery pretend that a popular YouTube song is cleared audio", async () => {
    const snapshot = await fetchYouTubeMusicChart(config, now, successfulFetch());
    const selection = selectAudioForIdea(idea, "youtube-shorts", snapshot, now);
    expect(selection.mode).toBe("original");
    expect(selection.reason.toLowerCase()).toContain("no cleared trending sound");
  });

  it("keeps cached YouTube trend data when the upstream API fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-youtube-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const first = await refreshYouTubeTrendCache({
        cachePath,
        now,
        force: true,
        env: { YOUTUBE_DATA_API_KEY: "secret" },
        fetchImpl: successfulFetch(),
      });
      expect(first.status).toBe("refreshed");
      expect(first.snapshot?.candidates).toHaveLength(2);

      const failed = await refreshYouTubeTrendCache({
        cachePath,
        now: new Date("2026-08-23T12:00:00Z"),
        force: true,
        env: { YOUTUBE_DATA_API_KEY: "secret" },
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      });
      expect(failed.status).toBe("failed-cache");
      expect(failed.snapshot?.candidates).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips repeat API calls while the YouTube cache is fresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-youtube-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    let calls = 0;
    const fetchImpl = async (input: string | URL | Request) => {
      calls += 1;
      return successfulFetch()(input);
    };
    try {
      await refreshYouTubeTrendCache({
        cachePath,
        now,
        force: true,
        env: { YOUTUBE_DATA_API_KEY: "secret", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      const second = await refreshYouTubeTrendCache({
        cachePath,
        now: new Date("2026-08-23T01:00:00Z"),
        env: { YOUTUBE_DATA_API_KEY: "secret", AUDIO_TREND_REFRESH_HOURS: "6" },
        fetchImpl,
      });
      expect(second.status).toBe("cache-fresh");
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
