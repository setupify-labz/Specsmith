// The ACTIVE publication route: a READY_TO_PUBLISH manifest a human releases
// through the ChatGPT/Metricool connector.
//
// The founder's Metricool plan has no REST access, so these tests also pin the
// property that matters most about this path: it reaches no network at all.
// There is no transport to inject here because the module imports nothing that
// could make a request.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HandoffRefusedError,
  listHandoffs,
  loadExistingHandoff,
  prepareReadyToPublishHandoff,
} from "./readyToPublishHandoff.ts";
import { metricoolRestAvailability, publishApprovedPackage } from "./metricoolClient.ts";
import type { ApprovedPublicationPackage } from "./publicationIntegrity.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import type { MetricoolPublishingRequest } from "./publishing.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specsmith-handoff-"));
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
    text: "Is the Super worth it? #SpecSmithPC",
    date: "2026-09-20T10:00:00",
    timezone: "America/New_York",
    media: ["https://cdn.example.com/master.mp4"],
    draft: true,
    trackedWebsiteUrl: "https://specsmithpc.com/compare?utm_content=creative-youtube-shorts",
    websiteCtaMode: "profile-link",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080"],
    finalMediaSha256: sha256,
    ...overrides,
  } as MetricoolPublishingRequest;
}

/** A ledger that has passed QC — the normal pre-handoff state. */
async function qcPassedRoot(platform: VideoPlatform = "youtube-shorts"): Promise<string> {
  const root = await storeRoot();
  await createStoredPublicationLedger(root, fingerprint(platform));
  await advanceStoredPublicationLedger(root, `creative-${platform}`, { status: "qc-passed" });
  return root;
}

describe("the manifest carries everything a human needs to release correctly", () => {
  it("includes the exact approved media reference, digest, identity, copy, schedule, intent and gate states", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");

    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, now: new Date("2026-09-14T12:00:00.000Z") },
    );

    expect(manifest.kind).toBe("READY_TO_PUBLISH");
    expect(manifest.creativeId).toBe("creative-youtube-shorts");
    expect(manifest.platform).toBe("youtube-shorts");
    expect(manifest.media.reference).toBe("https://cdn.example.com/master.mp4");
    expect(manifest.media.sha256).toBe(media.sha256);
    expect(manifest.caption).toContain("Is the Super worth it?");
    expect(manifest.hashtags).toEqual(["#SpecSmithPC", "#RTX4080"]);
    expect(manifest.schedule).toEqual({ localDateTime: "2026-09-20T10:00:00", timezone: "America/New_York" });
    expect(manifest.intent).toBe("draft");
    expect(manifest.qc.state).toBe("passed");
    expect(manifest.rights).toEqual({ state: "approved", approvedMasterSha256: media.sha256 });
  });

  it("is written to disk so the connector step has a durable artifact", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );

    expect(await listHandoffs(root)).toEqual(["creative-youtube-shorts__youtube-shorts.json"]);
    const loaded = await loadExistingHandoff(root, "creative-youtube-shorts", "youtube-shorts");
    expect(loaded?.media.sha256).toBe(media.sha256);
  });

  it("never upgrades a draft request to a public intent", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256, { draft: true }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    expect(manifest.intent).toBe("draft");
  });
});

describe("no public-post state is fabricated", () => {
  it("leaves the ledger exactly where it was — never scheduled, never published", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const before = await loadStoredPublicationLedger(root, "creative-youtube-shorts");

    await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );

    const after = await loadStoredPublicationLedger(root, "creative-youtube-shorts");
    expect(after?.events).toEqual(before?.events);
    expect(after?.events.some((event) => event.status === "scheduled")).toBe(false);
    expect(after?.events.some((event) => event.status === "published")).toBe(false);
  });

  it("invents no provider identifiers", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("providerPostId");
    expect(serialized).not.toContain("providerUrl");
    // The manifest records only a pre-release ledger state.
    expect(["generated", "qc-passed"]).toContain(manifest.ledgerStatusAtPreparation);
  });

  it("says inside the artifact that it is not a record of publication", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    expect(manifest.notice).toMatch(/NOT a record of publication/);
  });
});

describe("the handoff fails closed on every gate", () => {
  it("rejects media modified after approval, and writes no manifest", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    await writeFile(media.path, "tampered-after-approval");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-mismatch" });

    expect(await listHandoffs(root), "a refused handoff must leave no artifact").toEqual([]);
  });

  it("rejects a request digest that disagrees with the rights-approved master", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const other = createHash("sha256").update("a-different-render").digest("hex");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: other },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-mismatch" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects a creative whose quality review has not passed", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint()); // only `generated`
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "qc-not-passed" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects a creative that quality review rejected", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "rejected" });
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "qc-not-passed" });
  });

  it("rejects a missing rights approval", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: "" },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "rights-not-approved" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects missing media", async () => {
    const root = await qcPassedRoot();
    await expect(prepareReadyToPublishHandoff(
      { request: request("a".repeat(64)), mediaPath: join(root, "nope.mp4"), approvedMasterSha256: "a".repeat(64) },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-missing" });
  });

  it("rejects an ambiguous schedule time", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256, { date: "2026-09-20T10:00:00Z" }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "scheduling-ambiguous" });
  });

  it("rejects a creative with no ledger at all", async () => {
    const root = await storeRoot();
    const media = await writeMedia(root, "approved-bytes");
    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "unsupported-platform-state" });
  });
});

describe("duplicate handoffs are refused", () => {
  it("refuses a second manifest for the same creative and platform", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    const pkg: ApprovedPublicationPackage = { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 };

    await prepareReadyToPublishHandoff(pkg, { storeRoot: root });
    await expect(prepareReadyToPublishHandoff(pkg, { storeRoot: root }))
      .rejects.toBeInstanceOf(HandoffRefusedError);
    expect(await listHandoffs(root), "still exactly one manifest").toHaveLength(1);
  });

  it("refuses a creative that was already released by any route", async () => {
    const root = await qcPassedRoot();
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "scheduled", providerPostId: "post-123" });
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "already-published" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("allows the same creative on a different platform", async () => {
    const root = await qcPassedRoot();
    await createStoredPublicationLedger(root, fingerprint("tiktok"));
    await advanceStoredPublicationLedger(root, "creative-tiktok", { status: "qc-passed" });
    const media = await writeMedia(root, "approved-bytes");

    await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    await prepareReadyToPublishHandoff(
      {
        request: request(media.sha256, { creativeId: "creative-tiktok", platform: "tiktok", networks: ["tiktok"] } as Partial<MetricoolPublishingRequest>),
        mediaPath: media.path,
        approvedMasterSha256: media.sha256,
      },
      { storeRoot: root },
    );
    expect(await listHandoffs(root)).toHaveLength(2);
  });
});

describe("the current-plan path makes no Metricool REST request", () => {
  it("imports nothing that can reach the network", async () => {
    const source = await readFile(new URL("./readyToPublishHandoff.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("metricoolClient");
    expect(code).not.toContain("MetricoolTransport");
    expect(code).not.toContain("https://app.metricool.com");
  });

  it("reports REST unavailable without credentials, which is the current plan", () => {
    const availability = metricoolRestAvailability(undefined);
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/does not expose REST API access/);
  });

  it("refuses a REST publish outright when no REST credentials exist", async () => {
    const root = await qcPassedRoot();
    const media = await writeMedia(root, "approved-bytes");
    let called = 0;
    const transport = (async () => {
      called += 1;
      return { status: 200, text: async () => "{}" };
    }) as never;

    await expect(publishApprovedPackage(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root, credentials: { userToken: "", userId: "" }, transport },
    )).rejects.toMatchObject({ code: "rest-unavailable" });

    expect(called, "the REST adapter must not reach the network on the current plan").toBe(0);
  });
});
