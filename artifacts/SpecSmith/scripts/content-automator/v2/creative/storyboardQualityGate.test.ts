// MASTER #1's storyboard review now runs on every MASTER #6 concept before a
// batch may be called ready for human review. Unstubbed: this is the real gate
// on the committed demo batches.

import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { buildConceptHandoff } from "../handoff/conceptHandoff.ts";
import { buildReviewPacket, OUTSTANDING_HUMAN_APPROVALS, type ConceptFeedback } from "./fileWorkflow.ts";
import { evaluateAuthoredBatch } from "./fileWorkflowPass.ts";
import { reviewStoryboard } from "./storyboardQualityGate.ts";
import type { CreativeConcept } from "./concept.ts";

const REVISED = "claude-batch-three-checks";
/** What no rewrite of a concept can fix while disclosures ride in the caption and one capture is allowed. */
const OUTSIDE_AUTHOR = ["caption-density", "caption-readability", "shot-uniqueness", "visual-repetition"];

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function workflow(options: { dropAttempt4?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "quality-gate-"));
  dirs.push(dir);
  cpSync(DEMO_WORKFLOW_DIRECTORY, dir, { recursive: true });
  if (options.dropAttempt4) rmSync(join(dir, "batches", "attempt-4"), { recursive: true });
  return dir;
}
const revisedPath = (dir: string) => join(dir, "batches", "attempt-4", "02-three-checks.json");
const editRevised = (dir: string, edit: (concept: CreativeConcept) => CreativeConcept) =>
  writeFileSync(revisedPath(dir), JSON.stringify(edit(JSON.parse(readFileSync(revisedPath(dir), "utf8")) as CreativeConcept)));
const dimensions = (items: readonly string[]) =>
  items.filter((item) => item.startsWith("MASTER #1 storyboard review")).map((item) => /\[([^\]]+)\]/.exec(item)![1]).sort();
async function evaluate(dir: string) {
  const evaluation = await evaluateAuthoredBatch(dir, DEMO_MISSION);
  const concept = (id: string): ConceptFeedback => evaluation.feedback!.concepts.find((entry) => entry.conceptId === id)!;
  return { ...evaluation, concept };
}

describe("the concept #6 passed is refused until #1's fixes are made", () => {
  it("returns the old concept's #1 failures to the author, and does not mark the batch ready", async () => {
    const result = await evaluate(workflow({ dropAttempt4: true }));
    expect(result.attempts).toBe(3);
    const old = result.concept(REVISED);
    // It passed every #6 check...
    expect(old.contractEligible).toBe(true);
    expect(old.required.filter((item) => !item.startsWith("MASTER #1"))).toEqual([]);
    // ...and fails eight #1 checks: four its author can fix, four no one authoring can.
    expect(dimensions(old.required)).toEqual(["beat-duration", "cta-clarity", "hook-duration", "visual-change-frequency"]);
    expect(dimensions(old.blockedOutsideAuthor)).toEqual(OUTSIDE_AUTHOR);
    expect(old.required.join("\n")).toMatch(/Hook is 5s against a 3s envelope/);
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.packet.approved).toBe(false);
    expect(result.feedback!.nextStep).toMatch(/Author a revised batch in batches\/attempt-4\//);
  });
});

describe("the revised concept", () => {
  it("clears every #1 fix its author can make, and passes #6", async () => {
    const result = await evaluate(workflow());
    expect(result.attempts).toBe(4);
    const revised = result.concept(REVISED);
    expect(revised.contractEligible).toBe(true);
    expect(revised.required).toEqual([]);
    expect(revised.missionBlockers).toEqual([]);
    // Measured on the author's own captions, #1's only remaining fixes are the
    // two that come from showing one capture on every beat.
    const proposal = result.pass.result.proposals.find((entry) => entry.concept.conceptId === REVISED)!;
    const ownText = { ...proposal.storyboard, beats: proposal.storyboard.beats.map((beat, index) => ({ ...beat, onScreenText: proposal.concept.beats[index].onScreenText })) };
    const fixes = reviewStoryboard({ reviewId: REVISED, storyboard: ownText, ctaRoute: DEMO_MISSION.productDestination }).recommendedFixes;
    expect(fixes.map((fix) => fix.dimension).sort()).toEqual(["shot-uniqueness", "visual-repetition"]);
  });

  it("still is not ready: the failures no rewrite can fix keep blocking, and are named", async () => {
    const result = await evaluate(workflow());
    const revised = result.concept(REVISED);
    expect(dimensions(revised.blockedOutsideAuthor)).toEqual(OUTSIDE_AUTHOR);
    expect(revised.blockedOutsideAuthor.join("\n")).toMatch(/required disclosure lines are burned into the same caption/);
    expect(revised.blockedOutsideAuthor.join("\n")).toMatch(/one validated capture this mission permits/);
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.packet.approved).toBe(false);
  });

  it("blocks readiness even when the failures no rewrite can fix are the only ones left in the batch", async () => {
    const result = await evaluate(workflow());
    // The batch as it would stand once every author had cleared every item.
    const feedback = { ...result.feedback!, concepts: result.feedback!.concepts.map((concept) => ({ ...concept, required: [], missionBlockers: [] })) };
    expect(feedback.concepts.every((concept) => concept.blockedOutsideAuthor.length > 0)).toBe(true);
    const packet = buildReviewPacket({ brief: result.brief, attempt: result.attempts, generatorName: "local-file-authored-batch",
      status: "awaiting-human-review", result: result.pass.result, batchHash: result.packet.batchHash, feedback });
    expect(packet.machineChecksPassed).toBe(false);
    expect(packet.humanReviewReady).toBe(false);
    // Control: with nothing outstanding the same packet is ready, so the blockers are what refused it.
    const clean = { ...feedback, concepts: feedback.concepts.map((concept) => ({ ...concept, blockedOutsideAuthor: [] })) };
    expect(buildReviewPacket({ brief: result.brief, attempt: result.attempts, generatorName: "local-file-authored-batch",
      status: "awaiting-human-review", result: result.pass.result, batchHash: result.packet.batchHash, feedback: clean }).humanReviewReady).toBe(true);
  });

  it("no score outweighs an open fix: a strong review with one fix still blocks", async () => {
    const dir = workflow();
    editRevised(dir, (concept) => ({ ...concept, beats: concept.beats.map((beat, index) => index === 4 ? { ...beat, narration: "Open the comparison and run all three checks.", onScreenText: "Run the three checks" } : beat) }));
    const result = await evaluate(dir);
    const proposal = result.pass.result.proposals.find((entry) => entry.concept.conceptId === REVISED)!;
    const review = reviewStoryboard({ reviewId: REVISED, storyboard: proposal.storyboard, ctaRoute: DEMO_MISSION.productDestination });
    expect(review.productionQualityScore).toBeGreaterThanOrEqual(7);
    expect(dimensions(result.concept(REVISED).required)).toEqual(["cta-clarity"]);
    expect(result.packet.machineChecksPassed).toBe(false);
  });
});

describe("a newly introduced #1 failure is caught", () => {
  it.each([
    ["a hook stretched past the envelope", "hook-duration", (concept: CreativeConcept) => ({ ...concept, beats: concept.beats.map((beat, index) =>
      index === 0 ? { ...beat, endSecond: 5 } : index === 1 ? { ...beat, startSecond: 5 } : beat) })],
    ["a caption too long for two rendered lines", "caption-density", (concept: CreativeConcept) => ({ ...concept, beats: concept.beats.map((beat, index) =>
      index === 2 ? { ...beat, onScreenText: "Is the per-game gap on this page bigger than the range the model declares for its own estimates?" } : beat) })],
    ["narration too dense to follow", "information-density", (concept: CreativeConcept) => ({ ...concept, beats: concept.beats.map((beat, index) =>
      index === 1 ? { ...beat, narration: `${beat.narration} Write it down now, then hold yourself to it when the bars appear on the screen in front of you.` } : beat) })],
  ])("%s", async (_label, dimension, edit) => {
    const dir = workflow();
    editRevised(dir, edit);
    const result = await evaluate(dir);
    const revised = result.concept(REVISED);
    expect(dimensions(revised.required)).toContain(dimension);
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
  });
});

describe("honest limits", () => {
  it("says passing text and timing checks proves nothing about the rendered video, and keeps every human gate", async () => {
    const result = await evaluate(workflow());
    expect(result.packet.notes.join(" ")).toMatch(/does not show that a rendered video looks or sounds good/);
    expect(result.packet.outstandingApprovals).toEqual(OUTSTANDING_HUMAN_APPROVALS);
    const review = reviewStoryboard({ reviewId: REVISED, storyboard: result.pass.result.proposals[1].storyboard, ctaRoute: "/compare" });
    expect(review.mediaSha256).toBeNull();
    for (const dimension of ["composition-quality", "visual-polish", "voice-naturalness", "overall-perceived-production-quality"]) {
      expect(review.overall.find((score) => score.dimension === dimension)?.provenance).toBe("not-assessed");
    }
  });

  it("the handoff refuses the committed batch rather than carrying unresolved #1 fixes into a report", async () => {
    await expect(buildConceptHandoff({ directory: workflow(), mission: DEMO_MISSION, conceptId: REVISED }))
      .rejects.toThrow(/not ready for human review/);
  });
});
