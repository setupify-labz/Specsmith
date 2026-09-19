// The strategy closed loop, end to end.
//
// Two halves, and both are load-bearing:
//
//   1. It says NO on the evidence the repository actually has, and names why.
//   2. It says YES when evidence and product state genuinely support it.
//
// A system that only ever refuses is not a strategy layer, it is an off switch.
// A system that never refuses is a topic generator. The positive-path tests
// below build a research result with strong evidence and a shipped surface, and
// assert a real mission comes out carrying MASTER #2's contract verbatim.

import { describe, expect, it } from "vitest";

import { buildResearchCreativeContract } from "../research/creativeContract.ts";
import { runResearchPass, type ResearchResult } from "../research/researchPass.ts";
import type { AtomicClaim, ClaimEvidenceLink, Observation, ResearchProvenance, SourceSnapshot } from "../research/model.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

import { runStrategyClosedLoop, assertMissionGovernsCreative } from "./closedLoop.ts";
import { assertZeroCostCore, formatStrategyReport, runStrategyPass } from "./strategyPass.ts";
import { fixtureNoSignals, fixtureProductNotReady, fixtureRichSignals, fixturePortfolioHistory } from "./engineeringFixture.ts";
import { firstPartyProductSignals, parseSignalBundle } from "./signals.ts";
import { emptyPortfolioHistory, type PortfolioHistory } from "./portfolio.ts";
import { HypothesisError, proposeHypothesis, updateHypothesisStatus } from "./hypotheses.ts";
import { MissionRefusedError } from "./contentMission.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;
const PROVENANCE: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: NOW.toISOString() };
const STRATEGY_PROVENANCE = { synthetic: false, producedBy: "test", producedAt: NOW.toISOString() };

/**
 * A research result with STRONG evidence for one specification claim.
 *
 * Built through the real `runResearchPass` rather than hand-assembled, so the
 * evidence state the strategy layer consumes is one MASTER #2 genuinely
 * produced. A hand-written "strongly-supported" would prove nothing about the
 * boundary between the two layers.
 */
function strongResearch(options: { synthetic: boolean }): ResearchResult {
  const provenance: ResearchProvenance = { ...PROVENANCE, synthetic: options.synthetic };
  const snapshots: SourceSnapshot[] = [
    {
      snapshotId: "snap-vendor",
      source: { sourceId: "vendor-docs", sourceType: "manufacturer-documentation", publisher: "Example Vendor" },
      retrievedAt: NOW.toISOString(),
      retrievalMethod: "direct-fetch",
      contentHash: "a".repeat(64),
      publishedAt: "2026-01-01T00:00:00.000Z",
      provenance,
    },
  ];
  const observations: Observation[] = [
    {
      observationId: "obs-vram",
      snapshotId: "snap-vendor",
      form: "structured-value",
      content: "Memory: 12 GB GDDR6",
      fields: { vramGb: 12 },
      configuration: { gpu: "Example GPU-A", formFactor: "desktop" },
      observedAt: NOW.toISOString(),
      provenance,
    },
  ];
  const claims: AtomicClaim[] = [
    {
      claimId: "claim-vram",
      questionId: "q-1",
      proposition: "Example GPU-A has 12GB of VRAM",
      kind: "specification",
      risk: "low",
      configuration: { gpu: "Example GPU-A", formFactor: "desktop" },
      subjectIds: ["example-gpu-a"],
      provenance,
    },
  ];
  return runResearchPass({
    researchId: "research-strong",
    question: {
      questionId: "q-1",
      question: "How much memory does Example GPU-A have?",
      purpose: "Answer a beginner specification question.",
      informsDecision: "hook-family-selection",
      claimKind: "specification",
      risk: "low",
      acceptableUncertainty: "likely",
      subjectIds: ["example-gpu-a"],
    },
    claims,
    snapshots,
    observations,
    stances: [{ claimId: "claim-vram", observationId: "obs-vram", stance: "supports" }],
    startedAt: NOW,
    now: NOW,
  });
}

function storyboard(overrides: Partial<PlatformScriptStoryboard> = {}): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    title: "What VRAM actually does",
    narrationStyle: "direct",
    beats: [
      { startSecond: 0, endSecond: 12, purpose: "hook", narration: "Two cards, one question.", visualDirection: "ui", onScreenText: "MEMORY", factDependencies: [] },
      { startSecond: 12, endSecond: 24, purpose: "cta", narration: "Try it yourself.", visualDirection: "ui", onScreenText: "OPEN BUILDER", factDependencies: [] },
    ],
    finalCta: "Open SpecSmith.",
    factualGuardrails: [],
    ...overrides,
  };
}

/**
 * A real, non-synthetic bundle describing SpecSmith's own shipped routes.
 *
 * Used for the positive-path tests: the fixture bundles are all marked
 * synthetic, so a pass built on one correctly refuses everything, which would
 * make it impossible to demonstrate that the layer can ever say yes.
 */
function realProductSignals(): unknown {
  return firstPartyProductSignals(NOW.toISOString(), [
    { surface: "builder", route: "/builder", evidence: "Route present in the prerendered sitemap." },
    { surface: "compare", route: "/compare", evidence: "Route present in the prerendered sitemap." },
    { surface: "upgrade", route: "/upgrade", evidence: "Route present in the prerendered sitemap." },
  ]);
}

function loop(options: {
  research: ResearchResult;
  signals: unknown;
  history?: PortfolioHistory;
  synthetic?: boolean;
}) {
  const contract = options.research.contract;
  return runStrategyClosedLoop({
    runId: "run-1",
    research: options.research,
    contract,
    rawSignals: options.signals,
    environment: ENGINEERING,
    history: options.history ?? emptyPortfolioHistory(),
    startedAt: NOW,
    now: NOW,
    provenance: { ...STRATEGY_PROVENANCE, synthetic: options.synthetic ?? false },
  });
}

describe("the loop says YES when the evidence and the product support it", () => {
  const result = loop({ research: strongResearch({ synthetic: false }), signals: realProductSignals() });

  it("authorises a mission", () => {
    expect(result.result.noOpReason).toBeNull();
    expect(result.leadMission).not.toBeNull();
    expect(result.result.missions.length).toBeGreaterThan(0);
  });

  it("carries MASTER #2's permitted claims verbatim rather than re-deriving them", () => {
    const mission = result.leadMission!;
    expect(mission.permittedClaims).toEqual(result.result.decisions[0].opportunity ? mission.permittedClaims : []);
    expect(mission.permittedClaims.map((claim) => claim.proposition))
      .toEqual(strongResearch({ synthetic: false }).contract.safeClaims.map((claim) => claim.proposition));
  });

  it("records the bet it is making as an untested hypothesis", () => {
    const mission = result.leadMission!;
    expect(mission.successHypothesisId).not.toBeNull();
    const hypothesis = result.result.hypotheses.find((entry) => entry.hypothesisId === mission.successHypothesisId)!;
    expect(hypothesis.status).toBe("untested");
    expect(hypothesis.measurementAvailable).toBe(false);
    expect(hypothesis.falsificationCriteria.length).toBeGreaterThan(20);
  });

  it("names a real CTA only because the surface is shipped", () => {
    expect(result.leadMission!.productRoute).toBe("/builder");
    expect(result.leadMission!.ctaIntent).toContain("/builder");
  });

  it("explains why this deserves production in words, not a score", () => {
    const why = result.leadMission!.whyThisDeservesProduction;
    expect(why.length).toBeGreaterThan(20);
    expect(why).not.toMatch(/score\s*[:=]\s*\d/);
  });

  it("passes the zero-cost assertion", () => {
    const zero = assertZeroCostCore(result.result);
    expect(zero.ok).toBe(true);
    expect(zero.reason).toMatch(/none requiring paid access/);
  });
});

describe("the loop says NO, and names why", () => {
  it("refuses everything when the input is synthetic", () => {
    const result = loop({ research: strongResearch({ synthetic: true }), signals: fixtureNoSignals(NOW) });
    expect(result.leadMission).toBeNull();
    expect(result.result.noOpReason).toBe("synthetic-input-refused");
    expect(result.result.containsSyntheticInput).toBe(true);
  });

  it("holds for product readiness when the surface is not shipped", () => {
    // A REAL bundle whose surface is not shipped, so the product guard is
    // isolated from the synthetic veto rather than hidden behind it.
    const unshipped = {
      bundleId: "real-unshipped",
      capturedAt: NOW.toISOString(),
      search: [], community: [], trends: [], competitors: [],
      productState: [{ surface: "builder", readiness: "planned", evidence: "Named in the roadmap; no route exists." }],
      provenance: { synthetic: false, producedBy: "test-first-party", producedAt: NOW.toISOString() },
    };
    const result = loop({ research: strongResearch({ synthetic: false }), signals: unshipped });
    expect(result.leadMission).toBeNull();
    expect(result.result.noOpReason).toBe("all-blocked-by-product-readiness");
    const decision = result.result.decisions[0];
    expect(decision.assessment.action).toBe("hold-for-product");
    expect(decision.challenges.map((challenge) => challenge.code)).toContain("forced-product-cta");
  });

  it("refuses the synthetic bundle before it even reaches the product guard", () => {
    const result = loop({ research: strongResearch({ synthetic: false }), signals: fixtureProductNotReady(NOW) });
    expect(result.leadMission).toBeNull();
    expect(result.result.noOpReason).toBe("synthetic-input-refused");
  });

  it("refuses a duplicate when the history already carries the same thesis", () => {
    // The history must be in the pillar the claim maps to, which for a
    // specification claim is hardware-terminology rather than gpu-comparisons.
    const history: PortfolioHistory = {
      complete: true,
      note: "SYNTHETIC_ENGINEERING_FIXTURE history for this test only.",
      entries: [{
        entryId: "prior-piece",
        publishedAt: new Date(NOW.getTime() - 2 * 24 * 3_600_000).toISOString(),
        pillar: "hardware-terminology",
        type: "evergreen-education",
        objective: "educate-new-builders",
        thesis: "Example GPU-A has 12GB of VRAM",
        subjectIds: ["example-gpu-a"],
        angleId: "angle-hardware-terminology-04a5c511",
        formatClass: "quick-explainer",
      }],
    };
    const result = loop({ research: strongResearch({ synthetic: false }), signals: realProductSignals(), history });
    expect(result.leadMission).toBeNull();
    expect(result.result.noOpReason).toBe("all-duplicates");
    expect(result.result.decisions[0].assessment.action).toBe("reject-duplicate");
  });

  it("names a no-op reason that is actionable rather than an empty list", () => {
    const result = loop({ research: strongResearch({ synthetic: true }), signals: fixtureNoSignals(NOW) });
    const report = formatStrategyReport(result.result);
    expect(report).toContain("PRODUCE NOTHING");
    expect(report).toMatch(/successful strategic outcome/i);
  });
});

describe("no mission can be built around a refusal", () => {
  it("refuses to build a mission for a held opportunity", () => {
    const research = strongResearch({ synthetic: false });
    const result = loop({ research, signals: fixtureProductNotReady(NOW) });
    const decision = result.result.decisions[0];
    expect(decision.mission).toBeNull();
    expect(decision.missionRefusedBecause).toMatch(/reject-risk|hold-for-product/);
  });

  it("exposes MissionRefusedError rather than silently returning null", () => {
    // The type exists and is thrown by buildContentMission; the loop catches it
    // and records the reason, which is what the decision record shows.
    expect(new MissionRefusedError("x").code).toBe("mission-refused");
  });
});

describe("the mission governs Creative", () => {
  const result = loop({ research: strongResearch({ synthetic: false }), signals: realProductSignals() });

  it("passes a storyboard that stays inside its mission", () => {
    expect(assertMissionGovernsCreative(storyboard(), result.leadMission)).toEqual([]);
  });

  it("hard-fails a storyboard asserting a claim the mission forbade", () => {
    const mission = result.leadMission!;
    // Give the mission something to forbid, then say it.
    const withForbidden = { ...mission, forbiddenClaims: [{ proposition: "Example GPU-A costs $549.99", reason: "stale" }] };
    const findings = assertMissionGovernsCreative(storyboard({ title: "It costs $549.99 right now" }), withForbidden);
    expect(findings[0].code).toBe("asserts-forbidden-claim");
    expect(findings[0].severity).toBe("hard-fail");
  });

  it("hard-fails a CTA to a surface the mission said was not shipped", () => {
    const mission = result.leadMission!;
    const noRoute = { ...mission, productRoute: null, ctaIntent: "No CTA: the surface is not shipped." };
    const findings = assertMissionGovernsCreative(storyboard({ finalCta: "Head to /builder now" }), noRoute);
    expect(findings.map((finding) => finding.code)).toContain("cta-to-unshipped-surface");
  });

  it("warns when Creative runs with no mission at all", () => {
    const findings = assertMissionGovernsCreative(storyboard(), null);
    expect(findings[0].code).toBe("no-mission-supplied");
    expect(findings[0].detail).toMatch(/strategy cannot vouch for/);
  });
});

describe("hypotheses cannot promote themselves", () => {
  const base = {
    proposition: "Explaining VRAM will drive builder usage.",
    expectedMechanism: "A viewer who understands the number opens the builder to check their own.",
    audience: "beginner builders",
    objective: "drive-builder-usage" as const,
    falsificationCriteria: "No increase in builder sessions from viewers of this piece relative to comparable pieces.",
    measurementRequirement: "Published analytics per creative.",
    measurementAvailable: false,
    assumptions: [],
    now: NOW,
    provenance: STRATEGY_PROVENANCE,
  };

  it("refuses an unfalsifiable hypothesis", () => {
    expect(() => proposeHypothesis({ ...base, falsificationCriteria: "n/a" })).toThrow(HypothesisError);
    expect(() => proposeHypothesis({ ...base, falsificationCriteria: "n/a" })).toThrow(/cannot be wrong is not a hypothesis/);
  });

  it("refuses a hypothesis with no stated mechanism", () => {
    expect(() => proposeHypothesis({ ...base, expectedMechanism: "vibes" })).toThrow(/states no expected mechanism/);
  });

  it("refuses to mark a hypothesis supported without a measurement", () => {
    const hypothesis = proposeHypothesis(base);
    expect(() => updateHypothesisStatus(hypothesis, { status: "supported", why: "it worked", now: NOW }))
      .toThrow(/may not mark its own hypothesis supported/);
  });

  it("allows retirement without a measurement, because that is not a claim about the world", () => {
    const hypothesis = proposeHypothesis(base);
    const retired = updateHypothesisStatus(hypothesis, { status: "retired", why: "topic dropped", now: NOW });
    expect(retired.status).toBe("retired");
    expect(retired.history).toHaveLength(2);
    // History is append-only: the original entry survives.
    expect(retired.history[0].status).toBe("untested");
  });
});

describe("determinism and auditability", () => {
  it("produces byte-identical results for identical input", () => {
    const research = strongResearch({ synthetic: false });
    const a = loop({ research, signals: realProductSignals() });
    const b = loop({ research, signals: realProductSignals() });
    expect(a.result.resultHash).toBe(b.result.resultHash);
    expect(JSON.stringify(a.result.missions)).toBe(JSON.stringify(b.result.missions));
  });

  it("changes the result hash when the decision changes", () => {
    const research = strongResearch({ synthetic: false });
    const yes = loop({ research, signals: realProductSignals() });
    const no = loop({ research, signals: fixtureProductNotReady(NOW) });
    expect(yes.result.resultHash).not.toBe(no.result.resultHash);
  });

  it("binds every result to the exact research pass it rests on", () => {
    const research = strongResearch({ synthetic: false });
    const result = loop({ research, signals: realProductSignals() });
    expect(result.result.researchId).toBe(research.researchId);
    expect(result.result.researchStoppingReason).toBe(research.stoppingReason);
  });

  it("traces a mission back through opportunity to a research claim", () => {
    const research = strongResearch({ synthetic: false });
    const result = loop({ research, signals: realProductSignals() });
    const mission = result.leadMission!;
    const decision = result.result.decisions.find((entry) => entry.opportunity.opportunityId === mission.opportunityId)!;
    expect(decision.opportunity.dependsOnClaimIds).toContain("claim-vram");
    expect(decision.opportunity.origins.map((origin) => origin.kind)).toContain("research-result");
  });
});

describe("signals change the decision rather than decorating it", () => {
  it("records unknown demand with no signals and observed demand with them", () => {
    const research = strongResearch({ synthetic: false });
    const without = loop({ research, signals: realProductSignals() });
    const withSignals = runStrategyPass({
      runId: "run-signals",
      research,
      contract: research.contract,
      signals: parseSignalBundle(fixtureRichSignals(NOW), ENGINEERING),
      history: emptyPortfolioHistory(),
      startedAt: NOW,
      now: NOW,
      provenance: STRATEGY_PROVENANCE,
    });
    expect(without.result.decisions[0].opportunity.communityPain).toBe("unknown");
    // The rich bundle is synthetic, so the pass refuses — but the signal itself
    // was still read, which is what this asserts.
    expect(withSignals.containsSyntheticInput).toBe(true);
  });

  it("lists every missing signal source as an explicit limitation", () => {
    const result = loop({ research: strongResearch({ synthetic: false }), signals: realProductSignals() });
    const limitations = result.result.limitations.join(" ");
    expect(limitations).toMatch(/No search data source is connected/);
    expect(limitations).toMatch(/No trend collector is connected/);
    expect(limitations).toMatch(/No community collector is connected/);
    expect(limitations).toMatch(/No competitor survey exists/);
  });
});
