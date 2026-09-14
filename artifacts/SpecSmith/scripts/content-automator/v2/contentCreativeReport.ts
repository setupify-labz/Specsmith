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
// real recorded human decision. There is no code path that lets a high
// production-quality score close a human gate. A machine measuring caption
// characters-per-second has learned nothing about whether a voice sounds
// natural, and this report says so in the artifact rather than in a comment.

import type { CreativeFingerprint } from "../types.ts";
import { HUMAN_ONLY_DIMENSIONS, type CreativeQualityReview } from "./creativeQualityReview.ts";
import type { RepairResult, RevisionLineage } from "./beatRepair.ts";

/** A judgment only a person can make, and whether a person actually made it. */
export interface HumanGate {
  readonly gate: string;
  readonly why: string;
  /** The recorded decision, or null when nobody has decided. Never inferred. */
  readonly decision: { readonly by: string; readonly at: string; readonly outcome: "approved" | "rejected" } | null;
}

export interface ContentCreativeReport {
  readonly version: "content-creative-report-v1";
  readonly generatedAt: string;

  readonly identity: {
    readonly creativeId: string;
    readonly parentCreativeId: string | null;
    readonly packageId: string;
    readonly ideaId: string;
    readonly campaignId: string;
    readonly platform: string;
    /** The exact bytes, or null when nothing has been rendered. */
    readonly mediaSha256: string | null;
  };

  readonly fingerprint: CreativeFingerprint;

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
  /** True only when every gate above carries a recorded approval. */
  readonly publishReady: boolean;
  readonly blockedBy: readonly string[];
}

export interface ReportInput {
  readonly review: CreativeQualityReview;
  readonly fingerprint: CreativeFingerprint;
  readonly repair?: RepairResult;
  readonly mediaSha256?: string | null;
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
  return gates;
}

export function buildContentCreativeReport(input: ReportInput): ContentCreativeReport {
  const { review, fingerprint } = input;
  const measured = review.overall.filter((score) => score.score !== null);
  const notAssessed = review.overall.filter((score) => score.score === null);
  const gates = humanGatesFor(input);

  const lineage = input.repair?.passes.map((pass) => pass.lineage) ?? [];
  const hardFailures = review.slop.hardFailures.map((finding) => `${finding.code} at ${finding.location}: ${finding.message}`);

  const blockedBy: string[] = [];
  for (const gate of gates) {
    if (gate.decision === null) blockedBy.push(`Human gate not decided: ${gate.gate}.`);
    else if (gate.decision.outcome === "rejected") blockedBy.push(`Human gate rejected: ${gate.gate} (by ${gate.decision.by}).`);
  }
  for (const failure of hardFailures) blockedBy.push(`Blocking content failure: ${failure}`);
  if (!input.mediaSha256) blockedBy.push("No rendered media: nothing exists to publish.");

  return {
    version: "content-creative-report-v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    identity: {
      creativeId: input.repair?.finalCreativeId ?? review.creativeId,
      parentCreativeId: input.parentCreativeId ?? (lineage.length ? lineage[0].parentCreativeId : null),
      packageId: review.packageId,
      ideaId: fingerprint.ideaId,
      campaignId: fingerprint.campaignId,
      platform: review.platform,
      mediaSha256: input.mediaSha256 ?? null,
    },
    fingerprint,
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
  lines.push(`  media sha256:        ${report.identity.mediaSha256 ?? "(nothing rendered)"}`);
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
