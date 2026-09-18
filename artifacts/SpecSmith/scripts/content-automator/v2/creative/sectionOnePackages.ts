// MASTER #6 — The three section-1 creative packages, encoded as real concepts.
//
// These are not fixtures in the "synthetic evidence" sense: every number they
// rest on is computed from the repository's own catalog by the repository's own
// shipped FPS model, and the audience problem is the one SpecSmith's /compare
// surface exists to answer. They are here so the packages that drove the
// architecture can be re-run THROUGH the architecture, which is the only honest
// way to find out whether the architecture was worth building.
//
// Source document: docs/creative/master6-creative-target.md
//
// Package 2 is deliberately included even though it is blocked: the renderer has
// no vertical annotated spec-card surface. A creative system that silently drops
// its most useful idea because the idea is inconvenient is worse than no system.

import { CREATIVE_DISCLOSURES, type CreativeConcept } from "./concept.ts";
import { FPS_ESTIMATE_DISCLOSURE } from "./separability.ts";

/** Disclosure ids referenced by the packages. */
export const DISCLOSURE_FPS_ESTIMATE = "disclosure.fps-estimate";
export const DISCLOSURE_EDITORIAL_PRICE = "disclosure.editorial-price";
export const DISCLOSURE_MODEL_RANGE = "disclosure.model-range";

export const DISCLOSURE_TEXT: Readonly<Record<string, string>> = {
  [DISCLOSURE_FPS_ESTIMATE]: FPS_ESTIMATE_DISCLOSURE,
  [DISCLOSURE_EDITORIAL_PRICE]:
    "CPU and GPU only: editorial reference totals, not full-build costs or live retail quotes. Motherboard, RAM and other parts cost extra.",
  [DISCLOSURE_MODEL_RANGE]:
    CREATIVE_DISCLOSURES[DISCLOSURE_MODEL_RANGE],
};

function disclosuresForBeats(count: number, ids: readonly string[]) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [index, ids.map((id) => DISCLOSURE_TEXT[id])])) as Record<number, string[]>;
}

/** The capability ids the packages declare they need. */
export const CAPABILITY_COMPARE_CAPTURE = "render.compare-surface-capture";
export const CAPABILITY_BAND_OVERLAY = "render.estimate-band-overlay";
export const CAPABILITY_SPEC_CARD_SURFACE = "render.vertical-spec-card-surface";
export const CAPABILITY_SPLIT_SCREEN = "compose.split-screen-fork";

const COMPARE_STATE_LOW_GPU_BOUND = "compare-rtx5060ti-i3-13100f-rtx4060ti-r5-9600x-1440p-high-cs2";
const COMPARE_STATE_HIGH_GPU_BOUND = "compare-rtx5060ti-i3-13100f-rtx4060ti-r5-9600x-1440p-high-cyberpunk2077";

/** PACKAGE 1 — "The Crossover That Isn't". */
export const PACKAGE_CROSSOVER: CreativeConcept = {
  disclosureTextByBeat: disclosuresForBeats(6, [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_MODEL_RANGE, DISCLOSURE_EDITORIAL_PRICE]),
  conceptId: "m6-crossover-that-isnt",
  axes: {
    audienceExperience: "spectator",
    explanatoryStructure: "continuum-then-falsification",
    visualMechanism: "animated-product-walk",
  },
  viewerQuestion: "One of these two builds has to be better. Which one?",
  viewerTakeaway:
    "SpecSmith's estimate cannot tell these two builds apart on frame rate in any game it models, so the FPS bar is not the tiebreaker.",
  productDestination: "/compare?gpuA=rtx5060ti&cpuA=i3-13100f&gpuB=rtx4060ti&cpuB=r5-9600x&res=1440p&preset=high",
  requiredDisclosures: [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_EDITORIAL_PRICE, DISCLOSURE_MODEL_RANGE],
  requiredCapabilities: [
    { capabilityId: CAPABILITY_COMPARE_CAPTURE, description: "Deterministic vertical capture of the compare surface." },
    { capabilityId: CAPABILITY_BAND_OVERLAY, description: "Draw each estimate's declared min/max range over its bar." },
  ],
  visuals: [
    {
      kind: "real-product-capture",
      visualId: "p1-compare-low",
      surface: "compare",
      stateIdentifier: COMPARE_STATE_LOW_GPU_BOUND,
    },
    {
      kind: "real-product-capture",
      visualId: "p1-compare-high",
      surface: "compare",
      stateIdentifier: COMPARE_STATE_HIGH_GPU_BOUND,
    },
    {
      kind: "derived-illustration",
      visualId: "p1-band",
      explains:
        "The range SpecSmith declares for its own frame-rate estimate, drawn over both bars so the viewer can see the two ranges overlap.",
      subject: "fps",
      explanatoryLabel: "Explanatory drawing: SpecSmith's own estimate range.",
      derivedFrom: "src/lib/fps.ts FpsResult.min/max",
      showsNumericValues: true,
    },
  ],
  beats: [
    {
      purpose: "hook",
      startSecond: 0,
      endSecond: 3,
      narration: "Two CPU-and-GPU combinations, equal reference totals. Watch their point estimates change across games.",
      onScreenText: "CPU + GPU only: $654 reference total each",
      visualIds: ["p1-compare-low"],
      factDependencies: ["claim.identical-editorial-price"],
    },
    {
      purpose: "commitment",
      startSecond: 3,
      endSecond: 7,
      narration: "These games are ordered by the GPU weighting inside SpecSmith's model, not a measured hardware test.",
      onScreenText: "Ordered by model GPU weighting",
      visualIds: ["p1-compare-low"],
      factDependencies: ["claim.gpu-bound-axis"],
    },
    {
      purpose: "evidence",
      startSecond: 7,
      endSecond: 22,
      narration:
        "At the CPU-leaning end the Ryzen build is ahead on the estimate. The gap closes, they tie, and then the GPU build takes over.",
      onScreenText: "Estimated FPS, 1440p High",
      visualIds: ["p1-compare-low", "p1-compare-high"],
      factDependencies: ["claim.point-estimate-crossover"],
    },
    {
      purpose: "payoff",
      startSecond: 22,
      endSecond: 30,
      narration: "The crossover sits around zero point seven one. Below it the CPU build leads the estimate, above it the GPU build does.",
      onScreenText: "Crossover ≈ 0.71",
      visualIds: ["p1-compare-high"],
      factDependencies: ["claim.point-estimate-crossover"],
    },
    {
      purpose: "reversal",
      startSecond: 30,
      endSecond: 40,
      narration:
        "Here is the range SpecSmith puts on its own estimate. Every one of those gaps is inside it, including the eighteen-frame one. So the model does not separate these builds anywhere.",
      onScreenText: "Every gap is inside the estimate's own range",
      visualIds: ["p1-band"],
      factDependencies: ["claim.no-game-separates"],
    },
    {
      purpose: "cta",
      startSecond: 40,
      endSecond: 45,
      narration: "The chart is not the tiebreaker. Open the compare page with your own game and look at what is underneath it.",
      onScreenText: "Compare your own game",
      visualIds: ["p1-compare-high"],
      factDependencies: [],
    },
  ],
};

/** PACKAGE 2 — "Two Numbers That Aren't Estimates". Blocked by design. */
export const PACKAGE_SPEC_FORENSICS: CreativeConcept = {
  disclosureTextByBeat: disclosuresForBeats(6, [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_MODEL_RANGE, DISCLOSURE_EDITORIAL_PRICE]),
  conceptId: "m6-two-numbers-that-arent-estimates",
  axes: {
    audienceExperience: "investigator",
    explanatoryStructure: "elimination-then-substitution",
    visualMechanism: "annotated-static-card",
  },
  viewerQuestion: "If the frame rates come out basically the same, what am I actually choosing between?",
  viewerTakeaway:
    "These CPU-and-GPU reference totals omit platform costs. Check memory capacity, motherboard compatibility and the total parts list before deciding.",
  productDestination: "/compare?gpuA=rtx5060ti&cpuA=i3-13100f&gpuB=rtx4060ti&cpuB=r5-9600x&res=1440p&preset=high",
  requiredDisclosures: [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_EDITORIAL_PRICE, DISCLOSURE_MODEL_RANGE],
  requiredCapabilities: [
    {
      capabilityId: CAPABILITY_SPEC_CARD_SURFACE,
      description:
        "A real vertical product surface that renders a two-column annotated spec comparison. Drawing it as a bespoke motion graphic would forfeit the property that makes these packages trustworthy: that the visual is the product.",
    },
  ],
  visuals: [
    {
      kind: "real-product-capture",
      visualId: "p2-spec-card",
      surface: "compare",
      stateIdentifier: COMPARE_STATE_LOW_GPU_BOUND,
    },
    {
      kind: "derived-illustration",
      visualId: "p2-widest-gap",
      explains: "The widest frame-rate gap in the catalog shown with the range SpecSmith declares around it.",
      subject: "fps",
      explanatoryLabel: "Explanatory drawing: SpecSmith's own estimate range.",
      derivedFrom: "src/lib/fps.ts FpsResult.min/max",
      showsNumericValues: true,
    },
  ],
  beats: [
    {
      purpose: "hook",
      startSecond: 0,
      endSecond: 4,
      narration: "I am going to throw away the frame-rate chart in eight seconds. Here is what is left.",
      onScreenText: "CPU + GPU only: $654 reference total each",
      visualIds: ["p2-spec-card"],
      factDependencies: ["claim.identical-editorial-price"],
    },
    {
      purpose: "commitment",
      startSecond: 4,
      endSecond: 10,
      narration: "Every gap the chart shows is smaller than the range the estimate ships with.",
      onScreenText: "The gap is inside the range",
      visualIds: ["p2-widest-gap"],
      factDependencies: ["claim.no-game-separates"],
    },
    {
      purpose: "evidence",
      startSecond: 10,
      endSecond: 24,
      narration:
        "The CPU-and-GPU reference totals match, but the complete costs may not. These representative catalog configurations list different graphics memory, memory support and core counts. Check your exact SKU; those specifications are not performance measurements.",
      onScreenText: "16 GB vs 8 GB · DDR4/DDR5 vs DDR5 · 4c8t vs 6c12t",
      visualIds: ["p2-spec-card"],
      factDependencies: ["claim.spec-differences"],
    },
    {
      purpose: "commitment",
      startSecond: 24,
      endSecond: 33,
      narration:
        "List the compatible motherboard and RAM for each combination. Then compare the complete cost. These specifications alone do not establish future performance or upgrade support.",
      onScreenText: "Check compatible motherboard, RAM and full cost",
      visualIds: ["p2-spec-card"],
      factDependencies: ["claim.reference-total-excludes-platform"],
    },
    {
      purpose: "payoff",
      startSecond: 33,
      endSecond: 40,
      narration: "Equal CPU-and-GPU reference totals are not equal complete builds. Check the missing parts before choosing.",
      onScreenText: "Equal partial totals ≠ equal full-build costs",
      visualIds: ["p2-spec-card"],
      factDependencies: ["claim.spec-differences"],
    },
    {
      purpose: "cta",
      startSecond: 40,
      endSecond: 45,
      narration: "Both spec sheets are on the compare page. Read the three lines that differ.",
      onScreenText: "Read the three lines",
      visualIds: ["p2-spec-card"],
      factDependencies: [],
    },
  ],
};

/** PACKAGE 3 — "One Question, Then Stop Watching". */
export const PACKAGE_BRANCH: CreativeConcept = {
  disclosureTextByBeat: disclosuresForBeats(5, [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_MODEL_RANGE]),
  conceptId: "m6-one-question-then-stop",
  axes: {
    audienceExperience: "participant",
    explanatoryStructure: "branch-no-ranking",
    visualMechanism: "split-screen-fork",
  },
  viewerQuestion: "I do not know enough to judge this. Which part of it applies to me?",
  viewerTakeaway:
    "Start with my own games, then check estimate ranges, compatible platform parts and the full cost. Game category alone cannot choose the build.",
  productDestination: "/compare?gpuA=rtx5060ti&cpuA=i3-13100f&gpuB=rtx4060ti&cpuB=r5-9600x&res=1440p&preset=high",
  requiredDisclosures: [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_MODEL_RANGE],
  requiredCapabilities: [
    { capabilityId: CAPABILITY_COMPARE_CAPTURE, description: "Deterministic vertical capture of the compare surface." },
    { capabilityId: CAPABILITY_SPLIT_SCREEN, description: "Compose two independently captioned half-frames." },
    { capabilityId: CAPABILITY_BAND_OVERLAY, description: "Draw each estimate's declared range over its bar." },
  ],
  visuals: [
    {
      kind: "real-product-capture",
      visualId: "p3-left",
      surface: "compare",
      stateIdentifier: COMPARE_STATE_LOW_GPU_BOUND,
    },
    {
      kind: "real-product-capture",
      visualId: "p3-right",
      surface: "compare",
      stateIdentifier: COMPARE_STATE_HIGH_GPU_BOUND,
    },
    {
      kind: "derived-illustration",
      visualId: "p3-fork",
      explains: "A fork in the frame that separates the two halves of the decision so neither half ranks the builds.",
      subject: "other",
      explanatoryLabel: null,
      derivedFrom: null,
      showsNumericValues: false,
    },
    {
      kind: "derived-illustration",
      visualId: "p3-band-both",
      explains: "The range SpecSmith declares for its own estimate, drawn in both halves at once.",
      subject: "fps",
      explanatoryLabel: "Explanatory drawing: SpecSmith's own estimate range.",
      derivedFrom: "src/lib/fps.ts FpsResult.min/max",
      showsNumericValues: true,
    },
  ],
  beats: [
    {
      purpose: "hook",
      startSecond: 0,
      endSecond: 6,
      narration: "Which games matter most to you? Pick one to inspect in SpecSmith's estimator.",
      onScreenText: "Start with your own games",
      visualIds: ["p3-fork"],
      factDependencies: [],
    },
    {
      purpose: "commitment",
      startSecond: 6,
      endSecond: 11,
      narration: "This is a starting point, not the whole purchase decision. Compare two example games.",
      onScreenText: "Two examples—not a buying rule",
      visualIds: ["p3-fork"],
      factDependencies: [],
    },
    {
      purpose: "evidence",
      startSecond: 11,
      endSecond: 26,
      narration:
        "On the left, the games SpecSmith models as leaning on the CPU: the Ryzen build leads the estimate there. On the right, the heavy single-player titles: the GPU build leads the estimate there.",
      onScreenText: "Left: CPU-leaning · Right: GPU-leaning",
      visualIds: ["p3-left", "p3-right"],
      factDependencies: ["claim.point-estimate-crossover"],
    },
    {
      purpose: "reversal",
      startSecond: 26,
      endSecond: 34,
      narration:
        "Both examples have overlapping model ranges. Neither establishes a faster real system. Check compatibility, memory capacity and the complete parts cost before choosing.",
      onScreenText: "Both halves: inside the range",
      visualIds: ["p3-band-both"],
      factDependencies: ["claim.no-game-separates", "claim.spec-differences"],
    },
    {
      purpose: "cta",
      startSecond: 34,
      endSecond: 42,
      narration: "Take the half that is yours.",
      onScreenText: "Open your half",
      visualIds: ["p3-left", "p3-right"],
      factDependencies: [],
    },
  ],
};

export const SECTION_ONE_PACKAGES: readonly CreativeConcept[] = [
  PACKAGE_CROSSOVER,
  PACKAGE_SPEC_FORENSICS,
  PACKAGE_BRANCH,
];

/** What the production system can actually deliver today. */
export const AVAILABLE_CAPABILITIES: readonly string[] = [
  CAPABILITY_COMPARE_CAPTURE,
  CAPABILITY_BAND_OVERLAY,
  CAPABILITY_SPLIT_SCREEN,
];
