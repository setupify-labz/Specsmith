import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeMetricoolAnalyticsRow } from "./analyticsIngestion.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredAnalyticsSnapshots,
  loadStoredPublicationLedger,
  recordStoredAnalyticsSnapshot,
} from "./publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-publishing-store-"));
  roots.push(root);
  return root;
}

function fingerprint(platform: VideoPlatform = "tiktok"): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId: `creative-${platform}`,
    packageId: "package-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform,
    format: "comparison",
    feature: "compare",
    subjectIds: ["gpu-1", "gpu-2"],
    hookFamily: "price-gap-comparison",
    hookText: "Worth it?",
    visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer",
    targetDurationSeconds: 20,
    beatCount: 4,
    plannedBeatChangesPer10Seconds: 1.5,
    editDensity: "high",
    captionedBeatRatio: 0.5,
    captionDensity: "medium",
    firstVisualType: "generated-cinematic",
    sfxDensity: "medium",
    ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC"],
    experimentId: `experiment-${platform}`,
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
  };
}

function snapshot(views: number) {
  const fp = fingerprint();
  return normalizeMetricoolAnalyticsRow({ TKPO07: views }, {
    creativeId: fp.creativeId,
    videoId: "video-1",
    ideaId: fp.ideaId,
    platform: fp.platform,
    publishedAt: "2026-08-23T20:00:00Z",
    durationSeconds: 20,
    fingerprint: fp,
    window: "1h",
    capturedAt: "2026-08-23T21:00:00Z",
  });
}

describe("durable publication store", () => {
  it("survives reloads and refuses a second ledger for the same creative", async () => {
    const root = await storeRoot();
    const fp = fingerprint();
    await createStoredPublicationLedger(root, fp, new Date("2026-08-23T20:00:00Z"));
    await expect(createStoredPublicationLedger(root, fp)).rejects.toThrow(/duplicate run/);

    await advanceStoredPublicationLedger(root, fp.creativeId, {
      status: "qc-passed",
      at: "2026-08-23T20:01:00Z",
    });
    const reloaded = await loadStoredPublicationLedger(root, fp.creativeId);
    expect(reloaded?.events.map((event) => event.status)).toEqual(["generated", "qc-passed"]);
  });

  it("allows only one concurrent writer to claim the next lifecycle slot", async () => {
    const root = await storeRoot();
    const fp = fingerprint();
    await createStoredPublicationLedger(root, fp, new Date("2026-08-23T20:00:00Z"));
    const attempts = await Promise.allSettled([
      advanceStoredPublicationLedger(root, fp.creativeId, { status: "qc-passed", at: "2026-08-23T20:01:00Z" }),
      advanceStoredPublicationLedger(root, fp.creativeId, { status: "qc-passed", at: "2026-08-23T20:01:01Z" }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((await loadStoredPublicationLedger(root, fp.creativeId))?.events).toHaveLength(2);
  });

  it("keeps stored analytics immutable while making identical retries idempotent", async () => {
    const root = await storeRoot();
    const first = snapshot(100);
    await recordStoredAnalyticsSnapshot(root, first);
    await expect(recordStoredAnalyticsSnapshot(root, first)).resolves.toEqual(first);
    await expect(recordStoredAnalyticsSnapshot(root, snapshot(120))).rejects.toThrow(/immutable/);
    expect((await loadStoredAnalyticsSnapshots(root, first.creativeId))[0].record.views).toBe(100);
  });
});
