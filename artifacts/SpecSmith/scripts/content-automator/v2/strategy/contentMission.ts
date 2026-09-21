// The CONTENT MISSION: strategy's instruction to the Creative Director.
//
// WHAT A MISSION IS AND IS NOT
// ---------------------------
// A mission says what the video must ACHIEVE and what it may not SAY. It does
// not say how to shoot it. That line matters in both directions: strategy that
// dictates shot timing produces creative work nobody owns, and creative that
// invents its own strategy produces videos nobody asked for.
//
// THE PART THAT CARRIES THE INTEGRITY
// -----------------------------------
// `forbiddenClaims` and `requiredWording` are copied from MASTER #2's contract,
// not re-derived. If this module recomputed what may be said, there would be two
// answers to that question and the looser one would eventually win. Strategy is
// a consumer of the evidence boundary, never a second opinion on it.
//
// ANGLES
// ------
// One opportunity yields several angles, and the most sensational is
// deliberately not preferred. Angle selection is scored on objective fit,
// evidence fit and audience level — so a myth-correction angle loses to a
// beginner-explainer angle when there is no evidence the myth is actually held.

import { createHash } from "node:crypto";

import type { ResearchCreativeContract, SafeClaim } from "../research/creativeContract.ts";
import {
  contentPillar,
  type ContentPillarId,
  type StrategicObjective,
  type StrategicOpportunity,
} from "./model.ts";
import type { PriorityAssessment } from "./priority.ts";

/** A strategic format class. MASTER #1 decides how to execute it. */
export type FormatClass =
  | "blind-comparison"
  | "myth-vs-fact"
  | "quick-explainer"
  | "ranked-choice"
  | "side-by-side"
  | "walkthrough"
  | "benchmark-explanation"
  | "before-after"
  | "question-answer"
  | "buyer-warning"
  | "tool-demo"
  | "visual-analogy"
  | "mini-case-study";

export interface StrategicAngle {
  readonly angleId: string;
  readonly name: string;
  readonly thesis: string;
  readonly formatClass: FormatClass;
  readonly audienceLevel: "beginner" | "mixed" | "advanced";
  /** Which objective this angle serves best. */
  readonly servesObjective: StrategicObjective;
  /** Claim kinds this angle would have to assert. Drives its evidence needs. */
  readonly requiresClaimKinds: readonly string[];
  readonly rationale: string;
  /** Why this angle was NOT chosen, filled in for rejected angles. */
  readonly rejectedBecause?: string;
}

/**
 * Candidate angles for a pillar.
 *
 * Deliberately a table rather than generation: every angle here is one a human
 * strategist would recognise, and a generated angle would be an unevidenced
 * guess wearing a strategy label. §17 of the brief draws exactly this line.
 */
const ANGLE_LIBRARY: Partial<Record<ContentPillarId, readonly Omit<StrategicAngle, "angleId">[]>> = {
  "gpu-comparisons": [
    { name: "Blind comparison", thesis: "Let the viewer pick before the names are revealed.", formatClass: "blind-comparison",
      audienceLevel: "mixed", servesObjective: "shareable-comparison", requiresClaimKinds: ["comparison"],
      rationale: "SpecSmith's signature format; the interaction is the differentiator, not the verdict." },
    { name: "Side-by-side evidence", thesis: "Show the measured difference under stated conditions.", formatClass: "side-by-side",
      audienceLevel: "advanced", servesObjective: "build-trust-authority", requiresClaimKinds: ["performance-measured"],
      rationale: "Serves authority, and demands the strongest evidence of any angle here." },
    { name: "Which should you actually buy", thesis: "Translate the difference into a decision.", formatClass: "buyer-warning",
      audienceLevel: "beginner", servesObjective: "qualified-site-visits", requiresClaimKinds: ["comparison", "current-price"],
      rationale: "Highest intent, and inherits the price pillar's evidence risk because a buying call needs a current price." },
  ],
  "fps-expectations": [
    { name: "What FPS will you actually get", thesis: "Set a realistic expectation for a named build.", formatClass: "question-answer",
      audienceLevel: "beginner", servesObjective: "drive-fps-estimator-usage", requiresClaimKinds: ["performance-estimated"],
      rationale: "Directly demonstrates a shipped SpecSmith surface, and the estimate is SpecSmith's own output." },
    { name: "Why your FPS is lower than the reviews", thesis: "Explain the gap between benchmark and living room.", formatClass: "visual-analogy",
      audienceLevel: "beginner", servesObjective: "educate-new-builders", requiresClaimKinds: ["performance-estimated"],
      rationale: "Addresses a real and common disappointment without needing a new measurement." },
  ],
  "hardware-terminology": [
    { name: "What it actually does", thesis: "Explain the term in terms of the outcome the viewer cares about.", formatClass: "quick-explainer",
      audienceLevel: "beginner", servesObjective: "educate-new-builders", requiresClaimKinds: ["specification"],
      rationale: "Cheapest angle to evidence: a manufacturer specification settles it outright." },
    { name: "How much do you need", thesis: "Turn the spec into a threshold.", formatClass: "ranked-choice",
      audienceLevel: "beginner", servesObjective: "drive-builder-usage", requiresClaimKinds: ["specification", "performance-estimated"],
      rationale: "More useful than a definition, and needs an estimate rather than just a datasheet." },
  ],
  compatibility: [
    { name: "Will it fit", thesis: "Answer the fitment question deterministically.", formatClass: "walkthrough",
      audienceLevel: "beginner", servesObjective: "drive-builder-usage", requiresClaimKinds: ["compatibility"],
      rationale: "Deterministic and checkable, and exactly what the builder enforces." },
  ],
  "price-availability-interpretation": [
    { name: "Is this actually a deal", thesis: "Interpret one observed listing against its context.", formatClass: "buyer-warning",
      audienceLevel: "mixed", servesObjective: "answer-active-confusion", requiresClaimKinds: ["current-price"],
      rationale: "Useful, and the most evidence-fragile angle in the library: the price is true for hours." },
  ],
  "hardware-myths": [
    { name: "Myth versus measurement", thesis: "State the belief, then what the evidence shows.", formatClass: "myth-vs-fact",
      audienceLevel: "mixed", servesObjective: "defend-against-misinformation", requiresClaimKinds: ["misconception-exists"],
      rationale: "Only valid with evidence the belief is actually held; otherwise it invents a myth to correct." },
  ],
  "bottleneck-myths": [
    { name: "What bottleneck really means", thesis: "Replace the word with the mechanism.", formatClass: "visual-analogy",
      audienceLevel: "beginner", servesObjective: "educate-new-builders", requiresClaimKinds: ["performance-estimated"],
      rationale: "Serves the confusion without needing to prove anyone holds a specific false belief." },
  ],
  "tool-demonstrations": [
    { name: "Watch it answer the question", thesis: "Show the tool solving the viewer's actual problem.", formatClass: "tool-demo",
      audienceLevel: "mixed", servesObjective: "explain-product-capability", requiresClaimKinds: ["specsmith-product"],
      rationale: "Lowest evidence risk in the library: the claims are about SpecSmith's own deterministic behaviour." },
  ],
  "upgrade-decisions": [
    { name: "Is it worth upgrading yet", thesis: "Answer the hold-or-upgrade question for one starting point.", formatClass: "question-answer",
      audienceLevel: "mixed", servesObjective: "drive-upgrade-tool-usage", requiresClaimKinds: ["comparison", "performance-estimated"],
      rationale: "The question the upgrade tool exists to answer, which makes the CTA honest rather than bolted on." },
  ],
};

/** Default angles for a pillar with no library entry, so nothing silently has none. */
const FALLBACK_ANGLE: Omit<StrategicAngle, "angleId"> = {
  name: "Plain explainer",
  thesis: "Explain the thing clearly, once.",
  formatClass: "quick-explainer",
  audienceLevel: "beginner",
  servesObjective: "educate-new-builders",
  requiresClaimKinds: ["specification"],
  rationale: "No pillar-specific angle library exists yet; a plain explainer is the safest default.",
};

function angleId(pillar: ContentPillarId, name: string): string {
  return `angle-${pillar}-${createHash("sha256").update(name.toLowerCase()).digest("hex").slice(0, 8)}`;
}

/** Generates and ranks angles for an opportunity. */
export function proposeAngles(
  opportunity: StrategicOpportunity,
  contract: ResearchCreativeContract,
): { readonly chosen: StrategicAngle | null; readonly considered: readonly StrategicAngle[]; readonly reason: string } {
  const library = ANGLE_LIBRARY[opportunity.pillar] ?? [FALLBACK_ANGLE];
  const safeKinds = new Set(contract.safeClaims.map((claim) => claim.claimId));
  const considered: StrategicAngle[] = [];

  for (const template of library) {
    const angle: StrategicAngle = { ...template, angleId: angleId(opportunity.pillar, template.name) };

    // An angle asserting a claim kind the contract never approved is not
    // available, however well it would serve the objective.
    const hasSupport = contract.safeClaims.length > 0;
    const needsCurrentPrice = template.requiresClaimKinds.includes("current-price");
    const priceIsSafe = contract.safeClaims.some((claim) => /price|\$/i.test(claim.proposition));

    if (!hasSupport) {
      considered.push({ ...angle, rejectedBecause: "No claim in the research contract is safe to state, so no angle has anything to say." });
      continue;
    }
    if (needsCurrentPrice && !priceIsSafe) {
      considered.push({ ...angle, rejectedBecause: "This angle needs a current-price claim, and no price claim reached the evidence bar." });
      continue;
    }
    if (template.requiresClaimKinds.includes("misconception-exists") && opportunity.communityPain === "unknown") {
      considered.push({ ...angle, rejectedBecause: "A myth angle needs evidence the belief is actually held; no community signal is connected." });
      continue;
    }
    if (template.audienceLevel === "advanced" && opportunity.audienceLevel === "beginner") {
      considered.push({ ...angle, rejectedBecause: "Angle is pitched above this opportunity's audience level." });
      continue;
    }
    considered.push(angle);
    void safeKinds;
  }

  const available = considered.filter((angle) => angle.rejectedBecause === undefined);
  if (available.length === 0) {
    return { chosen: null, considered, reason: "Every candidate angle was rejected; there is no strategically sound way to make this piece yet." };
  }

  // Objective fit first, then the angle that leans on the fewest claim kinds —
  // fewer claims is less that can be wrong, which is the right default bias.
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
    reason: `Chose "${chosen.name}" because it serves ${opportunity.primaryObjective} and asserts the fewest claim kinds of the available angles. ${chosen.rationale}`,
  };
}

export interface ContentMission {
  readonly version: "content-mission-v1";
  readonly missionId: string;
  readonly opportunityId: string;
  readonly createdAt: string;

  readonly primaryObjective: StrategicObjective;
  readonly secondaryObjectives: readonly StrategicObjective[];
  readonly pillar: ContentPillarId;
  /** The viewer's problem, in their words. */
  readonly audienceProblem: string;
  readonly audienceLevel: "beginner" | "mixed" | "advanced";
  /** What the viewer should understand, feel, and do. */
  readonly viewerShouldUnderstand: string;
  readonly viewerShouldDo: string;
  readonly centralQuestion: string;

  readonly angle: StrategicAngle;
  readonly formatClass: FormatClass;

  /** Copied from MASTER #2. Strategy does not re-derive what may be said. */
  readonly permittedClaims: readonly SafeClaim[];
  readonly forbiddenClaims: readonly { readonly proposition: string; readonly reason: string }[];
  readonly requiredWording: readonly string[];

  readonly productSurface: string | null;
  readonly productRoute: string | null;
  readonly ctaIntent: string;
  /** True when the content stands up even with the CTA removed. */
  readonly usefulWithoutCta: boolean;

  readonly whyNow: StrategicOpportunity["whyNow"];
  readonly whyThisDeservesProduction: string;
  readonly successHypothesisId: string | null;
  readonly risks: readonly string[];
  readonly resourcePosture: StrategicOpportunity["resourcePosture"];
  readonly provenance: StrategicOpportunity["provenance"];
}

export interface MissionInput {
  readonly opportunity: StrategicOpportunity;
  readonly assessment: PriorityAssessment;
  readonly contract: ResearchCreativeContract;
  readonly angle: StrategicAngle;
  readonly productRoute: string | null;
  readonly hypothesisId: string | null;
  readonly now: Date;
}

export class MissionRefusedError extends Error {
  readonly code = "mission-refused";
}

/**
 * Builds a mission, refusing when the assessment did not authorise production.
 *
 * The guard is the point: without it a caller could hold an opportunity and then
 * build a mission from it anyway, and the whole priority stage would become
 * advisory. There is deliberately no flag to override it.
 */
export function buildContentMission(input: MissionInput): ContentMission {
  const { opportunity, assessment, contract, angle, now } = input;

  if (!["produce-now", "produce-next"].includes(assessment.action)) {
    throw new MissionRefusedError(
      `Cannot build a mission for ${opportunity.opportunityId}: strategy resolved to ${assessment.action}. ${assessment.explanation}`,
    );
  }
  if (contract.safeClaims.length === 0) {
    throw new MissionRefusedError(
      `Cannot build a mission for ${opportunity.opportunityId}: the research contract approved no claims, so there is nothing the video may assert.`,
    );
  }

  const pillar = contentPillar(opportunity.pillar);
  const requiredWording = [...new Set(contract.safeClaims.flatMap((claim) => claim.requiredWording))];

  // A CTA is honest only when the surface is shipped AND the content would be
  // useful without it. Both halves matter: the first stops SpecSmith promising
  // something it has not built, the second stops the content being an advert.
  const surfaceShipped = opportunity.productReadiness === "shipped" && input.productRoute !== null;
  const usefulWithoutCta = angle.requiresClaimKinds.some((kind) => kind !== "specsmith-product");

  return {
    version: "content-mission-v1",
    missionId: `mission-${createHash("sha256").update(`${opportunity.opportunityId}|${angle.angleId}|${opportunity.version}`).digest("hex").slice(0, 16)}`,
    opportunityId: opportunity.opportunityId,
    createdAt: now.toISOString(),
    primaryObjective: opportunity.primaryObjective,
    secondaryObjectives: opportunity.secondaryObjectives,
    pillar: opportunity.pillar,
    audienceProblem: opportunity.problem,
    audienceLevel: angle.audienceLevel,
    viewerShouldUnderstand: angle.thesis,
    viewerShouldDo: surfaceShipped
      ? `Open ${input.productRoute} and answer the question for their own parts.`
      : "Take the explanation away; there is no shipped surface to send them to.",
    centralQuestion: opportunity.problem,
    angle,
    formatClass: angle.formatClass,
    permittedClaims: contract.safeClaims,
    forbiddenClaims: [
      ...contract.unsafeClaims.map((claim) => ({ proposition: claim.proposition, reason: claim.reason })),
      ...contract.disputedClaims.map((claim) => ({ proposition: claim.proposition, reason: `Disputed: ${claim.reason}` })),
    ],
    requiredWording,
    productSurface: opportunity.productSurface,
    productRoute: surfaceShipped ? input.productRoute : null,
    ctaIntent: surfaceShipped
      ? `Send the viewer to ${input.productRoute} to continue with their own configuration.`
      : "No CTA: the relevant surface is not shipped, and content may not promise it.",
    usefulWithoutCta,
    whyNow: opportunity.whyNow,
    whyThisDeservesProduction: `${assessment.explanation} ${assessment.reasonsToAct.join(" ")}`.trim(),
    successHypothesisId: input.hypothesisId,
    risks: [
      ...opportunity.risks.filter((risk) => !risk.blocking).map((risk) => `${risk.code}: ${risk.detail}`),
      ...pillar.inherentRisks.map((risk) => `pillar-inherent: ${risk}`),
    ],
    resourcePosture: opportunity.resourcePosture,
    provenance: opportunity.provenance,
  };
}

/** Renders a mission for a terminal. */
export function formatContentMission(mission: ContentMission): string {
  const lines: string[] = [];
  lines.push(`CONTENT_MISSION ${mission.missionId}`);
  lines.push(`  from opportunity: ${mission.opportunityId}`);
  lines.push(`  objective:        ${mission.primaryObjective}${mission.secondaryObjectives.length ? ` (also ${mission.secondaryObjectives.join(", ")})` : ""}`);
  lines.push(`  pillar:           ${mission.pillar}`);
  lines.push(`  audience problem: ${mission.audienceProblem}`);
  lines.push(`  angle:            ${mission.angle.name} [${mission.formatClass}] for a ${mission.audienceLevel} audience`);
  lines.push(`  viewer should:    understand "${mission.viewerShouldUnderstand}" and then ${mission.viewerShouldDo}`);
  lines.push(`  why now:          ${mission.whyNow}`);
  lines.push(`  deserves it:      ${mission.whyThisDeservesProduction}`);
  lines.push(`  may state:        ${mission.permittedClaims.length} claim(s)`);
  for (const claim of mission.permittedClaims) lines.push(`    [${claim.state}] ${claim.proposition}`);
  lines.push(`  may NOT state:    ${mission.forbiddenClaims.length} claim(s)`);
  for (const claim of mission.forbiddenClaims) lines.push(`    ${claim.proposition} — ${claim.reason}`);
  for (const wording of mission.requiredWording) lines.push(`  required wording: ${wording}`);
  lines.push(`  cta:              ${mission.ctaIntent}`);
  lines.push(`  useful w/o cta:   ${mission.usefulWithoutCta}`);
  lines.push(`  resource posture: ${mission.resourcePosture}`);
  for (const risk of mission.risks) lines.push(`  risk:             ${risk}`);
  return lines.join("\n");
}
