// MASTER #4 — Delivery pass, fit, brief and cross-platform tests.
//
// Exercises the whole chain on the engineering fixture:
//
//   RESEARCH_RESULT -> CONTENT_MISSION -> AUDIENCE -> PLATFORM -> FIT -> BRIEF
//
// and then attacks it: force a refusal, remove the product route, hand it a
// synthetic bundle in production, run it twice for determinism.

import { describe, expect, it } from "vitest";

import { runDeliveryPass, assertZeroCostDelivery, formatDeliveryReport } from "./deliveryPass.ts";
import { buildCreativeHandoff, assertCreativeHonoursBrief, DEFERRED_TO_LATER_MASTERS } from "./closedLoop.ts";
import { extractTruthInvariant } from "./invariants.ts";
import { BriefRefusedError, buildPlatformBrief, briefOutwardText } from "./brief.ts";
import { assessAudiencePlatformFit, requiredHonestySeconds } from "./fit.ts";
import { buildAudienceProfile, assessAudienceFit } from "../audience/profile.ts";
import { parseAudienceSignalBundle, unavailableAudienceSignals } from "../audience/signals.ts";
import { baselinePlatformSnapshot, postingTimeFor, trendFor, REGISTRY_REVIEWED_AT } from "../platform/registry.ts";
import { missionFixture, researchFixture, contractFixture } from "./testFixtures.ts";
import { fixtureNoAudienceSignals, fixtureObservedAudience, assertUnmistakablySynthetic } from "./engineeringFixture.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;

const research = researchFixture();
const contract = contractFixture();

function pass(overrides: Partial<Parameters<typeof runDeliveryPass>[0]> = {}) {
  return runDeliveryPass({
    runId: "delivery-test-1",
    strategyRunId: "strategy-test-1",
    mission: missionFixture(),
    contract,
    research,
    audienceSignals: parseAudienceSignalBundle(fixtureNoAudienceSignals(NOW), ENGINEERING),
    startedAt: NOW,
    now: NOW,
    producedBy: "delivery-test",
    creativeId: "creative-fixture-1",
    ...overrides,
  });
}

describe("the full chain runs and produces briefs", () => {
  const result = pass();

  it("produces one brief per platform that can carry the truth", () => {
    expect(result.briefs.length).toBe(3);
    expect(result.briefs.map((brief) => brief.platform).sort()).toEqual(["instagram-reels", "tiktok", "youtube-shorts"]);
  });

  it("records every identity an auditor needs to reconstruct the decision", () => {
    const brief = result.briefs[0];
    expect(brief.missionId).toBe("mission-fixture-1");
    expect(brief.researchQuestionId).toBe("question-vram-fps");
    expect(brief.strategyRunId).toBe("strategy-test-1");
    expect(brief.audienceProfileId).toBe("audience-mission-fixture-1");
    expect(brief.platformSnapshotId).toContain("platform-");
    expect(brief.platformSnapshotRevision).toBeGreaterThanOrEqual(1);
  });

  it("breaches no invariant", () => {
    expect(result.invariantFindings.filter((finding) => finding.severity === "hard-fail")).toEqual([]);
  });

  it("carries claims by reference, identically across every platform", () => {
    const claimSets = result.briefs.map((brief) => brief.allowedClaims.map((claim) => claim.claimId).join(","));
    expect(new Set(claimSets).size).toBe(1);
    const wordingSets = result.briefs.map((brief) => brief.requiredWording.join("|"));
    expect(new Set(wordingSets).size).toBe(1);
  });

  it("gives every platform the same objective and thesis", () => {
    expect(new Set(result.briefs.map((brief) => brief.objective)).size).toBe(1);
    expect(new Set(result.briefs.map((brief) => brief.thesis)).size).toBe(1);
  });

  it("is deterministic: the same inputs produce the same hash", () => {
    expect(pass().resultHash).toBe(result.resultHash);
  });

  it("requires no paid access", () => {
    const zeroCost = assertZeroCostDelivery(result);
    expect(zeroCost.ok).toBe(true);
    expect(zeroCost.reason).toMatch(/no provider call of any kind/);
  });

  it("renders a report that explains itself", () => {
    const report = formatDeliveryReport(result);
    expect(report).toContain("AUDIENCE");
    expect(report).toContain("demographics: unknown");
    expect(report).toContain("TRUTH INVARIANTS");
    expect(report).toContain("posting time: unknown");
  });
});

describe("audience stays unknown without a collector", () => {
  const result = pass();
  const profile = result.audienceProfile!;

  it("does not invent a persona from an empty bundle", () => {
    expect(profile.job.state).toBe("unknown");
    expect(profile.intent.state).toBe("unknown");
    expect(profile.readiness.state).toBe("unknown");
    expect(profile.objections.state).toBe("unknown");
  });

  it("treats the mission's target as a decision, not an observation", () => {
    expect(profile.expertise.state).toBe("known");
    expect(profile.expertise.basis).toMatch(/not an observation that such an audience asked for it/);
  });

  it("keeps demographics unknown", () => {
    expect(profile.demographics.age.value).toBeNull();
    expect(profile.demographics.location.state).toBe("unknown");
  });

  it("reports audience fit as weakly grounded, because no job or intent was observed", () => {
    // Without observed language there is no basis even for a segment, so the
    // honest verdict is that WHO this serves is unestablished — not that the
    // content is wrong.
    expect(result.audienceFit?.verdict).toBe("weakly-grounded");
    expect(result.audienceFit?.reasons.join(" ")).toMatch(/who it serves is genuinely unestablished/);
  });

  it("names the missing collectors as limitations", () => {
    expect(profile.limitations.join(" ")).toMatch(/No audience collector is connected/);
  });

  it("asserts no misconception without an approved misconception-exists claim", () => {
    expect(profile.confusion.evidencedMisconceptions.state).toBe("unknown");
    expect(profile.confusion.evidencedMisconceptions.basis).toMatch(/no misconception may be attributed/);
  });
});

describe("observed audience signals actually change the profile", () => {
  const result = pass({ audienceSignals: parseAudienceSignalBundle(fixtureObservedAudience(NOW), ENGINEERING) });
  const profile = result.audienceProfile!;

  it("reaches logically-grounded once a job and intent can be derived", () => {
    expect(result.audienceFit?.verdict).toBe("logically-grounded");
    expect(result.audienceFit?.reasons.join(" ")).toMatch(/not evidence that this audience asked for it/);
  });

  it("reaches the observed state when a collector really saw it", () => {
    expect(profile.expertise.state).toBe("observed");
    expect(profile.expertise.value).toBe("beginner");
    expect(profile.expertise.signalIds.length).toBeGreaterThan(0);
  });

  it("infers intent from observed phrasing as an inference, not an observation", () => {
    expect(profile.intent.state).toBe("supported-inference");
  });

  it("still keeps demographics unknown even with signals present", () => {
    expect(profile.demographics.age.state).toBe("unknown");
  });
});

describe("audience hypotheses are declared, not hidden in constants", () => {
  const result = pass();

  it("emits untested hypotheses with falsification conditions", () => {
    expect(result.hypotheses.length).toBeGreaterThan(0);
    for (const hypothesis of result.hypotheses) {
      expect(hypothesis.status).toBe("untested");
      expect(hypothesis.falsificationCondition.length).toBeGreaterThan(12);
      expect(hypothesis.measurementRef).toBeNull();
    }
  });

  it("types the pacing guidance as a hypothesis rather than an optimum", () => {
    const fit = result.outcomes[0].fit;
    expect(fit.pacing.isHypothesis).toBe(true);
    expect(fit.pacing.basis).toMatch(/not from any measured optimum/);
  });

  it("carries the hypotheses into every brief's uncertainty section", () => {
    expect(result.briefs[0].uncertainty.audienceHypotheses.length).toBe(result.hypotheses.length);
  });
});

describe("no posting time, no trend, no analytics", () => {
  const result = pass();

  it("reports posting time as unknown on every platform", () => {
    for (const outcome of result.outcomes) {
      expect(outcome.fit.postingTime.state).toBe("unknown");
    }
  });

  it("reports trend as unknown on every platform", () => {
    for (const outcome of result.outcomes) {
      expect(outcome.fit.trend.state).toBe("unknown");
    }
  });

  it("does not let posting time influence the verdict", () => {
    expect(result.outcomes[0].fit.reasons.join(" ")).toMatch(/cannot make a platform better or worse/);
  });

  it("names the absence of analytics as a platform risk", () => {
    expect(result.outcomes[0].fit.platformRisks.join(" ")).toMatch(/No analytics are available/);
  });
});

describe("metadata is inside the evidence boundary", () => {
  const result = pass();

  it("labels every tag as generic-descriptive, claiming no popularity", () => {
    for (const brief of result.briefs) {
      for (const tag of brief.metadata.tags) {
        expect(tag.kind).toBe("generic-descriptive");
        expect(tag.factId).toBeNull();
        expect(tag.basis).toMatch(/No popularity, reach or trend status is claimed/);
      }
    }
  });

  it("puts the required caveat before the CTA so truncation loses marketing", () => {
    const description = result.briefs[0].metadata.description;
    const disclosureAt = description.indexOf("estimated");
    const ctaAt = description.indexOf("/compare");
    expect(disclosureAt).toBeGreaterThanOrEqual(0);
    expect(ctaAt).toBeGreaterThan(disclosureAt);
  });

  it("passes the truth gate over its own outward text", () => {
    for (const brief of result.briefs) {
      const texts = briefOutwardText(brief);
      expect(texts.length).toBeGreaterThan(0);
    }
  });

  it("refuses to emit a brief whose metadata would breach the boundary", () => {
    // A mission whose central question IS the forbidden claim would produce a
    // title asserting it. The brief must not be emitted at all.
    const hostile = missionFixture({ centralQuestion: "More VRAM does not matter for gaming performance" });
    const invariant = extractTruthInvariant(hostile, contract, research);
    const profile = buildAudienceProfile({
      mission: hostile, contract, research,
      signals: unavailableAudienceSignals(NOW.toISOString()),
      hypotheses: [], now: NOW, producedBy: "test",
    });
    const snapshot = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const fit = assessAudiencePlatformFit({
      mission: hostile, profile, audienceFit: assessAudienceFit(profile, hostile), invariant, snapshot,
      postingTime: postingTimeFor("youtube-shorts"), trend: trendFor("youtube-shorts"), now: NOW,
    });

    expect(() => buildPlatformBrief({
      mission: hostile, invariant, profile, fit, snapshot, hypotheses: [],
      strategyRunId: "s", creativeId: "c", now: NOW, producedBy: "test",
    })).toThrow(BriefRefusedError);
  });
});

describe("CTA follows product readiness, never the platform", () => {
  it("includes a CTA when the mission carries a shipped route", () => {
    const result = pass();
    expect(result.briefs.every((brief) => brief.execution.ctaTreatment.include)).toBe(true);
  });

  it("produces no CTA when the mission has no shipped route", () => {
    const result = pass({ mission: missionFixture({ productRoute: null, productSurface: null }) });
    for (const brief of result.briefs) {
      expect(brief.execution.ctaTreatment.include).toBe(false);
      expect(brief.execution.ctaTreatment.reason).toMatch(/point at something that does not exist/);
    }
  });

  it("adapts CTA placement to whether links are actually clickable", () => {
    const result = pass();
    const shorts = result.briefs.find((brief) => brief.platform === "youtube-shorts")!;
    const tiktok = result.briefs.find((brief) => brief.platform === "tiktok")!;
    expect(shorts.execution.ctaTreatment.treatment).toMatch(/description, where it is clickable/);
    expect(tiktok.execution.ctaTreatment.treatment).toMatch(/profile/);
  });
});

describe("accessibility is non-negotiable", () => {
  const result = pass();

  it("marks every accessibility requirement as non-negotiable", () => {
    for (const requirement of result.outcomes[0].fit.accessibility) {
      expect(requirement.negotiable).toBe(false);
    }
  });

  it("requires audio-independent comprehension on every platform", () => {
    for (const outcome of result.outcomes) {
      expect(outcome.fit.accessibility.map((r) => r.code)).toContain("audio-independent-comprehension");
    }
  });

  it("uses a conservative safe area because none is measured", () => {
    expect(result.outcomes[0].fit.accessibility.map((r) => r.code)).toContain("conservative-safe-area");
  });

  it("carries the requirements into the handoff as non-negotiable", () => {
    const handoff = buildCreativeHandoff(result.briefs[0], NOW);
    expect(handoff.nonNegotiable.join(" ")).toMatch(/Accessibility \(non-negotiable\)/);
  });
});

describe("a platform can be refused", () => {
  it("refuses when the required disclosure takes more than half the format", () => {
    // A mission whose required wording is enormous cannot be delivered honestly
    // in short form. Refusing is correct; trimming the caveat is not.
    const wordy = Array.from({ length: 120 }, (_, index) => `mandatory-caveat-token-${index}`);
    const heavy = missionFixture({ requiredWording: wordy });
    const result = pass({ mission: heavy });

    expect(result.briefs).toHaveLength(0);
    expect(result.outcomes.every((outcome) => outcome.fit.verdict === "refuse")).toBe(true);
    expect(result.outcomes[0].fit.refusals.map((r) => r.code)).toContain("evidence-cannot-fit-honestly");
    expect(result.outcomes[0].refusedBecause).toMatch(/There is no honest cut here/);
  });

  it("escalates to strategy when no platform can carry the mission", () => {
    const wordy = Array.from({ length: 120 }, (_, index) => `mandatory-caveat-token-${index}`);
    const result = pass({ mission: missionFixture({ requiredWording: wordy }) });
    expect(result.escalations.map((escalation) => escalation.code)).toContain("no-platform-can-carry-mission");
    expect(result.escalations[0].whatStrategyMustDecide).toMatch(/will not produce a degraded version/);
  });

  it("computes how long the honesty actually takes", () => {
    const invariant = extractTruthInvariant(missionFixture(), contract, research);
    expect(requiredHonestySeconds(invariant)).toBeGreaterThan(0);
  });
});

describe("no mission means no briefs, and that is a success", () => {
  const result = pass({ mission: null });

  it("produces nothing and says why", () => {
    expect(result.briefs).toEqual([]);
    expect(result.noOpReason).toBe("no-mission-authorised");
    expect(result.limitations.join(" ")).toMatch(/strategy explicitly declined to approve/);
  });

  it("builds no audience profile for a mission that does not exist", () => {
    expect(result.audienceProfile).toBeNull();
    expect(result.invariant).toBeNull();
  });

  it("is still deterministic", () => {
    expect(pass({ mission: null }).resultHash).toBe(result.resultHash);
  });
});

describe("the cross-platform plan is honest about sameness", () => {
  const result = pass();
  const plan = result.packagePlan!;

  it("states the core truth once, shared by every version", () => {
    expect(plan.coreInvariant.thesis).toBe(missionFixture().angle.thesis);
    expect(plan.coreInvariant.requiredWording).toContain("estimated");
  });

  it("justifies every difference with an established platform fact", () => {
    for (const difference of plan.differences) {
      expect(difference.justifiedByFactId).not.toBe("");
      expect(difference.justification.length).toBeGreaterThan(20);
    }
  });

  it("never claims a difference driven by ranking or algorithm", () => {
    const text = JSON.stringify(plan).toLowerCase();
    expect(text).not.toContain("algorithm");
    expect(text).not.toContain("the platform rewards");
  });

  it("records that no posting time and no trend informed the plan", () => {
    expect(plan.limitations.join(" ")).toMatch(/No posting time is recommended/);
    expect(plan.limitations.join(" ")).toMatch(/nothing may be described as trending/);
  });
});

describe("the MASTER #1 handoff", () => {
  const result = pass();
  const brief = result.briefs[0];

  it("restates the invariants at the top level", () => {
    const handoff = buildCreativeHandoff(brief, NOW);
    expect(handoff.nonNegotiable.join(" ")).toContain("Objective is fixed");
    expect(handoff.nonNegotiable.join(" ")).toContain("Required wording");
    expect(handoff.nonNegotiable.join(" ")).toContain("Forbidden claim");
  });

  it("catches a creative that drops the estimate label", () => {
    const storyboard = storyboardFixture("Example GPU-A is 15% faster.", "15% faster");
    const findings = assertCreativeHonoursBrief(storyboard, brief, result.invariant!, contract);
    expect(findings.map((finding) => finding.code)).toContain("required-wording-dropped");
  });

  it("accepts a creative that honours the brief", () => {
    const storyboard = storyboardFixture(
      "SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.",
      "estimated, at 1440p high",
    );
    const findings = assertCreativeHonoursBrief(storyboard, brief, result.invariant!, contract);
    expect(findings.filter((finding) => finding.severity === "hard-fail")).toEqual([]);
  });

  it("catches a storyboard with no on-screen text at all", () => {
    const storyboard = storyboardFixture(
      "SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.",
      "",
    );
    const findings = assertCreativeHonoursBrief(storyboard, brief, result.invariant!, contract);
    expect(findings.map((finding) => finding.code)).toContain("no-audio-independent-layer");
  });

  it("still surfaces MASTER #2 findings rather than filtering them", () => {
    // Upstream conservatism, documented rather than worked around: MASTER #2's
    // strict gate flags any line sharing two distinctive words with an unsafe
    // claim, and a product name supplies both. A contract whose unsafe claim
    // names the SAME product as the approved one therefore blocks every script
    // about that product. MASTER #4 passes those findings straight through and
    // has no mechanism to suppress them.
    const sameSubjectContract = {
      ...contract,
      unsafeClaims: [{
        claimId: "claim-unsafe-same-subject",
        proposition: "Example GPU-A will stay fast for the next five years",
        state: "unknown" as const,
        reason: "Nothing establishes future performance.",
      }],
    };
    const storyboard = storyboardFixture(
      "SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.",
      "estimated, at 1440p high",
    );
    const findings = assertCreativeHonoursBrief(storyboard, brief, result.invariant!, sameSubjectContract);
    expect(findings.map((finding) => finding.code)).toContain("unsupported-factual-claim");
  });

  it("records what is deferred to later masters", () => {
    expect(DEFERRED_TO_LATER_MASTERS.map((entry) => entry.master)).toContain("MASTER #5");
    expect(DEFERRED_TO_LATER_MASTERS.map((entry) => entry.master)).toContain("MASTER #8");
  });
});

describe("the synthetic boundary", () => {
  it("marks fixture-driven results as synthetic", () => {
    expect(pass().containsSyntheticInput).toBe(true);
  });

  it("proves the fixture is unmistakably synthetic", () => {
    const bundle = parseAudienceSignalBundle(fixtureNoAudienceSignals(NOW), ENGINEERING);
    expect(() => assertUnmistakablySynthetic(bundle)).not.toThrow();
    expect(bundle.provenance.producedBy).toContain("SYNTHETIC_ENGINEERING_FIXTURE");
  });

  it("records the synthetic state as a limitation on the result", () => {
    expect(pass().limitations.join(" ")).toMatch(/engineering fixture input/);
  });
});

function storyboardFixture(narration: string, onScreenText: string): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 30,
    title: "Does more VRAM mean more FPS?",
    narrationStyle: "plain",
    beats: [
      {
        startSecond: 0,
        endSecond: 5,
        purpose: "hook",
        narration,
        visualDirection: "SpecSmith comparison view",
        onScreenText,
        factDependencies: ["claim-fps"],
      },
    ],
    finalCta: "Check your own pair in the comparison tool.",
    factualGuardrails: [],
  };
}
