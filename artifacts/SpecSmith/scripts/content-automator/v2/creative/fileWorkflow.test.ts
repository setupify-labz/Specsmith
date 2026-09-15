// MASTER #6 — Local file-based creative workflow tests.
//
// Two things must hold no matter what a file on disk contains:
//   1. Malformed input is refused at the boundary, never coerced into a default.
//   2. Authorship buys nothing. A hand-written concept passes the same evidence
//      gate a provider's output would, and failing it blocks the batch.
//
// A third thing must hold no matter what passes: readiness is not approval.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import {
  CreativeImportError,
  importAuthoredBatch,
  latestAuthoredAttempt,
  OUTSTANDING_HUMAN_APPROVALS,
  parseAuthoredConcept,
  WORKFLOW_PATHS,
} from "./fileWorkflow.ts";
import { runCreativeFileWorkflow } from "./fileWorkflowPass.ts";
import type { CreativeMissionInput } from "./proposalPass.ts";

const STATE = "compare_rtx5060ti_i3-13100f_vs_rtx4060ti_r5-9600x_1440p_high_static_540x960-2";
const CLAIM = "SYNTHETIC_TEST_FIXTURE-range-limit";
const REFUSED = "SYNTHETIC_TEST_FIXTURE-better-buy";
const QUESTION = "Different parts. What do these model estimates actually establish?";
const DISCLOSURES = [
  "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.",
  "The range shown is a model convention, not measured or calibrated uncertainty.",
];
const ANSWER =
  "On this comparison every per-game difference is smaller than the range SpecSmith's model declares for its own " +
  "estimates, so the model does not separate them on frame rate. These are model estimates.";

const RESEARCH: ResearchCreativeContract = {
  version: "research-creative-contract-v1",
  questionId: "SYNTHETIC_TEST_FIXTURE-question",
  generatedAt: "2026-09-15T12:00:00.000Z",
  safeClaims: [
    {
      claimId: CLAIM,
      proposition: ANSWER,
      state: "known",
      requiredWording: ["model estimates"],
      supportingSnapshotIds: ["SYNTHETIC_TEST_FIXTURE-snapshot"],
    },
  ],
  unsafeClaims: [
    {
      claimId: REFUSED,
      proposition: "The RTX 5060 Ti machine is the better buy.",
      state: "requires-human-judgment",
      reason: "A purchase recommendation depends on price, availability and the viewer's own library.",
      wouldBecomeSafeIf: ["A live retail price and a stated buyer profile were both established."],
    },
  ],
  disputedClaims: [],
  groundedHookMaterial: [],
  openQuestions: [],
  limitations: ["SYNTHETIC TEST FIXTURE."],
  overallState: "known",
};

function mission(overrides: Partial<Omit<CreativeMissionInput, "concepts">> = {}): Omit<CreativeMissionInput, "concepts"> {
  return {
    missionId: "SYNTHETIC_TEST_FIXTURE-mission",
    viewerQuestion: QUESTION,
    productDestination: "/compare",
    renderRequest: {
      captureType: "static",
      state: {
        surface: "compare",
        gpuA: "rtx5060ti",
        cpuA: "i3-13100f",
        gpuB: "rtx4060ti",
        cpuB: "r5-9600x",
        resolution: "1440p",
        preset: "high",
      },
    },
    research: RESEARCH,
    researchSynthetic: true,
    allowSynthetic: true,
    memory: [],
    retrieval: { kind: "explanatory-structure", allowSynthetic: true },
    platform: "youtube-shorts",
    ...overrides,
  };
}

interface TreatmentCopy {
  readonly hook: { readonly narration: string; readonly onScreenText: string };
  readonly close: { readonly narration: string; readonly onScreenText: string };
}

function concept(
  id: string,
  audienceExperience: string,
  explanatoryStructure: string,
  takeaway: string,
  copy: TreatmentCopy,
): unknown {
  const visualId = `${id}-capture`;
  const beats = [
    {
      purpose: "hook",
      startSecond: 0,
      endSecond: 6,
      narration: copy.hook.narration,
      onScreenText: copy.hook.onScreenText,
      visualIds: [visualId],
      factDependencies: [],
    },
    {
      purpose: "evidence",
      startSecond: 6,
      endSecond: 20,
      narration: ANSWER,
      onScreenText: "Inside the model's own range",
      visualIds: [visualId],
      factDependencies: [CLAIM],
    },
    {
      purpose: "cta",
      startSecond: 20,
      endSecond: 26,
      narration: copy.close.narration,
      onScreenText: copy.close.onScreenText,
      visualIds: [visualId],
      factDependencies: [],
    },
  ];
  return {
    conceptId: id,
    axes: { audienceExperience, explanatoryStructure, visualMechanism: "single-surface-hold" },
    viewerQuestion: QUESTION,
    viewerTakeaway: takeaway,
    productDestination: "/compare",
    visuals: [{ kind: "real-product-capture", visualId, surface: "compare", stateIdentifier: STATE }],
    requiredCapabilities: [
      { capabilityId: "render.compare-surface-capture", description: "Existing deterministic Compare UI capture." },
    ],
    requiredDisclosures: ["disclosure.fps-estimate", "disclosure.model-range"],
    beats,
    disclosureTextByBeat: { 0: DISCLOSURES, 1: DISCLOSURES, 2: DISCLOSURES },
  };
}

// Genuinely different treatments, not three labels on one script. The
// divergence check compares the actual beats, so a lazy fixture here would
// test nothing.
function validBatch(): unknown[] {
  return [
    concept("t-predict", "participant", "prediction-then-reveal", "I can tell when a page has not settled my question.", {
      hook: {
        narration: "Different parts. Before you read the bars, say out loud which side you expect to come out ahead.",
        onScreenText: "Commit to an answer first",
      },
      close: {
        narration: "Whichever side you picked, this page did not settle it. Open the comparison and see for yourself.",
        onScreenText: "Undecided is a result",
      },
    }),
    concept("t-investigate", "investigator", "question-evidence-boundary", "I have a repeatable check for close numbers.", {
      hook: {
        narration: "Here is a short check you can run on any comparison page, starting with the page in front of you.",
        onScreenText: "Question, evidence, boundary",
      },
      close: {
        narration: "Name what is still unsettled before you decide anything. Run that check wherever you compare parts.",
        onScreenText: "Run the check",
      },
    }),
    concept("t-watch", "spectator", "continuum-then-falsification", "I can spot a gap too small for its own estimate.", {
      hook: {
        narration: "These bars are different lengths. That is not the same as a difference the model can stand behind.",
        onScreenText: "Different bars, same conclusion",
      },
      close: {
        narration: "A longer bar is not evidence that one side is faster. Ask how wide each number is.",
        onScreenText: "Ask how wide the number is",
      },
    }),
  ];
}

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "specsmith-creative-workflow-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writeBatch(attempt: number, concepts: readonly unknown[]): void {
  const target = join(directory, WORKFLOW_PATHS.batches, `attempt-${attempt}`);
  mkdirSync(target, { recursive: true });
  concepts.forEach((entry, index) => {
    writeFileSync(join(target, `${index + 1}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  });
}

function writeRaw(attempt: number, files: Readonly<Record<string, string>>): void {
  const target = join(directory, WORKFLOW_PATHS.batches, `attempt-${attempt}`);
  mkdirSync(target, { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(target, name), contents, "utf8");
}

describe("exporting the brief", () => {
  it("writes the brief, the schema and an authoring guide, and approves nothing", async () => {
    const result = await runCreativeFileWorkflow(directory, mission(), { exportOnly: true });
    expect(result.written).toContain(WORKFLOW_PATHS.brief);
    expect(result.written).toContain(WORKFLOW_PATHS.schema);
    expect(result.written).toContain(WORKFLOW_PATHS.authoring);
    expect(result.packet.approved).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
  });

  it("carries only approved claims, and names what research refused", async () => {
    const result = await runCreativeFileWorkflow(directory, mission(), { exportOnly: true });
    expect(result.brief.approvedClaims.map((claim) => claim.claimId)).toEqual([CLAIM]);
    expect(result.brief.refusedClaims.map((claim) => claim.claimId)).toEqual([REFUSED]);
  });

  it("tells an author to stop when research approved nothing", async () => {
    const empty = mission({ research: { ...RESEARCH, safeClaims: [] } });
    const result = await runCreativeFileWorkflow(directory, empty, { exportOnly: true });
    expect(result.brief.approvedClaims).toEqual([]);
    const guide = readFileSync(join(directory, WORKFLOW_PATHS.authoring), "utf8");
    expect(guide).toMatch(/\*\*Nothing\.\*\*/);
    expect(guide).toMatch(/fabricating the answer/);
  });

  it("is deterministic: the same mission produces the same brief hash", async () => {
    const first = await runCreativeFileWorkflow(directory, mission(), { exportOnly: true });
    const second = await runCreativeFileWorkflow(directory, mission(), { exportOnly: true });
    expect(second.brief.briefHash).toBe(first.brief.briefHash);
  });
});

describe("malformed authored input is refused at the boundary", () => {
  it("rejects a file that is not JSON", () => {
    writeRaw(1, { "a.json": "{ not json", "b.json": "{}", "c.json": "{}" });
    expect(() => importAuthoredBatch(directory, 1)).toThrow(/is not valid JSON/);
  });

  it("rejects a batch that is not exactly three concepts", () => {
    writeBatch(1, validBatch().slice(0, 2));
    expect(() => importAuthoredBatch(directory, 1)).toThrow(/exactly three concept files; found 2/);
  });

  it("rejects two concepts sharing a conceptId", () => {
    const batch = validBatch();
    writeBatch(1, [batch[0], batch[0], batch[2]]);
    expect(() => importAuthoredBatch(directory, 1)).toThrow(/share a conceptId/);
  });

  it("reports a missing batch rather than inventing an empty one", () => {
    expect(() => importAuthoredBatch(directory, 7)).toThrow(/No authored batch found/);
  });

  it.each([
    ["conceptId", { conceptId: "" }, /conceptId must be a non-empty string/],
    ["beats", { beats: [] }, /beats must not be empty/],
    ["visuals", { visuals: "lots" }, /visuals must be an array/],
    ["axes", { axes: { audienceExperience: "chef", explanatoryStructure: "prediction-then-reveal", visualMechanism: "single-surface-hold" } }, /axes.audienceExperience must be one of/],
    ["requiredDisclosures", { requiredDisclosures: [1] }, /requiredDisclosures\[0\] must be a non-empty string/],
  ])("rejects a malformed %s instead of defaulting it", (_label, overrides, expected) => {
    const broken = { ...(validBatch()[0] as Record<string, unknown>), ...overrides };
    expect(() => parseAuthoredConcept(broken, "broken.json")).toThrow(expected);
  });

  it("rejects a non-finite beat time rather than coercing it to zero", () => {
    const base = validBatch()[0] as Record<string, unknown>;
    const beats = (base.beats as Record<string, unknown>[]).map((beat, index) =>
      index === 0 ? { ...beat, startSecond: "soon" } : beat,
    );
    expect(() => parseAuthoredConcept({ ...base, beats }, "broken.json")).toThrow(
      /beats\[0\].startSecond must be a finite number/,
    );
  });

  it("rejects a disclosure table keyed to a beat that does not exist", () => {
    const base = validBatch()[0] as Record<string, unknown>;
    expect(() => parseAuthoredConcept({ ...base, disclosureTextByBeat: { 9: DISCLOSURES } }, "broken.json")).toThrow(
      /is not the index of a beat/,
    );
  });

  it("rejects a visual this adapter could never render, rather than importing a dead concept", () => {
    const base = validBatch()[0] as Record<string, unknown>;
    const visuals = [
      { kind: "derived-illustration", visualId: "x", explains: "y", subject: "fps", explanatoryLabel: null, derivedFrom: null, showsNumericValues: false },
    ];
    expect(() => parseAuthoredConcept({ ...base, visuals }, "broken.json")).toThrow(/must be "real-product-capture"/);
  });

  it("throws a typed error naming the file, so an author knows which one to fix", () => {
    try {
      parseAuthoredConcept({}, "03-vanishing-gap.json");
      expect.unreachable("expected a CreativeImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(CreativeImportError);
      expect((error as CreativeImportError).source).toBe("03-vanishing-gap.json");
      expect((error as Error).message).toMatch(/^03-vanishing-gap\.json: /);
    }
  });

  it("does not approve anything when the batch cannot be read", async () => {
    writeRaw(1, { "a.json": "{ not json", "b.json": "{}", "c.json": "{}" });
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.packet.approved).toBe(false);
    expect(result.packet.batchHash).toBeNull();
  });
});

describe("authorship buys nothing: the evidence gate still decides", () => {
  it("blocks a batch that asserts a claim research refused", async () => {
    const batch = validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      const beats = (record.beats as Record<string, unknown>[]).map((beat, index) =>
        index === 0 ? { ...beat, narration: "The RTX 5060 Ti machine is the better buy." } : beat,
      );
      return { ...record, beats };
    });
    writeBatch(1, batch);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.status).not.toBe("awaiting-human-review");
    expect(result.packet.machineChecksPassed).toBe(false);
    const required = result.feedback[0].concepts.flatMap((entry) => entry.required);
    expect(required.join(" ")).toMatch(/Evidence gate hard-fail/);
    expect(required.join(" ")).toMatch(/better buy/);
  });

  it("blocks a batch that binds a beat to a claimId research never approved", async () => {
    const batch = validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      const beats = (record.beats as Record<string, unknown>[]).map((beat) =>
        beat.factDependencies !== undefined && (beat.factDependencies as string[]).length > 0
          ? { ...beat, factDependencies: ["fabricated-claim"] }
          : beat,
      );
      return { ...record, beats };
    });
    writeBatch(1, batch);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.feedback[0].concepts.every((entry) => !entry.contractEligible)).toBe(true);
  });

  it("never calls the file generator at all when research approved nothing", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission({ research: { ...RESEARCH, safeClaims: [] } }));
    expect(result.status).toBe("blocked-evidence");
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.feedback[0]?.nextStep ?? "").not.toMatch(/ready for human review/);
  });

  it("blocks a batch whose visuals name a capture state the mission did not validate", async () => {
    const batch = validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      const visuals = (record.visuals as Record<string, unknown>[]).map((visual) => ({
        ...visual,
        stateIdentifier: "compare_something_else_1080p_low_static_540x960-2",
      }));
      return { ...record, visuals };
    });
    writeBatch(1, batch);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.machineChecksPassed).toBe(false);
  });

  it("blocks a batch whose treatments are relabelled duplicates, and says so at the set level", async () => {
    // Same script, three different axis labels and takeaways. Every concept
    // passes its own checks; only the set-level view catches it.
    const base = validBatch()[0] as Record<string, unknown>;
    writeBatch(1, [
      { ...base, conceptId: "dup-1", axes: { audienceExperience: "participant", explanatoryStructure: "prediction-then-reveal", visualMechanism: "single-surface-hold" }, viewerTakeaway: "One." },
      { ...base, conceptId: "dup-2", axes: { audienceExperience: "investigator", explanatoryStructure: "question-evidence-boundary", visualMechanism: "single-surface-hold" }, viewerTakeaway: "Two." },
      { ...base, conceptId: "dup-3", axes: { audienceExperience: "spectator", explanatoryStructure: "continuum-then-falsification", visualMechanism: "single-surface-hold" }, viewerTakeaway: "Three." },
    ]);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.feedback[0].setFindings.join(" ")).toMatch(/genuinely different/);
    expect(result.feedback[0].nextStep).not.toMatch(/ready for human review/);
  });

  it("separates a mission-level blocker from an author-actionable one", async () => {
    // The storyboard title is the mission's viewer question. An author cannot
    // edit it, so it must not be reported as something for them to rewrite.
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(
      directory,
      mission({ viewerQuestion: "Is the RTX 5060 Ti machine the better buy?" }),
    );
    const blockers = result.feedback[0].concepts.flatMap((entry) => entry.missionBlockers);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(" ")).toMatch(/mission must be re-specified/);
    expect(result.feedback[0].nextStep).toMatch(/cannot be authored as specified/);
  });
});

describe("readiness is not approval", () => {
  it("marks a clean batch ready for human review and still refuses to approve it", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.status).toBe("awaiting-human-review");
    expect(result.packet.machineChecksPassed).toBe(true);
    expect(result.packet.humanReviewReady).toBe(true);
    expect(result.packet.approved).toBe(false);
    expect(result.feedback[0].nextStep).toMatch(/It is NOT approved/);
  });

  it("names every approval a human still owes, including the untouched audio gate", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.outstandingApprovals).toEqual(OUTSTANDING_HUMAN_APPROVALS);
    expect(result.packet.outstandingApprovals.join(" ")).toMatch(/audio gate/i);
    expect(result.packet.outstandingApprovals.join(" ")).toMatch(/nothing here has been rendered/i);
  });

  it("says out loud that the checks do not measure originality or completeness", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.notes.join(" ")).toMatch(/do not measure originality/);
    expect(result.packet.notes.join(" ")).toMatch(/Authorship by a model is not evidence/);
  });

  it("marks a synthetic-research batch as such so it cannot be quoted as production evidence", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.packet.syntheticResearch).toBe(true);
    expect(result.packet.notes.join(" ")).toMatch(/never be presented as production creative evidence/);
  });
});

describe("the authoring loop", () => {
  it("serves the latest authored attempt and numbers feedback after it", async () => {
    writeBatch(1, validBatch());
    writeBatch(2, validBatch());
    expect(latestAuthoredAttempt(directory)).toBe(2);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.attempts).toBe(2);
    expect(result.feedback[0].attempt).toBe(2);
    expect(result.written).toContain(join(WORKFLOW_PATHS.feedback, "attempt-2.json"));
  });

  it("reports no authored attempt as zero rather than guessing", () => {
    expect(latestAuthoredAttempt(directory)).toBe(0);
    expect(latestAuthoredAttempt(join(directory, "nowhere"))).toBe(0);
  });

  it("writes feedback a human can act on without reading the code", async () => {
    writeBatch(1, validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      return { ...record, disclosureTextByBeat: {} };
    }));
    await runCreativeFileWorkflow(directory, mission());
    const markdown = readFileSync(join(directory, WORKFLOW_PATHS.feedback, "attempt-1.md"), "utf8");
    expect(markdown).toMatch(/Add the exact disclosure text to disclosureTextByBeat/);
    expect(markdown).toMatch(/## Next step/);
  });
});

describe("readiness accounts for checks the proposal pass does not know about", () => {
  it("refuses to call a batch ready while this workflow still has findings", async () => {
    // The proposal pass has no opinion about renderer deliverability, so on its
    // own it reports these treatments as accepted. Readiness must not inherit
    // that verdict while findings are outstanding.
    const batch = validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      const beats = (record.beats as Record<string, unknown>[]).map((beat, index) =>
        index === 0 ? { ...beat, narration: "Watch what happens to the bars on this page." } : beat,
      );
      return { ...record, beats };
    });
    writeBatch(1, batch);
    const result = await runCreativeFileWorkflow(directory, mission());

    expect(result.status).toBe("awaiting-human-review");
    expect(result.workflowStatus).toBe("revision-required");
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.feedback[0].concepts.flatMap((entry) => entry.required).join(" ")).toMatch(
      /promises-motion-from-a-still/,
    );
  });

  it("says plainly that the upstream status did not account for these checks", async () => {
    const batch = validBatch().map((entry) => {
      const record = entry as Record<string, unknown>;
      const beats = (record.beats as Record<string, unknown>[]).map((beat, index) =>
        index === 0 ? { ...beat, narration: "Watch what happens to the bars on this page." } : beat,
      );
      return { ...record, beats };
    });
    writeBatch(1, batch);
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.workflowReason).toMatch(/does not account for this workflow's own checks/);
  });

  it("reports ready only when nothing at all is outstanding", async () => {
    writeBatch(1, validBatch());
    const result = await runCreativeFileWorkflow(directory, mission());
    expect(result.workflowStatus).toBe("ready-for-human-review");
    expect(result.packet.machineChecksPassed).toBe(true);
    expect(result.packet.approved).toBe(false);
  });

  it("tells the author what the capture will and will not show", async () => {
    const result = await runCreativeFileWorkflow(directory, mission(), { exportOnly: true });
    expect(result.brief.captureType).toBe("static");
    expect(result.brief.captureDoesNotShow.join(" ")).toMatch(/estimate range/);
    expect(result.brief.captureDoesNotShow.join(" ")).toMatch(/any price/);
    const guide = readFileSync(join(directory, WORKFLOW_PATHS.authoring), "utf8");
    expect(guide).toMatch(/single frame/);
    expect(guide).toMatch(/What it will NOT show/);
  });
});
