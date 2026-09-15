// MASTER #4 — Audience × Platform fit (sections 11, 17, 18, 19, 20, 25, 26).
//
// A platform may be refused only by an ESTABLISHED incompatible constraint.
// Unknown is not false, a lower bound is not an upper bound, and an unevidenced
// heuristic may never become an absolute refusal.

import type { ContentMission } from "../strategy/contentMission.ts";
import type { AudienceFit } from "../audience/profile.ts";
import type { AudienceProfile } from "../audience/model.ts";
import {
  statusIsBinding,
  statusIsUsable,
  type Capability,
  type PlatformId,
  type PlatformSnapshot,
  type PostingTimeState,
  type TrendState,
} from "../platform/model.ts";
import { usableFacts } from "../platform/ingestion.ts";
import type { TruthInvariant } from "./invariants.ts";

export type FitVerdict = "strong-fit" | "reasonable-fit" | "weak-fit" | "unknown" | "refuse";

export type ConflictResolution =
  | "restructure"
  | "layer-information"
  | "change-format"
  | "choose-another-platform"
  | "refuse-adaptation";

export interface FitConflict {
  readonly code: string;
  readonly tension: string;
  readonly resolution: ConflictResolution;
  readonly explanation: string;
}

export interface RefusalReason {
  readonly code: string;
  readonly explanation: string;
}

export interface PacingGuidance {
  readonly timeToFirstUsefulInformationSeconds: number;
  readonly maxSetupSeconds: number;
  readonly maxBeatSeconds: number;
  readonly visualChangeEverySeconds: number;
  readonly isHypothesis: true;
  readonly basis: string;
  readonly hypothesisIds: readonly string[];
}

export interface CaptionGuidance {
  readonly maxLines: number;
  readonly maxCharsPerLine: number;
  readonly minSecondsOnScreen: number;
  readonly mustBeBurnedIn: boolean;
  readonly mustNotDuplicateSpokenWordExactly: boolean;
  readonly basis: string;
}

export interface AccessibilityRequirement {
  readonly code: string;
  readonly requirement: string;
  readonly negotiable: false;
}

export interface CtaGuidance {
  readonly include: boolean;
  readonly treatment: string;
  readonly reason: string;
}

export interface AudiencePlatformFit {
  readonly platform: PlatformId;
  readonly missionId: string;
  readonly audienceProfileId: string;
  readonly platformSnapshotId: string;
  readonly verdict: FitVerdict;
  readonly reasons: readonly string[];
  readonly refusals: readonly RefusalReason[];
  readonly conflicts: readonly FitConflict[];
  readonly explanationDepth: AudienceFit["explanationDepth"];
  readonly pacing: PacingGuidance;
  readonly captions: CaptionGuidance;
  readonly accessibility: readonly AccessibilityRequirement[];
  readonly cta: CtaGuidance;
  readonly hookConstraints: readonly string[];
  readonly terminologyPolicy: readonly string[];
  readonly visualDensityGuidance: string;
  readonly postingTime: PostingTimeState;
  readonly trend: TrendState;
  readonly unresolvedAssumptions: readonly string[];
  readonly platformRisks: readonly string[];
  readonly staleInputs: readonly string[];
}

export interface FitInput {
  readonly mission: ContentMission;
  readonly profile: AudienceProfile;
  readonly audienceFit: AudienceFit;
  readonly invariant: TruthInvariant;
  readonly snapshot: PlatformSnapshot;
  readonly postingTime: PostingTimeState;
  readonly trend: TrendState;
  readonly now: Date;
}

const WORDS_PER_SECOND = 2.5;

export function requiredHonestySeconds(invariant: TruthInvariant): number {
  const words = invariant.requiredWording.join(" ").trim().split(/\s+/).filter(Boolean).length;
  const disclosureWords = invariant.requiredDisclosures.join(" ").trim().split(/\s+/).filter(Boolean).length;
  return (words + disclosureWords) / WORDS_PER_SECOND;
}

function hasBindingValue<T>(capability: Capability<T>): capability is Capability<T> & { readonly value: T } {
  return capability.value !== null && statusIsBinding(capability.status);
}

function hasUsableValue<T>(capability: Capability<T>): capability is Capability<T> & { readonly value: T } {
  return capability.value !== null && statusIsUsable(capability.status) && capability.status !== "hypothesis";
}

export function assessAudiencePlatformFit(input: FitInput): AudiencePlatformFit {
  const { mission, profile, audienceFit, invariant, snapshot, now } = input;
  const facts = usableFacts(snapshot, now);
  const stale = snapshot.facts
    .filter((fact) => !statusIsUsable(fact.status) || (fact.expiresAt !== null && Date.parse(fact.expiresAt) < now.getTime()))
    .map((fact) => `${fact.factId}: ${fact.claim} (${fact.status})`);

  const refusals: RefusalReason[] = [];
  const conflicts: FitConflict[] = [];
  const reasons: string[] = [];
  const capability = snapshot.capability;

  // Unknown orientation is UNKNOWN, not incompatible. Refusal requires an
  // established constraint proving that SpecSmith's vertical output cannot fit.
  if (hasBindingValue(capability.media.orientation) && capability.media.orientation.value !== "vertical") {
    refusals.push({
      code: "media-incompatible",
      explanation:
        `${snapshot.platform} has an established orientation constraint of ${capability.media.orientation.value}, ` +
        "which is incompatible with SpecSmith's vertical short-form output.",
    });
  }

  // An actual verified maximum is an upper bound. We refuse only when the
  // required truthful wording itself exceeds that entire bound. The old 50%
  // threshold was an unevidenced judgment and is intentionally not a blocker.
  const honestySeconds = requiredHonestySeconds(invariant);
  const maxDuration = hasBindingValue(capability.media.maxDurationSeconds)
    ? capability.media.maxDurationSeconds.value
    : null;
  if (maxDuration !== null && honestySeconds > maxDuration) {
    refusals.push({
      code: "evidence-cannot-fit-honestly",
      explanation:
        `Required wording and disclosures take about ${honestySeconds.toFixed(1)}s, longer than the established ` +
        `${maxDuration}s maximum. The claim cannot be shortened by deleting a caveat, so this format is refused.`,
    });
  }

  // A known description limit can create pressure, but this model cannot prove
  // that no other disclosure surface exists. Therefore it is a conflict, not an
  // absolute refusal. Unknown limits remain unknown.
  if (hasUsableValue(capability.text.descriptionMaxChars) && invariant.requiredDisclosures.length > 0) {
    const disclosureChars = invariant.requiredDisclosures.join(" ").length;
    if (disclosureChars > capability.text.descriptionMaxChars.value) {
      conflicts.push({
        code: "disclosure-text-surface-pressure",
        tension:
          `Required disclosure instructions total ${disclosureChars} characters while the established description limit is ` +
          `${capability.text.descriptionMaxChars.value}.`,
        resolution: "restructure",
        explanation:
          "Keep the disclosure in the video itself and use only a text surface that has independently verified capacity. " +
          "This is not a refusal because absence of another surface has not been established.",
      });
    }
  }

  if (audienceFit.explanationDepth === "extensive" && maxDuration !== null) {
    conflicts.push({
      code: "depth-versus-duration",
      tension:
        `This audience needs extensive explanation (${(profile.knowledge.cannotAssume.value ?? []).length} terms cannot be assumed) ` +
        `within an established ${maxDuration}s maximum.`,
      resolution: "layer-information",
      explanation:
        "Layer supporting detail while keeping every claim, caveat and required disclosure intact. If the complete truthful " +
        "message cannot fit after restructuring, choose a longer format rather than deleting evidence.",
    });
  }

  if (profile.segmentsConflict) {
    conflicts.push({
      code: "segments-cannot-share-one-creative",
      tension: profile.segmentConflictReason ?? "Two segments need different treatments.",
      resolution: "change-format",
      explanation:
        "Scope this creative to the primary segment and preserve the second as a separate mission candidate rather than " +
        "pretending one cut can serve incompatible needs.",
    });
  }

  if (invariant.estimatedClaimIds.length > 0) {
    conflicts.push({
      code: "estimate-label-versus-brevity",
      tension: "Every line that states an estimated figure must retain its estimate status and configuration.",
      resolution: "restructure",
      explanation:
        "Shorten surrounding copy, not the evidence boundary. Each line that states the estimate keeps the estimate label and " +
        "required configuration, matching the truth-invariant checker.",
    });
  }

  let verdict: FitVerdict;
  if (refusals.length > 0) {
    verdict = "refuse";
    reasons.push(`Refused for ${refusals.length} established incompatibility reason(s).`);
  } else if (facts.length === 0) {
    verdict = "unknown";
    reasons.push(
      "No external platform facts are established in this snapshot. Unknown capability is preserved as unknown rather than converted to compatibility or incompatibility.",
    );
  } else {
    const bindingFacts = facts.filter((fact) => statusIsBinding(fact.status));
    const audienceGrounded = audienceFit.verdict === "well-grounded" || audienceFit.verdict === "logically-grounded";
    if (bindingFacts.length >= 4 && audienceGrounded && conflicts.length === 0) {
      verdict = "strong-fit";
      reasons.push(`${bindingFacts.length} binding platform constraints are established and no conflict was found.`);
    } else if (bindingFacts.length >= 3 && audienceGrounded) {
      verdict = "reasonable-fit";
      reasons.push(`${bindingFacts.length} binding platform constraints are established with ${conflicts.length} explicit conflict(s).`);
    } else if (audienceFit.verdict === "ungrounded") {
      verdict = "weak-fit";
      reasons.push("The mission has no audience grounding, so there is no basis for a strong platform-fit conclusion.");
    } else {
      verdict = "weak-fit";
      reasons.push(`Only ${bindingFacts.length} binding platform constraint(s) are established.`);
    }
  }

  if (input.postingTime.state === "unknown") {
    reasons.push("Posting time is unknown and cannot improve or worsen fit.");
  }

  return {
    platform: snapshot.platform,
    missionId: mission.missionId,
    audienceProfileId: profile.profileId,
    platformSnapshotId: snapshot.snapshotId,
    verdict,
    reasons,
    refusals,
    conflicts,
    explanationDepth: audienceFit.explanationDepth,
    pacing: derivePacing(audienceFit, profile, invariant),
    captions: deriveCaptions(audienceFit),
    accessibility: deriveAccessibility(snapshot),
    cta: deriveCta(mission, audienceFit, snapshot),
    hookConstraints: deriveHookConstraints(invariant, profile),
    terminologyPolicy: audienceFit.terminologyPolicy,
    visualDensityGuidance: deriveVisualDensity(audienceFit),
    postingTime: input.postingTime,
    trend: input.trend,
    unresolvedAssumptions: [
      ...profile.unknowns.slice(0, 6),
      ...(capability.media.orientation.status === "unknown" ? ["Accepted platform orientation is unverified."] : []),
      ...(capability.media.maxDurationSeconds.status === "unknown" ? ["Maximum platform duration is unverified."] : []),
      ...(capability.interaction.outboundLinkInDescription.status === "unknown" ? ["Outbound-link clickability is unverified."] : []),
      "No platform ranking or distribution behaviour is assumed.",
    ],
    platformRisks: derivePlatformRisks(snapshot, invariant),
    staleInputs: stale,
  };
}

function derivePacing(audienceFit: AudienceFit, profile: AudienceProfile, invariant: TruthInvariant): PacingGuidance {
  const needsDepth = audienceFit.explanationDepth === "extensive" || audienceFit.explanationDepth === "layered";
  const hasEstimates = invariant.estimatedClaimIds.length > 0;
  return {
    timeToFirstUsefulInformationSeconds: hasEstimates ? 3 : 2,
    maxSetupSeconds: needsDepth ? 4 : 3,
    maxBeatSeconds: needsDepth ? 5 : 4,
    visualChangeEverySeconds: needsDepth ? 4 : 3,
    isHypothesis: true,
    basis:
      "A creative hypothesis derived from explanation needs, not a measured platform optimum. MASTER #5 owns performance testing.",
    hypothesisIds: profile.hypothesisIds,
  };
}

function deriveCaptions(audienceFit: AudienceFit): CaptionGuidance {
  const beginnerFacing = audienceFit.explanationDepth === "extensive" || audienceFit.explanationDepth === "moderate";
  return {
    maxLines: 2,
    maxCharsPerLine: beginnerFacing ? 30 : 34,
    minSecondsOnScreen: beginnerFacing ? 2.5 : 2,
    // This is a SpecSmith production/accessibility requirement, not a statement
    // about a platform capability.
    mustBeBurnedIn: true,
    mustNotDuplicateSpokenWordExactly: false,
    basis:
      "Line length and display time are unmeasured creative guidelines. Burned-in captions are a SpecSmith-owned accessibility requirement because their rendered output can be inspected locally.",
  };
}

function deriveAccessibility(snapshot: PlatformSnapshot): readonly AccessibilityRequirement[] {
  const requirements: AccessibilityRequirement[] = [
    { code: "audio-independent-comprehension", requirement: "The content must be comprehensible with audio off; every spoken claim has an on-screen equivalent.", negotiable: false },
    { code: "no-colour-only-information", requirement: "No result may be conveyed by colour alone; also state it in text or position.", negotiable: false },
    { code: "adequate-information-duration", requirement: "Any figure a viewer must read stays on screen long enough to read comfortably.", negotiable: false },
    { code: "terminology-explained", requirement: "Terminology the audience cannot be assumed to know is explained on first use.", negotiable: false },
  ];
  if (snapshot.capability.media.safeAreaTopFraction.status === "unknown" || snapshot.capability.media.safeAreaBottomFraction.status === "unknown") {
    requirements.push({
      code: "conservative-safe-area",
      requirement: "Platform UI safe areas are unmeasured, so critical text stays clear of outer edges rather than relying on guessed boundaries.",
      negotiable: false,
    });
  }
  return requirements;
}

function deriveCta(mission: ContentMission, audienceFit: AudienceFit, snapshot: PlatformSnapshot): CtaGuidance {
  if (mission.productRoute === null) {
    return { include: false, treatment: "none", reason: "MASTER #3 attached no shipped product route, so no route CTA is permitted." };
  }
  if (!audienceFit.ctaAppropriate) {
    return { include: false, treatment: "none", reason: audienceFit.ctaReason };
  }

  const link = snapshot.capability.interaction.outboundLinkInDescription;
  const profile = snapshot.capability.interaction.profileLinkAvailable;
  let treatment: string;
  if (hasUsableValue(link) && link.value === true) {
    treatment = `Name the tool and place ${mission.productRoute} in the description; this snapshot establishes description-link clickability.`;
  } else if (hasUsableValue(link) && link.value === false && hasUsableValue(profile) && profile.value === true) {
    treatment = `Name the tool and use the verified profile-link surface for ${mission.productRoute}; do not claim caption links are clickable.`;
  } else {
    treatment =
      `Name the tool and show ${mission.productRoute} on screen. Do not claim the description is clickable or that a profile-link surface exists until either capability is verified.`;
  }

  return {
    include: true,
    treatment,
    reason:
      `${mission.ctaIntent} This is an offer, not manufactured urgency; unknown platform link behaviour remains unknown.`,
  };
}

function deriveHookConstraints(invariant: TruthInvariant, profile: AudienceProfile): readonly string[] {
  const constraints: string[] = [
    "The hook's factual premise must be a permitted claim stated at the strength research approved.",
    "No manufactured urgency, engagement bait, or unanswered question.",
  ];
  if (invariant.estimatedClaimIds.length > 0) {
    constraints.push("If the hook states an estimated figure, its estimate status and required configuration stay in the hook itself.");
  }
  const misconceptions = profile.confusion.evidencedMisconceptions.value ?? [];
  constraints.push(
    misconceptions.length === 0
      ? "No misconception-correction hook: no misconception-exists claim is evidenced."
      : `A misconception-correction hook is permitted only for: ${misconceptions.join("; ")}.`,
  );
  return constraints;
}

function deriveVisualDensity(audienceFit: AudienceFit): string {
  switch (audienceFit.explanationDepth) {
    case "extensive": return "Low density: one idea per beat while terminology is being decoded.";
    case "layered": return "Medium density with one clear primary element and subordinate supporting detail.";
    case "minimal": return "Higher density is acceptable as a creative hypothesis; do not sacrifice legibility.";
    default: return "Medium density: one primary element per beat with subordinate supporting detail.";
  }
}

function derivePlatformRisks(snapshot: PlatformSnapshot, invariant: TruthInvariant): readonly string[] {
  const risks: string[] = [];
  if (snapshot.capability.media.safeAreaTopFraction.status === "unknown" || snapshot.capability.media.safeAreaBottomFraction.status === "unknown") {
    risks.push("Safe areas are unmeasured; critical text near an edge could be obscured by platform UI.");
  }
  if (snapshot.capability.interaction.outboundLinkInDescription.status === "unknown") {
    risks.push("Outbound-link clickability is unknown; do not design the CTA around an assumed clickable description.");
  } else if (snapshot.capability.interaction.outboundLinkInDescription.value === false) {
    risks.push("This snapshot establishes that description/caption links are not clickable; use only a separately verified route surface.");
  }
  if (invariant.estimatedClaimIds.length > 0) {
    risks.push("Estimated figures must keep their estimate label and configuration visually attached to the figure.");
  }
  if (snapshot.capability.analytics.availableMetrics.status === "unknown") {
    risks.push("Analytics metric availability is unknown; do not promise that a specific post-publication metric will be measurable.");
  }
  return risks;
}
