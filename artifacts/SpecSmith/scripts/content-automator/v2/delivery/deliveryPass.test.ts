// MASTER #4 — Delivery, fit, brief and cross-platform integrity tests.

import { describe, expect, it } from "vitest";

import { runDeliveryPass, assertZeroCostDelivery, formatDeliveryReport } from "./deliveryPass.ts";
import { buildCreativeHandoff, assertCreativeHonoursBrief, DEFERRED_TO_LATER_MASTERS } from "./closedLoop.ts";
import { extractTruthInvariant } from "./invariants.ts";
import { BriefRefusedError, buildPlatformBrief, briefOutwardText } from "./brief.ts";
import { assessAudiencePlatformFit, requiredHonestySeconds } from "./fit.ts";
import { buildCrossPlatformPlan, UntraceablePlatformDifferenceError } from "./crossPlatform.ts";
import { buildAudienceProfile, assessAudienceFit } from "../audience/profile.ts";
import { parseAudienceSignalBundle, unavailableAudienceSignals } from "../audience/signals.ts";
import { baselinePlatformSnapshot, postingTimeFor, trendFor, REGISTRY_REVIEWED_AT } from "../platform/registry.ts";
import { missionFixture, researchFixture, contractFixture } from "./testFixtures.ts";
import { fixtureNoAudienceSignals, fixtureObservedAudience, assertUnmistakablySynthetic } from "./engineeringFixture.ts";
import type { PlatformFact, PlatformSnapshot } from "../platform/model.ts";
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

function fitInputs(mission = missionFixture(), snapshot = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT)) {
  const invariant = extractTruthInvariant(mission, contract, research);
  const profile = buildAudienceProfile({
    mission,
    contract,
    research,
    signals: unavailableAudienceSignals(NOW.toISOString()),
    hypotheses: [],
    now: NOW,
    producedBy: "test",
  });
  return {
    mission,
    invariant,
    profile,
    audienceFit: assessAudienceFit(profile, mission),
    snapshot,
    postingTime: postingTimeFor(snapshot.platform),
    trend: trendFor(snapshot.platform),
    now: NOW,
  };
}

function bindingFact(
  platform: PlatformSnapshot["platform"],
  factId: string,
  claim: string,
  category: PlatformFact["category"] = "media-constraint",
): PlatformFact {
  return {
    factId,
    platform,
    claim,
    category,
    status: "stable-constraint",
    source: "synthetic adversarial test fixture",
    sourceQuality: "direct-observation",
    capturedAt: NOW.toISOString(),
    effectiveAt: null,
    expiresAt: null,
    confidence: "high",
    notes: "test only",
  };
}

describe("the full chain runs without inventing platform knowledge", () => {
  const result = pass();

  it("produces transport-independent briefs for all three platforms", () => {
    expect(result.briefs).toHaveLength(3);
    expect(result.briefs.map((brief) => brief.platform).sort()).toEqual(["instagram-reels", "tiktok", "youtube-shorts"]);
  });

  it("records reconstructable identity", () => {
    const brief = result.briefs[0];
    expect(brief.missionId).toBe("mission-fixture-1");
    expect(brief.researchQuestionId).toBe("question-vram-fps");
    expect(brief.strategyRunId).toBe("strategy-test-1");
    expect(brief.platformSnapshotId).toContain("platform-");
  });

  it("breaches no truth invariant", () => {
    expect(result.invariantFindings.filter((finding) => finding.severity === "hard-fail")).toEqual([]);
  });

  it("preserves claims, wording, objective and thesis across platforms", () => {
    expect(new Set(result.briefs.map((brief) => brief.allowedClaims.map((claim) => claim.claimId).join(","))).size).toBe(1);
    expect(new Set(result.briefs.map((brief) => brief.requiredWording.join("|"))).size).toBe(1);
    expect(new Set(result.briefs.map((brief) => brief.objective)).size).toBe(1);
    expect(new Set(result.briefs.map((brief) => brief.thesis)).size).toBe(1);
  });

  it("is deterministic and zero-provider", () => {
    expect(pass().resultHash).toBe(result.resultHash);
    expect(assertZeroCostDelivery(result).ok).toBe(true);
  });

  it("explains unknown platform state in the report", () => {
    const report = formatDeliveryReport(result);
    expect(report).toContain("AUDIENCE");
    expect(report).toContain("demographics: unknown");
    expect(report).toContain("posting time: unknown");
  });
});

describe("unknown never becomes incompatible, false or a magic default", () => {
  it("does not refuse a baseline platform merely because orientation is unknown", () => {
    const fit = assessAudiencePlatformFit(fitInputs());
    expect(fit.verdict).toBe("unknown");
    expect(fit.refusals.map((reason) => reason.code)).not.toContain("media-incompatible");
  });

  it("does not reinterpret unknown maximum duration as 60 seconds", () => {
    const heavy = missionFixture({ requiredWording: Array.from({ length: 160 }, (_, i) => `required-${i}`) });
    const fit = assessAudiencePlatformFit(fitInputs(heavy));
    expect(fit.verdict).toBe("unknown");
    expect(fit.refusals.map((reason) => reason.code)).not.toContain("evidence-cannot-fit-honestly");
  });

  it("does not use the removed 50% honesty-budget heuristic", () => {
    const mission = missionFixture({ requiredWording: Array.from({ length: 45 }, (_, i) => `required-${i}`) });
    const base = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const maxFact = bindingFact(base.platform, "verified-max", "Verified maximum duration is 60 seconds.");
    const snapshot: PlatformSnapshot = {
      ...base,
      facts: [maxFact],
      capability: {
        ...base.capability,
        media: {
          ...base.capability.media,
          maxDurationSeconds: { value: 60, status: "stable-constraint", factId: maxFact.factId, basis: "test verified maximum" },
        },
      },
    };
    const inputs = fitInputs(mission, snapshot);
    const fit = assessAudiencePlatformFit(inputs);
    expect(requiredHonestySeconds(inputs.invariant)).toBeLessThanOrEqual(60);
    expect(fit.refusals.map((reason) => reason.code)).not.toContain("evidence-cannot-fit-honestly");
  });

  it("does refuse when an established maximum is genuinely too short for the required truth", () => {
    const mission = missionFixture({ requiredWording: Array.from({ length: 220 }, (_, i) => `required-${i}`) });
    const base = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const maxFact = bindingFact(base.platform, "verified-max", "Verified maximum duration is 30 seconds.");
    const snapshot: PlatformSnapshot = {
      ...base,
      facts: [maxFact],
      capability: {
        ...base.capability,
        media: {
          ...base.capability.media,
          maxDurationSeconds: { value: 30, status: "stable-constraint", factId: maxFact.factId, basis: "test verified maximum" },
        },
      },
    };
    const fit = assessAudiencePlatformFit(fitInputs(mission, snapshot));
    expect(fit.verdict).toBe("refuse");
    expect(fit.refusals.map((reason) => reason.code)).toContain("evidence-cannot-fit-honestly");
  });

  it("does not claim description clickability or a profile link when both are unknown", () => {
    for (const brief of pass().briefs) {
      expect(brief.execution.ctaTreatment.treatment).toMatch(/Do not claim the description is clickable/i);
      expect(brief.execution.ctaTreatment.treatment).toMatch(/profile-link surface exists/i);
    }
  });

  it("does not truncate descriptions to an invented 2200-character fallback", () => {
    for (const brief of pass().briefs) {
      expect(brief.metadata.description.length).toBeGreaterThan(0);
      expect(brief.execution.targetDurationSecondsRange).toBeNull();
      expect(brief.execution.targetDurationBasis).toMatch(/No source-bound platform maximum/);
      expect(brief.adaptationEvidence).toEqual([]);
    }
  });

  it("describes analytics availability as unknown rather than absent", () => {
    const risks = pass().outcomes[0].fit.platformRisks.join(" ");
    expect(risks).toMatch(/availability is unknown/i);
    expect(risks).not.toMatch(/No analytics are available/);
  });
});

describe("audience evidence remains separate from the mission's target", () => {
  const empty = pass();
  it("does not invent a persona from no audience observations", () => {
    const profile = empty.audienceProfile!;
    expect(profile.job.state).toBe("unknown");
    expect(profile.intent.state).toBe("unknown");
    expect(profile.readiness.state).toBe("unknown");
    expect(profile.demographics.age.value).toBeNull();
  });

  it("keeps the mission's selected expertise distinct from observation", () => {
    expect(empty.audienceProfile!.expertise.state).toBe("known");
    expect(empty.audienceProfile!.expertise.basis).toMatch(/not an observation/);
  });

  it("changes state only when fixture signals are supplied", () => {
    const observed = pass({ audienceSignals: parseAudienceSignalBundle(fixtureObservedAudience(NOW), ENGINEERING) });
    expect(observed.audienceProfile!.expertise.state).toBe("observed");
    expect(observed.audienceProfile!.expertise.value).toBe("beginner");
    expect(observed.audienceProfile!.intent.state).toBe("supported-inference");
    expect(observed.audienceProfile!.demographics.age.state).toBe("unknown");
  });
});

describe("hypotheses stay labelled as hypotheses", () => {
  const result = pass();
  it("keeps audience hypotheses untested with falsification conditions", () => {
    expect(result.hypotheses.length).toBeGreaterThan(0);
    for (const hypothesis of result.hypotheses) {
      expect(hypothesis.status).toBe("untested");
      expect(hypothesis.falsificationCondition.length).toBeGreaterThan(12);
      expect(hypothesis.measurementRef).toBeNull();
    }
  });

  it("labels pacing numbers as unmeasured creative hypotheses", () => {
    const pacing = result.outcomes[0].fit.pacing;
    expect(pacing.isHypothesis).toBe(true);
    expect(pacing.basis).toMatch(/not a measured platform optimum/i);
  });
});

describe("metadata stays inside the evidence boundary", () => {
  const result = pass();
  it("uses descriptive tags without popularity claims", () => {
    for (const brief of result.briefs) {
      for (const tag of brief.metadata.tags) {
        expect(tag.kind).toBe("generic-descriptive");
        expect(tag.factId).toBeNull();
        expect(tag.basis).toMatch(/without asserting popularity or trend/i);
      }
    }
  });

  it("keeps caveat before CTA", () => {
    const description = result.briefs[0].metadata.description;
    expect(description.indexOf("estimated")).toBeGreaterThanOrEqual(0);
    expect(description.indexOf("/compare")).toBeGreaterThan(description.indexOf("estimated"));
  });

  it("passes outward metadata through the truth gate", () => {
    expect(briefOutwardText(result.briefs[0]).length).toBeGreaterThan(0);
  });

  it("refuses hostile metadata when a title surface is source-bound", () => {
    const hostile = missionFixture({ centralQuestion: "More VRAM does not matter for gaming performance" });
    const base = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const titleFact = bindingFact(base.platform, "title-cap", "A separate title field accepts up to 100 characters.", "text-capability");
    const snapshot: PlatformSnapshot = {
      ...base,
      facts: [titleFact],
      capability: {
        ...base.capability,
        text: {
          ...base.capability.text,
          titleMaxChars: { value: 100, status: "stable-constraint", factId: titleFact.factId, basis: "source-bound test title surface" },
        },
      },
    };
    const inputs = fitInputs(hostile, snapshot);
    const fit = assessAudiencePlatformFit(inputs);
    expect(() => buildPlatformBrief({
      mission: hostile,
      invariant: inputs.invariant,
      profile: inputs.profile,
      fit,
      snapshot,
      hypotheses: [],
      strategyRunId: "s",
      creativeId: "c",
      now: NOW,
      producedBy: "test",
    })).toThrow(BriefRefusedError);
  });
});

describe("CTA follows product readiness and verified link capability", () => {
  it("includes a neutral CTA when the mission has a route but link surfaces are unknown", () => {
    const result = pass();
    expect(result.briefs.every((brief) => brief.execution.ctaTreatment.include)).toBe(true);
    expect(result.briefs[0].execution.ctaTreatment.treatment).toMatch(/show .* on screen/i);
  });

  it("produces no CTA when the mission has no route", () => {
    const result = pass({ mission: missionFixture({ productRoute: null, productSurface: null }) });
    expect(result.briefs.every((brief) => !brief.execution.ctaTreatment.include)).toBe(true);
  });

  it("uses a description link only when clickability is established", () => {
    const mission = missionFixture();
    const base = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const linkFact = bindingFact(base.platform, "link-fact", "Description links are clickable.", "interaction-capability");
    const snapshot: PlatformSnapshot = {
      ...base,
      facts: [linkFact],
      capability: {
        ...base.capability,
        interaction: {
          ...base.capability.interaction,
          outboundLinkInDescription: { value: true, status: "stable-constraint", factId: linkFact.factId, basis: "source-bound test observation" },
        },
      },
    };
    const inputs = fitInputs(mission, snapshot);
    const fit = assessAudiencePlatformFit(inputs);
    expect(fit.cta.treatment).toMatch(/description/);
    expect(fit.cta.treatment).toMatch(/establishes description-link clickability/);
  });
});

describe("accessibility remains SpecSmith-owned and non-negotiable", () => {
  const result = pass();
  it("marks every requirement non-negotiable", () => {
    for (const requirement of result.outcomes[0].fit.accessibility) expect(requirement.negotiable).toBe(false);
  });
  it("requires burned-in/audio-independent delivery without pretending platform-native captions are known", () => {
    expect(result.briefs[0].execution.captionStrategy.mustBeBurnedIn).toBe(true);
    expect(result.outcomes[0].fit.accessibility.map((r) => r.code)).toContain("audio-independent-comprehension");
    expect(result.outcomes[0].fit.accessibility.map((r) => r.code)).toContain("conservative-safe-area");
  });
  it("carries requirements into the MASTER #1 handoff", () => {
    expect(buildCreativeHandoff(result.briefs[0], NOW).nonNegotiable.join(" ")).toMatch(/Accessibility \(non-negotiable\)/);
  });
});

describe("cross-platform planning requires exact source provenance", () => {
  const result = pass();
  it("certifies uniform execution when no source-bound platform fact justifies a difference", () => {
    expect(result.packagePlan!.differences).toEqual([]);
    expect(result.packagePlan!.uniformExecutionJustified).toBe(true);
    expect(result.packagePlan!.uniformExecutionReason).toMatch(/No source-bound platform fact/i);
  });

  it("fails closed if briefs differ without exact carried fact provenance", () => {
    const briefs = [...result.briefs];
    const altered = {
      ...briefs[1],
      metadata: { ...briefs[1].metadata, description: `${briefs[1].metadata.description} extra` },
    };
    expect(() => buildCrossPlatformPlan({
      missionId: missionFixture().missionId,
      invariant: result.invariant!,
      briefs: [briefs[0], altered, briefs[2]],
      fits: result.outcomes.map((outcome) => outcome.fit),
      now: NOW,
    })).toThrow(UntraceablePlatformDifferenceError);
  });

  it("emits a real difference using the exact fact carried by the brief", () => {
    const mission = missionFixture();
    const base = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const linkFact = bindingFact(base.platform, "yt-link-observed", "Description links are clickable.", "interaction-capability");
    const snapshot: PlatformSnapshot = {
      ...base,
      facts: [linkFact],
      capability: {
        ...base.capability,
        interaction: {
          ...base.capability.interaction,
          outboundLinkInDescription: { value: true, status: "stable-constraint", factId: linkFact.factId, basis: "source-bound test observation" },
        },
      },
    };
    const inputs = fitInputs(mission, snapshot);
    const fit = assessAudiencePlatformFit(inputs);
    const sourcedBrief = buildPlatformBrief({
      mission,
      invariant: inputs.invariant,
      profile: inputs.profile,
      fit,
      snapshot,
      hypotheses: [],
      strategyRunId: "strategy-test-1",
      creativeId: "creative-source-bound",
      now: NOW,
      producedBy: "test",
    });
    expect(sourcedBrief.adaptationEvidence.map((entry) => entry.factId)).toContain(linkFact.factId);

    const reference = result.briefs.find((brief) => brief.platform === "instagram-reels")!;
    const referenceFit = result.outcomes.find((outcome) => outcome.fit.platform === "instagram-reels")!.fit;
    const plan = buildCrossPlatformPlan({
      missionId: mission.missionId,
      invariant: inputs.invariant,
      briefs: [reference, sourcedBrief],
      fits: [referenceFit, fit],
      now: NOW,
    });
    expect(plan.differences).toHaveLength(1);
    expect(plan.differences[0].dimension).toBe("execution.cta");
    expect(plan.differences[0].justifiedByFactId).toBe(linkFact.factId);
    expect(plan.differences[0].justification).toContain(linkFact.claim);
  });
});

describe("no mission is an honest no-op", () => {
  const result = pass({ mission: null });
  it("produces no brief or audience profile", () => {
    expect(result.briefs).toEqual([]);
    expect(result.noOpReason).toBe("no-mission-authorised");
    expect(result.audienceProfile).toBeNull();
    expect(result.invariant).toBeNull();
  });
  it("remains deterministic", () => expect(pass({ mission: null }).resultHash).toBe(result.resultHash));
});

describe("MASTER #1 handoff preserves research truth", () => {
  const result = pass();
  const brief = result.briefs[0];
  it("catches a cut that drops the estimate label", () => {
    const findings = assertCreativeHonoursBrief(storyboardFixture("Example GPU-A is 15% faster.", "15% faster"), brief, result.invariant!, contract);
    expect(findings.map((finding) => finding.code)).toContain("required-wording-dropped");
  });
  it("accepts a cut that preserves estimate status and configuration", () => {
    const findings = assertCreativeHonoursBrief(
      storyboardFixture("SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.", "estimated, at 1440p high"),
      brief,
      result.invariant!,
      contract,
    );
    expect(findings.filter((finding) => finding.severity === "hard-fail")).toEqual([]);
  });
  it("catches loss of the audio-independent layer", () => {
    const findings = assertCreativeHonoursBrief(
      storyboardFixture("SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.", ""),
      brief,
      result.invariant!,
      contract,
    );
    expect(findings.map((finding) => finding.code)).toContain("no-audio-independent-layer");
  });
  it("does not suppress upstream MASTER #2 findings", () => {
    const sameSubjectContract = {
      ...contract,
      unsafeClaims: [{
        claimId: "claim-unsafe-same-subject",
        proposition: "Example GPU-A will stay fast for the next five years",
        state: "unknown" as const,
        reason: "Nothing establishes future performance.",
      }],
    };
    const findings = assertCreativeHonoursBrief(
      storyboardFixture("SpecSmith estimates Example GPU-A about 15% higher on FPS at 1440p high.", "estimated, at 1440p high"),
      brief,
      result.invariant!,
      sameSubjectContract,
    );
    expect(findings.map((finding) => finding.code)).toContain("unsupported-factual-claim");
  });
  it("keeps later-master boundaries explicit", () => {
    expect(DEFERRED_TO_LATER_MASTERS.map((entry) => entry.master)).toContain("MASTER #5");
    expect(DEFERRED_TO_LATER_MASTERS.map((entry) => entry.master)).toContain("MASTER #8");
  });
});

describe("synthetic fixture boundary", () => {
  it("marks fixture-driven output synthetic and unmistakable", () => {
    expect(pass().containsSyntheticInput).toBe(true);
    const bundle = parseAudienceSignalBundle(fixtureNoAudienceSignals(NOW), ENGINEERING);
    expect(() => assertUnmistakablySynthetic(bundle)).not.toThrow();
  });
});

function storyboardFixture(narration: string, onScreenText: string): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 30,
    title: "Does more VRAM mean more FPS?",
    narrationStyle: "plain",
    beats: [{
      startSecond: 0,
      endSecond: 5,
      purpose: "hook",
      narration,
      visualDirection: "SpecSmith comparison view",
      onScreenText,
      factDependencies: ["claim-fps"],
    }],
    finalCta: "Check your own pair in the comparison tool.",
    factualGuardrails: [],
  };
}
