// Shared vocabulary for render provenance, and the dependency record.
//
// THERE IS NO SEAL HERE ANY MORE, ON PURPOSE. The previous version exported
// `sealRenderManifest(entries, masterSha256)`: a digest over whatever list the
// caller handed it. Anyone could build clean-looking entries and seal them,
// and the seal then vouched for the substitution. A seal the caller can mint
// is not evidence of anything. The only trusted account of a master is now the
// render receipt the compositor issues from the files it actually consumed —
// see motionCompositor.ts — and nothing in this file can create or alter one.
//
// THE DEPENDENCY RECORD IS A CLAIM, CHECKED AGAINST THE RECEIPT. It is the
// persisted list of inputs someone asserts went into a master (for rights
// review, for the audit trail). It is plain data and anyone can write one.
// That is fine because the publish gate never trusts it: it must name the same
// receipt digest and master digest, and every entry must correspond exactly
// to an input the receipt recorded — no extra claims, no omissions, no
// duplicated roles, no edited paths or digests.
//
// ADAPTER METADATA IS INCONSISTENT. The adapters in this repository do not
// agree on field names, so provenance is read through one fallback in the
// compositor (renderer ← provider, voiceId ← voice):
//
//   elevenLabsTts          provider: "elevenlabs"          voiceId
//   localFixtureTts        renderer + provider             voice     isFixture
//   captionRender          renderer only
//   offlineBeatFixtures    renderer + provider                       isFixture
//   geminiVeoVideo         provider only

import type { ReceiptRole, RenderReceipt } from "./motionCompositor.ts";

export type { ReceiptRole } from "./motionCompositor.ts";

export const RECEIPT_ROLES: readonly ReceiptRole[] = [
  "hook-visual", "evidence-visual", "narration", "captions", "music-bed",
];

/**
 * Roles a publishable master must have consumed, and how many of each.
 *
 * Stated as a requirement rather than inferred from what turned up, because
 * "whatever the render produced" is exactly the shape an omission wants.
 */
export const REQUIRED_ROLE_COUNTS: Readonly<Record<ReceiptRole, { min: number; max: number }>> = {
  "hook-visual": { min: 1, max: 1 },
  "evidence-visual": { min: 1, max: Number.POSITIVE_INFINITY },
  narration: { min: 1, max: 1 },
  captions: { min: 1, max: 1 },
  "music-bed": { min: 1, max: 1 },
};

/** Renderers and providers that are fixtures whatever else they declare. */
export const FIXTURE_SOURCES = new Set([
  "offline-card-video-fixture",
  "offline-silent-bed-fixture",
  "local-espeak-tts-fixture",
  "ffmpeg-offline-fixture",
  "espeak-ng-offline-fixture",
]);

/** The ElevenLabs provider string, as elevenLabsTts.ts emits it. */
export const ELEVENLABS_PROVIDER = "elevenlabs";

/** One claimed input of a master. */
export interface DependencyClaim {
  taskId: string;
  role: ReceiptRole;
  resolvedPath: string;
  sha256: string;
}

/** A persisted, UNTRUSTED account of a master's inputs. Checked, never believed. */
export interface DependencyRecord {
  masterSha256: string;
  receiptDigest: string;
  dependencies: DependencyClaim[];
}

/**
 * Copies a receipt's inputs into a plain dependency record, e.g. to persist
 * alongside a rights submission. Returns data, not trust: the gate re-checks
 * every field of the result against the receipt.
 */
export function dependencyRecordFor(receipt: RenderReceipt): DependencyRecord {
  return {
    masterSha256: receipt.masterSha256,
    receiptDigest: receipt.digest,
    dependencies: receipt.inputs.map((input) => ({
      taskId: input.taskId,
      role: input.role,
      resolvedPath: input.resolvedPath,
      sha256: input.sha256,
    })),
  };
}
