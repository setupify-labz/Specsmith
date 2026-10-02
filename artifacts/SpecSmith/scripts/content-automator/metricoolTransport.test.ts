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
  createMetricoolRestProvider,
  metricoolCredentialsFromEnv,
  publishAuthorizedDraft,
  type MetricoolTransport,
} from "./metricoolClient.ts";
import {
  collectDueAnalytics,
  runLearningFromStoredSnapshots,
  type KnownPublication,
} from "./metricoolAnalyticsCollector.ts";
import { eligibilityFor } from "./analyticsOrchestrator.ts";
import {
  createStoredPublicationLedger,
  initPublicationStore,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import { evaluateLiveSmokeGate, runLiveSmoke } from "./metricoolLiveSmoke.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";
import {
  buildProviderRequest,
  loadAuthorization,
  reconcileSubmission,
  seedSimulatedLedger,
  type ProviderPublicationRequest,
} from "./v2/publication/boundary.ts";
import type { ReviewSubmission } from "./v2/review/inputs.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(mode: "simulation" | "production" = "simulation"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-metricool-"));
  roots.push(root);
  // The transport below is a fake, so the provider built on it is labelled
  // simulated and lives in a labelled simulation store. A production store
  // refuses it (see "the provider and the store must agree").
  if (mode === "simulation") await initPublicationStore(root, "simulation", "Metricool adapter test with a fake transport");
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
const TITLE = "Is the Super worth it?";
const DESCRIPTION = "Is the Super worth it? Estimated FPS at 1440p High. Check yours at specsmithpc.com/compare";

/** An authorized creative, the request built for it, and its media on disk. */
async function authorized(platform: VideoPlatform = "youtube-shorts", root?: string): Promise<{ root: string; media: { path: string; sha256: string }; request: ProviderPublicationRequest }> {
  const store = root ?? await storeRoot();
  const media = await writeMedia(store, `real-bytes-${platform}`);
  const fp = fingerprint(platform);
  await createStoredPublicationLedger(store, fp);
  await seedSimulatedLedger({ storeRoot: store, creativeId: fp.creativeId, through: "publication-authorized", mediaSha256: media.sha256,
    variantId: `${platform}-1080x1920-30`, destination: { provider: "metricool", accountId: "blog-1", platform }, title: TITLE, description: DESCRIPTION });
  const authorization = (await loadAuthorization(store, fp.creativeId))!;
  const request = buildProviderRequest({
    authorization,
    submission: { creativeId: fp.creativeId, variant: { variantId: `${platform}-1080x1920-30` }, title: TITLE, description: DESCRIPTION } as ReviewSubmission,
    mediaUrl: "https://cdn.example.com/master.mp4",
    schedule: { localDateTime: "2026-09-20T10:00:00", timezone: "America/New_York" },
  });
  return { root: store, media, request };
}

const send = (request: ProviderPublicationRequest, root: string, mediaPath: string, transport: MetricoolTransport, creds = credentials) =>
  publishAuthorizedDraft(request, { storeRoot: root, mediaPath, credentials: creds, transport, simulated: true });

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

  it("uses the token only in the request header: never in a result, the ledger or any stored file", async () => {
    const { root, media, request } = await authorized();
    const transport = fakeTransport([OK]);
    const report = await send(request, root, media.path, transport);
    expect(transport.calls[0].headers["X-Mc-Auth"]).toBe("secret-token");
    expect(transport.calls[0].body).not.toContain("secret-token");
    expect(JSON.stringify(report)).not.toContain("secret-token");
    const { readdir, readFile } = await import("node:fs/promises");
    const walk = async (dir: string): Promise<string[]> => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])))).flat();
    for (const file of await walk(root)) expect(await readFile(file, "utf8"), file).not.toContain("secret-token");
  });
});

describe("only the authorized draft is sent", () => {
  it("sends a draft (draft=true, autoPublish=false) carrying the reviewed text, title, account and media", async () => {
    const { root, media, request } = await authorized();
    const transport = fakeTransport([OK]);
    const report = await send(request, root, media.path, transport);
    expect(report).toMatchObject({ kind: "accepted", status: "draft-submitted", providerPostId: "post-123" });
    const sent = JSON.parse(transport.calls[0].body);
    expect(sent).toMatchObject({ draft: true, autoPublish: false, text: DESCRIPTION, youtubeTitle: TITLE, media: ["https://cdn.example.com/master.mp4"],
      date: "2026-09-20T10:00:00", timezone: "America/New_York", providers: [{ network: "youtube" }] });
    expect(transport.calls[0].url).toContain("blogId=blog-1");
  });

  it("refuses when the file changed after authorization, and sends nothing", async () => {
    const { root, media, request } = await authorized();
    await writeFile(media.path, "different-bytes-after-authorization");
    const transport = fakeTransport([OK]);
    await expect(send(request, root, media.path, transport)).rejects.toMatchObject({ code: "media-changed" });
    expect(transport.calls, "a refused request must never reach the network").toHaveLength(0);
  });

  it("refuses a request altered after it was built (title, account, mode), and sends nothing", async () => {
    const { root, media, request } = await authorized();
    const transport = fakeTransport([OK]);
    for (const altered of [
      { ...request, title: "A punchier, unreviewed title" },
      { ...request, destination: { ...request.destination, accountId: "someone-elses-account" } },
      { ...request, mode: "public" as never },
    ]) {
      await expect(send(altered, root, media.path, transport)).rejects.toMatchObject({ code: "request-mismatch" });
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses to build a request for a revised title or description", async () => {
    const { root } = await authorized();
    const authorization = (await loadAuthorization(root, "creative-youtube-shorts"))!;
    expect(() => buildProviderRequest({ authorization, mediaUrl: "https://cdn.example.com/m.mp4",
      submission: { creativeId: "creative-youtube-shorts", variant: { variantId: "youtube-shorts-1080x1920-30" }, title: TITLE, description: `${DESCRIPTION} Now 20% off!` } as ReviewSubmission,
    })).toThrow(/differs from the one reviewed and authorized/);
  });
});

describe("retries never create a duplicate post", () => {
  it("returns the accepted post instead of sending again", async () => {
    const { root, media, request } = await authorized();
    const transport = fakeTransport([OK, OK]);
    await send(request, root, media.path, transport);
    const again = await send(request, root, media.path, transport);
    expect(again).toMatchObject({ kind: "already-accepted", providerPostId: "post-123" });
    expect(transport.calls, "the second attempt must not reach the network").toHaveLength(1);
  });

  it("records the provider's post id against the idempotency key, in the append-only ledger", async () => {
    const { root, media, request } = await authorized();
    await send(request, root, media.path, fakeTransport([OK]));
    const ledger = (await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!;
    expect(ledger.events.slice(-2).map((event) => event.status)).toEqual(["submission-started", "draft-submitted"]);
    expect(ledger.events.at(-1)).toMatchObject({ providerPostId: "post-123", evidence: { idempotencyKey: request.idempotencyKey, confirmedBy: "provider-response" }, simulated: true });
  });
});

describe("every answer is recorded as what it proves", () => {
  const definite: { name: string; response: { status: number; body: string } }[] = [
    { name: "auth failure", response: { status: 401, body: "{}" } },
    { name: "forbidden", response: { status: 403, body: "{}" } },
    { name: "a refused draft", response: { status: 422, body: "{\"error\":\"bad media\"}" } },
  ];
  for (const testCase of definite) {
    it(`${testCase.name}: a definite refusal, recorded as submission-failed; a retry is allowed`, async () => {
      const { root, media, request } = await authorized();
      const transport = fakeTransport([testCase.response, OK]);
      expect(await send(request, root, media.path, transport)).toMatchObject({ kind: "rejected" });
      const ledger = (await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!;
      expect(ledger.events.at(-1)!.status).toBe("submission-failed");
      expect(ledger.events.some((event) => event.status === "scheduled" || event.status === "draft-submitted")).toBe(false);
      expect(await send(request, root, media.path, transport)).toMatchObject({ kind: "accepted", providerPostId: "post-123" });
    });
  }

  const uncertain: { name: string; response: { status: number; body: string } }[] = [
    { name: "a server error", response: { status: 500, body: "boom" } },
    { name: "a non-JSON body", response: { status: 200, body: "<html>" } },
    { name: "JSON that is not an object", response: { status: 200, body: "[1,2,3]" } },
    // The dangerous one: accepted, but no post to record. It may exist.
    { name: "a 2xx with no post id", response: { status: 200, body: JSON.stringify({ data: {} }) } },
  ];
  for (const testCase of uncertain) {
    it(`${testCase.name}: recorded as submission-unknown, and a blind retry is refused`, async () => {
      const { root, media, request } = await authorized();
      const transport = fakeTransport([testCase.response, OK]);
      expect(await send(request, root, media.path, transport)).toMatchObject({ kind: "unknown" });
      await expect(send(request, root, media.path, transport)).rejects.toMatchObject({ code: "outcome-unknown" });
      expect(transport.calls).toHaveLength(1);
      // Metricool offers no verified lookup by idempotency key, so reconciliation
      // cannot resolve it: a person must check Metricool by hand.
      const reconciled = await reconcileSubmission({ storeRoot: root, creativeId: "creative-youtube-shorts", provider: createMetricoolRestProvider({ credentials, transport, simulated: true }) });
      expect(reconciled.resolved).toBe(false);
      expect(reconciled.reason).toMatch(/unsupported/);
    });
  }

  it("a transport that throws after sending is unknown, not failed", async () => {
    const { root, media, request } = await authorized();
    const transport = (async () => { throw new Error("socket hang up"); }) as MetricoolTransport;
    expect(await send(request, root, media.path, transport)).toMatchObject({ kind: "unknown", reason: expect.stringMatching(/socket hang up/) });
  });

  it("refuses when no ledger exists for the creative", async () => {
    const root = await storeRoot();
    const media = await writeMedia(root, "real-bytes");
    const transport = fakeTransport([OK]);
    await expect(send({ creativeId: "creative-youtube-shorts" } as ProviderPublicationRequest, root, media.path, transport)).rejects.toMatchObject({ code: "no-ledger" });
    expect(transport.calls).toHaveLength(0);
  });

  // Without REST credentials the adapter is UNAVAILABLE, which is the state on
  // the founder's current Metricool plan, and the first thing checked.
  it("refuses as unavailable when no REST credentials exist", async () => {
    const { root, media, request } = await authorized();
    const transport = fakeTransport([OK]);
    await expect(send(request, root, media.path, transport, { userToken: "", userId: "" })).rejects.toMatchObject({ code: "rest-unavailable" });
    expect(transport.calls).toHaveLength(0);
    expect((await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!.events.at(-1)!.status).toBe("publication-authorized");
  });
});

describe("the provider and the store must agree", () => {
  it("a fake transport cannot act on a production store, and a real one cannot act on a simulation store", async () => {
    const production = await storeRoot("production");
    await createStoredPublicationLedger(production, fingerprint());
    const transport = fakeTransport([OK]);
    await expect(publishAuthorizedDraft({ creativeId: "creative-youtube-shorts" } as ProviderPublicationRequest,
      { storeRoot: production, mediaPath: "/nonexistent", credentials, transport, simulated: true })).rejects.toMatchObject({ code: "provider-mode-mismatch" });
    const { root, media, request } = await authorized();
    await expect(publishAuthorizedDraft(request, { storeRoot: root, mediaPath: media.path, credentials, transport }))
      .rejects.toMatchObject({ code: "provider-mode-mismatch" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("all three platforms send their own draft shape", () => {
  for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as VideoPlatform[]) {
    it(`sends a ${platform} draft`, async () => {
      const { root, media, request } = await authorized(platform);
      const transport = fakeTransport([OK]);
      const report = await send(request, root, media.path, transport);
      expect(report).toMatchObject({ kind: "accepted", providerPostId: "post-123" });
      const sent = JSON.parse(transport.calls[0].body);
      expect(sent.providers).toEqual([{ network: platform === "youtube-shorts" ? "youtube" : platform === "tiktok" ? "tiktok" : "instagram" }]);
      if (platform === "youtube-shorts") expect(sent.youtubeTitle).toBe(TITLE);
      if (platform === "tiktok") expect(sent.tiktokTitle).toBe(TITLE);
      if (platform === "instagram-reels") expect(sent.contentType).toBe("REEL");
    });
  }
});

// ---------------------------------------------------------------------------
// Analytics collection.
// ---------------------------------------------------------------------------

const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";

/** A simulation store whose ledger is seeded to a published post: these tests are about analytics, after publication. */
async function publishedLedgerRoot(through: "scheduled" | "published" = "published"): Promise<string> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint());
  await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-youtube-shorts", through, providerPostId: "post-123", at: new Date(PUBLISHED_AT),
    mediaSha256: "a".repeat(64), variantId: "youtube-shorts-1080x1920-30", destination: { provider: "metricool", accountId: "blog-1", platform: "youtube-shorts" }, title: TITLE, description: DESCRIPTION });
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
    const root = await publishedLedgerRoot("scheduled");
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
    const root = await storeRoot("production");
    // A request that would otherwise be refused for having no ledger — proving
    // we exit before any work, not merely before the network.
    await runLiveSmoke({ creativeId: "nothing" } as ProviderPublicationRequest, root, join(root, "nope.mp4"), {} as NodeJS.ProcessEnv, {});
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
