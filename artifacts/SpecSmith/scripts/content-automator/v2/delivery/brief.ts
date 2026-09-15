// MASTER #4 — PLATFORM_CREATIVE_BRIEF (sections 14, 16, 21, 22, 43).
//
// The transport-independent contract MASTER #1 receives. It carries three
// things that must never be confused:
//
//   INVARIANTS  — what may not change, whatever the platform wants.
//   AUDIENCE    — who this is for and what they need, with knowledge states.
//   EXECUTION   — how to package it here, which is advice, not truth.
//
// The brief cannot invent a claim. Every claim in it is copied by reference
// from the mission, which copied it from MASTER #2's contract. There is no code
// path in this file that constructs a new claim, and `buildPlatformBrief`
// refuses to emit a brief whose claims are not a subset of the mission's.
//
// Metadata is inside the evidence boundary (section 21). A title, a caption or
// a hashtag that asserts something the video is forbidden to say is still a
// forbidden claim — often the ONLY thing a scrolling viewer reads — so the same
// truth check runs over metadata as over script lines.

import type { ContentMission } from "../strategy/contentMission.ts";
import type { SafeClaim } from "../research/creativeContract.ts";
import type { AudienceProfile } from "../audience/model.ts";
import type { AudienceHypothesis } from "../audience/hypotheses.ts";
import type { PlatformId, PlatformSnapshot, PlatformTag } from "../platform/model.ts";
import type { AudiencePlatformFit } from "./fit.ts";
import {
  assertTruthPreserved,
  type InvariantFinding,
  type TruthInvariant,
} from "./invariants.ts";

export interface PlatformMetadata {
  readonly title: string | null;
  readonly description: string;
  readonly tags: readonly PlatformTag[];
  /** Tracking identity, reusing the existing attribution architecture. */
  readonly utmSource: string;
  readonly creativeId: string;
  readonly experimentId: string | null;
}

export interface PlatformExecutionGuidance {
  readonly openingRequirements: readonly string[];
  readonly pacing: AudiencePlatformFit["pacing"];
  /** A RANGE, and only when a duration constraint is actually established. */
  readonly targetDurationSecondsRange: readonly [number, number] | null;
  readonly targetDurationBasis: string;
  readonly visualHierarchy: readonly string[];
  readonly captionStrategy: AudiencePlatformFit["captions"];
  readonly safeZoneRequirements: readonly string[];
  readonly ctaTreatment: AudiencePlatformFit["cta"];
  readonly accessibility: AudiencePlatformFit["accessibility"];
  readonly platformLimitations: readonly string[];
}

export interface BriefUncertainty {
  readonly audienceHypotheses: readonly { readonly id: string; readonly proposition: string; readonly status: string }[];
  readonly platformHypotheses: readonly string[];
  readonly unknowns: readonly string[];
  readonly staleInputs: readonly string[];
  readonly missingSignals: readonly string[];
}

export interface PlatformCreativeBrief {
  readonly version: "platform-creative-brief-v1";
  readonly briefId: string;
  readonly platform: PlatformId;
  readonly createdAt: string;

  // Identity, so an auditor can reconstruct every input (section 43).
  readonly missionId: string;
  readonly researchQuestionId: string;
  readonly strategyRunId: string;
  readonly audienceProfileId: string;
  readonly audienceProfileRevision: number;
  readonly platformSnapshotId: string;
  readonly platformSnapshotRevision: number;

  // INVARIANTS.
  readonly objective: ContentMission["primaryObjective"];
  readonly thesis: string;
  readonly allowedClaims: readonly SafeClaim[];
  readonly forbiddenClaims: readonly { readonly proposition: string; readonly reason: string }[];
  readonly requiredWording: readonly string[];
  readonly requiredDisclosures: readonly string[];

  // AUDIENCE.
  readonly audienceProblem: string;
  readonly audienceKnowledgeAssumptions: readonly string[];
  readonly audienceCannotAssume: readonly string[];
  readonly likelyConfusion: readonly string[];
  readonly explanationDepth: AudiencePlatformFit["explanationDepth"];
  readonly terminologyGuidance: readonly string[];
  readonly trustRequirements: readonly string[];

  // EXECUTION.
  readonly execution: PlatformExecutionGuidance;
  readonly hookConstraints: readonly string[];
  readonly metadata: PlatformMetadata;

  // UNCERTAINTY.
  readonly uncertainty: BriefUncertainty;
  readonly provenance: { readonly synthetic: boolean; readonly producedBy: string; readonly producedAt: string };
}

export class BriefRefusedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BriefRefusedError";
    this.code = code;
  }
}

export interface BriefInput {
  readonly mission: ContentMission;
  readonly invariant: TruthInvariant;
  readonly profile: AudienceProfile;
  readonly fit: AudiencePlatformFit;
  readonly snapshot: PlatformSnapshot;
  readonly hypotheses: readonly AudienceHypothesis[];
  readonly strategyRunId: string;
  readonly creativeId: string;
  readonly experimentId?: string | null;
  readonly now: Date;
  readonly producedBy: string;
}

/**
 * Build the brief for one platform.
 *
 * Refuses rather than degrading. A refused platform is a correct outcome
 * (section 26) and the caller records it as such instead of forcing a version
 * that cannot carry the evidence.
 */
export function buildPlatformBrief(input: BriefInput): PlatformCreativeBrief {
  const { mission, invariant, profile, fit, snapshot, now } = input;

  if (fit.verdict === "refuse") {
    throw new BriefRefusedError(
      "platform-refused",
      `No brief may be built for ${fit.platform}: ${fit.refusals.map((r) => `${r.code} — ${r.explanation}`).join(" ")} ` +
        "Refusing a platform is a successful outcome, not a gap to fill.",
    );
  }

  const metadata = buildMetadata(input);

  // The brief's own metadata goes through the truth gate before the brief
  // exists. A brief that would ship a forbidden claim in its caption is not
  // emitted at all.
  const metadataFindings = assertTruthPreserved(invariant, [
    { location: `${fit.platform}:metadata.title`, text: metadata.title ?? "" },
    { location: `${fit.platform}:metadata.description`, text: metadata.description },
    { location: `${fit.platform}:metadata.tags`, text: metadata.tags.map((tag) => tag.tag).join(" ") },
  ]);
  const blocking = metadataFindings.filter((finding) => finding.severity === "hard-fail");
  if (blocking.length > 0) {
    throw new BriefRefusedError(
      "metadata-violates-evidence",
      `Metadata for ${fit.platform} would breach the evidence boundary: ` +
        blocking.map((finding) => `${finding.code} — ${finding.message}`).join(" | "),
    );
  }

  return {
    version: "platform-creative-brief-v1",
    briefId: `brief-${mission.missionId}-${fit.platform}`,
    platform: fit.platform,
    createdAt: now.toISOString(),

    missionId: mission.missionId,
    researchQuestionId: invariant.researchQuestionId,
    strategyRunId: input.strategyRunId,
    audienceProfileId: profile.profileId,
    audienceProfileRevision: profile.revision,
    platformSnapshotId: snapshot.snapshotId,
    platformSnapshotRevision: snapshot.revision,

    objective: mission.primaryObjective,
    thesis: mission.angle.thesis,
    // By reference, not reconstruction. This is what makes the claims
    // structurally identical across every platform brief.
    allowedClaims: mission.permittedClaims,
    forbiddenClaims: mission.forbiddenClaims,
    requiredWording: invariant.requiredWording,
    requiredDisclosures: invariant.requiredDisclosures,

    audienceProblem: mission.audienceProblem,
    audienceKnowledgeAssumptions: profile.knowledge.likelyUnderstood.value ?? [],
    audienceCannotAssume: profile.knowledge.cannotAssume.value ?? [],
    likelyConfusion: fit.conflicts.length > 0 ? fit.conflicts.map((c) => c.tension) : [],
    explanationDepth: fit.explanationDepth,
    terminologyGuidance: fit.terminologyPolicy,
    trustRequirements: (profile.trustRequirements.value ?? []).map(String),

    execution: buildExecution(input),
    hookConstraints: fit.hookConstraints,
    metadata,

    uncertainty: {
      audienceHypotheses: input.hypotheses.map((h) => ({ id: h.hypothesisId, proposition: h.proposition, status: h.status })),
      platformHypotheses: snapshot.facts
        .filter((fact) => fact.status === "hypothesis")
        .map((fact) => `${fact.factId}: ${fact.claim}`),
      unknowns: fit.unresolvedAssumptions,
      staleInputs: fit.staleInputs,
      missingSignals: profile.limitations,
    },
    provenance: {
      synthetic: profile.provenance.synthetic || snapshot.provenance.synthetic,
      producedBy: input.producedBy,
      producedAt: now.toISOString(),
    },
  };
}

function buildExecution(input: BriefInput): PlatformExecutionGuidance {
  const { fit, snapshot, invariant } = input;
  const capability = snapshot.capability;

  const maxDuration = capability.media.maxDurationSeconds.value;
  const durationRange: readonly [number, number] | null =
    maxDuration === null
      ? null
      : [Math.max(8, Math.ceil(fit.pacing.timeToFirstUsefulInformationSeconds * 4)), maxDuration];

  const openingRequirements: string[] = [
    `Deliver something useful within ${fit.pacing.timeToFirstUsefulInformationSeconds}s; setup may not exceed ${fit.pacing.maxSetupSeconds}s.`,
    "The opening's factual premise must be a permitted claim, stated at the strength research approved.",
  ];
  if (invariant.estimatedClaimIds.length > 0) {
    openingRequirements.push(
      "If a figure appears in the opening, the word 'estimated' (or equivalent) appears with it, on screen and in speech.",
    );
  }

  return {
    openingRequirements,
    pacing: fit.pacing,
    targetDurationSecondsRange: durationRange,
    targetDurationBasis:
      maxDuration === null
        ? "No duration constraint is established for this platform, so no target is stated. Inventing one would be folklore."
        : `Lower bound is the time this content needs to be comprehensible at the required explanation depth; upper bound is the ` +
          `conservative ${maxDuration}s floor the registry can actually defend. This is a range, not an optimum: no duration here has been measured against performance.`,
    visualHierarchy: [
      fit.visualDensityGuidance,
      "The claim under discussion is the primary element in every beat that states it.",
      "Supporting detail is subordinate in size and position, never competing with the claim.",
    ],
    captionStrategy: fit.captions,
    safeZoneRequirements:
      capability.media.safeAreaTopFraction.status === "unknown"
        ? [
            "Platform UI safe areas are unmeasured. Keep all text clear of the outer edges rather than placing it against a guessed boundary.",
            "Do not place a figure or caveat where platform chrome could cover it.",
          ]
        : ["Respect the measured safe areas recorded in the platform snapshot."],
    ctaTreatment: fit.cta,
    accessibility: fit.accessibility,
    platformLimitations: fit.platformRisks,
  };
}

// ---------------------------------------------------------------------------
// Metadata and hashtags (sections 21, 22)
// ---------------------------------------------------------------------------

/**
 * Build metadata that cannot outrun the evidence.
 *
 * The description is assembled from the mission's own approved material and the
 * required disclosures — never from a generated summary that might sharpen a
 * claim to fit a character limit.
 */
function buildMetadata(input: BriefInput): PlatformMetadata {
  const { mission, invariant, snapshot, fit } = input;
  const capability = snapshot.capability;

  const titleMax = capability.text.titleMaxChars.value;
  const title = titleMax === null ? null : truncateAtWord(mission.centralQuestion, titleMax);

  const descriptionMax = capability.text.descriptionMaxChars.value ?? 2200;
  const parts: string[] = [mission.viewerShouldUnderstand];

  // The caveat is built from the required WORDING, not from the required
  // DISCLOSURES. The disclosures are instructions addressed to whoever writes
  // the creative ("state that the figures are estimates..."); pasting an
  // instruction into a public caption would both read as nonsense and, because
  // it names the claim without carrying its wording, fail the truth gate that
  // runs over this very description.
  if (invariant.requiredWording.length > 0) {
    parts.push(`Every figure here is ${invariant.requiredWording.join(", ")}.`);
  }

  // The caveat goes BEFORE the CTA: if the platform truncates the description,
  // what is lost is the marketing, never the qualification.
  if (fit.cta.include && mission.productRoute !== null) {
    parts.push(`${mission.ctaIntent} ${mission.productRoute}`);
  }
  const description = truncateAtWord(parts.join(" "), descriptionMax);

  return {
    title,
    description,
    tags: buildTags(input),
    utmSource: `specsmith-${fit.platform}`,
    creativeId: input.creativeId,
    experimentId: input.experimentId ?? null,
  };
}

/**
 * Tags, with their provenance attached (section 22).
 *
 * Every tag this repository can produce today is `generic-descriptive`: it
 * plainly describes the content and therefore claims nothing that needs
 * evidence. No tag is marked `observed` because no platform tag collector
 * exists, and popularity, reach and trend status are never asserted.
 *
 * There is also no "optimal number" of tags. The cap below exists to stay
 * short of spam, and it is labelled as the judgment it is rather than as a
 * measured optimum.
 */
export const TAG_CAP_BASIS =
  "A conservative cap chosen to avoid tag-spam, not a measured optimum. No evidence establishes an optimal tag count, " +
  "and none is claimed.";

const TAG_CAP = 5;

function buildTags(input: BriefInput): readonly PlatformTag[] {
  const { mission } = input;

  const descriptive = new Set<string>();
  descriptive.add("#PCBuilding");

  const subject = `${mission.pillar} ${mission.audienceProblem} ${mission.centralQuestion}`.toLowerCase();
  if (subject.includes("gpu") || subject.includes("vram") || subject.includes("graphics")) descriptive.add("#GPU");
  if (subject.includes("cpu") || subject.includes("processor")) descriptive.add("#CPU");
  if (subject.includes("fps") || subject.includes("frame")) descriptive.add("#PCPerformance");
  if (subject.includes("upgrade")) descriptive.add("#PCUpgrade");
  if (subject.includes("compatib") || subject.includes("socket")) descriptive.add("#PCCompatibility");
  if (subject.includes("price") || subject.includes("budget") || subject.includes("worth")) descriptive.add("#PCValue");

  return [...descriptive]
    .sort()
    .slice(0, TAG_CAP)
    .map((tag) => ({
      tag,
      kind: "generic-descriptive" as const,
      basis:
        `Plainly describes the subject of this content, so it asserts nothing requiring evidence. ` +
        `No popularity, reach or trend status is claimed for it. ${TAG_CAP_BASIS}`,
      factId: null,
    }));
}

function truncateAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Every piece of outward-facing copy this brief would produce.
 *
 * Used by the closed loop to run the truth gate across the whole surface — the
 * point being that "the script is clean" is not the same as "what ships is
 * clean" when a caption is also shipping.
 */
export function briefOutwardText(brief: PlatformCreativeBrief): readonly { readonly location: string; readonly text: string }[] {
  return [
    { location: `${brief.platform}:metadata.title`, text: brief.metadata.title ?? "" },
    { location: `${brief.platform}:metadata.description`, text: brief.metadata.description },
    { location: `${brief.platform}:metadata.tags`, text: brief.metadata.tags.map((tag) => tag.tag).join(" ") },
    { location: `${brief.platform}:execution.cta`, text: brief.execution.ctaTreatment.treatment },
  ];
}

export function formatPlatformBrief(brief: PlatformCreativeBrief): string {
  const lines: string[] = [];
  lines.push(`  ${brief.platform} — ${brief.briefId}`);
  lines.push(`    objective: ${brief.objective}`);
  lines.push(`    thesis: ${brief.thesis}`);
  lines.push(`    claims permitted: ${brief.allowedClaims.length}, forbidden: ${brief.forbiddenClaims.length}`);
  if (brief.requiredWording.length > 0) {
    lines.push(`    required wording: ${brief.requiredWording.join(" | ")}`);
  }
  lines.push(`    explanation depth: ${brief.explanationDepth}`);
  const range = brief.execution.targetDurationSecondsRange;
  lines.push(`    duration: ${range === null ? "unconstrained (no established limit)" : `${range[0]}-${range[1]}s range`}`);
  lines.push(`    cta: ${brief.execution.ctaTreatment.include ? brief.execution.ctaTreatment.treatment : "none — " + brief.execution.ctaTreatment.reason}`);
  lines.push(`    tags: ${brief.metadata.tags.map((tag) => `${tag.tag}(${tag.kind})`).join(" ")}`);
  lines.push(`    accessibility: ${brief.execution.accessibility.length} non-negotiable requirement(s)`);
  if (brief.uncertainty.staleInputs.length > 0) {
    lines.push(`    stale inputs: ${brief.uncertainty.staleInputs.length}`);
  }
  return lines.join("\n");
}

/** Convenience for callers that want the gate result rather than an exception. */
export function checkBriefMetadata(brief: PlatformCreativeBrief, invariant: TruthInvariant): readonly InvariantFinding[] {
  return assertTruthPreserved(invariant, briefOutwardText(brief));
}
