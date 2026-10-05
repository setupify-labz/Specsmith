// Read-only. What SpecSmith actually knows about every creative in the store.
//
// It opens the durable ledgers, handoff manifests, recorded results and
// analytics snapshots, and reports them. It writes nothing, advances nothing,
// contacts nothing, and — the point of the file — infers nothing. Every stage
// below is read from a real artifact on disk. Where SpecSmith does not know
// something, the report says so rather than computing a plausible answer.
//
// A missed analytics window is reported as missed. It is never back-filled,
// and a window that has not come due yet is distinguished from one that came
// due and was not captured, because those mean very different things.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { missedSnapshotWindows, nextDueSnapshotWindow } from "./analyticsIngestion.ts";
import { loadStoredAnalyticsSnapshots, loadStoredPublicationLedger } from "./publishingStore.ts";
import { loadExistingHandoff } from "./readyToPublishHandoff.ts";
import { loadStoredResult } from "./publicationResultIngestion.ts";
import type { PublicationStatus } from "./publishing.ts";
import type { SnapshotWindow, VideoPlatform } from "./types.ts";

/**
 * Where a creative has actually got to.
 *
 * "ready-not-handed-off" and the rest are derived ONLY from artifacts that
 * exist: a handoff file, a ledger event, a stored result, a snapshot. There is
 * no heuristic and no defaulting.
 */
export type PipelineStage =
  | "generated-not-reviewed"
  | "legacy-unverified"
  | "awaiting-human-review"
  | "authorized-not-sent"
  | "submission-in-progress"
  | "submission-outcome-unknown"
  | "draft-submitted"
  | "scheduled"
  | "published"
  | "rejected-or-failed";

export interface CreativeStatus {
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly stage: PipelineStage;
  readonly ledgerStatus: PublicationStatus;
  /** Present for a pre-MASTER-#8 ledger: readable history, not reviewed, authorized or confirmed. */
  readonly legacy?: { readonly since: string; readonly reason: string };
  readonly hasHandoff: boolean;
  readonly handoffPreparedAt?: string;
  readonly providerPostId?: string;
  readonly providerUrl?: string;
  readonly publishedAt?: string;
  readonly analytics: {
    readonly captured: SnapshotWindow[];
    /** Came due and was not captured. Gone for good. */
    readonly missed: SnapshotWindow[];
    /** Due now and still capturable. */
    readonly due: SnapshotWindow | null;
    /** Undefined until the creative is published — before that, nothing is due. */
    readonly measurable: boolean;
  };
}

/**
 * Every creative the durable store holds.
 *
 * Ledger directories are named by a SHA-256 of the creativeId, so the id is
 * not recoverable from the directory name — it is read out of the first stored
 * event, which carries it. A directory whose first event cannot be read is
 * skipped rather than guessed at.
 */
async function creativeIdsIn(root: string): Promise<string[]> {
  let directories: string[];
  try {
    directories = (await readdir(join(root, "publication-ledgers"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const ids: string[] = [];
  for (const directory of directories) {
    try {
      const first = JSON.parse(await readFile(join(root, "publication-ledgers", directory, "000000.json"), "utf8")) as { creativeId?: unknown };
      if (typeof first.creativeId === "string" && first.creativeId) ids.push(first.creativeId);
    } catch {
      // An unreadable or partially written ledger is not reported as a
      // creative in an unknown state; it is simply not reported.
      continue;
    }
  }
  return ids.sort();
}

function stageFrom(
  ledgerStatus: PublicationStatus,
): PipelineStage {
  switch (ledgerStatus) {
    case "rejected": case "failed": case "human-rejected": return "rejected-or-failed";
    case "published": case "analytics-partial": case "analytics-complete": return "published";
    case "scheduled": return "scheduled";
    case "draft-submitted": return "draft-submitted";
    case "submission-unknown": return "submission-outcome-unknown";
    case "submission-started": return "submission-in-progress";
    // A definite refusal: the creative is still authorized and may be resent.
    case "publication-authorized": case "submission-failed": return "authorized-not-sent";
    case "machine-reviewed": case "human-review-pending": return "awaiting-human-review";
    // Written from a self-reported score with no MASTER #7 review: not evidence of anything.
    case "qc-passed": return "legacy-unverified";
    case "generated": return "generated-not-reviewed";
  }
}

export async function reportCreativeStatus(
  root: string,
  creativeId: string,
  now = new Date(),
): Promise<CreativeStatus | null> {
  const ledger = await loadStoredPublicationLedger(root, creativeId);
  if (!ledger) return null;

  const ledgerStatus = ledger.events[ledger.events.length - 1].status;
  const handoff = await loadExistingHandoff(root, creativeId, ledger.platform);
  const providerEvent = [...ledger.events].reverse().find((event) => event.providerPostId);
  const publishedEvent = ledger.events.find((event) => event.status === "published");

  const snapshots = publishedEvent ? await loadStoredAnalyticsSnapshots(root, creativeId) : [];
  const measurable = Boolean(publishedEvent);

  return {
    creativeId,
    platform: ledger.platform,
    stage: ledger.legacy ? "legacy-unverified" : stageFrom(ledgerStatus),
    ledgerStatus,
    ...(ledger.legacy ? { legacy: ledger.legacy } : {}),
    hasHandoff: Boolean(handoff),
    handoffPreparedAt: handoff?.preparedAt,
    providerPostId: providerEvent?.providerPostId,
    providerUrl: providerEvent?.providerUrl,
    publishedAt: publishedEvent?.at,
    analytics: {
      captured: snapshots.map((snapshot) => snapshot.window),
      // Only meaningful once published; before that no window has come due,
      // and reporting windows as "missed" would be false.
      missed: measurable && publishedEvent ? missedSnapshotWindows(publishedEvent.at, snapshots, now) : [],
      due: measurable && publishedEvent ? nextDueSnapshotWindow(publishedEvent.at, snapshots, now) : null,
      measurable,
    },
  };
}

export async function reportAllCreatives(root: string, now = new Date()): Promise<CreativeStatus[]> {
  const statuses: CreativeStatus[] = [];
  for (const creativeId of await creativeIdsIn(root)) {
    const status = await reportCreativeStatus(root, creativeId, now);
    if (status) statuses.push(status);
  }
  return statuses;
}

/** Whether a recorded connector result exists for this creative and state. */
export async function hasRecordedResult(
  root: string,
  creativeId: string,
  platform: VideoPlatform,
  status: "scheduled" | "published" | "failed",
): Promise<boolean> {
  return (await loadStoredResult(root, creativeId, platform, status)) !== null;
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  "generated-not-reviewed": "rendered; no MASTER #7 review recorded",
  "legacy-unverified": "LEGACY ledger: qc-passed from a self-reported score; not MASTER #7 reviewed, not authorized, later states not provider-confirmed",
  "awaiting-human-review": "machine-reviewed; awaiting human review (not approved)",
  "authorized-not-sent": "authorized by a trusted decision; not sent",
  "submission-in-progress": "submission started; no provider answer recorded",
  "submission-outcome-unknown": "submission outcome UNKNOWN; reconcile with the provider before any retry",
  "draft-submitted": "draft accepted by the provider",
  scheduled: "schedule accepted by the provider",
  published: "publication confirmed by the provider",
  "rejected-or-failed": "rejected or failed",
};

/** Human-readable rendering. Reports only what the structured data holds. */
export function formatStatusReport(statuses: readonly CreativeStatus[]): string {
  if (statuses.length === 0) return "No publications in this store.";
  const lines: string[] = [];
  for (const status of statuses) {
    lines.push(`${status.creativeId} [${status.platform}] — ${STAGE_LABEL[status.stage]}${status.legacy ? ` (last recorded state: ${status.ledgerStatus})` : ""}`);
    if (status.hasHandoff) lines.push(`  handoff prepared: ${status.handoffPreparedAt}`);
    if (status.providerPostId) lines.push(`  provider post: ${status.providerPostId}${status.providerUrl ? ` (${status.providerUrl})` : ""}`);
    if (!status.analytics.measurable) {
      lines.push("  analytics: not measurable yet (nothing published)");
    } else {
      lines.push(`  analytics captured: ${status.analytics.captured.join(", ") || "none"}`);
      lines.push(`  analytics missed:   ${status.analytics.missed.join(", ") || "none"}`);
      lines.push(`  analytics due now:  ${status.analytics.due ?? "none"}`);
    }
  }
  return lines.join("\n");
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: tsx publicationStatusReport.ts <store-root>");
    process.exitCode = 1;
  } else {
    reportAllCreatives(root)
      .then((statuses) => console.log(formatStatusReport(statuses)))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
