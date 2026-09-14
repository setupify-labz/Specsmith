// Analytics arriving through the ChatGPT/Metricool connector.
//
// No network anywhere: this boundary validates a document someone else
// obtained. Most of these tests are refusals, because the value of the
// boundary is that a number cannot be attributed to a creative that did not
// earn it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANALYTICS_RESULT_KIND,
  ANALYTICS_RESULT_VERSION,
  analyticsResultTemplate,
  ingestConnectorAnalytics,
  parseAnalyticsResult,
  type AnalyticsResultDocument,
} from "./connectorAnalyticsIngestion.ts";
import { runLearningFromStoredSnapshots } from "./metricoolAnalyticsCollector.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredAnalyticsSnapshots,
} from "./publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-connector-"));
  roots.push(root);
  return root;
}

function fingerprint(creativeId = "creative-1", platform: VideoPlatform = "youtube-shorts"): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId, packageId: "package-1", campaignId: "campaign-1", ideaId: "idea-1", platform,
    format: "comparison", feature: "compare", subjectIds: ["gpu-1", "gpu-2"],
    hookFamily: "price-gap-comparison", hookText: "Worth it?", visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer", targetDurationSeconds: 24, beatCount: 4,
    plannedBeatChangesPer10Seconds: 1.5, editDensity: "high", captionedBeatRatio: 0.5,
    captionDensity: "medium", firstVisualType: "generated-cinematic", sfxDensity: "medium",
    ctaFamily: "compare-on-specsmithpc", ctaTimingBucket: "late", hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC"], experimentId: "experiment-1", experimentPrimaryMetric: "retention",
    changedVariable: "hook", contentFreshness: "evergreen",
  } as CreativeFingerprint;
}

const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";
const AFTER_1H = "2026-09-01T13:05:00.000Z";
const NOW_1H = new Date("2026-09-01T13:10:00.000Z");

async function publishedStore(creativeId = "creative-1", postId = "post-1", platform: VideoPlatform = "youtube-shorts"): Promise<string> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint(creativeId, platform));
  await advanceStoredPublicationLedger(root, creativeId, { status: "qc-passed" });
  await advanceStoredPublicationLedger(root, creativeId, { status: "scheduled", providerPostId: postId });
  await advanceStoredPublicationLedger(root, creativeId, { status: "published", at: PUBLISHED_AT });
  return root;
}

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: ANALYTICS_RESULT_KIND,
    version: ANALYTICS_RESULT_VERSION,
    creativeId: "creative-1",
    platform: "youtube-shorts",
    packageId: "package-1",
    providerPostId: "post-1",
    window: "1h",
    capturedAt: AFTER_1H,
    metrics: { views: 1200, likes: 80, comments: 5, shares: 12 },
    ...overrides,
  };
}

describe("a real connector reading becomes an immutable snapshot", () => {
  it("records the metrics the connector actually returned", async () => {
    const root = await publishedStore();
    const outcome = await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });

    expect(outcome.replayed).toBe(false);
    expect(outcome.snapshot.window).toBe("1h");
    expect(outcome.snapshot.videoId).toBe("post-1");
    expect(outcome.snapshot.record.views).toBe(1200);
    expect(outcome.snapshot.record.likes).toBe(80);

    const stored = await loadStoredAnalyticsSnapshots(root, "creative-1");
    expect(stored).toHaveLength(1);
  });

  it("flows into the existing learner through selectLearnerRecords", async () => {
    const root = await publishedStore();
    await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });

    const run = await runLearningFromStoredSnapshots(root, ["creative-1"], "1h", NOW_1H);
    expect(run.selection.records).toHaveLength(1);
    expect(run.selection.records[0].snapshotWindow).toBe("1h");
    expect(run.learning).toBeDefined();
  });

  it("offers a template pre-filled with identity and no invented metric values", async () => {
    const root = await publishedStore();
    const template = await analyticsResultTemplate(root, "creative-1", "24h");

    expect(template).toMatchObject({ creativeId: "creative-1", platform: "youtube-shorts", providerPostId: "post-1", window: "24h" });
    const metrics = template.metrics as Record<string, unknown>;
    expect(String(metrics.views)).toContain("REQUIRED");
    expect(String(metrics.likes)).toContain("unavailable");
    expect(String(metrics.likes)).toContain("NEVER 0");
    expect(JSON.stringify(template._instructions)).toContain("do not round, derive, or infer".replace("do", "Do"));
  });
});

describe("NEGATIVE CONTROLS", () => {
  it("rejects analytics for a creative that was never published", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });
    await advanceStoredPublicationLedger(root, "creative-1", { status: "scheduled", providerPostId: "post-1" });

    await expect(ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "not-published" });
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(0);
  });

  it("rejects a wrong provider post id", async () => {
    const root = await publishedStore();
    await expect(ingestConnectorAnalytics(doc({ providerPostId: "post-SOMEONE-ELSE" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "provider-post-mismatch" });
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(0);
  });

  it("rejects a wrong creative", async () => {
    const root = await publishedStore();
    await expect(ingestConnectorAnalytics(doc({ creativeId: "creative-other" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("rejects a wrong platform", async () => {
    const root = await publishedStore();
    await expect(ingestConnectorAnalytics(doc({ platform: "tiktok" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("rejects a wrong package", async () => {
    const root = await publishedStore();
    await expect(ingestConnectorAnalytics(doc({ packageId: "package-other" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("rejects a window that is not due yet", async () => {
    const root = await publishedStore();
    // A 24h reading cannot exist 65 minutes after publication.
    await expect(ingestConnectorAnalytics(doc({ window: "24h" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "window-not-due" });
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(0);
  });

  it("rejects an impossible capture time", async () => {
    const root = await publishedStore();
    await expect(ingestConnectorAnalytics(doc({ capturedAt: "2026-08-30T00:00:00.000Z" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "impossible-capture-time" });
    await expect(ingestConnectorAnalytics(doc({ capturedAt: "2027-01-01T00:00:00.000Z" }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "impossible-capture-time" });
  });

  it("refuses to let a missing metric become zero", async () => {
    // The dangerous shape: a connector field that came back empty.
    expect(() => parseAnalyticsResult(doc({ metrics: { views: 1200, likes: null } })))
      // null is treated as absent, not as 0 — and absent means no property.
      .not.toThrow();
    const parsed = parseAnalyticsResult(doc({ metrics: { views: 1200, likes: null } }));
    expect("likes" in parsed.metrics).toBe(false);

    // An explicit non-numeric placeholder is refused rather than coerced.
    expect(() => parseAnalyticsResult(doc({ metrics: { views: 1200, likes: "" } }))).toThrow(/never substitute 0/i);
    expect(() => parseAnalyticsResult(doc({ metrics: { views: 1200, likes: "n/a" } }))).toThrow(/never substitute 0/i);
  });

  it("keeps an unavailable metric off the record entirely, distinct from zero", async () => {
    const root = await publishedStore();
    const outcome = await ingestConnectorAnalytics(
      doc({ metrics: { views: 1200, likes: "unavailable", comments: 0 } }),
      { storeRoot: root, now: NOW_1H },
    );
    const record = outcome.snapshot.record as Record<string, unknown>;
    expect("likes" in record, "an unavailable metric must not appear at all").toBe(false);
    // A real zero is preserved as a real zero.
    expect(record.comments).toBe(0);
  });

  it("refuses a result with no view count rather than inventing one", async () => {
    expect(() => parseAnalyticsResult(doc({ metrics: { likes: 5 } }))).toThrow(/views must be a non-negative number/);
    expect(() => parseAnalyticsResult(doc({ metrics: { views: "unavailable" } }))).toThrow(/views must be a non-negative number/);
  });

  it("is idempotent on an exact duplicate", async () => {
    const root = await publishedStore();
    const first = await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });
    const second = await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1"), "one window, one snapshot").toHaveLength(1);
  });

  it("fails closed on a conflicting replay", async () => {
    const root = await publishedStore();
    await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });

    await expect(ingestConnectorAnalytics(doc({ metrics: { views: 9999 } }), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "replayed-with-different-data" });

    const stored = await loadStoredAnalyticsSnapshots(root, "creative-1");
    expect(stored[0].record.views, "the original measurement is unchanged").toBe(1200);
  });

  it("refuses an unattributable connector response", async () => {
    expect(() => parseAnalyticsResult({ kind: "SOMETHING_ELSE" })).toThrow(/kind must be/);
    expect(() => parseAnalyticsResult(doc({ creativeId: "" }))).toThrow(/creativeId is required/);
    expect(() => parseAnalyticsResult(doc({ providerPostId: "" }))).toThrow(/providerPostId is required/);
    expect(() => parseAnalyticsResult(doc({ window: "30d" }))).toThrow(/window must be one of/);
    expect(() => parseAnalyticsResult("not a document")).toThrow(/must be an object/);
  });

  it("cannot inflate sample size with several windows from one creative", async () => {
    const root = await publishedStore();
    await ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H });
    await ingestConnectorAnalytics(
      doc({ window: "6h", capturedAt: "2026-09-01T18:30:00.000Z", metrics: { views: 5000 } }),
      { storeRoot: root, now: new Date("2026-09-01T18:35:00.000Z") },
    );
    await ingestConnectorAnalytics(
      doc({ window: "24h", capturedAt: "2026-09-02T12:30:00.000Z", metrics: { views: 9000 } }),
      { storeRoot: root, now: new Date("2026-09-02T12:35:00.000Z") },
    );
    expect(await loadStoredAnalyticsSnapshots(root, "creative-1")).toHaveLength(3);

    const run = await runLearningFromStoredSnapshots(root, ["creative-1"], "24h", new Date("2026-09-02T13:00:00.000Z"));
    expect(run.selection.records, "three windows, one creative, one record").toHaveLength(1);
    for (const learning of [...(run.learning?.byFormat ?? []), ...(run.learning?.byVisualWorld ?? [])]) {
      expect(learning.sampleSize).toBe(1);
    }
  });

  it("refuses a creative with no stored fingerprint rather than guessing attribution", async () => {
    const root = await publishedStore();
    const { readFile, writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const dir = join(root, "publication-ledgers", createHash("sha256").update("creative-1").digest("hex"));
    const first = JSON.parse(await readFile(join(dir, "000000.json"), "utf8")) as Record<string, unknown>;
    delete first.fingerprint;
    await writeFile(join(dir, "000000.json"), JSON.stringify(first, null, 2));

    await expect(ingestConnectorAnalytics(doc(), { storeRoot: root, now: NOW_1H }))
      .rejects.toMatchObject({ code: "no-stored-fingerprint" });
  });
});

describe("this boundary adds no network and no credentials", () => {
  it("imports nothing that can reach Metricool", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./connectorAnalyticsIngestion.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("metricoolClient");
    expect(code).not.toContain("METRICOOL_USER_TOKEN");
    expect(code).not.toContain("publishApprovedPackage");
    expect(code).not.toContain("https://app.metricool.com");
  });
});
