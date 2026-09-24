// MUST STAY FIRST, AND MUST STAY A SIDE-EFFECT IMPORT: it installs the fake
// network before any adapter captures fetch. esbuild drops a named import
// whose binding is unused, which silently reorders the install.
import "./publishBoundary.fakeNetwork.ts";
import { fakeNetwork } from "./publishBoundary.fakeNetwork.ts";

import { beforeAll, describe, expect, it } from "vitest";

import { dependencyRecordFor } from "./renderManifest.ts";
import {
  advancePublicationLedger,
  assertNotAlreadyPublished,
  buildMetricoolPublishingRequest,
  buildTrackedWebsiteUrl,
  startPublicationLedger,
} from "./publishing.ts";
import type { QualityReviewResult } from "./qualityReviewer.ts";
import type { PublicationAssetBundleResult } from "./productVisualAssets.ts";
import type { VideoPlatform } from "./types.ts";
import {
  CONTROL_LIAM_VOICE_ID,
  contentPackage,
  dimensions,
  fingerprint,
  hostControl,
  idea,
  renderControl,
} from "./publishBoundary.testkit.ts";

// A REAL MASTER, NOT A DIGEST INVENTED FOR THE TEST. The publish gate now
// re-hashes the master and every input the compositor consumed, so the
// builder tests run against a genuine tiny render and its genuine receipt.
// The bypass attempts against that receipt live in publishBoundary.test.ts.
const control = await renderControl();
// The controlled upload step: the verified master uploaded to the (fake)
// host and downloaded back byte for byte. Its URI is the only media the
// builder will put in a request.
const hosted = await hostControl(control);

/**
 * The one digest that ties the whole gate together: the bytes a reviewer
 * watched (QualityReviewResult.reviewedMediaSha256) and the bytes the rights
 * registry cleared (PublicationAssetBundleResult.approvedMasterSha256). The
 * gate no longer accepts either as an argument, so the fixtures set them on
 * the two results they genuinely belong to.
 */
const MASTER_SHA256 = control.receipt.masterSha256;
const RECEIPT_DIGEST = control.receipt.digest;

function quality(platform: VideoPlatform, publishable = true): QualityReviewResult {
  return {
    packageId: contentPackage.packageId,
    platform,
    decision: publishable ? "pass" : "regenerate-targeted",
    publishable,
    overallScore: publishable ? 9.2 : 5,
    dimensionScores: { ...dimensions },
    issues: [],
    regenerateTaskIds: [],
    reviewedMediaSha256: MASTER_SHA256,
    reviewedReceiptDigest: RECEIPT_DIGEST,
  };
}

const rights: PublicationAssetBundleResult = {
  publishable: true,
  missingAssetIds: [],
  untrackedAssetIds: [],
  nonApprovedAssetIds: [],
  approvedMasterSha256: MASTER_SHA256,
  approvedMasterUri: "https://cdn.specsmithpc.com/masters/final-v4.mp4",
  approvedReceiptDigest: RECEIPT_DIGEST,
};

const config = {
  blogId: "6769542",
  timezone: "America/New_York",
  siteBaseUrl: "https://example.specsmithpc.test",
  connectedNetworks: ["instagram", "tiktok", "youtube"] as const,
};

/**
 * Pinned clock.
 *
 * publishAt is now required to be strictly in the future, so a test that
 * leaves `now` to the real wall clock would pass today and fail the day the
 * fixture's slot goes by. Every call below supplies this instead.
 */
const NOW = new Date("2026-08-23T00:00:00Z");

function networks() {
  return { ...config, connectedNetworks: [...config.connectedNetworks] };
}

const LIAM_VOICE_ID = CONTROL_LIAM_VOICE_ID;
const BOUND = { masterSha256: MASTER_SHA256, receiptDigest: RECEIPT_DIGEST };

function gate(platform: VideoPlatform) {
  return {
    qualityReview: quality(platform),
    assetBundle: rights,
    renderReceipt: control.receipt,
    dependencyRecord: dependencyRecordFor(control.receipt),
    hostedMaster: hosted,
    inspection: { approvedBy: "aaron", approvedAt: "2026-09-20T10:00:00.000Z", approved: true, ...BOUND },
    paidProviderApproval: { approvedBy: "aaron", approvedAt: "2026-09-20T10:00:00.000Z", ...BOUND },
  };
}

describe("publishing", () => {
  it("creates an attributed YouTube request with direct website link and hashtags", async () => {
    const result = await buildMetricoolPublishingRequest(
      idea,
      contentPackage,
      fingerprint("youtube-shorts"),
      gate("youtube-shorts"),
      networks(),
      "2026-08-24T16:00:00",
      NOW,
    );

    expect(result.networks).toEqual(["youtube"]);
    expect(result.youtube_title).toContain("RTX 4080 Super");
    expect(result.youtube_made_for_kids).toBe(false);
    expect(result.websiteCtaMode).toBe("direct-link");
    expect(result.text).toContain("#SpecSmithPC");
    expect(result.text).toContain(result.trackedWebsiteUrl);
    const url = new URL(result.trackedWebsiteUrl);
    expect(url.searchParams.get("utm_source")).toBe("youtube");
    expect(url.searchParams.get("utm_campaign")).toBe(contentPackage.campaignId);
    expect(url.searchParams.get("utm_content")).toBe("creative-youtube-shorts");
  });

  it("uses profile-link CTA semantics for TikTok and Instagram", async () => {
    const tiktok = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      networks(), "2026-08-24T18:00:00", NOW,
    );
    const instagram = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("instagram-reels"), gate("instagram-reels"),
      networks(), "2026-08-24T10:00:00", NOW,
    );

    expect(tiktok.networks).toEqual(["tiktok"]);
    expect(tiktok.tiktok_title).toBeTruthy();
    expect(tiktok.websiteCtaMode).toBe("profile-link");
    expect(tiktok.text).toContain("link in bio");
    expect(instagram.networks).toEqual(["instagram"]);
    expect(instagram.content_type).toBe("REEL");
    expect(instagram.websiteCtaMode).toBe("profile-link");
  });

  it("fails closed on QC, rights, disconnected networks, media hashes, and guessed website bases", async () => {
    await expect(buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), qualityReview: quality("tiktok", false) },
      networks(), "2026-08-24T18:00:00", NOW,
    )).rejects.toThrow(/quality review/);

    await expect(buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), assetBundle: { ...rights, publishable: false, nonApprovedAssetIds: ["asset-x"] } },
      networks(), "2026-08-24T18:00:00", NOW,
    )).rejects.toThrow(/asset-rights/);

    await expect(buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...config, connectedNetworks: ["youtube"] }, "2026-08-24T18:00:00", NOW,
    )).rejects.toThrow(/not connected/);

    await expect(buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "bad" } },
      networks(), "2026-08-24T18:00:00", NOW,
    )).rejects.toThrow(/SHA-256/);

    expect(() => buildTrackedWebsiteUrl(contentPackage, "creative-x", "tiktok", "http://not-secure.test"))
      .toThrow(/https/);

    // The registry's URI is never the media: not even a non-fetchable one
    // changes the request, because only the verified hosted URI is used.
    const ignoringRegistry = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), assetBundle: { ...rights, approvedMasterUri: "artifact:final-v4.mp4" } },
      networks(), "2026-08-24T18:00:00", NOW,
    );
    expect(ignoringRegistry.media).toEqual([hosted.uri]);
  });

  it("always emits a draft, and refuses autoPublish until approvals are authenticated", async () => {
    const drafted = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      networks(), "2026-08-24T18:00:00", NOW,
    );
    expect(drafted.draft).toBe(true);

    // Previously `autoPublish: true` produced draft:false. Sign-offs are
    // digest-bound but their authors are not authenticated, so no request
    // may skip a person promoting the draft.
    await expect(buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...networks(), autoPublish: true }, "2026-08-24T18:00:00", NOW,
    )).rejects.toThrow(/autoPublish is disabled/);
  });

  it("refuses a second publication of the same creative across separate ledgers", async () => {
    // A re-run mints a fresh ledger, so the per-ledger transition table cannot
    // see the earlier publish. This is the guard that can.
    const fp = fingerprint("tiktok");
    let first = startPublicationLedger(fp, new Date("2026-08-23T20:00:00Z"));
    first = advancePublicationLedger(first, { status: "qc-passed", at: "2026-08-23T20:01:00Z" });
    first = advancePublicationLedger(first, { status: "scheduled", at: "2026-08-23T20:02:00Z" });
    first = advancePublicationLedger(first, { status: "published", at: "2026-08-24T22:00:00Z" });

    expect(() => assertNotAlreadyPublished([first], fp.creativeId)).toThrow(/already published/);
    expect(() => assertNotAlreadyPublished([first], "creative-other")).not.toThrow();
  });

  it("keeps an auditable lifecycle and blocks impossible or duplicate publication transitions", async () => {
    const fp = fingerprint("tiktok");
    let ledger = startPublicationLedger(fp, new Date("2026-08-23T20:00:00Z"));
    ledger = advancePublicationLedger(ledger, { status: "qc-passed", at: "2026-08-23T20:01:00Z" });
    ledger = advancePublicationLedger(ledger, { status: "scheduled", at: "2026-08-23T20:02:00Z" });
    ledger = advancePublicationLedger(ledger, { status: "published", at: "2026-08-24T22:00:00Z", providerPostId: "post-1" });
    ledger = advancePublicationLedger(ledger, { status: "analytics-partial", at: "2026-08-24T23:00:00Z" });
    ledger = advancePublicationLedger(ledger, { status: "analytics-complete", at: "2026-08-31T22:00:00Z" });
    expect(ledger.events.map((entry) => entry.status)).toEqual([
      "generated", "qc-passed", "scheduled", "published", "analytics-partial", "analytics-complete",
    ]);

    const fresh = startPublicationLedger(fp);
    expect(() => advancePublicationLedger(fresh, { status: "published" })).toThrow(/Invalid publication transition/);
    expect(() => advancePublicationLedger(ledger, { status: "published" })).toThrow();
  });
});

// REGRESSION (review item 1): the two digests the gate compares must be facts
// carried by the QC and rights results, not arguments. The previous gate took
// `finalMediaSha256` and `approvedMediaSha256` from the caller and compared
// them to each other — a check any caller satisfied by passing the same
// unreviewed digest twice, which is no check at all.
describe("the published bytes are bound to the reviewed and rights-approved master", () => {
  function build(gateOverrides: Record<string, unknown> = {}) {
    return buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), ...gateOverrides } as ReturnType<typeof gate>,
      networks(), "2026-08-24T18:00:00", NOW,
    );
  }

  it("emits the digest recorded by the quality review", async () => {
    expect((await build()).finalMediaSha256).toBe(MASTER_SHA256);
  });

  it("ignores a hash supplied by the caller", async () => {
    // The old field names are no longer part of PublishingGateInput. Passing
    // them anyway must change nothing: this is what proves the value is read
    // from the review rather than from the argument object.
    const forged = "9".repeat(64);
    const result = await build({ finalMediaSha256: forged, approvedMediaSha256: forged });
    expect(result.finalMediaSha256).toBe(MASTER_SHA256);
    expect(result.finalMediaSha256).not.toBe(forged);
  });

  it("uses only the verified hosted URI, ignoring the registry URI and any caller media ref", async () => {
    const result = await build({ finalMediaRef: "https://attacker.invalid/different.mp4" });
    expect(result.media).toEqual([hosted.uri]);
    expect(result.media).not.toContain(rights.approvedMasterUri);
    expect(fakeNetwork.requests).toContain(`GET ${hosted.uri}`);
  });

  it("refuses a review of bytes the rights registry did not approve", async () => {
    await expect(build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "c".repeat(64) },
    })).rejects.toThrow(/not the rights-approved master/);
  });

  it("refuses a bundle that resolved no approved master hash", async () => {
    // publishable:true with a null hash is exactly the shape a registry
    // produces for a master registered without a digest.
    await expect(build({
      assetBundle: { ...rights, approvedMasterSha256: null },
    })).rejects.toThrow(/no approved master hash/);
  });

  it("does not depend on the registry URI at all", async () => {
    expect((await build({ assetBundle: { ...rights, approvedMasterUri: null } })).media).toEqual([hosted.uri]);
  });

  it("normalises case on both sides rather than failing a real match", async () => {
    expect((await build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: MASTER_SHA256.toUpperCase() },
      assetBundle: { ...rights, approvedMasterSha256: MASTER_SHA256.toUpperCase() },
    })).finalMediaSha256).toBe(MASTER_SHA256);
  });

  it("rejects a malformed approved hash instead of matching it loosely", async () => {
    await expect(build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "not-a-digest" },
      assetBundle: { ...rights, approvedMasterSha256: "not-a-digest" },
    })).rejects.toThrow(/SHA-256/);
  });
});

// REGRESSION (review item 4): publishAt must be strictly in the future in the
// timezone the post is actually scheduled against. The previous check compared
// the wall clock to now as though it were UTC and allowed a 24-hour grace
// window, so a slot up to a day in the past — and every slot inside the zone's
// offset — was accepted and handed to Metricool as a "schedule".
describe("publishAt is strictly future in the supplied timezone", () => {
  function at(publishAt: string, now: string, timezone = "America/New_York") {
    return buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...networks(), timezone }, publishAt, new Date(now),
    );
  }

  // 18:00 in New York on 2026-08-24 (EDT, UTC-4) is 22:00:00Z.
  it("accepts a slot one second in the future", async () => {
    expect((await at("2026-08-24T18:00:00", "2026-08-24T21:59:59Z")).date).toBe("2026-08-24T18:00:00");
  });

  it("refuses a slot at exactly the current instant", async () => {
    await expect(at("2026-08-24T18:00:00", "2026-08-24T22:00:00Z")).rejects.toThrow(/not in the future/);
  });

  it("refuses a slot one second in the past", async () => {
    await expect(at("2026-08-24T18:00:00", "2026-08-24T22:00:01Z")).rejects.toThrow(/not in the future/);
  });

  it("no longer waves through a slot inside the old 24-hour grace window", async () => {
    // Two hours past. The previous implementation accepted this.
    await expect(at("2026-08-24T18:00:00", "2026-08-25T00:00:00Z")).rejects.toThrow(/not in the future/);
  });

  it("applies the zone's real offset rather than reading the wall clock as UTC", async () => {
    // The same wall-clock string, the same instant, two zones. Read as UTC,
    // 18:00 would be in the past for both. It is only future in Los Angeles
    // because that zone is seven hours behind, which is the whole point.
    await expect(at("2026-08-24T18:00:00", "2026-08-24T20:00:00Z", "Europe/London")).rejects.toThrow(/not in the future/);
    expect((await at("2026-08-24T18:00:00", "2026-08-24T20:00:00Z", "America/Los_Angeles")).date).toBe("2026-08-24T18:00:00");
  });

  it("uses the offset in force on the scheduled date, not today's", async () => {
    // 2026-01-15 is EST (UTC-5), so noon local is 17:00:00Z — an hour later
    // than the same wall clock would be under the summer offset.
    expect((await at("2026-01-15T12:00:00", "2026-01-15T16:59:59Z")).date).toBe("2026-01-15T12:00:00");
    await expect(at("2026-01-15T12:00:00", "2026-01-15T17:00:01Z")).rejects.toThrow(/not in the future/);
  });

  it("refuses a wall time inside the spring-forward gap", async () => {
    await expect(at("2026-03-08T02:30:00", "2026-03-01T00:00:00Z"))
      .rejects.toThrow(/does not exist/);
  });

  it("refuses a wall time repeated by the fall-back overlap", async () => {
    await expect(at("2026-11-01T01:30:00", "2026-10-01T00:00:00Z"))
      .rejects.toThrow(/ambiguous/);
  });

  it("accepts an unambiguous wall time after the spring-forward jump", async () => {
    expect((await at("2026-03-08T03:30:00", "2026-03-01T00:00:00Z")).date)
      .toBe("2026-03-08T03:30:00");
  });

  it("refuses a timezone that is not a real IANA identifier", async () => {
    await expect(at("2026-08-24T18:00:00", "2026-08-23T00:00:00Z", "EST5EDT/Nope"))
      .rejects.toThrow(/not a recognised IANA timezone/);
  });

  it("still requires a local wall-clock string with no offset of its own", async () => {
    await expect(at("2026-08-24T18:00:00Z", "2026-08-23T00:00:00Z")).rejects.toThrow(/YYYY-MM-DDTHH:mm:ss/);
  });
});

// REGRESSION (review item 5): TikTok captions are one run of text.
describe("TikTok copy contains no line breaks", () => {
  let tiktok: Awaited<ReturnType<typeof buildMetricoolPublishingRequest>>;
  beforeAll(async () => {
    tiktok = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      networks(), "2026-08-24T18:00:00", NOW,
    );
  });

  it("emits a single-line caption", async () => {
    expect(tiktok.text).not.toContain("\n");
    expect(tiktok.text).not.toContain("\r");
  });

  it("keeps the CTA and hashtags that the line breaks used to separate", async () => {
    expect(tiktok.text).toContain("link in bio");
    expect(tiktok.text).toContain("#SpecSmithPC");
  });

  it("collapses the run of spaces rather than leaving a double gap", async () => {
    expect(tiktok.text).not.toMatch(/ {2}/);
  });

  it("leaves the other platforms' multi-line copy alone", async () => {
    const youtube = await buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("youtube-shorts"), gate("youtube-shorts"),
      networks(), "2026-08-24T16:00:00", NOW,
    );
    // YouTube descriptions do preserve newlines, and the tracked URL needs its
    // own line, so this fix is deliberately TikTok-only.
    expect(youtube.text).toContain("\n");
  });
});
