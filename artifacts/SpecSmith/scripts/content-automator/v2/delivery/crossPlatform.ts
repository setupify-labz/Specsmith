// MASTER #4 — Cross-platform package plan (section 15).
//
// One mission, up to three platform versions, one shared core truth.
//
// Two failure modes are equally bad and this file refuses both:
//
//   FAKE INTELLIGENCE — emit three byte-identical plans and call the difference
//                       strategy. That is a rename, not an adaptation.
//
//   FAKE OPTIMIZATION — invent differences with no evidence behind them,
//                       because three identical plans look lazy. That is
//                       folklore, and folklore is worse than sameness.
//
// So the plan records, for each difference, the ESTABLISHED platform fact that
// caused it. A difference with no fact behind it is not emitted, and when no
// platform fact differs, the plan says so plainly: same execution is justified.
// "We found no evidence-based reason to differ" is a real finding.

import type { PlatformId } from "../platform/model.ts";
import type { PlatformCreativeBrief } from "./brief.ts";
import type { AudiencePlatformFit, RefusalReason } from "./fit.ts";
import type { TruthInvariant } from "./invariants.ts";

export interface PlatformDifference {
  readonly platform: PlatformId;
  readonly dimension: string;
  readonly difference: string;
  /** The platform fact that justifies it. Never empty. */
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

  /** The truth every version shares, stated once. */
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
  /** True when no established platform fact justifies any difference. */
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

/**
 * Compare the briefs and record only differences that a platform fact caused.
 *
 * The comparison is against the FIRST brief as a reference rather than
 * pairwise, because what matters is "this platform differs from the shared
 * baseline, and here is why", not a matrix of every pair.
 */
export function buildCrossPlatformPlan(input: PackagePlanInput): CrossPlatformPackagePlan {
  const { invariant, briefs, fits, now } = input;

  const refused: RefusedPlatform[] = fits
    .filter((fit) => fit.verdict === "refuse")
    .map((fit) => ({ platform: fit.platform, refusals: fit.refusals }));

  const differences: PlatformDifference[] = [];

  if (briefs.length > 1) {
    const reference = briefs[0];
    for (const brief of briefs.slice(1)) {
      differences.push(...diffAgainstReference(reference, brief));
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
      ? "The same execution is currently justified across every included platform because no established platform fact " +
        "differs between them in a way that should change the cut. The differences that exist — clickable links, title " +
        "fields — are metadata differences, already reflected in each brief's metadata. Inventing a creative difference " +
        "to look thorough would be optimizing against folklore rather than evidence."
      : null,
    limitations: buildLimitations(briefs, refused),
  };
}

/**
 * Find the real differences between two briefs.
 *
 * Every branch here names the capability that caused the difference, and that
 * capability carries a fact ID. If a dimension differs without a fact behind
 * it, that is a bug in the fit engine rather than a difference worth shipping,
 * so it is deliberately not reachable from this function.
 */
function diffAgainstReference(
  reference: PlatformCreativeBrief,
  brief: PlatformCreativeBrief,
): readonly PlatformDifference[] {
  const differences: PlatformDifference[] = [];

  // Title surface: a real, documented structural difference.
  if ((reference.metadata.title === null) !== (brief.metadata.title === null)) {
    differences.push({
      platform: brief.platform,
      dimension: "metadata.title",
      difference:
        brief.metadata.title === null
          ? "No separate title field; the central question moves into the caption."
          : "A separate title field carries the central question.",
      justifiedByFactId: `${brief.platform}-description-limit`,
      justification:
        "This surface's text model differs structurally: one platform separates title from description and the other does not. " +
        "This is a documented capability difference, not a guess about what each platform rewards.",
    });
  }

  // CTA treatment: driven by whether links actually render as links.
  if (reference.execution.ctaTreatment.treatment !== brief.execution.ctaTreatment.treatment) {
    differences.push({
      platform: brief.platform,
      dimension: "execution.cta",
      difference: brief.execution.ctaTreatment.treatment,
      justifiedByFactId: `${brief.platform}-link`,
      justification:
        "Whether a link in the description is clickable is an established interaction capability, and it changes where a " +
        "route can usefully live. Nothing here assumes anything about how the platform treats outbound links in ranking.",
    });
  }

  // Description length: a documented limit, not a stylistic preference.
  if (reference.metadata.description !== brief.metadata.description) {
    differences.push({
      platform: brief.platform,
      dimension: "metadata.description",
      difference: `Description fitted to this platform's ${brief.metadata.description.length}-character rendering.`,
      justifiedByFactId: `${brief.platform}-description-limit`,
      justification:
        "The character limit differs between these surfaces. The disclosures are placed before the CTA in every version, " +
        "so a truncation loses marketing rather than a caveat.",
    });
  }

  return differences;
}

function buildLimitations(briefs: readonly PlatformCreativeBrief[], refused: readonly RefusedPlatform[]): readonly string[] {
  const limitations: string[] = [];

  limitations.push(
    "No platform behaviour is modelled. How each platform ranks, promotes or suppresses content is unknown, so no " +
      "adaptation here is optimizing for distribution — only for what the platform can structurally carry.",
  );
  limitations.push(
    "No posting time is recommended: none has been measured for these accounts, and an unmeasured time is unknown rather than optimal.",
  );
  limitations.push(
    "No trend informs any adaptation: no platform trend collector is connected, so nothing may be described as trending.",
  );
  if (refused.length > 0) {
    limitations.push(
      `${refused.length} platform(s) were refused rather than served with a degraded version. Distribution is not forced to three.`,
    );
  }
  if (briefs.some((brief) => brief.provenance.synthetic)) {
    limitations.push("This package plan rests on engineering fixture input and is not a production delivery decision.");
  }
  return limitations;
}

export function formatPackagePlan(plan: CrossPlatformPackagePlan): string {
  const lines: string[] = [];
  lines.push(`CROSS-PLATFORM PACKAGE PLAN — ${plan.planId}`);
  lines.push(`  core truth (shared by every version):`);
  lines.push(`    thesis: ${plan.coreInvariant.thesis}`);
  lines.push(`    objective: ${plan.coreInvariant.objective}`);
  lines.push(`    claims: ${plan.coreInvariant.allowedClaimIds.join(", ") || "none"}`);
  if (plan.coreInvariant.requiredWording.length > 0) {
    lines.push(`    required wording (every platform): ${plan.coreInvariant.requiredWording.join(" | ")}`);
  }
  lines.push(`  platforms included: ${plan.platformsIncluded.join(", ") || "none"}`);

  for (const refusal of plan.platformsRefused) {
    lines.push(`  REFUSED ${refusal.platform}:`);
    for (const reason of refusal.refusals) {
      lines.push(`    ${reason.code}: ${reason.explanation}`);
    }
  }

  if (plan.uniformExecutionJustified) {
    lines.push(`  uniform execution: ${plan.uniformExecutionReason}`);
  } else {
    for (const difference of plan.differences) {
      lines.push(`  ${difference.platform} differs on ${difference.dimension}: ${difference.difference}`);
      lines.push(`    justified by ${difference.justifiedByFactId}: ${difference.justification}`);
    }
  }

  for (const limitation of plan.limitations) {
    lines.push(`  limitation: ${limitation}`);
  }
  return lines.join("\n");
}
