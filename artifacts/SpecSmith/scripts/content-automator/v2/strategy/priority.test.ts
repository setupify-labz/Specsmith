// Priority and portfolio tests.
//
// The property that matters most: a veto cannot be outscored. Several tests
// below build an opportunity that is excellent on every dimension and then add
// one blocking risk, and assert it is still refused. That asymmetry is the whole
// difference between a strategy system and a ranked list.

import { describe, expect, it } from "vitest";

import {
  assessNovelty,
  detectCannibalization,
  detectDuplication,
  detectSaturation,
  emptyPortfolioHistory,
  subjectFingerprint,
  thesisFingerprint,
  type PortfolioHistory,
} from "./portfolio.ts";
import { anyProducible, assessPriority, rankAssessments } from "./priority.ts";
import { fixturePortfolioHistory } from "./engineeringFixture.ts";
import type { StrategicOpportunity, StrategicRisk } from "./model.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const DAY = 24 * 3_600_000;

function opportunity(overrides: Partial<StrategicOpportunity> = {}): StrategicOpportunity {
  return {
    opportunityId: "opp-1",
    version: 1,
    detectedAt: NOW.toISOString(),
    origins: [],
    type: "evergreen-education",
    pillar: "hardware-terminology",
    problem: "What does VRAM actually do?",
    audienceLevel: "beginner",
    primaryObjective: "educate-new-builders",
    secondaryObjectives: [],
    dependsOnClaimIds: ["claim-1"],
    evidenceState: "strongly-supported",
    whyNow: "evergreen",
    whyNowReason: "Evergreen class.",
    trend: "unknown",
    searchDemand: "unknown",
    competitorCoverage: "unknown",
    communityPain: "unknown",
    productSurface: "builder",
    productReadiness: "shipped",
    bestBefore: null,
    expiresAt: null,
    lastValidatedAt: NOW.toISOString(),
    resourcePosture: "local-free",
    risks: [],
    confidence: {
      opportunityExists: "moderate", timing: "high", audienceNeed: "insufficient",
      mechanism: "low", evidence: "high", creativeFeasibility: "moderate", reasons: [],
    },
    provenance: { synthetic: false, producedBy: "test", producedAt: NOW.toISOString() },
    parentOpportunityId: null,
    ...overrides,
  };
}

const CLEAN = {
  duplication: { verdict: "novel" as const, againstEntryId: null, reason: "novel" },
  saturation: { verdict: "fresh" as const, pillar: "hardware-terminology" as const, recentCount: 0, reason: "fresh" },
  novelty: {
    newTopic: true, newSubjects: true, newAngle: true, newObjective: true,
    newFormat: true, newProductConnection: true, isNovel: true, reason: "new",
  },
  cannibalization: { verdict: "no-overlap" as const, againstEntryId: null, reason: "no overlap" },
  now: NOW,
};

describe("a veto cannot be outscored", () => {
  it("produces a strong, unblocked opportunity", () => {
    const result = assessPriority({ opportunity: opportunity(), ...CLEAN });
    expect(["produce-now", "produce-next"]).toContain(result.action);
    expect(result.vetoes).toEqual([]);
  });

  it.each<[string, StrategicRisk]>([
    ["insufficient evidence", { code: "evidence-insufficient", blocking: true, detail: "thin" }],
    ["stale evidence", { code: "evidence-stale", blocking: true, detail: "old" }],
    ["disputed evidence", { code: "evidence-disputed", blocking: true, detail: "conflicting" }],
    ["synthetic evidence", { code: "synthetic-evidence", blocking: true, detail: "fixture" }],
    ["product not ready", { code: "product-not-ready", blocking: true, detail: "planned" }],
    ["misleading buyer advice", { code: "misleading-buyer-advice", blocking: true, detail: "risky" }],
  ])("refuses an otherwise excellent opportunity carrying %s", (_label, risk) => {
    const result = assessPriority({ opportunity: opportunity({ risks: [risk] }), ...CLEAN });
    expect(["hold", "reject"]).toContain(result.tier);
    expect(result.vetoes.map((veto) => veto.code)).toContain(risk.code);
    expect(anyProducible([result])).toBe(false);
  });

  it("routes an evidence veto to hold and a synthetic veto to reject", () => {
    const evidence = assessPriority({ opportunity: opportunity({ risks: [{ code: "evidence-stale", blocking: true, detail: "old" }] }), ...CLEAN });
    const synthetic = assessPriority({ opportunity: opportunity({ risks: [{ code: "synthetic-evidence", blocking: true, detail: "fixture" }] }), ...CLEAN });
    // Different queues: one is "go and research", the other is "never".
    expect(evidence.action).toBe("hold-for-evidence");
    expect(synthetic.action).toBe("reject-risk");
  });

  it("refuses production on anything weaker than strong evidence, even with no veto", () => {
    const result = assessPriority({ opportunity: opportunity({ evidenceState: "likely" }), ...CLEAN });
    expect(result.action).toBe("hold-for-evidence");
    expect(result.explanation).toMatch(/no opportunity is produced on likely evidence/i);
  });
});

describe("the commercial guard", () => {
  it("refuses an opportunity whose only case is commission", () => {
    const result = assessPriority({
      opportunity: opportunity({
        primaryObjective: "affiliate-intent-traffic",
        evidenceState: "likely",
        communityPain: "unknown",
        searchDemand: "unknown",
      }),
      ...CLEAN,
    });
    expect(result.vetoes.map((veto) => veto.code)).toContain("commercial-bias");
    expect(result.vetoes.find((veto) => veto.code === "commercial-bias")!.detail)
      .toMatch(/Commission is never a sufficient reason to publish/);
  });

  it("allows a commercial objective backed by strong evidence and observed demand", () => {
    const result = assessPriority({
      opportunity: opportunity({
        primaryObjective: "affiliate-intent-traffic",
        evidenceState: "strongly-supported",
        communityPain: "widespread",
      }),
      ...CLEAN,
    });
    expect(result.vetoes.map((veto) => veto.code)).not.toContain("commercial-bias");
  });

  it("always records the commercial tradeoff rather than hiding it in a score", () => {
    const result = assessPriority({
      opportunity: opportunity({ primaryObjective: "affiliate-intent-traffic", evidenceState: "strongly-supported", communityPain: "widespread" }),
      ...CLEAN,
    });
    const tradeoff = result.tradeoffs.find((entry) => entry.majorDownside.includes("disinterested advice"));
    expect(tradeoff?.resolution).toMatch(/never permitted to raise the tier or break a tie/);
  });
});

describe("expiry", () => {
  it("retires a time-sensitive opportunity past its expiry", () => {
    const stale = opportunity({
      type: "breaking-time-sensitive",
      bestBefore: new Date(NOW.getTime() - 10 * DAY).toISOString(),
      expiresAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    });
    const result = assessPriority({ opportunity: stale, ...CLEAN });
    expect(result.action).toBe("retire-stale");
    expect(result.tier).toBe("reject");
  });

  it("leaves an evergreen opportunity unexpired however old", () => {
    const old = opportunity({ detectedAt: new Date(NOW.getTime() - 500 * DAY).toISOString() });
    const result = assessPriority({ opportunity: old, ...CLEAN });
    expect(result.action).not.toBe("retire-stale");
  });
});

describe("unknown is a gap, not a low score", () => {
  it("marks unmeasured dimensions as unmeasured rather than scoring them weak", () => {
    const result = assessPriority({ opportunity: opportunity(), ...CLEAN });
    const demand = result.dimensions.find((dimension) => dimension.name === "audience-demand")!;
    expect(demand.band).toBe("unknown");
    expect(demand.measured).toBe(false);
  });

  it("names the absence of a signal as a reason not to act", () => {
    const result = assessPriority({ opportunity: opportunity(), ...CLEAN });
    expect(result.reasonsNotToAct.join(" ")).toMatch(/No connected signal shows an audience asking/);
  });
});

describe("portfolio duplication and saturation", () => {
  const history = fixturePortfolioHistory(NOW) as unknown as PortfolioHistory;

  it("reports unknown, not novel, when no history exists", () => {
    const result = detectDuplication(opportunity(), ["a", "b"], emptyPortfolioHistory());
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toMatch(/no portfolio history/i);
  });

  it("catches the same thesis reworded", () => {
    const result = detectDuplication(
      opportunity({ problem: "Faster than GPU-B is Example GPU-A", pillar: "gpu-comparisons" }),
      ["example-gpu-a", "example-gpu-b"],
      history,
    );
    // Same content words, different order: one thesis, not two.
    expect(result.verdict).toBe("same-thesis");
  });

  it("still catches a semantic inversion, on subjects rather than thesis", () => {
    // "slower" and "faster" are lexically different, so the thesis fingerprint
    // cannot see that these are the same claim inverted. The subject check
    // catches it anyway, which is why duplication has more than one rule.
    const result = detectDuplication(
      opportunity({ problem: "GPU-B is slower than Example GPU-A", pillar: "gpu-comparisons" }),
      ["example-gpu-a", "example-gpu-b"],
      history,
    );
    expect(result.verdict).toBe("same-subjects");
  });

  it("catches the same subject pair in the same pillar regardless of order", () => {
    const result = detectDuplication(
      opportunity({ problem: "A completely different question entirely", pillar: "gpu-comparisons" }),
      ["example-gpu-b", "example-gpu-a"],
      history,
    );
    expect(result.verdict).toBe("same-subjects");
  });

  it("is not fooled by a product-name typo splitting the pair", () => {
    // Separator and casing differences must not create a second identity.
    expect(subjectFingerprint(["Example GPU-A", "example gpu b"]))
      .toBe(subjectFingerprint(["example-gpu-a", "EXAMPLE-GPU-B"]));
  });

  it("treats a reworded thesis as the same thesis", () => {
    expect(thesisFingerprint("Example GPU-A is faster than GPU-B"))
      .toBe(thesisFingerprint("GPU-B than faster is Example GPU-A"));
  });

  it("reports saturation when a pillar is over-used", () => {
    const result = detectSaturation("gpu-comparisons", history, NOW);
    expect(result.verdict).toBe("saturated");
    expect(result.recentCount).toBeGreaterThan(4);
  });

  it("reports a quiet pillar as fresh", () => {
    expect(detectSaturation("compatibility", history, NOW).verdict).toBe("fresh");
  });

  it("sends a saturated but otherwise sound opportunity to the backlog rather than rejecting it", () => {
    const result = assessPriority({
      opportunity: opportunity({ pillar: "gpu-comparisons" }),
      ...CLEAN,
      saturation: { verdict: "saturated", pillar: "gpu-comparisons", recentCount: 5, reason: "too many lately" },
    });
    expect(result.tier).toBe("backlog");
  });
});

describe("novelty and cannibalization", () => {
  const history = fixturePortfolioHistory(NOW) as unknown as PortfolioHistory;

  it("does not count rewording as novelty", () => {
    const result = assessNovelty(
      opportunity({ problem: "GPU-B than faster is Example GPU-A", pillar: "gpu-comparisons" }),
      { subjectIds: ["example-gpu-a", "example-gpu-b"], angleId: "angle-gpu-comparisons-blind", formatClass: "blind-comparison" },
      history,
    );
    expect(result.newTopic).toBe(false);
    expect(result.newSubjects).toBe(false);
    expect(result.newAngle).toBe(false);
  });

  it("counts a genuinely new angle as novel", () => {
    const result = assessNovelty(
      opportunity({ problem: "GPU-B than faster is Example GPU-A", pillar: "gpu-comparisons" }),
      { subjectIds: ["example-gpu-a", "example-gpu-b"], angleId: "angle-brand-new", formatClass: "walkthrough" },
      history,
    );
    expect(result.isNovel).toBe(true);
    expect(result.reason).toMatch(/angle/);
  });

  it("refuses content that adds little to an existing piece", () => {
    const novelty = assessNovelty(
      opportunity({ pillar: "gpu-comparisons" }),
      { subjectIds: ["example-gpu-a", "example-gpu-b"], angleId: "angle-gpu-comparisons-blind", formatClass: "blind-comparison" },
      history,
    );
    const result = detectCannibalization(opportunity({ pillar: "gpu-comparisons" }), ["example-gpu-a", "example-gpu-b"], history, novelty);
    expect(result.verdict).toBe("adds-little");
  });

  it("allows superseding an existing piece when evidence is stronger and the angle differs", () => {
    const novelty = assessNovelty(
      opportunity({ pillar: "gpu-comparisons", evidenceState: "known" }),
      { subjectIds: ["example-gpu-a", "example-gpu-b"], angleId: "angle-brand-new", formatClass: "walkthrough" },
      history,
    );
    const result = detectCannibalization(
      opportunity({ pillar: "gpu-comparisons", evidenceState: "known" }),
      ["example-gpu-a", "example-gpu-b"], history, novelty,
    );
    expect(result.verdict).toBe("supersedes");
  });
});

describe("ranking", () => {
  it("orders producible opportunities above held and rejected ones", () => {
    const good = assessPriority({ opportunity: opportunity({ opportunityId: "opp-good" }), ...CLEAN });
    const held = assessPriority({
      opportunity: opportunity({ opportunityId: "opp-held", risks: [{ code: "evidence-stale", blocking: true, detail: "old" }] }),
      ...CLEAN,
    });
    const ranked = rankAssessments([held, good]);
    expect(ranked[0].opportunityId).toBe("opp-good");
  });

  it("is deterministic for equivalent opportunities", () => {
    const a = assessPriority({ opportunity: opportunity({ opportunityId: "opp-b" }), ...CLEAN });
    const b = assessPriority({ opportunity: opportunity({ opportunityId: "opp-a" }), ...CLEAN });
    expect(rankAssessments([a, b]).map((entry) => entry.opportunityId)).toEqual(["opp-a", "opp-b"]);
    expect(rankAssessments([b, a]).map((entry) => entry.opportunityId)).toEqual(["opp-a", "opp-b"]);
  });
});
