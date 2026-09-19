// Confidence derivation.
//
// The four rules this file exists to pin down, each of which is a way research
// systems manufacture certainty:
//
//   unknown never becomes 0
//   missing evidence never becomes false
//   absence of contradiction never becomes proof
//   a conflict never averages into a confident middle

import { describe, expect, it } from "vitest";

import { assessConfidence, meetsAcceptableUncertainty, requiredStateForRisk, stateStrength, weakestState } from "./confidence.ts";
import type { AtomicClaim, ClaimEvidenceLink, Conflict, Corroboration, ResearchProvenance, SourceAssessment } from "./model.ts";

const provenance: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: "2026-09-15T12:00:00.000Z" };

function claim(overrides: Partial<AtomicClaim> = {}): AtomicClaim {
  return {
    claimId: "claim-1",
    questionId: "q-1",
    proposition: "a proposition",
    kind: "comparison",
    risk: "medium",
    subjectIds: ["subject"],
    provenance,
    ...overrides,
  };
}

function link(overrides: Partial<ClaimEvidenceLink> = {}): ClaimEvidenceLink {
  return {
    claimId: "claim-1",
    observationId: "obs-1",
    stance: "supports",
    applicability: "exact",
    applicabilityReasons: [],
    freshness: "current",
    freshnessReason: "recent",
    generalisesBeyondObservation: false,
    ...overrides,
  };
}

function assessment(overrides: Partial<SourceAssessment> = {}): SourceAssessment {
  return {
    snapshotId: "snap-1",
    authority: "high",
    directness: "primary",
    methodologicalTransparency: "high",
    independence: "high",
    relevanceToClaimKind: "high",
    conflictOfInterest: "none-known",
    materialObserved: true,
    limitations: [],
    reasons: [],
    ...overrides,
  };
}

function corroboration(independentOriginCount: number): Corroboration {
  return {
    claimId: "claim-1",
    snapshotIds: ["snap-1"],
    independentOriginCount,
    dependentGroups: [],
    reason: `${independentOriginCount} independent origin(s)`,
  };
}

describe("unknown is not zero and missing evidence is not false", () => {
  it("reports unknown when nothing at all has been linked", () => {
    const result = assessConfidence({
      claim: claim(),
      links: [],
      assessments: [],
      corroboration: corroboration(0),
      conflict: null,
    });
    // NOT weakly-supported, NOT false, NOT 0: nobody has looked.
    expect(result.state).toBe("unknown");
    expect(result.detractors.join(" ")).toMatch(/No evidence of any kind/i);
    expect(result.drivers).toEqual([]);
    expect(result.wouldChangeIfs.length).toBeGreaterThan(0);
  });

  it("distinguishes 'nobody looked' from 'we looked and the evidence was thin'", () => {
    const nothing = assessConfidence({ claim: claim(), links: [], assessments: [], corroboration: corroboration(0), conflict: null });
    const thin = assessConfidence({
      claim: claim(),
      links: [link({ applicability: "weak", freshness: "aging" })],
      assessments: [assessment({ relevanceToClaimKind: "low", authority: "low" })],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(nothing.state).toBe("unknown");
    expect(thin.state).not.toBe("unknown");
  });

  it("reports insufficient-evidence when every observation is about something else", () => {
    const result = assessConfidence({
      claim: claim(),
      links: [link({ applicability: "not-applicable", applicabilityReasons: ["a laptop part"] })],
      assessments: [assessment()],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(result.state).toBe("insufficient-evidence");
    expect(result.detractors.join(" ")).toMatch(/not-applicable/i);
  });
});

describe("a conflict is never averaged into a confident middle", () => {
  it("reports disputed when sources disagree and nothing explains it", () => {
    const conflict: Conflict = {
      claimId: "claim-1",
      snapshotIds: ["snap-1", "snap-2"],
      whatConflicts: "averageFps ranges from 60 to 95",
      resolved: false,
    };
    const result = assessConfidence({
      claim: claim(),
      // Deliberately excellent evidence on both sides: two independent,
      // authoritative, current, exactly-applicable sources. The disagreement
      // still dominates, because two good sources disagreeing is not improved
      // by both being good.
      links: [link(), link({ observationId: "obs-2" })],
      assessments: [assessment(), assessment({ snapshotId: "snap-2" })],
      corroboration: corroboration(2),
      conflict,
    });
    expect(result.state).toBe("disputed");
    expect(result.detractors.join(" ")).toContain("60 to 95");
    // No invented winner, and no midpoint anywhere in the output.
    expect(JSON.stringify(result)).not.toContain("77");
  });

  it("does not report disputed when a configuration difference explains the gap", () => {
    const conflict: Conflict = {
      claimId: "claim-1",
      snapshotIds: ["snap-1", "snap-2"],
      whatConflicts: "averageFps ranges from 60 to 95",
      explanation: "different-configuration",
      resolved: true,
      resolutionReason: "measured at different resolutions",
    };
    const result = assessConfidence({
      claim: claim(),
      links: [link(), link({ observationId: "obs-2" })],
      assessments: [assessment(), assessment({ snapshotId: "snap-2" })],
      corroboration: corroboration(2),
      conflict,
    });
    expect(result.state).not.toBe("disputed");
    expect(result.drivers.join(" ")).toMatch(/apparent conflict was resolved/i);
  });
});

describe("stale evidence is its own answer", () => {
  it("reports stale rather than unknown or current when everything is past its window", () => {
    const result = assessConfidence({
      claim: claim(),
      links: [link({ freshness: "stale", freshnessReason: "four days old" })],
      assessments: [assessment()],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(result.state).toBe("stale");
    expect(result.drivers.join(" ")).toMatch(/applicable observation\(s\) exist/i);
    expect(result.detractors.join(" ")).toContain("four days old");
  });
});

describe("absence of contradiction is not proof", () => {
  it("does not reach strongly-supported on one interested source with nothing against it", () => {
    const result = assessConfidence({
      claim: claim({ risk: "high" }),
      links: [link()],
      assessments: [assessment({ conflictOfInterest: "likely", relevanceToClaimKind: "low" })],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(stateStrength(result.state)).toBeLessThan(stateStrength("strongly-supported"));
    expect(result.detractors.join(" ")).toMatch(/commercial interest/i);
  });

  it("requires two independent origins before a high-risk claim can be likely", () => {
    const one = assessConfidence({
      claim: claim({ risk: "high" }),
      links: [link()],
      assessments: [assessment()],
      corroboration: corroboration(1),
      conflict: null,
    });
    const two = assessConfidence({
      claim: claim({ risk: "high" }),
      links: [link()],
      assessments: [assessment()],
      corroboration: corroboration(2),
      conflict: null,
    });
    expect(one.state).toBe("insufficient-evidence");
    expect(stateStrength(two.state)).toBeGreaterThanOrEqual(stateStrength("likely"));
  });

  it("penalises a source nobody read directly", () => {
    const result = assessConfidence({
      claim: claim(),
      links: [link()],
      assessments: [assessment({ materialObserved: false })],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(result.detractors.join(" ")).toMatch(/never read directly/i);
    expect(result.wouldChangeIfs.join(" ")).toMatch(/Fetching those sources directly/i);
  });

  it("records a generalisation as a detractor rather than ignoring it", () => {
    const result = assessConfidence({
      claim: claim(),
      links: [link({ generalisesBeyondObservation: true })],
      assessments: [assessment()],
      corroboration: corroboration(1),
      conflict: null,
    });
    expect(result.detractors.join(" ")).toMatch(/support a narrower statement/i);
  });
});

describe("thresholds and ordering", () => {
  it("demands more of a high-risk claim than of a low-risk one", () => {
    expect(requiredStateForRisk("high")).toBe("strongly-supported");
    expect(requiredStateForRisk("medium")).toBe("likely");
    expect(requiredStateForRisk("low")).toBe("likely");
  });

  it("never sets a threshold that UNSAFE_FOR_CREATIVE would refuse anyway", () => {
    for (const risk of ["low", "medium", "high"] as const) {
      // The two rules must agree: a threshold below the safety floor would be
      // a contradiction between them.
      expect(stateStrength(requiredStateForRisk(risk))).toBeGreaterThanOrEqual(stateStrength("likely"));
    }
  });

  it("satisfies a likely requirement with something stronger", () => {
    expect(meetsAcceptableUncertainty("strongly-supported", "likely")).toBe(true);
    expect(meetsAcceptableUncertainty("plausible", "likely")).toBe(false);
  });

  it("returns the weakest state in a set, and unknown for an empty one", () => {
    expect(weakestState(["strongly-supported", "likely", "plausible"])).toBe("plausible");
    expect(weakestState([])).toBe("unknown");
  });
});
