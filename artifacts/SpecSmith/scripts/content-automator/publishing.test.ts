import { describe, expect, it } from "vitest";
import {
  advancePublicationLedger,
  assertNotAlreadyPublished,
  buildFirstComment,
  buildMetricoolPublishingRequest,
  buildTrackedWebsiteUrl,
  startPublicationLedger,
} from "./publishing.ts";
import type { QualityReviewResult } from "./qualityReviewer.ts";
import type { PublicationAssetBundleResult } from "./productVisualAssets.ts";
import type { ContentIdea, ContentPackage, CreativeFingerprint, VideoPlatform } from "./types.ts";

const idea: ContentIdea = {
  id: "rtx-value",
  format: "comparison",
  title: "RTX 4080 Super vs RTX 4080: $437 for 4 FPS?",
  hook: "$437 more for four FPS?",
  angle: "Value comparison",
  targetAudience: "PC buyers",
  requiredFacts: ["estimated fps", "price"],
  subjectIds: ["rtx-4080-super", "rtx-4080"],
  productConnection: {
    feature: "compare",
    route: "/compare/rtx-4080-super-vs-rtx-4080",
    userProblem: "Buyers need to know if the extra money is worth it.",
    whySpecSmith: "SpecSmithPC makes the exact tradeoff easy to compare.",
    continuationAction: "Open the full comparison and inspect the tradeoffs.",
    sitePayoff: "Continue the same decision on SpecSmithPC.",
  },
  creativeDNA: {
    conceptName: "Price Shock",
    visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer",
    openingImage: "gpu",
    patternInterrupt: "$437",
    retentionBeats: ["1", "2", "3"],
    payoff: "value winner",
    audioDirection: "punchy",
    originalityConstraint: "use real facts",
    antiSlopRules: ["1", "2", "3", "4", "5", "6"],
  },
  scores: {
    curiosity: 9, usefulness: 9, visualPotential: 9, purchaseIntent: 9, novelty: 8,
    originality: 8, retentionPotential: 9, shareability: 8, productFit: 10, siteContinuation: 10, total: 9,
  },
};

const contentPackage: ContentPackage = {
  packageId: "pkg-ss-20260823-rtx-value",
  campaignId: "ss-20260823-rtx-value",
  ideaId: idea.id,
  corePromise: "value",
  feature: "compare",
  subjectIds: [...idea.subjectIds],
  requiredFacts: [...idea.requiredFacts],
  platforms: ["youtube-shorts", "tiktok", "instagram-reels"].map((platform) => ({
    platform: platform as VideoPlatform,
    objective: platform === "tiktok" ? "interaction" : platform === "instagram-reels" ? "polish" : "hook",
    opening: "open",
    pacing: "fast",
    ending: "answer",
    captionAngle: "$437 more for four FPS?",
    cta: "Compare on SpecSmithPC",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080Super", "#RTX4080", "#PCComparison"],
  })),
  site: {
    route: idea.productConnection.route,
    pagePurpose: "full comparison",
    sections: ["comparison"],
    continuationAction: "compare",
  },
  attribution: {
    utmSourceByPlatform: { "youtube-shorts": "youtube", tiktok: "tiktok", "instagram-reels": "instagram" },
    utmMedium: "short-form-video",
    utmCampaign: "ss-20260823-rtx-value",
    conversionEvents: ["site-click"],
  },
};

function fingerprint(platform: VideoPlatform): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId: `creative-${platform}`,
    packageId: contentPackage.packageId,
    campaignId: contentPackage.campaignId,
    ideaId: idea.id,
    platform,
    format: "comparison",
    feature: "compare",
    subjectIds: [...idea.subjectIds],
    hookFamily: "price-gap-comparison",
    hookText: idea.hook,
    visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer",
    targetDurationSeconds: 21.8,
    beatCount: 6,
    plannedBeatChangesPer10Seconds: 2.294,
    editDensity: "high",
    captionedBeatRatio: 0.3,
    captionDensity: "low",
    firstVisualType: "generated-cinematic",
    sfxDensity: "medium",
    ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080Super", "#RTX4080", "#PCComparison"],
    experimentId: `exp-${platform}`,
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
  };
}

const dimensions = {
  "factual-accuracy": 9,
  "product-integrity": 9,
  "hook-clarity": 9,
  "visual-quality": 9,
  "caption-readability": 9,
  "audio-quality": 9,
  "pacing-retention": 9,
  "specsmith-relevance": 10,
  "cta-accuracy": 10,
} as const;

/**
 * The one digest that ties the whole gate together: the bytes a reviewer
 * watched (QualityReviewResult.reviewedMediaSha256) and the bytes the rights
 * registry cleared (PublicationAssetBundleResult.approvedMasterSha256). The
 * gate no longer accepts either as an argument, so the fixtures set them on
 * the two results they genuinely belong to.
 */
const MASTER_SHA256 = "a".repeat(64);

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
  };
}

const rights: PublicationAssetBundleResult = {
  publishable: true,
  missingAssetIds: [],
  untrackedAssetIds: [],
  nonApprovedAssetIds: [],
  approvedMasterSha256: MASTER_SHA256,
  approvedMasterUri: "https://cdn.specsmithpc.com/masters/final-v4.mp4",
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

function gate(platform: VideoPlatform) {
  return {
    qualityReview: quality(platform),
    assetBundle: rights,
  };
}

describe("publishing", () => {
  it("creates an attributed YouTube request with direct website link and hashtags", () => {
    const result = buildMetricoolPublishingRequest(
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

  it("uses profile-link CTA semantics for TikTok and Instagram", () => {
    const tiktok = buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      networks(), "2026-08-24T18:00:00", NOW,
    );
    const instagram = buildMetricoolPublishingRequest(
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

  it("adds deterministic, platform-specific first comments that invite useful replies", () => {
    const requests = (["youtube-shorts", "tiktok", "instagram-reels"] as const).map((platform) =>
      buildMetricoolPublishingRequest(
        idea,
        contentPackage,
        fingerprint(platform),
        gate(platform),
        networks(),
        "2026-08-24T18:00:00",
        NOW,
      )
    );

    for (const request of requests) {
      expect(request.first_comment).toMatch(/\?/);
      expect(request.first_comment.length).toBeLessThanOrEqual(300);
      expect(request.first_comment).not.toMatch(/https?:|#/);
      expect(request.first_comment).toBe(buildFirstComment(idea, request.platform));
    }
    expect(new Set(requests.map((request) => request.first_comment)).size).toBe(3);
  });

  it("fails closed on QC, rights, disconnected networks, media hashes, and guessed website bases", () => {
    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), qualityReview: quality("tiktok", false) },
      networks(), "2026-08-24T18:00:00", NOW,
    )).toThrow(/quality review/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), assetBundle: { ...rights, publishable: false, nonApprovedAssetIds: ["asset-x"] } },
      networks(), "2026-08-24T18:00:00", NOW,
    )).toThrow(/asset-rights/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...config, connectedNetworks: ["youtube"] }, "2026-08-24T18:00:00", NOW,
    )).toThrow(/not connected/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "bad" } },
      networks(), "2026-08-24T18:00:00", NOW,
    )).toThrow(/SHA-256/);

    expect(() => buildTrackedWebsiteUrl(contentPackage, "creative-x", "tiktok", "http://not-secure.test"))
      .toThrow(/https/);

    // Metricool cannot fetch a local artifact reference, even when that URI
    // came from the approved registry record.
    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), assetBundle: { ...rights, approvedMasterUri: "artifact:final-v4.mp4" } },
      networks(), "2026-08-24T18:00:00", NOW,
    )).toThrow(/https/);
  });

  it("never emits an auto-publishing request unless autoPublish is explicit", () => {
    const drafted = buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      networks(), "2026-08-24T18:00:00", NOW,
    );
    expect(drafted.draft).toBe(true);

    const live = buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...networks(), autoPublish: true }, "2026-08-24T18:00:00", NOW,
    );
    expect(live.draft).toBe(false);
  });

  it("refuses a second publication of the same creative across separate ledgers", () => {
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

  it("keeps an auditable lifecycle and blocks impossible or duplicate publication transitions", () => {
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

  it("emits the digest recorded by the quality review", () => {
    expect(build().finalMediaSha256).toBe(MASTER_SHA256);
  });

  it("ignores a hash supplied by the caller", () => {
    // The old field names are no longer part of PublishingGateInput. Passing
    // them anyway must change nothing: this is what proves the value is read
    // from the review rather than from the argument object.
    const forged = "9".repeat(64);
    const result = build({ finalMediaSha256: forged, approvedMediaSha256: forged });
    expect(result.finalMediaSha256).toBe(MASTER_SHA256);
    expect(result.finalMediaSha256).not.toBe(forged);
  });

  it("uses the approved registry URI and ignores a caller-supplied media ref", () => {
    const result = build({ finalMediaRef: "https://attacker.invalid/different.mp4" });
    expect(result.media).toEqual([rights.approvedMasterUri]);
  });

  it("refuses a review of bytes the rights registry did not approve", () => {
    expect(() => build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "c".repeat(64) },
    })).toThrow(/not the rights-approved master/);
  });

  it("refuses a bundle that resolved no approved master hash", () => {
    // publishable:true with a null hash is exactly the shape a registry
    // produces for a master registered without a digest.
    expect(() => build({
      assetBundle: { ...rights, approvedMasterSha256: null },
    })).toThrow(/no approved master hash/);
  });

  it("refuses a bundle that resolved no approved master URI", () => {
    expect(() => build({
      assetBundle: { ...rights, approvedMasterUri: null },
    })).toThrow(/approvedMasterUri/);
  });

  it("normalises case on both sides rather than failing a real match", () => {
    expect(build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: MASTER_SHA256.toUpperCase() },
      assetBundle: { ...rights, approvedMasterSha256: MASTER_SHA256.toUpperCase() },
    }).finalMediaSha256).toBe(MASTER_SHA256);
  });

  it("rejects a malformed approved hash instead of matching it loosely", () => {
    expect(() => build({
      qualityReview: { ...quality("tiktok"), reviewedMediaSha256: "not-a-digest" },
      assetBundle: { ...rights, approvedMasterSha256: "not-a-digest" },
    })).toThrow(/SHA-256/);
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
  it("accepts a slot one second in the future", () => {
    expect(at("2026-08-24T18:00:00", "2026-08-24T21:59:59Z").date).toBe("2026-08-24T18:00:00");
  });

  it("refuses a slot at exactly the current instant", () => {
    expect(() => at("2026-08-24T18:00:00", "2026-08-24T22:00:00Z")).toThrow(/not in the future/);
  });

  it("refuses a slot one second in the past", () => {
    expect(() => at("2026-08-24T18:00:00", "2026-08-24T22:00:01Z")).toThrow(/not in the future/);
  });

  it("no longer waves through a slot inside the old 24-hour grace window", () => {
    // Two hours past. The previous implementation accepted this.
    expect(() => at("2026-08-24T18:00:00", "2026-08-25T00:00:00Z")).toThrow(/not in the future/);
  });

  it("applies the zone's real offset rather than reading the wall clock as UTC", () => {
    // The same wall-clock string, the same instant, two zones. Read as UTC,
    // 18:00 would be in the past for both. It is only future in Los Angeles
    // because that zone is seven hours behind, which is the whole point.
    expect(() => at("2026-08-24T18:00:00", "2026-08-24T20:00:00Z", "Europe/London")).toThrow(/not in the future/);
    expect(at("2026-08-24T18:00:00", "2026-08-24T20:00:00Z", "America/Los_Angeles").date).toBe("2026-08-24T18:00:00");
  });

  it("uses the offset in force on the scheduled date, not today's", () => {
    // 2026-01-15 is EST (UTC-5), so noon local is 17:00:00Z — an hour later
    // than the same wall clock would be under the summer offset.
    expect(at("2026-01-15T12:00:00", "2026-01-15T16:59:59Z").date).toBe("2026-01-15T12:00:00");
    expect(() => at("2026-01-15T12:00:00", "2026-01-15T17:00:01Z")).toThrow(/not in the future/);
  });

  it("refuses a wall time inside the spring-forward gap", () => {
    expect(() => at("2026-03-08T02:30:00", "2026-03-01T00:00:00Z"))
      .toThrow(/does not exist/);
  });

  it("refuses a wall time repeated by the fall-back overlap", () => {
    expect(() => at("2026-11-01T01:30:00", "2026-10-01T00:00:00Z"))
      .toThrow(/ambiguous/);
  });

  it("accepts an unambiguous wall time after the spring-forward jump", () => {
    expect(at("2026-03-08T03:30:00", "2026-03-01T00:00:00Z").date)
      .toBe("2026-03-08T03:30:00");
  });

  it("refuses a timezone that is not a real IANA identifier", () => {
    expect(() => at("2026-08-24T18:00:00", "2026-08-23T00:00:00Z", "EST5EDT/Nope"))
      .toThrow(/not a recognised IANA timezone/);
  });

  it("still requires a local wall-clock string with no offset of its own", () => {
    expect(() => at("2026-08-24T18:00:00Z", "2026-08-23T00:00:00Z")).toThrow(/YYYY-MM-DDTHH:mm:ss/);
  });
});

// REGRESSION (review item 5): TikTok captions are one run of text.
describe("TikTok copy contains no line breaks", () => {
  const tiktok = buildMetricoolPublishingRequest(
    idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
    networks(), "2026-08-24T18:00:00", NOW,
  );

  it("emits a single-line caption", () => {
    expect(tiktok.text).not.toContain("\n");
    expect(tiktok.text).not.toContain("\r");
  });

  it("keeps the CTA and hashtags that the line breaks used to separate", () => {
    expect(tiktok.text).toContain("link in bio");
    expect(tiktok.text).toContain("#SpecSmithPC");
  });

  it("collapses the run of spaces rather than leaving a double gap", () => {
    expect(tiktok.text).not.toMatch(/ {2}/);
  });

  it("leaves the other platforms' multi-line copy alone", () => {
    const youtube = buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("youtube-shorts"), gate("youtube-shorts"),
      networks(), "2026-08-24T16:00:00", NOW,
    );
    // YouTube descriptions do preserve newlines, and the tracked URL needs its
    // own line, so this fix is deliberately TikTok-only.
    expect(youtube.text).toContain("\n");
  });
});
