// The return leg: a result a person reports after releasing a handoff by hand.
//
// No network anywhere in this file, and none in the module under test. The
// typed document is a claim; the ledger advances only to what the provider
// itself confirms when asked (here a labelled simulated provider, in a
// simulation store). Most tests are refusals, because the whole value of this
// module is that publication state cannot be asserted into existence.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PUBLISH_RESULT_KIND,
  PUBLISH_RESULT_VERSION,
  ingestPublishResult,
  loadStoredResult,
  parsePublishResult,
  publishResultTemplate,
  type PublishResultDocument,
} from "./publicationResultIngestion.ts";
import { prepareReadyToPublishHandoff } from "./readyToPublishHandoff.ts";
import {
  createStoredPublicationLedger,
  initPublicationStore,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import { loadAuthorization, recordReportedProviderResult, seedSimulatedLedger, submitAuthorizedPublication } from "./v2/publication/boundary.ts";
import { createSimulatedProvider, type SimulatedProvider } from "./v2/publication/simulatedProvider.ts";
import { reportAllCreatives, reportCreativeStatus, formatStatusReport } from "./publicationStatusReport.ts";
import type { MetricoolPublishingRequest } from "./publishing.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-result-"));
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
    trackedWebsiteUrl: "https://specsmithpc.com/compare",
    websiteCtaMode: "profile-link",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC"],
    finalMediaSha256: sha256,
    ...overrides,
  } as MetricoolPublishingRequest;
}

/** A simulation store with an authorized ledger, ready to hand off. */
async function authorized(platform: VideoPlatform = "youtube-shorts"): Promise<{ root: string; sha256: string; path: string }> {
  const root = await storeRoot();
  await initPublicationStore(root, "simulation", "result ingestion test");
  await createStoredPublicationLedger(root, fingerprint(platform));
  const path = join(root, "master.mp4");
  await writeFile(path, `bytes-${platform}`);
  const sha256 = createHash("sha256").update(`bytes-${platform}`).digest("hex");
  await seedSimulatedLedger({ storeRoot: root, creativeId: `creative-${platform}`, through: "publication-authorized", mediaSha256: sha256,
    variantId: `${platform}-1080x1920-30`, destination: { provider: "metricool", accountId: "blog-1", platform }, title: "unused", description: "caption" });
  return { root, sha256, path };
}

/** ...and handed off: the release is in a person's hands. */
async function handedOff(platform: VideoPlatform = "youtube-shorts"): Promise<{ root: string; sha256: string; provider: SimulatedProvider; idempotencyKey: string }> {
  const { root, sha256, path } = await authorized(platform);
  const fp = fingerprint(platform);
  await prepareReadyToPublishHandoff(
    {
      request: request(sha256, { creativeId: fp.creativeId, platform, networks: [platform === "youtube-shorts" ? "youtube" : platform === "tiktok" ? "tiktok" : "instagram"] } as Partial<MetricoolPublishingRequest>),
      mediaPath: path,
      approvedMasterSha256: sha256,
    },
    { storeRoot: root },
  );
  // The post the person created in the provider, as the provider holds it:
  // they entered the handoff's idempotency key where the provider stores and
  // returns it, which is what lets the provider tie the post to this authorization.
  const { idempotencyKey } = (await loadAuthorization(root, fp.creativeId))!;
  const provider = createSimulatedProvider();
  provider.adopt({ providerPostId: "mc-post-1", mediaSha256: sha256, account: "blog-1", state: "scheduled", idempotencyKey });
  return { root, sha256, provider, idempotencyKey };
}

function result(sha256: string, overrides: Partial<PublishResultDocument> = {}): Record<string, unknown> {
  return {
    kind: PUBLISH_RESULT_KIND,
    version: PUBLISH_RESULT_VERSION,
    creativeId: "creative-youtube-shorts",
    platform: "youtube-shorts",
    handoffSha256: sha256,
    packageId: "package-1",
    status: "scheduled",
    occurredAt: "2026-09-20T14:05:00.000Z",
    providerPostId: "mc-post-1",
    providerUuid: "mc-uuid-1",
    providerUrl: "https://metricool.test/mc-post-1",
    ...overrides,
  } as Record<string, unknown>;
}

describe("a reported result is recorded only as the provider confirms it", () => {
  it("records the post the provider confirms, with the provider's own identifiers", async () => {
    const { root, sha256, provider } = await handedOff();
    const outcome = await ingestPublishResult(result(sha256), { storeRoot: root, provider });

    expect(outcome.replayed).toBe(false);
    const event = outcome.ledger.events.at(-1)!;
    expect(event.status).toBe("scheduled");
    expect(event.providerPostId).toBe("mc-post-1");
    expect(event.evidence).toMatchObject({ confirmedBy: "provider-lookup" });
    expect(event.simulated).toBe(true);
    // The typed document's URL and uuid are claims; the ledger holds only what the provider returned.
    expect(event.providerUuid).toBeUndefined();
    expect(outcome.handoff.packageId).toBe("package-1");
  });

  it("carries a creative to published once the provider confirms publication", async () => {
    const { root, sha256, provider } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    // Scheduled -> published is confirmed by asking the provider (confirmProviderState),
    // not by a second typed document: the result route answers a submission in progress.
    provider.advance("mc-post-1", "published");
    const { confirmProviderState } = await import("./v2/publication/boundary.ts");
    const confirmed = await confirmProviderState({ storeRoot: root, creativeId: "creative-youtube-shorts", provider });
    expect(confirmed.changed).toBe(true);
    expect(confirmed.ledger.events.at(-1)).toMatchObject({ status: "published", providerPostId: "mc-post-1", providerUrl: "https://simulated.invalid/post/mc-post-1" });
  });

  it("offers a template carrying no invented values", async () => {
    const { root, sha256 } = await handedOff();
    const status = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(status?.hasHandoff).toBe(true);
    const template = publishResultTemplate({
      creativeId: "creative-youtube-shorts", platform: "youtube-shorts", packageId: "package-1",
      media: { sha256 },
    } as never);
    expect(template.handoffSha256).toBe(sha256);
    expect(String(template.status)).toContain("what the connector actually reported");
    expect(String(template.providerPostId)).toContain("required for scheduled and published");
  });
});

describe("NEGATIVE CONTROLS: publication state cannot be asserted into existence", () => {
  it("refuses a typed result when no provider lookup is available, and records nothing", async () => {
    const { root, sha256 } = await handedOff();
    await expect(ingestPublishResult(result(sha256), { storeRoot: root })).rejects.toMatchObject({ code: "provider-unconfirmed" });
    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.at(-1)?.status).toBe("submission-started");
  });

  it("refuses a post id the provider does not hold", async () => {
    const { root, sha256, provider } = await handedOff();
    await expect(ingestPublishResult(result(sha256, { providerPostId: "made-up-post" } as Partial<PublishResultDocument>), { storeRoot: root, provider }))
      .rejects.toMatchObject({ code: "provider-unconfirmed" });
    expect((await loadStoredPublicationLedger(root, "creative-youtube-shorts"))?.events.some((event) => event.providerPostId)).toBe(false);
  });

  it("refuses a post the provider holds with other media", async () => {
    const { root, sha256, provider, idempotencyKey } = await handedOff();
    provider.adopt({ providerPostId: "mc-post-other-media", mediaSha256: "f".repeat(64), account: "blog-1", state: "scheduled", idempotencyKey });
    await expect(ingestPublishResult(result(sha256, { providerPostId: "mc-post-other-media" } as Partial<PublishResultDocument>), { storeRoot: root, provider }))
      .rejects.toThrow(/other media than the authorized bytes/);
  });

  it("ADVERSARIAL: an unrelated real post id is not attributed; the outcome stays unknown and nothing can be resent", async () => {
    const { root, sha256, provider } = await handedOff();
    // A real post the provider does hold, on the same account and even with the same bytes,
    // but made outside this authorization (by hand, without the handoff's key).
    provider.adopt({ providerPostId: "mc-post-unrelated", mediaSha256: sha256, account: "blog-1", state: "published" });
    await expect(ingestPublishResult(result(sha256, { status: "published", providerPostId: "mc-post-unrelated" } as Partial<PublishResultDocument>), { storeRoot: root, provider }))
      .rejects.toMatchObject({ code: "provider-unconfirmed", message: expect.stringMatching(/did not return the post's idempotency key.*outcome stays unknown/s) });
    const ledger = (await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!;
    expect(ledger.events.at(-1)).toMatchObject({ status: "submission-unknown" });
    expect(ledger.events.some((event) => event.providerPostId)).toBe(false);
    expect(await loadStoredResult(root, "creative-youtube-shorts", "youtube-shorts", "published")).toBeNull();
  });

  it("ADVERSARIAL: another authorization's post (its own key, same bytes) is not attributed", async () => {
    const { root, sha256, provider } = await handedOff();
    provider.adopt({ providerPostId: "mc-post-other-request", mediaSha256: sha256, account: "blog-1", state: "scheduled", idempotencyKey: "specsmith-another-authorization" });
    const report = await recordReportedProviderResult({ storeRoot: root, creativeId: "creative-youtube-shorts", reportedProviderPostId: "mc-post-other-request", provider });
    expect(report).toMatchObject({ kind: "unknown", reason: expect.stringMatching(/another request's idempotency key/) });
    expect(report.ledger.events.some((event) => event.providerPostId)).toBe(false);
  });

  it("ADVERSARIAL: a provider that returns the key but no media hash cannot confirm the bytes", async () => {
    const { root, provider, idempotencyKey } = await handedOff();
    provider.adopt({ providerPostId: "mc-post-no-hash", mediaSha256: "", account: "blog-1", state: "scheduled", idempotencyKey });
    const report = await recordReportedProviderResult({ storeRoot: root, creativeId: "creative-youtube-shorts", reportedProviderPostId: "mc-post-no-hash", provider });
    expect(report).toMatchObject({ kind: "unknown", reason: expect.stringMatching(/did not return the post's media hash/) });
  });

  it("after an unattributed report, a blind resend is still refused", async () => {
    const { root, sha256, provider } = await handedOff();
    provider.adopt({ providerPostId: "mc-post-unrelated", mediaSha256: sha256, account: "blog-1", state: "published" });
    await recordReportedProviderResult({ storeRoot: root, creativeId: "creative-youtube-shorts", reportedProviderPostId: "mc-post-unrelated", provider });
    await expect(submitAuthorizedPublication({ storeRoot: root, request: { creativeId: "creative-youtube-shorts" } as never, mediaPath: "/nonexistent", provider }))
      .rejects.toThrow(/no reliable outcome/);
  });

  it("records what the provider says, not a stronger claim: 'published' for a post still scheduled", async () => {
    const { root, sha256, provider } = await handedOff();
    await expect(ingestPublishResult(result(sha256, { status: "published" } as Partial<PublishResultDocument>), { storeRoot: root, provider }))
      .rejects.toThrow(/reports "published", but the provider confirms "scheduled"/);
    const ledger = (await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!;
    expect(ledger.events.at(-1)!.status).toBe("scheduled");
    expect(ledger.events.some((event) => event.status === "published")).toBe(false);
  });

  it("keeps a reported failure as an unknown outcome, so nothing is resent blind", async () => {
    const { root, sha256, provider } = await handedOff();
    const outcome = await ingestPublishResult(result(sha256, { status: "failed", note: "connector said upload failed", providerPostId: undefined } as Partial<PublishResultDocument>), { storeRoot: root, provider });
    expect(outcome.ledger.events.at(-1)).toMatchObject({ status: "submission-unknown" });
    expect(String(outcome.ledger.events.at(-1)!.evidence?.reason)).toMatch(/unconfirmed/);
  });

  it("rejects a result for a creative that has no handoff", async () => {
    const { root } = await authorized();
    await expect(ingestPublishResult(result("a".repeat(64)), { storeRoot: root, provider: createSimulatedProvider() }))
      .rejects.toMatchObject({ code: "no-matching-handoff" });
    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.some((event) => event.status === "scheduled")).toBe(false);
  });

  it("rejects a result naming the wrong creative", async () => {
    const { root, sha256, provider } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { creativeId: "creative-someone-else" } as Partial<PublishResultDocument>),
      { storeRoot: root, provider },
    )).rejects.toMatchObject({ code: "no-matching-handoff" });
  });

  it("rejects a result naming the wrong platform", async () => {
    const { root, sha256, provider } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { platform: "tiktok" } as Partial<PublishResultDocument>),
      { storeRoot: root, provider },
    )).rejects.toMatchObject({ code: "no-matching-handoff" });
  });

  it("rejects a result whose handoff SHA-256 does not match", async () => {
    const { root, provider } = await handedOff();
    const otherRender = createHash("sha256").update("a-different-render").digest("hex");
    await expect(ingestPublishResult(result(otherRender), { storeRoot: root, provider }))
      .rejects.toMatchObject({ code: "handoff-sha-mismatch" });
    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.some((event) => event.status === "scheduled")).toBe(false);
  });

  it("rejects a result naming a different package", async () => {
    const { root, sha256, provider } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { packageId: "package-other" } as Partial<PublishResultDocument>),
      { storeRoot: root, provider },
    )).rejects.toMatchObject({ code: "package-mismatch" });
  });

  it("rejects scheduled or published with no provider identity", async () => {
    const { root, sha256, provider } = await handedOff();
    for (const status of ["scheduled", "published"] as const) {
      await expect(ingestPublishResult(
        result(sha256, { status, providerPostId: undefined } as Partial<PublishResultDocument>),
        { storeRoot: root, provider },
      )).rejects.toMatchObject({ code: "missing-provider-identity" });
    }
  });

  it("rejects a conflicting provider id", async () => {
    const { root, sha256, provider } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    await expect(ingestPublishResult(
      result(sha256, { status: "published", occurredAt: "2026-09-20T15:00:00.000Z", providerPostId: "mc-post-DIFFERENT" } as Partial<PublishResultDocument>),
      { storeRoot: root, provider },
    )).rejects.toMatchObject({ code: "conflicting-provider-id" });
  });

  it("rejects a result for a creative that was never handed off or authorized in this store", async () => {
    const root = await storeRoot();
    await initPublicationStore(root, "simulation", "result ingestion test");
    await createStoredPublicationLedger(root, fingerprint());
    await expect(ingestPublishResult(result("a".repeat(64)), { storeRoot: root, provider: createSimulatedProvider() }))
      .rejects.toMatchObject({ code: "no-matching-handoff" });
  });

  it("rejects a replay carrying different data", async () => {
    const { root, sha256, provider } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    await expect(ingestPublishResult(
      result(sha256, { occurredAt: "2026-09-20T16:00:00.000Z" } as Partial<PublishResultDocument>),
      { storeRoot: root, provider },
    )).rejects.toMatchObject({ code: "replayed-with-different-data" });
  });

  it("refuses a malformed document rather than filling in defaults", async () => {
    const { sha256 } = await handedOff();
    expect(() => parsePublishResult({ kind: "SOMETHING_ELSE" })).toThrow(/kind must be/);
    expect(() => parsePublishResult(result(sha256, { status: "public" as never }))).toThrow(/status must be/);
    expect(() => parsePublishResult(result(sha256, { handoffSha256: "short" } as Partial<PublishResultDocument>))).toThrow(/64-character/);
    expect(() => parsePublishResult(result(sha256, { occurredAt: "not-a-date" } as Partial<PublishResultDocument>))).toThrow(/valid timestamp/);
    // A failure with no explanation is refused, so a silent failure cannot be logged.
    expect(() => parsePublishResult(result(sha256, { status: "failed", note: undefined } as Partial<PublishResultDocument>))).toThrow(/note is required/);
  });
});

describe("exact replay is idempotent", () => {
  it("returns the stored result and writes no second ledger event", async () => {
    const { root, sha256, provider } = await handedOff();
    const first = await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    const eventCount = first.ledger.events.length;

    const second = await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    expect(second.replayed).toBe(true);

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events).toHaveLength(eventCount);
    expect(ledger?.events.filter((event) => event.status === "scheduled")).toHaveLength(1);
  });
});

describe("the status report invents nothing", () => {
  it("distinguishes authorized-not-sent from a release in progress", async () => {
    const { root, sha256, path } = await authorized();
    const before = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(before?.stage).toBe("authorized-not-sent");
    expect(before?.analytics.measurable).toBe(false);
    expect(before?.analytics.missed).toEqual([]);

    await prepareReadyToPublishHandoff({ request: request(sha256), mediaPath: path, approvedMasterSha256: sha256 }, { storeRoot: root });
    const after = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(after?.stage).toBe("submission-in-progress");
  });

  it("reports scheduled, then published, from provider-confirmed ledger events only", async () => {
    const { root, sha256, provider } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    expect((await reportCreativeStatus(root, "creative-youtube-shorts"))?.stage).toBe("scheduled");

    provider.advance("mc-post-1", "published");
    const { confirmProviderState } = await import("./v2/publication/boundary.ts");
    await confirmProviderState({ storeRoot: root, creativeId: "creative-youtube-shorts", provider, now: new Date("2026-09-20T15:00:00.000Z") });
    const published = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(published?.stage).toBe("published");
    expect(published?.providerPostId).toBe("mc-post-1");
    expect(published?.publishedAt).toBe("2026-09-20T15:00:00.000Z");
  });

  it("reports no missed analytics windows before anything is published", async () => {
    const { root } = await handedOff();
    const status = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(status?.analytics).toMatchObject({ measurable: false, captured: [], missed: [], due: null });
  });

  it("reports missed windows only once they have actually come due", async () => {
    const { root, sha256, provider } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root, provider });
    provider.advance("mc-post-1", "published");
    const { confirmProviderState } = await import("./v2/publication/boundary.ts");
    await confirmProviderState({ storeRoot: root, creativeId: "creative-youtube-shorts", provider, now: new Date("2026-09-20T15:00:00.000Z") });

    const soon = await reportCreativeStatus(root, "creative-youtube-shorts", new Date("2026-09-20T15:30:00.000Z"));
    expect(soon?.analytics.missed).toEqual([]);
    expect(soon?.analytics.due).toBeNull();

    const later = await reportCreativeStatus(root, "creative-youtube-shorts", new Date("2026-09-21T23:00:00.000Z"));
    expect(later?.analytics.due).toBe("24h");
    expect(later?.analytics.missed).toContain("1h");
  });

  it("enumerates every creative in the store and renders without inventing state", async () => {
    const { root } = await handedOff();
    const all = await reportAllCreatives(root);
    expect(all.map((status) => status.creativeId)).toEqual(["creative-youtube-shorts"]);
    const text = formatStatusReport(all);
    expect(text).toContain("submission started; no provider answer recorded");
    expect(text).toContain("not measurable yet");
  });

  it("returns null for a creative the store has never seen", async () => {
    const root = await storeRoot();
    expect(await reportCreativeStatus(root, "creative-unknown")).toBeNull();
    expect(await reportAllCreatives(root)).toEqual([]);
  });
});

describe("the return leg reaches no network", () => {
  it("imports nothing that can", async () => {
    for (const file of ["publicationResultIngestion.ts", "publicationStatusReport.ts"]) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
      const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
      expect(code, `${file} must not fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${file} must not import the REST adapter`).not.toContain("metricoolClient");
      expect(code).not.toContain("https://app.metricool.com");
    }
  });
});
