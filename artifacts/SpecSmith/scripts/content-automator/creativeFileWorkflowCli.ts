#!/usr/bin/env tsx
/**
 * MASTER #6 — Local file-based creative workflow CLI.
 *
 *   pnpm run content:creative:brief    exports the brief for authoring
 *   pnpm run content:creative:review   imports the authored batch and checks it
 *
 * Nothing here calls a provider, holds a credential, spends money, renders
 * media, schedules or publishes. The "generator" is a person or a model writing
 * JSON files into a directory.
 *
 * The research contract below is the repository's SYNTHETIC engineering
 * fixture: this repository has no production research evidence, and inventing
 * some to make the demonstration look better is exactly what must not happen.
 * Everything downstream is therefore labelled synthetic and may never be
 * presented as production creative evidence.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResearchCreativeContract } from "./v2/research/creativeContract.ts";
import { runCreativeFileWorkflow } from "./v2/creative/fileWorkflowPass.ts";
import type { CreativeMissionInput } from "./v2/creative/proposalPass.ts";

const here = dirname(fileURLToPath(import.meta.url));

export const DEMO_WORKFLOW_DIRECTORY = join(here, "fixtures", "creative-file-workflow");

/**
 * The claim the section-1 investigation actually established, expressed as a
 * research contract claim.
 *
 * It is marked synthetic because it was produced by an engineering fixture
 * path, not by the production research pipeline. The proposition itself is
 * derived from the shipped model in `src/lib/fps.ts`: every per-game gap
 * between the two same-price catalog builds falls inside the range the model
 * declares for its own estimates.
 */
export const DEMO_RESEARCH: ResearchCreativeContract = {
  version: "research-creative-contract-v1",
  questionId: "SYNTHETIC_ENGINEERING_FIXTURE-compare-estimate-limits",
  generatedAt: "2026-09-15T12:00:00.000Z",
  safeClaims: [
    {
      claimId: "SYNTHETIC_ENGINEERING_FIXTURE-estimate-range-limit",
      // Historical fixture wording avoided the matcher's incidental-count
      // false positives. The independent repair now permits generic shared
      // wording such as "these two builds" without permitting a better-buy
      // judgment. Preserve this fixture and its authored history unchanged.
      proposition:
        "On this comparison every per-game difference is smaller than the range SpecSmith's model declares for its own estimates, so the model does not separate them on frame rate.",
      state: "known",
      requiredWording: ["model estimates"],
      supportingSnapshotIds: ["SYNTHETIC_ENGINEERING_FIXTURE-snapshot"],
    },
    {
      // The price identity is real and checkable: rtx5060ti $564 + i3-13100f $90
      // and rtx4060ti $469 + r5-9600x $185 both come to $654 in the shipped
      // catalog. What it is NOT is a complete build or a live retail quote, and
      // the Compare page does not display prices at all.
      //
      // The qualifier is carried as requiredWording rather than left to the
      // author, so a script that states the price identity without saying what
      // kind of price it is fails the gate instead of relying on goodwill.
      claimId: "SYNTHETIC_ENGINEERING_FIXTURE-editorial-parts-subtotal",
      proposition:
        "At SpecSmith's editorial catalog prices the two CPU-and-GPU pairs on this comparison come to the same parts subtotal.",
      state: "known",
      requiredWording: [
        "editorial CPU-and-GPU parts subtotal",
        "not a complete build and not a live retail price",
      ],
      supportingSnapshotIds: ["SYNTHETIC_ENGINEERING_FIXTURE-snapshot"],
    },
  ],
  unsafeClaims: [
    {
      claimId: "SYNTHETIC_ENGINEERING_FIXTURE-better-buy",
      proposition: "One of these two builds is the better buy.",
      state: "requires-human-judgment",
      reason:
        "A purchase recommendation depends on price, availability and the viewer's own library, none of which this evidence establishes.",
      wouldBecomeSafeIf: ["A live retail price and a stated buyer profile were both established."],
    },
  ],
  disputedClaims: [],
  groundedHookMaterial: [],
  openQuestions: ["What separates these builds outside frame rate?"],
  limitations: [
    "SYNTHETIC ENGINEERING FIXTURE. Not production research evidence.",
    "Model estimates only; nothing here was measured on real hardware.",
    "The declared range is a model convention, not calibrated uncertainty.",
  ],
  overallState: "known",
};

export const DEMO_MISSION: Omit<CreativeMissionInput, "concepts"> = {
  missionId: "SYNTHETIC_ENGINEERING_FIXTURE-compare-estimate-limits",
  // Preserve the original demonstrated mission; generic shared subject words
  // and incidental counts no longer require an authoring workaround.
  viewerQuestion: "Same price, different parts. What does this comparison page actually settle?",
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
  research: DEMO_RESEARCH,
  researchSynthetic: true,
  allowSynthetic: true,
  memory: [],
  retrieval: { kind: "explanatory-structure", allowSynthetic: true },
  platform: "youtube-shorts",
};

async function main(): Promise<void> {
  const [command = "review", directoryArgument] = process.argv.slice(2);
  const directory = directoryArgument === undefined ? DEMO_WORKFLOW_DIRECTORY : resolve(directoryArgument);

  if (command !== "brief" && command !== "review") {
    throw new Error(`Unknown command "${command}". Use "brief" or "review".`);
  }

  const result = await runCreativeFileWorkflow(directory, DEMO_MISSION, { exportOnly: command === "brief" });

  console.log(`Workflow directory: ${directory}`);
  console.log(`Wrote: ${result.written.join(", ")}`);
  console.log(`Brief hash: ${result.brief.briefHash}`);
  console.log(`Approved claims available to the author: ${result.brief.approvedClaims.length}`);
  console.log("");
  console.log(`Workflow status: ${result.workflowStatus}`);
  console.log(result.workflowReason);
  console.log(`(proposal pass reported: ${result.status})`);

  for (const entry of result.feedback) {
    console.log("");
    for (const concept of entry.concepts) {
      console.log(`  ${concept.conceptId}: contract eligible ${concept.contractEligible}`);
      for (const item of concept.missionBlockers) console.log(`    MISSION   ${item}`);
      for (const item of concept.required) console.log(`    REQUIRED  ${item}`);
      for (const item of concept.advisory) console.log(`    advisory  ${item}`);
    }
    console.log(`  next step: ${entry.nextStep}`);
  }

  console.log("");
  console.log(`machine checks passed: ${result.packet.machineChecksPassed}`);
  console.log(`human review ready:    ${result.packet.humanReviewReady}`);
  console.log(`approved:              ${result.packet.approved}`);
  console.log(`synthetic research:    ${result.packet.syntheticResearch}`);
  console.log("outstanding human approvals:");
  for (const item of result.packet.outstandingApprovals) console.log(`  - ${item}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error("\nCREATIVE FILE WORKFLOW FAILED:");
    console.error(error);
    process.exitCode = 1;
  });
}
