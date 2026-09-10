import { describe, expect, it } from "vitest";
import { analyzePerformance, scoreVideo } from "./performance.ts";
import type { VideoPerformanceRecord } from "./types.ts";

function record(overrides: Partial<VideoPerformanceRecord> = {}): VideoPerformanceRecord {
  return {
    videoId: "v1",
    ideaId: "idea-1",
    platform: "youtube-shorts",
    publishedAt: "2026-08-21T12:00:00Z",
    durationSeconds: 24,
    views: 10000,
    shownOrImpressions: 12000,
    engagedViews: 9000,
    stayedToWatchRate: 0.75,
    averageViewDurationSeconds: 21,
    averagePercentageViewed: 0.875,
    retentionCurve: [
      { elapsedRatio: 0.01, audienceRatio: 1 },
      { elapsedRatio: 0.5, audienceRatio: 0.88 },
      { elapsedRatio: 0.95, audienceRatio: 0.72 },
      { elapsedRatio: 1, audienceRatio: 0.68 },
    ],
    likes: 700,
    comments: 90,
    shares: 180,
    saves: 150,
    followsGained: 120,
    siteClicks: 260,
    builderStarts: 90,
    affiliateClicks: 35,
    format: "game",
    visualWorld: "Blind Draft Arena",
    narrativeEngine: "blind-choice reveal",
    hookFamily: "interactive-choice",
    durationBucket: "20-29",
    ...overrides,
  };
}

describe("performance learner", () => {
  it("scores quality from normalized behavior rather than raw views", () => {
    const strong = scoreVideo(record());
    const sameBehaviorMoreViews = scoreVideo(record({
      videoId: "v2",
      views: 100000,
      shownOrImpressions: 120000,
      engagedViews: 90000,
      likes: 7000,
      comments: 900,
      shares: 1800,
      saves: 1500,
      followsGained: 1200,
      siteClicks: 2600,
      builderStarts: 900,
      affiliateClicks: 350,
    }));

    expect(strong.overall).toBe(sameBehaviorMoreViews.overall);
    expect(strong.confidence).toBe("high");
  });

  it("does not promote a creative factor from a single lucky upload", () => {
    const learning = analyzePerformance([record()]);
    expect(learning.byFormat.find((item) => item.factor === "game")?.status).toBe("explore");
  });

  it("can promote repeatedly strong factors only after multiple samples", () => {
    const records = [0, 1, 2, 3].flatMap((index) => [
      record({ videoId: `game-${index}`, format: "game", visualWorld: "Blind Draft Arena", hookFamily: "interactive-choice" }),
      record({
        videoId: `comparison-${index}`,
        format: "comparison",
        visualWorld: "Generic Comparison",
        hookFamily: "price-gap-comparison",
        stayedToWatchRate: 0.38,
        averagePercentageViewed: 0.42,
        retentionCurve: [{ elapsedRatio: 0.95, audienceRatio: 0.2 }],
        likes: 150,
        comments: 20,
        shares: 20,
        saves: 10,
        followsGained: 10,
        siteClicks: 25,
        builderStarts: 5,
        affiliateClicks: 1,
      }),
    ]);

    const learning = analyzePerformance(records);
    const game = learning.byFormat.find((item) => item.factor === "game");
    const comparison = learning.byFormat.find((item) => item.factor === "comparison");

    expect(game?.sampleSize).toBe(4);
    expect(comparison?.sampleSize).toBe(4);
    expect((game?.liftVsBaseline ?? 0)).toBeGreaterThan(0);
    expect((comparison?.liftVsBaseline ?? 0)).toBeLessThan(0);
  });

  it("learns voice performance separately and keeps format context visible", () => {
    const georgeId = "JBFqnCBsd6RMkjVDRZzb";
    const records = [0, 1, 2, 3].flatMap((index) => [
      record({
        videoId: `george-${index}`,
        voiceId: georgeId,
        voiceName: "George",
        format: "game",
      }),
      record({
        videoId: `alt-${index}`,
        voiceId: "alt-voice-id",
        voiceName: "Alt Voice",
        format: "game",
        stayedToWatchRate: 0.38,
        averagePercentageViewed: 0.42,
        retentionCurve: [{ elapsedRatio: 0.95, audienceRatio: 0.2 }],
        likes: 150,
        comments: 20,
        shares: 20,
        saves: 10,
        followsGained: 10,
        siteClicks: 25,
        builderStarts: 5,
        affiliateClicks: 1,
      }),
    ]);

    const learning = analyzePerformance(records);
    const george = learning.byVoice.find((item) => item.factor === `George [${georgeId}]`);
    const alt = learning.byVoice.find((item) => item.factor === "Alt Voice [alt-voice-id]");
    const georgeGame = learning.byVoiceAndFormat.find((item) => item.factor === `George [${georgeId}] × game`);

    expect(george?.sampleSize).toBe(4);
    expect(alt?.sampleSize).toBe(4);
    expect((george?.liftVsBaseline ?? 0)).toBeGreaterThan(0);
    expect((alt?.liftVsBaseline ?? 0)).toBeLessThan(0);
    expect(georgeGame?.sampleSize).toBe(4);
  });

  it("does not declare a voice winner from one sample", () => {
    const learning = analyzePerformance([
      record({ voiceId: "voice-a", voiceName: "Voice A" }),
      record({ videoId: "v2", voiceId: "voice-b", voiceName: "Voice B" }),
    ]);

    expect(learning.byVoice.every((item) => item.status === "explore")).toBe(true);
    expect(learning.recommendations.some((entry) => entry.includes("still inconclusive"))).toBe(true);
  });
});
