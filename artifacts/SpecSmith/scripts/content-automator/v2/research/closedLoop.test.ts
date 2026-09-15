// The closed loop, end to end, on the adversarial fixture.
//
// This is the test that proves the pieces compose: hostile evidence goes in and
// the right claims come out refused, for the right reasons. Each assertion
// names the specific trap the fixture sets.

import { describe, expect, it } from "vitest";

import { runResearchClosedLoop } from "./closedLoop.ts";
import { buildFixtureIngestionDocument } from "./engineeringFixture.ts";
import { ingestResearchEvidence } from "./ingestion.ts";
import { runResearchPass } from "./researchPass.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

const storyboard: PlatformScriptStoryboard = {
  platform: "youtube-shorts",
  targetDurationSeconds: 24,
  title: "Pick the GPU before SpecSmith reveals the names",
  narrationStyle: "direct",
  beats: [
    { startSecond: 0, endSecond: 6, purpose: "hook", narration: "Two cards, names hidden.", visualDirection: "ui", onScreenText: "NAMES HIDDEN", factDependencies: [] },
    { startSecond: 6, endSecond: 24, purpose: "cta", narration: "Open /compare.", visualDirection: "ui", onScreenText: "OPEN COMPARE", factDependencies: [] },
  ],
  finalCta: "Open SpecSmith Compare.",
  factualGuardrails: [],
};

describe("the closed loop over hostile evidence", () => {
  const loop = runResearchClosedLoop({ storyboard, now: NOW });

  it("atomizes the compound statement into three independently-judged claims", () => {
    expect(loop.claims).toHaveLength(3);
    expect(loop.claims.map((claim) => claim.kind).sort()).toEqual(["comparison", "current-price", "specification"]);
  });

  it("marks the whole pass as synthetic so it can never read as production research", () => {
    expect(loop.result.containsSyntheticEvidence).toBe(true);
    expect(loop.result.limitations.join(" ")).toMatch(/not a production research result/i);
  });

  it("refuses the four-day-old price as stale rather than reporting it as current", () => {
    const price = loop.claims.find((claim) => claim.kind === "current-price")!;
    expect(loop.result.confidence.get(price.claimId)?.state).toBe("stale");
    expect(loop.result.contract.safeClaims.map((entry) => entry.claimId)).not.toContain(price.claimId);
  });

  it("collapses the three press retellings into one independent origin", () => {
    const comparison = loop.claims.find((claim) => claim.kind === "comparison")!;
    const corroboration = loop.result.corroborations.find((entry) => entry.claimId === comparison.claimId)!;
    expect(corroboration.dependentGroups).toHaveLength(1);
    expect(corroboration.dependentGroups[0]).toHaveLength(3);
    // Five snapshots' worth of apparent agreement is two real origins.
    expect(corroboration.independentOriginCount).toBe(2);
  });

  it("does not let the laptop benchmark support the desktop comparison claim", () => {
    const comparison = loop.claims.find((claim) => claim.kind === "comparison")!;
    const laptopLink = loop.result.links.find(
      (link) => link.claimId === comparison.claimId && link.observationId === "obs-laptop-bench",
    )!;
    expect(laptopLink.applicability).toBe("not-applicable");
    // And the strong source behind it must not be counted either: the
    // corroboration for this claim excludes its snapshot entirely.
    const corroboration = loop.result.corroborations.find((entry) => entry.claimId === comparison.claimId)!;
    expect(corroboration.snapshotIds).not.toContain("snap-review-laptop");
  });

  it("refuses the comparison claim, which only vendor marketing and one press release support", () => {
    const comparison = loop.claims.find((claim) => claim.kind === "comparison")!;
    const assessment = loop.result.confidence.get(comparison.claimId)!;
    expect(assessment.state).toBe("plausible");
    expect(loop.result.contract.unsafeClaims.map((entry) => entry.claimId)).toContain(comparison.claimId);
    expect(assessment.detractors.join(" ")).toMatch(/commercial interest/i);
  });

  it("stops with a named, correct outcome rather than forcing an answer", () => {
    expect(loop.result.stoppingReason).toBe("insufficient-evidence");
    // "Insufficient reliable evidence" is a CORRECT outcome, not a breakdown:
    // the pass ran to completion and honestly found the evidence wanting. A
    // system that treated this as failure would learn to force answers.
    expect(loop.result.stoppedSuccessfully).toBe(true);
    expect(loop.result.claims.length).toBeGreaterThan(0);
  });

  it("records a blocking knowledge gap for the stale price", () => {
    expect(loop.result.gaps.some((gap) => gap.code === "stale-current-price" && gap.decisionImpact === "blocking")).toBe(true);
  });

  it("offers no hook material, because nothing reached the bar", () => {
    expect(loop.result.contract.groundedHookMaterial).toEqual([]);
  });

  it("does not fire the gate on a storyboard that makes none of these claims", () => {
    expect(loop.findings).toEqual([]);
  });

  it("fires the gate on a storyboard that asserts the unsupported comparison", () => {
    const asserting: PlatformScriptStoryboard = {
      ...storyboard,
      title: "Example GPU-A is 40% faster than GPU-B",
    };
    const result = runResearchClosedLoop({ storyboard: asserting, now: NOW });
    const hard = result.findings.filter((finding) => finding.severity === "hard-fail");
    expect(hard.length).toBeGreaterThan(0);
    expect(hard[0].code).toBe("unsupported-factual-claim");
  });

  it("produces a worked example of the chain for the report", () => {
    expect(loop.worked.source).toContain("snap-review-laptop");
    expect(loop.worked.observation).toContain("obs-laptop-bench");
    expect(loop.worked.claim).toContain("40%");
  });
});

describe("determinism and the production boundary", () => {
  it("produces identical results for identical inputs", () => {
    const first = runResearchClosedLoop({ storyboard, now: NOW });
    const second = runResearchClosedLoop({ storyboard, now: NOW });
    expect(JSON.stringify(first.result.links)).toBe(JSON.stringify(second.result.links));
    expect(JSON.stringify(first.result.contract)).toBe(JSON.stringify(second.result.contract));
    expect(first.result.stoppingReason).toBe(second.result.stoppingReason);
  });

  it("refuses the very same fixture document when synthetic data is not allowed", () => {
    const document = buildFixtureIngestionDocument({ now: NOW });
    expect(() => ingestResearchEvidence(document, { allowSynthetic: true })).not.toThrow();
    expect(() => ingestResearchEvidence(document, { allowSynthetic: false }))
      .toThrow(/may never enter production research memory/);
  });

  it("reports a question with no claims as invalid rather than as answered", () => {
    const result = runResearchPass({
      researchId: "r-empty",
      question: {
        questionId: "q-empty",
        question: "?",
        purpose: "p",
        informsDecision: "d",
        claimKind: "specification",
        risk: "low",
        acceptableUncertainty: "likely",
        subjectIds: [],
      },
      claims: [],
      snapshots: [],
      observations: [],
      stances: [],
      startedAt: NOW,
      now: NOW,
    });
    expect(result.stoppingReason).toBe("question-invalid");
    expect(result.contract.safeClaims).toEqual([]);
  });

  it("reports quota exhaustion without lowering the evidence bar", () => {
    const result = runResearchPass({
      researchId: "r-quota",
      question: {
        questionId: "q-1", question: "?", purpose: "p", informsDecision: "d",
        claimKind: "specification", risk: "low", acceptableUncertainty: "likely", subjectIds: [],
      },
      claims: [{
        claimId: "c-1", questionId: "q-1", proposition: "a claim", kind: "specification",
        risk: "low", subjectIds: [], provenance: { synthetic: true, producedBy: "test", producedAt: NOW.toISOString() },
      }],
      snapshots: [],
      observations: [],
      stances: [],
      startedAt: NOW,
      now: NOW,
      quotaExhausted: ["example-provider"],
    });
    expect(result.stoppingReason).toBe("quota-exhausted");
    expect(result.budget.quotaExhausted).toEqual(["example-provider"]);
    expect(result.limitations.join(" ")).toMatch(/No paid fallback was used/);
    // The bar did not move: nothing became safe because research ran out of quota.
    expect(result.contract.safeClaims).toEqual([]);
  });
});
