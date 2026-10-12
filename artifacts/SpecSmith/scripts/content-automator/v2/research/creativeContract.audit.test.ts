import { describe, expect, it } from "vitest";

import type { ResearchCreativeContract } from "./creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "./strictEvidenceGate.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

function storyboard(title: string): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    title,
    narrationStyle: "direct",
    beats: [{ startSecond: 0, endSecond: 24, purpose: "hook", narration: "", visualDirection: "ui", onScreenText: "", factDependencies: [] }],
    finalCta: "",
    factualGuardrails: [],
  };
}

function contract(bucket: "unsafe" | "disputed"): ResearchCreativeContract {
  const claim = {
    claimId: "claim-1",
    proposition: "Widget-9000 outruns Widget-8000 by 40 percent",
    state: bucket === "disputed" ? "disputed" as const : "plausible" as const,
    reason: bucket === "disputed" ? "Sources conflict." : "Evidence is insufficient.",
    wouldBecomeSafeIf: ["Obtain applicable independent evidence."],
  };
  return {
    version: "research-creative-contract-v1",
    questionId: "q-1",
    generatedAt: "2026-09-15T12:00:00.000Z",
    safeClaims: [],
    unsafeClaims: bucket === "unsafe" ? [claim] : [],
    disputedClaims: bucket === "disputed" ? [claim] : [],
    groundedHookMaterial: [],
    openQuestions: [],
    limitations: [],
    overallState: "unknown",
  };
}

describe("MASTER #2 adversarial audit: uncertainty wording must not become evidence", () => {
  it("does not let 'may' turn an unsupported factual claim into publishable copy", () => {
    const findings = checkScriptAgainstResearchStrict(storyboard("Widget-9000 may outrun Widget-8000 by 40 percent"), contract("unsafe"));
    expect(findings.some((finding) => finding.code === "unsupported-factual-claim" && finding.severity === "hard-fail")).toBe(true);
  });

  it("does not let 'might', 'could', 'about', or 'roughly' manufacture evidence either", () => {
    for (const hedge of ["might", "could", "about", "roughly"]) {
      const findings = checkScriptAgainstResearchStrict(storyboard(`Widget-9000 ${hedge} outruns Widget-8000 by 40 percent`), contract("unsafe"));
      expect(findings.some((finding) => finding.code === "unsupported-factual-claim" && finding.severity === "hard-fail"), hedge).toBe(true);
    }
  });

  it("does not let a generic hedge hide a disputed claim", () => {
    const findings = checkScriptAgainstResearchStrict(storyboard("Widget-9000 may outrun Widget-8000 by 40 percent"), contract("disputed"));
    expect(findings.some((finding) => finding.code === "disputed-presented-as-settled" && finding.severity === "hard-fail")).toBe(true);
  });

  it("does not regress to the old generic-GPU false positive", () => {
    const findings = checkScriptAgainstResearchStrict(storyboard("Pick the GPU before SpecSmith reveals the names"), contract("unsafe"));
    expect(findings).toEqual([]);
  });
});
