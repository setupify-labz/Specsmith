import { describe, expect, it } from "vitest";
import { BRAND_HASHTAG, buildHashtags, HASHTAG_STRATEGY_ID } from "./hashtags.ts";
import type { ContentIdea, VideoPlatform } from "./types.ts";

function makeIdea(overrides: Partial<ContentIdea> = {}): ContentIdea {
  return {
    id: "rtx-4080-super-value",
    format: "comparison",
    title: "RTX 4080 Super vs RTX 4080: is four FPS worth it?",
    hook: "$437 more for four FPS?",
    angle: "Compare two real GPU choices on value.",
    targetAudience: "PC builders",
    requiredFacts: ["RTX 4080 Super", "RTX 4080", "estimated FPS", "price delta"],
    subjectIds: ["gpu-rtx-4080-super", "gpu-rtx-4080"],
    productConnection: {
      feature: "compare",
      route: "/compare",
      userProblem: "Buyers need to know whether the faster GPU is worth the price premium.",
      whySpecSmith: "SpecSmithPC compares the tradeoff in one place.",
      continuationAction: "Open Compare and inspect the full tradeoff.",
      sitePayoff: "The viewer can reproduce the decision.",
    },
    creativeDNA: {
      conceptName: "Price shock",
      visualWorld: "fast GPU comparison",
      narrativeEngine: "price -> performance -> verdict",
      openingImage: "price gap",
      patternInterrupt: "four FPS",
      retentionBeats: ["price", "fps", "proof", "verdict", "cta"],
      payoff: "value winner",
      audioDirection: "fast impacts",
      originalityConstraint: "use the real comparison",
      antiSlopRules: ["a", "b", "c", "d", "e", "f"],
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
      total: 8.9,
    },
    ...overrides,
  };
}

const platforms: VideoPlatform[] = ["youtube-shorts", "tiktok", "instagram-reels"];

describe("publication hashtags", () => {
  it("always includes the SpecSmithPC brand hashtag and stays inside platform caps", () => {
    const idea = makeIdea();

    for (const platform of platforms) {
      const tags = buildHashtags(idea, platform);
      expect(tags[0]).toBe(BRAND_HASHTAG);
      expect(tags.length).toBeGreaterThanOrEqual(3);
      expect(tags.length).toBeLessThanOrEqual(platform === "youtube-shorts" ? 4 : 5);
      expect(new Set(tags.map((tag) => tag.toLowerCase())).size).toBe(tags.length);
    }
  });

  it("extracts exact GPU model hashtags only from models named in the idea", () => {
    const tags = buildHashtags(makeIdea(), "tiktok");

    expect(tags).toContain("#RTX4080Super");
    expect(tags).toContain("#RTX4080");
    expect(tags.some((tag) => tag.includes("4090"))).toBe(false);
  });

  it("recognizes common AMD, Ryzen, and Intel model spellings", () => {
    const idea = makeIdea({
      title: "RX 7900 XTX vs Ryzen 7 7800X3D with Core i9-14900K",
      hook: "Three expensive PC parts enter one comparison.",
      requiredFacts: ["RX 7900 XTX", "Ryzen 7 7800X3D", "Core i9-14900K"],
    });
    const tags = buildHashtags(idea, "instagram-reels");

    expect(tags).toContain("#RX7900XTX");
    expect(tags).toContain("#Ryzen77800X3D");
    expect(tags).toContain("#IntelCoreI914900K");
  });

  it("does not use low-intent spam hashtags", () => {
    const tags = buildHashtags(makeIdea(), "tiktok").map((tag) => tag.toLowerCase());

    expect(tags).not.toContain("#fyp");
    expect(tags).not.toContain("#viral");
    expect(tags).not.toContain("#trending");
  });

  it("is deterministic so a publication package can be reproduced", () => {
    const idea = makeIdea();
    expect(buildHashtags(idea, "youtube-shorts")).toEqual(buildHashtags(idea, "youtube-shorts"));
    expect(HASHTAG_STRATEGY_ID).toBe("intent-balanced-v1");
  });

  it("falls back to useful PC intent tags when no exact model is named", () => {
    const idea = makeIdea({
      id: "crate-challenge",
      format: "game",
      title: "Build Crate picked this PC. You can change one part.",
      hook: "One change before the build locks.",
      requiredFacts: ["compatible parts", "price"],
      subjectIds: ["gpu-1", "cpu-1"],
      productConnection: {
        ...makeIdea().productConnection,
        feature: "build-crate",
        route: "/crate",
      },
    });
    const tags = buildHashtags(idea, "youtube-shorts");

    expect(tags).toContain("#SpecSmithPC");
    expect(tags).toContain("#PCBuild");
    expect(tags).toContain("#PCGaming");
  });
});
