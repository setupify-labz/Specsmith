// The analytics scheduler. Every test runs against an injected transport, so
// nothing here reaches the network, and the module under test has no
// credentials of its own and no way to post anything.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { eligibilityFor, formatAnalyticsPass, runAnalyticsPass, scanEligiblePublications } from "./analyticsOrchestrator.ts";
import type { MetricoolTransport } from "./metricoolClient.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredAnalyticsSnapshots,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-orchestrator-"));
  roots.push(root);
  return root;
}

function fingerprint(creativeId = "creative-1", platform: VideoPlatform = "youtube-shorts"): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId,
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
    targetDurationSeconds: 24,
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
    experimentId: "experiment-1",
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
  } as CreativeFingerprint;
}

const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";
const credentials = { userToken: "t", userId: "u" };

function transportOf(responses: { status: number; body: string }[]): MetricoolTransport & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url) => {
    calls.push(url);
    const next = responses.shift() ?? { status: 500, body: "{}" };
    return { status: next.status, text: async () => next.body };
  }) as MetricoolTransport & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const views = (n: number) => ({ status: 200, body: JSON.stringify({ data: { YTVP06: n } }) });

/** A creative carried all the way to a real published ledger event. */
async function publishedCreative(root: string, creativeId: string, postId: string): Promise<void> {
  await createStoredPublicationLedger(root, fingerprint(creativeId));
  await advanceStoredPublicationLedger(root, creativeId, { status: "qc-passed" });
  await advanceStoredPublicationLedger(root, creativeId, { status: "scheduled", providerPostId: postId });
  await advanceStoredPublicationLedger(root, creativeId, { status: "published", at: PUBLISHED_AT });
}

const pass = (root: string, transport: MetricoolTransport, now: Date, window: "1h" | "6h" | "24h" | "72h" | "7d" = "1h") =>
  runAnalyticsPass({ storeRoot: root, credentials, transport, blogId: "blog-1", learningWindow: window, now });

describe("attribution is derived from one canonical record", () => {
  it("reads ideaId, duration and fingerprint from the ledger's stored fingerprint", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");

    const ledger = await loadStoredPublicationLedger(root, "creative-1");
    const eligible = await eligibilityFor(root, ledger!);

    expect(eligible).toMatchObject({
      creativeId: "creative-1",
      providerPostId: "post-1",
      ideaId: "idea-1",
      durationSeconds: 24,
    });
    expect((eligible as { fingerprint: CreativeFingerprint }).fingerprint.creativeId).toBe("creative-1");
  });

  it("skips a ledger written before fingerprints were persisted, rather than reconstructing one", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");

    // Simulate an older ledger by stripping the stored fingerprint.
    const dir = join(root, "publication-ledgers", createHash("sha256").update("creative-1").digest("hex"));
    const first = JSON.parse(await readFile(join(dir, "000000.json"), "utf8")) as Record<string, unknown>;
    delete first.fingerprint;
    await writeFile(join(dir, "000000.json"), JSON.stringify(first, null, 2));

    const ledger = await loadStoredPublicationLedger(root, "creative-1");
    expect(await eligibilityFor(root, ledger!)).toMatchObject({ reason: "no-stored-fingerprint" });
  });
});

describe("NEGATIVE CONTROLS: only real publications are measured", () => {
  it("ignores a creative that is scheduled but not published, and makes no request", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint("creative-1"));
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });
    await advanceStoredPublicationLedger(root, "creative-1", { status: "scheduled", providerPostId: "post-1" });

    const transport = transportOf([views(100)]);
    const result = await pass(root, transport, new Date("2026-09-02T00:00:00.000Z"));

    expect(result.scan.eligible).toHaveLength(0);
    expect(result.scan.skipped).toEqual([{ creativeId: "creative-1", reason: "not-published" }]);
    expect(transport.calls, "a scheduled-only creative must never be queried").toHaveLength(0);
  });

  it("ignores a published creative with no provider id", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint("creative-1"));
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });
    // Scheduled without an id, then published: nothing to ask the platform about.
    await advanceStoredPublicationLedger(root, "creative-1", { status: "scheduled" });
    await advanceStoredPublicationLedger(root, "creative-1", { status: "published", at: PUBLISHED_AT });

    const transport = transportOf([views(100)]);
    const result = await pass(root, transport, new Date("2026-09-02T00:00:00.000Z"));

    expect(result.scan.skipped).toEqual([{ creativeId: "creative-1", reason: "no-provider-id" }]);
    expect(transport.calls).toHaveLength(0);
  });

  it("does not re-fetch a window it already captured", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");
    const now = new Date("2026-09-01T13:30:00.000Z");

    const first = transportOf([views(100)]);
    await pass(root, first, now);
    expect(first.calls).toHaveLength(1);

    const second = transportOf([views(999)]);
    const again = await pass(root, second, now);
    expect(second.calls, "an already-captured window must not be fetched again").toHaveLength(0);
    expect(again.collection.outcomes[0].status).toBe("not-due");

    // And the stored snapshot is unchanged — 999 never lands.
    const snapshots = await loadStoredAnalyticsSnapshots(root, "creative-1");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].record.views).toBe(100);
  });

  it("does not substitute a later capture for a missed window", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");

    // First contact well past 6h: 1h came and went uncaptured.
    const transport = transportOf([views(5000)]);
    const result = await pass(root, transport, new Date("2026-09-01T19:00:00.000Z"), "6h");

    expect(result.collection.missed[0].windows).toContain("1h");
    const snapshots = await loadStoredAnalyticsSnapshots(root, "creative-1");
    expect(snapshots.map((snapshot) => snapshot.window), "the missed window is not filled in").toEqual(["6h"]);
  });

  it("cannot let a wrong-window snapshot into learning", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");
    // Capture 1h only, then learn on 24h.
    await pass(root, transportOf([views(100)]), new Date("2026-09-01T13:30:00.000Z"));

    const result = await pass(root, transportOf([]), new Date("2026-09-01T13:35:00.000Z"), "24h");
    expect(result.learningStatus).toBe("no-learning-yet");
    expect(result.learning).toBeNull();
    expect(result.excludedFromLearning).toEqual([{ creativeId: "creative-1", availableWindows: ["1h"] }]);
  });

  it("cannot inflate sample size by counting one creative's windows as many", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");

    // Capture several windows for the SAME creative.
    await pass(root, transportOf([views(100)]), new Date("2026-09-01T13:30:00.000Z"));
    await pass(root, transportOf([views(400)]), new Date("2026-09-01T19:00:00.000Z"));
    await pass(root, transportOf([views(900)]), new Date("2026-09-02T13:00:00.000Z"));
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(3);

    const result = await pass(root, transportOf([]), new Date("2026-09-02T14:00:00.000Z"), "24h");
    expect(result.learningStatus).toBe("learned");
    for (const learning of [...(result.learning?.byFormat ?? []), ...(result.learning?.byVisualWorld ?? [])]) {
      expect(learning.sampleSize, "one creative is one sample, whatever it has captured").toBe(1);
    }
  });

  it("turns a fetch failure into an uncaptured window, never zero performance", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");

    const result = await pass(root, transportOf([{ status: 500, body: "boom" }]), new Date("2026-09-01T13:30:00.000Z"));

    expect(result.collection.outcomes[0].status).toBe("failed");
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1"), "a failed read stores nothing").toHaveLength(0);
    expect(result.learningStatus).toBe("no-learning-yet");
  });

  it("turns an unattributable response into no-data, never zero performance", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");
    // Two rows: which belongs to this post is unknowable.
    const body = JSON.stringify({ data: [{ YTVP06: 1 }, { YTVP06: 2 }] });

    const result = await pass(root, transportOf([{ status: 200, body }]), new Date("2026-09-01T13:30:00.000Z"));

    expect(result.collection.outcomes[0].status).toBe("no-data");
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(0);
  });

  it("introduces no credentials and no publishing call", async () => {
    const source = await readFile(new URL("./analyticsOrchestrator.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("METRICOOL_USER_TOKEN");
    expect(code).not.toContain("metricoolCredentialsFromEnv");
    expect(code, "the orchestrator must never publish").not.toContain("publishApprovedPackage");
    expect(code).not.toContain("prepareReadyToPublishHandoff");
  });
});

describe("no trustworthy records means no learning, not empty success", () => {
  it("says so when nothing is published at all", async () => {
    const root = await storeRoot();
    const result = await pass(root, transportOf([]), new Date("2026-09-02T00:00:00.000Z"));
    expect(result.learningStatus).toBe("no-learning-yet");
    expect(result.learning).toBeNull();
    expect(result.learningReason).toMatch(/No creative has a published ledger event/);
  });

  it("says so when published but the chosen window is not captured", async () => {
    const root = await storeRoot();
    await publishedCreative(root, "creative-1", "post-1");
    const result = await pass(root, transportOf([views(100)]), new Date("2026-09-01T13:30:00.000Z"), "7d");
    expect(result.learningStatus).toBe("no-learning-yet");
    expect(result.learningReason).toMatch(/No creative has a captured 7d snapshot yet/);
  });

  it("learns once several creatives share a captured window", async () => {
    const root = await storeRoot();
    for (const id of ["creative-1", "creative-2", "creative-3"]) {
      await publishedCreative(root, id, `post-${id}`);
    }
    const now = new Date("2026-09-01T13:30:00.000Z");
    await pass(root, transportOf([views(100), views(200), views(300)]), now);

    const result = await pass(root, transportOf([]), new Date("2026-09-01T13:35:00.000Z"));
    expect(result.learningStatus).toBe("learned");
    expect(result.learning).not.toBeNull();
    expect(result.scan.eligible).toHaveLength(3);
  });
});

describe("the pass renders what it found", () => {
  it("names skipped creatives, missed windows and the no-learning reason", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint("creative-1"));
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });

    const text = formatAnalyticsPass(await pass(root, transportOf([]), new Date("2026-09-02T00:00:00.000Z")));
    expect(text).toContain("skipped creative-1: not-published");
    expect(text).toContain("No learning yet");
  });

  it("scans an empty store without inventing anything", async () => {
    const root = await storeRoot();
    expect(await scanEligiblePublications(root)).toEqual({ eligible: [], skipped: [] });
  });
});
