// The one real SpecSmith idea the offline render chain is proven against.
//
// EXTRACTED, NOT INVENTED. This literal was already in the repository twice —
// inline in endToEndOfflinePipeline.ts and again in mediaRender.test.ts's
// fixture — and the pipeline's own comment says it was "copied verbatim" from
// that fixture because it is "a real, already-relied-upon ContentIdea, not
// invented for this script".
//
// It lives here now because the storyboard renderer has to drive the SAME
// idea the rest of the pipeline does. Two copies of a fixture that are
// supposed to agree is how they stop agreeing.
//
// requiredFacts is deliberately just ["comparison state"]: the one fact the
// rendered evidence — the live Compare page, captured through a real browser
// — actually substantiates.

import type { ContentIdea } from "./types.ts";

export const COMPARE_IDEA: ContentIdea = {
  id: "compare-rtx4080s-rtx4080",
  format: "comparison",
  title: "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080",
  // Compare shows which build has the higher ESTIMATE, not which card is
  // faster, so the hook asks about the estimate (see #155).
  hook: "Which card does SpecSmith estimate higher? Pick before the names show.",
  angle: "Use Compare as the evidence and reveal.",
  targetAudience: "PC builders",
  requiredFacts: ["comparison state"],
  subjectIds: ["rtx4080s", "rtx4080"],
  productConnection: {
    feature: "compare",
    route: "/compare",
    userProblem: "Buyers cannot tell which near-name GPU is the better choice.",
    whySpecSmith: "SpecSmith Compare holds the rest of the build constant.",
    continuationAction: "Open Compare and change the cards.",
    sitePayoff: "The viewer can continue the exact comparison.",
  },
  creativeDNA: {
    conceptName: "Blind Compare",
    visualWorld: "real SpecSmith comparison",
    narrativeEngine: "blind choice -> evidence -> reveal",
    openingImage: "Two anonymous cards",
    patternInterrupt: "Names hidden",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Reveal the winner",
    audioDirection: "Tight",
    originalityConstraint: "Compare is essential",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9, usefulness: 9, visualPotential: 9, purchaseIntent: 8, novelty: 8,
    originality: 9, retentionPotential: 9, shareability: 8, productFit: 10, siteContinuation: 10, total: 9,
  },
};
