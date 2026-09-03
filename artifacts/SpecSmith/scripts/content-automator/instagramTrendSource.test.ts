import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectAudioForIdea } from "./audioTrend.ts";
import {
  fetchInstagramTrendFeed,
  instagramTrendConfigFromEnv,
  refreshInstagramTrendCache,
  type InstagramTrendFeedConfig,
} from "./instagramTrendSource.ts";
import type { ContentIdea } from "./types.ts";

const now = new Date("2026-08-22T23:00:00Z");

const idea: ContentIdea = {
  id: "ig-audio-test",
  format: "game",
  title: "Can you beat SpecSmith's GPU Price Guesser?",
  hook: "Lock your guess before the reveal.",
  angle: "Countdown then reveal.",
  targetAudience: "PC buyers",
  requiredFacts: [],
  subjectIds: [],
  productConnection: {
    feature: "price-guesser",
    route: "/price-guesser",
    userProblem: "Prices are hard to judge.",
    whySpecSmith: "SpecSmith powers the game.",
    continuationAction: "Play another round.",
    sitePayoff: "Continue on SpecSmith.",
  },
  creativeDNA: {
    conceptName: "Price Lock",
    visualWorld: "Price Guesser Countdown",
    narrativeEngine: "guess -> tension -> reveal",
    openingImage: "GPU",
    patternInterrupt: "timer",
    retentionBeats: ["guess", "reveal"],
    payoff: "verified price",
    audioDirection: "Countdown tension, silence, reveal impact",
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

const untrustedConfig: InstagramTrendFeedConfig = {
  endpoint: "https://trends.example.test/instagram/audio",
  trustRights: false,
  timeoutMs: 5000,
};

function successfulFetch(calls: { url?: string; authorization?: string | null }[] = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("Authorization") });
    return new Response(JSON.stringify({
      capturedAt: "2026-08-22T22:55:00Z",
      items: [
        {
          id: "ig-sound-1",
          platformAudioId: "ig-native-1",
          title: "Countdown Reveal",
          artist: "Test Artist",
          popularityScore: 90,
          velocityScore: 96,
          saturationScore: 30,
          rightsStatus: "platform-cleared",
          tags: ["countdown", "tension", "reveal", "game"],
          rankPosition: 2,
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

describe("Instagram trend feed adapter", () => {
  it("requires an explicit feed URL and does not silently invent a Meta trend endpoint", () => {
    expect(instagramTrendConfigFromEnv({})).toBeUndefined();
    expect(instagramTrendConfigFromEnv({ INSTAGRAM_AUDIO_TREND_FEED_URL: "not a url" })).toBeUndefined();
    const config = instagramTrendConfigFromEnv({
      INSTAGRAM_AUDIO_TREND_FEED_URL: "https://trends.example.test/feed",
      INSTAGRAM_AUDIO_TREND_FEED_TOKEN: "secret",
    });
    expect(config?.endpoint).toBe("https://trends.example.test/feed");
    expect(config?.bearerToken).toBe("secret");
    expect(config?.trustRights).toBe(false);
  });

  it("downgrades claimed rights to unknown unless the feed is explicitly trusted", async () => {
    const snapshot = await fetchInstagramTrendFeed(untrustedConfig, now, successfulFetch());
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0].platform).toBe("instagram-reels");
    expect(snapshot.candidates[0].rightsStatus).toBe("unknown");
    expect(snapshot.candidates[0].platformAudioId).toBe("ig-native-1");

    const selection = selectAudioForIdea(idea, "instagram-reels", snapshot, now);
    expect(selection.mode).toBe("original");
  });

  it("allows explicit cleared rights only when the configured feed is marked trusted", async () => {
    const trustedConfig: InstagramTrendFeedConfig = { ...untrustedConfig, trustRights: true };
    const snapshot = await fetchInstagramTrendFeed(trustedConfig, now, successfulFetch());
    expect(snapshot.candidates[0].rightsStatus).toBe("platform-cleared");

    const selection = selectAudioForIdea(idea, "instagram-reels", snapshot, now);
    expect(selection.mode).toBe("trending");
    expect(selection.platformAudioId).toBe("ig-native-1");
    expect(selection.attachMode).toBe("platform-publish");
  });

  it("sends bearer auth without putting secrets in the URL", async () => {
    const calls: { url?: string; authorization?: string | null }[] = [];
    const config: InstagramTrendFeedConfig = {
      ...untrustedConfig,
      bearerToken: "feed-secret",
    };
    await fetchInstagramTrendFeed(config, now, successfulFetch(calls));
    expect(calls[0].authorization).toBe("Bearer feed-secret");
    expect(calls[0].url).not.toContain("feed-secret");
  });

  it("keeps the last good Instagram cache when the feed fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-instagram-trends-"));
    const cachePath = join(dir, "audio-trends.json");
    try {
      const env = {
        INSTAGRAM_AUDIO_TREND_FEED_URL: "https://trends.example.test/feed",
        INSTAGRAM_TREND_FEED_RIGHTS_TRUSTED: "true",
      };
      const first = await refreshInstagramTrendCache({
        cachePath,
        now,
        force: true,
        env,
        fetchImpl: successfulFetch(),
      });
      expect(first.status).toBe("refreshed");
      expect(first.snapshot?.candidates).toHaveLength(1);

      const failed = await refreshInstagramTrendCache({
        cachePath,
        now: new Date("2026-08-23T12:00:00Z"),
        force: true,
        env,
        fetchImpl: async () => new Response("upstream down", { status: 500 }),
      });
      expect(failed.status).toBe("failed-cache");
      expect(failed.snapshot?.candidates).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
