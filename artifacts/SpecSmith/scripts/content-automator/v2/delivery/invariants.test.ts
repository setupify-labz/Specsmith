// MASTER #4 — Truth and mission invariant tests.
//
// The adversarial core. Each test here is an attempt to get a platform
// adaptation to say more than its evidence supports, or to quietly become a
// different piece of content than the one strategy approved.
//
// The running example is the one from the brief: research approved
//
//   "SpecSmith estimates Example GPU-A at approximately 15% higher modeled FPS at 1440p high"
//
// and the attacks all try to ship "GPU A is 15% faster" in some form — in the
// script, in the caption, in the title, in a hashtag.

import { describe, expect, it } from "vitest";

import {
  assertMissionPreserved,
  assertNoEvidenceUpgrade,
  assertRequiredWordingPresent,
  assertTruthPreserved,
  extractTruthInvariant,
  FROZEN_MISSION_FIELDS,
  type ProposedAdaptation,
} from "./invariants.ts";
import { reproducesForbiddenWording } from "./invariants.ts";
import { missionFixture, researchFixture, contractFixture, FORBIDDEN_VRAM_PROPOSITION } from "./testFixtures.ts";

const mission = missionFixture();
const research = researchFixture();
const contract = contractFixture();
const invariant = extractTruthInvariant(mission, contract, research);

function check(text: string, location = "tiktok:beat[0].narration") {
  return assertTruthPreserved(invariant, [{ location, text }]);
}

function codes(findings: readonly { readonly code: string }[]): readonly string[] {
  return [...new Set(findings.map((finding) => finding.code))].sort();
}

describe("the invariant is extracted from the mission, not re-derived", () => {
  it("carries the estimated claim as an estimate", () => {
    expect(invariant.estimatedClaimIds).toContain("claim-fps");
  });

  it("carries every required wording the claims demand", () => {
    expect(invariant.requiredWording).toContain("estimated");
    expect(invariant.requiredWording).toContain("at 1440p high");
  });

  it("requires the estimator status to be disclosed", () => {
    expect(invariant.requiredDisclosures.join(" ")).toMatch(/SpecSmith estimates rather than measurements/);
  });
});

describe("platform adaptation cannot strengthen a claim", () => {
  it("rejects the brief's own example: dropping estimated and the configuration", () => {
    // "Example GPU-A is 15% faster." Keeps the figure, loses what made it true.
    const findings = check("Example GPU-A is 15% faster.");
    expect(findings.length).toBeGreaterThan(0);
    expect(codes(findings)).toContain("required-wording-dropped");
    expect(findings.some((f) => f.message.includes("no longer the one research approved"))).toBe(true);
  });

  it("rejects a line that keeps the configuration but drops the estimate label", () => {
    const findings = check("Example GPU-A gets 15% more FPS at 1440p high.");
    expect(codes(findings)).toContain("estimate-presented-as-fact");
  });

  it("rejects a line that keeps the estimate label but drops the configuration", () => {
    const findings = check("SpecSmith estimates Example GPU-A at about 15% higher FPS.");
    expect(codes(findings)).toContain("required-wording-dropped");
    expect(findings.some((f) => f.message.includes("at 1440p high"))).toBe(true);
  });

  it("rejects an estimate re-labelled as a measurement", () => {
    const findings = check("We measured Example GPU-A at an estimated 15% higher FPS at 1440p high.");
    expect(codes(findings)).toContain("estimate-upgraded-to-measurement");
  });

  it("rejects 'benchmarked' language over an estimated claim", () => {
    const findings = check("Benchmarked: Example GPU-A, estimated 15% higher FPS at 1440p high.");
    expect(codes(findings)).toContain("estimate-upgraded-to-measurement");
  });

  it("accepts the honest version that keeps everything", () => {
    const findings = check("SpecSmith estimates Example GPU-A at about 15% higher FPS at 1440p high.");
    expect(findings).toEqual([]);
  });

  it("accepts a reworded honest version — packaging may change", () => {
    const findings = check("At 1440p high, our estimated figure puts Example GPU-A about 15% ahead on FPS.");
    expect(findings).toEqual([]);
  });

  it("leaves unrelated copy alone", () => {
    // Honest text that mentions no claim must not be flagged. This is the
    // false-positive guard inherited from the MASTER #2 matcher audit.
    expect(check("Here is how we picked the parts for this build.")).toEqual([]);
    expect(check("Let's look at what actually limits frame rate.")).toEqual([]);
  });
});

describe("a forbidden claim is forbidden everywhere, metadata included", () => {
  it("rejects a forbidden claim in narration", () => {
    const findings = check("More VRAM doesn't matter.");
    expect(codes(findings)).toContain("forbidden-claim-in-adaptation");
  });

  it("rejects the same forbidden claim in a caption", () => {
    const findings = check("More VRAM doesn't matter.", "tiktok:metadata.description");
    expect(codes(findings)).toContain("forbidden-claim-in-adaptation");
  });

  it("rejects it in a title, which is often the only thing read", () => {
    const findings = check("More VRAM doesn't matter.", "youtube-shorts:metadata.title");
    expect(codes(findings)).toContain("forbidden-claim-in-adaptation");
  });

  it("explains that metadata is inside the evidence boundary", () => {
    const findings = check("More VRAM doesn't matter.", "tiktok:metadata.tags");
    expect(findings[0].message).toMatch(/metadata is inside the evidence boundary/);
  });
});

describe("required wording must appear on THIS platform's output", () => {
  it("fails when no text on this platform carries the required wording", () => {
    const findings = assertRequiredWordingPresent(invariant, [
      { location: "tiktok:beat[0].narration", text: "Let's talk about frame rate." },
    ]);
    expect(codes(findings)).toContain("mission-required-wording-absent");
    expect(findings.some((f) => f.message.includes("another platform's cut does not protect this platform's viewer"))).toBe(true);
  });

  it("passes when the wording appears somewhere in this platform's output", () => {
    const findings = assertRequiredWordingPresent(invariant, [
      { location: "tiktok:beat[0].narration", text: "Let's talk about frame rate." },
      { location: "tiktok:metadata.description", text: "Figures are estimated at 1440p high." },
    ]);
    expect(findings).toEqual([]);
  });

  it("accepts an inflection of a single-word caveat but not of a configuration", () => {
    // "estimates" delivers the caveat; "at 1440p" is a different configuration.
    expect(assertRequiredWordingPresent(invariant, [
      { location: "x", text: "SpecSmith estimates this at 1440p high." },
    ])).toEqual([]);

    const drifted = assertRequiredWordingPresent(invariant, [
      { location: "x", text: "SpecSmith estimates this at 1440p." },
    ]);
    expect(codes(drifted)).toContain("mission-required-wording-absent");
  });
});

describe("a forbidden claim cannot be shipped by rephrasing it", () => {
  it("catches a contraction of the forbidden claim", () => {
    expect(codes(check("More VRAM doesn't matter."))).toContain("forbidden-claim-in-adaptation");
  });

  it("catches it without the trailing punctuation too", () => {
    expect(codes(check("more vram does not matter"))).toContain("forbidden-claim-in-adaptation");
  });

  it("keeps the coverage net off the opposite assertion, on polarity", () => {
    // The net itself must not widen a forbidden claim to cover its reverse:
    // "does not matter" and "does matter" share almost every token.
    expect(reproducesForbiddenWording("More VRAM does matter for gaming performance.", FORBIDDEN_VRAM_PROPOSITION)).toBe(false);
    expect(reproducesForbiddenWording("More VRAM doesn't matter.", FORBIDDEN_VRAM_PROPOSITION)).toBe(true);
  });

  it("still flags the reverse assertion overall, which is the safe direction", () => {
    // MASTER #2's audited matcher flags this on "does"+"matter", and MASTER #4
    // does not suppress it. That is deliberate: the reverse of a forbidden claim
    // is usually just as unevidenced ("VRAM does matter" is not what research
    // established either), and suppressing an audited gate to satisfy a tidier
    // polarity story would be exactly the kind of weakening this layer forbids.
    expect(codes(check("More VRAM does matter for gaming performance."))).toContain("forbidden-claim-in-adaptation");
  });

  it("does not fire on honest copy that merely discusses the same subject", () => {
    expect(codes(check("VRAM is one of several things that affect gaming performance."))).not.toContain("forbidden-claim-in-adaptation");
    expect(codes(check("Let's look at what VRAM actually does."))).not.toContain("forbidden-claim-in-adaptation");
    expect(codes(check("Gaming performance depends on more than one part."))).not.toContain("forbidden-claim-in-adaptation");
  });
});

describe("platform adaptation cannot change the mission", () => {
  const faithful: ProposedAdaptation = {
    platform: "tiktok",
    objective: mission.primaryObjective,
    angleId: mission.angle.angleId,
    thesis: mission.angle.thesis,
    permittedClaimIds: mission.permittedClaims.map((claim) => claim.claimId),
    forbiddenPropositions: mission.forbiddenClaims.map((claim) => claim.proposition),
    requiredWording: mission.requiredWording,
    productRoute: mission.productRoute,
    resourcePosture: mission.resourcePosture,
    successHypothesisId: mission.successHypothesisId,
  };

  it("accepts a faithful adaptation", () => {
    expect(assertMissionPreserved(mission, faithful)).toEqual([]);
  });

  it("rejects a changed primary objective", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, objective: "grow-affiliate-revenue" });
    expect(codes(findings)).toContain("objective-changed");
    expect(findings[0].message).toMatch(/is MASTER #3's decision/);
  });

  it("rejects a silently swapped angle", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, angleId: "angle-something-else" });
    expect(codes(findings)).toContain("angle-changed");
    expect(findings[0].message).toMatch(/can authorise claim kinds research never cleared/);
  });

  it("rejects a changed thesis", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, thesis: "VRAM is the only thing that matters." });
    expect(codes(findings)).toContain("thesis-changed");
  });

  it("rejects an added claim the mission does not permit", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, permittedClaimIds: [...faithful.permittedClaimIds, "claim-invented"] });
    expect(codes(findings)).toContain("claim-added");
    expect(findings[0].message).toMatch(/MASTER #4 cannot authorise a claim/);
  });

  it("rejects dropping a forbidden claim from the adaptation's own prohibitions", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, forbiddenPropositions: [] });
    expect(codes(findings)).toContain("forbidden-claim-dropped");
  });

  it("rejects removing required wording to save time", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, requiredWording: [] });
    expect(codes(findings)).toContain("required-wording-removed");
    expect(findings[0].message).toMatch(/not a length problem to solve/);
  });

  it("rejects repointing the product route", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, productRoute: "/some-unshipped-thing" });
    expect(codes(findings)).toContain("product-route-changed");
    expect(findings[0].message).toMatch(/bypasses that check/);
  });

  it("rejects changing the resource posture", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, resourcePosture: "paid-provider" });
    expect(codes(findings)).toContain("resource-posture-changed");
  });

  it("rejects changing which hypothesis this content tests", () => {
    const findings = assertMissionPreserved(mission, { ...faithful, successHypothesisId: "hyp-different" });
    expect(codes(findings)).toContain("hypothesis-identity-changed");
  });

  it("records every frozen field, so the list is reviewable", () => {
    expect(FROZEN_MISSION_FIELDS).toContain("primaryObjective");
    expect(FROZEN_MISSION_FIELDS).toContain("forbiddenClaims");
    expect(FROZEN_MISSION_FIELDS).toContain("requiredWording");
  });
});

describe("MASTER #2 remains the factual authority", () => {
  it("rejects promoting an unsafe claim", () => {
    const findings = assertNoEvidenceUpgrade(contract, ["claim-unsafe"]);
    expect(codes(findings)).toContain("unsafe-claim-upgraded");
    expect(findings[0].message).toMatch(/Platform optimization is downstream from evidence/);
  });

  it("rejects resolving a disputed claim", () => {
    const findings = assertNoEvidenceUpgrade(contract, ["claim-disputed"]);
    expect(codes(findings)).toContain("disputed-claim-resolved");
    expect(findings[0].message).toMatch(/a platform preferring a cleaner story does not resolve that/);
  });

  it("rejects a claim research never saw at all", () => {
    const findings = assertNoEvidenceUpgrade(contract, ["claim-hallucinated"]);
    expect(codes(findings)).toContain("unknown-claim-asserted");
  });

  it("accepts exactly the claims research approved", () => {
    expect(assertNoEvidenceUpgrade(contract, contract.safeClaims.map((claim) => claim.claimId))).toEqual([]);
  });
});
