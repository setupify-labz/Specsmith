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
import { metricoolRestAvailability, publishAuthorizedDraft } from "./metricoolClient.ts";
import type { ApprovedPublicationPackage } from "./publicationIntegrity.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  initPublicationStore,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import { seedSimulatedLedger, type ProviderPublicationRequest } from "./v2/publication/boundary.ts";
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

const CAPTION = "Is the Super worth it? #SpecSmithPC";

/**
 * A simulation store whose ledger was authorized for exactly this media,
 * account and text: the normal pre-handoff state. (A production store cannot
 * reach it today: no trusted approval verifier exists; see the last suite.)
 */
async function authorizedRoot(platform: VideoPlatform = "youtube-shorts", root?: string): Promise<{ root: string; media: { path: string; sha256: string } }> {
  const store = root ?? await storeRoot();
  if (!root) await initPublicationStore(store, "simulation", "handoff test");
  const media = await writeMedia(store, "approved-bytes");
  await createStoredPublicationLedger(store, fingerprint(platform));
  await seedSimulatedLedger({ storeRoot: store, creativeId: `creative-${platform}`, through: "publication-authorized", mediaSha256: media.sha256,
    variantId: `${platform}-1080x1920-30`, destination: { provider: "metricool", accountId: "blog-1", platform }, title: "unused", description: CAPTION });
  return { root: store, media };
}

describe("the manifest carries everything a human needs to release correctly", () => {
  it("includes the exact approved media reference, digest, identity, copy, schedule, intent and gate states", async () => {
    const { root, media } = await authorizedRoot();

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
    expect(manifest.authorization).toMatchObject({ state: "authorized", simulated: true });
    expect(manifest.rights).toEqual({ state: "approved", approvedMasterSha256: media.sha256 });
  });

  it("is written to disk so the connector step has a durable artifact", async () => {
    const { root, media } = await authorizedRoot();
    await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );

    expect(await listHandoffs(root)).toEqual(["creative-youtube-shorts__youtube-shorts.json"]);
    const loaded = await loadExistingHandoff(root, "creative-youtube-shorts", "youtube-shorts");
    expect(loaded?.media.sha256).toBe(media.sha256);
  });

  it("never upgrades a draft request to a public intent", async () => {
    const { root, media } = await authorizedRoot();
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256, { draft: true }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    expect(manifest.intent).toBe("draft");
  });
});

describe("no public-post state is fabricated", () => {
  it("records only that the release is in a person's hands — never scheduled, never published", async () => {
    const { root, media } = await authorizedRoot();
    await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    const after = (await loadStoredPublicationLedger(root, "creative-youtube-shorts"))!;
    const last = after.events.at(-1)!;
    expect(last.status).toBe("submission-started");
    expect(last.evidence?.channel).toBe("human-handoff");
    expect(last.providerPostId).toBeUndefined();
    expect(after.events.some((event) => event.status === "scheduled" || event.status === "published")).toBe(false);
  });

  it("invents no provider identifiers", async () => {
    const { root, media } = await authorizedRoot();
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("providerPostId");
    expect(serialized).not.toContain("providerUrl");
    // The manifest records only a pre-release ledger state.
    expect(["publication-authorized", "submission-failed"]).toContain(manifest.ledgerStatusAtPreparation);
  });

  it("says inside the artifact that it is not a record of publication", async () => {
    const { root, media } = await authorizedRoot();
    const manifest = await prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    );
    expect(manifest.notice).toMatch(/NOT a record of publication/);
  });
});

describe("the handoff fails closed on every gate", () => {
  it("rejects media modified after approval, and writes no manifest", async () => {
    const { root, media } = await authorizedRoot();
    await writeFile(media.path, "tampered-after-approval");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-mismatch" });

    expect(await listHandoffs(root), "a refused handoff must leave no artifact").toEqual([]);
  });

  it("rejects a request digest that disagrees with the rights-approved master", async () => {
    const { root, media } = await authorizedRoot();
    const other = createHash("sha256").update("a-different-render").digest("hex");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: other },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-mismatch" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects a creative that was never authorized", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint()); // only `generated`
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "not-authorized" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects a creative that was rejected", async () => {
    const root = await storeRoot();
    await createStoredPublicationLedger(root, fingerprint());
    await advanceStoredPublicationLedger(root, "creative-youtube-shorts", { status: "rejected" });
    const media = await writeMedia(root, "approved-bytes");

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "not-authorized" });
  });

  it("rejects text that differs from the reviewed and authorized description", async () => {
    const { root, media } = await authorizedRoot();
    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256, { text: `${CAPTION} Now 20% off!` }), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "not-authorized" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects a missing rights approval", async () => {
    const { root, media } = await authorizedRoot();

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: "" },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "rights-not-approved" });
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("rejects missing media", async () => {
    const { root, media } = await authorizedRoot();
    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: join(root, "nope.mp4"), approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "media-missing" });
  });

  it("rejects an ambiguous schedule time", async () => {
    const { root, media } = await authorizedRoot();
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
  it("refuses a second handoff once the first put the release in a person's hands", async () => {
    const { root, media } = await authorizedRoot();
    const pkg: ApprovedPublicationPackage = { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 };

    await prepareReadyToPublishHandoff(pkg, { storeRoot: root });
    await expect(prepareReadyToPublishHandoff(pkg, { storeRoot: root }))
      .rejects.toThrow(/is "submission-started"; only an authorized creative awaiting release/);
    expect(await listHandoffs(root), "still exactly one manifest").toHaveLength(1);
  });

  it("refuses a creative whose draft or schedule the provider already accepted", async () => {
    const root = await storeRoot();
    await initPublicationStore(root, "simulation", "handoff test");
    const media = await writeMedia(root, "approved-bytes");
    await createStoredPublicationLedger(root, fingerprint());
    await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-youtube-shorts", through: "scheduled", mediaSha256: media.sha256, variantId: "v",
      destination: { provider: "metricool", accountId: "blog-1", platform: "youtube-shorts" }, title: "unused", description: CAPTION, providerPostId: "post-123" });

    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toThrow(/is "scheduled"/);
    expect(await listHandoffs(root)).toEqual([]);
  });

  it("allows the same creative on a different platform", async () => {
    const { root, media } = await authorizedRoot();
    await authorizedRoot("tiktok", root);

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

describe("a production store cannot hand anything off today", () => {
  it("cannot reach publication-authorized without a trusted approval verifier, so no handoff is produced", async () => {
    const root = await storeRoot(); // no marker: production
    const media = await writeMedia(root, "approved-bytes");
    await createStoredPublicationLedger(root, fingerprint());
    await expect(seedSimulatedLedger({ storeRoot: root, creativeId: "creative-youtube-shorts", through: "publication-authorized", mediaSha256: media.sha256,
      variantId: "v", destination: { provider: "metricool", accountId: "blog-1", platform: "youtube-shorts" }, title: "t", description: CAPTION }))
      .rejects.toThrow(/only in a simulation store/);
    await expect(prepareReadyToPublishHandoff(
      { request: request(media.sha256), mediaPath: media.path, approvedMasterSha256: media.sha256 },
      { storeRoot: root },
    )).rejects.toMatchObject({ code: "not-authorized" });
    expect(await listHandoffs(root)).toEqual([]);
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

  it("refuses a REST send outright when no REST credentials exist", async () => {
    let called = 0;
    const transport = (async () => {
      called += 1;
      return { status: 200, text: async () => "{}" };
    }) as never;

    await expect(publishAuthorizedDraft(
      { creativeId: "creative-youtube-shorts" } as ProviderPublicationRequest,
      { storeRoot: await storeRoot(), mediaPath: "/nonexistent", credentials: { userToken: "", userId: "" }, transport },
    )).rejects.toMatchObject({ code: "rest-unavailable" });

    expect(called, "the REST adapter must not reach the network on the current plan").toBe(0);
  });
});
