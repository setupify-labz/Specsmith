// MASTER #6 — Creative concept model, feasibility and beat emission
// (capabilities #3 and #5 from the section-1 critique).
//
// WHY THIS EXISTS
//
// Before this module the repository could improve a storyboard (`beatRepair`),
// score one (`creativeQualityReview`), reject a bad one (`antiSlop`) and render
// one — but nothing could PROPOSE one. Storyboards were hand-authored or
// supplied by fixtures. Section 1 wrote three by hand, and the act of writing
// them showed what a concept actually has to carry to be worth anything:
//
//   1. The three axes that make two concepts genuinely different — audience
//      experience, explanatory structure, visual mechanism. Section 1's
//      critique found that three treatments differing only in opening wording
//      would be indistinguishable on these axes, which is the right answer.
//   2. The visuals it needs, DECLARED (see `visualHonesty.ts`), because the
//      best of the three packages was blocked on a surface that does not
//      exist and nothing would have surfaced that before production.
//   3. What the viewer asks and what they leave with. A concept that cannot
//      state the viewer's question is decoration.
//
// A concept is NOT a script. It emits `StoryboardBeat[]` so it lands in the
// existing pipeline, but it carries the reasoning that a beat array throws
// away, so a later critique can act on the reasoning rather than the prose.

import type { StoryboardBeat } from "../../types.ts";
import { reviewVisualHonesty, type DeclaredVisual, type VisualHonestyReport } from "./visualHonesty.ts";

export const CREATIVE_DISCLOSURES: Readonly<Record<string, string>> = {
  "disclosure.fps-estimate": "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.",
  "disclosure.model-range": "The range shown is a model convention, not measured or calibrated uncertainty.",
  "disclosure.illustration": "Explanatory illustration, not a hardware measurement or simulation.",
};

/**
 * What the viewer DOES while watching. Not a demographic, not a persona.
 *
 * These are the three postures section 1 actually produced. The list is
 * deliberately short: an axis with twenty values cannot distinguish anything.
 */
export const AUDIENCE_EXPERIENCES = ["spectator", "investigator", "participant"] as const;
export type AudienceExperience = (typeof AUDIENCE_EXPERIENCES)[number];

/** The shape of the argument. */
export const EXPLANATORY_STRUCTURES = [
  /** One axis, a pattern along it, then the pattern is tested. */
  "continuum-then-falsification",
  /** Discard the undecidable evidence, then decide on the decidable. */
  "elimination-then-substitution",
  /** Ask the viewer one thing, then branch; no ranking is produced. */
  "branch-no-ranking",
  /** Straight demonstration with no reversal. */
  "linear-demonstration",
  "prediction-then-reveal",
  "question-evidence-boundary",
] as const;
export type ExplanatoryStructure = (typeof EXPLANATORY_STRUCTURES)[number];

/** How the screen carries the argument. */
export const VISUAL_MECHANISMS = [
  "animated-product-walk",
  "annotated-static-card",
  "split-screen-fork",
  "single-surface-hold",
] as const;
export type VisualMechanism = (typeof VISUAL_MECHANISMS)[number];

export interface CreativeAxes {
  readonly audienceExperience: AudienceExperience;
  readonly explanatoryStructure: ExplanatoryStructure;
  readonly visualMechanism: VisualMechanism;
}

/**
 * A capability the concept needs in order to be produced at all.
 *
 * Section 1's strongest package was blocked on a renderer surface that does not
 * exist. Declaring requirements up front turns that from a silent production
 * failure into information a human can act on.
 */
export interface RequiredCapability {
  readonly capabilityId: string;
  readonly description: string;
}

export interface ConceptBeatPlan {
  readonly purpose: StoryboardBeat["purpose"];
  readonly startSecond: number;
  readonly endSecond: number;
  readonly narration: string;
  readonly onScreenText: string;
  /** Ids of declared visuals this beat puts on screen. */
  readonly visualIds: readonly string[];
  /** Claim ids this beat depends on, carried through to `factDependencies`. */
  readonly factDependencies: readonly string[];
}

export interface CreativeConcept {
  readonly conceptId: string;
  readonly axes: CreativeAxes;
  /** The question the viewer actually arrived with, in their words. */
  readonly viewerQuestion: string;
  /** What they can do or decide afterwards. Not a summary of the video. */
  readonly viewerTakeaway: string;
  readonly visuals: readonly DeclaredVisual[];
  readonly beats: readonly ConceptBeatPlan[];
  readonly requiredCapabilities: readonly RequiredCapability[];
  /** Where the viewer is sent. */
  readonly productDestination: string;
  /** Disclosures this concept must carry, by id. */
  readonly requiredDisclosures: readonly string[];
  /** Disclosure text present on each beat, not merely promised by an ID. */
  readonly disclosureTextByBeat?: Readonly<Record<number, readonly string[]>>;
}

export type ConceptDefectCode =
  | "no-viewer-question"
  | "no-viewer-takeaway"
  | "no-beats"
  | "beats-not-contiguous"
  | "beat-references-unknown-visual"
  | "visual-never-used"
  | "visual-honesty"
  | "missing-capability"
  | "undisclosed-estimate";

export interface ConceptDefect {
  readonly code: ConceptDefectCode;
  readonly detail: string;
}

export interface ConceptAssessment {
  readonly conceptId: string;
  readonly defects: readonly ConceptDefect[];
  readonly visualHonesty: VisualHonestyReport;
  /**
   * Capabilities the concept needs that the caller did not report as
   * available. A blocked concept is NOT discarded: it is reported, because
   * "our best idea needs a surface we do not have" is the most useful thing a
   * creative system can tell a human.
   */
  readonly blockedBy: readonly RequiredCapability[];
  readonly producible: boolean;
}

export interface AssessmentInput {
  readonly concept: CreativeConcept;
  /** Capability ids the production system can actually deliver today. */
  readonly availableCapabilityIds: readonly string[];
  /** Disclosure ids the delivery layer will guarantee are on screen. */
  readonly guaranteedDisclosureIds: readonly string[];
}

export function assessConcept(input: AssessmentInput): ConceptAssessment {
  const { concept } = input;
  const defects: ConceptDefect[] = [];

  if (concept.viewerQuestion.trim() === "") {
    defects.push({
      code: "no-viewer-question",
      detail: "A concept that cannot state the question the viewer arrived with is decoration, not an answer.",
    });
  }
  if (concept.viewerTakeaway.trim() === "") {
    defects.push({
      code: "no-viewer-takeaway",
      detail: "A concept must say what the viewer can do or decide afterwards.",
    });
  }

  if (concept.beats.length === 0) {
    defects.push({ code: "no-beats", detail: "A concept with no beats cannot be produced or reviewed." });
  }

  for (let index = 1; index < concept.beats.length; index += 1) {
    const previous = concept.beats[index - 1];
    const current = concept.beats[index];
    if (current.startSecond !== previous.endSecond) {
      defects.push({
        code: "beats-not-contiguous",
        detail:
          `Beat ${index} starts at ${current.startSecond}s but the previous beat ends at ${previous.endSecond}s. ` +
          "A gap is dead air and an overlap is two things on screen at once; neither is a creative decision.",
      });
    }
  }

  const declaredIds = new Set(concept.visuals.map((visual) => visual.visualId));
  const usedIds = new Set<string>();
  for (const beat of concept.beats) {
    for (const visualId of beat.visualIds) {
      usedIds.add(visualId);
      if (!declaredIds.has(visualId)) {
        defects.push({
          code: "beat-references-unknown-visual",
          detail: `Beat at ${beat.startSecond}s shows "${visualId}", which is never declared, so its honesty was never checked.`,
        });
      }
    }
  }
  for (const visualId of declaredIds) {
    if (!usedIds.has(visualId)) {
      defects.push({ code: "visual-never-used", detail: `Visual "${visualId}" is declared but never shown.` });
    }
  }

  const visualHonesty = reviewVisualHonesty(concept.visuals);
  for (const finding of visualHonesty.findings) {
    defects.push({ code: "visual-honesty", detail: `${finding.visualId}: ${finding.detail}` });
  }

  // A visual that requires an on-screen disclosure is only acceptable if the
  // delivery layer guarantees that disclosure. Deferring it to a trailing
  // frame is exactly the failure mode the brief forbids.
  const disclosureVisuals = new Set([...visualHonesty.requiresOnScreenDisclosure,
    ...concept.visuals.filter((visual) => visual.kind === "real-product-capture" && visual.surface === "compare").map((visual) => visual.visualId)]);
  for (const visualId of disclosureVisuals) {
    const visual = concept.visuals.find((entry) => entry.visualId === visualId);
    const fps = (visual?.kind === "real-product-capture" && visual.surface === "compare") || (visual?.kind === "derived-illustration" && (visual.subject === "fps" || visual.subject === "frame-rate" || visual.subject === "frame-time"));
    const required = fps ? ["disclosure.fps-estimate", "disclosure.model-range"] : ["disclosure.illustration"];
    const covered = required.every((id) => concept.requiredDisclosures.includes(id) && input.guaranteedDisclosureIds.includes(id) &&
      concept.beats.every((beat, index) => !beat.visualIds.includes(visualId) || concept.disclosureTextByBeat?.[index]?.includes(CREATIVE_DISCLOSURES[id])));
    if (!covered) {
      defects.push({
        code: "undisclosed-estimate",
        detail:
          `"${visualId}" needs a disclosure on screen while it is visible, and the concept does not require a ` +
          "disclosure the delivery layer guarantees.",
      });
    }
  }
  if (concept.beats.some((beat) => !Number.isFinite(beat.startSecond) || !Number.isFinite(beat.endSecond) || beat.startSecond < 0 || beat.endSecond <= beat.startSecond) ||
      (concept.beats.length > 0 && concept.beats[0].startSecond !== 0)) {
    defects.push({ code: "beats-not-contiguous", detail: "Beats must start at zero and have finite, positive durations." });
  }

  const blockedBy = concept.requiredCapabilities.filter(
    (capability) => !input.availableCapabilityIds.includes(capability.capabilityId),
  );
  for (const capability of blockedBy) {
    defects.push({
      code: "missing-capability",
      detail: `Needs ${capability.capabilityId}: ${capability.description}`,
    });
  }

  return {
    conceptId: concept.conceptId,
    defects,
    visualHonesty,
    blockedBy,
    producible: defects.length === 0,
  };
}

/**
 * Emit the concept into the pipeline's own beat type.
 *
 * Visual ids are carried into `visualDirection` so that the honesty
 * classification survives into the storyboard rather than being lost the moment
 * the concept becomes prose.
 */
export function toStoryboardBeats(concept: CreativeConcept): StoryboardBeat[] {
  return concept.beats.map((beat) => {
    const visuals = concept.visuals.filter((visual) => beat.visualIds.includes(visual.visualId));
    const direction = visuals
      .map((visual) => `[${visual.kind}:${visual.visualId}] ${describeVisual(visual)}`)
      .join(" ");
    return {
      startSecond: beat.startSecond,
      endSecond: beat.endSecond,
      purpose: beat.purpose,
      narration: beat.narration,
      visualDirection: direction,
      onScreenText: [beat.onScreenText, ...(concept.disclosureTextByBeat?.[concept.beats.indexOf(beat)] ?? [])].join("\n"),
      factDependencies: [...beat.factDependencies],
    };
  });
}

function describeVisual(visual: DeclaredVisual): string {
  switch (visual.kind) {
    case "real-product-capture":
      return `Deterministic capture of the ${visual.surface} surface in state ${visual.stateIdentifier}.`;
    case "derived-illustration":
      return `${visual.explains}${visual.explanatoryLabel === null ? "" : ` On-screen label: ${visual.explanatoryLabel}`}`;
    case "decorative":
      return visual.description;
  }
}
