// CONTENT_CREATIVE_REPORT: one structured artifact describing one creative.
//
// WHY THIS EXISTS RATHER THAN A CONSOLE SUMMARY
// ----------------------------------------------
// A pipeline that prints paragraphs is unreadable the moment there is more
// than one creative, and unauditable at any number: prose cannot be diffed and
// cannot be checked by a test. This report is the machine-readable statement of
// what was made, what was measured, what was changed, and — the part that
// matters most — what a machine did NOT establish.
//
// THE RULE THIS FILE ENFORCES
// ----------------------------
// `publishReady` is false unless every outstanding human gate is closed by a
// real recorded human decision FROM A TRUSTED APPROVAL RECORD, and the media is
// bytes that were actually read and hashed. This repository has no trusted
// approval record (no authenticated reviewer, no signed decision), so a
// caller-supplied name and timestamp is recorded but never closes a gate:
// typing "approved" does not prove a person watched or listened. There is no code path that lets a high
// production-quality score close a human gate. A machine measuring caption
// characters-per-second has learned nothing about whether a voice sounds
// natural, and this report says so in the artifact rather than in a comment.

import type { CreativeFingerprint } from "../types.ts";
import { isVerifiedMedia, recheckMedia, type VerifiedMedia } from "./mediaVerification.ts";
import { HUMAN_ONLY_DIMENSIONS, type CreativeQualityReview } from "./creativeQualityReview.ts";
import type { RepairResult, RevisionLineage } from "./beatRepair.ts";

/** A judgment only a person can make, and whether a person actually made it. */
export interface HumanGate {
  readonly gate: string;
  readonly why: string;
  /**
   * The recorded decision, or null when nobody has decided. Never inferred.
   *
   * `mediaSha256` names the exact rendered bytes the person saw or heard. A
   * decision about one render is not a decision about the next one, so a
   * decision naming other bytes (or none) does not close the gate.
   */
  readonly decision: {
    readonly by: string;
    readonly at: string;
    readonly outcome: "approved" | "rejected";
    readonly mediaSha256?: string;
  } | null;
}

export interface ContentCreativeReport {
  readonly version: "content-creative-report-v1";
  readonly generatedAt: string;

  readonly identity: {
    readonly creativeId: string;
    readonly parentCreativeId: string | null;
    readonly packageId: string;
    readonly ideaId: string | null;
    readonly campaignId: string | null;
    readonly platform: string;
    /** The digest of the media file, computed from its bytes, or null when nothing verified was supplied. */
    readonly mediaSha256: string | null;
    /** True only when the file was read and still holds those bytes as this report was built. */
    readonly mediaVerified: boolean;
  };

  /** Null when the creative did not come through the planning path that builds fingerprints (e.g. the MASTER #6 handoff). */
  readonly fingerprint: CreativeFingerprint | null;

  /** Upstream identities the creative carries (research, mission, batch, concept, storyboard), when supplied. */
  readonly provenance: Readonly<Record<string, unknown>> | null;

  readonly quality: {
    /** Construction evidence only. Never performance. */
    readonly productionQualityScore: number;
    readonly confidence: number;
    readonly measuredDimensions: number;
    readonly notAssessedDimensions: number;
    readonly strengths: readonly string[];
    readonly weaknesses: readonly string[];
    readonly hardFailures: readonly string[];
  };

  /**
   * Deliberately absent, not zero.
   *
   * Nothing has been published, so there is no performance to report. A zero
   * here would read as "performed badly", which is a different and false claim.
   */
  readonly performance: { readonly status: "no-published-history"; readonly why: string };

  readonly revisions: {
    readonly passes: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly stoppedBecause: string;
    readonly lineage: readonly RevisionLineage[];
    readonly unrepairable: readonly { readonly dimension: string; readonly issue: string; readonly reason: string }[];
  };

  readonly humanGates: readonly HumanGate[];
  /**
   * True only when every gate above is closed by a trusted approval record, the
   * media was verified from its bytes and bound to the review, and no known
   * machine fix remains. With no trusted approval record in this repository, it
   * cannot currently be true.
   */
  readonly publishReady: boolean;
  readonly blockedBy: readonly string[];
}

/** Why a recorded decision cannot close a gate here. Stated in the artifact, not only in a comment. */
export const NO_TRUSTED_APPROVAL_RECORD =
  "no trusted approval record exists in this repository: a caller-supplied reviewer name and time is recorded, but does not prove anyone watched or listened, so it cannot close the gate";

export interface ReportInput {
  readonly review: CreativeQualityReview;
  readonly fingerprint: CreativeFingerprint | null;
  readonly repair?: RepairResult;
  /** Media verified from its bytes by `verifyRenderedMedia`. A bare digest string is not accepted. */
  readonly media?: VerifiedMedia | null;
  readonly provenance?: Readonly<Record<string, unknown>> | null;
  /** Further gates only a person can close, e.g. those an upstream stage left outstanding. */
  readonly additionalHumanGates?: readonly { readonly gate: string; readonly why: string }[];
  /** Further machine-known blockers from an upstream stage. */
  readonly additionalBlockers?: readonly string[];
  readonly parentCreativeId?: string | null;
  /** Recorded human decisions, keyed by gate name. Absent means undecided. */
  readonly recordedHumanDecisions?: Readonly<Record<string, HumanGate["decision"]>>;
  readonly now?: Date;
}

/**
 * The gates a machine may never close.
 *
 * The audio gate is listed separately from the perceptual dimensions because it
 * is an existing production gate with its own review record; nothing here
 * weakens or bypasses it.
 */
function humanGatesFor(input: ReportInput): HumanGate[] {
  const recorded = input.recordedHumanDecisions ?? {};
  const gates: HumanGate[] = HUMAN_ONLY_DIMENSIONS.map((dimension) => ({
    gate: dimension,
    why: "Requires a person to see or hear the rendered media. No machine measurement substitutes for it.",
    decision: recorded[dimension] ?? null,
  }));
  gates.push({
    gate: "audio-listening-review",
    why: "A person must listen to the rendered narration end to end. Loudness and peak measurements describe the signal, not the performance.",
    decision: recorded["audio-listening-review"] ?? null,
  });
  for (const extra of input.additionalHumanGates ?? []) {
    if (gates.some((gate) => gate.gate === extra.gate)) continue;
    gates.push({ gate: extra.gate, why: extra.why, decision: recorded[extra.gate] ?? null });
  }
  return gates;
}

export function buildContentCreativeReport(input: ReportInput): ContentCreativeReport {
  const { review, fingerprint } = input;
  const measured = review.overall.filter((score) => score.score !== null);
  const notAssessed = review.overall.filter((score) => score.score === null);
  const gates = humanGatesFor(input);

  const lineage = input.repair?.passes.map((pass) => pass.lineage) ?? [];
  const hardFailures = review.slop.hardFailures.map((finding) => `${finding.code} at ${finding.location}: ${finding.message}`);
  const unresolvedFixes = review.recommendedFixes;

  const blockedBy: string[] = [];
  for (const gate of gates) {
    if (gate.decision === null) blockedBy.push(`Human gate not decided: ${gate.gate}.`);
    else if (gate.decision.outcome === "rejected") blockedBy.push(`Human gate rejected: ${gate.gate} (by ${gate.decision.by}).`);
  }
  for (const failure of hardFailures) blockedBy.push(`Blocking content failure: ${failure}`);
  // Human approval cannot erase a known machine-detected defect. (Ported from PR #127.)
  for (const fix of unresolvedFixes) {
    blockedBy.push(`Unresolved creative fix: ${fix.dimension} — ${fix.issue}`);
  }
  for (const blocker of input.additionalBlockers ?? []) blockedBy.push(blocker);

  // Rendered media is bytes that were read and hashed, still unchanged, or it
  // is nothing. A 64-character string is only shaped like a digest.
  const media = input.media ?? null;
  let verifiedSha: string | null = null;
  if (media === null) {
    blockedBy.push("No rendered media: nothing exists to publish.");
  } else if (!isVerifiedMedia(media)) {
    blockedBy.push("The media record was not produced by verifyRenderedMedia: no file was read, so its digest proves nothing.");
  } else {
    const recheck = recheckMedia(media);
    if (!recheck.ok) blockedBy.push(`Rendered media no longer verifies: ${recheck.reason}`);
    else verifiedSha = recheck.sha256;
  }
  // The quality review must have measured these exact bytes.
  if (review.mediaSha256 === null) {
    blockedBy.push("The quality review has no media binding: it was not made about any rendered bytes.");
  } else if (verifiedSha !== null && review.mediaSha256 !== verifiedSha) {
    blockedBy.push("The quality review measured other media than the verified file; re-review these exact bytes.");
  }
  // Recorded approvals are checked for what they claim, and then refused as
  // proof: nothing here can confirm a person made them.
  for (const gate of gates) {
    const decision = gate.decision;
    if (decision === null || decision.outcome !== "approved") continue;
    const at = Date.parse(decision.at);
    if (!decision.by.trim()) blockedBy.push(`Human gate ${gate.gate}: the approval names no reviewer.`);
    if (!Number.isFinite(at) || at > (input.now ?? new Date()).getTime()) {
      blockedBy.push(`Human gate ${gate.gate}: the approval's time is missing, invalid or in the future.`);
    }
    if (verifiedSha === null || decision.mediaSha256 !== verifiedSha) {
      blockedBy.push(`Human gate ${gate.gate}: the approval was made about other media (or names none); approve these exact bytes.`);
    }
    blockedBy.push(`Human gate ${gate.gate}: ${NO_TRUSTED_APPROVAL_RECORD}.`);
  }

  return {
    version: "content-creative-report-v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    identity: {
      creativeId: input.repair?.finalCreativeId ?? review.creativeId,
      parentCreativeId: input.parentCreativeId ?? (lineage.length ? lineage[0].parentCreativeId : null),
      packageId: review.packageId,
      ideaId: fingerprint?.ideaId ?? null,
      campaignId: fingerprint?.campaignId ?? null,
      platform: review.platform,
      mediaSha256: isVerifiedMedia(media) ? media.sha256 : null,
      mediaVerified: verifiedSha !== null,
    },
    fingerprint,
    provenance: input.provenance ?? null,
    quality: {
      productionQualityScore: review.productionQualityScore,
      confidence: review.confidence,
      measuredDimensions: measured.length,
      notAssessedDimensions: notAssessed.length,
      strengths: review.strengths,
      weaknesses: review.weaknesses,
      hardFailures,
    },
    performance: {
      status: "no-published-history",
      why: "No SpecSmith creative has been published, so no analytics exist. Reporting zero would assert a measured failure that never happened.",
    },
    revisions: {
      passes: lineage.length,
      accepted: lineage.filter((entry) => entry.accepted).length,
      rejected: lineage.filter((entry) => !entry.accepted).length,
      stoppedBecause: input.repair?.stoppedBecause ?? "no-repair-run",
      lineage,
      unrepairable: (input.repair?.unrepairable ?? []).map((entry) => ({
        dimension: entry.fix.dimension,
        issue: entry.fix.issue,
        reason: entry.reason,
      })),
    },
    humanGates: gates,
    publishReady: blockedBy.length === 0,
    blockedBy,
  };
}

/** Renders the report for a terminal without losing any of its claims. */
export function formatContentCreativeReport(report: ContentCreativeReport): string {
  const lines: string[] = [];
  lines.push(`CONTENT_CREATIVE_REPORT ${report.identity.creativeId} (${report.identity.platform})`);
  lines.push(`  media sha256:        ${report.identity.mediaSha256 ?? "(nothing verified)"}${report.identity.mediaSha256 ? ` (${report.identity.mediaVerified ? "verified from file" : "NOT verified"})` : ""}`);
  lines.push(`  production quality:  ${report.quality.productionQualityScore}/10 from ${report.quality.measuredDimensions} measured dimension(s), confidence ${report.quality.confidence}`);
  lines.push(`  not machine-assessed: ${report.quality.notAssessedDimensions} dimension(s)`);
  lines.push(`  performance:         ${report.performance.status} — ${report.performance.why}`);
  lines.push(`  revisions:           ${report.revisions.passes} pass(es), ${report.revisions.accepted} accepted, ${report.revisions.rejected} rejected; stopped: ${report.revisions.stoppedBecause}`);
  for (const entry of report.revisions.lineage) {
    lines.push(`    ${entry.parentCreativeId} -> ${entry.revisionId}: beats [${entry.changedBeats.map((index) => index + 1).join(", ")}], ${entry.beforeQualityScore} -> ${entry.afterQualityScore}, ${entry.accepted ? "accepted" : `rejected (${entry.rejectionReason})`}`);
  }
  for (const entry of report.revisions.unrepairable) {
    lines.push(`    refused: ${entry.dimension} — ${entry.reason}`);
  }
  lines.push(`  publish ready:       ${report.publishReady}`);
  for (const blocker of report.blockedBy) lines.push(`    blocked: ${blocker}`);
  return lines.join("\n");
}
