// The analytics -> learning edge, and the two ways it silently fabricates
// confidence if wired the obvious way.
//
// Before this, nothing in production connected stored analytics snapshots to
// analyzePerformance — loadStoredAnalyticsSnapshots had no caller outside its
// own test. The natural wiring, `snapshots.map((s) => s.record)`, type-checks
// and is wrong: one creative with all five windows captured becomes five
// records, learnFactor counts records, and a single upload clears the
// "fewer than 3 samples" bar to be promoted as a rule.

import { describe, expect, it } from "vitest";
import { selectLearnerRecords, type AnalyticsSnapshot } from "./analyticsIngestion.ts";
import { analyzePerformance } from "./performance.ts";
import type { SnapshotWindow, VideoPerformanceRecord } from "./types.ts";

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
    likes: 700,
    comments: 90,
    shares: 180,
    saves: 150,
    followsGained: 120,
    siteClicks: 260,
    builderStarts: 90,
    format: "comparison",
    visualWorld: "Bench Lab",
    narrativeEngine: "constraint -> choice -> evidence -> payoff",
    hookFamily: "reveal",
    durationBucket: "20-30s",
    ...overrides,
  } as VideoPerformanceRecord;
}

function snapshot(creativeId: string, window: SnapshotWindow, overrides: Partial<VideoPerformanceRecord> = {}): AnalyticsSnapshot {
  return {
    creativeId,
    videoId: creativeId,
    platform: "youtube-shorts",
    source: "metricool",
    publishedAt: "2026-08-21T12:00:00Z",
    capturedAt: `2026-08-21T${window === "1h" ? "13" : "18"}:00:00Z`,
    window,
    record: record({ videoId: creativeId, creativeId, ...overrides }),
  };
}

const ALL_WINDOWS: SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];

describe("selecting what the learner may score", () => {
  it("returns exactly one record per creative, at the requested window", () => {
    const snapshots = ["c1", "c2"].flatMap((id) => ALL_WINDOWS.map((w) => snapshot(id, w)));
    const selection = selectLearnerRecords(snapshots, "24h");

    expect(selection.records).toHaveLength(2);
    expect(selection.records.map((r) => r.creativeId)).toEqual(["c1", "c2"]);
    expect(new Set(selection.records.map((r) => r.snapshotWindow))).toEqual(new Set(["24h"]));
  });

  it("excludes a creative whose window was never captured instead of substituting another", () => {
    const snapshots = [
      ...ALL_WINDOWS.map((w) => snapshot("c1", w)),
      snapshot("c2", "1h"),
      snapshot("c2", "6h"),
    ];
    const selection = selectLearnerRecords(snapshots, "24h");

    // c2 has 1h and 6h data. Neither is a 24h measurement, so it drops out.
    expect(selection.records.map((r) => r.creativeId)).toEqual(["c1"]);
    expect(selection.excluded).toEqual([
      { creativeId: "c2", availableWindows: ["1h", "6h"], reason: "window-not-captured" },
    ]);
  });

  it("names every excluded creative rather than silently shrinking the sample", () => {
    const selection = selectLearnerRecords([snapshot("c1", "1h"), snapshot("c2", "1h")], "7d");
    expect(selection.records).toHaveLength(0);
    expect(selection.excluded.map((e) => e.creativeId)).toEqual(["c1", "c2"]);
  });

  it("is deterministic when the same creative and window appear twice", () => {
    const early = { ...snapshot("c1", "24h"), capturedAt: "2026-08-22T10:00:00Z" };
    const late = { ...snapshot("c1", "24h"), capturedAt: "2026-08-22T11:00:00Z" };
    expect(selectLearnerRecords([late, early], "24h").records).toHaveLength(1);
    expect(selectLearnerRecords([late, early], "24h").records[0].videoId)
      .toBe(selectLearnerRecords([early, late], "24h").records[0].videoId);
  });

  it("refuses a window it does not know", () => {
    expect(() => selectLearnerRecords([], "30d" as SnapshotWindow)).toThrow(/Unknown snapshot window/);
  });
});

describe("the learner refuses input that would manufacture confidence", () => {
  it("rejects the naive wiring that turns one creative into five samples", () => {
    const snapshots = ALL_WINDOWS.map((w) => snapshot("c1", w));
    // The mapping that type-checks and is wrong.
    const naive = snapshots.map((s) => s.record);
    expect(() => analyzePerformance(naive)).toThrow(/more than once/);
  });

  it("rejects a set that mixes snapshot windows, which would rank age not creative", () => {
    const mixed = [
      { ...record({ videoId: "a", creativeId: "a" }), snapshotWindow: "1h" as SnapshotWindow },
      { ...record({ videoId: "b", creativeId: "b" }), snapshotWindow: "7d" as SnapshotWindow },
    ];
    expect(() => analyzePerformance(mixed)).toThrow(/mixed snapshot windows/);
  });

  it("accepts what selectLearnerRecords produces", () => {
    const snapshots = ["c1", "c2", "c3"].flatMap((id) => ALL_WINDOWS.map((w) => snapshot(id, w)));
    const selection = selectLearnerRecords(snapshots, "24h");
    expect(() => analyzePerformance(selection.records)).not.toThrow();
  });

  it("counts three creatives as three samples, not fifteen", () => {
    const snapshots = ["c1", "c2", "c3"].flatMap((id) => ALL_WINDOWS.map((w) => snapshot(id, w)));
    const learning = analyzePerformance(selectLearnerRecords(snapshots, "24h").records);
    const sampleSizes = [...learning.byFormat, ...learning.byVisualWorld].map((l) => l.sampleSize);
    expect(sampleSizes.length).toBeGreaterThan(0);
    for (const size of sampleSizes) expect(size).toBeLessThanOrEqual(3);
  });
});
