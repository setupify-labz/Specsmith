// The MASTER #6 -> MASTER #1 handoff: a concept that passed the file
// workflow's machine checks becomes a creative report that carries every
// upstream identity, and "ready for human review" never becomes approved or
// publish ready by inference.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { NO_TRUSTED_APPROVAL_RECORD, type HumanGate } from "../contentCreativeReport.ts";
import { verifyRenderedMedia, MediaVerificationError } from "../mediaVerification.ts";
import {
  buildConceptHandoff,
  buildHandoffCreativeReport,
  ConceptHandoffError,
  gateIdFor,
  isConceptHandoff,
  RENDER_PROVENANCE_GAP,
  SYNTHETIC_RESEARCH_BLOCKER,
} from "./conceptHandoff.ts";

// These tests exercise the handoff and the report built from it. MASTER #1's
// storyboard gate is stubbed to report nothing, because no compare concept can
// pass it today (the required disclosure lines overflow the caption, and one
// capture repeats on every beat), so without the stub no handoff could be issued
// and this stage would be untested. The report still runs #1's review itself. The real gate is tested, unstubbed, in
// ../creative/storyboardQualityGate.test.ts.
vi.mock("../creative/storyboardQualityGate.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../creative/storyboardQualityGate.ts")>();
  return { ...actual, storyboardQualityFindings: (input: Parameters<typeof actual.storyboardQualityFindings>[0]) =>
    ({ ...actual.storyboardQualityFindings(input), required: [], blockedOutsideAuthor: [] }) };
});

const NOW = new Date("2026-09-30T12:00:00.000Z");
const CHOSEN = "claude-batch-three-checks";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "handoff-")); dirs.push(dir); return dir; };
/** A copy of the committed workflow directory. Its latest batch (attempt 4) passes every #6 check; #1's gate is stubbed above. */
const workflow = () => { const dir = scratch(); cpSync(DEMO_WORKFLOW_DIRECTORY, dir, { recursive: true }); return dir; };
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fakeRender = (bytes = "stand-in bytes, not a render of anything") => { const path = join(scratch(), "render.mp4"); writeFileSync(path, bytes); return path; };
const handoff = (directory = workflow()) => buildConceptHandoff({ directory, mission: DEMO_MISSION, conceptId: CHOSEN, now: NOW });

describe("with #1's gate stubbed, a concept that passed #6 reaches human review and stops there", () => {
  it("carries every identity, recomputed rather than read from the packet", async () => {
    const result = await handoff();
    expect(isConceptHandoff(result)).toBe(true);
    expect(result.status).toBe("human-review-ready");
    expect(result.approved).toBe(false);
    const id = result.identities;
    expect(id.researchContractSha256).toBe(sha(DEMO_MISSION.research));
    expect(id.missionId).toBe(DEMO_MISSION.missionId);
    expect(id.syntheticResearch).toBe(true);
    expect(id.batch.attempt).toBe(4);
    // The committed packet's batch hash: the same bytes the workflow reviewed.
    expect(id.batch.batchHash).toBe(JSON.parse(readFileSync(join(DEMO_WORKFLOW_DIRECTORY, "review-packet.json"), "utf8")).batchHash);
    expect(id.concept.conceptId).toBe(CHOSEN);
    expect(id.concept.conceptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(id.storyboardSha256).toBe(sha(result.storyboard));
    expect(result.conceptSelection).toMatchObject({ conceptId: CHOSEN, trusted: false });
  });

  it("with no render and no approvals, reports exactly what is missing", async () => {
    const report = buildHandoffCreativeReport({ handoff: await handoff(), media: null, now: NOW });
    expect(report.publishReady).toBe(false);
    expect(report.provenance).toMatchObject({ concept: { conceptId: CHOSEN } });
    const blocked = report.blockedBy.join("\n");
    expect(blocked).toContain("No rendered media: nothing exists to publish.");
    expect(blocked).toContain("quality review has no media binding");
    expect(blocked).toContain(SYNTHETIC_RESEARCH_BLOCKER);
    // Every #1 perceptual gate, the audio gate, #6's outstanding approvals and the concept choice: all undecided.
    for (const gate of ["audio-listening-review", "concept-selection", "creative-review", "rendered-media-review", "rights-and-disclosure-sign-off", "publishing-authorization"]) {
      expect(blocked).toContain(`Human gate not decided: ${gate}.`);
    }
  });
});

describe("the handoff refuses what the workflow did not establish", () => {
  it("refuses a batch that is not ready for human review", async () => {
    const dir = workflow();
    for (const attempt of [2, 3, 4]) rmSync(join(dir, "batches", `attempt-${attempt}`), { recursive: true });
    await expect(handoff(dir)).rejects.toThrow(/not ready for human review/);
  });

  it("refuses a concept that was not in the checked batch", async () => {
    await expect(buildConceptHandoff({ directory: workflow(), mission: DEMO_MISSION, conceptId: "not-authored", now: NOW })).rejects.toThrow(ConceptHandoffError);
  });

  it("refuses synthetic research labelled as production, and writes nothing", async () => {
    const dir = workflow();
    const before = readFileSync(join(dir, "brief.json"), "utf8");
    await expect(buildConceptHandoff({
      directory: dir, conceptId: CHOSEN, now: NOW,
      mission: { ...DEMO_MISSION, researchSynthetic: false, allowSynthetic: false, retrieval: { ...DEMO_MISSION.retrieval, allowSynthetic: false } },
    })).rejects.toThrow(/declares synthetic evidence/);
    expect(readFileSync(join(dir, "brief.json"), "utf8")).toBe(before);
  });

  it("does not trust a hand-edited review packet", async () => {
    const dir = workflow();
    for (const attempt of [3, 4]) rmSync(join(dir, "batches", `attempt-${attempt}`), { recursive: true });
    const packetPath = join(dir, "review-packet.json");
    writeFileSync(packetPath, JSON.stringify({ ...JSON.parse(readFileSync(packetPath, "utf8")), humanReviewReady: true, machineChecksPassed: true }));
    await expect(handoff(dir)).rejects.toThrow(/not ready for human review/);
  });

  it("refuses an outstanding approval it has no gate for, rather than dropping it", () => {
    expect(() => gateIdFor("Some new human sign-off")).toThrow(/Unknown outstanding approval/);
  });

  it("accepts only a handoff it issued, with the storyboard it hashed", async () => {
    const real = await handoff();
    expect(() => buildHandoffCreativeReport({ handoff: { ...real }, media: null, now: NOW })).toThrow(/not issued/);
    expect(isConceptHandoff(JSON.parse(JSON.stringify(real)))).toBe(false);
    expect(Object.isFrozen(real.storyboard) && Object.isFrozen(real.storyboard.beats[0])).toBe(true);
  });
});

describe("media and approvals through the handoff", () => {
  it("refuses a plausible hash for a file that does not exist", async () => {
    expect(() => verifyRenderedMedia(join(scratch(), "never-rendered.mp4"))).toThrow(MediaVerificationError);
    const forged = { path: "/nowhere/render.mp4", sha256: "e".repeat(64), bytes: 1, verifiedAt: NOW.toISOString() };
    const report = buildHandoffCreativeReport({ handoff: await handoff(), media: forged, now: NOW });
    expect(report.identity.mediaVerified).toBe(false);
    expect(report.blockedBy.join(" ")).toMatch(/not produced by verifyRenderedMedia/);
  });

  it("refuses a video changed after it was verified and reviewed", async () => {
    const path = fakeRender("as reviewed");
    const media = verifyRenderedMedia(path, NOW);
    writeFileSync(path, "edited afterwards");
    const report = buildHandoffCreativeReport({ handoff: await handoff(), media, now: NOW });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.join(" ")).toMatch(/changed after it was verified/);
  });

  it("binds the quality review to the verified bytes, and still names the render-provenance gap", async () => {
    const media = verifyRenderedMedia(fakeRender(), NOW);
    const report = buildHandoffCreativeReport({ handoff: await handoff(), media, now: NOW });
    expect(report.identity.mediaSha256).toBe(media.sha256);
    expect(report.identity.mediaVerified).toBe(true);
    expect(report.blockedBy.join(" ")).not.toMatch(/quality review has no media binding|measured other media/);
    expect(report.blockedBy).toContain(RENDER_PROVENANCE_GAP);
  });

  it("does not count an approval of a different render", async () => {
    const media = verifyRenderedMedia(fakeRender("this render"), NOW);
    const decisions: Record<string, HumanGate["decision"]> = {
      "concept-selection": { by: "aaron", at: NOW.toISOString(), outcome: "approved", mediaSha256: "f".repeat(64) },
    };
    const report = buildHandoffCreativeReport({ handoff: await handoff(), media, recordedHumanDecisions: decisions, now: NOW });
    expect(report.blockedBy).toContain("Human gate concept-selection: the approval was made about other media (or names none); approve these exact bytes.");
  });

  it("a concept that passed machine checks is not approved: every gate stays open, typed approvals included", async () => {
    const result = await handoff();
    const media = verifyRenderedMedia(fakeRender(), NOW);
    const bare = buildHandoffCreativeReport({ handoff: result, media, now: NOW });
    expect(bare.publishReady).toBe(false);
    expect(bare.humanGates.every((gate) => gate.decision === null)).toBe(true);
    // Even every gate "approved" by name and time for these exact bytes closes nothing.
    const typed = Object.fromEntries(bare.humanGates.map((gate) => [gate.gate, { by: "aaron", at: NOW.toISOString(), outcome: "approved" as const, mediaSha256: media.sha256 }]));
    const claimed = buildHandoffCreativeReport({ handoff: result, media, recordedHumanDecisions: typed, now: NOW });
    expect(claimed.publishReady).toBe(false);
    for (const gate of claimed.humanGates) expect(claimed.blockedBy).toContain(`Human gate ${gate.gate}: ${NO_TRUSTED_APPROVAL_RECORD}.`);
    expect(result.approved).toBe(false);
  });
});
