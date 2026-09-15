// MASTER #6 — Concept assessment and divergence tests, run against the REAL
// three section-1 packages rather than against invented examples.

import { describe, expect, it } from "vitest";

import { assessConcept, toStoryboardBeats, type CreativeConcept } from "./concept.ts";
import { assessDivergence } from "./divergence.ts";
import {
  AVAILABLE_CAPABILITIES,
  CAPABILITY_SPEC_CARD_SURFACE,
  DISCLOSURE_EDITORIAL_PRICE,
  DISCLOSURE_FPS_ESTIMATE,
  DISCLOSURE_MODEL_RANGE,
  PACKAGE_BRANCH,
  PACKAGE_CROSSOVER,
  PACKAGE_SPEC_FORENSICS,
  SECTION_ONE_PACKAGES,
} from "./sectionOnePackages.ts";

const GUARANTEED = [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_EDITORIAL_PRICE, DISCLOSURE_MODEL_RANGE];

function assess(concept: CreativeConcept, available = AVAILABLE_CAPABILITIES) {
  return assessConcept({ concept, availableCapabilityIds: available, guaranteedDisclosureIds: GUARANTEED });
}

describe("the producible section-1 packages survive their own architecture", () => {
  for (const concept of [PACKAGE_CROSSOVER, PACKAGE_BRANCH]) {
    it(`${concept.conceptId} is producible`, () => {
      const assessment = assess(concept);
      expect(assessment.defects).toEqual([]);
      expect(assessment.producible).toBe(true);
      expect(assessment.visualHonesty.acceptable).toBe(true);
    });
  }
});

describe("a blocked package is reported, not silently dropped", () => {
  it("reports the missing spec-card surface instead of pretending the package is fine", () => {
    const assessment = assess(PACKAGE_SPEC_FORENSICS);
    expect(assessment.producible).toBe(false);
    expect(assessment.blockedBy.map((capability) => capability.capabilityId)).toEqual([CAPABILITY_SPEC_CARD_SURFACE]);
    expect(assessment.defects.map((defect) => defect.code)).toContain("missing-capability");
  });

  it("becomes producible the moment the missing surface exists", () => {
    const assessment = assess(PACKAGE_SPEC_FORENSICS, [...AVAILABLE_CAPABILITIES, CAPABILITY_SPEC_CARD_SURFACE]);
    expect(assessment.blockedBy).toEqual([]);
    expect(assessment.producible).toBe(true);
  });
});

describe("concept defects", () => {
  it("rejects a concept that cannot state the viewer's question", () => {
    const assessment = assess({ ...PACKAGE_CROSSOVER, viewerQuestion: "  " });
    expect(assessment.defects.map((defect) => defect.code)).toContain("no-viewer-question");
  });

  it("rejects a gap or an overlap between beats", () => {
    const beats = [...PACKAGE_CROSSOVER.beats];
    beats[1] = { ...beats[1], startSecond: beats[1].startSecond + 2 };
    const assessment = assess({ ...PACKAGE_CROSSOVER, beats });
    expect(assessment.defects.map((defect) => defect.code)).toContain("beats-not-contiguous");
  });

  it("rejects a beat that shows a visual nobody declared", () => {
    const beats = [...PACKAGE_CROSSOVER.beats];
    beats[0] = { ...beats[0], visualIds: ["p1-undeclared-graphic"] };
    const assessment = assess({ ...PACKAGE_CROSSOVER, beats });
    expect(assessment.defects.map((defect) => defect.code)).toContain("beat-references-unknown-visual");
  });

  it("rejects an estimate illustration whose disclosure the delivery layer does not guarantee", () => {
    const assessment = assessConcept({
      concept: PACKAGE_CROSSOVER,
      availableCapabilityIds: AVAILABLE_CAPABILITIES,
      guaranteedDisclosureIds: [],
    });
    expect(assessment.defects.map((defect) => defect.code)).toContain("undisclosed-estimate");
  });

  it("is deterministic", () => {
    expect(assess(PACKAGE_CROSSOVER)).toEqual(assess(PACKAGE_CROSSOVER));
  });
});

describe("emission into the pipeline's own beat type", () => {
  it("produces contiguous beats that carry the visual classification forward", () => {
    const beats = toStoryboardBeats(PACKAGE_CROSSOVER);
    expect(beats).toHaveLength(PACKAGE_CROSSOVER.beats.length);
    expect(beats[0].startSecond).toBe(0);
    for (let index = 1; index < beats.length; index += 1) {
      expect(beats[index].startSecond).toBe(beats[index - 1].endSecond);
    }
    const reversal = beats.find((beat) => beat.purpose === "reversal");
    expect(reversal?.visualDirection).toContain("[derived-illustration:p1-band]");
    expect(reversal?.visualDirection).toContain("Explanatory drawing");
  });

  it("names the exact reproducible state for every product capture", () => {
    for (const beat of toStoryboardBeats(PACKAGE_BRANCH)) {
      for (const match of beat.visualDirection.matchAll(/\[real-product-capture:([^\]]+)\]/g)) {
        expect(beat.visualDirection).toContain("state compare-");
        expect(match[1]).not.toBe("");
      }
    }
  });
});

describe("divergence of the section-1 set", () => {
  it("accepts the three packages as genuinely different", () => {
    const report = assessDivergence(SECTION_ONE_PACKAGES);
    expect(report.findings).toEqual([]);
    expect(report.divergent).toBe(true);
    expect(report.axisSpread).toEqual({ audienceExperience: 3, explanatoryStructure: 3, visualMechanism: 3 });
  });

  it("rejects a reworded duplicate", () => {
    const reworded: CreativeConcept = {
      ...PACKAGE_CROSSOVER,
      conceptId: "m6-crossover-reworded",
      beats: PACKAGE_CROSSOVER.beats.map((beat) => ({ ...beat, narration: `${beat.narration} Seriously.` })),
    };
    const report = assessDivergence([PACKAGE_CROSSOVER, reworded]);
    expect(report.findings.map((finding) => finding.code)).toContain("identical-axes");
    expect(report.divergent).toBe(false);
  });

  it("rejects a set that varies on only one axis", () => {
    const sameButSplit: CreativeConcept = {
      ...PACKAGE_CROSSOVER,
      conceptId: "m6-crossover-split",
      axes: { ...PACKAGE_CROSSOVER.axes, visualMechanism: "split-screen-fork" },
      viewerTakeaway: `${PACKAGE_CROSSOVER.viewerTakeaway} Also this.`,
    };
    const report = assessDivergence([PACKAGE_CROSSOVER, sameButSplit]);
    expect(report.findings.map((finding) => finding.code)).toContain("single-axis-variation");
  });

  it("rejects two concepts that leave the viewer with the same takeaway", () => {
    const echo: CreativeConcept = {
      ...PACKAGE_BRANCH,
      conceptId: "m6-branch-echo",
      viewerTakeaway: PACKAGE_CROSSOVER.viewerTakeaway,
    };
    const report = assessDivergence([PACKAGE_CROSSOVER, PACKAGE_SPEC_FORENSICS, echo]);
    expect(report.findings.map((finding) => finding.code)).toContain("shared-viewer-takeaway");
  });

  it("refuses to call a single concept divergent", () => {
    const report = assessDivergence([PACKAGE_CROSSOVER]);
    expect(report.divergent).toBe(false);
    expect(report.findings[0].code).toBe("too-few-concepts");
  });
});
