// Collects real analytics for publications SpecSmith actually made, and hands
// the learner an input it can trust.
//
// SERVER ONLY, for the same reason metricoolClient.ts is: it reads credentials.
//
// THE RULE THAT SHAPES EVERY FUNCTION HERE: a metric is either measured or it
// is absent. Nothing in this file interpolates a missing window, carries a
// figure forward from an earlier capture, back-fills from a later one, or
// substitutes a neighbouring window's row for the one that was due. A creative
// whose 24h capture was missed simply has no 24h snapshot, for ever — the
// window has passed and the number it would have held is not recoverable.
//
// WHAT IT READS, AND WHY ONLY THAT
// --------------------------------
// The only publications it will fetch are ones the durable ledger says were
// actually published, with a provider id the transport recorded at the time.
// It never enumerates an account's posts and never accepts a caller-supplied
// id: analytics that cannot be traced to one of our own ledgered publications
// cannot be attributed to a creative, and an unattributable number is worse
// than a missing one.

import {
  missedSnapshotWindows,
  nextDueSnapshotWindow,
  normalizeMetricoolAnalyticsRow,
  selectLearnerRecords,
  type AnalyticsSnapshot,
  type LearnerRecordSelection,
  type MetricoolAnalyticsContext,
} from "./analyticsIngestion.ts";
import { analyzePerformance } from "./performance.ts";
import type { MetricoolCredentials, MetricoolTransport } from "./metricoolClient.ts";
import type { PublicationLedger } from "./publishing.ts";
import {
  loadStoredAnalyticsSnapshots,
  recordStoredAnalyticsSnapshot,
} from "./publishingStore.ts";
import type { CreativeFingerprint, PerformanceLearning, SnapshotWindow, VideoPlatform } from "./types.ts";

if (typeof globalThis !== "undefined" && "window" in globalThis) {
  throw new Error(
    "metricoolAnalyticsCollector is server-only: it reads API credentials and must never be bundled into browser code.",
  );
}

/** One ledgered publication this collector is allowed to ask about. */
export interface KnownPublication {
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly providerPostId: string;
  readonly publishedAt: string;
  readonly durationSeconds: number;
  readonly ideaId: string;
  readonly fingerprint: CreativeFingerprint;
}

export type CollectionOutcome =
  | { status: "captured"; creativeId: string; window: SnapshotWindow; snapshot: AnalyticsSnapshot }
  | { status: "not-due"; creativeId: string }
  | { status: "already-captured"; creativeId: string; window: SnapshotWindow }
  | { status: "no-data"; creativeId: string; window: SnapshotWindow; detail: string }
  | { status: "failed"; creativeId: string; window: SnapshotWindow; detail: string };

export interface CollectionReport {
  readonly outcomes: CollectionOutcome[];
  /**
   * Windows that were due and are now permanently past for each creative.
   * Surfaced rather than quietly filled: a reviewer should be able to see that
   * a capture was missed instead of finding a plausible number in its place.
   */
  readonly missed: { creativeId: string; windows: SnapshotWindow[] }[];
}

export interface CollectOptions {
  readonly storeRoot: string;
  readonly credentials: MetricoolCredentials;
  readonly transport: MetricoolTransport;
  readonly blogId: string;
  readonly baseUrl?: string;
  readonly now?: Date;
}

const DEFAULT_BASE_URL = "https://app.metricool.com/api";

// knownPublicationFromLedger used to live here, taking ideaId, durationSeconds
// and the fingerprint as parameters because the ledger did not persist them.
// That made the caller a second source of truth for how analytics are
// attributed, and a caller that passed the wrong fingerprint would have
// mis-attributed real metrics with nothing to catch it.
//
// The fingerprint is now recorded once with the ledger's creation event, and
// analyticsOrchestrator.eligibilityFor() derives all three from that one
// canonical record. There is deliberately no second way to construct a
// KnownPublication.

function analyticsRowFrom(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const body = parsed as Record<string, unknown>;
  const data = body.data ?? body;
  if (Array.isArray(data)) {
    // Exactly one row is expected for one post. Zero means no data yet; more
    // than one means the query was not specific enough to attribute, and
    // guessing which row belongs to this creative is precisely the ambiguous
    // matching SpecSmith refuses.
    return data.length === 1 && data[0] && typeof data[0] === "object" ? (data[0] as Record<string, unknown>) : undefined;
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
}

/**
 * Captures the one window that is currently due for each known publication.
 *
 * Never captures a window that is not due, never re-writes one already stored
 * (the store rejects that anyway — this avoids the pointless request), and
 * never writes a row into a window other than the one it was fetched for.
 */
export async function collectDueAnalytics(
  publications: readonly KnownPublication[],
  options: CollectOptions,
): Promise<CollectionReport> {
  const now = options.now ?? new Date();
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const outcomes: CollectionOutcome[] = [];
  const missed: CollectionReport["missed"] = [];

  for (const publication of publications) {
    const existing = await loadStoredAnalyticsSnapshots(options.storeRoot, publication.creativeId);
    const capturedWindows = existing.map((snapshot) => snapshot.window);

    const gone = missedSnapshotWindows(publication.publishedAt, existing, now);
    if (gone.length > 0) missed.push({ creativeId: publication.creativeId, windows: gone });

    const due = nextDueSnapshotWindow(publication.publishedAt, existing, now);
    if (!due) {
      outcomes.push({ status: "not-due", creativeId: publication.creativeId });
      continue;
    }
    if (capturedWindows.includes(due)) {
      outcomes.push({ status: "already-captured", creativeId: publication.creativeId, window: due });
      continue;
    }

    const url = `${baseUrl}/v2/analytics/posts/${encodeURIComponent(publication.providerPostId)}`
      + `?blogId=${encodeURIComponent(options.blogId)}&userId=${encodeURIComponent(options.credentials.userId)}`;

    let row: Record<string, unknown> | undefined;
    try {
      const response = await options.transport(url, {
        method: "GET",
        headers: { "Content-Type": "application/json", "X-Mc-Auth": options.credentials.userToken },
        body: "",
      });
      if (response.status < 200 || response.status >= 300) {
        outcomes.push({
          status: "failed",
          creativeId: publication.creativeId,
          window: due,
          detail: `HTTP ${response.status}`,
        });
        continue;
      }
      row = analyticsRowFrom(await response.text());
    } catch (error) {
      outcomes.push({ status: "failed", creativeId: publication.creativeId, window: due, detail: (error as Error).message });
      continue;
    }

    if (!row) {
      // No usable row. The window stays uncaptured rather than being filled
      // with zeroes, which would read as "nobody watched it".
      outcomes.push({
        status: "no-data",
        creativeId: publication.creativeId,
        window: due,
        detail: "Metricool returned no single attributable row for this post.",
      });
      continue;
    }

    const context: MetricoolAnalyticsContext = {
      creativeId: publication.creativeId,
      videoId: publication.providerPostId,
      ideaId: publication.ideaId,
      platform: publication.platform,
      publishedAt: publication.publishedAt,
      durationSeconds: publication.durationSeconds,
      fingerprint: publication.fingerprint,
      window: due,
      capturedAt: now.toISOString(),
    };

    let snapshot: AnalyticsSnapshot;
    try {
      snapshot = normalizeMetricoolAnalyticsRow(row, context);
    } catch (error) {
      outcomes.push({ status: "failed", creativeId: publication.creativeId, window: due, detail: (error as Error).message });
      continue;
    }

    // Belt and braces against the one substitution that would corrupt the
    // series: a row fetched for the due window must be stored as that window.
    if (snapshot.window !== due) {
      throw new Error(
        `Refusing to store a ${snapshot.window} snapshot in the ${due} window for ${publication.creativeId}; windows are never substituted.`,
      );
    }

    const stored = await recordStoredAnalyticsSnapshot(options.storeRoot, snapshot);
    outcomes.push({ status: "captured", creativeId: publication.creativeId, window: due, snapshot: stored });
  }

  return { outcomes, missed };
}

export interface LearningRun {
  readonly selection: LearnerRecordSelection;
  readonly learning: PerformanceLearning | undefined;
}

/**
 * Feeds stored snapshots through selectLearnerRecords before analyzePerformance.
 *
 * The ordering is the point. analyzePerformance refuses duplicate creatives and
 * mixed windows, and selectLearnerRecords is what produces input it accepts:
 * one record per creative, all at one window, with every creative missing that
 * window named in `selection.excluded` rather than silently dropped.
 *
 * Returns `learning: undefined` for an empty selection instead of an empty
 * analysis, so a caller cannot mistake "nothing measured yet" for "measured and
 * found nothing".
 */
export async function runLearningFromStoredSnapshots(
  storeRoot: string,
  creativeIds: readonly string[],
  window: SnapshotWindow,
  now = new Date(),
): Promise<LearningRun> {
  const snapshots: AnalyticsSnapshot[] = [];
  for (const creativeId of creativeIds) {
    snapshots.push(...(await loadStoredAnalyticsSnapshots(storeRoot, creativeId)));
  }
  const selection = selectLearnerRecords(snapshots, window);
  return {
    selection,
    learning: selection.records.length > 0 ? analyzePerformance(selection.records, now) : undefined,
  };
}
