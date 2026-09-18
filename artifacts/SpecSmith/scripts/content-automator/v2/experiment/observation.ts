// MASTER #5 — Performance observations and window semantics
// (sections 13, 14, 15, 16, 36, 37, 51, 53, 54, 55).
//
// The boundary where a validated ANALYTICS_RESULT becomes an experimental
// observation — or is refused.
//
// This layer does NOT fetch anything. It does not know Metricool exists. The
// existing `connectorAnalyticsIngestion` already validates provider identity,
// window-due and replay, and duplicating that here would create a second,
// weaker source of analytics truth. MASTER #5 consumes what that boundary
// already blessed and adds the questions only an experiment can ask: does this
// observation belong to an assignment, at the window the design registered,
// captured after the window was actually due?
//
// The window rules are the load-bearing part. One creative with 1h, 6h, 24h,
// 72h and 7d snapshots is ONE creative — not five samples. A 24h reading and a
// 7d reading are not comparable. A missing 24h snapshot is missed, not
// approximated from the 72h one. Each of those is a way to manufacture evidence
// out of nothing, and each is refused here by name.

import type { SnapshotWindow, VideoPlatform } from "../../types.ts";
import { snapshotDueAt } from "../../analyticsIngestion.ts";
import type { AnalyticsResultDocument } from "../../connectorAnalyticsIngestion.ts";
import type { ExperimentAssignment } from "./model.ts";
import { readingFromRaw, type MetricReading } from "./metrics.ts";

export class ObservationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ObservationError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Window due logic (sections 54, 55)
// ---------------------------------------------------------------------------

export type WindowState = "not-yet-due" | "due" | "collected" | "missed" | "failed";

export interface WindowStatus {
  readonly window: SnapshotWindow;
  readonly state: WindowState;
  readonly dueAt: string;
  readonly explanation: string;
}

/**
 * How long after `dueAt` a snapshot may still be considered on time.
 *
 * Deliberately generous in absolute terms but explicitly bounded, because
 * section 55 requires any tolerance to be defined and tested rather than left
 * as an implicit "close enough". Past this, the window is MISSED — and a missed
 * 24h window is never replaced by the 72h figure.
 */
export const WINDOW_TOLERANCE_HOURS = 6;

export function windowStatus(
  publishedAt: string,
  window: SnapshotWindow,
  now: Date,
  collected: boolean,
  failed = false,
): WindowStatus {
  const dueAt = snapshotDueAt(publishedAt, window);
  const dueMs = Date.parse(dueAt);
  const toleranceMs = WINDOW_TOLERANCE_HOURS * 3_600_000;

  if (failed) {
    return {
      window,
      state: "failed",
      dueAt,
      explanation: `Collection for the ${window} window was attempted and failed. A failed collection is not a performance result.`,
    };
  }
  if (collected) {
    return { window, state: "collected", dueAt, explanation: `The ${window} window was collected.` };
  }
  if (now.getTime() < dueMs) {
    return {
      window,
      state: "not-yet-due",
      dueAt,
      explanation: `The ${window} window is not due until ${dueAt}. Nothing is missing yet.`,
    };
  }
  if (now.getTime() <= dueMs + toleranceMs) {
    return { window, state: "due", dueAt, explanation: `The ${window} window became due at ${dueAt} and can still be collected.` };
  }
  return {
    window,
    state: "missed",
    dueAt,
    explanation:
      `The ${window} window was due at ${dueAt} and is now past the ${WINDOW_TOLERANCE_HOURS}h tolerance. It is MISSED. ` +
      "It may not be substituted with a neighbouring window: a 72h figure is not a late 24h figure, it is a different measurement.",
  };
}

export function allWindowStatuses(publishedAt: string, collectedWindows: readonly SnapshotWindow[], now: Date): readonly WindowStatus[] {
  const windows: readonly SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];
  return windows.map((window) => windowStatus(publishedAt, window, now, collectedWindows.includes(window)));
}

// ---------------------------------------------------------------------------
// Performance observation (section 16)
// ---------------------------------------------------------------------------

export type ObservationValidity = "valid" | "identity-mismatch" | "window-mismatch" | "impossible-timing" | "malformed";

export type CollectionStatus = "collected" | "partial" | "failed";

/**
 * One measurement of one creative at one window. Immutable.
 *
 * Carries every identity field needed to trace back to the exact bytes that
 * shipped, because an observation that cannot be attributed precisely is not
 * evidence about anything.
 */
export interface PerformanceObservation {
  readonly version: "performance-observation-v1";
  readonly observationId: string;
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly variantId: string;
  readonly creativeId: string;
  readonly creativeLineageId: string;
  readonly platform: VideoPlatform;
  readonly packageId: string;
  readonly providerPostId: string;
  readonly approvedMediaSha256: string;
  readonly window: SnapshotWindow;
  readonly publishedAt: string;
  readonly capturedAt: string;
  readonly dueAt: string;
  readonly metrics: ReadonlyMap<string, MetricReading>;
  readonly validity: ObservationValidity;
  readonly collectionStatus: CollectionStatus;
  readonly synthetic: boolean;
  readonly provenance: { readonly producedBy: string; readonly producedAt: string };
  readonly notes: readonly string[];
}

/** Maps ANALYTICS_RESULT provider fields onto registry metric ids. */
const FIELD_TO_METRIC: Readonly<Record<string, string>> = {
  views: "views",
  stayedToWatchRate: "stayed-to-watch-rate",
  averagePercentageViewed: "average-percentage-viewed",
  averageViewDurationSeconds: "average-view-duration-seconds",
  shares: "shares",
  saves: "saves",
  comments: "comments",
  siteClicks: "site-clicks",
  profileVisits: "profile-visits",
  followsGained: "follows-gained",
};

export interface ObservationEnvironment {
  /** False on every production path. */
  readonly allowSynthetic: boolean;
}

export interface BuildObservationInput {
  readonly analytics: AnalyticsResultDocument;
  readonly assignment: ExperimentAssignment;
  readonly expectedWindow: SnapshotWindow;
  readonly synthetic: boolean;
  readonly environment: ObservationEnvironment;
  readonly now: Date;
  readonly producedBy: string;
}

/**
 * Turn a validated ANALYTICS_RESULT into an experimental observation.
 *
 * Refuses rather than repairs. Every check below is a way an observation could
 * be attributed to the wrong thing, and a wrong attribution is worse than a
 * missing one: a gap is visible, a misattribution looks like data.
 */
export function buildObservation(input: BuildObservationInput): PerformanceObservation {
  const { analytics, assignment, expectedWindow, now } = input;

  if (input.synthetic && !input.environment.allowSynthetic) {
    throw new ObservationError(
      "synthetic-in-production",
      "This performance observation is synthetic engineering fixture data. Synthetic analytics may never become a production " +
        "performance result: a fabricated number is indistinguishable from a measured one once it is stored.",
    );
  }

  // --- Identity (sections 35, 52) -----------------------------------------
  if (analytics.creativeId !== assignment.creativeId) {
    throw new ObservationError(
      "creative-mismatch",
      `Analytics for creative ${analytics.creativeId} were offered against the assignment for ${assignment.creativeId}.`,
    );
  }
  if (analytics.platform !== assignment.platform) {
    throw new ObservationError(
      "platform-mismatch",
      `Analytics report platform ${analytics.platform} but the assignment is on ${assignment.platform}.`,
    );
  }
  if (analytics.packageId !== assignment.packageId) {
    throw new ObservationError(
      "package-mismatch",
      `Analytics carry package ${analytics.packageId} but the assignment published package ${assignment.packageId}. ` +
        "Performance must bind to the exact package that shipped.",
    );
  }
  if (assignment.providerPostId === null) {
    throw new ObservationError(
      "no-provider-post",
      `Creative ${assignment.creativeId} has no recorded provider post, so no analytics can be attributed to it.`,
    );
  }
  if (analytics.providerPostId !== assignment.providerPostId) {
    throw new ObservationError(
      "provider-post-mismatch",
      `Analytics carry provider post ${analytics.providerPostId} but the assignment published ${assignment.providerPostId}. ` +
        "This would attribute one video's numbers to another.",
    );
  }

  // --- Window (section 13) ------------------------------------------------
  if (analytics.window !== expectedWindow) {
    throw new ObservationError(
      "window-mismatch",
      `Analytics were captured at the ${analytics.window} window but this experiment compares at ${expectedWindow}. ` +
        "A different window is a different measurement, not a substitute for the one that is missing.",
    );
  }

  // --- Chronology (section 53) --------------------------------------------
  if (assignment.publishedAt === null) {
    throw new ObservationError("no-publish-time", `Creative ${assignment.creativeId} has no publication time, so no window can be due.`);
  }
  const dueAt = snapshotDueAt(assignment.publishedAt, expectedWindow);
  const capturedMs = Date.parse(analytics.capturedAt);

  if (capturedMs < Date.parse(assignment.publishedAt)) {
    throw new ObservationError(
      "captured-before-publish",
      `Analytics were captured at ${analytics.capturedAt}, before the creative was published at ${assignment.publishedAt}.`,
    );
  }
  if (capturedMs < Date.parse(dueAt)) {
    throw new ObservationError(
      "captured-before-window-due",
      `Analytics claim the ${expectedWindow} window but were captured at ${analytics.capturedAt}, before that window was due at ${dueAt}. ` +
        "A 24-hour result read ten minutes after publication is not a 24-hour result.",
    );
  }
  if (capturedMs > now.getTime()) {
    throw new ObservationError("captured-in-future", `Analytics were captured at ${analytics.capturedAt}, which is in the future.`);
  }

  // --- Metrics (section 15) -----------------------------------------------
  const metrics = new Map<string, MetricReading>();
  const notes: string[] = [];
  const raw = analytics.metrics as unknown as Record<string, unknown>;

  for (const [field, metricId] of Object.entries(FIELD_TO_METRIC)) {
    const present = Object.prototype.hasOwnProperty.call(raw, field);
    if (!present) {
      metrics.set(metricId, {
        state: "not-collected",
        reason: `The analytics document does not report "${field}". Not collected is not zero.`,
      });
      continue;
    }
    const reading = readingFromRaw(raw[field], `${analytics.creativeId}:${metricId}`);
    if (reading.state === "invalid") notes.push(`${metricId}: ${reading.reason}`);
    metrics.set(metricId, reading);
  }

  // Views is the one required field, and a negative count is impossible.
  const views = metrics.get("views");
  if (views !== undefined && views.state === "measured" && views.value < 0) {
    metrics.set("views", { state: "invalid", reason: "A negative view count is impossible.", raw: String(views.value) });
    notes.push("views: negative count rejected.");
  }

  const measuredCount = [...metrics.values()].filter((reading) => reading.state === "measured").length;
  const collectionStatus: CollectionStatus =
    measuredCount === 0 ? "failed" : measuredCount < metrics.size ? "partial" : "collected";

  return {
    version: "performance-observation-v1",
    observationId: `obs-${assignment.experimentId}-${assignment.creativeId}-${expectedWindow}`,
    experimentId: assignment.experimentId,
    experimentRevision: assignment.experimentRevision,
    variantId: assignment.variantId,
    creativeId: assignment.creativeId,
    creativeLineageId: assignment.creativeLineageId,
    platform: assignment.platform,
    packageId: assignment.packageId,
    providerPostId: assignment.providerPostId,
    approvedMediaSha256: assignment.approvedMediaSha256,
    window: expectedWindow,
    publishedAt: assignment.publishedAt,
    capturedAt: analytics.capturedAt,
    dueAt,
    metrics,
    validity: "valid",
    collectionStatus,
    synthetic: input.synthetic,
    provenance: { producedBy: input.producedBy, producedAt: now.toISOString() },
    notes,
  };
}

// ---------------------------------------------------------------------------
// The observation store (sections 36, 52)
// ---------------------------------------------------------------------------

/**
 * Append-only. Observations are raw measurements and never change.
 *
 * Interpretations are stored separately and may be superseded (section 37);
 * the measurement they were based on must remain exactly as it was, or an old
 * interpretation becomes unreconstructable.
 */
export class ObservationStore {
  private readonly byId = new Map<string, PerformanceObservation>();

  record(observation: PerformanceObservation): PerformanceObservation {
    const existing = this.byId.get(observation.observationId);
    if (existing !== undefined) {
      if (sameMetrics(existing, observation)) return existing;
      throw new ObservationError(
        "conflicting-observation-replay",
        `Observation ${observation.observationId} already exists with different metrics. Raw measurements are immutable: ` +
          "an exact replay is idempotent, a conflicting one would rewrite what was measured.",
      );
    }
    this.byId.set(observation.observationId, observation);
    return observation;
  }

  forExperiment(experimentId: string): readonly PerformanceObservation[] {
    return [...this.byId.values()]
      .filter((observation) => observation.experimentId === experimentId)
      .sort((a, b) => a.observationId.localeCompare(b.observationId));
  }

  /**
   * Observations usable for a comparison: one per creative, at one window.
   *
   * Mirrors the semantics of the existing `selectLearnerRecords` — one record
   * per creative, at the selected window, earliest capture on a tie, nothing
   * back-filled — applied to experimental observations. Creatives without the
   * window are EXCLUDED and named, never approximated.
   */
  selectForComparison(experimentId: string, window: SnapshotWindow): ComparisonSelection {
    const all = this.forExperiment(experimentId);
    const byCreative = new Map<string, PerformanceObservation[]>();
    for (const observation of all) {
      const group = byCreative.get(observation.creativeId) ?? [];
      group.push(observation);
      byCreative.set(observation.creativeId, group);
    }

    const selected: PerformanceObservation[] = [];
    const excluded: { readonly creativeId: string; readonly availableWindows: readonly SnapshotWindow[]; readonly reason: string }[] = [];

    for (const [creativeId, group] of [...byCreative.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const atWindow = group
        .filter((observation) => observation.window === window)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

      if (atWindow.length === 0) {
        excluded.push({
          creativeId,
          availableWindows: [...new Set(group.map((observation) => observation.window))].sort(),
          reason:
            `No observation at the ${window} window. This creative is excluded rather than back-filled from another window: ` +
            "a smaller honest sample beats a larger invented one.",
        });
        continue;
      }
      selected.push(atWindow[0]);
    }

    return { window, observations: selected, excluded };
  }

  all(): readonly PerformanceObservation[] {
    return [...this.byId.values()].sort((a, b) => a.observationId.localeCompare(b.observationId));
  }
}

export interface ComparisonSelection {
  readonly window: SnapshotWindow;
  readonly observations: readonly PerformanceObservation[];
  readonly excluded: readonly { readonly creativeId: string; readonly availableWindows: readonly SnapshotWindow[]; readonly reason: string }[];
}

function sameMetrics(a: PerformanceObservation, b: PerformanceObservation): boolean {
  if (a.capturedAt !== b.capturedAt || a.providerPostId !== b.providerPostId) return false;
  if (a.metrics.size !== b.metrics.size) return false;
  for (const [metricId, reading] of a.metrics) {
    const other = b.metrics.get(metricId);
    if (other === undefined || other.state !== reading.state) return false;
    if (reading.state === "measured" && other.state === "measured" && reading.value !== other.value) return false;
  }
  return true;
}

/**
 * Guard against counting windows as samples (section 19, NC6).
 *
 * Exported so the comparison layer can assert it explicitly rather than relying
 * on selection having been done correctly upstream.
 */
export function assertOneObservationPerCreative(observations: readonly PerformanceObservation[]): void {
  const seen = new Map<string, PerformanceObservation>();
  for (const observation of observations) {
    const existing = seen.get(observation.creativeId);
    if (existing !== undefined) {
      throw new ObservationError(
        "multiple-observations-per-creative",
        `Creative ${observation.creativeId} appears twice in one comparison (windows ${existing.window} and ${observation.window}). ` +
          "One creative observed at several windows is still one creative; counting the windows would inflate the sample.",
      );
    }
    seen.set(observation.creativeId, observation);
  }

  const windows = new Set(observations.map((observation) => observation.window));
  if (windows.size > 1) {
    throw new ObservationError(
      "mixed-windows",
      `A single comparison mixes windows: ${[...windows].sort().join(", ")}. A creative measured at 7d has had a week to ` +
        "accumulate against one measured at 24h, so the comparison would rank age rather than creative.",
    );
  }
}
