// MASTER #1's storyboard review runs on every MASTER #6 concept before a batch
// may be called ready for human review, and the generation pass's own status
// follows the same verdict. Unstubbed: this is the real gate on the committed
// demo batches.

import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { buildConceptHandoff } from "../handoff/conceptHandoff.ts";
import { buildReviewPacket, OUTSTANDING_HUMAN_APPROVALS, type ConceptFeedback } from "./fileWorkflow.ts";
import { evaluateAuthoredBatch } from "./fileWorkflowPass.ts";
import { runCreativeGenerationPass } from "./generationPass.ts";
import { reviewStoryboard } from "./storyboardQualityGate.ts";
import { CREATIVE_DISCLOSURES, type CreativeConcept } from "./concept.ts";

const REVISED = "claude-batch-three-checks";
const LATEST = 6;
const PRIMARY = "compare_rtx5060ti_i3-13100f_vs_rtx4060ti_r5-9600x_1440p_high_static_540x960-2";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/** A scratch copy of the committed workflow, cut back to `latest` attempts. */
function workflow(latest = LATEST): string {
  const dir = mkdtempSync(join(tmpdir(), "quality-gate-"));
  dirs.push(dir);
  cpSync(DEMO_WORKFLOW_DIRECTORY, dir, { recursive: true });
  for (let attempt = latest + 1; attempt <= LATEST; attempt += 1) rmSync(join(dir, "batches", `attempt-${attempt}`), { recursive: true });
  return dir;
}
const revisedPath = (dir: string) => join(dir, "batches", `attempt-${LATEST}`, "02-three-checks.json");
const readRevised = (dir: string) => JSON.parse(readFileSync(revisedPath(dir), "utf8")) as CreativeConcept;
const editRevised = (dir: string, edit: (concept: CreativeConcept) => CreativeConcept) =>
  writeFileSync(revisedPath(dir), JSON.stringify(edit(readRevised(dir))));
const withBeat = (index: number, change: Partial<CreativeConcept["beats"][number]>) => (concept: CreativeConcept): CreativeConcept =>
  ({ ...concept, beats: concept.beats.map((beat, at) => at === index ? { ...beat, ...change } : beat) });
/**
 * Historical attempts 1-5 also carry "The range shown..." on Compare beats,
 * which no longer passes #6 (claimMention.counts.test.ts pins that it is their
 * only #6 defect). These tests are about #1's review, so they apply exactly that
 * correction and nothing else.
 */
const RANGE = CREATIVE_DISCLOSURES["disclosure.model-range"];
const withoutAbsentRange = (concept: CreativeConcept): CreativeConcept => ({
  ...concept,
  requiredDisclosures: concept.requiredDisclosures.filter((id) => id !== "disclosure.model-range"),
  disclosureTextByBeat: Object.fromEntries(Object.entries(concept.disclosureTextByBeat ?? {}).map(([beat, texts]) => [beat, texts.filter((text) => text !== RANGE)])),
});
function correctAttempt(dir: string, attempt: number): string {
  const batchDir = join(dir, "batches", `attempt-${attempt}`);
  for (const name of readdirSync(batchDir).filter((entry) => entry.endsWith(".json"))) {
    writeFileSync(join(batchDir, name), JSON.stringify(withoutAbsentRange(JSON.parse(readFileSync(join(batchDir, name), "utf8")))));
  }
  return dir;
}
const dimensions = (items: readonly string[]) =>
  items.filter((item) => item.startsWith("MASTER #1 storyboard review")).map((item) => /\[([^\]]+)\]/.exec(item)![1]).sort();
async function evaluate(dir: string, mission = DEMO_MISSION) {
  const evaluation = await evaluateAuthoredBatch(dir, mission);
  const concept = (id: string): ConceptFeedback => evaluation.feedback!.concepts.find((entry) => entry.conceptId === id)!;
  return { ...evaluation, concept };
}

describe("concepts that passed #6 are refused until #1's fixes are made", () => {
  it("returns the attempt-3 concept's #1 failures to its author", async () => {
    const old = (await evaluate(correctAttempt(workflow(3), 3))).concept(REVISED);
    expect(old.contractEligible).toBe(true);
    expect(dimensions(old.required)).toEqual(["beat-duration", "cta-clarity", "hook-duration", "shot-uniqueness", "visual-change-frequency", "visual-repetition"]);
    expect(old.required.join("\n")).toMatch(/Hook is 5s against a 3s envelope/);
    // Captions are the author's own now; the disclosures no longer overflow them.
    expect(dimensions(old.required)).not.toContain("caption-density");
    expect(old.blockedOutsideAuthor).toEqual([]);
  });

  it("refuses attempt 4, which fixed the timing but still shows one view on every beat", async () => {
    const result = await evaluate(correctAttempt(workflow(4), 4));
    const attempt4 = result.concept(REVISED);
    expect(dimensions(attempt4.required)).toEqual(["shot-uniqueness", "visual-repetition"]);
    // The mission now lists more validated views, so this is the author's to fix.
    expect(attempt4.required.join("\n")).toMatch(/Show a different validated view/);
    expect(result.packet.humanReviewReady).toBe(false);
  });
});

describe("the revised concept passes both #6 and #1", () => {
  it("has no finding of any kind, and is contract eligible", async () => {
    const result = await evaluate(workflow());
    expect(result.attempts).toBe(LATEST);
    const revised = result.concept(REVISED);
    expect(revised.contractEligible).toBe(true);
    expect(revised.required).toEqual([]);
    expect(revised.missionBlockers).toEqual([]);
    expect(revised.blockedOutsideAuthor).toEqual([]);
    const proposal = result.pass.result.proposals.find((entry) => entry.concept.conceptId === REVISED)!;
    // The disclosures ride in the persistent overlay, verbatim, not in any caption.
    // Only the estimate disclosure: Compare shows no range, so "The range shown..." would be false.
    expect(proposal.storyboard.persistentDisclosures).toEqual([CREATIVE_DISCLOSURES["disclosure.fps-estimate"]]);
    for (const beat of proposal.storyboard.beats) expect(beat.onScreenText).not.toMatch(/model convention|measured benchmarks/);
    // The claim beat shows the view the claim was established for.
    const claimBeat = proposal.concept.beats.findIndex((beat) => beat.factDependencies.length > 0);
    const shown = proposal.concept.visuals.find((visual) => visual.visualId === proposal.concept.beats[claimBeat].visualIds[0]);
    expect(shown).toMatchObject({ stateIdentifier: PRIMARY });
  });

  it("the batch is still not ready: the other two concepts have their own #1 fixes", async () => {
    const result = await evaluate(workflow());
    for (const id of ["claude-batch-commit-first", "claude-batch-vanishing-gap"]) {
      expect(dimensions(result.concept(id).required)).toContain("hook-duration");
    }
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.packet.approved).toBe(false);
    await expect(buildConceptHandoff({ directory: workflow(), mission: DEMO_MISSION, conceptId: REVISED })).rejects.toThrow(/not ready for human review/);
  });
});

describe("controls", () => {
  it("repeated visual: one capture under four visual ids is still one picture", async () => {
    const dir = workflow();
    editRevised(dir, (concept) => ({ ...concept, visuals: concept.visuals.map((visual) => ({ ...visual, stateIdentifier: PRIMARY })) }));
    const revised = (await evaluate(dir)).concept(REVISED);
    expect(dimensions(revised.required)).toEqual(expect.arrayContaining(["shot-uniqueness"]));
  });

  it("a claim over a view it was not established for is refused", async () => {
    const dir = workflow();
    // The range claim was established at 1440p High. It happens to hold at 4K Ultra as well, but nothing
    // checked that, and at 4K High one game's gap equals the declared half-range: the rule is the view, not luck.
    editRevised(dir, withBeat(2, { visualIds: ["checklist-4k-ultra"] }));
    const result = await evaluate(dir);
    const revised = result.concept(REVISED);
    expect(revised.contractEligible).toBe(false);
    expect(revised.required.join("\n")).toMatch(/Beat 3 states a claim while showing a view other than the primary one/);
  });

  it("a view the mission did not validate is refused", async () => {
    const dir = workflow();
    editRevised(dir, (concept) => ({ ...concept, visuals: concept.visuals.map((visual) =>
      visual.visualId === "checklist-1080p-low" ? { ...visual, stateIdentifier: PRIMARY.replace("1440p_high", "4k_low") } : visual) }));
    const revised = (await evaluate(dir)).concept(REVISED);
    expect(revised.contractEligible).toBe(false);
    expect(revised.required.join("\n")).toMatch(/one of the brief's validated views/);
  });

  it("with a single validated view, the repetition is the mission's to fix, and still blocks", async () => {
    const singleView = { ...DEMO_MISSION, additionalViews: [] };
    const dir = correctAttempt(workflow(4), 4);
    const result = await evaluate(dir, singleView);
    const attempt4 = result.concept(REVISED);
    expect(dimensions(attempt4.blockedOutsideAuthor)).toEqual(["shot-uniqueness", "visual-repetition"]);
    expect(attempt4.blockedOutsideAuthor.join("\n")).toMatch(/mission must list further validated views/);
    // The same packet with every other item cleared is still not ready.
    const feedback = { ...result.feedback!, concepts: result.feedback!.concepts.map((concept) => ({ ...concept, required: [], missionBlockers: [] })) };
    const packet = (feedbackIn: typeof feedback) => buildReviewPacket({ brief: result.brief, attempt: result.attempts, generatorName: "local-file-authored-batch",
      status: "awaiting-human-review", result: result.pass.result, batchHash: result.packet.batchHash, feedback: feedbackIn });
    expect(packet(feedback).humanReviewReady).toBe(false);
    expect(packet({ ...feedback, concepts: feedback.concepts.map((concept) => ({ ...concept, blockedOutsideAuthor: [] })) }).humanReviewReady).toBe(true);
  });

  it("no score outweighs an open fix: a strong review with one fix still blocks", async () => {
    const dir = workflow();
    editRevised(dir, withBeat(4, { narration: "Open the comparison and run all three checks.", onScreenText: "Run the three checks" }));
    const result = await evaluate(dir);
    const proposal = result.pass.result.proposals.find((entry) => entry.concept.conceptId === REVISED)!;
    expect(reviewStoryboard({ reviewId: REVISED, storyboard: proposal.storyboard, ctaRoute: "/compare" }).productionQualityScore).toBeGreaterThanOrEqual(7);
    expect(dimensions(result.concept(REVISED).required)).toEqual(["cta-clarity"]);
  });
});

describe("a newly introduced #1 failure is caught", () => {
  it.each([
    ["a hook stretched past the envelope", "hook-duration", (concept: CreativeConcept) => withBeat(1, { startSecond: 5 })(withBeat(0, { endSecond: 5 })(concept))],
    ["a caption too long for two rendered lines", "caption-density", withBeat(2, { onScreenText: "Is the per-game gap on this page bigger than the range the model declares for its own estimates?" })],
    ["narration too dense to follow", "information-density", withBeat(1, { narration: "First, set the resolution you actually play at. Here the page is switched to 1080p, so write it down now and hold yourself to it when the bars appear." })],
  ])("%s", async (_label, dimension, edit) => {
    const dir = workflow();
    editRevised(dir, edit);
    const result = await evaluate(dir);
    expect(dimensions(result.concept(REVISED).required)).toContain(dimension);
    expect(result.packet.machineChecksPassed).toBe(false);
  });
});

describe("the generation pass's own status", () => {
  const batch = (attempt: number) => {
    const directory = join(DEMO_WORKFLOW_DIRECTORY, "batches", `attempt-${attempt}`);
    return readdirSync(directory).filter((name) => name.endsWith(".json")).sort()
      .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as CreativeConcept);
  };

  it("never claims awaiting-human-review for a batch the combined checks refuse", async () => {
    // Attempt 3, range sentence corrected, is contract eligible under #6's proposal pass, and fails #1.
    const result = await runCreativeGenerationPass(DEMO_MISSION, { name: "attempt-3-replay", async generate() { return batch(3).map(withoutAbsentRange); } }, { maxAttempts: 1 });
    expect(result.result.proposals.every((proposal) => proposal.contractEligible)).toBe(true);
    expect(result.status).not.toBe("awaiting-human-review");
    expect(result.status).toBe("blocked-revision");
    expect(result.history[0].feedback.join("\n")).toMatch(/MASTER #1 storyboard review \[hook-duration\]/);
  });

  it("feeds the combined findings back to the generator on the next attempt", async () => {
    const seen: string[][] = [];
    await runCreativeGenerationPass(DEMO_MISSION, { name: "replay", async generate(request) { seen.push([...request.feedback]); return batch(LATEST); } }, { maxAttempts: 2 });
    expect(seen[1].join("\n")).toMatch(/claude-batch-commit-first: MASTER #1 storyboard review/);
    expect(seen[1].join("\n")).not.toMatch(/claude-batch-three-checks: MASTER #1/);
  });
});

describe("honest limits", () => {
  it("says passing text and timing checks proves nothing about the rendered video, and keeps every human gate", async () => {
    const result = await evaluate(workflow());
    expect(result.packet.notes.join(" ")).toMatch(/does not show that a rendered video looks or sounds good/);
    expect(result.packet.outstandingApprovals).toEqual(OUTSTANDING_HUMAN_APPROVALS);
    expect(result.packet.syntheticResearch).toBe(true);
    const review = reviewStoryboard({ reviewId: REVISED, storyboard: result.pass.result.proposals[1].storyboard, ctaRoute: "/compare" });
    expect(review.mediaSha256).toBeNull();
    for (const dimension of ["composition-quality", "visual-polish", "voice-naturalness", "overall-perceived-production-quality"]) {
      expect(review.overall.find((score) => score.dimension === dimension)?.provenance).toBe("not-assessed");
    }
  });
});
