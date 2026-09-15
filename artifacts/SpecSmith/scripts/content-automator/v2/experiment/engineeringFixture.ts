// MASTER #5 — Engineering fixtures (sections 88, 89, 93).
//
// Every fixture is marked SYNTHETIC_ENGINEERING_FIXTURE and every production
// ingestion path refuses it by name. The names are deliberately absurd —
// "Synthetic GPU-A", "fixture.invalid" — so a fixture leaking into a report is
// obvious to a human at a glance rather than only to a type check.
//
// The numbers below are invented and must never be read as SpecSmith's actual
// performance. That is the point of section 93: no real-looking fake analytics.
// A reader who sees "0.68 retention" here should immediately notice that it
// belongs to a video about a graphics card that does not exist.

import type { SnapshotWindow } from "../../types.ts";
import type { AnalyticsResultDocument } from "../../connectorAnalyticsIngestion.ts";
import {
  type ControlledDifference,
  type Experiment,
  type ExperimentHypothesis,
  type ExperimentScope,
  type InvariantSet,
} from "./model.ts";
import type { ShippedVariantFacts } from "./validity.ts";
import type { CreativeLineageNode } from "./assignment.ts";
import type { GuardrailResult } from "./comparison.ts";
import { MANDATORY_GUARDRAIL_IDS } from "./metrics.ts";

export const SYNTHETIC_MARKER = "SYNTHETIC_ENGINEERING_FIXTURE";

const FIXTURE_PLATFORM = "youtube-shorts" as const;
const FIXTURE_WINDOW: SnapshotWindow = "24h";
const FIXTURE_SHA_CONTROL = "a".repeat(64);
const FIXTURE_SHA_VARIANT = "b".repeat(64);

export const FIXTURE_IDS = {
  experimentId: `${SYNTHETIC_MARKER}-exp-hook-form-1`,
  familyId: `${SYNTHETIC_MARKER}-family-gpu-comparison-hook-form`,
  controlVariantId: "control-question-first",
  variantId: "variant-result-first",
  controlCreativeId: `${SYNTHETIC_MARKER}-creative-control`,
  variantCreativeId: `${SYNTHETIC_MARKER}-creative-variant`,
  controlLineageId: `${SYNTHETIC_MARKER}-lineage-control`,
  variantLineageId: `${SYNTHETIC_MARKER}-lineage-variant`,
  packageId: `${SYNTHETIC_MARKER}-package`,
  controlPostId: `${SYNTHETIC_MARKER}-post-control`,
  variantPostId: `${SYNTHETIC_MARKER}-post-variant`,
  topicId: `${SYNTHETIC_MARKER}-topic-synthetic-gpu-a-vs-b`,
  missionId: `${SYNTHETIC_MARKER}-mission`,
  audienceProfileId: `${SYNTHETIC_MARKER}-audience`,
} as const;

export function fixtureScope(): ExperimentScope {
  return {
    platform: FIXTURE_PLATFORM,
    audienceProfileId: FIXTURE_IDS.audienceProfileId,
    audienceDescription: "Synthetic fixture audience. Not a real population.",
    audienceWasUnknown: false,
    missionFamily: `${SYNTHETIC_MARKER}-gpu-comparison-education`,
    objective: "educate-new-builders",
    topicFamily: `${SYNTHETIC_MARKER}-gpu-comparison`,
  };
}

export function fixtureHypothesis(): ExperimentHypothesis {
  return {
    hypothesisId: `${SYNTHETIC_MARKER}-hyp-result-first`,
    // Scoped, falsifiable, metric-bound, window-bound — deliberately NOT
    // "result-first hooks are better", which is the sentence this whole layer
    // exists to prevent.
    proposition:
      "For synthetic GPU-comparison Shorts on YouTube serving an education objective, a result-first opening may produce a " +
      "higher stayed-to-watch rate at 24h than a question-first opening.",
    expectedDirection: "variant-higher",
    whyThisMightBeTrue:
      "A viewer deciding between two parts needs the outcome before the mechanism to know whether the mechanism matters to them.",
    supportingEvidence: [`${SYNTHETIC_MARKER}: none. This is a fixture and no real prior evidence exists.`],
    conflictingEvidence: [`${SYNTHETIC_MARKER}: none recorded.`],
    uncertainty:
      "Entirely untested. The opposite is equally arguable: an unexplained figure in the opening may be a number the viewer " +
      "cannot interpret and therefore does not trust.",
    scope: fixtureScope(),
    primaryMetricId: "stayed-to-watch-rate",
    measurementWindow: FIXTURE_WINDOW,
    falsificationCondition:
      "Result-first openings show no higher stayed-to-watch rate than question-first openings across matched pairs at 24h.",
    whatWouldNotCountAsConfirmation: [
      "A higher view count — views measure distribution as much as the opening.",
      "A higher figure on any secondary metric while the primary metric is flat or negative.",
      "A better result on a different topic, which would confound topic demand with hook form.",
    ],
    triggersReplicationWhen: "The primary metric favours the variant with every guardrail passed and the minimum units met.",
    triggersAbandonmentWhen: "Two independent replications point the other way, or any guardrail fails.",
  };
}

function fixtureInvariants(): InvariantSet {
  return {
    missionId: FIXTURE_IDS.missionId,
    claimIds: [`${SYNTHETIC_MARKER}-claim-1`],
    requiredWording: ["estimated", "at 1440p high"],
    audienceProfileId: FIXTURE_IDS.audienceProfileId,
    platform: FIXTURE_PLATFORM,
    topicId: FIXTURE_IDS.topicId,
    productRoute: "/compare",
    objective: "educate-new-builders",
    targetDurationSecondsRange: [20, 35],
    ctaFamily: "compare-tool",
    voiceId: `${SYNTHETIC_MARKER}-voice`,
    postingAccount: `${SYNTHETIC_MARKER}-account`,
    estimateStatusDisclosed: true,
  };
}

const HOOK_DIFFERENCE: ControlledDifference = {
  dimension: "hook-form",
  control: "question-first",
  variant: "result-first",
  rationale: "The opening is the only thing every viewer sees, so it is where a change has the clearest chance of mattering.",
};

/**
 * A clean, single-variable experiment.
 *
 * The one case where a causal reading is even possible — everything except the
 * hook form is held constant, including the topic.
 */
export function fixtureCleanExperiment(now: Date): Experiment {
  return {
    version: "experiment-definition-v1",
    experimentId: FIXTURE_IDS.experimentId,
    revision: 1,
    title: "Synthetic: result-first vs question-first opening",
    familyId: FIXTURE_IDS.familyId,
    hypothesis: fixtureHypothesis(),
    rationale: "Engineering fixture exercising the full experiment chain deterministically.",
    scope: fixtureScope(),
    primaryMetricId: "stayed-to-watch-rate",
    secondaryMetricIds: ["average-percentage-viewed", "saves"],
    guardrailMetricIds: [...MANDATORY_GUARDRAIL_IDS],
    missionId: FIXTURE_IDS.missionId,
    creativeLineageId: FIXTURE_IDS.controlLineageId,
    variants: [
      {
        variantId: FIXTURE_IDS.controlVariantId,
        label: "Question-first opening",
        isControl: true,
        differences: [],
        description: "Opens by asking the question the video answers.",
      },
      {
        variantId: FIXTURE_IDS.variantId,
        label: "Result-first opening",
        isControl: false,
        differences: [HOOK_DIFFERENCE],
        description: "Opens with the estimated figure, then explains it.",
      },
    ],
    invariants: fixtureInvariants(),
    assignmentMethod: "explicit-declaration",
    observationWindow: FIXTURE_WINDOW,
    minimumEvidence: {
      minimumIndependentUnitsPerVariant: 1,
      minimumReplications: 1,
      explanation:
        "One unit per variant is enough to produce an interpretable single comparison; replication is required before the " +
        "result may be reused, which is what the evidence model enforces.",
    },
    stopConditions: [
      { code: "planned-units-reached", description: "Each variant has reached the planned independent-unit count." },
      { code: "guardrail-failure", description: "Any integrity guardrail fails." },
      { code: "replication-achieved", description: "A topic replication agrees with the original direction." },
    ],
    invalidationConditions: [
      { code: "topic-drift", description: "The variants end up covering different topics." },
      { code: "window-mismatch", description: "Observations are not available at the registered window." },
    ],
    status: "draft",
    createdAt: now.toISOString(),
    startedAt: null,
    closedAt: null,
    designHash: "",
    registeredAt: null,
    provenance: { synthetic: true, producedBy: SYNTHETIC_MARKER, producedAt: now.toISOString() },
  };
}

/**
 * The confounded variant of the same experiment.
 *
 * Reproduces section 22's canonical example: the topic changes as well as the
 * hook, so the result is real and explains nothing. Used to prove the
 * confounding detector actually fires.
 */
export function fixtureConfoundedExperiment(now: Date): Experiment {
  const clean = fixtureCleanExperiment(now);
  return {
    ...clean,
    experimentId: `${SYNTHETIC_MARKER}-exp-confounded-1`,
    title: "Synthetic: confounded comparison (topic and duration also changed)",
  };
}

// ---------------------------------------------------------------------------
// Shipped facts
// ---------------------------------------------------------------------------

function baseFacts(variantId: string, creativeId: string, publishedAt: string): ShippedVariantFacts {
  return {
    variantId,
    creativeId,
    topicId: FIXTURE_IDS.topicId,
    missionId: FIXTURE_IDS.missionId,
    audienceProfileId: FIXTURE_IDS.audienceProfileId,
    platform: FIXTURE_PLATFORM,
    objective: "educate-new-builders",
    productRoute: "/compare",
    durationSeconds: 28,
    claimIds: [`${SYNTHETIC_MARKER}-claim-1`],
    requiredWording: ["estimated", "at 1440p high"],
    ctaFamily: "compare-tool",
    voiceId: `${SYNTHETIC_MARKER}-voice`,
    postingAccount: `${SYNTHETIC_MARKER}-account`,
    publishedAt,
    dimensionValues: { "hook-form": "question-first" },
  };
}

export const FIXTURE_PUBLISHED_AT = "2026-09-01T12:00:00.000Z";

export function fixtureCleanShippedFacts(): ReadonlyMap<string, ShippedVariantFacts> {
  const control = baseFacts(FIXTURE_IDS.controlVariantId, FIXTURE_IDS.controlCreativeId, FIXTURE_PUBLISHED_AT);
  const variant: ShippedVariantFacts = {
    ...baseFacts(FIXTURE_IDS.variantId, FIXTURE_IDS.variantCreativeId, FIXTURE_PUBLISHED_AT),
    variantId: FIXTURE_IDS.variantId,
    // Exactly one dimension differs. That is what makes this comparison clean.
    dimensionValues: { "hook-form": "result-first" },
  };
  return new Map([
    [control.variantId, control],
    [variant.variantId, variant],
  ]);
}

/**
 * Shipped facts where five things changed at once.
 *
 * Topic, duration, publication day, caption density and the hook. Exactly the
 * situation section 22 describes, and the detector must classify it as
 * confounded rather than reporting a hook-form result.
 */
export function fixtureConfoundedShippedFacts(): ReadonlyMap<string, ShippedVariantFacts> {
  const control = baseFacts(FIXTURE_IDS.controlVariantId, FIXTURE_IDS.controlCreativeId, "2026-09-01T12:00:00.000Z");
  const variant: ShippedVariantFacts = {
    ...baseFacts(FIXTURE_IDS.variantId, FIXTURE_IDS.variantCreativeId, "2026-09-05T12:00:00.000Z"),
    variantId: FIXTURE_IDS.variantId,
    topicId: `${SYNTHETIC_MARKER}-topic-synthetic-gpu-c-vs-d`,
    durationSeconds: 45,
    dimensionValues: { "hook-form": "result-first", "caption-density": "high", pacing: "fast" },
  };
  return new Map([
    [control.variantId, control],
    [variant.variantId, variant],
  ]);
}

export function fixtureLineage(): readonly CreativeLineageNode[] {
  return [
    {
      creativeId: FIXTURE_IDS.controlCreativeId,
      lineageId: FIXTURE_IDS.controlLineageId,
      parentCreativeId: null,
      relation: "original",
      platform: FIXTURE_PLATFORM,
      topicId: FIXTURE_IDS.topicId,
    },
    {
      creativeId: FIXTURE_IDS.variantCreativeId,
      lineageId: FIXTURE_IDS.variantLineageId,
      parentCreativeId: FIXTURE_IDS.controlCreativeId,
      relation: "experiment-sibling",
      platform: FIXTURE_PLATFORM,
      topicId: FIXTURE_IDS.topicId,
    },
  ];
}

/**
 * Lineage including two platform adaptations.
 *
 * Four placements that reduce to two independent units. Proves the sample is
 * not inflated by re-posting one idea to three surfaces.
 */
export function fixtureCorrelatedLineage(): readonly CreativeLineageNode[] {
  return [
    ...fixtureLineage(),
    {
      creativeId: `${FIXTURE_IDS.variantCreativeId}-tiktok`,
      lineageId: FIXTURE_IDS.variantLineageId,
      parentCreativeId: FIXTURE_IDS.variantCreativeId,
      relation: "platform-adaptation",
      platform: "tiktok",
      topicId: FIXTURE_IDS.topicId,
    },
    {
      creativeId: `${FIXTURE_IDS.variantCreativeId}-reels`,
      lineageId: FIXTURE_IDS.variantLineageId,
      parentCreativeId: FIXTURE_IDS.variantCreativeId,
      relation: "platform-adaptation",
      platform: "instagram-reels",
      topicId: FIXTURE_IDS.topicId,
    },
  ];
}

// ---------------------------------------------------------------------------
// Synthetic analytics
// ---------------------------------------------------------------------------

/**
 * A synthetic ANALYTICS_RESULT.
 *
 * Shaped exactly like the real contract so the real ingestion boundary refuses
 * it for the right reason — being synthetic — rather than for being malformed.
 */
export function fixtureAnalytics(input: {
  readonly creativeId: string;
  readonly providerPostId: string;
  readonly stayedToWatchRate: number | "unavailable";
  readonly averagePercentageViewed?: number | "unavailable";
  readonly views?: number;
  readonly saves?: number | "unavailable";
  readonly window?: SnapshotWindow;
  readonly capturedAt?: string;
}): AnalyticsResultDocument {
  const window = input.window ?? FIXTURE_WINDOW;
  return {
    kind: "ANALYTICS_RESULT",
    version: "analytics-result-v1",
    creativeId: input.creativeId,
    platform: FIXTURE_PLATFORM,
    packageId: FIXTURE_IDS.packageId,
    providerPostId: input.providerPostId,
    window,
    capturedAt: input.capturedAt ?? "2026-09-02T12:00:00.000Z",
    metrics: {
      views: input.views ?? 2400,
      stayedToWatchRate: input.stayedToWatchRate,
      averagePercentageViewed: input.averagePercentageViewed ?? 0.41,
      saves: input.saves ?? 12,
    },
    note: `${SYNTHETIC_MARKER}: invented figures about a graphics card that does not exist.`,
  };
}

/** The control's synthetic analytics: the weaker opening. */
export function fixtureControlAnalytics(overrides: Partial<Parameters<typeof fixtureAnalytics>[0]> = {}): AnalyticsResultDocument {
  return fixtureAnalytics({
    creativeId: FIXTURE_IDS.controlCreativeId,
    providerPostId: FIXTURE_IDS.controlPostId,
    stayedToWatchRate: 0.54,
    averagePercentageViewed: 0.38,
    saves: 9,
    ...overrides,
  });
}

/** The variant's synthetic analytics: the stronger opening. */
export function fixtureVariantAnalytics(overrides: Partial<Parameters<typeof fixtureAnalytics>[0]> = {}): AnalyticsResultDocument {
  return fixtureAnalytics({
    creativeId: FIXTURE_IDS.variantCreativeId,
    providerPostId: FIXTURE_IDS.variantPostId,
    stayedToWatchRate: 0.68,
    averagePercentageViewed: 0.44,
    saves: 14,
    ...overrides,
  });
}

/** Analytics with the primary metric unavailable, to prove it is not read as 0. */
export function fixtureUnavailablePrimaryAnalytics(): AnalyticsResultDocument {
  return fixtureAnalytics({
    creativeId: FIXTURE_IDS.variantCreativeId,
    providerPostId: FIXTURE_IDS.variantPostId,
    stayedToWatchRate: "unavailable",
  });
}

export function fixtureGuardrailsPassing(): readonly GuardrailResult[] {
  return MANDATORY_GUARDRAIL_IDS.map((guardrailId) => ({
    guardrailId,
    passed: true,
    detail: `${SYNTHETIC_MARKER}: guardrail asserted as passing for fixture purposes.`,
  }));
}

/**
 * Guardrails where the factual-integrity one fails.
 *
 * Used to prove the system refuses to recommend a variant that wins on
 * retention by removing a required caveat — section 47's central requirement.
 */
export function fixtureGuardrailsFailing(): readonly GuardrailResult[] {
  return MANDATORY_GUARDRAIL_IDS.map((guardrailId) => ({
    guardrailId,
    passed: guardrailId !== "required-wording-present",
    detail:
      guardrailId === "required-wording-present"
        ? `${SYNTHETIC_MARKER}: the variant dropped the required "estimated" label, which is why its opening is shorter.`
        : `${SYNTHETIC_MARKER}: passing.`,
  }));
}

export const FIXTURE_SHAS = {
  control: FIXTURE_SHA_CONTROL,
  variant: FIXTURE_SHA_VARIANT,
} as const;

/** Assert a fixture is unmistakably synthetic before a pipeline prints it. */
export function assertUnmistakablySynthetic(value: { readonly synthetic?: boolean; readonly provenance?: { readonly synthetic?: boolean; readonly producedBy?: string } }): void {
  const synthetic = value.synthetic ?? value.provenance?.synthetic;
  if (synthetic !== true) {
    throw new Error("A value from the MASTER #5 fixture module is not marked synthetic.");
  }
  const producedBy = value.provenance?.producedBy;
  if (producedBy !== undefined && !producedBy.includes(SYNTHETIC_MARKER)) {
    throw new Error(`Fixture provenance "${producedBy}" does not carry ${SYNTHETIC_MARKER}, so a reader could not tell it was fixture data.`);
  }
}
