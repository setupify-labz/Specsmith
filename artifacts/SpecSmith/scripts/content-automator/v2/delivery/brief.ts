// MASTER #4 — PLATFORM_CREATIVE_BRIEF (sections 14, 16, 21, 22, 43).
//
// Platform adaptation may package a mission differently, but it may not invent
// a capability when the platform snapshot says unknown. Any platform-specific
// difference carries the exact fact(s) that authorized it.

import type { ContentMission } from "../strategy/contentMission.ts";
import type { SafeClaim } from "../research/creativeContract.ts";
import type { AudienceProfile } from "../audience/model.ts";
import type { AudienceHypothesis } from "../audience/hypotheses.ts";
import { statusIsUsable, type Capability, type PlatformFact, type PlatformId, type PlatformSnapshot, type PlatformTag } from "../platform/model.ts";
import { usableFacts } from "../platform/ingestion.ts";
import type { AudiencePlatformFit } from "./fit.ts";
import { assertTruthPreserved, type InvariantFinding, type TruthInvariant } from "./invariants.ts";

export type AdaptationDimension = "metadata.title" | "metadata.description" | "execution.cta" | "execution.duration";

export interface PlatformAdaptationEvidence {
  readonly dimension: AdaptationDimension;
  readonly factId: string;
  readonly platform: PlatformId;
  readonly claim: string;
  readonly source: string;
  readonly capturedAt: string;
}

export interface PlatformMetadata {
  readonly title: string | null;
  readonly description: string;
  readonly tags: readonly PlatformTag[];
  readonly utmSource: string;
  readonly creativeId: string;
  readonly experimentId: string | null;
}

export interface PlatformExecutionGuidance {
  readonly openingRequirements: readonly string[];
  readonly pacing: AudiencePlatformFit["pacing"];
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
  readonly missionId: string;
  readonly researchQuestionId: string;
  readonly strategyRunId: string;
  readonly audienceProfileId: string;
  readonly audienceProfileRevision: number;
  readonly platformSnapshotId: string;
  readonly platformSnapshotRevision: number;
  readonly objective: ContentMission["primaryObjective"];
  readonly thesis: string;
  readonly allowedClaims: readonly SafeClaim[];
  readonly forbiddenClaims: readonly { readonly proposition: string; readonly reason: string }[];
  readonly requiredWording: readonly string[];
  readonly requiredDisclosures: readonly string[];
  readonly audienceProblem: string;
  readonly audienceKnowledgeAssumptions: readonly string[];
  readonly audienceCannotAssume: readonly string[];
  readonly likelyConfusion: readonly string[];
  readonly explanationDepth: AudiencePlatformFit["explanationDepth"];
  readonly terminologyGuidance: readonly string[];
  readonly trustRequirements: readonly string[];
  readonly execution: PlatformExecutionGuidance;
  readonly hookConstraints: readonly string[];
  readonly metadata: PlatformMetadata;
  /** Exact usable platform facts that caused platform-specific output choices. */
  readonly adaptationEvidence: readonly PlatformAdaptationEvidence[];
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

function evidencedFact<T>(
  capability: Capability<T>,
  snapshot: PlatformSnapshot,
  now: Date,
): PlatformFact | null {
  if (capability.value === null || capability.factId === null) return null;
  if (!statusIsUsable(capability.status) || capability.status === "hypothesis") return null;
  const fact = usableFacts(snapshot, now).find((candidate) => candidate.factId === capability.factId);
  if (fact === undefined || fact.platform !== snapshot.platform) return null;
  return fact;
}

function evidencedValue<T>(
  capability: Capability<T>,
  snapshot: PlatformSnapshot,
  now: Date,
): T | null {
  return evidencedFact(capability, snapshot, now) === null ? null : capability.value;
}

function evidenceEntry(
  dimension: AdaptationDimension,
  fact: PlatformFact | null,
): PlatformAdaptationEvidence | null {
  if (fact === null) return null;
  return {
    dimension,
    factId: fact.factId,
    platform: fact.platform,
    claim: fact.claim,
    source: fact.source,
    capturedAt: fact.capturedAt,
  };
}

export function buildPlatformBrief(input: BriefInput): PlatformCreativeBrief {
  const { mission, invariant, profile, fit, snapshot, now } = input;
  if (fit.verdict === "refuse") {
    throw new BriefRefusedError(
      "platform-refused",
      `No brief may be built for ${fit.platform}: ${fit.refusals.map((r) => `${r.code} — ${r.explanation}`).join(" ")}`,
    );
  }

  const metadata = buildMetadata(input);
  const execution = buildExecution(input);
  const adaptationEvidence = buildAdaptationEvidence(input);
  const metadataFindings = assertTruthPreserved(invariant, [
    { location: `${fit.platform}:metadata.title`, text: metadata.title ?? "" },
    { location: `${fit.platform}:metadata.description`, text: metadata.description },
    { location: `${fit.platform}:metadata.tags`, text: metadata.tags.map((tag) => tag.tag).join(" ") },
  ]);
  const blocking = metadataFindings.filter((finding) => finding.severity === "hard-fail");
  if (blocking.length > 0) {
    throw new BriefRefusedError(
      "metadata-violates-evidence",
      `Metadata for ${fit.platform} breaches the evidence boundary: ${blocking.map((f) => `${f.code} — ${f.message}`).join(" | ")}`,
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
    allowedClaims: mission.permittedClaims,
    forbiddenClaims: mission.forbiddenClaims,
    requiredWording: invariant.requiredWording,
    requiredDisclosures: invariant.requiredDisclosures,
    audienceProblem: mission.audienceProblem,
    audienceKnowledgeAssumptions: profile.knowledge.likelyUnderstood.value ?? [],
    audienceCannotAssume: profile.knowledge.cannotAssume.value ?? [],
    likelyConfusion: fit.conflicts.map((conflict) => conflict.tension),
    explanationDepth: fit.explanationDepth,
    terminologyGuidance: fit.terminologyPolicy,
    trustRequirements: (profile.trustRequirements.value ?? []).map(String),
    execution,
    hookConstraints: fit.hookConstraints,
    metadata,
    adaptationEvidence,
    uncertainty: {
      audienceHypotheses: input.hypotheses.map((h) => ({ id: h.hypothesisId, proposition: h.proposition, status: h.status })),
      platformHypotheses: snapshot.facts.filter((fact) => fact.status === "hypothesis").map((fact) => `${fact.factId}: ${fact.claim}`),
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
  const { fit, snapshot, invariant, now } = input;
  const maxCapability = snapshot.capability.media.maxDurationSeconds;
  const maxDuration = evidencedValue(maxCapability, snapshot, now);
  const minimumUseful = Math.max(8, Math.ceil(fit.pacing.timeToFirstUsefulInformationSeconds * 4));
  const durationRange: readonly [number, number] | null =
    maxDuration !== null && maxDuration >= minimumUseful ? [minimumUseful, maxDuration] : null;

  const openingRequirements: string[] = [
    `Deliver something useful within ${fit.pacing.timeToFirstUsefulInformationSeconds}s; setup may not exceed ${fit.pacing.maxSetupSeconds}s.`,
    "The opening's factual premise must be a permitted claim, stated at the strength research approved.",
  ];
  if (invariant.estimatedClaimIds.length > 0) {
    openingRequirements.push("If an estimated figure appears in the opening, its estimate status and required configuration appear with it.");
  }

  return {
    openingRequirements,
    pacing: fit.pacing,
    targetDurationSecondsRange: durationRange,
    targetDurationBasis:
      maxDuration === null
        ? "No source-bound platform maximum is established, so no platform-derived duration range is asserted. Pacing remains a creative hypothesis, not a platform fact."
        : `The upper bound is the source-bound ${maxDuration}s platform maximum in this snapshot. It is a constraint, not a performance optimum.`,
    visualHierarchy: [
      fit.visualDensityGuidance,
      "The claim under discussion is the primary element in every beat that states it.",
      "Supporting detail stays subordinate to the claim.",
    ],
    captionStrategy: fit.captions,
    safeZoneRequirements:
      snapshot.capability.media.safeAreaTopFraction.status === "unknown" || snapshot.capability.media.safeAreaBottomFraction.status === "unknown"
        ? [
            "Platform UI safe areas are unmeasured. Keep critical text clear of outer edges instead of relying on guessed boundaries.",
            "Do not place a figure or caveat where platform chrome could plausibly cover it.",
          ]
        : ["Respect the established safe areas recorded in the platform snapshot."],
    ctaTreatment: fit.cta,
    accessibility: fit.accessibility,
    platformLimitations: fit.platformRisks,
  };
}

function buildMetadata(input: BriefInput): PlatformMetadata {
  const { mission, invariant, snapshot, fit, now } = input;
  const titleMax = evidencedValue(snapshot.capability.text.titleMaxChars, snapshot, now);
  const title = titleMax === null ? null : truncateAtWord(mission.centralQuestion, titleMax);

  const parts: string[] = [mission.viewerShouldUnderstand];
  if (invariant.requiredWording.length > 0) {
    parts.push(`Every figure here is ${invariant.requiredWording.join(", ")}.`);
  }
  if (fit.cta.include && mission.productRoute !== null) {
    parts.push(`${mission.ctaIntent} ${mission.productRoute}`);
  }
  const rawDescription = parts.join(" ");
  const descriptionMax = evidencedValue(snapshot.capability.text.descriptionMaxChars, snapshot, now);
  const description = descriptionMax === null ? rawDescription : truncateAtWord(rawDescription, descriptionMax);

  return {
    title,
    description,
    tags: buildTags(input),
    utmSource: `specsmith-${fit.platform}`,
    creativeId: input.creativeId,
    experimentId: input.experimentId ?? null,
  };
}

function buildAdaptationEvidence(input: BriefInput): readonly PlatformAdaptationEvidence[] {
  const { snapshot, now } = input;
  const entries: (PlatformAdaptationEvidence | null)[] = [
    evidenceEntry("metadata.title", evidencedFact(snapshot.capability.text.titleMaxChars, snapshot, now)),
    evidenceEntry("metadata.description", evidencedFact(snapshot.capability.text.descriptionMaxChars, snapshot, now)),
    evidenceEntry("execution.duration", evidencedFact(snapshot.capability.media.maxDurationSeconds, snapshot, now)),
    evidenceEntry("execution.cta", evidencedFact(snapshot.capability.interaction.outboundLinkInDescription, snapshot, now)),
    evidenceEntry("execution.cta", evidencedFact(snapshot.capability.interaction.profileLinkAvailable, snapshot, now)),
  ];
  return entries.filter((entry): entry is PlatformAdaptationEvidence => entry !== null)
    .sort((a, b) => `${a.dimension}:${a.factId}`.localeCompare(`${b.dimension}:${b.factId}`));
}

export const TAG_CAP_BASIS =
  "A conservative anti-spam production cap, not a measured optimum. No popularity, reach or trend claim is attached to these descriptive tags.";
const TAG_CAP = 5;

function buildTags(input: BriefInput): readonly PlatformTag[] {
  const { mission } = input;
  const descriptive = new Set<string>(["#PCBuilding"]);
  const subject = `${mission.pillar} ${mission.audienceProblem} ${mission.centralQuestion}`.toLowerCase();
  if (subject.includes("gpu") || subject.includes("vram") || subject.includes("graphics")) descriptive.add("#GPU");
  if (subject.includes("cpu") || subject.includes("processor")) descriptive.add("#CPU");
  if (subject.includes("fps") || subject.includes("frame")) descriptive.add("#PCPerformance");
  if (subject.includes("upgrade")) descriptive.add("#PCUpgrade");
  if (subject.includes("compatib") || subject.includes("socket")) descriptive.add("#PCCompatibility");
  if (subject.includes("price") || subject.includes("budget") || subject.includes("worth")) descriptive.add("#PCValue");
  return [...descriptive].sort().slice(0, TAG_CAP).map((tag) => ({
    tag,
    kind: "generic-descriptive" as const,
    basis: `Describes the subject without asserting popularity or trend status. ${TAG_CAP_BASIS}`,
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
  if (brief.requiredWording.length > 0) lines.push(`    required wording: ${brief.requiredWording.join(" | ")}`);
  lines.push(`    explanation depth: ${brief.explanationDepth}`);
  const range = brief.execution.targetDurationSecondsRange;
  lines.push(`    duration: ${range === null ? "no source-bound platform-derived range" : `${range[0]}-${range[1]}s range`}`);
  lines.push(`    cta: ${brief.execution.ctaTreatment.include ? brief.execution.ctaTreatment.treatment : "none — " + brief.execution.ctaTreatment.reason}`);
  lines.push(`    platform adaptation evidence: ${brief.adaptationEvidence.length}`);
  lines.push(`    tags: ${brief.metadata.tags.map((tag) => `${tag.tag}(${tag.kind})`).join(" ")}`);
  lines.push(`    accessibility: ${brief.execution.accessibility.length} non-negotiable requirement(s)`);
  if (brief.uncertainty.staleInputs.length > 0) lines.push(`    stale inputs: ${brief.uncertainty.staleInputs.length}`);
  return lines.join("\n");
}

export function checkBriefMetadata(brief: PlatformCreativeBrief, invariant: TruthInvariant): readonly InvariantFinding[] {
  return assertTruthPreserved(invariant, briefOutwardText(brief));
}
