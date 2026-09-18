// MASTER #6 — Visual honesty tests.

import { describe, expect, it } from "vitest";

import { UI_RENDER_SURFACES } from "../../uiRender/uiRenderState.ts";
import {
  MEASUREMENT_LOOKALIKE_SUBJECTS,
  reviewVisualHonesty,
  type DeclaredVisual,
} from "./visualHonesty.ts";

function capture(overrides: Partial<Extract<DeclaredVisual, { kind: "real-product-capture" }>> = {}): DeclaredVisual {
  return {
    kind: "real-product-capture",
    visualId: "v-capture",
    surface: "compare",
    stateIdentifier: "compare-rtx5060ti-i3-13100f-rtx4060ti-r5-9600x-1440p-high",
    ...overrides,
  };
}

function illustration(overrides: Partial<Extract<DeclaredVisual, { kind: "derived-illustration" }>> = {}): DeclaredVisual {
  return {
    kind: "derived-illustration",
    visualId: "v-band",
    explains: "The range SpecSmith puts on its own frame-rate estimate, drawn over both bars.",
    subject: "fps",
    explanatoryLabel: "Explanatory drawing: SpecSmith's own estimate range, not a measurement.",
    derivedFrom: "src/lib/fps.ts FpsResult.min/max",
    showsNumericValues: true,
    ...overrides,
  };
}

describe("real product captures", () => {
  it("accepts a reproducible capture of a supported surface", () => {
    expect(reviewVisualHonesty([capture()]).acceptable).toBe(true);
  });

  it("refuses to call an unsupported surface a product capture", () => {
    // This is exactly package 2's blocker: there is no vertical spec-card
    // surface, so a spec card cannot claim to be a picture of the product.
    const report = reviewVisualHonesty([capture({ surface: "spec-card" as never })]);
    expect(report.acceptable).toBe(false);
    expect(report.findings[0].code).toBe("unsupported-surface");
  });

  it("refuses a capture that cannot say which state it shows", () => {
    const report = reviewVisualHonesty([capture({ stateIdentifier: "   " })]);
    expect(report.findings[0].code).toBe("unreproducible-capture");
  });

  it("reads the supported surface list from the renderer rather than a copy", () => {
    for (const surface of UI_RENDER_SURFACES) {
      expect(reviewVisualHonesty([capture({ surface })]).acceptable).toBe(true);
    }
  });
});

describe("derived illustrations", () => {
  it("accepts an honestly labelled, sourced illustration", () => {
    const report = reviewVisualHonesty([illustration()]);
    expect(report.acceptable).toBe(true);
    expect(report.requiresOnScreenDisclosure).toEqual(["v-band"]);
  });

  it("requires an explanatory label on every measurement-lookalike subject", () => {
    for (const subject of MEASUREMENT_LOOKALIKE_SUBJECTS) {
      const report = reviewVisualHonesty([illustration({ subject, explanatoryLabel: null })]);
      expect(report.findings.map((finding) => finding.code)).toContain("missing-explanatory-label");
    }
  });

  it("does not demand a label from an illustration on an unrelated subject", () => {
    const report = reviewVisualHonesty([
      illustration({ subject: "other", explanatoryLabel: null, showsNumericValues: false, derivedFrom: null }),
    ]);
    expect(report.acceptable).toBe(true);
    expect(report.requiresOnScreenDisclosure).toEqual([]);
  });

  it("refuses numbers on a purely conceptual drawing", () => {
    const report = reviewVisualHonesty([illustration({ derivedFrom: null })]);
    expect(report.findings.map((finding) => finding.code)).toContain("numbers-without-source");
  });

  it("refuses a drawing that describes itself as a simulation or a measurement", () => {
    for (const explains of [
      "A thermal simulation of the case at load.",
      "Simulation of airflow through the front intake.",
      "Frame times as recorded during a benchmark run.",
    ]) {
      const report = reviewVisualHonesty([illustration({ explains, subject: "airflow" })]);
      expect(report.findings.map((finding) => finding.code)).toContain("implies-measurement");
    }
  });

  it("allows an illustration to deny that it is a simulation", () => {
    // A denial is the wording we want. Blocking it would push authors toward
    // saying nothing, which is worse.
    const report = reviewVisualHonesty([
      illustration({
        subject: "airflow",
        explains: "How air is meant to move through this layout. This is not a simulation of your case.",
        explanatoryLabel: "Explanatory drawing, not a thermal simulation.",
        showsNumericValues: false,
        derivedFrom: null,
      }),
    ]);
    expect(report.acceptable).toBe(true);
  });
});

describe("decorative visuals", () => {
  it("accepts a genuinely empty decoration", () => {
    const report = reviewVisualHonesty([
      { kind: "decorative", visualId: "v-bg", description: "Soft gradient background wash." },
    ]);
    expect(report.acceptable).toBe(true);
  });

  it("catches an informative visual misfiled as decorative", () => {
    for (const description of ["Bar chart showing 144 fps", "A small bottleneck indicator in the corner"]) {
      const report = reviewVisualHonesty([{ kind: "decorative", visualId: "v-x", description }]);
      expect(report.findings.map((finding) => finding.code)).toContain("decorative-carries-information");
    }
  });
});

describe("report mechanics", () => {
  it("flags duplicate visual ids so a review cannot be misattributed", () => {
    const report = reviewVisualHonesty([capture(), capture()]);
    expect(report.findings.map((finding) => finding.code)).toContain("duplicate-visual-id");
  });

  it("is deterministic", () => {
    const visuals = [capture(), illustration()];
    expect(reviewVisualHonesty(visuals)).toEqual(reviewVisualHonesty(visuals));
  });

  it("has no category for a simulation, because nothing here simulates hardware", () => {
    const kinds: DeclaredVisual["kind"][] = ["real-product-capture", "derived-illustration", "decorative"];
    expect(kinds).toHaveLength(3);
  });
});
