// MASTER #6 — Renderer deliverability tests.
//
// These run against the REAL committed Claude-authored batches, because the
// defect this module exists for was found in real authored copy, not invented.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkRenderDeliverability, SURFACE_CONTENT } from "./renderDeliverability.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCHES = join(HERE, "..", "..", "fixtures", "creative-file-workflow", "batches");

interface AuthoredBeat {
  readonly narration: string;
  readonly onScreenText: string;
}
interface AuthoredConcept {
  readonly conceptId: string;
  readonly beats: readonly AuthoredBeat[];
}

function loadConcept(attempt: number, file: string): AuthoredConcept {
  return JSON.parse(readFileSync(join(BATCHES, `attempt-${attempt}`, file), "utf8")) as AuthoredConcept;
}

function linesOf(concept: AuthoredConcept) {
  return concept.beats.flatMap((beat, index) => [
    { location: `beat-${index + 1}.narration`, text: beat.narration },
    { location: `beat-${index + 1}.onScreenText`, text: beat.onScreenText },
  ]);
}

function check(concept: AuthoredConcept, captureType: "static" | "sequence" = "static") {
  return checkRenderDeliverability({ conceptId: concept.conceptId, surface: "compare", captureType, lines: linesOf(concept) });
}

describe("what the Compare surface is recorded as showing", () => {
  it("records the estimate range and prices as absent, with where that was verified", () => {
    const absent = SURFACE_CONTENT.compare.absent;
    expect(absent.map((entry) => entry.element)).toEqual([
      "the model's estimate range (min–max)",
      "any price",
    ]);
    for (const entry of absent) {
      expect(entry.verifiedAt).toMatch(/src\/pages\/Compare\.tsx/);
    }
  });
});

describe("the real attempt-2 batch, which motivated this check", () => {
  it("catches the vanishing-gap treatment promising motion from a single frame", () => {
    const findings = check(loadConcept(2, "03-vanishing-gap.json"));
    const motion = findings.filter((finding) => finding.code === "promises-motion-from-a-still");
    expect(motion.length).toBeGreaterThan(0);
    expect(motion[0].evidence.toLowerCase()).toContain("watch");
  });

  it("catches copy pointing at a range the Compare page never renders", () => {
    const findings = check(loadConcept(2, "03-vanishing-gap.json"));
    expect(findings.some((finding) => finding.code === "promises-absent-element")).toBe(true);
  });

  it("catches the same absent-range promise in the other attempt-2 treatment", () => {
    const findings = check(loadConcept(2, "01-commit-first.json"));
    expect(findings.some((finding) => finding.code === "promises-absent-element")).toBe(true);
  });

  it("stops promising motion once the capture actually moves", () => {
    // The copy is not wrong in the abstract; it is wrong for a still. Declaring
    // a sequence capture would make the motion promise deliverable.
    const findings = check(loadConcept(2, "03-vanishing-gap.json"), "sequence");
    expect(findings.some((finding) => finding.code === "promises-motion-from-a-still")).toBe(false);
    // The absent range is still absent, whether or not the picture moves.
    expect(findings.some((finding) => finding.code === "promises-absent-element")).toBe(true);
  });
});

describe("the revised attempt-3 batch", () => {
  it.each(["01-commit-first.json", "02-three-checks.json", "03-vanishing-gap.json"])(
    "%s promises nothing the static Compare capture cannot deliver",
    (file) => {
      expect(check(loadConcept(3, file))).toEqual([]);
    },
  );

  it("still makes the point about width without pointing at an absent range", () => {
    const concept = loadConcept(3, "03-vanishing-gap.json");
    const text = concept.beats.map((beat) => beat.narration).join(" ");
    expect(text).toMatch(/not printed here/);
    expect(check(concept)).toEqual([]);
  });
});

describe("the checks themselves", () => {
  const concept = (narration: string): AuthoredConcept => ({
    conceptId: "probe",
    beats: [{ narration, onScreenText: "" }],
  });

  it.each([
    "Watch what happens to the bars.",
    "Keep your eye on the second row.",
    "Now watch the tally change.",
    "We step through each game.",
  ])("flags motion promise: %s", (narration) => {
    expect(check(concept(narration)).some((finding) => finding.code === "promises-motion-from-a-still")).toBe(true);
  });

  it.each([
    "This page prints one number per build per game.",
    "The tally on the left counts modelled game leads.",
    "Read the bars for the games you play.",
  ])("leaves honest description alone: %s", (narration) => {
    expect(check(concept(narration))).toEqual([]);
  });

  it("does not invent constraints for a surface it has no record of", () => {
    const findings = checkRenderDeliverability({
      conceptId: "probe",
      surface: "build-crate",
      captureType: "static",
      lines: [{ location: "beat-1.narration", text: "Look at the range around the number." }],
    });
    expect(findings.some((finding) => finding.code === "promises-absent-element")).toBe(false);
  });

  it("is deterministic", () => {
    const input = { conceptId: "probe", surface: "compare", captureType: "static" as const, lines: linesOf(loadConcept(2, "03-vanishing-gap.json")) };
    expect(checkRenderDeliverability(input)).toEqual(checkRenderDeliverability(input));
  });
});
