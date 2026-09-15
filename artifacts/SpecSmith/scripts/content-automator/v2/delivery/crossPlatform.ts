// MASTER #4 — Cross-platform package plan (section 15).
//
// A creative difference needs typed provenance. The current brief contract does
// not carry per-field platform fact IDs, so this layer refuses to invent a fact
// ID from a naming convention. Until that contract is enriched, identical
// execution is the only platform adaptation this planner can honestly certify.

import type { PlatformId } from "../platform/model.ts";
import type { PlatformCreativeBrief } from "./brief.ts";
import type { AudiencePlatformFit, RefusalReason } from "./fit.ts";
import type { TruthInvariant } from "./invariants.ts";

export interface PlatformDifference {
  readonly platform: PlatformId;
  readonly dimension: string;
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
  readonly platform: PlatformId;
  readonly dimension: string;
}

function materialDifferences(reference: PlatformCreativeBrief, brief: PlatformCreativeBrief): readonly MaterialDifference[] {
  const differences: MaterialDifference[] = [];
  if ((reference.metadata.title === null) !== (brief.metadata.title === null)) {
    differences.push({ platform: brief.platform, dimension: "metadata.title" });
  }
  if (reference.metadata.description !== brief.metadata.description) {
    differences.push({ platform: brief.platform, dimension: "metadata.description" });
  }
  if (reference.execution.ctaTreatment.treatment !== brief.execution.ctaTreatment.treatment) {
    differences.push({ platform: brief.platform, dimension: "execution.cta" });
  }
  if (JSON.stringify(reference.execution.targetDurationSecondsRange) !== JSON.stringify(brief.execution.targetDurationSecondsRange)) {
    differences.push({ platform: brief.platform, dimension: "execution.duration" });
  }
  return differences;
}

export function buildCrossPlatformPlan(input: PackagePlanInput): CrossPlatformPackagePlan {
  const { invariant, briefs, fits, now } = input;
  const refused: RefusedPlatform[] = fits
    .filter((fit) => fit.verdict === "refuse")
    .map((fit) => ({ platform: fit.platform, refusals: fit.refusals }));

  // The old implementation manufactured fact IDs such as `${platform}-link`
  // whenever outputs differed. A plausible identifier is not provenance. Fail
  // closed until the brief carries the exact fact IDs that caused each field.
  if (briefs.length > 1) {
    const reference = briefs[0];
    const untraceable = briefs.slice(1).flatMap((brief) => materialDifferences(reference, brief));
    if (untraceable.length > 0) {
      throw new UntraceablePlatformDifferenceError(
        `Cross-platform outputs differ without typed per-field fact provenance: ${untraceable.map((d) => `${d.platform}:${d.dimension}`).join(", ")}. ` +
          "Do not invent a fact ID from the platform name. Carry the exact source fact through the brief before adapting this dimension.",
      );
    }
  }

  const uniform = briefs.length > 1;
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
    differences: [],
    uniformExecutionJustified: uniform,
    uniformExecutionReason: uniform
      ? "No traceable platform fact in the current brief contract justifies a creative difference. Uniform execution is therefore the only certified plan; unknown platform behaviour is not a reason to invent adaptation."
      : null,
    limitations: buildLimitations(briefs, refused),
  };
}

function buildLimitations(briefs: readonly PlatformCreativeBrief[], refused: readonly RefusedPlatform[]): readonly string[] {
  const limitations = [
    "No platform ranking or distribution behaviour is modelled, so no adaptation claims to optimize reach.",
    "No posting time is recommended because none has been measured for these accounts.",
    "No trend informs adaptation because no platform trend collector is connected.",
    "Per-field platform fact IDs are not yet carried by PLATFORM_CREATIVE_BRIEF; creative differences therefore fail closed instead of receiving invented provenance.",
  ];
  if (refused.length > 0) {
    limitations.push(`${refused.length} platform(s) were refused rather than receiving a degraded version.`);
  }
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
  for (const limitation of plan.limitations) lines.push(`  limitation: ${limitation}`);
  return lines.join("\n");
}
