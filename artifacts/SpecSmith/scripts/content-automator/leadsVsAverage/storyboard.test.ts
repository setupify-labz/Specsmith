// The animated proof of concept states only what the current model gives,
// counts ties as ties, and passes MASTER #1's measurable storyboard checks.

import { describe, expect, it } from "vitest";
import { reviewStoryboard } from "../v2/creative/storyboardQualityGate.ts";
import { DEMO_PAIRING, leadsVsAverageFacts, type LeadsVsAverageFacts } from "./facts.ts";
import { decisiveLeadsB, leadsVsAverageScenes, leadsVsAverageStoryboard, shortGameName } from "./storyboard.ts";

const facts = leadsVsAverageFacts(DEMO_PAIRING);

describe("facts from the current model", () => {
  it("match what the corrected Compare page shows for this pairing", () => {
    // compareIntegrity.test.tsx pins the rendered page to these same numbers.
    expect(facts.tally).toEqual({ leadsA: 10, leadsB: 7, ties: 3 });
    expect([facts.averageA, facts.averageB]).toEqual([121, 123]);
    expect(facts.tally.leadsA + facts.tally.leadsB + facts.tally.ties).toBe(facts.games.length);
    expect(facts.leadRangeA).toEqual([1, 3]);
  });

  it("names only Build B's wins that dwarf Build A's largest lead", () => {
    const decisive = decisiveLeadsB(facts);
    expect(decisive.map((game) => shortGameName(game.game))).toEqual(["Minecraft", "Valorant", "CS2", "Rainbow Six Siege"]);
    for (const game of decisive) expect(-game.margin).toBeGreaterThan(2 * facts.leadRangeA[1]);
  });

  it("refuses an unknown part rather than substituting one", () => {
    expect(() => leadsVsAverageFacts({ ...DEMO_PAIRING, gpuA: "rtx9999" })).toThrow(/Unknown GPU/);
  });
});

describe("the script", () => {
  const scenes = leadsVsAverageScenes(facts);
  const allText = scenes.flatMap((scene) => [scene.caption, scene.narration]).join("\n");

  it("shows the tie count beside the lead counts, and never calls a tie a lead", () => {
    expect(scenes.find((scene) => scene.id === "tally")!.caption).toBe("10 ahead · 3 ties · 7 ahead");
    expect(allText).not.toMatch(/\b13\b|thirteen games/);
    expect(allText).not.toMatch(/\blead/i);
    expect(scenes.find((scene) => scene.id === "tally")!.narration).toMatch(/Three are ties/);
  });

  it("says model estimates, states the average gap the model gives, and points at the real route", () => {
    expect(allText).toMatch(/SpecSmith's model/);
    expect(scenes.find((scene) => scene.id === "average")!.caption).toBe("Average: 121 vs 123");
    expect(scenes.find((scene) => scene.id === "average")!.narration).toMatch(/two FPS higher/);
    expect(scenes.at(-1)!.caption).toContain("/compare");
  });

  it("is derived, not typed: other facts give other words, and facts without the split are refused", () => {
    const flipped: LeadsVsAverageFacts = { ...facts, averageA: 125, averageB: 123 };
    expect(() => leadsVsAverageScenes(flipped)).toThrow(/do not show the leads-versus-average split/);
    const other: LeadsVsAverageFacts = { ...facts, tally: { leadsA: 9, leadsB: 7, ties: 4 } };
    expect(leadsVsAverageScenes(other).find((scene) => scene.id === "tally")!.caption).toBe("9 ahead · 4 ties · 7 ahead");
  });

  it("passes MASTER #1's storyboard review with no fix, and keeps perceptual judgments open", () => {
    const review = reviewStoryboard({ reviewId: "poc", storyboard: leadsVsAverageStoryboard(facts), ctaRoute: "/compare" });
    expect(review.recommendedFixes).toEqual([]);
    expect(review.overall.find((score) => score.dimension === "overall-perceived-production-quality")?.provenance).toBe("not-assessed");
  });
});
