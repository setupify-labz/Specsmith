#!/usr/bin/env tsx
// The next SpecSmith Short, through the existing MASTER #2 -> #6 path:
//
//   research (runGpuUpgradeResearch, production, computed from the shipped model)
//     -> mission (one Compare state, the claims hold for it)
//     -> #174's published-post report enters as next-brief memory (nextBriefForWorkflow)
//     -> runCreativeFileWorkflow: export the brief, import the three authored
//        concepts in ./workflow/batches, run every evidence and production gate,
//        write feedback and the review packet.
//
//   pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/workflowCli.ts [brief|review]
//
// Nothing here renders, calls a voice provider, spends, schedules or publishes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCreativeFileWorkflow } from "../v2/creative/fileWorkflowPass.ts";
import type { CreativeMissionInput } from "../v2/creative/proposalPass.ts";
import type { ExternalPostReport } from "../v2/publication/externalPosts.ts";
import { nextBriefForWorkflow } from "../v2/publication/nextBrief.ts";
import { formatResearchReport } from "../v2/research/researchPass.ts";
import { GPU_UPGRADE_PAIRING, modelContentHash, QUESTION_ID, REFUSED_ANGLES, runGpuUpgradeResearch } from "./research.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKFLOW_DIRECTORY = join(here, "workflow");
export const PUBLISHED_POST_REPORT = join(here, "..", "v2", "publication", "examples", "published-posts-report.json");

/**
 * When this research was run. Recorded, not backdated: the brief hash depends
 * on it, so it is pinned to the one run the concepts were authored against.
 * The model hash below is re-checked on every run, so pinning the time can
 * never keep a stale estimate alive.
 */
export const RESEARCH_RUN_AT = new Date("2026-10-06T18:59:00.000Z");
export const RESEARCH_MODEL_HASH = "f434ab70dde4e6fa";

export function gpuUpgradeMission() {
  const { result, facts, modelHash } = runGpuUpgradeResearch(RESEARCH_RUN_AT);
  if (!modelHash.combined.startsWith(RESEARCH_MODEL_HASH)) {
    throw new Error(`The model or catalog changed since this research ran (now ${modelHash.combined.slice(0, 16)}, was ${RESEARCH_MODEL_HASH}). Re-run the research and re-author against the new numbers.`);
  }
  if (result.containsSyntheticEvidence) throw new Error("This mission must rest on production research.");
  const mission: Omit<CreativeMissionInput, "concepts"> = {
    missionId: QUESTION_ID,
    viewerQuestion: "Will a new GPU make every game faster by the same amount?",
    productDestination: "/compare",
    renderRequest: {
      captureType: "static",
      state: { surface: "compare", ...GPU_UPGRADE_PAIRING },
    },
    research: result.contract,
    researchSynthetic: false,
    allowSynthetic: false,
    memory: [],
    retrieval: { kind: "explanatory-structure", allowSynthetic: false },
    platform: "youtube-shorts",
    // Two more real states of the same pair, for beats that state no claim (the
    // claims hold for the primary 1440p High view only). The model's per-game
    // after/before ratio is the same at every resolution, so these views show
    // the same pattern; no beat may quote their numbers.
    additionalViews: [
      { resolution: "1080p", preset: "high" },
      { resolution: "4k", preset: "high" },
      { resolution: "1440p", preset: "ultra" },
      { resolution: "1080p", preset: "ultra" },
    ],
  };
  return { mission, result, facts, modelHash };
}

/** #174's report: the published-post learning, as next-brief input. */
export function publishedPostLearning(mission: Omit<CreativeMissionInput, "concepts">) {
  const report = JSON.parse(readFileSync(PUBLISHED_POST_REPORT, "utf8")) as ExternalPostReport;
  // Refuses simulated performance data for a production mission.
  const handoff = nextBriefForWorkflow(report.nextBrief, mission);
  return { report, handoff };
}

export async function runGpuUpgradeWorkflow(command: "brief" | "review") {
  const { mission, result, modelHash } = gpuUpgradeMission();
  const { report, handoff } = publishedPostLearning(mission);
  const workflow = await runCreativeFileWorkflow(WORKFLOW_DIRECTORY, mission, {
    exportOnly: command === "brief",
    memoryObservations: handoff.brief.memoryObservations,
  });
  writeFileSync(join(WORKFLOW_DIRECTORY, "research-report.txt"), [
    formatResearchReport(result),
    "",
    `Model files (sha256): ${JSON.stringify(modelHash.files, null, 2)}`,
    "",
    "Refused angles (not in the contract, so no concept may use them):",
    ...REFUSED_ANGLES.map((entry) => `  - ${entry.angle} ${entry.why}`),
    "",
    `Learning input: published-post report ${report.reportId} (posts ${handoff.evidence.providerPostIds.join(", ")}; trusted observations ${handoff.evidence.observationIds.length}).`,
    "",
  ].join("\n"));
  return { workflow, mission, result, report, handoff };
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const command = (process.argv[2] ?? "review") as "brief" | "review";
  if (command !== "brief" && command !== "review") throw new Error('Use "brief" or "review".');
  const { workflow } = await runGpuUpgradeWorkflow(command);
  console.log(`Brief ${workflow.brief.briefHash}: ${workflow.brief.approvedClaims.length} approved claim(s).`);
  console.log(`Workflow status: ${workflow.workflowStatus}. ${workflow.workflowReason}`);
  for (const entry of workflow.feedback) {
    for (const concept of entry.concepts) {
      console.log(`  ${concept.conceptId}: contract eligible ${concept.contractEligible}`);
      for (const item of concept.missionBlockers) console.log(`    MISSION   ${item}`);
      for (const item of concept.required) console.log(`    REQUIRED  ${item}`);
      for (const item of concept.blockedOutsideAuthor) console.log(`    BLOCKED   ${item}`);
      for (const item of concept.advisory) console.log(`    advisory  ${item}`);
    }
    console.log(`  next step: ${entry.nextStep}`);
  }
  console.log(`machine checks passed: ${workflow.packet.machineChecksPassed}; human review ready: ${workflow.packet.humanReviewReady}; approved: ${workflow.packet.approved}`);
}
