import { describe, expect, it } from "vitest";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import type { StrategicOpportunity } from "./model.ts";
import { proposeEvidenceBoundAngles } from "./evidenceBoundAngles.ts";

const contract: ResearchCreativeContract = {
  version: "research-creative-contract-v1",
  questionId: "q",
  generatedAt: "2026-09-15T00:00:00.000Z",
  safeClaims: [{
    claimId: "safe-spec",
    proposition: "Example GPU has 12GB of VRAM",
    state: "known",
    requiredWording: [],
    supportingSnapshotIds: ["snap"],
  }],
  unsafeClaims: [],
  disputedClaims: [],
  groundedHookMaterial: [],
  openQuestions: [],
  limitations: [],
  overallState: "known",
};

const research = {
  claims: [{ claimId: "safe-spec", kind: "specification" }],
} as unknown as ResearchResult;

function opportunity(pillar: StrategicOpportunity["pillar"], primaryObjective: StrategicOpportunity["primaryObjective"]): StrategicOpportunity {
  return {
    opportunityId: "opp",
    version: 1,
    detectedAt: "2026-09-15T00:00:00.000Z",
    origins: [],
    type: "evergreen-education",
    pillar,
    problem: "What should I know?",
    audienceLevel: "beginner",
    primaryObjective,
    secondaryObjectives: [],
    dependsOnClaimIds: ["safe-spec"],
    evidenceState: "known",
    whyNow: "evergreen",
    whyNowReason: "evergreen",
    trend: "unknown",
    searchDemand: "unknown",
    competitorCoverage: "unknown",
    communityPain: "unknown",
    productSurface: "builder",
    productReadiness: "shipped",
    bestBefore: null,
    expiresAt: null,
    lastValidatedAt: "2026-09-15T00:00:00.000Z",
    resourcePosture: "local-free",
    risks: [],
    confidence: { opportunity: "high", timing: "moderate", audienceNeed: "low", mechanism: "moderate", evidence: "high", creativeFeasibility: "high", reasons: [] },
    provenance: { synthetic: false, producedBy: "test", producedAt: "2026-09-15T00:00:00.000Z" },
    parentOpportunityId: null,
  } as StrategicOpportunity;
}

describe("angle evidence binding", () => {
  it("refuses an FPS angle when the only safe claim is a specification", () => {
    const result = proposeEvidenceBoundAngles(opportunity("fps-expectations", "drive-fps-estimator-usage"), contract, research);
    expect(result.chosen).toBeNull();
    expect(result.considered.every((angle) => angle.rejectedBecause?.includes("performance-estimated"))).toBe(true);
  });

  it("refuses a comparison angle when the only safe claim is a specification", () => {
    const result = proposeEvidenceBoundAngles(opportunity("gpu-comparisons", "shareable-comparison"), contract, research);
    expect(result.chosen).toBeNull();
    expect(result.considered.some((angle) => angle.rejectedBecause?.includes("comparison"))).toBe(true);
  });

  it("still permits the specification-only explainer supported by the safe claim", () => {
    const result = proposeEvidenceBoundAngles(opportunity("hardware-terminology", "educate-new-builders"), contract, research);
    expect(result.chosen?.name).toBe("What it actually does");
    const threshold = result.considered.find((angle) => angle.name === "How much do you need");
    expect(threshold?.rejectedBecause).toContain("performance-estimated");
  });
});
