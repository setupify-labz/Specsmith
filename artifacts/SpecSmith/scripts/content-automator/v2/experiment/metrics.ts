// MASTER #5 — Metric registry and availability (sections 9, 10, 11, 12, 15, 57, 58, 59).
//
// Two rules do all the work here.
//
// FIRST: a metric that was not measured is not zero. `unavailable`, `failed`,
// `not-collected`, `not-yet-due` and `unknown` are five different facts about
// the WORLD, and collapsing any of them into 0 turns a collection outage into
// a creative that performed badly. Every one of them is a distinct variant of
// `MetricReading` and none carries a number.
//
// SECOND: metrics are platform-local. "Retention" on YouTube and a watch
// metric on TikTok are not the same measurement wearing different names, and
// averaging them produces a number about nothing. Every definition below is
// scoped to one platform, and comparison across platforms is refused rather
// than normalized (section 57).
//
// There is deliberately no composite "content score" (section 59). A single
// number that blends retention, shares and clicks hides which one moved, and
// the whole job of this layer is to know which one moved.

import type { VideoPlatform } from "../../types.ts";
import type { StrategicObjective } from "../strategy/model.ts";

// ---------------------------------------------------------------------------
// Metric availability (section 15)
// ---------------------------------------------------------------------------

/**
 * A metric reading.
 *
 * Only ONE variant carries a number. Everything else records why there is no
 * number, which is information the interpretation layer needs and which a 0
 * would destroy.
 */
export type MetricReading =
  /** A real measurement. 0 here means the provider measured zero. */
  | { readonly state: "measured"; readonly value: number }
  /** The provider does not expose this metric on this platform. */
  | { readonly state: "unavailable"; readonly reason: string }
  /** The provider exposes it; nobody collected it for this creative. */
  | { readonly state: "not-collected"; readonly reason: string }
  /** The window has not elapsed yet. Asking again later is the fix. */
  | { readonly state: "not-yet-due"; readonly dueAt: string }
  /** Collection was attempted and failed. NOT a performance result. */
  | { readonly state: "collection-failed"; readonly reason: string }
  /** A value arrived but could not be a measurement (NaN, negative views). */
  | { readonly state: "invalid"; readonly reason: string; readonly raw: string }
  /** No statement either way. */
  | { readonly state: "unknown"; readonly reason: string };

export const METRIC_STATES = [
  "measured", "unavailable", "not-collected", "not-yet-due", "collection-failed", "invalid", "unknown",
] as const;

export type MetricState = (typeof METRIC_STATES)[number];

export function isMeasured(reading: MetricReading): reading is { state: "measured"; value: number } {
  return reading.state === "measured";
}

/**
 * The number, or null. Never a fallback.
 *
 * This is the ONLY way to get a number out of a reading, and it returns null
 * rather than 0 for every non-measured state. Callers must handle the null;
 * that is the point.
 */
export function measuredValue(reading: MetricReading): number | null {
  return reading.state === "measured" ? reading.value : null;
}

/**
 * Build a reading from a raw provider value.
 *
 * Rejects the values that look numeric but cannot be measurements. NaN and
 * Infinity are the dangerous ones: both are `typeof "number"`, both survive a
 * naive check, and both poison every comparison they touch.
 */
export function readingFromRaw(raw: unknown, context: string): MetricReading {
  if (raw === "unavailable") {
    return { state: "unavailable", reason: `The provider reported this metric as unavailable for ${context}.` };
  }
  if (raw === null || raw === undefined) {
    return { state: "unknown", reason: `No value was reported for ${context}. Unknown is not zero.` };
  }
  if (typeof raw !== "number") {
    return { state: "invalid", reason: `Expected a number for ${context}.`, raw: JSON.stringify(raw) };
  }
  if (Number.isNaN(raw)) {
    return { state: "invalid", reason: `NaN is not a measurement (${context}).`, raw: "NaN" };
  }
  if (!Number.isFinite(raw)) {
    return { state: "invalid", reason: `A non-finite value is not a measurement (${context}).`, raw: String(raw) };
  }
  return { state: "measured", value: raw };
}

export function formatReading(reading: MetricReading): string {
  switch (reading.state) {
    case "measured":
      return String(reading.value);
    case "not-yet-due":
      return `not-yet-due (due ${reading.dueAt})`;
    default:
      return reading.state;
  }
}

// ---------------------------------------------------------------------------
// Metric definitions (section 9)
// ---------------------------------------------------------------------------

export type MetricDirection = "higher-is-better" | "lower-is-better" | "neutral";

export type MetricRole = "primary-eligible" | "secondary-only" | "guardrail-only";

export type MetricUnit = "count" | "seconds" | "ratio" | "percentage-points";

export interface MetricDefinition {
  readonly metricId: string;
  readonly platform: VideoPlatform;
  /** The field on the existing ANALYTICS_RESULT contract, when there is one. */
  readonly providerField: string | null;
  readonly meaning: string;
  readonly unit: MetricUnit;
  readonly aggregation: "per-creative-snapshot";
  readonly direction: MetricDirection;
  readonly roles: readonly MetricRole[];
  /** Windows at which this metric is meaningful at all. */
  readonly validWindows: readonly import("../../types.ts").SnapshotWindow[];
  readonly caveats: readonly string[];
  /** False when no connected provider supplies it today. */
  readonly availableToday: boolean;
  readonly availabilityNote: string;
}

const ALL_WINDOWS: readonly import("../../types.ts").SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];
const SETTLED_WINDOWS: readonly import("../../types.ts").SnapshotWindow[] = ["24h", "72h", "7d"];

/**
 * Metrics the existing ANALYTICS_RESULT contract can actually carry.
 *
 * `availableToday` is false for every one of them, and that is not pessimism:
 * no analytics transport is connected in this repository. The definitions exist
 * so that when a connector does supply them, the semantics are already pinned
 * down rather than invented in the moment.
 */
function definitionsFor(platform: VideoPlatform): readonly MetricDefinition[] {
  const unavailableNote =
    "No analytics transport is connected in this repository. The metric is defined so its semantics are fixed in " +
    "advance; it carries no value until a real ANALYTICS_RESULT supplies one.";

  const base: readonly Omit<MetricDefinition, "platform" | "availableToday" | "availabilityNote">[] = [
    {
      metricId: "views",
      providerField: "views",
      meaning: "Times the video was played, as the provider counts a play.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      // Views is distribution as much as quality: a good video nobody was shown
      // has low views. It explains, it does not decide.
      roles: ["secondary-only"],
      validWindows: ALL_WINDOWS,
      caveats: [
        "Views conflate creative quality with distribution. A low count may mean the platform showed it to few people.",
        "What counts as a 'view' differs by platform and is not comparable across them.",
      ],
    },
    {
      metricId: "stayed-to-watch-rate",
      providerField: "stayedToWatchRate",
      meaning: "Share of viewers still watching after the opening seconds.",
      unit: "ratio",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      // The closest thing to a clean hook signal: it is measured early, so it
      // is less contaminated by distribution than views.
      roles: ["primary-eligible", "secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: [
        "Sensitive to topic demand as well as to hook form; a compelling subject lifts it regardless of execution.",
        "Not comparable across platforms — each defines its early-retention threshold differently.",
      ],
    },
    {
      metricId: "average-percentage-viewed",
      providerField: "averagePercentageViewed",
      meaning: "Mean share of the video watched.",
      unit: "ratio",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["primary-eligible", "secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: [
        "Mechanically favours shorter videos: the same attention over less material is a higher percentage.",
        "Must not be compared between variants of materially different duration.",
      ],
    },
    {
      metricId: "average-view-duration-seconds",
      providerField: "averageViewDurationSeconds",
      meaning: "Mean seconds watched per view.",
      unit: "seconds",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: [
        "Can be raised by padding a video rather than by improving it — see the guardrail on artificial stretching.",
      ],
    },
    {
      metricId: "shares",
      providerField: "shares",
      meaning: "Times a viewer sent the video to someone else.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: ["Strongly topic-driven. A share is often about the subject, not the execution."],
    },
    {
      metricId: "saves",
      providerField: "saves",
      meaning: "Times a viewer saved the video for later.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      // For an educational objective this is among the better signals: saving
      // implies the viewer expects the content to be useful again.
      roles: ["primary-eligible", "secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: ["Rare enough on small accounts that counts are noisy."],
    },
    {
      metricId: "comments",
      providerField: "comments",
      meaning: "Comment count. Quantity only — sentiment is NOT available.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "neutral",
      // Deliberately neutral: comments rise both when people understand and
      // when they are confused or annoyed, and nothing here can tell which.
      roles: ["secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: [
        "Direction is genuinely ambiguous: confusion and disagreement generate comments as readily as appreciation.",
        "No comment ingestion or sentiment analysis exists, so comment QUALITY is unknown.",
      ],
    },
    {
      metricId: "site-clicks",
      providerField: "siteClicks",
      meaning: "Clicks through to a SpecSmith route.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["primary-eligible", "secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: [
        "Only meaningful when the mission carried a shipped product route.",
        "Clicks can be raised by a misleading CTA, which is why a CTA-integrity guardrail applies whenever this is primary.",
      ],
    },
    {
      metricId: "profile-visits",
      providerField: "profileVisits",
      meaning: "Visits to the account profile from this video.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: ["On platforms without clickable captions this is the only route surface, which changes its meaning."],
    },
    {
      metricId: "follows-gained",
      providerField: "followsGained",
      meaning: "Follows attributed to this video.",
      unit: "count",
      aggregation: "per-creative-snapshot",
      direction: "higher-is-better",
      roles: ["secondary-only"],
      validWindows: SETTLED_WINDOWS,
      caveats: ["Very low counts on a small account make this uninformative per-creative."],
    },
  ];

  return base.map((definition) => ({
    ...definition,
    platform,
    availableToday: false,
    availabilityNote: unavailableNote,
  }));
}

const REGISTRY: ReadonlyMap<string, MetricDefinition> = (() => {
  const map = new Map<string, MetricDefinition>();
  for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as const) {
    for (const definition of definitionsFor(platform)) {
      map.set(`${platform}:${definition.metricId}`, definition);
    }
  }
  return map;
})();

export function metricKey(platform: VideoPlatform, metricId: string): string {
  return `${platform}:${metricId}`;
}

export function lookupMetric(platform: VideoPlatform, metricId: string): MetricDefinition | null {
  return REGISTRY.get(metricKey(platform, metricId)) ?? null;
}

export function metricsForPlatform(platform: VideoPlatform): readonly MetricDefinition[] {
  return [...REGISTRY.values()].filter((definition) => definition.platform === platform);
}

export function allMetrics(): readonly MetricDefinition[] {
  return [...REGISTRY.values()];
}

// ---------------------------------------------------------------------------
// Cross-platform refusal (section 57)
// ---------------------------------------------------------------------------

export interface MetricComparability {
  readonly comparable: boolean;
  readonly reason: string;
}

/**
 * May two readings of this metric be compared?
 *
 * Same platform only. There is no normalization function here on purpose: a
 * conversion factor between YouTube retention and TikTok watch time would be
 * invented, and section 58 requires that any normalization be documented and
 * justified. None is, so none exists.
 */
export function metricsAreComparable(
  a: { readonly platform: VideoPlatform; readonly metricId: string },
  b: { readonly platform: VideoPlatform; readonly metricId: string },
): MetricComparability {
  if (a.metricId !== b.metricId) {
    return { comparable: false, reason: `Different metrics (${a.metricId} vs ${b.metricId}) measure different things.` };
  }
  if (a.platform !== b.platform) {
    return {
      comparable: false,
      reason:
        `"${a.metricId}" is not the same measurement on ${a.platform} as on ${b.platform}. Each platform defines it ` +
        "differently, and no justified normalization exists, so the comparison is refused rather than normalized.",
    };
  }
  return { comparable: true, reason: `Same metric on the same platform (${a.platform}:${a.metricId}).` };
}

// ---------------------------------------------------------------------------
// Objective-driven metric choice (section 10)
// ---------------------------------------------------------------------------

/**
 * Which metrics a mission objective makes sense to optimize.
 *
 * The mapping exists so that metric choice traces to MASTER #3's objective
 * rather than to whatever number moved. An education mission is not allowed to
 * declare victory on click-through just because clicks went up.
 *
 * Objectives not listed have no default: the experiment must name a metric and
 * justify it, rather than inheriting a plausible-looking one.
 */
export const OBJECTIVE_PRIMARY_METRICS: Partial<Record<StrategicObjective, readonly string[]>> = {
  // Teaching succeeds when people keep watching and keep the thing. Clicks
  // measure a different objective entirely.
  "educate-new-builders": ["stayed-to-watch-rate", "average-percentage-viewed", "saves"],
  "answer-active-confusion": ["stayed-to-watch-rate", "average-percentage-viewed", "saves"],
  "answer-emerging-question": ["stayed-to-watch-rate", "average-percentage-viewed"],
  "explain-product-capability": ["average-percentage-viewed", "saves"],
  "build-trust-authority": ["average-percentage-viewed", "saves"],
  "defend-against-misinformation": ["average-percentage-viewed", "saves"],
  // Audience objectives are about whether the opening earns attention at all.
  "build-owned-audience": ["stayed-to-watch-rate"],
  "community-participation": ["stayed-to-watch-rate"],
  "shareable-comparison": ["stayed-to-watch-rate"],
  // Only these may legitimately be decided on click-through.
  "drive-builder-usage": ["site-clicks"],
  "drive-fps-estimator-usage": ["site-clicks"],
  "drive-upgrade-tool-usage": ["site-clicks"],
  "qualified-site-visits": ["site-clicks"],
  "improve-social-to-site": ["site-clicks"],
  "acquire-new-users": ["site-clicks"],
};

export interface MetricChoiceCheck {
  readonly permitted: boolean;
  readonly reason: string;
}

/**
 * Is this primary metric defensible for this objective?
 *
 * Refuses the mismatch that matters most: an educational mission measuring
 * itself on clicks. That is not a metric choice, it is a change of objective,
 * and changing the objective belongs to MASTER #3.
 */
export function primaryMetricSuitsObjective(
  objective: StrategicObjective,
  metricId: string,
  platform: VideoPlatform,
): MetricChoiceCheck {
  const definition = lookupMetric(platform, metricId);
  if (definition === null) {
    return { permitted: false, reason: `"${metricId}" is not a defined metric on ${platform}.` };
  }
  if (!definition.roles.includes("primary-eligible")) {
    return {
      permitted: false,
      reason:
        `"${metricId}" is not eligible as a primary decision metric: ${definition.caveats[0] ?? "it explains rather than decides."} ` +
        "It may still be recorded as a secondary metric.",
    };
  }

  const preferred = OBJECTIVE_PRIMARY_METRICS[objective];
  if (preferred === undefined) {
    return {
      permitted: true,
      reason:
        `No default metric is defined for the objective "${objective}", so the experiment's own justification stands. ` +
        "Nothing was inherited automatically.",
    };
  }
  if (!preferred.includes(metricId)) {
    return {
      permitted: false,
      reason:
        `The mission objective is "${objective}", which is served by ${preferred.join(", ")}. Deciding it on "${metricId}" ` +
        "would measure a different goal than the one MASTER #3 authorised — that is a strategy change, not a metric choice.",
    };
  }
  return { permitted: true, reason: `"${metricId}" is a defensible decision metric for the objective "${objective}".` };
}

// ---------------------------------------------------------------------------
// Guardrails (section 12)
// ---------------------------------------------------------------------------

/**
 * A guardrail that can veto a win, expressed as an integrity condition rather
 * than a metric threshold.
 *
 * These are NOT numbers to optimize against. They are the conditions under
 * which a performance result must be discarded no matter how good it looks,
 * and every one of them corresponds to a gate MASTER #1-#4 already owns.
 */
export interface IntegrityGuardrail {
  readonly guardrailId: string;
  readonly description: string;
  readonly owningMaster: "MASTER #1" | "MASTER #2" | "MASTER #3" | "MASTER #4";
  /** Why a performance gain can never buy this. */
  readonly whyNotNegotiable: string;
}

export const INTEGRITY_GUARDRAILS: readonly IntegrityGuardrail[] = [
  {
    guardrailId: "factual-claim-integrity",
    description: "The variant states no claim beyond what MASTER #2 approved, at no greater strength.",
    owningMaster: "MASTER #2",
    whyNotNegotiable:
      "A misleading video that retains better is a more efficient way of misleading people. Retention is not evidence.",
  },
  {
    guardrailId: "required-wording-present",
    description: "Every required caveat, estimate label and configuration qualifier survives in the shipped cut.",
    owningMaster: "MASTER #2",
    whyNotNegotiable:
      "If removing 'estimated' raises views, the lesson is that the label costs attention — not that the label should go.",
  },
  {
    guardrailId: "mission-integrity",
    description: "The variant serves the objective, angle and thesis MASTER #3 authorised.",
    owningMaster: "MASTER #3",
    whyNotNegotiable: "A variant that wins by answering a different question has not won this experiment.",
  },
  {
    guardrailId: "cta-integrity",
    description: "The CTA points only at a shipped route and uses no urgency, bait or deception.",
    owningMaster: "MASTER #3",
    whyNotNegotiable: "Clicks earned by a deceptive CTA are a cost, not a result.",
  },
  {
    guardrailId: "accessibility-integrity",
    description: "Captions, contrast and audio-independent comprehension are intact.",
    owningMaster: "MASTER #4",
    whyNotNegotiable:
      "Accessibility is not a variable to trade against engagement. A cut that excludes viewers has not performed better for them.",
  },
  {
    guardrailId: "rights-and-qc",
    description: "Rights clearance and the human quality/audio review passed for the exact shipped bytes.",
    owningMaster: "MASTER #1",
    whyNotNegotiable: "An unreviewed asset has no performance result worth having.",
  },
  {
    guardrailId: "no-artificial-duration-inflation",
    description: "Watch time was not raised by padding the video with filler.",
    owningMaster: "MASTER #1",
    whyNotNegotiable:
      "Average view duration can be lifted by making a video longer and emptier, which is a worse video with a better number.",
  },
];

export function lookupGuardrail(guardrailId: string): IntegrityGuardrail | null {
  return INTEGRITY_GUARDRAILS.find((guardrail) => guardrail.guardrailId === guardrailId) ?? null;
}

/** Guardrails that always apply, whatever the experiment declares. */
export const MANDATORY_GUARDRAIL_IDS: readonly string[] = [
  "factual-claim-integrity",
  "required-wording-present",
  "mission-integrity",
  "accessibility-integrity",
  "rights-and-qc",
];
