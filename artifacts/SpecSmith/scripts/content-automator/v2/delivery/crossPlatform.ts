// MASTER #4 — Cross-platform package plan (section 15).
//
// One mission, up to three platform versions, one shared core truth.
// A material difference is legal only when PLATFORM_CREATIVE_BRIEF carries the
// exact usable platform fact that caused it. We never synthesize fact IDs from
// platform names or infer an absent capability from an unknown one.

import type { PlatformId } from "../platform/model.ts";
import type { AdaptationDimension, PlatformAdaptationEvidence, PlatformCreativeBrief } from "./brief.ts";
import type { AudiencePlatformFit, RefusalReason } from "./fit.ts";
import type { TruthInvariant } from "./invariants.ts";

export interface PlatformDifference {
  readonly platform: PlatformId;
  readonly dimension: AdaptationDimension;
  readonly difference: string;
  readonly justifiedByFactId: string;
  readonly justification: string;
}

export interface RefusedPlatform {
  readonly platform: PlatformId;
  readonly refusals: readonly RefusalReason[];
}

export interface CrossPlatformPackagePlan {
  readonly version: "cross-platform-package-plan-v1";
  readonly planId: string;
  readonly missionId: string;
  readonly createdAt: string;
  readonly coreInvariant: {
    readonly thesis: string;
    readonly objective: string;
    readonly allowedClaimIds: readonly string[];
    readonly requiredWording: readonly string[];
    readonly requiredDisclosures: readonly string[];
  };
  readonly platformsIncluded: readonly PlatformId[];
  readonly platformsRefused: readonly RefusedPlatform[];
  readonly differences: readonly PlatformDifference[];
  readonly uniformExecutionJustified: boolean;
  readonly uniformExecutionReason: string | null;
  readonly limitations: readonly string[];
}

export interface PackagePlanInput {
  readonly missionId: string;
  readonly invariant: TruthInvariant;
  readonly briefs: readonly PlatformCreativeBrief[];
  readonly fits: readonly AudiencePlatformFit[];
  readonly now: Date;
}

export class UntraceablePlatformDifferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntraceablePlatformDifferenceError";
  }
}

interface MaterialDifference {
  readonly reference: PlatformCreativeBrief;
  readonly changed: PlatformCreativeBrief;
  readonly dimension: AdaptationDimension;
  readonly description: string;
}

function materialDifferences(reference: PlatformCreativeBrief, changed: PlatformCreativeBrief): readonly MaterialDifference[] {
  const differences: MaterialDifference[] = [];
  if ((reference.metadata.title === null) !== (changed.metadata.title === null) || reference.metadata.title !== changed.metadata.title) {
    differences.push({ reference, changed, dimension: "metadata.title", description: "Title treatment differs." });
  }
  if (reference.metadata.description !== changed.metadata.description) {
    differences.push({ reference, changed, dimension: "metadata.description", description: "Description treatment differs." });
  }
  if (reference.execution.ctaTreatment.treatment !== changed.execution.ctaTreatment.treatment) {
    differences.push({ reference, changed, dimension: "execution.cta", description: "CTA placement/treatment differs." });
  }
  if (JSON.stringify(reference.execution.targetDurationSecondsRange) !== JSON.stringify(changed.execution.targetDurationSecondsRange)) {
    differences.push({ reference, changed, dimension: "execution.duration", description: "Platform-derived duration constraint differs." });
  }
  return differences;
}

function evidenceForDifference(difference: MaterialDifference): PlatformAdaptationEvidence | null {
  // Prefer the changed brief's evidence because the difference is reported on
  // that platform. If only the reference side has a sourced capability, that
  // still legitimately explains why the two transport-independent briefs
  // differ: the other side remains unknown rather than being asserted false.
  return difference.changed.adaptationEvidence.find((entry) => entry.dimension === difference.dimension)
    ?? difference.reference.adaptationEvidence.find((entry) => entry.dimension === difference.dimension)
    ?? null;
}

export function buildCrossPlatformPlan(input: PackagePlanInput): CrossPlatformPackagePlan {
  const { invariant, briefs, fits, now } = input;
  const refused: RefusedPlatform[] = fits
    .filter((fit) => fit.verdict === "refuse")
    .map((fit) => ({ platform: fit.platform, refusals: fit.refusals }));

  const differences: PlatformDifference[] = [];
  if (briefs.length > 1) {
    const reference = briefs[0];
    for (const changed of briefs.slice(1)) {
      for (const difference of materialDifferences(reference, changed)) {
        const evidence = evidenceForDifference(difference);
        if (evidence === null) {
          throw new UntraceablePlatformDifferenceError(
            `Cross-platform outputs differ at ${changed.platform}:${difference.dimension} without an exact carried platform fact. ` +
              "Unknown capability is not adaptation evidence, and a plausible fact id may not be invented from a platform name.",
          );
        }
        differences.push({
          platform: changed.platform,
          dimension: difference.dimension,
          difference: difference.description,
          justifiedByFactId: evidence.factId,
          justification:
            `Exact source-bound platform fact ${evidence.factId} (${evidence.platform}) states: ${evidence.claim} ` +
            `Source: ${evidence.source}; captured ${evidence.capturedAt}. The other platform may remain unknown; this difference does not assert the inverse there.`,
        });
      }
    }
  }

  const uniform = differences.length === 0 && briefs.length > 1;
  return {
    version: "cross-platform-package-plan-v1",
    planId: `package-${input.missionId}`,
    missionId: input.missionId,
    createdAt: now.toISOString(),
    coreInvariant: {
      thesis: invariant.thesis,
      objective: invariant.objective,
      allowedClaimIds: invariant.allowedClaims.map((claim) => claim.claimId).sort(),
      requiredWording: invariant.requiredWording,
      requiredDisclosures: invariant.requiredDisclosures,
    },
    platformsIncluded: briefs.map((brief) => brief.platform),
    platformsRefused: refused,
    differences,
    uniformExecutionJustified: uniform,
    uniformExecutionReason: uniform
      ? "No source-bound platform fact caused a material difference between included briefs. Uniform execution is therefore justified; unknown platform behaviour is not converted into fake optimization."
      : null,
    limitations: buildLimitations(briefs, refused),
  };
}

function buildLimitations(briefs: readonly PlatformCreativeBrief[], refused: readonly RefusedPlatform[]): readonly string[] {
  const limitations = [
    "No platform ranking or distribution behaviour is modelled, so no adaptation claims to optimize reach.",
    "No posting time is recommended because none has been measured for these accounts.",
    "No trend informs adaptation because no platform trend collector is connected.",
    "A cross-platform difference is emitted only when an exact usable source fact is carried in the brief; otherwise the planner fails closed.",
  ];
  if (refused.length > 0) limitations.push(`${refused.length} platform(s) were refused rather than receiving a degraded version.`);
  if (briefs.some((brief) => brief.provenance.synthetic)) {
    limitations.push("This package plan rests on engineering fixture input and is not a production delivery decision.");
  }
  return limitations;
}

export function formatPackagePlan(plan: CrossPlatformPackagePlan): string {
  const lines: string[] = [];
  lines.push(`CROSS-PLATFORM PACKAGE PLAN — ${plan.planId}`);
  lines.push(`  core truth: ${plan.coreInvariant.thesis}`);
  lines.push(`  objective: ${plan.coreInvariant.objective}`);
  lines.push(`  claims: ${plan.coreInvariant.allowedClaimIds.join(", ") || "none"}`);
  lines.push(`  platforms included: ${plan.platformsIncluded.join(", ") || "none"}`);
  for (const refusal of plan.platformsRefused) {
    lines.push(`  REFUSED ${refusal.platform}: ${refusal.refusals.map((reason) => reason.code).join(", ")}`);
  }
  if (plan.uniformExecutionJustified) lines.push(`  uniform execution: ${plan.uniformExecutionReason}`);
  for (const difference of plan.differences) {
    lines.push(`  ${difference.platform} differs on ${difference.dimension}: ${difference.difference}`);
    lines.push(`    justified by ${difference.justifiedByFactId}: ${difference.justification}`);
  }
  for (const limitation of plan.limitations) lines.push(`  limitation: ${limitation}`);
  return lines.join("\n");
}
