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
// - Captions are measured as the renderer burns them in (captionCuesForScript),
//   which for a #6 storyboard includes the required disclosure lines.
// - A fix is routed to the author only when the author's own text causes it.
//   A failure caused by the mandated disclosure text, or by the mission
//   allowing only one capture, is reported as a blocker outside the author's
//   control. It still blocks; it is only addressed to whoever can fix it.
//
// WHAT PASSING PROVES
// -------------------
// That the storyboard's text and timing meet #1's measurable rules. Nothing
// has been rendered, seen or heard; the review marks those dimensions
// not-assessed, and they remain human gates.

import { captionCuesForScript } from "../../productionPlan.ts";
import { reviewCreativeQuality, type CreativeQualityReview, type RecommendedFix } from "../creativeQualityReview.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import type { CreativeConcept } from "./concept.ts";

/** Caption dimensions whose cause may be the disclosure text rather than the author's caption. */
const CAPTION_DIMENSIONS = new Set(["caption-density", "caption-readability"]);
/** Dimensions a concept cannot change when every beat must show the same single capture. */
const SINGLE_PICTURE_DIMENSIONS = new Set(["shot-uniqueness", "visual-repetition"]);

export interface StoryboardQualityFindings {
  /** Fixes the author can make by changing their own text or timing. */
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

const beatList = (fix: RecommendedFix) =>
  fix.beats.length === 0 ? "the whole storyboard" : `beat ${fix.beats.map((index) => index + 1).join(", beat ")}`;

export function storyboardQualityFindings(input: {
  readonly concept: CreativeConcept;
  readonly storyboard: PlatformScriptStoryboard;
  readonly ctaRoute: string;
}): StoryboardQualityFindings {
  const { concept, storyboard } = input;
  const review = reviewStoryboard({ reviewId: concept.conceptId, storyboard, ctaRoute: input.ctaRoute });

  // The same storyboard with only the author's own caption text: what the
  // captions would measure if no disclosure rode along with them.
  const authorOnly = reviewStoryboard({
    reviewId: concept.conceptId,
    ctaRoute: input.ctaRoute,
    storyboard: { ...storyboard, beats: storyboard.beats.map((beat, index) => ({ ...beat, onScreenText: concept.beats[index]?.onScreenText ?? beat.onScreenText })) },
  });
  const authorFix = (dimension: string) => authorOnly.recommendedFixes.find((fix) => fix.dimension === dimension);
  // And with only the disclosure lines, so a caption failure the author must
  // fix is not hiding one they cannot: both are reported at once.
  const disclosureOnly = reviewStoryboard({
    reviewId: concept.conceptId,
    ctaRoute: input.ctaRoute,
    storyboard: { ...storyboard, beats: storyboard.beats.map((beat, index) => ({ ...beat, onScreenText: (concept.disclosureTextByBeat?.[index] ?? []).join("\n") })) },
  });
  const disclosureFix = (dimension: string) => disclosureOnly.recommendedFixes.find((fix) => fix.dimension === dimension);

  // Every beat shows one and the same picture when the concept declares a
  // single capture state and nothing else, which is all this mission permits.
  const pictures = new Set(concept.visuals.map((visual) =>
    visual.kind === "real-product-capture" ? `capture:${visual.surface}:${visual.stateIdentifier}` : `${visual.kind}:${visual.visualId}`));
  const singleCapture = pictures.size === 1 && concept.visuals.every((visual) => visual.kind === "real-product-capture");

  const required: string[] = [];
  const blockedOutsideAuthor: string[] = [];
  for (const fix of review.recommendedFixes) {
    const label = `MASTER #1 storyboard review [${fix.dimension}] at ${beatList(fix)}`;
    if (CAPTION_DIMENSIONS.has(fix.dimension)) {
      const own = authorFix(fix.dimension);
      const disclosure = disclosureFix(fix.dimension);
      if (own) required.push(`${label}: ${own.issue} ${own.fix}`);
      if (disclosure) {
        blockedOutsideAuthor.push(
          `${label}: ${disclosure.issue} The required disclosure lines are burned into the same caption and on their own exceed ` +
            "its limits. No rewrite of the concept can fix this: the disclosure wording is fixed, and how it is shown on screen " +
            "needs a rendering decision and disclosure sign-off.",
        );
      }
      if (!own && !disclosure) {
        // Neither fails alone; together they do. The author's part is the one they can shorten.
        required.push(`${label}: ${fix.issue} Your caption and the required disclosure lines share one caption; shorten yours, or give the beat more time.`);
      }
    } else if (SINGLE_PICTURE_DIMENSIONS.has(fix.dimension) && singleCapture) {
      blockedOutsideAuthor.push(
        `${label}: ${fix.issue} Every beat must show the one validated capture this mission permits, so every beat shows the ` +
          "same picture. No rewrite of the concept can fix this; varying the picture needs a capture capability this workflow does not have.",
      );
    } else {
      required.push(`${label}: ${fix.issue} ${fix.fix}`);
    }
  }
  return { required, blockedOutsideAuthor, review };
}
