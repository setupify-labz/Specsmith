// Why-now establishment and the mission guard, tested directly.
//
// Both of these were guards the wider suite did not reach. The why-now refusal
// only fires for classes that COULD be urgent, and the loop's own check meant
// buildContentMission's refusal was never exercised — so disabling either broke
// nothing, which means neither was load-bearing. These tests fix that.

import { describe, expect, it } from "vitest";

import { establishWhyNow, opportunityFreshness } from "./opportunity.ts";
import { buildContentMission, MissionRefusedError, type StrategicAngle } from "./contentMission.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { PriorityAssessment } from "./priority.ts";
import type { StrategicOpportunity } from "./model.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const DAY = 24 * 3_600_000;

const UNAVAILABLE = {
  available: false as const,
  reason: "not-configured" as const,
  explanation: "nothing connected",
};

describe("why-now refuses to manufacture urgency", () => {
  it("returns insufficient-evidence for an urgency-capable class with no temporal evidence", () => {
    // breaking-time-sensitive COULD be urgent. Nothing observed says it is.
    const result = establishWhyNow(
      "breaking-time-sensitive",
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
    );
    expect(result.state).toBe("insufficient-evidence");
    expect(result.state).not.toBe("time-sensitive");
    expect(result.reason).toMatch(/no temporal evidence exists/i);
  });

  it.each(["launch-event", "emerging-question", "seasonal", "dispute-explanation"] as const)(
    "refuses urgency for %s with nothing observed",
    (type) => {
      const result = establishWhyNow(
        type,
        { ...UNAVAILABLE, state: "unknown" },
        { ...UNAVAILABLE, state: "unknown" },
        { ...UNAVAILABLE, state: "unknown" },
      );
      expect(result.state).toBe("insufficient-evidence");
    },
  );

  it("reports emergence only when a trend was actually observed rising", () => {
    const result = establishWhyNow(
      "launch-event",
      { state: "rising", available: true, reason: "available", explanation: "series rose 140%" },
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
    );
    expect(result.state).toBe("recently-emerging");
    expect(result.reason).toContain("140%");
  });

  it("reports NOT urgent when interest is observably falling", () => {
    const result = establishWhyNow(
      "launch-event",
      { state: "falling", available: true, reason: "available", explanation: "series fell 60%" },
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
    );
    expect(result.state).toBe("not-actually-urgent");
  });

  it("calls a non-urgent class evergreen without needing any signal", () => {
    const result = establishWhyNow(
      "evergreen-education",
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
      { ...UNAVAILABLE, state: "unknown" },
    );
    expect(result.state).toBe("evergreen");
  });
});

describe("decay is per class", () => {
  function opportunity(overrides: Partial<StrategicOpportunity>): StrategicOpportunity {
    return {
      opportunityId: "opp-1", version: 1, detectedAt: NOW.toISOString(), origins: [],
      type: "evergreen-education", pillar: "hardware-terminology", problem: "p",
      audienceLevel: "beginner", primaryObjective: "educate-new-builders", secondaryObjectives: [],
      dependsOnClaimIds: [], evidenceState: "strongly-supported", whyNow: "evergreen",
      whyNowReason: "r", trend: "unknown", searchDemand: "unknown", competitorCoverage: "unknown",
      communityPain: "unknown", productSurface: null, productReadiness: "absent",
      bestBefore: null, expiresAt: null, lastValidatedAt: NOW.toISOString(),
      resourcePosture: "local-free", risks: [],
      confidence: { opportunityExists: "moderate", timing: "high", audienceNeed: "insufficient", mechanism: "low", evidence: "high", creativeFeasibility: "moderate", reasons: [] },
      provenance: { synthetic: false, producedBy: "test", producedAt: NOW.toISOString() },
      parentOpportunityId: null,
      ...overrides,
    };
  }

  it("calls an evergreen opportunity timeless however old", () => {
    expect(opportunityFreshness(opportunity({}), new Date(NOW.getTime() + 900 * DAY)).status).toBe("timeless");
  });

  it("expires a breaking opportunity past its expiry", () => {
    const breaking = opportunity({
      type: "breaking-time-sensitive",
      bestBefore: new Date(NOW.getTime() + 2 * DAY).toISOString(),
      expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
    });
    expect(opportunityFreshness(breaking, new Date(NOW.getTime() + 10 * DAY)).status).toBe("expired");
    expect(opportunityFreshness(breaking, new Date(NOW.getTime() + 4 * DAY)).status).toBe("past-best-before");
    expect(opportunityFreshness(breaking, NOW).status).toBe("current");
  });
});

describe("no mission can be built from a refusal", () => {
  const angle: StrategicAngle = {
    angleId: "angle-x", name: "Plain explainer", thesis: "Explain it once.",
    formatClass: "quick-explainer", audienceLevel: "beginner",
    servesObjective: "educate-new-builders", requiresClaimKinds: ["specification"],
    rationale: "safe default",
  };

  const contract: ResearchCreativeContract = {
    version: "research-creative-contract-v1", questionId: "q", generatedAt: NOW.toISOString(),
    safeClaims: [{
      claimId: "c1", proposition: "It has 12GB", state: "strongly-supported",
      requiredWording: [], supportingSnapshotIds: [],
    }],
    unsafeClaims: [], disputedClaims: [], groundedHookMaterial: [], openQuestions: [],
    limitations: [], overallState: "strongly-supported",
  };

  const opportunity: StrategicOpportunity = {
    opportunityId: "opp-1", version: 1, detectedAt: NOW.toISOString(), origins: [],
    type: "evergreen-education", pillar: "hardware-terminology", problem: "p",
    audienceLevel: "beginner", primaryObjective: "educate-new-builders", secondaryObjectives: [],
    dependsOnClaimIds: ["c1"], evidenceState: "strongly-supported", whyNow: "evergreen",
    whyNowReason: "r", trend: "unknown", searchDemand: "unknown", competitorCoverage: "unknown",
    communityPain: "unknown", productSurface: "builder", productReadiness: "shipped",
    bestBefore: null, expiresAt: null, lastValidatedAt: NOW.toISOString(),
    resourcePosture: "local-free", risks: [],
    confidence: { opportunityExists: "moderate", timing: "high", audienceNeed: "insufficient", mechanism: "low", evidence: "high", creativeFeasibility: "moderate", reasons: [] },
    provenance: { synthetic: false, producedBy: "test", producedAt: NOW.toISOString() },
    parentOpportunityId: null,
  };

  function assessment(action: PriorityAssessment["action"]): PriorityAssessment {
    return {
      opportunityId: "opp-1", tier: action === "produce-now" ? "produce-now" : "hold",
      action, dimensions: [], vetoes: [], tradeoffs: [],
      reasonsToAct: [], reasonsNotToAct: [], explanation: "because",
    };
  }

  it("builds a mission when the assessment authorises production", () => {
    const mission = buildContentMission({
      opportunity, assessment: assessment("produce-now"), contract, angle,
      productRoute: "/builder", hypothesisId: null, now: NOW,
    });
    expect(mission.missionId).toMatch(/^mission-/);
    expect(mission.permittedClaims).toHaveLength(1);
  });

  it.each(["hold-for-evidence", "hold-for-product", "reject-duplicate", "reject-risk", "backlog-evergreen", "retire-stale"] as const)(
    "refuses to build a mission when the assessment resolved to %s",
    (action) => {
      expect(() => buildContentMission({
        opportunity, assessment: assessment(action), contract, angle,
        productRoute: "/builder", hypothesisId: null, now: NOW,
      })).toThrow(MissionRefusedError);
    },
  );

  it("refuses to build a mission when the contract approved no claims", () => {
    expect(() => buildContentMission({
      opportunity, assessment: assessment("produce-now"),
      contract: { ...contract, safeClaims: [] }, angle,
      productRoute: "/builder", hypothesisId: null, now: NOW,
    })).toThrow(/approved no claims/);
  });

  it("carries the contract's claims rather than an empty list", () => {
    const mission = buildContentMission({
      opportunity, assessment: assessment("produce-now"), contract, angle,
      productRoute: "/builder", hypothesisId: null, now: NOW,
    });
    expect(mission.permittedClaims.map((claim) => claim.proposition)).toEqual(["It has 12GB"]);
  });
});
