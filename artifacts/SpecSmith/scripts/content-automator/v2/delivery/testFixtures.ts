// MASTER #4 — Shared test fixtures.
//
// A minimal but REAL mission/contract/research triple, built from the actual
// frozen types rather than from loose object literals, so that a shape change
// upstream breaks these tests instead of letting them drift into testing a
// fiction.
//
// The running example is the one the brief itself uses: an estimated FPS
// comparison whose estimator status and configuration are load-bearing, plus a
// forbidden over-claim ("More VRAM doesn't matter") that the evidence does not
// support.
//
// Everything here is fictional — "Example GPU-A", "example.invalid" — and this
// module is imported only by tests and by the engineering fixture path.
//
// The unsafe and disputed claims deliberately concern DIFFERENT subjects
// (GPU-C/GPU-D) from the approved ones (GPU-A/GPU-B). That is not a convenience:
// MASTER #2's strict gate fails closed whenever a line shares two distinctive
// words with an unsafe claim, and a product name alone supplies both. So a
// contract carrying an unsafe claim about the SAME product makes every script
// about that product fail. That is upstream conservatism working as the audit
// intended, not a MASTER #4 concern, and `deliveryPass.test.ts` documents it
// explicitly rather than hiding it here.

import type { AtomicClaim } from "../research/model.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { ContentMission, StrategicAngle } from "../strategy/contentMission.ts";

const NOW = "2026-09-15T12:00:00.000Z";

export const ESTIMATED_FPS_PROPOSITION =
  "SpecSmith estimates Example GPU-A at approximately 15% higher modeled FPS than Example GPU-B at 1440p high";

export const FORBIDDEN_VRAM_PROPOSITION = "More VRAM does not matter for gaming performance";

export function claimsFixture(): readonly AtomicClaim[] {
  const provenance = {
    synthetic: true,
    producedBy: "SYNTHETIC_ENGINEERING_FIXTURE",
    producedAt: NOW,
  } as AtomicClaim["provenance"];

  return [
    {
      claimId: "claim-fps",
      questionId: "question-vram-fps",
      proposition: ESTIMATED_FPS_PROPOSITION,
      kind: "performance-estimated",
      risk: "high",
      subjectIds: ["example-gpu-a", "example-gpu-b"],
      provenance,
    },
    {
      claimId: "claim-vram-spec",
      questionId: "question-vram-fps",
      proposition: "Example GPU-A has 12GB of VRAM",
      kind: "specification",
      risk: "low",
      subjectIds: ["example-gpu-a"],
      provenance,
    },
    {
      claimId: "claim-unsafe",
      questionId: "question-vram-fps",
      proposition: "Example GPU-C will stay fast for the next five years",
      kind: "recommendation",
      risk: "high",
      subjectIds: ["example-gpu-c"],
      provenance,
    },
    {
      claimId: "claim-disputed",
      questionId: "question-vram-fps",
      proposition: "Example GPU-C runs 20 degrees cooler than Example GPU-D",
      kind: "performance-measured",
      risk: "medium",
      subjectIds: ["example-gpu-c", "example-gpu-d"],
      provenance,
    },
  ];
}

export function contractFixture(): ResearchCreativeContract {
  return {
    version: "research-creative-contract-v1",
    questionId: "question-vram-fps",
    generatedAt: NOW,
    safeClaims: [
      {
        claimId: "claim-fps",
        proposition: ESTIMATED_FPS_PROPOSITION,
        state: "likely",
        // These two are the whole point: drop either and the claim changes.
        requiredWording: ["estimated", "at 1440p high"],
        supportingSnapshotIds: ["snapshot-fixture-1"],
      },
      {
        claimId: "claim-vram-spec",
        proposition: "Example GPU-A has 12GB of VRAM",
        state: "strongly-supported",
        requiredWording: [],
        supportingSnapshotIds: ["snapshot-fixture-2"],
      },
    ],
    unsafeClaims: [
      {
        claimId: "claim-unsafe",
        proposition: "Example GPU-C will stay fast for the next five years",
        state: "unknown",
        reason: "Nothing establishes future performance; no source was found and none could exist yet.",
        wouldBecomeSafeIf: ["A multi-year measured record for this part existed, which it cannot yet."],
      },
    ],
    disputedClaims: [
      {
        claimId: "claim-disputed",
        proposition: "Example GPU-C runs 20 degrees cooler than Example GPU-D",
        state: "disputed",
        reason: "Two fixture sources report different deltas under different cooling configurations.",
        wouldBecomeSafeIf: ["Both parts were measured under one identical cooling configuration."],
      },
    ],
    groundedHookMaterial: [{ claimId: "claim-vram-spec", angle: "The capacity figure is concrete and checkable." }],
    openQuestions: ["Whether the estimate holds at 4K, which was not modelled."],
    limitations: ["Every input is engineering fixture data and none of it describes a real product."],
    overallState: "likely",
  };
}

export function researchFixture(): ResearchResult {
  const contract = contractFixture();
  return {
    version: "research-result-v1",
    researchId: "research-fixture-1",
    question: {
      questionId: "question-vram-fps",
      question: "Does VRAM capacity alone determine gaming performance?",
      purpose: "Beginners repeatedly treat capacity as a speed rating.",
      informsDecision: "Whether a short explainer can answer this honestly with modelled figures.",
      claimKind: "performance-estimated",
      risk: "high",
      acceptableUncertainty: "likely",
      subjectIds: ["example-gpu-a", "example-gpu-b"],
    },
    startedAt: NOW,
    completedAt: NOW,
    snapshots: [],
    assessments: [],
    observations: [],
    claims: claimsFixture(),
    links: [],
    corroborations: [],
    conflicts: [],
    gaps: [],
    confidence: new Map(),
    stoppingReason: "evidence-sufficient" as ResearchResult["stoppingReason"],
    stoppedSuccessfully: true,
    budget: { spent: 0, limit: 0 } as unknown as ResearchResult["budget"],
    limitations: contract.limitations,
    containsSyntheticEvidence: true,
    contract,
  };
}

export function angleFixture(): StrategicAngle {
  return {
    angleId: "angle-estimate-explainer",
    name: "Estimate explainer",
    thesis: "Capacity alone does not decide frame rate, and here is the modelled difference.",
    formatClass: "quick-explainer",
    audienceLevel: "beginner",
    servesObjective: "educate-new-builders",
    requiresClaimKinds: ["specification", "performance-estimated"],
    rationale: "Asserts the fewest claim kinds that still answer the question honestly.",
  } as StrategicAngle;
}

/**
 * A mission with a shipped product route.
 *
 * `usefulWithoutCta` is true because the content answers the question whether or
 * not the viewer ever visits the tool — which is what makes the CTA an offer
 * rather than the reason the content exists.
 */
export function missionFixture(overrides: Partial<ContentMission> = {}): ContentMission {
  const contract = contractFixture();
  return {
    version: "content-mission-v1",
    missionId: "mission-fixture-1",
    opportunityId: "opportunity-fixture-1",
    createdAt: NOW,
    primaryObjective: "educate-new-builders",
    secondaryObjectives: [],
    pillar: "hardware-terminology",
    audienceProblem: "I do not know whether more VRAM will give me more FPS.",
    audienceLevel: "beginner",
    viewerShouldUnderstand: "VRAM capacity is a limit, not a speed, and frame rate depends on the whole pipeline.",
    viewerShouldDo: "Check the estimate for their own pair of parts rather than assuming capacity decides it.",
    centralQuestion: "Does more VRAM mean more FPS?",
    angle: angleFixture(),
    formatClass: "quick-explainer",
    permittedClaims: contract.safeClaims,
    forbiddenClaims: [
      {
        proposition: FORBIDDEN_VRAM_PROPOSITION,
        reason: "The evidence shows capacity is not the only factor, which is not the same as it not mattering at all.",
      },
    ],
    requiredWording: ["estimated", "at 1440p high"],
    productSurface: "compare",
    productRoute: "/compare",
    ctaIntent: "Check your own pair in the comparison tool:",
    usefulWithoutCta: true,
    whyNow: "evergreen",
    whyThisDeservesProduction: "A concrete, checkable answer to a question beginners keep asking.",
    successHypothesisId: null,
    risks: [],
    resourcePosture: "local-free",
    provenance: { synthetic: true, producedBy: "SYNTHETIC_ENGINEERING_FIXTURE", producedAt: NOW },
    ...overrides,
  } as ContentMission;
}
