// The one shared, real, already-relied-upon ContentIdea used across this
// pipeline's offline smoke/e2e paths — issue #89's included scope requires
// reusing this exact fixture idea rather than inventing another one. Single
// source of truth so mediaRender.test.ts, offlineGeneratedPlanRender.ts, and
// endToEndOfflinePipeline.ts cannot drift apart into three subtly different
// "the same idea".
//
// requiredFacts is deliberately just ["comparison state"]: the one fact the
// actual rendered evidence (the live Compare page, captured through a real
// browser) substantiates.

import type { ContentIdea } from "../types.ts";

export const COMPARE_RTX4080S_RTX4080_IDEA: ContentIdea = {
  id: "compare-rtx4080s-rtx4080",
  format: "comparison",
  title: "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080",
  hook: "Can you pick the faster card before the names show?",
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
