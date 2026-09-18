// The CLI boundary: argument validation, exit-code semantics, and both output
// shapes. The pass itself is tested in analyticsOrchestrator.test.ts; these
// tests pin the boundary, especially the rule that "no learning yet" is a
// success.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AnalyticsPassCliError,
  LEARNING_WINDOWS,
  formatCli,
  parseCliArgs,
  runCli,
  summarize,
} from "./analyticsPassCli.ts";
import type { MetricoolTransport } from "./metricoolClient.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
} from "./publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-cli-"));
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

const FULL_ENV = { METRICOOL_USER_TOKEN: "t", METRICOOL_USER_ID: "u" } as NodeJS.ProcessEnv;
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("the learning window must be chosen explicitly", () => {
  it("refuses a missing --window and names the options", () => {
    expect(() => parseCliArgs(["--store", "/tmp/x"], EMPTY_ENV)).toThrow(/--window is required and has no default/);
    try {
      parseCliArgs(["--store", "/tmp/x"], EMPTY_ENV);
    } catch (error) {
      expect((error as AnalyticsPassCliError).code).toBe("invalid-argument");
      expect((error as Error).message).toContain("1h, 6h, 24h, 72h, 7d");
    }
  });

  it("refuses a window that is not a snapshot window", () => {
    expect(() => parseCliArgs(["--store", "/tmp/x", "--window", "30d"], EMPTY_ENV)).toThrow(/is not a snapshot window/);
  });

  it("accepts every real window", () => {
    for (const window of LEARNING_WINDOWS) {
      expect(parseCliArgs(["--store", "/tmp/x", "--window", window], EMPTY_ENV).window).toBe(window);
    }
  });

  it("refuses a missing --store", () => {
    expect(() => parseCliArgs(["--window", "24h"], EMPTY_ENV)).toThrow(/--store <path> is required/);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(() => parseCliArgs(["--store", "/tmp/x", "--window", "24h", "--publish"], EMPTY_ENV))
      .toThrow(AnalyticsPassCliError);
  });
});

describe("collection is opt-in and fails closed on configuration", () => {
  it("does not require credentials in the default scan mode", () => {
    const invocation = parseCliArgs(["--store", "/tmp/x", "--window", "24h"], EMPTY_ENV);
    expect(invocation.collect).toBe(false);
  });

  it("refuses --collect without --blog-id", () => {
    expect(() => parseCliArgs(["--store", "/tmp/x", "--window", "24h", "--collect"], FULL_ENV))
      .toThrow(/--collect requires --blog-id/);
  });

  it("refuses --collect without credentials, and says why they may not exist", () => {
    try {
      parseCliArgs(["--store", "/tmp/x", "--window", "24h", "--collect", "--blog-id", "b"], EMPTY_ENV);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AnalyticsPassCliError).code).toBe("missing-configuration");
      expect((error as Error).message).toMatch(/current Metricool plan exposes no API access/);
    }
  });

  it("accepts --collect when both are present", () => {
    const invocation = parseCliArgs(["--store", "/tmp/x", "--window", "24h", "--collect", "--blog-id", "b"], FULL_ENV);
    expect(invocation).toMatchObject({ collect: true, blogId: "b" });
  });
});

describe("no-learning-yet is a success, not a failure", () => {
  it("returns a reasoned no-learning-yet for an empty store without throwing", async () => {
    const root = await storeRoot();
    const { summary } = await runCli(parseCliArgs(["--store", root, "--window", "24h"], EMPTY_ENV));

    expect(summary.learningStatus).toBe("no-learning-yet");
    expect(summary.learningReason).toMatch(/No creative has a published ledger event/);
    expect(summary.recommendations).toEqual([]);
  });

  it("reports a creative that is not published as skipped, still without throwing", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });

    const { summary } = await runCli(parseCliArgs(["--store", root, "--window", "24h"], EMPTY_ENV));
    expect(summary.skipped).toEqual([{ creativeId: "creative-1", reason: "not-published" }]);
    expect(summary.learningStatus).toBe("no-learning-yet");
  });
});

describe("scan mode touches no network", () => {
  it("fetches nothing even when a transport is available", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });
    await advanceStoredPublicationLedger(root, "creative-1", { status: "scheduled", providerPostId: "post-1" });
    await advanceStoredPublicationLedger(root, "creative-1", { status: "published", at: "2026-09-01T12:00:00.000Z" });

    let calls = 0;
    const transport = (async () => {
      calls += 1;
      return { status: 200, text: async () => "{}" };
    }) as MetricoolTransport;

    const { summary } = await runCli(
      parseCliArgs(["--store", root, "--window", "24h"], EMPTY_ENV),
      { transport, now: new Date("2026-09-03T00:00:00.000Z") },
    );

    expect(calls, "scan mode must not fetch").toBe(0);
    // It reports no collection attempt — not a collection that found zero.
    expect(summary.captured).toEqual([]);
    expect(summary.notCaptured).toEqual([]);
    expect(summary.eligible).toBe(1);
  });

  it("refuses --collect at runCli when no transport is supplied", async () => {
    const root = await storeRoot();
    await expect(runCli(
      { storeRoot: root, window: "24h", collect: true, blogId: "b", json: false },
      { env: FULL_ENV },
    )).rejects.toThrow(/No analytics transport/);
  });
});

describe("both output shapes describe the same result", () => {
  it("produces machine-readable JSON with the fields an operator needs", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-1", { status: "qc-passed" });

    const { summary, result } = await runCli(parseCliArgs(["--store", root, "--window", "6h"], EMPTY_ENV));
    const parsed = JSON.parse(JSON.stringify(summary));

    expect(parsed).toMatchObject({
      mode: "scan",
      window: "6h",
      eligible: 0,
      learningStatus: "no-learning-yet",
    });
    expect(Array.isArray(parsed.skipped)).toBe(true);
    expect(Array.isArray(parsed.missed)).toBe(true);
    expect(Array.isArray(parsed.excludedFromLearning)).toBe(true);

    // The human rendering is derived from the same result, not a second source.
    const text = formatCli(summary, result);
    expect(text).toContain("mode=scan window=6h");
    expect(text).toContain("No learning yet");
  });

  it("summarize separates captured from not-captured without inventing either", () => {
    const summary = summarize({
      collection: {
        outcomes: [
          { status: "captured", creativeId: "c1", window: "1h", snapshot: {} as never },
          { status: "failed", creativeId: "c2", window: "1h", detail: "HTTP 500" },
          { status: "no-data", creativeId: "c3", window: "1h", detail: "no attributable row" },
          { status: "not-due", creativeId: "c4" },
        ],
        missed: [{ creativeId: "c5", windows: ["1h"] }],
      },
      scan: { eligible: [], skipped: [] },
      learningWindow: "1h",
      learning: null,
      learningStatus: "no-learning-yet",
      excludedFromLearning: [],
    } as never, "collect");

    expect(summary.captured).toEqual([{ creativeId: "c1", window: "1h" }]);
    expect(summary.notCaptured.map((entry) => entry.creativeId)).toEqual(["c2", "c3"]);
    expect(summary.missed).toEqual([{ creativeId: "c5", windows: ["1h"] }]);
    // not-due is neither captured nor a failure.
    expect(summary.captured.concat(summary.notCaptured as never).some((entry) => entry.creativeId === "c4")).toBe(false);
  });
});

describe("the CLI adds no publishing surface", () => {
  it("cannot post, publish, schedule or hold credentials of its own", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./analyticsPassCli.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");

    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("publishApprovedPackage");
    expect(code).not.toContain("prepareReadyToPublishHandoff");
    expect(code).not.toContain("ingestPublishResult");
    expect(code).not.toContain("advanceStoredPublicationLedger");
    // It reads the existing env helper; it never defines a credential itself.
    expect(code).not.toMatch(/METRICOOL_USER_TOKEN\s*[:=]\s*["']/);
  });
});
