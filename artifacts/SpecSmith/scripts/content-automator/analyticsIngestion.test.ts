import { describe, expect, it } from "vitest";
import {
  nextDueSnapshotWindow,
  normalizeMetricoolAnalyticsRow,
  snapshotDueAt,
  upsertAnalyticsSnapshot,
  viewsPerHourBetween,
} from "./analyticsIngestion.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

function fingerprint(platform: VideoPlatform): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId: `creative-${platform}`,
    packageId: "pkg-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform,
    format: "comparison",
    feature: "compare",
    subjectIds: ["gpu-1", "gpu-2"],
    hookFamily: "price-gap-comparison",
    hookText: "$400 more?",
    visualWorld: "Decision Trap",
    narrativeEngine: "hook -> proof -> answer",
    targetDurationSeconds: 20,
    beatCount: 6,
    plannedBeatChangesPer10Seconds: 2.5,
    editDensity: "high",
    captionedBeatRatio: 0.3,
    captionDensity: "low",
    firstVisualType: "generated-cinematic",
    voiceId: "iapetus",
    voiceName: "Iapetus",
    sfxDensity: "medium",
    ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#PCComparison"],
    experimentId: `exp-${platform}`,
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
    generationCostUsd: 0.2,
    generationSeconds: 35,
  };
}

function context(platform: VideoPlatform, window: "1h" | "6h" | "24h" | "72h" | "7d" = "24h") {
  return {
    creativeId: `creative-${platform}`,
    videoId: `video-${platform}`,
    ideaId: "idea-1",
    platform,
    publishedAt: "2026-08-23T20:00:00Z",
    durationSeconds: 20,
    fingerprint: fingerprint(platform),
    window,
    capturedAt: "2026-08-24T20:00:00Z",
  } as const;
}

describe("Metricool analytics ingestion", () => {
  it("normalizes Instagram retention, watch time, saves, shares, and 3-second view rate", () => {
    const snapshot = normalizeMetricoolAnalyticsRow({
      IGRE23: 1200,
      IGRE11: 850,
      IGRE24: 13.5,
      IGRE27: 67.5,
      IGRE28: 81,
      IGRE10: 90,
      IGRE07: 8,
      IGRE21: 22,
      IGRE12: 31,
      IGRE29: 4,
    }, context("instagram-reels"));

    expect(snapshot.record.views).toBe(1200);
    expect(snapshot.record.averageViewDurationSeconds).toBe(13.5);
    expect(snapshot.record.averagePercentageViewed).toBe(0.675);
    expect(snapshot.record.stayedToWatchRate).toBe(0.81);
    expect(snapshot.record.saves).toBe(31);
    expect(snapshot.record.shares).toBe(22);
    expect(snapshot.record.reposts).toBe(4);
    expect(snapshot.record.captionDensity).toBe("low");
    expect(snapshot.record.hashtagStrategy).toBe("intent-balanced-v1");
  });

  it("normalizes TikTok completion/watch time and preserves traffic-source data", () => {
    const snapshot = normalizeMetricoolAnalyticsRow({
      TKPO07: 5000,
      TKPO11: 3900,
      TKPO15: "00:00:14",
      TKPO13: "42%",
      TKPO08: 300,
      TKPO09: 25,
      TKPO10: 70,
      TKPO16: 78,
      TKPO17: 6,
      TKPO18: 4,
      TKPO19: 1,
      TKPO20: 3,
      TKPO21: 8,
    }, context("tiktok"));

    expect(snapshot.record.views).toBe(5000);
    expect(snapshot.record.averageViewDurationSeconds).toBe(14);
    expect(snapshot.record.fullVideoWatchedRate).toBe(0.42);
    expect(snapshot.record.retentionCurve?.[0]).toEqual({ elapsedRatio: 0.95, audienceRatio: 0.42 });
    expect(snapshot.record.trafficSources?.forYou).toBe(78);
    expect(snapshot.record.trafficSources?.search).toBe(8);
  });

  it("normalizes YouTube view duration and engagement without fabricating unsupported retention", () => {
    const snapshot = normalizeMetricoolAnalyticsRow({
      Views: "2,500",
      "Avg View Duration": "00:00:16.5",
      Likes: 140,
      Comments: 12,
      Shares: 18,
    }, context("youtube-shorts"));

    expect(snapshot.record.views).toBe(2500);
    expect(snapshot.record.averageViewDurationSeconds).toBe(16.5);
    expect(snapshot.record.averagePercentageViewed).toBeUndefined();
    expect(snapshot.record.retentionCurve).toBeUndefined();
  });

  it("schedules immutable 1h/6h/24h/72h/7d checkpoints in order", () => {
    expect(snapshotDueAt("2026-08-23T20:00:00Z", "6h")).toBe("2026-08-24T02:00:00.000Z");
    expect(nextDueSnapshotWindow("2026-08-23T20:00:00Z", [], new Date("2026-08-23T21:01:00Z"))).toBe("1h");

    const oneHour = normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, {
      ...context("tiktok", "1h"),
      capturedAt: "2026-08-23T21:01:00Z",
    });
    expect(nextDueSnapshotWindow("2026-08-23T20:00:00Z", [oneHour], new Date("2026-08-24T02:01:00Z"))).toBe("6h");
    expect(nextDueSnapshotWindow("2026-08-23T20:00:00Z", [oneHour], new Date("2026-08-23T22:00:00Z"))).toBeNull();
  });

  it("upserts a checkpoint instead of duplicating it and measures distribution velocity", () => {
    const early = normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, {
      ...context("tiktok", "1h"),
      capturedAt: "2026-08-23T21:00:00Z",
    });
    const replacement = normalizeMetricoolAnalyticsRow({ TKPO07: 120 }, {
      ...context("tiktok", "1h"),
      capturedAt: "2026-08-23T21:05:00Z",
    });
    const later = normalizeMetricoolAnalyticsRow({ TKPO07: 720 }, {
      ...context("tiktok", "6h"),
      capturedAt: "2026-08-24T02:05:00Z",
    });

    const snapshots = upsertAnalyticsSnapshot(upsertAnalyticsSnapshot([], early), replacement);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].record.views).toBe(120);
    expect(viewsPerHourBetween(replacement, later)).toBe(120);
  });

  it("rejects analytics that are accidentally attached to the wrong creative", () => {
    expect(() => normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, {
      ...context("tiktok"),
      creativeId: "wrong",
    })).toThrow(/does not match analytics creative/);
  });
});
