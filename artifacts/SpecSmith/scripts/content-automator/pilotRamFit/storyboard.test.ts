// The RAM-fit pilot's claims, wording and declared visuals, checked without
// rendering. The render repeats the fact checks and reads the Builder's card
// back; these tests keep the script honest when nobody renders.

import { describe, expect, it } from "vitest";

import { CAPTION_LINE_MAX_CHARS, CAPTION_MAX_LINES, wrapCaptionForRender } from "../captionRender.ts";
import { reviewCreativeQuality } from "../v2/creativeQualityReview.ts";
import { reviewVisualHonesty } from "../v2/creative/visualHonesty.ts";
import { builderRoute, PILOT_PARTS, PilotFactError, ramFitFacts } from "./facts.ts";
import { captionTimings, DECLARED_VISUALS, pilotScenes, pilotStoryboard } from "./storyboard.ts";

const facts = ramFitFacts();
const scenes = pilotScenes(facts);

describe("the pilot's facts come from the catalog and the Builder's checker", () => {
  it("the Builder flags the DDR4 stick on the DDR5 board as a certain error, and passes it on the DDR4 board", () => {
    expect(facts.mismatch).toMatchObject({ id: "ram-type-mismatch", type: "error", confidence: "certain", title: "RAM won't fit this motherboard" });
    expect(facts.mismatch.detail).toMatch(/keyed differently and are not interchangeable/);
    expect(facts.matchPassed).toEqual(expect.arrayContaining(["CPU socket", "RAM type"]));
    expect(facts.cpu).toMatchObject({ name: "i5-12400F", socket: "LGA1700", supported_ram: ["DDR4", "DDR5"] });
  });

  it("refuses to render when the catalog stops supporting a claim", () => {
    expect(() => ramFitFacts({ ...PILOT_PARTS, ddr4Board: "b760mawifi" })).toThrow(PilotFactError);
    expect(() => ramFitFacts({ ...PILOT_PARTS, cpu: "r5-7600" })).toThrow();
    expect(() => ramFitFacts({ ...PILOT_PARTS, oldRam: "kf16ddr5" })).toThrow(PilotFactError);
  });

  it("ends on the Builder route that reproduces the warning", () => {
    expect(builderRoute()).toBe("/builder?cpu=i5-12400f&motherboard=b760mawifi&ram=cv16ddr4");
  });
});

describe("the script stays inside what the facts support", () => {
  const words = scenes.flatMap((scene) => [scene.narration, ...scene.captions, ...(scene.onScreenExtras ?? [])]).join(" ");

  it("makes no performance, benchmark or retention claim", () => {
    expect(words).not.toMatch(/fps|frame|benchmark|faster|slower|%|percent|retention|measured|estimate/i);
  });

  it("states no absolute it cannot back, and no number beyond the part names", () => {
    expect(words).not.toMatch(/\b(always|never|every|all boards|guarantee)/i);
    // Only the 4 and 5 of DDR4 and DDR5.
    for (const number of words.match(/\d+/g) ?? []) expect(["4", "5"]).toContain(number);
  });

  it("runs 12 to 20 seconds in contiguous scenes", () => {
    expect(scenes[0].startSecond).toBe(0);
    scenes.slice(1).forEach((scene, index) => expect(scene.startSecond).toBe(scenes[index].endSecond));
    expect(scenes.at(-1)!.endSecond).toBeGreaterThanOrEqual(12);
    expect(scenes.at(-1)!.endSecond).toBeLessThanOrEqual(20);
  });

  it("every caption chunk fits the renderer's two lines of 28 characters", () => {
    for (const caption of scenes.flatMap((scene) => scene.captions)) {
      const lines = wrapCaptionForRender(caption).split("\\N");
      expect(lines.length).toBeLessThanOrEqual(CAPTION_MAX_LINES);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(CAPTION_LINE_MAX_CHARS);
    }
  });

  it("passes MASTER #1's storyboard review with no open fix", () => {
    const cues = scenes.flatMap((scene) => captionTimings(scene, scene.startSecond + 0.08, scene.endSecond - scene.startSecond - 0.4))
      .map((cue) => ({ startSecond: cue.start, endSecond: cue.end, text: cue.text }));
    const review = reviewCreativeQuality({ creativeId: "pilot", packageId: "pilot", storyboard: pilotStoryboard(facts), captionCues: cues, ctaRoute: "/builder", mediaSha256: null, now: new Date(0) });
    expect(review.recommendedFixes).toEqual([]);
  });

  it("declares its drawings honestly: the keying diagram is labelled while it is the subject", () => {
    const report = reviewVisualHonesty(DECLARED_VISUALS);
    expect(report.findings).toEqual([]);
  });
});
