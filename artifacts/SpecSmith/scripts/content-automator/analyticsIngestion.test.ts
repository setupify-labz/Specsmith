import { describe, expect, it } from "vitest";
import {
  missedSnapshotWindows,
  nextDueSnapshotWindow,
  normalizeMetricoolAnalyticsRow,
  snapshotDueAt,
  recordAnalyticsSnapshot,
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
    // No synthetic curve: "watched to 100%" is not a measurement at 95%.
    expect(snapshot.record.retentionCurve).toBeUndefined();
    expect(snapshot.record.fullVideoWatchedRate).toBe(0.42);
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

  it("never labels a late capture as an earlier window it missed", () => {
    // Returning "1h" a week after publication attached week-old numbers to the
    // 1h checkpoint and corrupted every window comparison downstream.
    const weekLater = new Date("2026-08-30T20:00:00Z");
    expect(nextDueSnapshotWindow("2026-08-23T20:00:00Z", [], weekLater)).toBe("7d");
    expect(missedSnapshotWindows("2026-08-23T20:00:00Z", [], weekLater)).toEqual(["1h", "6h", "24h", "72h"]);
  });

  it("refuses to record a view count the platform did not report", () => {
    // A missing metric is a collection failure, not a zero-view video.
    expect(() => normalizeMetricoolAnalyticsRow({ TKPO08: 5 }, context("tiktok", "1h")))
      .toThrow(/fabricated zero-view/);
  });

  it("reads an explicit sub-1% rate as a real ratio, not a whole percent", () => {
    // "0.8%" previously became 0.8 (80%) — a 100x error on small rates.
    const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: "0.8%" }, context("tiktok", "1h"));
    expect(row.record.fullVideoWatchedRate).toBeCloseTo(0.008, 6);
  });

  it("keeps a captured checkpoint immutable and measures distribution velocity", () => {
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

    // A snapshot is a point-in-time fact. Rewriting the 1h reading later would
    // silently falsify history and make between-window velocity meaningless.
    const recorded = recordAnalyticsSnapshot([], early);
    expect(() => recordAnalyticsSnapshot(recorded, replacement)).toThrow(/immutable/);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].record.views).toBe(100);
    // Re-recording the identical reading stays idempotent for retries.
    expect(recordAnalyticsSnapshot(recorded, early)).toHaveLength(1);
    // From the immutable 1h reading (100 views at 21:00) to the 6h reading
    // (720 at 02:05): 620 views over 5h05m.
    expect(viewsPerHourBetween(early, later)).toBeCloseTo(121.97, 2);
  });

  it("does not report a provider counter correction as negative audience velocity", () => {
    const earlier = normalizeMetricoolAnalyticsRow({ TKPO07: 120 }, {
      ...context("tiktok", "1h"),
      capturedAt: "2026-08-23T21:00:00Z",
    });
    const corrected = normalizeMetricoolAnalyticsRow({ TKPO07: 115 }, {
      ...context("tiktok", "6h"),
      capturedAt: "2026-08-24T02:00:00Z",
    });
    expect(viewsPerHourBetween(earlier, corrected)).toBeNull();
  });

  it("rejects analytics that are accidentally attached to the wrong creative", () => {
    expect(() => normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, {
      ...context("tiktok"),
      creativeId: "wrong",
    })).toThrow(/does not match analytics creative/);
  });
});

// REGRESSION (review item 2): the due window is chosen by the clock alone, and
// only then checked against what has been captured. The previous version kept
// the last UNCAPTURED due window while scanning, so a gap earlier in the
// sequence stayed selectable forever and a capture taken today could be filed
// against a moment days in the past.
describe("snapshot windows are selected by elapsed time, never backfilled", () => {
  const publishedAt = "2026-08-23T20:00:00Z";

  function captured(window: "1h" | "6h" | "24h" | "72h" | "7d", capturedAt: string) {
    return normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, { ...context("tiktok", window), capturedAt });
  }

  it("selects the latest window whose moment has passed", () => {
    expect(nextDueSnapshotWindow(publishedAt, [], new Date("2026-08-24T21:00:00Z"))).toBe("24h");
  });

  it("returns nothing once that window is captured, rather than falling back to an older gap", () => {
    // 7d is the window the clock points at. 1h, 6h, 24h and 72h were all
    // missed. The old implementation returned "72h" here and a capture taken a
    // week after publication would have been recorded as a 72-hour reading.
    const sevenDay = captured("7d", "2026-08-30T20:30:00Z");
    expect(nextDueSnapshotWindow(publishedAt, [sevenDay], new Date("2026-08-30T21:00:00Z"))).toBeNull();
  });

  it("ignores captures of windows other than the one now due", () => {
    // 24h is due and uncaptured; the recorded 1h reading is irrelevant to that.
    const oneHour = captured("1h", "2026-08-23T21:01:00Z");
    expect(nextDueSnapshotWindow(publishedAt, [oneHour], new Date("2026-08-24T21:00:00Z"))).toBe("24h");
  });

  it("does not re-offer the current window just because an earlier one is missing", () => {
    // 6h captured, 1h never taken, clock inside the 6h..24h span.
    const sixHour = captured("6h", "2026-08-24T02:05:00Z");
    expect(nextDueSnapshotWindow(publishedAt, [sixHour], new Date("2026-08-24T10:00:00Z"))).toBeNull();
  });

  it("reports the skipped windows as missed rather than pending", () => {
    const sevenDay = captured("7d", "2026-08-30T20:30:00Z");
    expect(missedSnapshotWindows(publishedAt, [sevenDay], new Date("2026-08-30T21:00:00Z")))
      .toEqual(["1h", "6h", "24h", "72h"]);
  });

  it("returns nothing before the first window is even due", () => {
    expect(nextDueSnapshotWindow(publishedAt, [], new Date("2026-08-23T20:30:00Z"))).toBeNull();
  });
});

// REGRESSION (review item 3): IGRE27, IGRE28 and TKPO13 are percentage-point
// fields. Their unit belongs to the field, so it is applied unconditionally
// rather than inferred from magnitude or from whether the export happened to
// print a "%". The old heuristic read a bare 0.8 as the ratio 0.8 — a 100x
// overstatement of a 0.8% rate.
describe("percentage-point fields are parsed by field, not by formatting", () => {
  it("reads a bare numeric 0.8 as 0.008 on every one of the three fields", () => {
    const tiktok = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: 0.8 }, context("tiktok", "1h"));
    expect(tiktok.record.fullVideoWatchedRate).toBeCloseTo(0.008, 9);

    const instagram = normalizeMetricoolAnalyticsRow(
      { IGRE23: 100, IGRE27: 0.8, IGRE28: 0.8 },
      context("instagram-reels", "1h"),
    );
    expect(instagram.record.averagePercentageViewed).toBeCloseTo(0.008, 9);
    expect(instagram.record.stayedToWatchRate).toBeCloseTo(0.008, 9);
  });

  it("gives the same answer whether the source marked the percent or not", () => {
    const forms = [0.8, "0.8", "0.8%", " 0.8 % "];
    for (const value of forms) {
      const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: value }, context("tiktok", "1h"));
      expect(row.record.fullVideoWatchedRate).toBeCloseTo(0.008, 9);
    }
  });

  it("scales whole-number rates the same way", () => {
    const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: 42 }, context("tiktok", "1h"));
    expect(row.record.fullVideoWatchedRate).toBeCloseTo(0.42, 9);
  });

  it("keeps a rate of 100 as a whole ratio rather than clamping it", () => {
    const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: 100 }, context("tiktok", "1h"));
    expect(row.record.fullVideoWatchedRate).toBe(1);
  });

  it("leaves an absent rate absent instead of defaulting it to zero", () => {
    const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100 }, context("tiktok", "1h"));
    expect(row.record.fullVideoWatchedRate).toBeUndefined();
  });

  it("drops a negative rate rather than recording an impossible one", () => {
    const row = normalizeMetricoolAnalyticsRow({ TKPO07: 100, TKPO13: -5 }, context("tiktok", "1h"));
    expect(row.record.fullVideoWatchedRate).toBeUndefined();
  });
});
