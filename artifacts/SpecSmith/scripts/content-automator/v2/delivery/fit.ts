// MASTER #4 — Audience × Platform fit (sections 11, 17, 18, 19, 20, 25, 26).
//
// Given a mission, an audience snapshot and a platform snapshot, decide whether
// this platform can carry this truth to this audience honestly — and if it
// cannot, say so and refuse.
//
// There is no score. A number like "platform fit = 87" is unarguable and
// unexplainable, and it hides the one thing a reviewer needs: WHICH constraint
// is binding and WHY. The verdict is a small ordinal with named reasons, and
// `refuse` is reachable.
//
// The conflict rules below (section 25) are the substance of this file. When an
// audience needs depth the format cannot hold, there are honest moves —
// restructure, layer, change format, change platform, refuse — and exactly one
// dishonest one: drop the evidence. That move is not implementable here.

import type { ContentMission } from "../strategy/contentMission.ts";
import type { AudienceFit } from "../audience/profile.ts";
import type { AudienceProfile } from "../audience/model.ts";
import {
  statusIsUsable,
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

/** Guidance that is a recommendation, not a measured optimum. */
export interface PacingGuidance {
  readonly timeToFirstUsefulInformationSeconds: number;
  readonly maxSetupSeconds: number;
  readonly maxBeatSeconds: number;
  readonly visualChangeEverySeconds: number;
  /** Always true here: none of this is measured. MASTER #5 may change that. */
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
  /** Accessibility requirements are never negotiable against engagement. */
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

/**
 * Roughly how long the required caveats take to deliver.
 *
 * Deliberately crude and deliberately explicit: at a comfortable narration pace
 * of about 2.5 words per second, this is how much of a short video the honesty
 * costs. Knowing that number is what makes the "evidence does not fit" conflict
 * detectable instead of a vague worry.
 */
const WORDS_PER_SECOND = 2.5;

export function requiredHonestySeconds(invariant: TruthInvariant): number {
  const words = invariant.requiredWording.join(" ").trim().split(/\s+/).filter((word) => word !== "").length;
  const disclosureWords = invariant.requiredDisclosures.join(" ").trim().split(/\s+/).filter((word) => word !== "").length;
  return (words + disclosureWords) / WORDS_PER_SECOND;
}

/**
 * Decide the fit.
 *
 * Refusals are evaluated first and they are absolute: no amount of good fit on
 * other dimensions makes a platform usable when the required disclosure cannot
 * be communicated on it.
 */
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

  // --- Refusal 1: the platform cannot carry the media at all. -------------
  if (capability.media.orientation.value !== "vertical") {
    refusals.push({
      code: "media-incompatible",
      explanation: `${snapshot.platform} is not established as accepting vertical video, which is the only format SpecSmith renders.`,
    });
  }

  // --- Refusal 2: honesty does not fit in the available time. -------------
  const honestySeconds = requiredHonestySeconds(invariant);
  const maxDuration = capability.media.maxDurationSeconds.value;
  if (maxDuration !== null && honestySeconds > maxDuration * 0.5) {
    refusals.push({
      code: "evidence-cannot-fit-honestly",
      explanation:
        `Delivering the required wording and disclosures takes about ${honestySeconds.toFixed(1)}s, more than half of the ` +
        `${maxDuration}s this platform reliably accepts. There is no honest cut here: the only way to make it fit would be ` +
        "to drop a caveat, and a caveat is part of the claim. This belongs in a longer format.",
    });
  }

  // --- Refusal 3: a required disclosure has no surface to live on. --------
  const titleAvailable = capability.text.titleMaxChars.value !== null;
  const descriptionMax = capability.text.descriptionMaxChars.value;
  if (invariant.requiredDisclosures.length > 0 && descriptionMax !== null) {
    const disclosureChars = invariant.requiredDisclosures.join(" ").length;
    if (disclosureChars > descriptionMax && !titleAvailable) {
      refusals.push({
        code: "disclosure-has-no-surface",
        explanation:
          `The required disclosures need ${disclosureChars} characters and this platform's only text surface holds ${descriptionMax}. ` +
          "A disclosure that cannot be shown is not a disclosure.",
      });
    }
  }

  // --- Refusal 4: accessibility cannot be preserved. ----------------------
  const burnedInAvailable = capability.text.burnedInCaptionsAdvisable.value === true;
  if (!burnedInAvailable) {
    refusals.push({
      code: "accessibility-cannot-be-preserved",
      explanation:
        "Burned-in captions cannot be verified on this platform, and no other caption layer is under SpecSmith's control. " +
        "Audio-independent comprehension is not optional, so this platform cannot be served.",
    });
  }

  // --- Conflicts (section 25): real tensions, honestly resolved. ----------
  if (audienceFit.explanationDepth === "extensive" && maxDuration !== null && maxDuration <= 60) {
    conflicts.push({
      code: "depth-versus-duration",
      tension:
        `This audience needs extensive explanation (${(profile.knowledge.cannotAssume.value ?? []).length} terms cannot be assumed), ` +
        `but the format holds ${maxDuration}s.`,
      resolution: "layer-information",
      explanation:
        "Resolved by layering rather than cutting: the claim and its caveat stay in the spoken line, and the supporting " +
        "detail moves to on-screen text that a viewer can pause on. Nothing is removed from the evidence.",
    });
  }

  if (profile.segmentsConflict) {
    conflicts.push({
      code: "segments-cannot-share-one-creative",
      tension: profile.segmentConflictReason ?? "Two segments need different treatments.",
      resolution: "change-format",
      explanation:
        "Resolved by scoping this creative to the primary segment and recording the second as its own mission candidate. " +
        "Serving both in one cut would fail both.",
    });
  }

  if (invariant.estimatedClaimIds.length > 0) {
    conflicts.push({
      code: "estimate-label-versus-brevity",
      tension: "Every line stating an estimate must also say it is an estimate, which costs words in a format that rewards brevity.",
      resolution: "restructure",
      explanation:
        "Resolved by stating the estimator status once, early, as a framing line rather than repeating it per figure — " +
        "so the viewer holds it throughout. The label is never dropped to save time.",
    });
  }

  // --- Verdict ------------------------------------------------------------
  let verdict: FitVerdict;
  if (refusals.length > 0) {
    verdict = "refuse";
    reasons.push(`Refused for ${refusals.length} reason(s) that cannot be resolved by adaptation.`);
  } else if (facts.length === 0) {
    verdict = "unknown";
    reasons.push("No usable platform facts are available; nothing is established about what this platform can carry.");
  } else {
    const bindingFacts = facts.filter((fact) => fact.status === "stable-constraint" || fact.status === "observed-capability");
    const audienceGrounded = audienceFit.verdict === "well-grounded" || audienceFit.verdict === "logically-grounded";

    if (bindingFacts.length >= 4 && audienceGrounded && conflicts.length === 0) {
      verdict = "strong-fit";
      reasons.push(`${bindingFacts.length} binding platform constraints are established and no conflict was found.`);
    } else if (bindingFacts.length >= 3 && audienceGrounded) {
      verdict = "reasonable-fit";
      reasons.push(
        `${bindingFacts.length} binding platform constraints are established and ${conflicts.length} conflict(s) have honest resolutions.`,
      );
    } else if (audienceFit.verdict === "ungrounded") {
      verdict = "weak-fit";
      reasons.push("The mission has no audience grounding, so there is no basis for choosing between platforms.");
    } else {
      verdict = "weak-fit";
      reasons.push(`Only ${bindingFacts.length} binding platform constraint(s) are established.`);
    }
  }

  if (input.postingTime.state === "unknown") {
    reasons.push("Posting time is unknown and is not treated as a fit dimension; an unmeasured time cannot make a platform better or worse.");
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
    captions: deriveCaptions(snapshot, audienceFit),
    accessibility: deriveAccessibility(snapshot),
    cta: deriveCta(mission, audienceFit, snapshot),
    hookConstraints: deriveHookConstraints(invariant, profile),
    terminologyPolicy: audienceFit.terminologyPolicy,
    visualDensityGuidance: deriveVisualDensity(audienceFit),
    postingTime: input.postingTime,
    trend: input.trend,
    unresolvedAssumptions: [
      ...profile.unknowns.slice(0, 6),
      "No platform behaviour is modelled: how this platform ranks or distributes content is unknown and no adaptation assumes it.",
    ],
    platformRisks: derivePlatformRisks(snapshot, invariant),
    staleInputs: stale,
  };
}

/**
 * Pacing (section 17).
 *
 * Every number here is a hypothesis and says so in the type. They are derived
 * from the audience's need for explanation, not from a universal law about how
 * long a hook may be — there is no such law, and encoding one would be exactly
 * the folklore this layer refuses.
 */
function derivePacing(audienceFit: AudienceFit, profile: AudienceProfile, invariant: TruthInvariant): PacingGuidance {
  const needsDepth = audienceFit.explanationDepth === "extensive" || audienceFit.explanationDepth === "layered";
  const hasEstimates = invariant.estimatedClaimIds.length > 0;

  return {
    // An estimate label has to land before the figure, which costs a beat.
    timeToFirstUsefulInformationSeconds: hasEstimates ? 3 : 2,
    maxSetupSeconds: needsDepth ? 4 : 3,
    maxBeatSeconds: needsDepth ? 5 : 4,
    visualChangeEverySeconds: needsDepth ? 4 : 3,
    isHypothesis: true,
    basis:
      "Derived from this audience's explanation needs and from the time the required caveats take to deliver — " +
      "not from any measured optimum. Nothing here has been tested against real retention, and MASTER #5 owns that test.",
    hypothesisIds: profile.hypothesisIds,
  };
}

/**
 * Captions (section 18).
 *
 * Reading speed is a configurable guideline and is named as one. The rule that
 * is NOT a guideline: captions must be burned in, because that is the only
 * caption layer whose accuracy SpecSmith verifies.
 */
function deriveCaptions(snapshot: PlatformSnapshot, audienceFit: AudienceFit): CaptionGuidance {
  const beginnerFacing = audienceFit.explanationDepth === "extensive" || audienceFit.explanationDepth === "moderate";
  return {
    maxLines: 2,
    maxCharsPerLine: beginnerFacing ? 30 : 34,
    // At roughly 15 characters per second of comfortable reading, two lines of
    // 30 need about 4 seconds. Stated as a guideline, not a law.
    minSecondsOnScreen: beginnerFacing ? 2.5 : 2,
    mustBeBurnedIn: snapshot.capability.text.burnedInCaptionsAdvisable.value === true,
    mustNotDuplicateSpokenWordExactly: false,
    basis:
      "Line length is tightened for audiences that need explanation, because a dense caption competes with the visual it " +
      "is explaining. Reading speed is a configurable guideline rather than a universal law. Burning captions in is not a " +
      "guideline: it is the only caption layer whose accuracy we can verify.",
  };
}

/** Accessibility (section 19). Never negotiable, by type. */
function deriveAccessibility(snapshot: PlatformSnapshot): readonly AccessibilityRequirement[] {
  const requirements: AccessibilityRequirement[] = [
    {
      code: "audio-independent-comprehension",
      requirement: "The content must be comprehensible with audio off; every spoken claim has an on-screen equivalent.",
      negotiable: false,
    },
    {
      code: "no-colour-only-information",
      requirement: "No comparison or result may be conveyed by colour alone; it must also be stated in text or position.",
      negotiable: false,
    },
    {
      code: "adequate-information-duration",
      requirement: "Any figure a viewer must read stays on screen long enough to be read at a comfortable pace.",
      negotiable: false,
    },
    {
      code: "terminology-explained",
      requirement: "Terminology the audience cannot be assumed to know is explained on first use.",
      negotiable: false,
    },
  ];

  if (snapshot.capability.media.safeAreaTopFraction.status === "unknown") {
    requirements.push({
      code: "conservative-safe-area",
      requirement:
        "Platform UI safe areas are unmeasured, so text is kept clear of the outer edges rather than placed against a guessed boundary.",
      negotiable: false,
    });
  }

  return requirements;
}

/**
 * CTA (section 20).
 *
 * `no-cta` is a first-class outcome. MASTER #3's product-readiness constraint is
 * absolute here: a mission with no shipped route gets no call to action, and no
 * platform capability changes that.
 */
function deriveCta(mission: ContentMission, audienceFit: AudienceFit, snapshot: PlatformSnapshot): CtaGuidance {
  if (mission.productRoute === null) {
    return {
      include: false,
      treatment: "none",
      reason:
        "MASTER #3 attached no shipped product route to this mission, so there is nothing to send a viewer to. " +
        "Adding 'link in bio' or 'use SpecSmith' here would point at something that does not exist.",
    };
  }
  if (!audienceFit.ctaAppropriate) {
    return { include: false, treatment: "none", reason: audienceFit.ctaReason };
  }

  const linkClickable = snapshot.capability.interaction.outboundLinkInDescription.value === true;
  return {
    include: true,
    treatment: linkClickable
      ? `Name the tool and place the route ${mission.productRoute} in the description, where it is clickable.`
      : `Name the tool in speech and place the route ${mission.productRoute} on the profile, since captions here do not render clickable links.`,
    reason:
      `${mission.ctaIntent} The content stands up without this CTA (${mission.usefulWithoutCta ? "confirmed by the mission" : "not confirmed"}), ` +
      "so the CTA is an offer rather than the reason the content exists. No urgency is manufactured and no engagement bait is used.",
  };
}

/**
 * Hook constraints (section 16).
 *
 * Constraints, not a hook. Which hook FORM is best is a creative judgment that
 * belongs to MASTER #1; what a hook may never do is an evidence question and
 * belongs here.
 */
function deriveHookConstraints(invariant: TruthInvariant, profile: AudienceProfile): readonly string[] {
  const constraints: string[] = [
    "The hook's factual premise must be one of the mission's permitted claims. A hook may not introduce a claim the body then fails to support.",
    "No manufactured urgency, no engagement bait, and no question the content does not answer.",
  ];

  if (invariant.estimatedClaimIds.length > 0) {
    constraints.push(
      "If the hook states a figure from an estimated claim, the estimator status must be in the hook itself — a label arriving three seconds later does not undo the impression the figure created.",
    );
  }

  const misconceptions = profile.confusion.evidencedMisconceptions.value ?? [];
  if (misconceptions.length === 0) {
    constraints.push(
      "No misconception-correction hook: MASTER #2 approved no misconception-exists claim, so telling this audience they believe something false would be an unevidenced claim about people.",
    );
  } else {
    constraints.push(
      `A misconception-correction hook is permitted for: ${misconceptions.join("; ")} — these are evidenced as actually existing.`,
    );
  }

  return constraints;
}

function deriveVisualDensity(audienceFit: AudienceFit): string {
  switch (audienceFit.explanationDepth) {
    case "extensive":
      return "Low density: one idea per beat. This audience is decoding terminology at the same time as watching, and a second simultaneous element costs comprehension.";
    case "layered":
      return "Medium density with a clear primary element: supporting detail may be present for the advanced viewer, but never competing with the main claim for attention.";
    case "minimal":
      return "Higher density is acceptable: this audience reads the visuals fluently and setup they already know is friction.";
    default:
      return "Medium density: one primary element per beat, with supporting detail subordinate to it.";
  }
}

function derivePlatformRisks(snapshot: PlatformSnapshot, invariant: TruthInvariant): readonly string[] {
  const risks: string[] = [];

  if (snapshot.capability.media.safeAreaTopFraction.status === "unknown") {
    risks.push("Safe areas are unmeasured; text placed near an edge may be obscured by platform UI on some devices.");
  }
  if (snapshot.capability.interaction.outboundLinkInDescription.value === false) {
    risks.push("Links here are not clickable, so any route must be delivered in a way that survives being read rather than tapped.");
  }
  if (invariant.estimatedClaimIds.length > 0) {
    risks.push(
      "The content carries estimates. Short-form viewers screenshot figures without context, so the estimator label must be visually attached to the figure, not merely spoken.",
    );
  }
  if (snapshot.capability.analytics.availableMetrics.status === "unknown") {
    risks.push("No analytics are available for this platform, so nothing about this creative's performance will be measurable after publication.");
  }

  return risks;
}
