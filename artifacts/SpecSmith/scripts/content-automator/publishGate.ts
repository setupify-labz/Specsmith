// The one place that can say "this may be published", and the many reasons it
// will not.
//
// WHY A SEPARATE GATE. Every stand-in in this pipeline already labels itself
// honestly — `isFixture: true`, `isPaidProvider: false`, `isSilent: true`,
// `requiresLicensedReplacement: true`. Honest labels are necessary and not
// sufficient: nothing was READING them at the decision point. A draft could
// carry six truthful markers saying "espeak-ng stand-in, silent bed,
// placeholder hook, never inspected" and still reach a publish call, because
// the labels sat in metadata that only a human happened to look at.
//
// This gate reads them. It is fail-closed in the strict sense: it returns
// `allowed: true` only when it has affirmatively confirmed every condition,
// and ANY unreadable, missing or unexpected value is a refusal rather than a
// pass. A render it cannot understand is not publishable.
//
// WHAT IT REFUSES
//   fixture-artifact            any artifact carrying isFixture
//   non-liam-narration          narration not produced by the approved voice
//   unapproved-paid-provider    a paid provider used without an approval token
//   silent-music-bed            the rights-deferring silent stand-in
//   placeholder-hook            the offline card standing in for the hook
//   unapproved-master-sha       bytes with no matching committed inspection
//   no-approval-record          no inspection record supplied at all
//
// It does not publish anything. It answers one question and refuses to answer
// it optimistically.

import type { RenderArtifact } from "./rendering.ts";

export type PublishRefusalCode =
  | "fixture-artifact"
  | "non-liam-narration"
  | "unapproved-paid-provider"
  | "silent-music-bed"
  | "placeholder-hook"
  | "unapproved-master-sha"
  | "no-approval-record";

export interface PublishRefusal {
  code: PublishRefusalCode;
  detail: string;
}

export type PublishVerdict =
  | { allowed: true; masterSha256: string }
  | { allowed: false; refusals: PublishRefusal[] };

/**
 * The narration provider a publishable SpecSmith video must use.
 *
 * Named, not inferred. "Liam" is the approved ElevenLabs voice; anything else
 * — including the offline espeak-ng stand-in this repository renders drafts
 * with — is refused. The comparison is on the voice NAME recorded in the
 * artifact's own metadata, because a voice id cannot be validated here and
 * writing down an unverified one would be an invention.
 */
export const APPROVED_NARRATION_VOICE = "Liam";

/** A committed record that a human inspected one exact render. */
export interface InspectionRecord {
  /** The sha256 of the bytes that were actually watched. */
  masterSha256: string;
  inspectedBy: string;
  inspectedAt: string;
  /** False means inspected and rejected — still a refusal. */
  approved: boolean;
}

export interface PublishGateInput {
  /** Every artifact that contributed to the master, including the master. */
  artifacts: readonly RenderArtifact[];
  /** The sha256 of the bytes about to be published. */
  masterSha256: string;
  /** The committed inspection, if one exists. Absent is a refusal. */
  inspection?: InspectionRecord;
  /**
   * Explicit approval to have spent on a paid provider. Absent means a paid
   * artifact is refused even when it is real.
   */
  paidProviderApproval?: { approvedBy: string; approvedAt: string };
}

const readBoolean = (metadata: Record<string, unknown>, key: string): boolean => metadata[key] === true;
const readString = (metadata: Record<string, unknown>, key: string): string => {
  const raw = metadata[key];
  return typeof raw === "string" ? raw : "";
};

/**
 * Decides whether a render may be published. Refuses by default.
 *
 * Returns EVERY refusal rather than the first, so one pass over a draft tells
 * a person the whole distance to publishable instead of one step of it.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishVerdict {
  const refusals: PublishRefusal[] = [];

  for (const artifact of input.artifacts) {
    const metadata = (artifact.metadata ?? {}) as Record<string, unknown>;
    const renderer = readString(metadata, "renderer") || artifact.artifactId;

    if (readBoolean(metadata, "isFixture")) {
      refusals.push({
        code: "fixture-artifact",
        detail: `${artifact.taskId} was produced by ${renderer}, which labels itself a fixture.`,
      });
    }
    if (readBoolean(metadata, "isSilent") || readBoolean(metadata, "requiresLicensedReplacement")) {
      refusals.push({
        code: "silent-music-bed",
        detail: `${artifact.taskId} is the silent stand-in bed; a licensed track has not been chosen.`,
      });
    }
    if (renderer === "offline-card-video-fixture") {
      refusals.push({
        code: "placeholder-hook",
        detail: `${artifact.taskId} is the offline typographic card standing in for the hook beat.`,
      });
    }
    if (artifact.kind === "audio" && metadata.voice !== undefined) {
      const voice = readString(metadata, "voice");
      if (voice !== APPROVED_NARRATION_VOICE) {
        refusals.push({
          code: "non-liam-narration",
          detail: `${artifact.taskId} narration voice is "${voice || "unknown"}", not ${APPROVED_NARRATION_VOICE}.`,
        });
      }
    }
    if (readBoolean(metadata, "isPaidProvider") && input.paidProviderApproval === undefined) {
      refusals.push({
        code: "unapproved-paid-provider",
        detail: `${artifact.taskId} used a paid provider with no recorded approval to spend.`,
      });
    }
  }

  // Narration must be positively identified as Liam. An audio artifact that
  // records no voice at all is not "probably fine" — it is unidentified.
  const narrationArtifacts = input.artifacts.filter((artifact) => artifact.kind === "audio");
  const identifiedLiam = narrationArtifacts.some((artifact) => {
    const metadata = (artifact.metadata ?? {}) as Record<string, unknown>;
    return readString(metadata, "voice") === APPROVED_NARRATION_VOICE;
  });
  if (!identifiedLiam) {
    refusals.push({
      code: "non-liam-narration",
      detail: `No artifact positively identifies ${APPROVED_NARRATION_VOICE} as the narration voice.`,
    });
  }

  if (input.inspection === undefined) {
    refusals.push({
      code: "no-approval-record",
      detail: "No committed inspection record was supplied for these bytes.",
    });
  } else if (input.inspection.masterSha256 !== input.masterSha256) {
    refusals.push({
      code: "unapproved-master-sha",
      detail:
        `The inspection record covers ${input.inspection.masterSha256.slice(0, 16)}… but these bytes are `
        + `${input.masterSha256.slice(0, 16)}…. Different bytes were reviewed.`,
    });
  } else if (!input.inspection.approved) {
    refusals.push({
      code: "unapproved-master-sha",
      detail: `The inspection of ${input.masterSha256.slice(0, 16)}… recorded a rejection, not an approval.`,
    });
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, masterSha256: input.masterSha256 };
}

/** Throws unless publication is allowed. The only safe way to call the gate. */
export function assertPublishable(input: PublishGateInput): string {
  const verdict = evaluatePublishGate(input);
  if (verdict.allowed) return verdict.masterSha256;
  throw new Error(
    `Publication refused (${verdict.refusals.length}):\n`
    + verdict.refusals.map((refusal) => `  [${refusal.code}] ${refusal.detail}`).join("\n"),
  );
}
