// The research -> Creative Director contract, and the evidence gate.
//
// The property under test throughout: creative want never outranks evidence.
// There is no input to any function here that says "we would really like to say
// this", and the tests below confirm the only way a claim becomes safe is by
// having the evidence its own risk class demands.

import { describe, expect, it } from "vitest";

import { buildResearchCreativeContract, checkScriptAgainstResearch, type ResearchCreativeContract } from "./creativeContract.ts";
import type { AtomicClaim, ClaimEvidenceLink, ConfidenceAssessment, EpistemicState, Observation, ResearchProvenance, SourceSnapshot } from "./model.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const provenance: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: NOW.toISOString() };

function claim(overrides: Partial<AtomicClaim> = {}): AtomicClaim {
  return {
    claimId: "claim-1",
    questionId: "q-1",
    proposition: "Widget-9000 has 12GB of memory",
    kind: "specification",
    risk: "low",
    subjectIds: ["widget-9000"],
    provenance,
    ...overrides,
  };
}

function confidence(state: EpistemicState): ConfidenceAssessment {
  return { state, drivers: ["a driver"], detractors: ["a detractor"], wouldChangeIfs: ["fresh evidence"] };
}

const snapshot: SourceSnapshot = {
  snapshotId: "snap-1",
  source: { sourceId: "src-1", sourceType: "manufacturer-documentation", publisher: "Example Vendor" },
  retrievedAt: NOW.toISOString(),
  retrievalMethod: "direct-fetch",
  provenance,
};

const observation: Observation = {
  observationId: "obs-1",
  snapshotId: "snap-1",
  form: "structured-value",
  content: "12GB",
  observedAt: NOW.toISOString(),
  provenance,
};

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

function contractFor(claims: AtomicClaim[], states: Record<string, EpistemicState>, links: ClaimEvidenceLink[] = [link()]) {
  return buildResearchCreativeContract({
    questionId: "q-1",
    claims,
    confidence: new Map(Object.entries(states).map(([id, state]) => [id, confidence(state)])),
    links,
    observations: [observation],
    snapshots: [snapshot],
    now: NOW,
  });
}

describe("safe and unsafe are decided by evidence, not by wanting", () => {
  it("lets a low-risk claim through once it reaches likely", () => {
    const contract = contractFor([claim()], { "claim-1": "likely" });
    expect(contract.safeClaims.map((entry) => entry.claimId)).toEqual(["claim-1"]);
  });

  it("refuses even a low-risk claim at plausible, because plausible means nothing good backs it", () => {
    const contract = contractFor([claim()], { "claim-1": "plausible" });
    expect(contract.safeClaims).toEqual([]);
    expect(contract.unsafeClaims[0].reason).toMatch(/needs likely/);
  });

  it("refuses a high-risk claim at the evidence level that passes a low-risk one", () => {
    const contract = contractFor([claim({ kind: "current-price", risk: "high" })], { "claim-1": "likely" });
    expect(contract.safeClaims).toEqual([]);
    expect(contract.unsafeClaims[0].reason).toMatch(/needs strongly-supported/);
  });

  it("refuses a claim with no evidence rather than treating silence as permission", () => {
    const contract = contractFor([claim()], { "claim-1": "unknown" }, []);
    expect(contract.safeClaims).toEqual([]);
    expect(contract.unsafeClaims[0].state).toBe("unknown");
    expect(contract.openQuestions.join(" ")).toContain("Unanswered");
  });

  it("refuses stale evidence outright, separately from the strength comparison", () => {
    const contract = contractFor([claim()], { "claim-1": "stale" });
    expect(contract.safeClaims).toEqual([]);
  });

  it("routes a disputed claim to its own bucket rather than picking a side", () => {
    const contract = contractFor([claim()], { "claim-1": "disputed" });
    expect(contract.disputedClaims).toHaveLength(1);
    expect(contract.unsafeClaims).toEqual([]);
    expect(contract.openQuestions.join(" ")).toMatch(/Sources disagree/);
  });

  it("tells the caller what would make a refused claim usable", () => {
    const contract = contractFor([claim({ kind: "current-price", risk: "high" })], { "claim-1": "stale" });
    expect(contract.unsafeClaims[0].wouldBecomeSafeIf.length).toBeGreaterThan(0);
  });

  it("caps the overall state at the weakest safe claim", () => {
    const claims = [claim(), claim({ claimId: "claim-2", proposition: "Widget-9000 is quiet" })];
    const contract = contractFor(claims, { "claim-1": "strongly-supported", "claim-2": "likely" });
    expect(contract.safeClaims).toHaveLength(2);
    expect(contract.overallState).toBe("likely");
  });

  it("offers only well-evidenced claims as hook material", () => {
    const claims = [claim(), claim({ claimId: "claim-2", proposition: "Widget-9000 is quiet" })];
    const contract = contractFor(claims, { "claim-1": "strongly-supported", "claim-2": "likely" });
    expect(contract.groundedHookMaterial.map((entry) => entry.claimId)).toEqual(["claim-1"]);
  });
});

describe("required wording travels with the permission", () => {
  it("requires a time bound on a price claim", () => {
    const contract = contractFor([claim({ kind: "current-price", risk: "high" })], { "claim-1": "strongly-supported" });
    expect(contract.safeClaims[0].requiredWording.join(" ")).toMatch(/never imply this is a live price/);
  });

  it("requires the Estimated label on an estimated figure", () => {
    const contract = contractFor([claim({ kind: "performance-estimated", risk: "medium" })], { "claim-1": "likely" });
    expect(contract.safeClaims[0].requiredWording.join(" ")).toMatch(/Estimated FPS/);
  });

  it("forbids first-person measurement language for a third-party benchmark", () => {
    const contract = contractFor([claim({ kind: "performance-measured", risk: "high" })], { "claim-1": "strongly-supported" });
    expect(contract.safeClaims[0].requiredWording.join(" ")).toMatch(/never say "we tested"/);
  });

  it("requires the narrower statement when the evidence was narrower", () => {
    const contract = contractFor([claim()], { "claim-1": "strongly-supported" }, [link({ generalisesBeyondObservation: true })]);
    expect(contract.safeClaims[0].requiredWording.join(" ")).toMatch(/specific configuration observed/);
  });

  it("names the publisher a claim must be attributed to", () => {
    const contract = contractFor([claim()], { "claim-1": "strongly-supported" });
    expect(contract.safeClaims[0].attribution).toBe("Example Vendor");
  });

  it("discloses synthetic evidence as a limitation", () => {
    const contract = contractFor([claim()], { "claim-1": "strongly-supported" });
    expect(contract.limitations.join(" ")).toMatch(/synthetic engineering fixture/i);
  });
});

describe("the evidence gate against a storyboard", () => {
  function storyboard(overrides: Partial<PlatformScriptStoryboard> = {}): PlatformScriptStoryboard {
    return {
      platform: "youtube-shorts",
      targetDurationSeconds: 24,
      title: "Widget-9000 explained",
      narrationStyle: "direct",
      beats: [
        {
          startSecond: 0, endSecond: 6, purpose: "hook",
          narration: "Two parts, same build.", visualDirection: "ui", onScreenText: "TWO PARTS", factDependencies: [],
        },
        {
          startSecond: 6, endSecond: 24, purpose: "cta",
          narration: "Open /compare.", visualDirection: "ui", onScreenText: "OPEN COMPARE", factDependencies: [],
        },
      ],
      finalCta: "Open SpecSmith Compare.",
      factualGuardrails: [],
      ...overrides,
    };
  }

  const unsafeContract = (): ResearchCreativeContract =>
    contractFor([claim({ proposition: "Widget-9000 outruns Widget-8000 by 40 percent", kind: "comparison", risk: "medium" })], { "claim-1": "plausible" });

  it("passes copy that makes no factual claim at all", () => {
    expect(checkScriptAgainstResearch(storyboard(), unsafeContract())).toEqual([]);
  });

  it("does not fire on generic domain words that identify no claim", () => {
    // The specific false positive this guards: a title saying "GPU" must not
    // match every hardware claim ever made.
    const contract = contractFor([claim({ proposition: "Example GPU-A is 40% faster than GPU-B", kind: "comparison", risk: "medium" })], { "claim-1": "plausible" });
    const board = storyboard({ title: "Pick the GPU before SpecSmith reveals the names" });
    expect(checkScriptAgainstResearch(board, contract)).toEqual([]);
  });

  it("hard-fails an unsupported claim asserted in the title", () => {
    const board = storyboard({ title: "Widget-9000 outruns Widget-8000 by 40 percent" });
    const findings = checkScriptAgainstResearch(board, unsafeContract());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("unsupported-factual-claim");
    expect(findings[0].severity).toBe("hard-fail");
    expect(findings[0].location).toBe("title");
  });

  it("allows the same unsupported claim when it is hedged rather than asserted", () => {
    const board = storyboard({ title: "Widget-9000 may outrun Widget-8000 by 40 percent" });
    expect(checkScriptAgainstResearch(board, unsafeContract())).toEqual([]);
  });

  it("hard-fails a disputed claim presented as settled", () => {
    const contract = contractFor([claim({ proposition: "Widget-9000 outruns Widget-8000 by 40 percent", kind: "comparison", risk: "medium" })], { "claim-1": "disputed" });
    const board = storyboard({ title: "Widget-9000 outruns Widget-8000 by 40 percent" });
    const findings = checkScriptAgainstResearch(board, contract);
    expect(findings[0].code).toBe("disputed-presented-as-settled");
  });

  it("hard-fails an estimate stated as a measurement", () => {
    const contract = contractFor(
      [claim({ proposition: "Widget-9000 reaches 90 fps", kind: "performance-estimated", risk: "medium" })],
      { "claim-1": "likely" },
    );
    const board = storyboard({ title: "Widget-9000 reaches 90 fps" });
    const findings = checkScriptAgainstResearch(board, contract);
    expect(findings.map((finding) => finding.code)).toContain("estimate-presented-as-measurement");
  });

  it("accepts the same figure when it is labelled estimated", () => {
    const contract = contractFor(
      [claim({ proposition: "Widget-9000 reaches 90 fps", kind: "performance-estimated", risk: "medium" })],
      { "claim-1": "likely" },
    );
    const board = storyboard({ title: "Widget-9000 reaches an estimated 90 fps" });
    expect(checkScriptAgainstResearch(board, contract).map((finding) => finding.code))
      .not.toContain("estimate-presented-as-measurement");
  });

  it("hard-fails a claim that SpecSmith ran a measurement it did not run", () => {
    const board = storyboard({
      beats: [{
        startSecond: 0, endSecond: 24, purpose: "evidence",
        narration: "We benchmarked both parts ourselves.", visualDirection: "ui", onScreenText: "", factDependencies: [],
      }],
    });
    const findings = checkScriptAgainstResearch(board, unsafeContract());
    expect(findings.map((finding) => finding.code)).toContain("source-result-presented-as-specsmith-measurement");
  });

  it("scans on-screen text as well as narration", () => {
    const board = storyboard({
      beats: [{
        startSecond: 0, endSecond: 24, purpose: "hook",
        narration: "", visualDirection: "ui",
        onScreenText: "Widget-9000 outruns Widget-8000 by 40 percent", factDependencies: [],
      }],
    });
    const findings = checkScriptAgainstResearch(board, unsafeContract());
    expect(findings[0].location).toBe("beat-1.onScreenText");
  });
});
