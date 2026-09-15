// MASTER #6 — Render deliverability (does the copy promise what the renderer
// will actually put on screen?).
//
// WHY THIS EXISTS
//
// The independent matcher review said plainly that "no machine pass proves
// ... renderer feasibility of the words it contains", and named a real example:
// a treatment promising a range being drawn while declaring only a static
// Compare capture.
//
// Checking the repository settled it more sharply than the review did. On the
// Compare page:
//
//   - `src/pages/Compare.tsx` renders one value per build per game as a bar.
//     It never renders the model's min/max range. `FpsGauge`, which does render
//     "Range: min — max FPS estimated", is used only by `FpsEstimator`, a
//     different surface.
//   - `PartSelector` is mounted with `showShopping={false}`, so no price
//     appears anywhere on the page.
//
// So a script saying "watch the range appear" over a static Compare capture is
// wrong three times over: the capture does not move, the range is not on that
// page, and neither is a price. None of that is caught by an evidence gate,
// because none of it is a factual claim about hardware. It is a promise about
// the screen.
//
// This module checks that promise. It is deliberately narrow: it knows what a
// named surface renders and what it does not, and it knows that a static
// capture does not animate. It makes no judgement about whether the writing is
// good.

export type CaptureType = "static" | "sequence";

/**
 * What a surface actually puts on screen, and what it notably does not.
 *
 * `absent` exists because the useful check is not "is this word allowed" but
 * "did the author promise the viewer something this page will not show". Each
 * entry is a thing a writer plausibly assumes is there and which is not.
 *
 * Every entry below was verified against the component source, not assumed.
 */
export interface SurfaceContent {
  readonly renders: readonly string[];
  readonly absent: readonly {
    readonly element: string;
    /** Patterns that promise the absent element. */
    readonly promises: readonly RegExp[];
    /** Where the reader can check the claim for themselves. */
    readonly verifiedAt: string;
    readonly detail: string;
  }[];
}

export const SURFACE_CONTENT: Readonly<Record<string, SurfaceContent>> = {
  compare: {
    renders: [
      "one estimated FPS value per build per game, as a bar",
      "a modelled game-leads tally per build",
      "an estimated average FPS per build",
      "the part names selected for each build",
      "the evidence note about model estimates and editorial prices",
    ],
    absent: [
      {
        element: "the model's estimate range (min–max)",
        promises: [
          /\brange\s+(?:around|behind|on|under|beneath)\b/i,
          /\b(?:draw|drawn|drawing|appear|appears|show|shows|shown)\s+(?:the\s+)?range\b/i,
          /\bthe\s+range\s+(?:is\s+)?(?:drawn|shown|added|overlaid)\b/i,
          /\bmin\s*(?:–|-|—|to)\s*max\b/i,
          /\berror\s+bars?\b/i,
        ],
        verifiedAt: "src/pages/Compare.tsx renders bars from single values; FpsGauge (which shows a range) is used only by FpsEstimator.",
        detail:
          "The Compare page shows a value per build per game and never shows the range around it. A script that " +
          "tells the viewer to look at the range on this page is pointing at something that is not there.",
      },
      {
        element: "any price",
        promises: [
          /\bthe\s+price\s+(?:on|shown\s+on)\s+(?:this\s+|the\s+)?(?:page|screen|comparison)\b/i,
          /\b(?:see|look\s+at|check)\s+(?:the\s+)?prices?\s+(?:here|on\s+this\s+page|above|below)\b/i,
          /\bprices?\s+(?:are\s+)?(?:shown|displayed|listed)\s+(?:here|on\s+this\s+page)\b/i,
        ],
        verifiedAt: "src/pages/Compare.tsx mounts PartSelector with showShopping={false}, which hides prices.",
        detail:
          "The Compare page hides prices entirely. A script that points the viewer at a price on this page is " +
          "pointing at something that is not there.",
      },
    ],
  },
};

/**
 * Wording that promises the picture changes over time.
 *
 * A static capture is one frame. "Watch what happens when…" over one frame is a
 * promise the renderer cannot keep, and it is the single easiest way for a
 * script to read as a demo of something that was never demonstrated.
 */
const MOTION_PROMISES: readonly RegExp[] = [
  /\bwatch\s+(?:what\s+happens|the|as|it|them)\b/i,
  /\b(?:as|when)\s+(?:it|they|the\s+\w+)\s+(?:animates?|moves?|slides?|fades?|fills?|grows?|shrinks?)\b/i,
  /\bstep\s+through\b/i,
  /\bone\s+by\s+one\b/i,
  /\bnow\s+watch\b/i,
  /\bkeep\s+your\s+eye\s+on\b/i,
];

export type DeliverabilityCode = "promises-absent-element" | "promises-motion-from-a-still";

export interface DeliverabilityFinding {
  readonly code: DeliverabilityCode;
  readonly conceptId: string;
  /** e.g. "beat-3.narration". */
  readonly location: string;
  readonly evidence: string;
  readonly detail: string;
}

export interface DeliverabilityInput {
  readonly conceptId: string;
  readonly surface: string;
  readonly captureType: CaptureType;
  readonly lines: readonly { readonly location: string; readonly text: string }[];
}

/**
 * Check a concept's copy against what its declared renderer will deliver.
 *
 * Deterministic, offline, and silent about surfaces it does not know: an
 * unknown surface produces no findings rather than a guess, because inventing
 * constraints for an unmodelled page would block honest work.
 */
export function checkRenderDeliverability(input: DeliverabilityInput): readonly DeliverabilityFinding[] {
  const findings: DeliverabilityFinding[] = [];
  const content = SURFACE_CONTENT[input.surface];

  for (const line of input.lines) {
    if (input.captureType === "static") {
      for (const pattern of MOTION_PROMISES) {
        const match = pattern.exec(line.text);
        if (match === null) continue;
        findings.push({
          code: "promises-motion-from-a-still",
          conceptId: input.conceptId,
          location: line.location,
          evidence: match[0],
          detail:
            "This promises the picture changes, but the declared capture is a single static frame. Either the copy " +
            "must stop promising motion, or the concept must declare a capture type that actually moves.",
        });
        break;
      }
    }

    if (content === undefined) continue;
    for (const absent of content.absent) {
      for (const pattern of absent.promises) {
        const match = pattern.exec(line.text);
        if (match === null) continue;
        findings.push({
          code: "promises-absent-element",
          conceptId: input.conceptId,
          location: line.location,
          evidence: match[0],
          detail: `${absent.detail} Missing element: ${absent.element}. Verified: ${absent.verifiedAt}`,
        });
        break;
      }
    }
  }

  return findings;
}
