// What the offline pipeline may say about its own render (#158).
//
// Two records in endToEndOfflinePipeline.ts used to claim more than happened:
//
//  1. Its creative fingerprint said `exactProductAssetRatio: 1`. Every visual
//     that pipeline renders is a deterministic capture of SpecSmith's own
//     Compare page. None is product photography or a manufacturer asset.
//  2. Its ledger note said "Passed automated review". The scores come from a
//     recorded manual inspection (fixtures/mp4-smoke-offline-observation.json)
//     matched to the render by SHA-256. No automated scorer produced them.
//
// Both are now derived from evidence rather than typed in: the visual mix
// from the compositor's receipt for the render, and the note from the
// inspection record and the digests the QC verdict is bound to.

import { DETERMINISTIC_UI_RENDERER } from "./uiRender/deterministicUiRenderAdapter.ts";
import { isIssuedRenderReceipt, type RenderReceipt, type RenderReceiptInput } from "./motionCompositor.ts";
import type { QualityReviewResult, RecordedRenderEvidence } from "./qualityReviewer.ts";
import { FIXTURE_SOURCES } from "./renderManifest.ts";

/** Providers whose visuals are generated video, not captured evidence. */
const GENERATED_VIDEO_PROVIDERS = new Set(["elevenlabs", "google-gemini-api"]);

export interface VisualMix {
  /** Share of on-screen visual time that is a capture of SpecSmith's own UI. */
  uiProofRatio: number;
  /** Share that is generated video. */
  generatedVisualRatio: number;
  /**
   * Share that is exact product photography or a manufacturer asset. No
   * adapter in this repository produces one, so nothing earns this credit and
   * it is 0 until one exists and is recognised here.
   */
  exactProductAssetRatio: number;
}

const round = (value: number): number => Number(value.toFixed(4));

const onScreenSeconds = (input: RenderReceiptInput): number =>
  input.timeline.reduce((total, use) => total + Math.max(0, use.endSecond - use.startSecond), 0);

const isFixture = (input: RenderReceiptInput): boolean =>
  input.declaredFixture || FIXTURE_SOURCES.has(input.renderer) || FIXTURE_SOURCES.has(input.provider);

/**
 * The visual mix of a master, from the compositor's receipt for it: the files
 * it actually consumed and the timeline slots each filled.
 *
 * Fails closed. Only a genuine receipt is read, and a visual earns a category
 * only when its recorded renderer or provider identifies it. A fixture or an
 * unrecognised source earns none, so the three ratios can sum to less than 1.
 */
export function visualMixFromReceipt(receipt: RenderReceipt): VisualMix {
  if (!isIssuedRenderReceipt(receipt)) {
    throw new Error("The visual mix is read only from a render receipt the compositor issued.");
  }
  const visuals = receipt.inputs.filter((input) => input.role === "hook-visual" || input.role === "evidence-visual");
  const total = visuals.reduce((sum, input) => sum + onScreenSeconds(input), 0);
  if (total <= 0) throw new Error("The render receipt records no on-screen visual time.");

  const share = (matches: (input: RenderReceiptInput) => boolean): number =>
    round(visuals.filter(matches).reduce((sum, input) => sum + onScreenSeconds(input), 0) / total);

  return {
    uiProofRatio: share((input) => !isFixture(input) && input.renderer === DETERMINISTIC_UI_RENDERER),
    generatedVisualRatio: share((input) =>
      !isFixture(input) && (GENERATED_VIDEO_PROVIDERS.has(input.provider) || GENERATED_VIDEO_PROVIDERS.has(input.renderer))),
    exactProductAssetRatio: 0,
  };
}

/**
 * The note for a `qc-passed` ledger event: who inspected, when, which record,
 * which master and receipt the verdict is bound to, and the score that
 * inspection recorded. It never calls the review automated, because none ran.
 *
 * Refuses (throws) unless the verdict actually passed and is bound to the
 * inspected master and a receipt, so no note exists for a state that did not
 * occur.
 */
export function qcPassedLedgerNote(
  review: QualityReviewResult,
  evidence: RecordedRenderEvidence,
  evidencePath: string,
): string {
  if (!review.publishable || review.decision !== "pass") {
    throw new Error(`QC did not pass (decision=${review.decision}); there is no qc-passed event to record.`);
  }
  if (review.reviewedMediaSha256 !== evidence.masterSha256) {
    throw new Error("The QC verdict is not bound to the master the recorded inspection covers.");
  }
  if (!review.reviewedReceiptDigest) {
    throw new Error("The QC verdict is bound to no render receipt.");
  }
  return `QC passed on a recorded manual inspection by ${evidence.reviewedBy} at ${evidence.reviewedAt} `
    + `(${evidencePath}), bound to master sha256 ${review.reviewedMediaSha256} and render receipt `
    + `${review.reviewedReceiptDigest}. Score ${review.overallScore}/10 is from that inspection's observation.`;
}
