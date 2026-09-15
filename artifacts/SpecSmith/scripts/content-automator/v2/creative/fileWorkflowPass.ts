// MASTER #6 — One end-to-end run of the local file-based creative workflow.
//
// Exports the brief, imports whatever batch has been authored, runs the SAME
// evidence/divergence/production gates the provider-driven path runs, writes
// actionable feedback, and emits a review packet that distinguishes
// human-review readiness from approval.
//
// No network, no credential, no paid service, no rendering, no publishing.

import { runCreativeGenerationPass } from "./generationPass.ts";
import type { CreativeMissionInput } from "./proposalPass.ts";
import {
  batchHashOf,
  buildReviewPacket,
  buildRevisionFeedback,
  createFileConceptGenerator,
  exportCreativeBrief,
  importAuthoredBatch,
  latestAuthoredAttempt,
  writeReviewPacket,
  writeRevisionFeedback,
  type CreativeReviewPacket,
  type ExportedBrief,
  type RevisionFeedback,
} from "./fileWorkflow.ts";

export interface FileWorkflowResult {
  readonly brief: ExportedBrief;
  /** The generation pass's own status, reported unchanged. */
  readonly status: string;
  readonly reason: string;
  /**
   * This workflow's conclusion, which is what a reader should act on.
   *
   * The upstream status answers "did the proposal pass accept these?". It does
   * not know about the checks that live here, so on its own it can say a batch
   * passed while this workflow still has blocking findings.
   */
  readonly workflowStatus: "brief-exported" | "ready-for-human-review" | "revision-required" | "blocked";
  readonly workflowReason: string;
  readonly attempts: number;
  readonly feedback: readonly RevisionFeedback[];
  readonly packet: CreativeReviewPacket;
  readonly written: readonly string[];
}

export interface FileWorkflowOptions {
  readonly memoryObservations?: readonly string[];
  /** Export the brief only; do not attempt to import a batch. */
  readonly exportOnly?: boolean;
}

export async function runCreativeFileWorkflow(
  directory: string,
  input: Omit<CreativeMissionInput, "concepts">,
  options: FileWorkflowOptions = {},
): Promise<FileWorkflowResult> {
  const exported = exportCreativeBrief(directory, input, options.memoryObservations ?? []);
  const written = [...exported.written];

  if (options.exportOnly === true) {
    const packet = buildReviewPacket({
      brief: exported.brief,
      attempt: 0,
      generatorName: "none",
      status: "brief-exported",
      result: { proposals: [] },
      batchHash: null,
      feedback: null,
    });
    written.push(writeReviewPacket(directory, packet));
    return {
      brief: exported.brief,
      status: "brief-exported",
      reason: "The brief was exported. Author three concept files, then run the workflow again.",
      workflowStatus: "brief-exported",
      workflowReason: "The brief was exported. Author three concept files, then run the workflow again.",
      attempts: 0,
      feedback: [],
      packet,
      written,
    };
  }

  // Exactly one attempt per run: see `createFileConceptGenerator`. The
  // revision loop is the author re-running this after writing the next batch.
  const pass = await runCreativeGenerationPass(input, createFileConceptGenerator(directory), { maxAttempts: 1 });

  const feedback: RevisionFeedback[] = [];
  // Number the feedback after the batch that was actually read, so
  // feedback/attempt-N.md always describes batches/attempt-N/.
  const attempts = latestAuthoredAttempt(directory);

  // Feedback is written for the attempt that was actually read, so an author
  // reading feedback/attempt-N.md is reading about the files in
  // batches/attempt-N/ and nothing else.
  if (attempts > 0) {
    const entry = buildRevisionFeedback(attempts, exported.brief.briefHash, pass.status, pass.reason, pass.result, {
      approvedClaimIds: exported.brief.approvedClaims.map((claim) => claim.claimId),
      requiredWordingByClaimId: Object.fromEntries(
        exported.brief.approvedClaims.map((claim) => [claim.claimId, claim.requiredWording]),
      ),
      claimPropositionsById: Object.fromEntries(exported.brief.approvedClaims.map((claim) => [claim.claimId, claim.proposition])),
      captureStateIdentifier: exported.brief.captureStateIdentifier,
      productDestination: exported.brief.productDestination,
      surface: exported.brief.captureSurface,
      captureType: exported.brief.captureType,
    });
    feedback.push(entry);
    written.push(...writeRevisionFeedback(directory, entry));
  }

  let batchHash: string | null = null;
  if (attempts > 0) {
    try {
      batchHash = batchHashOf(importAuthoredBatch(directory, attempts).concepts);
    } catch {
      // The attempt was unreadable. A null hash is the honest record; it must
      // not be filled in with the hash of something else.
      batchHash = null;
    }
  }

  const packet = buildReviewPacket({
    brief: exported.brief,
    attempt: attempts,
    generatorName: "local-file-authored-batch",
    status: pass.status,
    result: pass.result,
    batchHash,
    feedback: feedback[0] ?? null,
  });
  written.push(writeReviewPacket(directory, packet));

  const workflowStatus: FileWorkflowResult["workflowStatus"] = packet.machineChecksPassed
    ? "ready-for-human-review"
    : attempts === 0 || pass.status === "blocked-evidence" || pass.status === "blocked-generator"
      ? "blocked"
      : "revision-required";

  const workflowReason =
    workflowStatus === "ready-for-human-review"
      ? "Every machine check in this workflow passed for every treatment. Ready for human review, and NOT approved."
      : workflowStatus === "blocked"
        ? pass.reason
        : `${feedback[0]?.nextStep ?? "Revise the batch."} The upstream proposal pass reported "${pass.status}", which does not account for this workflow's own checks.`;

  return {
    brief: exported.brief,
    status: pass.status,
    reason: pass.reason,
    workflowStatus,
    workflowReason,
    attempts,
    feedback,
    packet,
    written,
  };
}
