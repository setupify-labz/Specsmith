import { describe, expect, it } from "vitest";
import {
  advancePublicationLedger,
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
  };
}

const rights: PublicationAssetBundleResult = {
  publishable: true,
  missingAssetIds: [],
  untrackedAssetIds: [],
  nonApprovedAssetIds: [],
};

const config = {
  blogId: "6769542",
  timezone: "America/New_York",
  siteBaseUrl: "https://example.specsmithpc.test",
  connectedNetworks: ["instagram", "tiktok", "youtube"] as const,
};

function gate(platform: VideoPlatform) {
  return {
    qualityReview: quality(platform),
    assetBundle: rights,
    finalMediaRef: "artifact:final-v4.mp4",
    finalMediaSha256: "a".repeat(64),
  };
}

describe("publishing", () => {
  it("creates an attributed YouTube request with direct website link and hashtags", () => {
    const result = buildMetricoolPublishingRequest(
      idea,
      contentPackage,
      fingerprint("youtube-shorts"),
      gate("youtube-shorts"),
      { ...config, connectedNetworks: [...config.connectedNetworks] },
      "2026-08-24T16:00:00",
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
      { ...config, connectedNetworks: [...config.connectedNetworks] }, "2026-08-24T18:00:00",
    );
    const instagram = buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("instagram-reels"), gate("instagram-reels"),
      { ...config, connectedNetworks: [...config.connectedNetworks] }, "2026-08-24T10:00:00",
    );

    expect(tiktok.networks).toEqual(["tiktok"]);
    expect(tiktok.tiktok_title).toBeTruthy();
    expect(tiktok.websiteCtaMode).toBe("profile-link");
    expect(tiktok.text).toContain("link in bio");
    expect(instagram.networks).toEqual(["instagram"]);
    expect(instagram.content_type).toBe("REEL");
    expect(instagram.websiteCtaMode).toBe("profile-link");
  });

  it("fails closed on QC, rights, disconnected networks, media hashes, and guessed website bases", () => {
    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), qualityReview: quality("tiktok", false) },
      { ...config, connectedNetworks: [...config.connectedNetworks] }, "2026-08-24T18:00:00",
    )).toThrow(/quality review/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"),
      { ...gate("tiktok"), assetBundle: { ...rights, publishable: false, nonApprovedAssetIds: ["asset-x"] } },
      { ...config, connectedNetworks: [...config.connectedNetworks] }, "2026-08-24T18:00:00",
    )).toThrow(/asset-rights/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), gate("tiktok"),
      { ...config, connectedNetworks: ["youtube"] }, "2026-08-24T18:00:00",
    )).toThrow(/not connected/);

    expect(() => buildMetricoolPublishingRequest(
      idea, contentPackage, fingerprint("tiktok"), { ...gate("tiktok"), finalMediaSha256: "bad" },
      { ...config, connectedNetworks: [...config.connectedNetworks] }, "2026-08-24T18:00:00",
    )).toThrow(/SHA-256/);

    expect(() => buildTrackedWebsiteUrl(contentPackage, "creative-x", "tiktok", "http://not-secure.test"))
      .toThrow(/https/);
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
