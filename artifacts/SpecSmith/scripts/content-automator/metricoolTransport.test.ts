// The Metricool transport and analytics collector, exercised entirely against
// an injected fake. NOTHING here touches the network, and no test in this file
// can spend money: `transport` is a function the test supplies, and the real
// modules have no other way to reach the internet.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MetricoolPublishError,
  metricoolCredentialsFromEnv,
  publishApprovedPackage,
  type ApprovedPublicationPackage,
  type MetricoolTransport,
} from "./metricoolClient.ts";
import {
  collectDueAnalytics,
  runLearningFromStoredSnapshots,
  type KnownPublication,
} from "./metricoolAnalyticsCollector.ts";
import { eligibilityFor } from "./analyticsOrchestrator.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import type { MetricoolPublishingRequest } from "./publishing.ts";
import { evaluateLiveSmokeGate, runLiveSmoke } from "./metricoolLiveSmoke.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-metricool-"));
  roots.push(root);
  return root;
}

function fingerprint(platform: VideoPlatform = "youtube-shorts"): CreativeFingerprint {
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
    experimentId: "experiment-1",
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
  } as CreativeFingerprint;
}

/** Writes real bytes and returns their real digest — the digest is never hard-coded. */
async function writeMedia(root: string, contents: string): Promise<{ path: string; sha256: string }> {
  const path = join(root, "master.mp4");
  await writeFile(path, contents);
  return { path, sha256: createHash("sha256").update(contents).digest("hex") };
}

function request(sha256: string, overrides: Partial<MetricoolPublishingRequest> = {}): MetricoolPublishingRequest {
  const fp = fingerprint();
  return {
    requestId: "request-1",
    creativeId: fp.creativeId,
    packageId: fp.packageId,
    campaignId: fp.campaignId,
    ideaId: fp.ideaId,
    platform: fp.platform,
    blog_id: "blog-1",
    networks: ["youtube"],
    text: "caption",
    date: "2026-09-20T10:00:00",
    timezone: "America/New_York",
    media: ["https://cdn.example.com/master.mp4"],
    draft: true,
    trackedWebsiteUrl: "https://specsmithpc.com/compare?utm_content=creative-youtube-shorts",
    websiteCtaMode: "profile-link",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC"],
    finalMediaSha256: sha256,
    ...overrides,
  } as MetricoolPublishingRequest;
}

const credentials = { userToken: "secret-token", userId: "user-1" };

/** Records calls so a test can assert what was sent — and what was not. */
function fakeTransport(responses: { status: number; body: string }[]): MetricoolTransport & { calls: { url: string; body: string; headers: Record<string, string> }[] } {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fn = (async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    const next = responses.shift() ?? { status: 500, body: "{}" };
    return { status: next.status, text: async () => next.body };
  }) as MetricoolTransport & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

const OK = { status: 200, body: JSON.stringify({ data: { id: "post-123", uuid: "uuid-abc", url: "https://metricool.test/post-123" } }) };

async function ledgeredRoot(platform: VideoPlatform = "youtube-shorts"): Promise<string> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint(platform));
  await advanceStoredPublicationLedger(root, `creative-${platform}`, { status: "qc-passed" });
  return root;
}

describe("credentials never come from anywhere but the environment", () => {
  it("returns undefined when either half is absent", () => {
    expect(metricoolCredentialsFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(metricoolCredentialsFromEnv({ METRICOOL_USER_TOKEN: "t" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(metricoolCredentialsFromEnv({ METRICOOL_USER_ID: "u" } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("reads both halves when present", () => {
    expect(metricoolCredentialsFromEnv({ METRICOOL_USER_TOKEN: "t", METRICOOL_USER_ID: "u" } as NodeJS.ProcessEnv))
      .toEqual({ userToken: "t", userId: "u" });
  });

  it("never returns the token in a publish result", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);
    const result = await publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    );
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});

describe("the digest is re-verified against the real bytes immediately before publishing", () => {
  it("publishes when file, request and rights registry all agree", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);

    const result = await publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    );

    expect(result.verifiedSha256).toBe(media.sha256);
    expect(result.providerPostId).toBe("post-123");
    expect(transport.calls).toHaveLength(1);
  });

  it("refuses when the file changed after approval, and sends nothing", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    await writeFile(media.path, "different-bytes-after-approval");
    const transport = fakeTransport([OK]);

    await expect(publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "media-mismatch" });
    expect(transport.calls, "a rejected package must never reach the network").toHaveLength(0);
  });

  it("refuses when the request digest and the rights-approved digest disagree", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const other = createHash("sha256").update("some-other-render").digest("hex");
    const transport = fakeTransport([OK]);

    await expect(publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: other },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "media-mismatch" });
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses when the media file is missing entirely", async () => {
    const root = await ledgeredRoot();
    const transport = fakeTransport([OK]);
    await expect(publishApprovedPackage(
      { request: request("a".repeat(64)), mediaPath: join(root, "nope.mp4"), approvedMasterSha256: "a".repeat(64) },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "media-missing" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("safe mode is the default", () => {
  it("sends draft=true and autoPublish=false when no mode is given", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);

    const result = await publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    );

    expect(result.mode).toBe("draft");
    const sent = JSON.parse(transport.calls[0].body);
    expect(sent.draft).toBe(true);
    expect(sent.autoPublish).toBe(false);
  });

  it("queues a live post only when scheduled-live is asked for by name", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);

    await publishApprovedPackage(
      { request: request(media.sha256, { draft: false }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport, mode: "scheduled-live" },
    );

    expect(JSON.parse(transport.calls[0].body).autoPublish).toBe(true);
  });

  it("refuses a request whose own draft flag contradicts draft mode rather than guessing", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);

    await expect(publishApprovedPackage(
      { request: request(media.sha256, { draft: false }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "unsupported-platform-state" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("refuses a second publication for the same creative and platform", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK, OK]);
    const pkg: ApprovedPublicationPackage = { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 };

    await publishApprovedPackage(pkg, { storeRoot: root, credentials, transport });
    await expect(publishApprovedPackage(pkg, { storeRoot: root, credentials, transport }))
      .rejects.toMatchObject({ code: "already-published" });

    expect(transport.calls, "the second attempt must not reach the network").toHaveLength(1);
  });

  it("records the provider identifiers in the append-only ledger", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    await publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport: fakeTransport([OK]) },
    );

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    const scheduled = ledger?.events.at(-1);
    expect(scheduled?.status).toBe("scheduled");
    expect(scheduled?.providerPostId).toBe("post-123");
    expect(scheduled?.providerUuid).toBe("uuid-abc");
    expect(scheduled?.providerUrl).toBe("https://metricool.test/post-123");
  });
});

describe("it fails closed on every bad response", () => {
  const cases: { name: string; response: { status: number; body: string }; code: string }[] = [
    { name: "auth failure", response: { status: 401, body: "{}" }, code: "auth-failed" },
    { name: "forbidden", response: { status: 403, body: "{}" }, code: "auth-failed" },
    { name: "server error", response: { status: 500, body: "boom" }, code: "transport-failed" },
    { name: "non-JSON body", response: { status: 200, body: "<html>" }, code: "malformed-response" },
    { name: "JSON that is not an object", response: { status: 200, body: "[1,2,3]" }, code: "malformed-response" },
    // The dangerous one: accepted, but nothing can be recorded against it.
    { name: "2xx with no post id", response: { status: 200, body: JSON.stringify({ data: {} }) }, code: "malformed-response" },
  ];

  for (const testCase of cases) {
    it(`refuses on ${testCase.name} and writes no scheduled event`, async () => {
      const root = await ledgeredRoot();
      const media = await writeMedia(root, "real-bytes");
      await expect(publishApprovedPackage(
        { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
        { storeRoot: root, credentials, transport: fakeTransport([testCase.response]) },
      )).rejects.toMatchObject({ code: testCase.code });

      const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
      expect(ledger?.events.some((event) => event.status === "scheduled")).toBe(false);
    });
  }

  it("refuses an ambiguous or malformed schedule time", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);
    await expect(publishApprovedPackage(
      { request: request(media.sha256, { date: "2026-09-20T10:00:00Z" }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "scheduling-ambiguous" });
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses when no ledger exists for the creative", async () => {
    const root = await storeRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);
    await expect(publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials, transport },
    )).rejects.toMatchObject({ code: "unsupported-platform-state" });
    expect(transport.calls).toHaveLength(0);
  });

  // Without REST credentials the adapter is UNAVAILABLE, which is the state on
  // the founder's current Metricool plan — a stronger and more accurate refusal
  // than "credentials missing", and the first thing checked.
  it("refuses as unavailable when no REST credentials exist", async () => {
    const root = await ledgeredRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);
    await expect(publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials: { userToken: "", userId: "" }, transport },
    )).rejects.toMatchObject({ code: "rest-unavailable" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("all three platforms schedule", () => {
  for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as VideoPlatform[]) {
    it(`schedules ${platform}`, async () => {
      const root = await ledgeredRoot(platform);
      const media = await writeMedia(root, `bytes-${platform}`);
      const fp = fingerprint(platform);
      const req = request(media.sha256, {
        creativeId: fp.creativeId,
        platform,
        networks: [platform === "youtube-shorts" ? "youtube" : platform === "tiktok" ? "tiktok" : "instagram"],
      } as Partial<MetricoolPublishingRequest>);

      const result = await publishApprovedPackage(
        { request: req, mediaPath: media.path, approvedMasterSha256: media.sha256 },
        { storeRoot: root, credentials, transport: fakeTransport([OK]) },
      );
      expect(result.platform).toBe(platform);
      expect(result.providerPostId).toBe("post-123");
    });
  }
});

// ---------------------------------------------------------------------------
// Analytics collection.
// ---------------------------------------------------------------------------

const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";

async function publishedLedgerRoot(): Promise<string> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint());
  await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "qc-passed" });
  await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "scheduled", providerPostId: "post-123" });
  await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "published", at: PUBLISHED_AT });
  return root;
}

function known(): KnownPublication {
  return {
    creativeId: "creative-youtube-shorts",
    platform: "youtube-shorts",
    providerPostId: "post-123",
    publishedAt: PUBLISHED_AT,
    durationSeconds: 20,
    ideaId: "idea-1",
    fingerprint: fingerprint(),
  };
}

describe("analytics are collected only for real, ledgered publications", () => {
  it("derives a known publication from a ledger that actually published", async () => {
    const root = await publishedLedgerRoot();
    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    const publication = await eligibilityFor(root, ledger!);
    expect(publication).toMatchObject({ providerPostId: "post-123" });
  });

  it("returns nothing for a ledger that is only scheduled, so it is never queried", async () => {
    const root = await ledgeredRoot();
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "scheduled", providerPostId: "post-123" });
    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(await eligibilityFor(root, ledger!)).toMatchObject({ reason: "not-published" });
  });

  it("captures the due window and stores it immutably", async () => {
    const root = await publishedLedgerRoot();
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ data: { YTVP06: 1234 } }) }]);
    const now = new Date("2026-09-01T13:30:00.000Z"); // past 1h, before 6h

    const report = await collectDueAnalytics([known()], { storeRoot: root, credentials, transport, blogId: "blog-1", now });
    const captured = report.outcomes.find((outcome) => outcome.status === "captured");
    expect(captured).toBeTruthy();
    expect(captured && "window" in captured && captured.window).toBe("1h");

    // Re-running does not re-query or rewrite the captured window.
    const again = await collectDueAnalytics([known()], { storeRoot: root, credentials, transport, blogId: "blog-1", now });
    expect(again.outcomes[0].status).toBe("not-due");
  });

  it("queries only the ledgered post id", async () => {
    const root = await publishedLedgerRoot();
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ data: { YTVP06: 10 } }) }]);
    await collectDueAnalytics([known()], {
      storeRoot: root, credentials, transport, blogId: "blog-1", now: new Date("2026-09-01T13:30:00.000Z"),
    });
    expect(transport.calls[0].url).toContain("post-123");
  });

  it("records no snapshot when the provider returns no attributable row", async () => {
    const root = await publishedLedgerRoot();
    // Two rows: which one belongs to this creative is not knowable, so neither is used.
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ data: [{ YTVP06: 1 }, { YTVP06: 2 }] }) }]);
    const report = await collectDueAnalytics([known()], {
      storeRoot: root, credentials, transport, blogId: "blog-1", now: new Date("2026-09-01T13:30:00.000Z"),
    });
    expect(report.outcomes[0].status).toBe("no-data");
  });

  it("records no snapshot when the request fails, rather than a zeroed one", async () => {
    const root = await publishedLedgerRoot();
    const transport = fakeTransport([{ status: 500, body: "boom" }]);
    const report = await collectDueAnalytics([known()], {
      storeRoot: root, credentials, transport, blogId: "blog-1", now: new Date("2026-09-01T13:30:00.000Z"),
    });
    expect(report.outcomes[0].status).toBe("failed");
  });

  it("names a permanently missed window instead of back-filling it", async () => {
    const root = await publishedLedgerRoot();
    const transport = fakeTransport([{ status: 200, body: JSON.stringify({ data: { YTVP06: 5000 } }) }]);
    // Well past 6h with nothing captured: 1h is gone for good.
    const now = new Date("2026-09-01T19:00:00.000Z");
    const report = await collectDueAnalytics([known()], { storeRoot: root, credentials, transport, blogId: "blog-1", now });

    expect(report.missed[0].windows).toContain("1h");
    const captured = report.outcomes.find((outcome) => outcome.status === "captured");
    // The capture taken now is stored as the window that is due NOW, never as the missed one.
    expect(captured && "window" in captured && captured.window).toBe("6h");
  });
});

describe("the learner is fed through selectLearnerRecords", () => {
  it("returns undefined learning when nothing has been measured, rather than an empty analysis", async () => {
    const root = await publishedLedgerRoot();
    const run = await runLearningFromStoredSnapshots(root, ["creative-youtube-shorts"], "24h");
    expect(run.selection.records).toHaveLength(0);
    expect(run.learning).toBeUndefined();
  });

  it("excludes a creative that has no snapshot at the requested window", async () => {
    const root = await publishedLedgerRoot();
    await collectDueAnalytics([known()], {
      storeRoot: root, credentials,
      transport: fakeTransport([{ status: 200, body: JSON.stringify({ data: { YTVP06: 1234 } }) }]),
      blogId: "blog-1", now: new Date("2026-09-01T13:30:00.000Z"),
    });

    const run = await runLearningFromStoredSnapshots(root, ["creative-youtube-shorts"], "24h");
    expect(run.selection.excluded[0]).toMatchObject({ creativeId: "creative-youtube-shorts", reason: "window-not-captured" });
    expect(run.selection.excluded[0].availableWindows).toEqual(["1h"]);
    expect(run.learning).toBeUndefined();
  });

  it("analyzes the one record per creative at the window that was captured", async () => {
    const root = await publishedLedgerRoot();
    await collectDueAnalytics([known()], {
      storeRoot: root, credentials,
      transport: fakeTransport([{ status: 200, body: JSON.stringify({ data: { YTVP06: 1234 } }) }]),
      blogId: "blog-1", now: new Date("2026-09-01T13:30:00.000Z"),
    });

    const run = await runLearningFromStoredSnapshots(root, ["creative-youtube-shorts"], "1h");
    expect(run.selection.records).toHaveLength(1);
    expect(run.learning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The live gate. These tests never set the real variables; they assert that
// every path except the fully-acknowledged one refuses.
// ---------------------------------------------------------------------------
describe("the live smoke gate is closed by default", () => {
  const full = {
    SPECSMITH_METRICOOL_LIVE: "i-understand-this-calls-metricool",
    METRICOOL_USER_TOKEN: "t",
    METRICOOL_USER_ID: "u",
  } as NodeJS.ProcessEnv;

  it("refuses with nothing set", () => {
    expect(evaluateLiveSmokeGate({} as NodeJS.ProcessEnv, {}).allowed).toBe(false);
  });

  it("refuses when the flag is missing even with full credentials", () => {
    expect(evaluateLiveSmokeGate(full, {}).allowed).toBe(false);
  });

  it("refuses when the acknowledgement is absent or wrong", () => {
    expect(evaluateLiveSmokeGate({ ...full, SPECSMITH_METRICOOL_LIVE: undefined }, { confirmLive: true }).allowed).toBe(false);
    expect(evaluateLiveSmokeGate({ ...full, SPECSMITH_METRICOOL_LIVE: "yes" }, { confirmLive: true }).allowed).toBe(false);
  });

  it("refuses when either credential half is missing", () => {
    expect(evaluateLiveSmokeGate({ ...full, METRICOOL_USER_TOKEN: undefined }, { confirmLive: true }).allowed).toBe(false);
    expect(evaluateLiveSmokeGate({ ...full, METRICOOL_USER_ID: undefined }, { confirmLive: true }).allowed).toBe(false);
  });

  it("opens only when all three are satisfied together", () => {
    expect(evaluateLiveSmokeGate(full, { confirmLive: true }).allowed).toBe(true);
  });

  it("runLiveSmoke makes no call when the gate is closed", async () => {
    const root = await storeRoot();
    // A package that would otherwise be rejected for missing media — proving we
    // exit before any work, not merely before the network.
    await runLiveSmoke(
      { request: request("a".repeat(64)), mediaPath: join(root, "nope.mp4"), approvedMasterSha256: "a".repeat(64) },
      root,
      {} as NodeJS.ProcessEnv,
      {},
    );
  });
});

// The transport is server-only by construction: it reads credentials and must
// never be bundled for the browser.
describe("server-only modules refuse a browser environment", () => {
  it("both modules guard on `window`", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["metricoolClient.ts", "metricoolAnalyticsCollector.ts"]) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
      const withoutComments = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
      expect(withoutComments, `${file} must refuse to load in a browser`).toContain('"window" in globalThis');
    }
  });

  it("no browser-reachable source imports them", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const srcRoot = new URL("../../src/", import.meta.url);
    const offenders: string[] = [];
    const walk = async (dir: URL): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) await walk(child);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const body = await readFile(child, "utf8");
          if (body.includes("metricoolClient") || body.includes("metricoolAnalyticsCollector")) offenders.push(entry.name);
        }
      }
    };
    await walk(srcRoot);
    expect(offenders, "app code must never import the Metricool transport").toEqual([]);
  });
});
