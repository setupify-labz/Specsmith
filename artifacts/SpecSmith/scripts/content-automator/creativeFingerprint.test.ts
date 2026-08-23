import { describe, expect, it } from "vitest";
import { buildCreativeFingerprint, buildCreativeFingerprints } from "./creativeFingerprint.ts";
import type { ContentPackage, DailyVideoPlan, PlatformScriptStoryboard, ScriptStoryboardPackage } from "./types.ts";

const plan: DailyVideoPlan = {
  rank: 1,
  qualityScore: 8.7,
  learningAdjustment: 0,
  experiment: {
    hypothesis: "price-gap-comparison should improve retention",
    primaryMetric: "retention",
    holdConstant: ["facts"],
  },
  idea: {
    id: "rtx-4080-value",
    format: "comparison",
    title: "RTX 4080 Super vs RTX 4080",
    hook: "$437 more for four FPS?",
    angle: "Compare value.",
    targetAudience: "PC buyers",
    requiredFacts: ["price", "estimated fps"],
    subjectIds: ["rtx-4080-super", "rtx-4080"],
    productConnection: {
      feature: "compare",
      route: "/compare",
      userProblem: "Buyers need to know whether the price gap is worth it.",
      whySpecSmith: "SpecSmithPC can show the exact comparison and tradeoffs.",
      continuationAction: "Open Compare and inspect the full hardware decision.",
      sitePayoff: "The viewer can continue the same comparison on the site.",
    },
    creativeDNA: {
      conceptName: "Price Shock",
      visualWorld: "Decision Trap — cinematic numbers and UI proof",
      narrativeEngine: "price shock -> evidence -> answer",
      openingImage: "GPU reveal",
      patternInterrupt: "$437",
      retentionBeats: ["hook", "evidence", "payoff"],
      payoff: "RTX 4080 wins value.",
      audioDirection: "Punchy",
      originalityConstraint: "Use the real comparison.",
      antiSlopRules: ["1", "2", "3", "4", "5", "6"],
    },
    scores: {
      curiosity: 9,
      usefulness: 9,
      visualPotential: 9,
      purchaseIntent: 9,
      novelty: 8,
      originality: 8,
      retentionPotential: 9,
      shareability: 8,
      productFit: 10,
      siteContinuation: 10,
      total: 9,
    },
  },
};

const contentPackage: ContentPackage = {
  packageId: "pkg-ss-20260823-rtx-4080-value",
  campaignId: "ss-20260823-rtx-4080-value",
  ideaId: plan.idea.id,
  corePromise: "value",
  feature: "compare",
  subjectIds: [...plan.idea.subjectIds],
  requiredFacts: [...plan.idea.requiredFacts],
  platforms: ["youtube-shorts", "tiktok", "instagram-reels"].map((platform) => ({
    platform: platform as "youtube-shorts" | "tiktok" | "instagram-reels",
    objective: platform === "tiktok" ? "interaction" : platform === "instagram-reels" ? "polish" : "hook",
    opening: "open",
    pacing: "fast",
    ending: "answer",
    captionAngle: "Four FPS for $437?",
    cta: "Compare on SpecSmithPC.",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080"],
  })),
  site: {
    route: "/compare",
    pagePurpose: "Compare the hardware.",
    sections: ["comparison"],
    continuationAction: "Open Compare.",
  },
  attribution: {
    utmSourceByPlatform: { "youtube-shorts": "youtube", tiktok: "tiktok", "instagram-reels": "instagram" },
    utmMedium: "short-form-video",
    utmCampaign: "ss-20260823-rtx-4080-value",
    conversionEvents: ["site-click"],
  },
};

const script: PlatformScriptStoryboard = {
  platform: "tiktok",
  targetDurationSeconds: 20,
  title: plan.idea.title,
  narrationStyle: "fast",
  finalCta: "Compare on SpecSmithPC",
  factualGuardrails: ["estimated fps"],
  beats: [
    { startSecond: 0, endSecond: 2, purpose: "hook", narration: "hook", visualDirection: "gpu", onScreenText: "$437 MORE?", factDependencies: [] },
    { startSecond: 2, endSecond: 8, purpose: "evidence", narration: "evidence", visualDirection: "numbers", onScreenText: "", factDependencies: ["estimated fps"] },
    { startSecond: 8, endSecond: 16, purpose: "payoff", narration: "answer", visualDirection: "winner", onScreenText: "VALUE: RTX 4080", factDependencies: [] },
    { startSecond: 16, endSecond: 20, purpose: "cta", narration: "cta", visualDirection: "site", onScreenText: "", factDependencies: [] },
  ],
};

describe("creative fingerprint", () => {
  it("creates deterministic, platform-specific creative ids and captures runtime metadata", () => {
    const result = buildCreativeFingerprint(plan, contentPackage, script, {
      variantKey: "B",
      firstVisualType: "generated-cinematic",
      editDensity: "high",
      sfxDensity: "medium",
      voiceId: "iapetus",
      narrationSpeed: 1.08,
      changedVariable: "hook",
      contentFreshness: "evergreen",
      uiProofRatio: 0.2,
    });

    expect(result.creativeId).toBe("creative-ss-20260823-rtx-4080-value-tiktok-b");
    expect(result.hookFamily).toBe("price-gap-comparison");
    expect(result.visualWorld).toBe("Decision Trap");
    expect(result.hashtags).toContain("#SpecSmithPC");
    expect(result.changedVariable).toBe("hook");
    expect(result.ctaTimingBucket).toBe("late");
    expect(result.uiProofRatio).toBe(0.2);
  });

  it("does not pretend an uncontrolled experiment has a known changed variable", () => {
    const result = buildCreativeFingerprint(plan, contentPackage, script);
    expect(result.changedVariable).toBe("unassigned");
    expect(result.editDensity).toBe("unknown");
    expect(result.firstVisualType).toBe("unknown");
  });

  it("rejects impossible ratios and narration speed", () => {
    expect(() => buildCreativeFingerprint(plan, contentPackage, script, { uiProofRatio: 1.2 })).toThrow(/0 to 1/);
    expect(() => buildCreativeFingerprint(plan, contentPackage, script, { narrationSpeed: 0 })).toThrow(/positive/);
  });

  it("builds one fingerprint per platform storyboard", () => {
    const storyboardPackage: ScriptStoryboardPackage = {
      packageId: contentPackage.packageId,
      campaignId: contentPackage.campaignId,
      ideaId: plan.idea.id,
      feature: "compare",
      route: "/compare",
      subjectIds: [...plan.idea.subjectIds],
      scripts: contentPackage.platforms.map((variant) => ({ ...script, platform: variant.platform })),
    };
    const result = buildCreativeFingerprints([plan], [contentPackage], [storyboardPackage]);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((entry) => entry.creativeId)).size).toBe(3);
  });
});
