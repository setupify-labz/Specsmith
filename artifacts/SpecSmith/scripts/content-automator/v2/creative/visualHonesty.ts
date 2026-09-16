// MASTER #6 — Visual honesty classification (capability #2 from the section-1 critique).
//
// WHY THIS EXISTS
//
// SpecSmith's strongest creative asset is that it can capture its own real
// product UI deterministically (`uiRender/`). A frame of the real /compare page
// is self-evidently not fabricated. But two of the three section-1 packages
// need visuals that are NOT product captures: an uncertainty-band overlay and a
// split-screen fork. Both are legitimate explanatory devices. Both would also
// be trivially easy to render in a way that reads as measurement.
//
// The risk is specific and was named in the MASTER #6 brief: an illustrative
// airflow, temperature, bottleneck or FPS graphic presented as if it were a
// simulation of a real system. Nothing in the repository currently distinguishes
// "this is a picture of our product" from "this is a drawing that explains an
// idea" from "this is a claim about how a real machine behaved".
//
// So every visual a creative concept proposes must declare what kind of thing
// it is, and the classification is enforced rather than advisory:
//
//   real-product-capture  a deterministic capture of a real SpecSmith surface
//                         in a real, reproducible state
//   derived-illustration  a drawing that explains something; must be visibly
//                         explanatory and may never imply measurement
//   decorative            carries no information at all
//
// A visual that cannot be honestly placed in one of those three is rejected.
// There is deliberately no fourth category for "simulation", because this
// repository has never simulated anything.

import { UI_RENDER_SURFACES, type UiRenderSurface } from "../../uiRender/uiRenderState.ts";

export type VisualKind = "real-product-capture" | "derived-illustration" | "decorative";

/**
 * Subjects where an illustration is especially likely to be read as a
 * measurement of a real machine. An illustration on one of these subjects
 * carries a stricter burden: it must carry an explicit explanatory label.
 */
export const MEASUREMENT_LOOKALIKE_SUBJECTS = [
  "airflow",
  "temperature",
  "thermals",
  "bottleneck",
  "fps",
  "frame-rate",
  "frame-time",
  "power-draw",
  "noise",
  "latency",
] as const;

export type MeasurementLookalikeSubject = (typeof MEASUREMENT_LOOKALIKE_SUBJECTS)[number];

export interface RealProductCapture {
  readonly kind: "real-product-capture";
  readonly visualId: string;
  /** Must be a surface the deterministic renderer actually supports. */
  readonly surface: UiRenderSurface;
  /**
   * The exact reproducible state identifier, as produced by
   * `uiRenderState.stateIdentifier`. A capture that cannot say which state it
   * shows is not reproducible and is therefore not a product capture.
   */
  readonly stateIdentifier: string;
}

export interface DerivedIllustration {
  readonly kind: "derived-illustration";
  readonly visualId: string;
  /** What idea this drawing explains, in plain words. */
  readonly explains: string;
  /** Subject matter, used to decide whether the strict burden applies. */
  readonly subject: MeasurementLookalikeSubject | "other";
  /**
   * On-screen text that tells the viewer this is an explanatory drawing.
   * Required whenever the subject is a measurement lookalike. Null is only
   * acceptable for non-lookalike subjects.
   */
  readonly explanatoryLabel: string | null;
  /**
   * The exact data the drawing is derived from, if any, named so a reviewer
   * can check it. Null means the drawing is purely conceptual — which is
   * allowed, but then it may not carry numbers.
   */
  readonly derivedFrom: string | null;
  /** Whether the drawing puts specific numeric values on screen. */
  readonly showsNumericValues: boolean;
}

export interface DecorativeVisual {
  readonly kind: "decorative";
  readonly visualId: string;
  readonly description: string;
}

export type DeclaredVisual = RealProductCapture | DerivedIllustration | DecorativeVisual;

export type VisualHonestyCode =
  | "unsupported-surface"
  | "unreproducible-capture"
  | "missing-explanatory-label"
  | "numbers-without-source"
  | "implies-measurement"
  | "decorative-carries-information"
  | "duplicate-visual-id";

export interface VisualHonestyFinding {
  readonly code: VisualHonestyCode;
  readonly visualId: string;
  readonly detail: string;
}

export interface VisualHonestyReport {
  readonly findings: readonly VisualHonestyFinding[];
  readonly acceptable: boolean;
  /**
   * Visual ids that require a disclosure on screen while they are visible.
   * Reported so a beat cannot satisfy the rule by putting the disclosure at
   * the end of the video.
   */
  readonly requiresOnScreenDisclosure: readonly string[];
}

/**
 * Phrases that assert a visual depicts real measured behaviour.
 *
 * Kept small and specific on purpose. The goal is not a keyword blacklist; it
 * is to catch the handful of phrasings that convert a drawing into a claim.
 * Honest unrelated wording must not be blocked, so each entry is a phrase a
 * drawing would only use if it were claiming measurement.
 */
const MEASUREMENT_ASSERTIONS = [
  "simulated airflow",
  "thermal simulation",
  "airflow simulation",
  "simulation of",
  "measured in our lab",
  "real-world capture",
  "captured frame times",
  "actual temperatures",
  "as recorded",
  "benchmark run",
  "telemetry from",
] as const;

function assertsMeasurement(text: string): string | null {
  const lowered = text.toLowerCase();
  for (const phrase of MEASUREMENT_ASSERTIONS) {
    if (!lowered.includes(phrase)) continue;
    // A denial is not an assertion: "this is not a thermal simulation" is
    // exactly the wording we want an honest illustration to use.
    const index = lowered.indexOf(phrase);
    const preceding = lowered.slice(Math.max(0, index - 24), index);
    if (/\b(not|never|isn't|is not|rather than|instead of)\b[^.]*$/.test(preceding)) continue;
    return phrase;
  }
  return null;
}

function checkOne(visual: DeclaredVisual): readonly VisualHonestyFinding[] {
  const findings: VisualHonestyFinding[] = [];

  if (visual.kind === "real-product-capture") {
    if (!(UI_RENDER_SURFACES as readonly string[]).includes(visual.surface)) {
      findings.push({
        code: "unsupported-surface",
        visualId: visual.visualId,
        detail:
          `"${visual.surface}" is not a surface the deterministic renderer supports, so this cannot be a capture of the ` +
          "real product. Declare it as a derived illustration, or add the surface to the renderer.",
      });
    }
    if (visual.stateIdentifier.trim() === "") {
      findings.push({
        code: "unreproducible-capture",
        visualId: visual.visualId,
        detail:
          "A product capture with no state identifier cannot be reproduced or checked, so it carries none of the " +
          "trust a real capture is supposed to carry.",
      });
    }
    return findings;
  }

  if (visual.kind === "decorative") {
    // A decorative visual that describes information is misfiled, and misfiling
    // is how an unchecked claim gets on screen.
    const lowered = visual.description.toLowerCase();
    if (/\d/.test(visual.description) || MEASUREMENT_LOOKALIKE_SUBJECTS.some((subject) => lowered.includes(subject))) {
      findings.push({
        code: "decorative-carries-information",
        visualId: visual.visualId,
        detail:
          "This is filed as decorative but describes numbers or a measurable subject. Anything that informs the " +
          "viewer must be classified as a product capture or a derived illustration so it can be checked.",
      });
    }
    return findings;
  }

  const lookalike = visual.subject !== "other";
  if (lookalike && (visual.explanatoryLabel === null || visual.explanatoryLabel.trim() === "")) {
    findings.push({
      code: "missing-explanatory-label",
      visualId: visual.visualId,
      detail:
        `An illustration about ${visual.subject} is easily read as a measurement of a real machine, so it must carry ` +
        "on-screen text identifying it as an explanatory drawing.",
    });
  }

  if (visual.showsNumericValues && visual.derivedFrom === null) {
    findings.push({
      code: "numbers-without-source",
      visualId: visual.visualId,
      detail:
        "A conceptual drawing may not put specific numbers on screen. Either name the data it is derived from or " +
        "remove the values.",
    });
  }

  const assertion = assertsMeasurement(`${visual.explains} ${visual.explanatoryLabel ?? ""}`);
  if (assertion !== null) {
    findings.push({
      code: "implies-measurement",
      visualId: visual.visualId,
      detail:
        `This illustration describes itself using "${assertion}", which asserts measured or simulated behaviour. ` +
        "SpecSmith does not simulate or measure hardware, so no visual may claim to.",
    });
  }

  return findings;
}

export function reviewVisualHonesty(visuals: readonly DeclaredVisual[]): VisualHonestyReport {
  const findings: VisualHonestyFinding[] = [];

  const seen = new Set<string>();
  for (const visual of visuals) {
    if (seen.has(visual.visualId)) {
      findings.push({
        code: "duplicate-visual-id",
        visualId: visual.visualId,
        detail: "Two visuals share an id, so a review of one cannot be attributed to the right frame.",
      });
    }
    seen.add(visual.visualId);
    findings.push(...checkOne(visual));
  }

  const requiresOnScreenDisclosure = visuals
    .filter((visual) => visual.kind === "derived-illustration" && visual.subject !== "other")
    .map((visual) => visual.visualId);

  return {
    findings,
    acceptable: findings.length === 0,
    requiresOnScreenDisclosure,
  };
}
