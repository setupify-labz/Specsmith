import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import type { StrategicOpportunity } from "./model.ts";
import { proposeAngles, type StrategicAngle } from "./contentMission.ts";

/**
 * Evidence-bound angle selection.
 *
 * `proposeAngles` knows the creative requirements of each angle, but the
 * research contract intentionally carries claim permissions without duplicating
 * AtomicClaim.kind. This adapter joins those two canonical MASTER #2 records by
 * claimId before Strategy is allowed to select an angle. A safe specification
 * claim therefore cannot accidentally authorize a performance, comparison, or
 * price angle merely because some safe claim exists.
 */
export function proposeEvidenceBoundAngles(
  opportunity: StrategicOpportunity,
  contract: ResearchCreativeContract,
  research: ResearchResult,
): { readonly chosen: StrategicAngle | null; readonly considered: readonly StrategicAngle[]; readonly reason: string } {
  const base = proposeAngles(opportunity, contract);
  const safeClaimIds = new Set(contract.safeClaims.map((claim) => claim.claimId));
  const safeKinds = new Set(
    research.claims
      .filter((claim) => safeClaimIds.has(claim.claimId))
      .map((claim) => claim.kind),
  );

  const considered = base.considered.map((angle) => {
    if (angle.rejectedBecause !== undefined) return angle;
    const missingKinds = angle.requiresClaimKinds.filter((kind) => !safeKinds.has(kind as never));
    return missingKinds.length === 0
      ? angle
      : {
          ...angle,
          rejectedBecause: `This angle requires safe research claim kind(s) ${missingKinds.join(", ")}, but MASTER #2 approved only: ${[...safeKinds].join(", ") || "none"}.`,
        };
  });

  const available = considered.filter((angle) => angle.rejectedBecause === undefined);
  if (available.length === 0) {
    return {
      chosen: null,
      considered,
      reason: "Every candidate angle was rejected after binding its required claim kinds to MASTER #2's actually safe claims.",
    };
  }

  const chosen = [...available].sort((a, b) => {
    const objectiveFit =
      Number(b.servesObjective === opportunity.primaryObjective) - Number(a.servesObjective === opportunity.primaryObjective);
    if (objectiveFit !== 0) return objectiveFit;
    const claimLoad = a.requiresClaimKinds.length - b.requiresClaimKinds.length;
    if (claimLoad !== 0) return claimLoad;
    return a.angleId.localeCompare(b.angleId);
  })[0];

  return {
    chosen,
    considered,
    reason: `Chose "${chosen.name}" only after every required claim kind was matched to a safe MASTER #2 claim. ${chosen.rationale}`,
  };
}
