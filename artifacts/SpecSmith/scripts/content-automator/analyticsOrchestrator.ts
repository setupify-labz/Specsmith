// The scheduler for the post-publication learning loop.
//
// It walks the durable store, works out which creatives have really been
// published, asks the collector for the window that is actually due, and then
// runs learning on what was genuinely measured. It is the piece that was
// missing: the collector and the learner were both correct and neither had a
// caller.
//
// WHERE ATTRIBUTION COMES FROM
// ----------------------------
// Analytics must be attributed to the exact creative that earned them, which
// needs the fingerprint, the ideaId and the target duration. All three live
// inside the CreativeFingerprint recorded with the ledger's creation event —
// one canonical record, written once, by the same call that created the
// ledger. Nothing here asks a caller to supply them, and nothing reconstructs
// them from other fields: a creative whose ledger predates fingerprint
// persistence is SKIPPED with a named reason, because an attribution that
// cannot be proven is worse than an absent one.
//
// WHAT IT WILL NOT DO
// -------------------
// No REST posting, no publishing, no credentials of its own, no state change
// to any creative. It reads, it fetches analytics through the collector's
// injected transport, it writes immutable snapshots, and it reports. A window
// that was missed stays missed; a fetch that failed leaves the window
// uncaptured rather than storing zeroes, because "nobody watched it" and "we
// did not manage to ask" are different facts.

import {
  collectDueAnalytics,
  runLearningFromStoredSnapshots,
  type CollectionReport,
  type KnownPublication,
  type LearningRun,
} from "./metricoolAnalyticsCollector.ts";
import type { MetricoolCredentials, MetricoolTransport } from "./metricoolClient.ts";
import {
  loadStoredCreativeFingerprint,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import { reportAllCreatives } from "./publicationStatusReport.ts";
import type { PublicationLedger } from "./publishing.ts";
import type { SnapshotWindow } from "./types.ts";

/** Why a creative the store holds is not eligible for analytics collection. */
export type SkipReason =
  | "not-published"
  | "no-provider-id"
  | "no-stored-fingerprint";

export interface SkippedCreative {
  readonly creativeId: string;
  readonly reason: SkipReason;
}

export interface EligibilityScan {
  readonly eligible: KnownPublication[];
  readonly skipped: SkippedCreative[];
}

/**
 * Turns one ledger into a publication the collector may query, or says why not.
 *
 * Three independent requirements, each checked on real stored evidence:
 * a `published` event, a provider id recorded against it, and a stored
 * fingerprint. A creative failing any of them is skipped by name.
 */
export async function eligibilityFor(
  root: string,
  ledger: PublicationLedger,
): Promise<KnownPublication | SkippedCreative> {
  const published = ledger.events.find((event) => event.status === "published");
  if (!published) {
    // Scheduled is not published. A post sitting in a queue has nothing to
    // measure, and asking for its analytics would at best return nothing.
    return { creativeId: ledger.creativeId, reason: "not-published" };
  }

  const withId = [...ledger.events].reverse().find((event) => event.providerPostId);
  if (!withId?.providerPostId) {
    return { creativeId: ledger.creativeId, reason: "no-provider-id" };
  }

  const fingerprint = await loadStoredCreativeFingerprint(root, ledger.creativeId);
  if (!fingerprint) {
    return { creativeId: ledger.creativeId, reason: "no-stored-fingerprint" };
  }

  return {
    creativeId: ledger.creativeId,
    platform: ledger.platform,
    providerPostId: withId.providerPostId,
    publishedAt: published.at,
    // Both derived from the one canonical record, never from a caller.
    ideaId: fingerprint.ideaId,
    durationSeconds: fingerprint.targetDurationSeconds,
    fingerprint,
  };
}

/** Every creative in the store, sorted into eligible and skipped. */
export async function scanEligiblePublications(root: string, now = new Date()): Promise<EligibilityScan> {
  const eligible: KnownPublication[] = [];
  const skipped: SkippedCreative[] = [];

  for (const status of await reportAllCreatives(root, now)) {
    const ledger = await loadStoredPublicationLedger(root, status.creativeId);
    if (!ledger) continue;
    const outcome = await eligibilityFor(root, ledger);
    if ("reason" in outcome) skipped.push(outcome);
    else eligible.push(outcome);
  }

  return { eligible, skipped };
}

/**
 * The learning result.
 *
 * `learning: null` with a stated reason is a first-class outcome, not a
 * degenerate success. An empty PerformanceLearning would read as "we measured
 * and found nothing"; "no trustworthy records yet" is what is actually true
 * before enough windows have been captured.
 */
export interface OrchestrationResult {
  readonly collection: CollectionReport;
  readonly scan: EligibilityScan;
  readonly learningWindow: SnapshotWindow;
  readonly learning: LearningRun["learning"] | null;
  readonly learningStatus: "learned" | "no-learning-yet";
  readonly learningReason?: string;
  /** Creatives excluded from learning because they lack the chosen window. */
  readonly excludedFromLearning: { creativeId: string; availableWindows: SnapshotWindow[] }[];
}

export interface OrchestrateOptions {
  readonly storeRoot: string;
  readonly credentials: MetricoolCredentials;
  readonly transport: MetricoolTransport;
  readonly blogId: string;
  /** The window every learned record must share. Required: there is no safe default. */
  readonly learningWindow: SnapshotWindow;
  readonly baseUrl?: string;
  readonly now?: Date;
}

/**
 * One pass: find what is measurable, capture what is due, then learn from what
 * is genuinely comparable.
 *
 * Safe to run repeatedly. Already-captured windows are not re-fetched (the
 * collector reports `already-captured`/`not-due` without a request), and
 * snapshots are immutable, so a second run in the same window changes nothing.
 */
export async function runAnalyticsPass(options: OrchestrateOptions): Promise<OrchestrationResult> {
  const now = options.now ?? new Date();
  const scan = await scanEligiblePublications(options.storeRoot, now);

  const collection = await collectDueAnalytics(scan.eligible, {
    storeRoot: options.storeRoot,
    credentials: options.credentials,
    transport: options.transport,
    blogId: options.blogId,
    baseUrl: options.baseUrl,
    now,
  });

  // Learning reads only creatives that were eligible in the first place, and
  // only through selectLearnerRecords, which enforces one record per creative
  // at one window. analyzePerformance refuses anything else.
  const run: LearningRun = await runLearningFromStoredSnapshots(
    options.storeRoot,
    scan.eligible.map((publication) => publication.creativeId),
    options.learningWindow,
    now,
  );

  const excludedFromLearning = run.selection.excluded.map((entry) => ({
    creativeId: entry.creativeId,
    availableWindows: entry.availableWindows,
  }));

  if (!run.learning) {
    return {
      collection,
      scan,
      learningWindow: options.learningWindow,
      learning: null,
      learningStatus: "no-learning-yet",
      learningReason: scan.eligible.length === 0
        ? "No creative has a published ledger event with a provider id and a stored fingerprint."
        : `No creative has a captured ${options.learningWindow} snapshot yet.`,
      excludedFromLearning,
    };
  }

  return {
    collection,
    scan,
    learningWindow: options.learningWindow,
    learning: run.learning,
    learningStatus: "learned",
    excludedFromLearning,
  };
}

/** Human-readable rendering. Reports only what the result holds. */
export function formatAnalyticsPass(result: OrchestrationResult): string {
  const lines: string[] = [];
  lines.push(`Eligible for analytics: ${result.scan.eligible.length}`);
  for (const skip of result.scan.skipped) lines.push(`  skipped ${skip.creativeId}: ${skip.reason}`);

  for (const outcome of result.collection.outcomes) {
    lines.push(outcome.status === "captured"
      ? `  captured ${outcome.creativeId} @ ${outcome.window}`
      : outcome.status === "not-due" || outcome.status === "already-captured"
        ? `  ${outcome.status} ${outcome.creativeId}`
        : `  ${outcome.status} ${outcome.creativeId} @ ${outcome.window}: ${outcome.detail}`);
  }
  for (const missed of result.collection.missed) {
    lines.push(`  MISSED (not recoverable) ${missed.creativeId}: ${missed.windows.join(", ")}`);
  }

  lines.push(result.learningStatus === "learned"
    ? `Learning from ${result.learningWindow}: ${result.learning?.recommendations.length ?? 0} recommendation(s)`
    : `No learning yet: ${result.learningReason}`);
  for (const excluded of result.excludedFromLearning) {
    lines.push(`  excluded from learning ${excluded.creativeId} (has: ${excluded.availableWindows.join(", ") || "nothing"})`);
  }
  return lines.join("\n");
}
