import { describe, expect, it } from "vitest";
import { mentionsClaim } from "./claimMention.ts";
import { checkScriptAgainstResearchStrict } from "./strictEvidenceGate.ts";
import type { ResearchCreativeContract } from "./creativeContract.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { importAuthoredBatch } from "../creative/fileWorkflow.ts";
import { runCreativeProposalPass } from "../creative/proposalPass.ts";

const PURCHASE = "One of these two builds is the better buy.";
const APPROVED = "These two builds have overlapping model estimate ranges; neither is separated by this model.";
const contract: ResearchCreativeContract = {
  version: "research-creative-contract-v1", questionId: "SYNTHETIC-count-regression", generatedAt: "2026-09-15T12:00:00Z",
  safeClaims: [{ claimId: "SYNTHETIC-range", proposition: APPROVED, state: "known", requiredWording: [], supportingSnapshotIds: ["SYNTHETIC-snapshot"] }],
  unsafeClaims: [{ claimId: "SYNTHETIC-buy", proposition: PURCHASE, state: "requires-human-judgment", reason: "Not established", wouldBecomeSafeIf: [] }],
  disputedClaims: [], groundedHookMaterial: [], openQuestions: [], limitations: ["Synthetic regression only"], overallState: "known",
};
function script(text: string): PlatformScriptStoryboard {
  return { platform: "youtube-shorts", title: text, targetDurationSeconds: 5, narrationStyle: "clear", beats: [], finalCta: "Open Compare", factualGuardrails: [] };
}

describe("incidental counts are not purchase evidence", () => {
  it.each([1, 2])("rechecks the actual committed Claude batch, attempt %s, without changing its historical evidence", (attempt) => {
    const batch = importAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, attempt);
    const result = runCreativeProposalPass({ ...DEMO_MISSION, concepts: batch.concepts });
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.every((proposal) => proposal.contractEligible)).toBe(true);
    expect(result.proposals.every((proposal) => proposal.reviewRequired)).toBe(true);
  });
  it.each(["Step one: write down what would answer your question.", "Step two: inspect the evidence.", "Pick one.",
    "Compare these two builds.", "One build or two builds?", APPROVED,
    "These two builds use model estimates, not measured benchmarks."])("allows unrelated wording: %s", (text) => {
    expect(mentionsClaim(text, PURCHASE)).toBe(false);
    expect(checkScriptAgainstResearchStrict(script(text), contract)).toEqual([]);
  });
  it.each([PURCHASE, "This is the better buy.", "That is the best purchase.", "One might be the better buy.",
    "Which is the better buy?", "Neither is the better buy."])("still blocks an unsupported judgment: %s", (text) => {
    expect(mentionsClaim(text, PURCHASE)).toBe(true);
    expect(checkScriptAgainstResearchStrict(script(text), contract).some((finding) => finding.severity === "hard-fail")).toBe(true);
  });
  it.each(["The first card is forty percent faster.", "40% faster.", "It may be 40 percent faster."])("retains figure protection: %s", (text) => {
    expect(mentionsClaim(text, "Example GPU-A is 40% faster than GPU-B")).toBe(true);
  });
  it.each(["Five forty nine ninety nine", "It costs five hundred forty nine ninety nine", "$549.99", "549.99 USD"])("retains price protection: %s", (text) => {
    expect(mentionsClaim(text, "Example GPU-A costs $549.99")).toBe(true);
  });
  it("retains qualified small figures without matching incidental ordinals", () => {
    expect(mentionsClaim("It costs forty dollars", "The card costs $40")).toBe(true);
    expect(mentionsClaim("Step two: inspect the price", "The card costs $2")).toBe(false);
    expect(mentionsClaim("The card has twelve GB", "It has twelve GB of VRAM")).toBe(true);
    expect(mentionsClaim("It costs two", "The card costs $2")).toBe(true);
    expect(mentionsClaim("Ninety nine", "The card costs $99")).toBe(true);
    expect(mentionsClaim("forty percent faster", "The card costs $40")).toBe(false);
  });
});
