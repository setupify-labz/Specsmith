// MASTER #5 — Validity and confounding (sections 5, 22, 29, 30, 31, 32, 83).
//
// Section 22 calls confounding detection one of the most important
// responsibilities of this layer, and it is right. The canonical failure looks
// like this:
//
//   Variant A: RTX 5070 topic, Tuesday, 18s, result-first, high-motion
//   Variant B: RTX 4060 topic, Saturday, 29s, question-first, low-motion
//
// A performed better. It is enormously tempting to conclude "result-first hooks
// win" — and completely unjustified, because five things changed and one of
// them is that people care more about a 5070 than a 4060. The honest output is
// not "inconclusive"; it is "multiple dimensions changed; the difference is not
// attributable to hook form", plus the list of what else could explain it.
//
// A strong topic swamps creative differences. That single fact invalidates more
// content experiments than every other cause combined, which is why topic
// identity is checked before anything else.

import type { SnapshotWindow } from "../../types.ts";
import {
  validityPermitsCausalReading,
  type ControlledDifference,
  type CreativeDimension,
  type Experiment,
  type ExperimentAssignment,
  type InvariantSet,
  type ValidityState,
} from "./model.ts";
import type { PerformanceObservation } from "./observation.ts";
import { countIndependentUnits, type CreativeLineageNode } from "./assignment.ts";

// ---------------------------------------------------------------------------
// What actually shipped
// ---------------------------------------------------------------------------

/**
 * The observed properties of one shipped variant.
 *
 * This is what the creative ACTUALLY was, not what the design said it would be.
 * Comparing the two is the whole job: an experiment is only controlled if the
 * things declared invariant really stayed the same.
 */
export interface ShippedVariantFacts {
  readonly variantId: string;
  readonly creativeId: string;
  readonly topicId: string;
  readonly missionId: string;
  readonly audienceProfileId: string | null;
  readonly platform: import("../../types.ts").VideoPlatform;
  readonly objective: string;
  readonly productRoute: string | null;
  readonly durationSeconds: number;
  readonly claimIds: readonly string[];
  readonly requiredWording: readonly string[];
  readonly ctaFamily: string | null;
  readonly voiceId: string | null;
  readonly postingAccount: string;
  readonly publishedAt: string;
  /** Dimension values as shipped, for detecting undeclared changes. */
  readonly dimensionValues: Readonly<Record<string, string>>;
}

export interface Confounder {
  readonly code: string;
  readonly dimension: string;
  readonly controlValue: string;
  readonly variantValue: string;
  readonly severity: "fatal" | "serious" | "minor";
  readonly explanation: string;
}

export interface ValidityAssessment {
  readonly state: ValidityState;
  readonly reasons: readonly string[];
  readonly confounders: readonly Confounder[];
  /** Dimensions that changed but were never declared as the variable. */
  readonly undeclaredChanges: readonly string[];
  readonly declaredDifferences: readonly ControlledDifference[];
  readonly isMultiFactor: boolean;
  readonly causalReadingPermitted: boolean;
  readonly alternativeExplanations: readonly string[];
  readonly explanation: string;
}

/**
 * Severity of a drift on a given dimension.
 *
 * `fatal` means the comparison is between two different things and no amount of
 * caveating rescues it. Topic is fatal for exactly the reason section 29 gives:
 * audience interest in the subject dwarfs execution differences, so a topic
 * change makes every creative conclusion unsafe.
 */
const DIMENSION_SEVERITY: Readonly<Record<string, Confounder["severity"]>> = {
  topicId: "fatal",
  platform: "fatal",
  missionId: "fatal",
  objective: "fatal",
  claimIds: "fatal",
  audienceProfileId: "serious",
  productRoute: "serious",
  durationSeconds: "serious",
  postingAccount: "serious",
  requiredWording: "fatal",
  ctaFamily: "minor",
  voiceId: "minor",
};

/** Duration difference beyond which the comparison is materially unequal. */
export const MATERIAL_DURATION_RATIO = 0.25;

/**
 * Assess whether this comparison can support a causal reading.
 *
 * Works by difference: what the design declared should change, versus what
 * actually differs between the shipped creatives. Anything in the second set
 * but not the first is a confounder.
 */
export function assessValidity(input: {
  readonly experiment: Experiment;
  readonly control: ShippedVariantFacts;
  readonly variant: ShippedVariantFacts;
  readonly observations: readonly PerformanceObservation[];
  readonly lineage: readonly CreativeLineageNode[];
  readonly window: SnapshotWindow;
}): ValidityAssessment {
  const { experiment, control, variant } = input;
  const reasons: string[] = [];
  const confounders: Confounder[] = [];
  const undeclaredChanges: string[] = [];

  const declaredDifferences = experiment.variants
    .filter((v) => !v.isControl)
    .flatMap((v) => v.differences);
  const declaredDimensions = new Set<string>(declaredDifferences.map((difference) => difference.dimension));

  // --- 1. Invariants that were supposed to hold ---------------------------
  const invariantChecks: readonly { readonly field: string; readonly a: unknown; readonly b: unknown }[] = [
    { field: "topicId", a: control.topicId, b: variant.topicId },
    { field: "platform", a: control.platform, b: variant.platform },
    { field: "missionId", a: control.missionId, b: variant.missionId },
    { field: "objective", a: control.objective, b: variant.objective },
    { field: "audienceProfileId", a: control.audienceProfileId, b: variant.audienceProfileId },
    { field: "productRoute", a: control.productRoute, b: variant.productRoute },
    { field: "postingAccount", a: control.postingAccount, b: variant.postingAccount },
    { field: "claimIds", a: [...control.claimIds].sort().join(","), b: [...variant.claimIds].sort().join(",") },
    { field: "requiredWording", a: [...control.requiredWording].sort().join("|"), b: [...variant.requiredWording].sort().join("|") },
    { field: "ctaFamily", a: control.ctaFamily, b: variant.ctaFamily },
    { field: "voiceId", a: control.voiceId, b: variant.voiceId },
  ];

  for (const check of invariantChecks) {
    if (check.a === check.b) continue;
    const severity = DIMENSION_SEVERITY[check.field] ?? "minor";
    confounders.push({
      code: `invariant-drift-${check.field}`,
      dimension: check.field,
      controlValue: String(check.a),
      variantValue: String(check.b),
      severity,
      explanation: explainDrift(check.field, String(check.a), String(check.b), severity),
    });
  }

  // --- 2. Duration, which needs a ratio rather than equality --------------
  const durationRatio = control.durationSeconds > 0
    ? Math.abs(variant.durationSeconds - control.durationSeconds) / control.durationSeconds
    : 0;
  if (durationRatio > MATERIAL_DURATION_RATIO && !declaredDimensions.has("duration")) {
    confounders.push({
      code: "invariant-drift-durationSeconds",
      dimension: "durationSeconds",
      controlValue: `${control.durationSeconds}s`,
      variantValue: `${variant.durationSeconds}s`,
      severity: "serious",
      explanation:
        `Durations differ by ${Math.round(durationRatio * 100)}%, beyond the ${Math.round(MATERIAL_DURATION_RATIO * 100)}% ` +
        "materiality threshold. Percentage-viewed metrics are mechanically sensitive to length, so a shorter video can post a " +
        "better completion rate without being better.",
    });
  }

  // --- 3. Undeclared dimension changes (section 4) ------------------------
  const allDimensionKeys = new Set([
    ...Object.keys(control.dimensionValues),
    ...Object.keys(variant.dimensionValues),
  ]);
  for (const key of [...allDimensionKeys].sort()) {
    const controlValue = control.dimensionValues[key] ?? "";
    const variantValue = variant.dimensionValues[key] ?? "";
    if (controlValue === variantValue) continue;
    if (declaredDimensions.has(key)) continue;
    undeclaredChanges.push(key);
    confounders.push({
      code: "undeclared-dimension-change",
      dimension: key,
      controlValue,
      variantValue,
      severity: "serious",
      explanation:
        `"${key}" differs between the variants but was never declared as a controlled difference. An undeclared change is ` +
        "indistinguishable from the declared one in the result: whatever moved, this could be why.",
    });
  }

  let declaredChangeUnverified = false;

  // --- 4. Declared differences that did not actually ship -----------------
  for (const difference of declaredDifferences) {
    const controlValue = control.dimensionValues[difference.dimension];
    const variantValue = variant.dimensionValues[difference.dimension];
    if (controlValue === undefined || variantValue === undefined ||
        controlValue !== difference.control || variantValue !== difference.variant) {
      declaredChangeUnverified = true;
      reasons.push(`The shipped values for "${difference.dimension}" do not verify the registered controlled difference.`);
    }
    if (controlValue === undefined || variantValue === undefined) continue;
    if (controlValue === variantValue) {
      reasons.push(
        `The design declares "${difference.dimension}" as the variable, but both creatives shipped with "${controlValue}". ` +
          "The intended change never happened, so this experiment tested nothing.",
      );
    }
  }

  // --- 5. Multi-factor classification (section 4) -------------------------
  const changedDimensionCount = declaredDimensions.size + undeclaredChanges.length;
  const isMultiFactor = changedDimensionCount > 1;

  // --- 6. Observation integrity -------------------------------------------
  const windows = new Set(input.observations.map((observation) => observation.window));
  if (windows.size > 1) {
    reasons.push(`Observations mix windows (${[...windows].sort().join(", ")}), which compares age rather than creative.`);
  }
  if (input.observations.some((observation) => observation.window !== input.window)) {
    reasons.push(`Some observations are not at the experiment's registered ${input.window} window.`);
  }
  const identityProblems = input.observations.filter((observation) => observation.validity !== "valid");
  if (identityProblems.length > 0) {
    reasons.push(`${identityProblems.length} observation(s) carry an identity or timing problem.`);
  }

  // --- 7. Independence (section 19) ---------------------------------------
  const independence = countIndependentUnits(input.lineage);
  if (independence.correlatedGroups.length > 0) {
    reasons.push(independence.explanation);
  }

  // --- Verdict ------------------------------------------------------------
  const fatal = confounders.filter((confounder) => confounder.severity === "fatal");
  const serious = confounders.filter((confounder) => confounder.severity === "serious");

  let state: ValidityState;
  if (declaredChangeUnverified || reasons.some((reason) => reason.includes("identity")) || windows.size > 1 || input.observations.some((observation) => observation.window !== input.window)) {
    state = "invalid";
  } else if (fatal.length > 0) {
    state = "confounded";
  } else if (isMultiFactor || serious.length > 0) {
    state = "confounded";
  } else if (declaredDifferences.length === 0) {
    state = "observational-comparison";
  } else if (confounders.length > 0) {
    state = "partially-controlled";
  } else if (input.observations.length === 0) {
    state = "insufficient-information";
  } else {
    state = "clean-controlled";
  }

  const explanation = buildExplanation(state, confounders, isMultiFactor, declaredDifferences);

  return {
    state,
    reasons,
    confounders: confounders.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    undeclaredChanges,
    declaredDifferences,
    isMultiFactor,
    causalReadingPermitted: validityPermitsCausalReading(state),
    alternativeExplanations: buildAlternativeExplanations(confounders, control, variant, isMultiFactor),
    explanation,
  };
}

function severityRank(severity: Confounder["severity"]): number {
  return severity === "fatal" ? 2 : severity === "serious" ? 1 : 0;
}

function explainDrift(field: string, controlValue: string, variantValue: string, severity: Confounder["severity"]): string {
  switch (field) {
    case "topicId":
      return (
        `The variants cover different topics ("${controlValue}" vs "${variantValue}"). Audience interest in the SUBJECT ` +
        "routinely dwarfs any creative difference, so whatever moved may simply be that people cared more about one of them. " +
        "No creative conclusion survives a topic change."
      );
    case "platform":
      return (
        `The variants ran on different platforms (${controlValue} vs ${variantValue}). Metrics are not semantically identical ` +
        "across platforms and distribution differs entirely, so this is not one comparison."
      );
    case "missionId":
    case "objective":
      return (
        `The variants pursue different missions or objectives ("${controlValue}" vs "${variantValue}"). They were trying to ` +
        "achieve different things, so the better number does not identify the better execution."
      );
    case "claimIds":
    case "requiredWording":
      return (
        `The variants carry different factual payloads ("${controlValue}" vs "${variantValue}"). This is not a creative ` +
        "experiment: the two videos say different things, and MASTER #2 governs which of those things may be said at all."
      );
    case "audienceProfileId":
      return `The variants targeted different audiences ("${controlValue}" vs "${variantValue}"), so the result is not about the creative difference.`;
    default:
      return `"${field}" differs between the variants ("${controlValue}" vs "${variantValue}"), classified ${severity}.`;
  }
}

function buildExplanation(
  state: ValidityState,
  confounders: readonly Confounder[],
  isMultiFactor: boolean,
  declared: readonly ControlledDifference[],
): string {
  switch (state) {
    case "clean-controlled":
      return (
        `One declared variable changed (${declared.map((d) => d.dimension).join(", ")}) and every invariant held. ` +
        "A causal reading is permitted WITHIN this comparison — which is not the same as a general finding."
      );
    case "partially-controlled":
      return (
        `The intended variable changed, but ${confounders.length} minor difference(s) also drifted. A causal reading is ` +
        "possible but weakened, and the drift is named rather than ignored."
      );
    case "confounded":
      return (
        `${confounders.length} dimension(s) changed together${isMultiFactor ? " and more than one variable was in play" : ""}. ` +
        "The performance difference is NOT attributable to any single one of them. This is a real result about the pair of " +
        "creatives; it is not evidence about the intended variable."
      );
    case "observational-comparison":
      return (
        "No controlled difference was declared, so this is an observational comparison. It is useful for generating " +
        "hypotheses and must not be read as a causal test."
      );
    case "invalid":
      return "The comparison is broken on identity, window or timing grounds, so no reading of it is meaningful.";
    default:
      return "There is not enough information to judge whether this comparison is valid.";
  }
}

/**
 * Plausible alternative explanations for whatever was observed (section 83).
 *
 * Deliberately does NOT rank them or pick one. Naming a likeliest cause would
 * be inventing the answer the experiment failed to establish; the list exists
 * so a reader can see how many live explanations remain.
 */
function buildAlternativeExplanations(
  confounders: readonly Confounder[],
  control: ShippedVariantFacts,
  variant: ShippedVariantFacts,
  isMultiFactor: boolean,
): readonly string[] {
  const explanations: string[] = [];

  for (const confounder of confounders) {
    explanations.push(`${confounder.dimension} differed (${confounder.controlValue} vs ${confounder.variantValue}) and could account for the difference.`);
  }

  if (isMultiFactor) {
    explanations.push("More than one variable changed, so any of them — or their interaction — could be responsible.");
  }

  const controlDay = new Date(control.publishedAt).getUTCDay();
  const variantDay = new Date(variant.publishedAt).getUTCDay();
  if (controlDay !== variantDay) {
    explanations.push(
      `The variants were published on different days of the week (${controlDay} vs ${variantDay}). Posting conditions are ` +
        "unmeasured here, so this remains a live alternative explanation rather than a ruled-out one.",
    );
  }

  const publishGapDays = Math.abs(Date.parse(variant.publishedAt) - Date.parse(control.publishedAt)) / 86_400_000;
  if (publishGapDays > 7) {
    explanations.push(
      `The variants were published ${Math.round(publishGapDays)} days apart. Platform behaviour and audience composition ` +
        "drift over that span, so time is a candidate explanation.",
    );
  }

  // Always present, and deliberately last: with samples this small, noise is
  // never excluded by anything else on the list.
  explanations.push(
    "Random variation. At the sample sizes short-form content produces, an apparent difference of this kind is routinely " +
      "produced by chance alone, and nothing in this comparison rules that out.",
  );

  return explanations;
}

// ---------------------------------------------------------------------------
// Scope preservation (sections 30, 31, 32)
// ---------------------------------------------------------------------------

export interface ScopeViolation {
  readonly code: string;
  readonly message: string;
}

/**
 * Check that a claimed scope does not exceed what the experiment covered.
 *
 * The audience rule is the sharpest: if MASTER #4 recorded the audience as
 * unknown, a result may never later be described as being about beginners.
 * Nobody observed a beginner, so the sentence has no referent.
 */
export function checkScopeClaims(
  experiment: Experiment,
  claimedScope: {
    readonly platforms: readonly string[];
    readonly audienceDescription: string | null;
    readonly objective: string | null;
    readonly topicFamily: string | null;
  },
): readonly ScopeViolation[] {
  const violations: ScopeViolation[] = [];

  const otherPlatforms = claimedScope.platforms.filter((platform) => platform !== experiment.scope.platform);
  if (otherPlatforms.length > 0) {
    violations.push({
      code: "platform-scope-exceeded",
      message:
        `The experiment ran only on ${experiment.scope.platform}, but the claim covers ${otherPlatforms.join(", ")}. ` +
        "A result on one platform says nothing about another until it is replicated there.",
    });
  }

  if (experiment.scope.audienceWasUnknown && claimedScope.audienceDescription !== null) {
    violations.push({
      code: "audience-scope-invented",
      message:
        `The claim describes the audience as "${claimedScope.audienceDescription}", but MASTER #4 recorded the audience as ` +
        "unknown for this experiment. An audience that was never established cannot be the subject of a finding.",
    });
  }

  if (claimedScope.objective !== null && claimedScope.objective !== experiment.scope.objective) {
    violations.push({
      code: "objective-scope-exceeded",
      message:
        `The experiment served "${experiment.scope.objective}" but the claim is about "${claimedScope.objective}". ` +
        "A tactic that works for one objective is not thereby established for another.",
    });
  }

  if (claimedScope.topicFamily !== null && claimedScope.topicFamily !== experiment.scope.topicFamily) {
    violations.push({
      code: "topic-scope-exceeded",
      message:
        `The experiment covered the topic family "${experiment.scope.topicFamily}" but the claim extends to ` +
        `"${claimedScope.topicFamily}". Topic effects are large enough that this needs its own replication.`,
    });
  }

  return violations;
}

/** Does what shipped actually match the invariants the design declared? */
export function invariantsHeld(declared: InvariantSet, shipped: ShippedVariantFacts): readonly string[] {
  const breaches: string[] = [];
  if (declared.missionId !== shipped.missionId) breaches.push(`mission ${declared.missionId} -> ${shipped.missionId}`);
  if (declared.platform !== shipped.platform) breaches.push(`platform ${declared.platform} -> ${shipped.platform}`);
  if (declared.topicId !== shipped.topicId) breaches.push(`topic ${declared.topicId} -> ${shipped.topicId}`);
  if (declared.productRoute !== shipped.productRoute) breaches.push(`route ${declared.productRoute} -> ${shipped.productRoute}`);
  if (declared.postingAccount !== shipped.postingAccount) breaches.push(`account ${declared.postingAccount} -> ${shipped.postingAccount}`);
  const declaredClaims = [...declared.claimIds].sort().join(",");
  const shippedClaims = [...shipped.claimIds].sort().join(",");
  if (declaredClaims !== shippedClaims) breaches.push(`claims ${declaredClaims} -> ${shippedClaims}`);
  return breaches;
}

/** Dimensions declared across all non-control variants. */
export function declaredDimensionsOf(experiment: Experiment): readonly CreativeDimension[] {
  return [
    ...new Set(
      experiment.variants
        .filter((variant) => !variant.isControl)
        .flatMap((variant) => variant.differences.map((difference) => difference.dimension)),
    ),
  ].sort();
}

/** Assignments that never produced an observation, for the bias check. */
export function unobservedAssignments(
  assignments: readonly ExperimentAssignment[],
  observations: readonly PerformanceObservation[],
): readonly ExperimentAssignment[] {
  const observed = new Set(observations.map((observation) => observation.creativeId));
  return assignments.filter((assignment) => !observed.has(assignment.creativeId));
}
