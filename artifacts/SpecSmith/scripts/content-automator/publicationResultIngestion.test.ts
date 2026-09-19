// The return leg: a real Metricool result coming back into SpecSmith.
//
// No network anywhere in this file, and none in the module under test — this
// path reads a document a human filled in from what the connector reported.
// The tests are mostly refusals, because the whole value of this module is
// that publication state cannot be asserted into existence.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PUBLISH_RESULT_KIND,
  PUBLISH_RESULT_VERSION,
  ingestPublishResult,
  parsePublishResult,
  publishResultTemplate,
  type PublishResultDocument,
} from "./publicationResultIngestion.ts";
import { prepareReadyToPublishHandoff } from "./readyToPublishHandoff.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
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

/** A store with a QC-passed ledger and a real handoff manifest. */
async function handedOff(platform: VideoPlatform = "youtube-shorts"): Promise<{ root: string; sha256: string }> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint(platform));
  await advanceStoredPublicationLedger(root, `creative-${platform}`, { status: "qc-passed" });

  const path = join(root, "master.mp4");
  await writeFile(path, `bytes-${platform}`);
  const sha256 = createHash("sha256").update(`bytes-${platform}`).digest("hex");
  const fp = fingerprint(platform);
  await prepareReadyToPublishHandoff(
    {
      request: request(sha256, { creativeId: fp.creativeId, platform, networks: [platform === "youtube-shorts" ? "youtube" : platform === "tiktok" ? "tiktok" : "instagram"] } as Partial<MetricoolPublishingRequest>),
      mediaPath: path,
      approvedMasterSha256: sha256,
    },
    { storeRoot: root },
  );
  return { root, sha256 };
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

describe("a real result is recorded against the handoff it answers", () => {
  it("records provider identity, status, timestamp and package identity", async () => {
    const { root, sha256 } = await handedOff();
    const outcome = await ingestPublishResult(result(sha256), { storeRoot: root });

    expect(outcome.replayed).toBe(false);
    const event = outcome.ledger.events.at(-1);
    expect(event?.status).toBe("scheduled");
    expect(event?.providerPostId).toBe("mc-post-1");
    expect(event?.providerUuid).toBe("mc-uuid-1");
    expect(event?.providerUrl).toBe("https://metricool.test/mc-post-1");
    expect(event?.at).toBe("2026-09-20T14:05:00.000Z");
    expect(outcome.handoff.packageId).toBe("package-1");
  });

  it("carries a creative all the way to published, in order", async () => {
    const { root, sha256 } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root });
    const published = await ingestPublishResult(
      result(sha256, { status: "published", occurredAt: "2026-09-20T15:00:00.000Z" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    );
    expect(published.ledger.events.at(-1)?.status).toBe("published");
    expect(published.ledger.events.at(-1)?.providerPostId).toBe("mc-post-1");
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
  it("rejects a result for a creative that has no handoff", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "qc-passed" });

    await expect(ingestPublishResult(result("a".repeat(64)), { storeRoot: root }))
      .rejects.toMatchObject({ code: "no-matching-handoff" });

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.some((event) => event.status === "scheduled")).toBe(false);
  });

  it("rejects a result naming the wrong creative", async () => {
    const { root, sha256 } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { creativeId: "creative-someone-else" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "no-matching-handoff" });
  });

  it("rejects a result naming the wrong platform", async () => {
    const { root, sha256 } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { platform: "tiktok" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "no-matching-handoff" });
  });

  it("rejects a result whose handoff SHA-256 does not match", async () => {
    const { root } = await handedOff();
    const otherRender = createHash("sha256").update("a-different-render").digest("hex");
    await expect(ingestPublishResult(result(otherRender), { storeRoot: root }))
      .rejects.toMatchObject({ code: "handoff-sha-mismatch" });

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.some((event) => event.status === "scheduled")).toBe(false);
  });

  it("rejects a result naming a different package", async () => {
    const { root, sha256 } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { packageId: "package-other" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "package-mismatch" });
  });

  it("rejects scheduled or published with no provider identity", async () => {
    const { root, sha256 } = await handedOff();
    for (const status of ["scheduled", "published"] as const) {
      await expect(ingestPublishResult(
        result(sha256, { status, providerPostId: undefined } as Partial<PublishResultDocument>),
        { storeRoot: root },
      )).rejects.toMatchObject({ code: "missing-provider-identity" });
    }
  });

  it("rejects a conflicting provider id", async () => {
    const { root, sha256 } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root });

    await expect(ingestPublishResult(
      result(sha256, { status: "published", occurredAt: "2026-09-20T15:00:00.000Z", providerPostId: "mc-post-DIFFERENT" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "conflicting-provider-id" });
  });

  it("rejects a jump to published without ever being scheduled", async () => {
    const { root, sha256 } = await handedOff();
    await expect(ingestPublishResult(
      result(sha256, { status: "published" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "invalid-transition" });

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events.some((event) => event.status === "published")).toBe(false);
  });

  it("rejects a replay carrying different data", async () => {
    const { root, sha256 } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root });

    await expect(ingestPublishResult(
      result(sha256, { occurredAt: "2026-09-20T16:00:00.000Z" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "replayed-with-different-data" });
  });

  it("refuses a malformed document rather than filling in defaults", async () => {
    const { root, sha256 } = await handedOff();
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
    const { root, sha256 } = await handedOff();
    const first = await ingestPublishResult(result(sha256), { storeRoot: root });
    const eventCount = first.ledger.events.length;

    const second = await ingestPublishResult(result(sha256), { storeRoot: root });
    expect(second.replayed).toBe(true);

    const ledger = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(ledger?.events).toHaveLength(eventCount);
    expect(ledger?.events.filter((event) => event.status === "scheduled")).toHaveLength(1);
  });
});

describe("the status report invents nothing", () => {
  it("distinguishes ready-not-handed-off from handed-off", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "qc-passed" });

    const before = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(before?.stage).toBe("ready-not-handed-off");
    expect(before?.analytics.measurable).toBe(false);
    expect(before?.analytics.missed).toEqual([]);

    const path = join(root, "master.mp4");
    await writeFile(path, "bytes-youtube-shorts");
    const sha256 = createHash("sha256").update("bytes-youtube-shorts").digest("hex");
    await prepareReadyToPublishHandoff(
      { request: request(sha256), mediaPath: path, approvedMasterSha256: sha256 },
      { storeRoot: root },
    );

    const after = await reportCreativeStatus(root, "creative-youtube-shorts");
    expect(after?.stage).toBe("handed-off-not-scheduled");
  });

  it("reports scheduled, then published, from real ledger events only", async () => {
    const { root, sha256 } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root });
    expect((await reportCreativeStatus(root, "creative-youtube-shorts"))?.stage).toBe("scheduled");

    await ingestPublishResult(
      result(sha256, { status: "published", occurredAt: "2026-09-20T15:00:00.000Z" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    );
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
    const { root, sha256 } = await handedOff();
    await ingestPublishResult(result(sha256), { storeRoot: root });
    await ingestPublishResult(
      result(sha256, { status: "published", occurredAt: "2026-09-20T15:00:00.000Z" } as Partial<PublishResultDocument>),
      { storeRoot: root },
    );

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
    expect(text).toContain("handed off, not yet scheduled");
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
