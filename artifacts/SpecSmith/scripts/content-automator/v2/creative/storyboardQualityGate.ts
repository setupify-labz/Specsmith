// MASTER #1's storyboard quality review, run on every MASTER #6 concept before
// the workflow may call a batch ready for human review.
//
// WHY THIS EXISTS
// ---------------
// A #6 batch could pass every #6 check and still fail #1's production checks:
// a 5s hook against a 3s envelope, captions at 39 characters per second. The
// handoff then carried a "ready" concept into a report full of unresolved
// fixes. Running the same review here moves those failures to the author,
// while they can still be fixed.
//
// THE RULES
// ---------
// - Every recommended fix blocks. The review's scores are never read, so no
//   score can outweigh a fix that is still open.
// - Captions are measured as the renderer burns them in (captionCuesForScript).
//   They are the author's own text: required disclosures are a separate
//   persistent overlay (storyboard.persistentDisclosures), verified in the
//   rendered frames rather than here.
// - Picture variety is measured on what is on screen, not on labels. Each
//   beat's visual direction is replaced by the identity of the pictures it
//   shows (captureViews.pictureIdentity), so two visual ids naming one capture
//   state count as one picture.
// - A fix goes to the author unless no rewrite could make it. That is the
//   case only when the mission permits a single picture, so every beat must
//   repeat it. Such a fix still blocks; it is only addressed to someone else.
//
// WHAT PASSING PROVES
// -------------------
// That the storyboard's text and timing meet #1's measurable rules. Nothing
// has been rendered, seen or heard; the review marks those dimensions
// not-assessed, and they remain human gates.

import { captionCuesForScript } from "../../productionPlan.ts";
import { reviewCreativeQuality, type CreativeQualityReview, type RecommendedFix } from "../creativeQualityReview.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import { persistentDisclosuresOf, type CreativeConcept } from "./concept.ts";
import { pictureIdentity } from "./captureViews.ts";

/** Dimensions no concept can change when every beat must show the same single picture. */
const SINGLE_PICTURE_DIMENSIONS = new Set(["shot-uniqueness", "visual-repetition"]);

export interface StoryboardQualityFindings {
  /** Fixes the author can make by changing their own text, timing or views. */
  readonly required: readonly string[];
  /** Fixes no rewrite of the concept can make. Blocking all the same. */
  readonly blockedOutsideAuthor: readonly string[];
  /** The review itself, measured on the storyboard as it would be rendered. */
  readonly review: CreativeQualityReview;
}

export function reviewStoryboard(input: {
  readonly reviewId: string;
  readonly storyboard: PlatformScriptStoryboard;
  readonly ctaRoute: string;
}): CreativeQualityReview {
  return reviewCreativeQuality({
    creativeId: input.reviewId,
    packageId: input.reviewId,
    storyboard: input.storyboard,
    captionCues: captionCuesForScript(input.storyboard),
    ctaRoute: input.ctaRoute,
    // No render exists at this stage. The review describes no media.
    mediaSha256: null,
    // Fixed so the review, and the feedback built from it, is reproducible.
    now: new Date(0),
  });
}

/** The storyboard with each beat's visual direction replaced by what it actually shows. */
export function withPictureDirections(concept: CreativeConcept, storyboard: PlatformScriptStoryboard): PlatformScriptStoryboard {
  const identityOf = new Map(concept.visuals.map((visual) => [visual.visualId, pictureIdentity(visual)] as const));
  return {
    ...storyboard,
    beats: storyboard.beats.map((beat, index) => {
      const shown = [...new Set((concept.beats[index]?.visualIds ?? []).map((id) => identityOf.get(id) ?? `undeclared:${id}`))].sort();
      return { ...beat, visualDirection: shown.join(" + ") };
    }),
  };
}

const beatList = (fix: RecommendedFix) =>
  fix.beats.length === 0 ? "the whole storyboard" : `beat ${fix.beats.map((index) => index + 1).join(", beat ")}`;

export function storyboardQualityFindings(input: {
  readonly concept: CreativeConcept;
  readonly storyboard: PlatformScriptStoryboard;
  readonly ctaRoute: string;
  /** How many distinct pictures the mission lets a concept show. */
  readonly permittedPictures: number;
}): StoryboardQualityFindings {
  const { concept } = input;
  const storyboard = withPictureDirections(concept, input.storyboard);
  const review = reviewStoryboard({ reviewId: concept.conceptId, storyboard, ctaRoute: input.ctaRoute });

  const required: string[] = [];
  const blockedOutsideAuthor: string[] = [];
  for (const fix of review.recommendedFixes) {
    const label = `MASTER #1 storyboard review [${fix.dimension}] at ${beatList(fix)}`;
    if (SINGLE_PICTURE_DIMENSIONS.has(fix.dimension) && input.permittedPictures <= 1) {
      blockedOutsideAuthor.push(
        `${label}: ${fix.issue} The mission permits one validated view, so every beat shows the same picture. No rewrite ` +
          "of the concept can fix this; the mission must list further validated views.",
      );
    } else if (SINGLE_PICTURE_DIMENSIONS.has(fix.dimension)) {
      required.push(
        `${label}: ${fix.issue} Show a different validated view from the brief on these beats. The same view under ` +
          "another visual id is the same picture and does not count.",
      );
    } else {
      required.push(`${label}: ${fix.issue} ${fix.fix}`);
    }
  }

  // Disclosures leave the captions only because the overlay carries them. A
  // storyboard that dropped them would pass every caption check by deleting
  // the disclosure, so their absence is a blocker in its own right.
  const needed = persistentDisclosuresOf(concept);
  const carried = new Set(input.storyboard.persistentDisclosures ?? []);
  const missing = needed.filter((text) => !carried.has(text));
  if (missing.length > 0) {
    blockedOutsideAuthor.push(
      `Required disclosure(s) not carried for the persistent overlay: ${missing.map((text) => `"${text}"`).join(", ")}. ` +
        "This is a defect in the storyboard conversion, not in the concept.",
    );
  }
  return { required, blockedOutsideAuthor, review };
}
