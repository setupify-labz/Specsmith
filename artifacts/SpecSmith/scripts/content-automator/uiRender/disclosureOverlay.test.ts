// The disclosure panel is accepted only after its measured layout passes. The
// browser does the measuring; these cases feed the assessor measurements a
// broken panel would produce.

import { describe, expect, it } from "vitest";
import { CREATIVE_DISCLOSURES } from "../v2/creative/concept.ts";
import {
  assessDisclosurePanel,
  contrastRatio,
  MIN_DISCLOSURE_CONTRAST,
  MIN_DISCLOSURE_FONT_PX,
  parseDisclosureOverlayState,
  type DisclosurePanelMeasurement,
} from "./disclosureOverlay.ts";

const LINES = [CREATIVE_DISCLOSURES["disclosure.fps-estimate"], CREATIVE_DISCLOSURES["disclosure.model-range"]];
const good: DisclosurePanelMeasurement = {
  renderedText: LINES.join("\n"), fontPx: 36, textColor: "rgb(255, 255, 255)", backgroundColor: "rgb(11, 12, 18)",
  overflows: false, textBottom: 130, innerBottom: 138, renderedLineCount: 4,
};

describe("the disclosure panel assessor", () => {
  it("accepts the verbatim disclosures, unclipped, at a readable size and contrast", () => {
    expect(assessDisclosurePanel(LINES, good)).toEqual([]);
    expect(contrastRatio(good.textColor, good.backgroundColor)).toBeGreaterThan(MIN_DISCLOSURE_CONTRAST);
  });

  it.each([
    ["reworded text", { renderedText: "FPS values are estimates." }, /not the required disclosure verbatim/],
    ["a dropped sentence", { renderedText: LINES[0] }, /not the required disclosure verbatim/],
    ["overflowing text", { overflows: true }, /overflows the panel/],
    ["a last line below the panel's edge", { textBottom: 150 }, /overflows the panel/],
    ["type too small", { fontPx: MIN_DISCLOSURE_FONT_PX - 2 }, /under the 34px minimum/],
    ["low contrast", { textColor: "rgb(90, 90, 100)" }, /contrast is .* under 7:1/],
  ])("refuses %s", (_label, change, message) => {
    expect(assessDisclosurePanel(LINES, { ...good, ...change }).join(" ")).toMatch(message);
  });

  it("refuses a state with no disclosure text or an odd panel size", () => {
    expect(() => parseDisclosureOverlayState({ lines: [], width: 1080, height: 300 })).toThrow(/non-empty/);
    expect(() => parseDisclosureOverlayState({ lines: [" "], width: 1080, height: 300 })).toThrow(/non-empty/);
    expect(() => parseDisclosureOverlayState({ lines: LINES, width: 1080, height: 301 })).toThrow(/even/);
  });
});
