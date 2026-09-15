// MASTER #4 — Audience profile construction and audience fit (sections 5, 6, 29).
//
// The distinction this file exists to preserve:
//
//   "MASTER #3 decided to address beginners"      -> KNOWN (a decision on record)
//   "We observed beginners asking for this"       -> OBSERVED (needs a signal)
//
// Both are legitimate inputs to a creative brief. Only the second is evidence
// about people. Collapsing them is how a system starts believing its own
// strategy documents, so the mission contributes `known` intent and never
// `observed` demand.

import type { ContentMission } from "../strategy/contentMission.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import {
  buildHeld,
  unknownDemographics,
  unknownHeld,
  type AudienceIntent,
  type AudienceProfile,
  type AudienceSegment,
  type ExpertiseLevel,
  type Held,
  type JobToBeDone,
  type KnowledgeState,
  type ConfusionState,
  type NextUsefulAction,
  type ReadinessState,
  type RiskSensitivity,
  type TrustRequirement,
} from "./model.ts";
import { observedPhrases, terminologyRequiringExplanation, type ObservedPhrase } from "./language.ts";
import { signalsForDimension, type AudienceSignalBundle } from "./signals.ts";
import type { AudienceHypothesis } from "./hypotheses.ts";

export interface AudienceProfileInput {
  readonly mission: ContentMission;
  readonly contract: ResearchCreativeContract;
  readonly research: ResearchResult;
  readonly signals: AudienceSignalBundle;
  readonly hypotheses: readonly AudienceHypothesis[];
  readonly now: Date;
  readonly producedBy: string;
}

/**
 * Build the audience snapshot for a mission.
 *
 * Deterministic: `now` is an argument, nothing reads the clock, and the same
 * inputs always produce the same profile including its identity.
 */
export function buildAudienceProfile(input: AudienceProfileInput): AudienceProfile {
  const { mission, signals, now } = input;
  const phrases = observedPhrases(signals);

  const expertise = deriveExpertise(mission, signals, phrases, now);
  const job = deriveJob(mission, signals, phrases, now);
  const intent = deriveIntent(mission, signals, phrases, now);
  const readiness = deriveReadiness(signals, now);
  const riskSensitivity = deriveRiskSensitivity(mission);
  const knowledge = deriveKnowledge(mission, phrases, expertise);
  const confusion = deriveConfusion(input, phrases);
  const trustRequirements = deriveTrustRequirements(input);
  const objections = deriveObjections(signals, now);
  const nextUsefulAction = deriveNextAction(mission);

  const segments = deriveSegments({ expertise, job, intent, readiness, riskSensitivity, signals, now });
  const conflict = detectSegmentConflict(segments);

  const unknowns = collectUnknowns({
    expertise, job, intent, readiness, riskSensitivity, knowledge, confusion, objections,
  });

  const limitations = buildLimitations(signals, phrases);

  return {
    version: "audience-profile-v1",
    profileId: `audience-${mission.missionId}`,
    revision: 1,
    missionId: mission.missionId,
    createdAt: now.toISOString(),
    expertise,
    job,
    intent,
    readiness,
    riskSensitivity,
    knowledge,
    confusion,
    demographics: unknownDemographics(),
    trustRequirements,
    objections,
    nextUsefulAction,
    segments,
    segmentsConflict: conflict !== null,
    segmentConflictReason: conflict,
    hypothesisIds: input.hypotheses.map((h) => h.hypothesisId).sort(),
    unknowns,
    limitations,
    provenance: {
      synthetic: signals.provenance.synthetic,
      producedBy: input.producedBy,
      producedAt: now.toISOString(),
      signalBundleId: signals.bundleId,
    },
  };
}

// ---------------------------------------------------------------------------
// Dimension derivation
// ---------------------------------------------------------------------------

function deriveExpertise(
  mission: ContentMission,
  signals: AudienceSignalBundle,
  phrases: readonly ObservedPhrase[],
  now: Date,
): Held<ExpertiseLevel> {
  const lookup = signalsForDimension(signals, "expertise", now);
  if (lookup.state === "observed" && lookup.signals.length > 0) {
    const value = lookup.signals[0].observation as ExpertiseLevel;
    if (["beginner", "intermediate", "advanced", "mixed"].includes(value)) {
      return buildHeld<ExpertiseLevel>({
        value,
        state: "observed",
        signalIds: lookup.signals.map((s) => s.signalId),
        basis: lookup.explanation,
      });
    }
  }
  if (lookup.state === "conflicting") {
    return buildHeld<ExpertiseLevel>({
      value: "mixed",
      state: "conflicting",
      signalIds: lookup.signals.map((s) => s.signalId),
      basis: `${lookup.explanation} Treated as mixed because the disagreement is itself the finding.`,
    });
  }

  // Phrasing can support an inference when it is unanimous, and only then.
  const implied = phrases.map((p) => p.expertiseImplication).filter((level) => level !== "unknown");
  if (implied.length > 0 && new Set(implied).size === 1) {
    return buildHeld<ExpertiseLevel>({
      value: implied[0] as ExpertiseLevel,
      state: "supported-inference",
      signalIds: phrases.map((p) => p.signalId),
      basis: `Every observed phrase is worded the way a ${implied[0]} would word it. This is inferred from language, not directly observed.`,
    });
  }

  // The mission's target is a decision, not an observation about people.
  return buildHeld<ExpertiseLevel>({
    value: mission.audienceLevel === "mixed" ? "mixed" : mission.audienceLevel,
    state: "known",
    basis:
      `MASTER #3 directed this mission at a ${mission.audienceLevel} audience. That is a strategic decision on record, ` +
      "not an observation that such an audience asked for it.",
  });
}

function deriveJob(
  mission: ContentMission,
  signals: AudienceSignalBundle,
  phrases: readonly ObservedPhrase[],
  now: Date,
): Held<JobToBeDone> {
  const lookup = signalsForDimension(signals, "job", now);
  if (lookup.state === "observed" && lookup.signals.length > 0) {
    return buildHeld<JobToBeDone>({
      value: lookup.signals[0].observation as JobToBeDone,
      state: "observed",
      signalIds: lookup.signals.map((s) => s.signalId),
      basis: lookup.explanation,
    });
  }

  const jobs = phrases.map((p) => p.associatedJob).filter((job): job is JobToBeDone => job !== null);
  if (jobs.length > 0) {
    const counts = new Map<JobToBeDone, number>();
    for (const job of jobs) counts.set(job, (counts.get(job) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return buildHeld<JobToBeDone>({
      value: ranked[0][0],
      state: "supported-inference",
      signalIds: phrases.map((p) => p.signalId),
      basis: `${ranked[0][1]} of ${jobs.length} observed phrases describe this job. Inferred from how the problem is worded.`,
    });
  }

  return unknownHeld<JobToBeDone>(
    `No observed language and no job signal exist, so what the viewer is actually trying to do is unobserved. ` +
      `The mission targets the problem "${mission.audienceProblem}", which is a strategic framing rather than a witnessed task.`,
  );
}

function deriveIntent(
  mission: ContentMission,
  signals: AudienceSignalBundle,
  phrases: readonly ObservedPhrase[],
  now: Date,
): Held<AudienceIntent> {
  const lookup = signalsForDimension(signals, "intent", now);
  if (lookup.state === "observed" && lookup.signals.length > 0) {
    return buildHeld<AudienceIntent>({
      value: lookup.signals[0].observation as AudienceIntent,
      state: "observed",
      signalIds: lookup.signals.map((s) => s.signalId),
      basis: lookup.explanation,
    });
  }
  if (phrases.length > 0) {
    const counts = new Map<AudienceIntent, number>();
    for (const phrase of phrases) counts.set(phrase.normalizedIntent, (counts.get(phrase.normalizedIntent) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return buildHeld<AudienceIntent>({
      value: ranked[0][0],
      state: "supported-inference",
      signalIds: phrases.map((p) => p.signalId),
      basis: `${ranked[0][1]} of ${phrases.length} observed phrases carry this intent.`,
    });
  }
  return unknownHeld<AudienceIntent>(
    `Nothing was observed about why anyone would watch this. The mission's central question is "${mission.centralQuestion}", ` +
      "which describes what we chose to answer, not what anyone asked.",
  );
}

function deriveReadiness(signals: AudienceSignalBundle, now: Date): Held<ReadinessState> {
  const lookup = signalsForDimension(signals, "readiness", now);
  if (lookup.state === "observed" && lookup.signals.length > 0) {
    return buildHeld<ReadinessState>({
      value: lookup.signals[0].observation as ReadinessState,
      state: "observed",
      signalIds: lookup.signals.map((s) => s.signalId),
      basis: lookup.explanation,
    });
  }
  // Note: ReadinessState has its own "unknown" member, but the HELD state is
  // what matters. We do not hand back a value of "unknown" dressed as a fact.
  return unknownHeld<ReadinessState>(
    "No behavioural collector is connected, so where the viewer is in their journey is unobserved. " +
      "Guessing 'researching' because it is the most common stage would be an invention.",
  );
}

/**
 * Risk sensitivity follows from what the mission asks the viewer to do.
 *
 * This is a supported inference rather than an observation: a mission that
 * recommends a purchase carries purchase risk whether or not we have watched
 * anyone feel it.
 */
function deriveRiskSensitivity(mission: ContentMission): Held<RiskSensitivity> {
  const commercial = mission.productRoute !== null || /buy|purchase|worth it|upgrade/i.test(mission.ctaIntent);
  if (commercial) {
    return buildHeld<RiskSensitivity>({
      value: "purchase-risk",
      state: "supported-inference",
      basis:
        "The mission points the viewer toward a purchase or upgrade decision, so a wrong answer costs them money. " +
        "That follows from the mission, not from observing anyone.",
    });
  }
  if (/compatib|fit|socket/i.test(mission.audienceProblem)) {
    return buildHeld<RiskSensitivity>({
      value: "compatibility-risk",
      state: "supported-inference",
      basis: "The stated problem is about parts fitting together, where a wrong answer results in unusable hardware.",
    });
  }
  return buildHeld<RiskSensitivity>({
    value: "low-risk-educational",
    state: "supported-inference",
    basis: "The mission asks the viewer to understand something rather than to spend or commit, so being wrong costs them time only.",
  });
}

function deriveKnowledge(
  mission: ContentMission,
  phrases: readonly ObservedPhrase[],
  expertise: Held<ExpertiseLevel>,
): KnowledgeState {
  const mustExplain = terminologyRequiringExplanation(phrases);

  // What may NOT be assumed is derivable without observing anybody: if the
  // mission targets beginners, beginner-opaque terminology is unsafe by
  // construction. That is a decision consequence, hence `known`.
  const beginnerFacing = expertise.value === "beginner" || expertise.value === "mixed";
  const cannotAssume = beginnerFacing
    ? buildHeld<readonly string[]>({
        value: mustExplain.length > 0 ? mustExplain : defaultOpaqueTerms(mission),
        state: "known",
        basis:
          "The mission addresses a beginner or mixed audience, so hardware terminology cannot be assumed understood. " +
          "This follows from the mission's own audience decision.",
      })
    : unknownHeld<readonly string[]>(
        "The audience is not beginner-facing and nothing was observed about what this audience already knows.",
      );

  const likelyUnderstood = phrases.length > 0
    ? buildHeld<readonly string[]>({
        value: [...new Set(phrases.filter((p) => p.expertiseImplication === "advanced").flatMap((p) => p.terminology))].sort(),
        state: "supported-inference",
        signalIds: phrases.map((p) => p.signalId),
        basis: "Terms used fluently in observed phrasing are probably understood, though vocabulary can be borrowed without comprehension.",
      })
    : unknownHeld<readonly string[]>("No observed language exists, so what this audience already understands is unobserved.");

  return {
    likelyUnderstood,
    cannotAssume,
    prerequisiteConcepts: beginnerFacing
      ? buildHeld<readonly string[]>({
          value: prerequisitesFor(mission),
          state: "supported-inference",
          basis: "Derived from what the mission's own thesis requires the viewer to already hold in mind to follow it.",
        })
      : unknownHeld<readonly string[]>("Prerequisites were not derived for a non-beginner audience without observation."),
    terminologyFamiliarity: mustExplain.length > 0
      ? buildHeld<readonly string[]>({
          value: mustExplain,
          state: "supported-inference",
          signalIds: phrases.map((p) => p.signalId),
          basis: "Terms appearing in observed non-expert phrasing are used but not necessarily understood.",
        })
      : unknownHeld<readonly string[]>("No observed language, so terminology familiarity is unobserved."),
  };
}

function defaultOpaqueTerms(mission: ContentMission): readonly string[] {
  // Drawn from the mission's own text rather than a generic glossary, so the
  // list is about this content and not about PC building in the abstract.
  const source = `${mission.audienceProblem} ${mission.centralQuestion} ${mission.viewerShouldUnderstand}`.toLowerCase();
  const candidates = ["vram", "bottleneck", "tdp", "chipset", "socket", "ray tracing", "dlss", "fsr", "pcie", "thermal throttle"];
  return candidates.filter((term) => source.includes(term));
}

function prerequisitesFor(mission: ContentMission): readonly string[] {
  const source = `${mission.centralQuestion} ${mission.viewerShouldUnderstand}`.toLowerCase();
  const prerequisites: string[] = [];
  if (source.includes("vram") || source.includes("gpu")) prerequisites.push("what a GPU does");
  if (source.includes("fps") || source.includes("frame")) prerequisites.push("what frame rate measures");
  if (source.includes("bottleneck")) prerequisites.push("that CPU and GPU share the work of a frame");
  if (source.includes("resolution") || source.includes("1440p")) prerequisites.push("that resolution changes how much work a frame is");
  return prerequisites;
}

/**
 * Confusion, restricted to what MASTER #2 actually supports.
 *
 * A misconception may only be named when a `misconception-exists` claim was
 * approved. We do not get to assert that our audience is confused because
 * correcting a misconception is a strong hook.
 */
function deriveConfusion(input: AudienceProfileInput, phrases: readonly ObservedPhrase[]): ConfusionState {
  const safeIds = new Set(input.contract.safeClaims.map((claim) => claim.claimId));
  const misconceptionClaims = input.research.claims.filter(
    (claim) => claim.kind === "misconception-exists" && safeIds.has(claim.claimId),
  );

  const evidencedMisconceptions = misconceptionClaims.length > 0
    ? buildHeld<readonly string[]>({
        value: misconceptionClaims.map((claim) => claim.proposition).sort(),
        state: "observed",
        signalIds: misconceptionClaims.map((claim) => claim.claimId),
        basis:
          "MASTER #2 approved these as claims that the misconception EXISTS. Only an approved misconception-exists claim " +
          "licenses telling an audience they believe something false.",
      })
    : unknownHeld<readonly string[]>(
        "MASTER #2 approved no misconception-exists claim, so no misconception may be attributed to this audience. " +
          "Asserting one would be a claim about people with no evidence behind it.",
      );

  const ambiguous = [...new Set(phrases.map((p) => p.ambiguity).filter((a): a is string => a !== null))].sort();

  return {
    supportedConfusions: input.contract.openQuestions.length > 0
      ? buildHeld<readonly string[]>({
          value: input.contract.openQuestions,
          state: "supported-inference",
          basis: "Questions MASTER #2 could not resolve are questions the audience will also be left with.",
        })
      : unknownHeld<readonly string[]>("No open research questions and no observed confusion signal."),
    unresolvedQuestions: input.contract.openQuestions.length > 0
      ? buildHeld<readonly string[]>({
          value: input.contract.openQuestions,
          state: "known",
          basis: "Taken directly from the research contract's own open questions.",
        })
      : unknownHeld<readonly string[]>("The research contract recorded no open questions."),
    ambiguousTerminology: ambiguous.length > 0
      ? buildHeld<readonly string[]>({
          value: ambiguous,
          state: "supported-inference",
          signalIds: phrases.map((p) => p.signalId),
          basis: "Observed phrasing contains terms that carry more than one meaning and need resolving on screen.",
        })
      : unknownHeld<readonly string[]>("No observed language, so terminology ambiguity is unobserved."),
    evidencedMisconceptions,
  };
}

/**
 * What this audience needs before it can trust the content.
 *
 * Derived from the claims the mission is permitted to make. A claim carrying
 * required wording implies the viewer needs that caveat; an estimate implies
 * the configuration must be disclosed. These are `known` because they follow
 * from the contract rather than from any belief about people.
 */
function deriveTrustRequirements(input: AudienceProfileInput): Held<readonly TrustRequirement[]> {
  const requirements = new Set<TrustRequirement>();
  const safeIds = new Set(input.contract.safeClaims.map((claim) => claim.claimId));

  for (const claim of input.contract.safeClaims) {
    if (claim.requiredWording.length > 0) requirements.add("requires-caveat");
    if (claim.attribution !== undefined) requirements.add("requires-source-disclosure");
  }
  for (const claim of input.research.claims) {
    if (!safeIds.has(claim.claimId)) continue;
    if (claim.kind === "performance-estimated") {
      requirements.add("requires-configuration-disclosure");
      requirements.add("requires-caveat");
    }
    if (claim.kind === "performance-measured" || claim.kind === "comparison") {
      requirements.add("requires-evidence");
      requirements.add("requires-configuration-disclosure");
    }
    if (claim.kind === "recommendation") requirements.add("requires-evidence");
  }
  if (input.mission.productRoute !== null) requirements.add("requires-demonstration");

  const value = [...requirements].sort();
  if (value.length === 0) {
    return unknownHeld<readonly TrustRequirement[]>(
      "No permitted claim carries required wording, attribution, an estimate or a measurement, so no trust requirement is implied by the contract.",
    );
  }
  return buildHeld<readonly TrustRequirement[]>({
    value,
    state: "known",
    basis:
      "Derived from the claims MASTER #2 permitted: required wording implies a caveat, an estimate implies disclosing the configuration, " +
      "and an attribution implies naming the source. These follow from the contract, not from a belief about the audience.",
  });
}

function deriveObjections(signals: AudienceSignalBundle, now: Date): Held<readonly string[]> {
  const lookup = signalsForDimension(signals, "objection", now);
  if (lookup.signals.length === 0) {
    return unknownHeld<readonly string[]>(
      "No comment, feedback or support collector is connected, so no objection has been observed. " +
        "Anticipated objections belong in hypotheses, not here.",
    );
  }
  return buildHeld<readonly string[]>({
    value: lookup.signals.map((s) => s.observation).sort(),
    state: lookup.state === "observed" ? "observed" : lookup.state,
    signalIds: lookup.signals.map((s) => s.signalId),
    basis: lookup.explanation,
  });
}

/**
 * The next action that is actually useful to the viewer.
 *
 * Bound to product readiness: MASTER #3 already refused to point at a surface
 * that does not exist, and this re-derives from the mission rather than
 * re-deciding. `no-cta` is a legitimate and common answer.
 */
function deriveNextAction(mission: ContentMission): Held<NextUsefulAction> {
  if (mission.productRoute === null) {
    return buildHeld<NextUsefulAction>({
      value: "continue-learning",
      state: "known",
      basis:
        "The mission carries no shipped product route, so there is nothing to send the viewer to. " +
        "Continuing to learn is the only action that is honestly available.",
    });
  }
  const route = mission.productRoute;
  const action: NextUsefulAction =
    route.includes("compare") ? "compare"
    : route.includes("upgrade") ? "inspect-upgrade-tool"
    : route.includes("build") ? "inspect-builder"
    : route.includes("quiz") ? "test-fps-estimate"
    : "inspect-builder";
  return buildHeld<NextUsefulAction>({
    value: action,
    state: "known",
    basis: `The mission carries the shipped route ${route}, which MASTER #3 verified exists before authorising the mission.`,
  });
}

// ---------------------------------------------------------------------------
// Segments (section 5)
// ---------------------------------------------------------------------------

/**
 * Derive segments only when the inputs justify them.
 *
 * One segment is the normal answer. A second appears only when a real signal
 * shows a second population, because inventing an "advanced viewer" segment to
 * look thorough is exactly the persona behaviour this layer forbids.
 */
function deriveSegments(input: {
  readonly expertise: Held<ExpertiseLevel>;
  readonly job: Held<JobToBeDone>;
  readonly intent: Held<AudienceIntent>;
  readonly readiness: Held<ReadinessState>;
  readonly riskSensitivity: Held<RiskSensitivity>;
  readonly signals: AudienceSignalBundle;
  readonly now: Date;
}): readonly AudienceSegment[] {
  const job = input.job.value;
  const intent = input.intent.value;

  // Without a job or an intent there is nothing to segment on. Returning an
  // empty list is honest; returning a "general audience" segment is not.
  if (job === null || intent === null) return [];

  const expertise = input.expertise.value ?? "mixed";
  const readiness = input.readiness.value ?? "unknown";
  const risk = input.riskSensitivity.value ?? "unknown";

  const primary: AudienceSegment = {
    segmentId: segmentIdFor(job, intent, expertise),
    name: segmentName(job, intent, expertise),
    job,
    intent,
    expertise,
    readiness,
    riskSensitivity: risk,
    derivedFrom: `job=${input.job.state}, intent=${input.intent.state}, expertise=${input.expertise.state}`,
    state: weakestState([input.job.state, input.intent.state, input.expertise.state]),
  };

  const segments = [primary];

  // A second segment requires a signal that actually saw a second population.
  const secondary = signalsForDimension(input.signals, "segment.secondary", input.now);
  if (secondary.signals.length > 0) {
    const observed = secondary.signals[0].observation;
    segments.push({
      segmentId: `segment-observed-${observed.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      name: observed,
      job,
      intent,
      expertise: expertise === "beginner" ? "advanced" : "beginner",
      readiness,
      riskSensitivity: risk,
      derivedFrom: `Observed directly: ${secondary.explanation}`,
      state: "observed",
    });
  }

  return segments;
}

function segmentIdFor(job: JobToBeDone, intent: AudienceIntent, expertise: ExpertiseLevel): string {
  return `segment-${expertise}-${job}-${intent}`;
}

function segmentName(job: JobToBeDone, intent: AudienceIntent, expertise: ExpertiseLevel): string {
  const jobNames: Record<JobToBeDone, string> = {
    "build-first-pc": "first-build beginner",
    "choose-between-components": "comparison shopper",
    "diagnose-poor-performance": "performance troubleshooter",
    "estimate-fps": "FPS-curious gamer",
    "understand-confusing-concept": "concept learner",
    "determine-upgrade-path": "upgrade researcher",
    "avoid-compatibility-mistake": "compatibility checker",
    "optimize-existing-system": "advanced optimizer",
    "learn-without-buying": "non-buying learner",
  };
  return `${expertise} ${jobNames[job]} (${intent})`;
}

function weakestState(states: readonly import("./model.ts").AudienceKnowledgeState[]): import("./model.ts").AudienceKnowledgeState {
  const order: readonly import("./model.ts").AudienceKnowledgeState[] = [
    "unknown", "insufficient-data", "stale", "conflicting", "hypothesis", "supported-inference", "observed", "known",
  ];
  let weakest = states[0] ?? "unknown";
  for (const state of states) {
    if (order.indexOf(state) < order.indexOf(weakest)) weakest = state;
  }
  return weakest;
}

/**
 * Decide whether one creative can serve these segments at once.
 *
 * The system is explicitly allowed to say no. Two segments that need different
 * prerequisite knowledge cannot both be served by one 30-second video without
 * failing one of them, and saying so beats splitting the difference.
 */
function detectSegmentConflict(segments: readonly AudienceSegment[]): string | null {
  if (segments.length < 2) return null;

  const levels = new Set(segments.map((segment) => segment.expertise));
  if (levels.has("beginner") && levels.has("advanced")) {
    return (
      "One segment needs terminology explained and the other finds that explanation filler. " +
      "A single short-form creative cannot serve both cleanly: the beginner version loses the advanced viewer's attention, " +
      "and the advanced version loses the beginner entirely. These should be separate creatives."
    );
  }

  const intents = new Set(segments.map((segment) => segment.intent));
  if (intents.has("troubleshooting") && intents.has("purchasing-research")) {
    return (
      "One segment is trying to fix something they own and the other is deciding what to buy. " +
      "The same evidence serves opposite decisions, and one creative cannot lead to both conclusions honestly."
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Unknowns and limitations
// ---------------------------------------------------------------------------

function collectUnknowns(dimensions: {
  readonly expertise: Held<unknown>;
  readonly job: Held<unknown>;
  readonly intent: Held<unknown>;
  readonly readiness: Held<unknown>;
  readonly riskSensitivity: Held<unknown>;
  readonly knowledge: KnowledgeState;
  readonly confusion: ConfusionState;
  readonly objections: Held<unknown>;
}): readonly string[] {
  const unknowns: string[] = [];
  const check = (name: string, held: Held<unknown>) => {
    if (held.state === "unknown" || held.state === "insufficient-data" || held.state === "stale") {
      unknowns.push(`${name}: ${held.basis}`);
    }
  };
  check("expertise", dimensions.expertise);
  check("job", dimensions.job);
  check("intent", dimensions.intent);
  check("readiness", dimensions.readiness);
  check("risk sensitivity", dimensions.riskSensitivity);
  check("knowledge.likelyUnderstood", dimensions.knowledge.likelyUnderstood);
  check("knowledge.cannotAssume", dimensions.knowledge.cannotAssume);
  check("confusion.evidencedMisconceptions", dimensions.confusion.evidencedMisconceptions);
  check("objections", dimensions.objections);
  unknowns.push(
    "demographics: no demographic collector exists and no demographic dimension is strategically relevant; " +
      "age, gender, income, location and occupation remain unknown rather than being inferred.",
  );
  return unknowns;
}

function buildLimitations(signals: AudienceSignalBundle, phrases: readonly ObservedPhrase[]): readonly string[] {
  const limitations: string[] = [];
  if (signals.provenance.synthetic) {
    limitations.push("This audience profile rests on engineering fixture signals and is not a production audience finding.");
  }
  if (signals.signals.length === 0) {
    limitations.push(
      "No audience collector is connected. Every audience dimension is either derived from the mission itself or unknown; " +
        "nothing here is an observation of real people.",
    );
  }
  if (phrases.length === 0) {
    limitations.push("No observed user language exists, so the audience's own words could not inform any phrasing decision.");
  }
  if (signals.unavailableFamilies.length > 0) {
    limitations.push(`${signals.unavailableFamilies.length} audience source families have no collector configured.`);
  }
  return limitations;
}

// ---------------------------------------------------------------------------
// Audience fit (section 6)
// ---------------------------------------------------------------------------

export type AudienceFitVerdict = "well-grounded" | "logically-grounded" | "weakly-grounded" | "ungrounded";

export interface AudienceFit {
  readonly verdict: AudienceFitVerdict;
  readonly explanationDepth: "minimal" | "moderate" | "layered" | "extensive";
  readonly terminologyPolicy: readonly string[];
  readonly ctaAppropriate: boolean;
  readonly ctaReason: string;
  readonly confusionRisks: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly reasons: readonly string[];
  readonly limitations: readonly string[];
}

/**
 * Judge whether a mission has enough audience grounding to proceed.
 *
 * Deliberately does NOT reject useful evergreen content for lacking analytics.
 * The verdict distinguishes "we observed this need" from "this serves a
 * logically coherent audience" instead of conflating them into a score.
 */
export function assessAudienceFit(profile: AudienceProfile, mission: ContentMission): AudienceFit {
  const reasons: string[] = [];

  const observedDimensions = [profile.expertise, profile.job, profile.intent, profile.readiness].filter(
    (held) => held.state === "observed",
  ).length;

  let verdict: AudienceFitVerdict;
  if (observedDimensions >= 2) {
    verdict = "well-grounded";
    reasons.push(`${observedDimensions} audience dimensions rest on real observations.`);
  } else if (profile.segments.length > 0) {
    verdict = "logically-grounded";
    reasons.push(
      "No audience dimension was observed, but the mission addresses a coherent job and intent. " +
        "This is a defensible audience to serve — it is not evidence that this audience asked for it.",
    );
  } else if (mission.permittedClaims.length > 0) {
    verdict = "weakly-grounded";
    reasons.push(
      "Neither observation nor a derivable job/intent exists. The content may still be true and useful, " +
        "but who it serves is genuinely unestablished.",
    );
  } else {
    verdict = "ungrounded";
    reasons.push("No audience grounding and no permitted claims. There is nothing to say and nobody identified to say it to.");
  }

  if (profile.segmentsConflict) {
    reasons.push(`Segments conflict: ${profile.segmentConflictReason}`);
  }

  const cannotAssume = profile.knowledge.cannotAssume.value ?? [];
  const explanationDepth = determineDepth(profile, cannotAssume.length);

  const ctaAppropriate = profile.nextUsefulAction.value !== null && profile.nextUsefulAction.value !== "no-cta" && mission.productRoute !== null;
  const ctaReason = ctaAppropriate
    ? `The mission carries the shipped route ${mission.productRoute} and the viewer's next useful action is ${profile.nextUsefulAction.value}.`
    : "No shipped product route is attached to this mission, so any call to action would point at something that does not exist. No CTA is correct here.";

  return {
    verdict,
    explanationDepth,
    terminologyPolicy: cannotAssume.map((term) => `Explain "${term}" on first use; it may not be assumed understood.`),
    ctaAppropriate,
    ctaReason,
    confusionRisks: [
      ...(profile.confusion.ambiguousTerminology.value ?? []),
      ...(cannotAssume.length > 0
        ? [`Unexplained terminology would lose this audience: ${cannotAssume.join(", ")}.`]
        : []),
    ],
    unresolvedQuestions: profile.confusion.unresolvedQuestions.value ?? [],
    reasons,
    limitations: profile.limitations,
  };
}

function determineDepth(profile: AudienceProfile, opaqueTermCount: number): AudienceFit["explanationDepth"] {
  if (profile.segmentsConflict) return "layered";
  const expertise = profile.expertise.value;
  if (expertise === "advanced") return "minimal";
  if (expertise === "mixed") return "layered";
  if (opaqueTermCount >= 3) return "extensive";
  return expertise === "beginner" ? "moderate" : "moderate";
}
