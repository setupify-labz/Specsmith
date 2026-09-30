// Human-review readiness in the MASTER #6 file workflow must rest on research
// the mission truthfully describes, and on concepts that were actually checked.
// Each case below reached a ready state before its fix.

import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_MISSION, DEMO_RESEARCH, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { SYNTHETIC_EVIDENCE_LIMITATION } from "../research/creativeContract.ts";
import type { CreativeConcept } from "./concept.ts";
import { runCreativeFileWorkflow } from "./fileWorkflowPass.ts";
import { runCreativeGenerationPass } from "./generationPass.ts";
import { runCreativeProposalPass } from "./proposalPass.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A scratch copy of the committed workflow directory, whose attempt-3 batch passes every machine check. */
function workflowCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "file-workflow-"));
  dirs.push(dir);
  cpSync(DEMO_WORKFLOW_DIRECTORY, dir, { recursive: true });
  return dir;
}

const attempt3 = (): CreativeConcept[] => {
  const batch = join(DEMO_WORKFLOW_DIRECTORY, "batches", "attempt-3");
  return readdirSync(batch).filter((name) => name.endsWith(".json")).sort()
    .map((name) => JSON.parse(readFileSync(join(batch, name), "utf8")) as CreativeConcept);
};

const asProduction = { researchSynthetic: false, allowSynthetic: false, retrieval: { ...DEMO_MISSION.retrieval, allowSynthetic: false } };

describe("synthetic research cannot be relabelled as production", () => {
  it("the committed synthetic mission still reaches human review, labelled synthetic", async () => {
    const result = await runCreativeFileWorkflow(workflowCopy(), DEMO_MISSION);
    expect(result.packet.humanReviewReady).toBe(true);
    expect(result.packet.syntheticResearch).toBe(true);
    expect(result.packet.approved).toBe(false);
  });

  it("refuses the same synthetic contract when the mission declares it production research", async () => {
    await expect(runCreativeFileWorkflow(workflowCopy(), { ...DEMO_MISSION, ...asProduction })).rejects.toThrow(/declares synthetic evidence/);
  });

  it("recognises the research pipeline's own synthetic marker, not only the fixture's naming", () => {
    const pipelineMarked = {
      ...DEMO_RESEARCH,
      questionId: "compare-estimate-limits",
      limitations: [SYNTHETIC_EVIDENCE_LIMITATION],
      safeClaims: DEMO_RESEARCH.safeClaims.map((claim, index) => ({ ...claim, claimId: `claim-${index}`, supportingSnapshotIds: ["snap-1"] })),
    };
    expect(() => runCreativeProposalPass({ ...DEMO_MISSION, ...asProduction, research: pipelineMarked, concepts: [] })).toThrow(/declares synthetic evidence/);
  });
});

describe("the generation pass never reports review-ready with nothing checked", () => {
  it("blocks before calling the generator when every grounded claim is in an unsafe state", async () => {
    const unsafeOnly = {
      ...DEMO_RESEARCH,
      // Snapshots attached, but every claim is in a state that may not be said.
      safeClaims: DEMO_RESEARCH.safeClaims.map((claim) => ({ ...claim, state: "requires-human-judgment" as const })),
    };
    let generatorCalls = 0;
    const pass = await runCreativeGenerationPass({ ...DEMO_MISSION, research: unsafeOnly }, {
      name: "attempt-3-replay",
      async generate() { generatorCalls += 1; return attempt3(); },
    }, { maxAttempts: 1 });
    expect(pass.result.proposals).toHaveLength(0);
    expect(pass.status).not.toBe("awaiting-human-review");
    expect(pass.status).toBe("blocked-evidence");
    expect(generatorCalls).toBe(0);
  });
});
