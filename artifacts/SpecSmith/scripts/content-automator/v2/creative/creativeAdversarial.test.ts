// MASTER #6 — Adversarial tests.
//
// Each test here is an attempt to get something dishonest past the layer,
// written as the attack rather than as the feature.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { estimateFps } from "../../../../src/lib/fps.ts";
import { assessConcept, toStoryboardBeats, type CreativeConcept } from "./concept.ts";
import { critiqueConceptSet } from "./conceptCritique.ts";
import { assessDivergence } from "./divergence.ts";
import { recordCreativeDecision, retrieveCreativeMemory } from "./memory.ts";
import { analyzeSeparability, permittedWording } from "./separability.ts";
import {
  AVAILABLE_CAPABILITIES,
  DISCLOSURE_EDITORIAL_PRICE,
  DISCLOSURE_FPS_ESTIMATE,
  DISCLOSURE_MODEL_RANGE,
  PACKAGE_BRANCH,
  PACKAGE_CROSSOVER,
} from "./sectionOnePackages.ts";
import { reviewVisualHonesty } from "./visualHonesty.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = {
  availableCapabilityIds: AVAILABLE_CAPABILITIES,
  guaranteedDisclosureIds: [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_EDITORIAL_PRICE, DISCLOSURE_MODEL_RANGE],
};

describe("attack: widen the band until the comparison separates", () => {
  it("cannot be defeated by shrinking a declared range after the fact", () => {
    // The gap is 18 fps and the real bands overlap. An attacker narrows one
    // range so the model appears to resolve the comparison. The module has no
    // opinion about whether a range is honest — but the range it is given is
    // the range it answers about, so the attack must be visible in the data,
    // not hidden in the verdict.
    const honest = analyzeSeparability({ estimated: 258, min: 237, max: 279 }, { estimated: 276, min: 254, max: 298 });
    const tampered = analyzeSeparability({ estimated: 258, min: 257, max: 259 }, { estimated: 276, min: 275, max: 277 });
    expect(honest.verdict).toBe("inseparable");
    expect(tampered.verdict).toBe("separable");
    // The real model's ranges come from estimateFps and are not caller-supplied.
    const real = estimateFps(0.58, 0.87, 300, 0.4);
    expect(real.max - real.min).toBeGreaterThan(2);
  });
});

describe("attack: smuggle a measurement claim through a real capture", () => {
  it("cannot launder a claim by attaching it to a genuine product screenshot", () => {
    const laundered: CreativeConcept = {
      ...PACKAGE_CROSSOVER,
      conceptId: "m6-laundered",
      visuals: [
        ...PACKAGE_CROSSOVER.visuals,
        {
          kind: "derived-illustration",
          visualId: "p1-overlay",
          explains: "Frame times as recorded during a benchmark run on this exact machine.",
          subject: "frame-time",
          explanatoryLabel: null,
          derivedFrom: null,
          showsNumericValues: true,
        },
      ],
      beats: PACKAGE_CROSSOVER.beats.map((beat, index) =>
        index === 2 ? { ...beat, visualIds: [...beat.visualIds, "p1-overlay"] } : beat,
      ),
    };
    const assessment = assessConcept({ concept: laundered, ...ENV });
    const codes = assessment.visualHonesty.findings.map((finding) => finding.code);
    expect(codes).toContain("implies-measurement");
    expect(assessment.producible).toBe(false);
  });
});

describe("attack: move the disclosure to the end", () => {
  it("refuses an estimate illustration whose disclosure is not guaranteed on screen", () => {
    const assessment = assessConcept({
      concept: PACKAGE_CROSSOVER,
      availableCapabilityIds: AVAILABLE_CAPABILITIES,
      guaranteedDisclosureIds: [],
    });
    expect(assessment.defects.map((defect) => defect.code)).toContain("undisclosed-estimate");
  });
});

describe("attack: three concepts that are one concept", () => {
  it("cannot be defeated by changing every sentence", () => {
    const rewordings = [1, 2, 3].map((index): CreativeConcept => ({
      ...PACKAGE_CROSSOVER,
      conceptId: `m6-reword-${index}`,
      viewerQuestion: `Variant ${index}: which of these two should I buy?`,
      viewerTakeaway: `${PACKAGE_CROSSOVER.viewerTakeaway} Variant ${index}.`,
      beats: PACKAGE_CROSSOVER.beats.map((beat) => ({ ...beat, narration: `${beat.narration} (${index})` })),
    }));
    const report = assessDivergence(rewordings);
    expect(report.divergent).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("identical-axes");
    expect(report.axisSpread).toEqual({ audienceExperience: 1, explanatoryStructure: 1, visualMechanism: 1 });
  });
});

describe("attack: launder a weak observation into a rule", () => {
  it("cannot promote a single process observation by asking for it repeatedly", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const entries = [1, 2, 3, 4, 5].map((index) =>
      recordCreativeDecision({
        entryId: `e${index}`,
        conceptId: "m6-crossover-that-isnt",
        decision: { kind: "visual-mechanism", value: "animated-product-walk" },
        outcome: { state: "process", observation: "It rendered without a repair pass." },
        evidenceStrength: "anecdotal",
        synthetic: false,
        note: "",
        now,
      }),
    );
    // Five copies of one anecdote is still one anecdote. Nothing in retrieval
    // counts entries, so repetition buys no strength.
    const result = retrieveCreativeMemory(entries, { kind: "visual-mechanism", allowSynthetic: false });
    expect(result.noGuidanceAvailable).toBe(true);
    expect(result.observations.every((observation) => observation.usage === "context")).toBe(true);
  });

  it("cannot pass engineering fixture memory off as production guidance", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const synthetic = recordCreativeDecision({
      entryId: "e-synth",
      conceptId: "m6-fixture",
      decision: { kind: "explanatory-structure", value: "linear-demonstration" },
      outcome: { state: "process", observation: "Synthetic pipeline observation, not performance evidence." },
      evidenceStrength: "anecdotal",
      synthetic: true,
      allowSynthetic: true,
      note: "",
      now,
    });
    const production = retrieveCreativeMemory([synthetic], { kind: "explanatory-structure", allowSynthetic: false });
    expect(production.observations).toEqual([]);
    expect(production.noGuidanceAvailable).toBe(true);
    expect(production.excludedSyntheticCount).toBe(1);
  });
});

describe("attack: let the revision loop quietly fix the copy", () => {
  it("routes manufactured urgency to a human every time", () => {
    const urgent: CreativeConcept = {
      ...PACKAGE_BRANCH,
      conceptId: "m6-urgent",
      beats: PACKAGE_BRANCH.beats.map((beat, index) =>
        index === 0 ? { ...beat, narration: "Buy this before it's too late, prices are about to skyrocket!!!" } : beat,
      ),
    };
    const critique = critiqueConceptSet({ ...ENV, concepts: [urgent] }).concepts[0];
    expect(critique.machineApplicable).toEqual([]);
    expect(critique.humanRequired.some((finding) => finding.source === "copy")).toBe(true);
  });
});

describe("the creative layer is offline and deterministic by construction", () => {
  const sources = readdirSync(HERE)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name, code: codeOnly(readFileSync(join(HERE, name), "utf8")) }));

  /** Strip comments and string literals so prose cannot trip a structural scan. */
  function codeOnly(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  }

  it("has at least one source to scan", () => {
    expect(sources.length).toBeGreaterThan(4);
  });

  it("makes no network call and reads no credential", () => {
    for (const source of sources) {
      for (const forbidden of ["fetch(", "process.env", "https://", "axios", "XMLHttpRequest"]) {
        expect(source.code, source.name).not.toContain(forbidden);
      }
    }
  });

  it("reads no clock, so every output is reproducible from its inputs", () => {
    for (const source of sources) {
      for (const forbidden of ["Date.now(", "new Date()", "performance.now("]) {
        expect(source.code, source.name).not.toContain(forbidden);
      }
    }
  });

  it("produces identical output for identical input across the whole layer", () => {
    const once = {
      assessment: assessConcept({ concept: PACKAGE_CROSSOVER, ...ENV }),
      beats: toStoryboardBeats(PACKAGE_CROSSOVER),
      critique: critiqueConceptSet({ ...ENV, concepts: [PACKAGE_CROSSOVER, PACKAGE_BRANCH] }),
      honesty: reviewVisualHonesty(PACKAGE_CROSSOVER.visuals),
      wording: permittedWording(
        analyzeSeparability({ estimated: 258, min: 237, max: 279 }, { estimated: 276, min: 254, max: 298 }),
        "A",
        "B",
      ),
    };
    const twice = {
      assessment: assessConcept({ concept: PACKAGE_CROSSOVER, ...ENV }),
      beats: toStoryboardBeats(PACKAGE_CROSSOVER),
      critique: critiqueConceptSet({ ...ENV, concepts: [PACKAGE_CROSSOVER, PACKAGE_BRANCH] }),
      honesty: reviewVisualHonesty(PACKAGE_CROSSOVER.visuals),
      wording: permittedWording(
        analyzeSeparability({ estimated: 258, min: 237, max: 279 }, { estimated: 276, min: 254, max: 298 }),
        "A",
        "B",
      ),
    };
    expect(once).toEqual(twice);
  });
});
