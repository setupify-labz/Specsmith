// MASTER #6 — The persistent disclosure band.
//
// A beat caption and a disclosure are different things. Cues may not overlap,
// because beat captions must be unambiguous; a disclosure has to stay on screen
// the whole time the numbers it qualifies are on screen. Putting a disclosure
// in the cue sequence would mean it is absent for most of the video.

import { describe, expect, it } from "vitest";

import {
  buildAssDocument,
  parseCaptionRenderState,
  CAPTION_LINE_MAX_CHARS,
  DISCLOSURE_LINE_MAX_CHARS,
  type CaptionRenderState,
} from "./captionRender.ts";

const FPS_DISCLOSURE = "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.";
const RANGE_DISCLOSURE = "The range shown is a model convention, not measured or calibrated uncertainty.";

function state(overrides: Partial<CaptionRenderState> = {}): CaptionRenderState {
  return {
    durationSeconds: 44.5,
    cues: [
      { startSecond: 0, endSecond: 6, text: "Commit to an answer first" },
      { startSecond: 6, endSecond: 44.5, text: "Undecided is a result" },
    ],
    ...overrides,
  };
}

describe("a state without disclosures is unchanged", () => {
  it("emits no disclosure style, so existing renders stay byte-identical", () => {
    const document = buildAssDocument(state());
    expect(document).not.toContain("SpecSmithDisclosure");
    expect(document.split("\n").filter((line) => line.startsWith("Style:"))).toHaveLength(1);
  });
});

describe("a disclosure is held for the whole piece", () => {
  const document = buildAssDocument(
    state({ disclosures: [{ text: FPS_DISCLOSURE }, { text: RANGE_DISCLOSURE }] }),
  );

  it("renders every disclosure for the full duration, not for one beat", () => {
    for (const disclosure of [FPS_DISCLOSURE, RANGE_DISCLOSURE]) {
      const firstWords = disclosure.split(" ").slice(0, 4).join(" ");
      const line = document.split("\n").find((entry) => entry.includes(firstWords));
      expect(line).toBeDefined();
      expect(line).toContain("0:00:00.00,0:00:44.50");
    }
  });

  it("puts disclosures on their own layer and style, leaving the beat cues alone", () => {
    const cues = document.split("\n").filter((line) => line.startsWith("Dialogue: 0,"));
    const band = document.split("\n").filter((line) => line.startsWith("Dialogue: 1,"));
    expect(cues).toHaveLength(2);
    expect(band).toHaveLength(2);
    expect(band.every((line) => line.includes("SpecSmithDisclosure"))).toBe(true);
  });

  it("defines every style its dialogue lines reference", () => {
    // A dialogue line naming a style that is not defined does not fail: libass
    // silently falls back to Default, and the band renders at caption size and
    // position, colliding with the beat caption. The reference must be real.
    const defined = new Set(
      document
        .split("\n")
        .filter((line) => line.startsWith("Style: "))
        .map((line) => line.slice("Style: ".length).split(",")[0]),
    );
    expect(defined).toContain("SpecSmithDisclosure");
    for (const line of document.split("\n").filter((entry) => entry.startsWith("Dialogue: "))) {
      const referenced = line.split(",")[3];
      expect(defined, `dialogue references undefined style "${referenced}"`).toContain(referenced);
    }
  });

  it("keeps the disclosure text verbatim, only inserting line breaks", () => {
    for (const disclosure of [FPS_DISCLOSURE, RANGE_DISCLOSURE]) {
      const line = document.split("\n").find((entry) => entry.includes(disclosure.split(" ").slice(0, 4).join(" ")))!;
      const rendered = line.slice(line.indexOf(",,0,0,0,,") + ",,0,0,0,,".length).replace(/\\N/g, " ");
      expect(rendered).toBe(disclosure);
    }
  });

  it("wraps at the smaller band budget rather than the caption budget", () => {
    const line = document.split("\n").find((entry) => entry.includes("FPS values are SpecSmith"))!;
    const text = line.slice(line.indexOf(",,0,0,0,,") + ",,0,0,0,,".length);
    for (const rendered of text.split("\\N")) {
      expect(rendered.length).toBeLessThanOrEqual(DISCLOSURE_LINE_MAX_CHARS);
      // The point of the band: this would not fit a beat caption line.
      expect(DISCLOSURE_LINE_MAX_CHARS).toBeGreaterThan(CAPTION_LINE_MAX_CHARS);
    }
  });
});

describe("parsing", () => {
  it("accepts a state with no disclosures and omits the key", () => {
    const parsed = parseCaptionRenderState(JSON.parse(JSON.stringify(state())));
    expect(parsed.disclosures).toBeUndefined();
  });

  it("round-trips disclosures", () => {
    const parsed = parseCaptionRenderState(
      JSON.parse(JSON.stringify(state({ disclosures: [{ text: FPS_DISCLOSURE }] }))),
    );
    expect(parsed.disclosures).toEqual([{ text: FPS_DISCLOSURE }]);
  });

  it("refuses an empty disclosure rather than rendering a blank band", () => {
    expect(() =>
      parseCaptionRenderState(JSON.parse(JSON.stringify(state({ disclosures: [{ text: "  " }] })))),
    ).toThrow(/must not be empty/);
  });

  it("refuses a malformed disclosures field", () => {
    const raw = { ...JSON.parse(JSON.stringify(state())), disclosures: "both of them" };
    expect(() => parseCaptionRenderState(raw)).toThrow(/must be an array/);
  });
});
