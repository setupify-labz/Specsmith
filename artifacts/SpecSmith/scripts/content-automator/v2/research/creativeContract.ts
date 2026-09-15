// The research -> Creative Director contract, and the contradiction gate.
//
// WHY A CONTRACT AND NOT A SUMMARY
// ---------------------------------
// If research hands the Creative Director prose, the Creative Director has to
// interpret it, and interpretation under creative pressure reliably resolves in
// favour of the hook someone already wanted. This contract is a list of exactly
// what may be said, exactly what may not, and the wording constraints attached
// to each — nothing that requires judgment to apply.
//
// THE ASYMMETRY THAT MATTERS
// ---------------------------
// A claim is UNSAFE BY DEFAULT. It becomes safe only by clearing the evidence
// bar its own risk class sets. There is no path where a claim with no evidence
// ends up usable because nothing contradicted it, and no path where a creative
// need promotes a claim — `wantedForHook` is deliberately not a parameter of
// any function here.
//
// WHAT THIS DOES NOT DUPLICATE
// -----------------------------
// MASTER #1's antiSlop.ts already blocks copy SpecSmith has not earned the
// right to say on LINGUISTIC grounds — fake urgency, unsupported superlatives,
// "we tested". This module is the EVIDENTIAL half: whether the specific factual
// assertion in a line is backed. They meet in checkScriptAgainstResearch, which
// emits findings in the same shape MASTER #1 already consumes, rather than a
// second parallel finding type.

import {
  UNSAFE_FOR_CREATIVE,
  type AtomicClaim,
  type ClaimEvidenceLink,
  type ConfidenceAssessment,
  type EpistemicState,
  type Observation,
  type SourceSnapshot,
} from "./model.ts";
import { meetsAcceptableUncertainty, requiredStateForRisk, weakestState } from "./confidence.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

/** A claim the Creative Director may state, with the wording it must use. */
export interface SafeClaim {
  readonly claimId: string;
  readonly proposition: string;
  readonly state: EpistemicState;
  /**
   * Wording the script must honour: a time bound, an "estimated" label, a
   * configuration qualifier. These are not style notes — dropping one turns a
   * supported claim into an unsupported one.
   */
  readonly requiredWording: readonly string[];
  /** Attribution the viewer must be given, where the source must be named. */
  readonly attribution?: string;
  readonly supportingSnapshotIds: readonly string[];
}

/** A claim the Creative Director may not state, and precisely why. */
export interface UnsafeClaim {
  readonly claimId: string;
  readonly proposition: string;
  readonly state: EpistemicState;
  readonly reason: string;
  /** What would make it usable. Actionable, not merely a refusal. */
  readonly wouldBecomeSafeIf: readonly string[];
}

export interface ResearchCreativeContract {
  readonly version: "research-creative-contract-v1";
  readonly questionId: string;
  readonly generatedAt: string;
  readonly safeClaims: readonly SafeClaim[];
  readonly unsafeClaims: readonly UnsafeClaim[];
  readonly disputedClaims: readonly UnsafeClaim[];
  /** Supported facts that are genuinely interesting — hook material. */
  readonly groundedHookMaterial: readonly { readonly claimId: string; readonly angle: string }[];
  readonly openQuestions: readonly string[];
  readonly limitations: readonly string[];
  /** The ceiling on how certain any combined statement may sound. */
  readonly overallState: EpistemicState;
}

export interface ContractInput {
  readonly questionId: string;
  readonly claims: readonly AtomicClaim[];
  readonly confidence: ReadonlyMap<string, ConfidenceAssessment>;
  readonly links: readonly ClaimEvidenceLink[];
  readonly observations: readonly Observation[];
  readonly snapshots: readonly SourceSnapshot[];
  readonly now: Date;
}

/**
 * Wording a claim kind must carry to stay true.
 *
 * A price claim without a time and a seller is a different claim from the one
 * the evidence supports, so the constraint is part of the permission, not
 * advice about how to phrase it.
 */
function requiredWordingFor(
  claim: AtomicClaim,
  links: readonly ClaimEvidenceLink[],
  observations: readonly Observation[],
): string[] {
  const wording: string[] = [];
  const supporting = links.filter((link) => link.claimId === claim.claimId && link.stance === "supports");
  const byId = new Map(observations.map((entry) => [entry.observationId, entry]));

  if (claim.kind === "current-price" || claim.kind === "availability") {
    const stamps = supporting
      .map((link) => byId.get(link.observationId)?.observedAt)
      .filter((value): value is string => typeof value === "string")
      .sort();
    const observedAt = stamps[0];
    wording.push(
      observedAt
        ? `State the observation time explicitly (evidence observed ${observedAt}); never imply this is a live price.`
        : "State that this price was observed at a point in time; never imply it is live.",
    );
  }

  if (claim.kind === "performance-estimated") {
    wording.push('Label the figure "Estimated FPS" wherever it is visible, not only in narration.');
  }

  if (claim.kind === "performance-measured") {
    const firstParty = supporting.some((link) => {
      const observation = byId.get(link.observationId);
      return observation && byId.get(observation.observationId)?.snapshotId.startsWith("specsmith");
    });
    wording.push(
      firstParty
        ? "This is a SpecSmith measurement and may be described as one."
        : 'Attribute the measurement to its source; SpecSmith did not run it, so never say "we tested" or "we measured".',
    );
  }

  // Any surviving generalization has to be spoken as the narrower thing.
  const anyLeap = supporting.some((link) => link.generalisesBeyondObservation);
  if (anyLeap) {
    wording.push("State the specific configuration observed rather than the general case.");
  }

  const aging = supporting.some((link) => link.freshness === "aging");
  if (aging) wording.push("Acknowledge the age of the evidence rather than presenting it as current.");

  const config = claim.configuration;
  if (config && (claim.kind === "performance-measured" || claim.kind === "comparison")) {
    const parts = [config.gameId, config.resolution, config.preset, config.upscaler]
      .filter((value): value is string => typeof value === "string");
    if (parts.length) wording.push(`Name the test conditions on screen: ${parts.join(", ")}.`);
  }

  return wording;
}

/**
 * Splits the claim set into what may and may not be said.
 *
 * Note the direction of the test: a claim must REACH the state its risk demands.
 * Nothing here asks whether a claim has been disproven.
 */
export function buildResearchCreativeContract(input: ContractInput): ResearchCreativeContract {
  const safeClaims: SafeClaim[] = [];
  const unsafeClaims: UnsafeClaim[] = [];
  const disputedClaims: UnsafeClaim[] = [];
  const limitations: string[] = [];
  const openQuestions: string[] = [];

  for (const claim of input.claims) {
    const confidence = input.confidence.get(claim.claimId);
    const state: EpistemicState = confidence?.state ?? "unknown";
    const required = requiredStateForRisk(claim.risk);
    const supporting = input.links.filter((link) => link.claimId === claim.claimId && link.stance === "supports");

    const entry: UnsafeClaim = {
      claimId: claim.claimId,
      proposition: claim.proposition,
      state,
      reason: `A ${claim.risk}-risk ${claim.kind} claim needs ${required}; this is ${state}. ${(confidence?.detractors ?? []).join(" ")}`.trim(),
      wouldBecomeSafeIf: confidence?.wouldChangeIfs ?? ["Any applicable evidence would establish a position."],
    };

    if (state === "disputed") {
      disputedClaims.push(entry);
      openQuestions.push(`Sources disagree about: ${claim.proposition}`);
      continue;
    }

    // UNSAFE_FOR_CREATIVE is checked in addition to the strength comparison, so
    // a state like `stale` can never be argued past on strength grounds alone.
    if (UNSAFE_FOR_CREATIVE.includes(state) || !meetsAcceptableUncertainty(state, required)) {
      unsafeClaims.push(entry);
      if (state === "unknown" || state === "insufficient-evidence") {
        openQuestions.push(`Unanswered: ${claim.proposition}`);
      }
      continue;
    }

    safeClaims.push({
      claimId: claim.claimId,
      proposition: claim.proposition,
      state,
      requiredWording: requiredWordingFor(claim, input.links, input.observations),
      attribution: attributionFor(supporting, input.observations, input.snapshots),
      supportingSnapshotIds: [...new Set(
        supporting
          .map((link) => input.observations.find((entry) => entry.observationId === link.observationId)?.snapshotId)
          .filter((value): value is string => typeof value === "string"),
      )].sort(),
    });
  }

  if (input.snapshots.some((snapshot) => snapshot.provenance.synthetic)) {
    limitations.push("Some evidence in this pass is synthetic engineering fixture data and is marked as such.");
  }
  if (unsafeClaims.length > 0) {
    limitations.push(`${unsafeClaims.length} claim(s) are not usable; see unsafeClaims for the specific evidence each one lacks.`);
  }
  if (disputedClaims.length > 0) {
    limitations.push(`${disputedClaims.length} claim(s) are disputed and must be presented as disputed if mentioned at all.`);
  }

  // The ceiling: a combined statement may never sound more certain than its
  // weakest material component.
  const overallState = weakestState(safeClaims.map((claim) => claim.state));

  return {
    version: "research-creative-contract-v1",
    questionId: input.questionId,
    generatedAt: input.now.toISOString(),
    safeClaims,
    unsafeClaims,
    disputedClaims,
    groundedHookMaterial: safeClaims
      .filter((claim) => claim.state === "strongly-supported" || claim.state === "known")
      .map((claim) => ({ claimId: claim.claimId, angle: claim.proposition })),
    openQuestions,
    limitations,
    overallState,
  };
}

function attributionFor(
  links: readonly ClaimEvidenceLink[],
  observations: readonly Observation[],
  snapshots: readonly SourceSnapshot[],
): string | undefined {
  const publishers = new Set<string>();
  for (const link of links) {
    const observation = observations.find((entry) => entry.observationId === link.observationId);
    if (!observation) continue;
    const snapshot = snapshots.find((entry) => entry.snapshotId === observation.snapshotId);
    if (snapshot) publishers.add(snapshot.source.publisher);
  }
  if (publishers.size === 0) return undefined;
  return [...publishers].sort().join(", ");
}

/** A place in a script where the copy outruns the evidence. */
export interface EvidenceFinding {
  readonly code:
    | "unsupported-factual-claim"
    | "stronger-than-evidence"
    | "stale-presented-as-current"
    | "disputed-presented-as-settled"
    | "estimate-presented-as-measurement"
    | "source-result-presented-as-specsmith-measurement"
    | "missing-required-wording";
  readonly severity: "hard-fail" | "warning";
  readonly location: string;
  readonly evidence: string;
  readonly message: string;
}

/** Hedges that make a sentence a report of uncertainty rather than an assertion. */
const HEDGED = /\b(may|might|could|reportedly|appears?|seems?|around|roughly|approximately|estimated|about)\b/i;

/** Wording that asserts SpecSmith performed a measurement. */
const FIRST_PARTY_MEASUREMENT = /\b(we (tested|measured|benchmarked)|our (test|benchmark|lab)|specsmith (tested|measured|benchmarked))\b/i;

/** Wording that asserts a price is live right now. */
const LIVE_PRICE = /\b(costs? (?:just |only )?\$|priced at \$|is \$\d|going for \$|currently \$)/i;

/**
 * Checks a storyboard's copy against what research actually established.
 *
 * Scans every line a viewer will hear or read. The findings it emits carry the
 * same severity vocabulary MASTER #1's slop report uses, so the pipeline's
 * existing blocking logic applies to them without a second set of rules.
 */
export function checkScriptAgainstResearch(
  storyboard: PlatformScriptStoryboard,
  contract: ResearchCreativeContract,
): EvidenceFinding[] {
  const findings: EvidenceFinding[] = [];

  const lines: { location: string; text: string }[] = [
    { location: "title", text: storyboard.title },
    { location: "cta", text: storyboard.finalCta },
  ];
  for (const [index, beat] of storyboard.beats.entries()) {
    lines.push({ location: `beat-${index + 1}.narration`, text: beat.narration });
    lines.push({ location: `beat-${index + 1}.onScreenText`, text: beat.onScreenText });
  }

  for (const { location, text } of lines) {
    if (!text.trim()) continue;

    // An unsafe claim's subject matter appearing as an unhedged assertion.
    for (const unsafe of [...contract.unsafeClaims, ...contract.disputedClaims]) {
      if (!mentionsClaim(text, unsafe.proposition)) continue;
      const disputed = contract.disputedClaims.includes(unsafe);
      if (!HEDGED.test(text)) {
        findings.push({
          code: disputed ? "disputed-presented-as-settled" : "unsupported-factual-claim",
          severity: "hard-fail",
          location,
          evidence: text,
          message: disputed
            ? `States as settled a claim research recorded as disputed: "${unsafe.proposition}". ${unsafe.reason}`
            : `Asserts a claim research could not support (${unsafe.state}): "${unsafe.proposition}". ${unsafe.reason}`,
        });
      }
    }

    // A safe claim stated without the wording that makes it true.
    for (const safe of contract.safeClaims) {
      if (!mentionsClaim(text, safe.proposition)) continue;
      for (const requirement of safe.requiredWording) {
        if (requirement.includes("Estimated FPS") && /\bfps\b/i.test(text) && !/\bestimat/i.test(text)) {
          findings.push({
            code: "estimate-presented-as-measurement",
            severity: "hard-fail",
            location,
            evidence: text,
            message: `An estimated figure is stated without the Estimated label. Required: ${requirement}`,
          });
        }
        if (requirement.includes("never imply this is a live price") && LIVE_PRICE.test(text) && !/\b(was|observed|as of|at \d)\b/i.test(text)) {
          findings.push({
            code: "stale-presented-as-current",
            severity: "hard-fail",
            location,
            evidence: text,
            message: `States a price as current with no observation time. Required: ${requirement}`,
          });
        }
        if (requirement.includes('never say "we tested"') && FIRST_PARTY_MEASUREMENT.test(text)) {
          findings.push({
            code: "source-result-presented-as-specsmith-measurement",
            severity: "hard-fail",
            location,
            evidence: text,
            message: `Presents a third-party measurement as SpecSmith's own. Required: ${requirement}`,
          });
        }
      }
    }

    // First-party measurement language with no first-party measurement anywhere.
    if (FIRST_PARTY_MEASUREMENT.test(text)) {
      const hasFirstParty = contract.safeClaims.some(
        (claim) => claim.state !== "unknown" && claim.requiredWording.some((entry) => entry.includes("SpecSmith measurement")),
      );
      if (!hasFirstParty) {
        findings.push({
          code: "source-result-presented-as-specsmith-measurement",
          severity: "hard-fail",
          location,
          evidence: text,
          message: "Claims SpecSmith performed a measurement, but no first-party measurement is in the research contract.",
        });
      }
    }
  }

  return findings;
}

/**
 * Generic domain vocabulary that identifies nothing.
 *
 * Every SpecSmith script says "gpu" and "fps". Letting those count towards a
 * match means every line matches every hardware claim, and the gate then blocks
 * copy that never mentioned the claim at all — which is exactly what an earlier
 * version of this function did to a title reading "Pick the GPU before
 * SpecSmith reveals the names".
 */
const GENERIC_TERMS = new Set([
  "gpu", "cpu", "card", "cards", "fps", "price", "prices", "faster", "slower",
  "better", "worse", "performance", "specs", "spec", "build", "pc", "game",
  "games", "gaming", "memory", "vram", "new", "best", "buy", "value",
]);

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on",
  "at", "for", "with", "this", "that", "it", "its", "than", "more", "less", "be",
  "has", "have", "costs", "cost", "gets", "get",
]);

/**
 * Whether a line is talking about a claim.
 *
 * Matching is on DISTINCTIVE tokens — model identifiers, figures, proper nouns
 * — because a script never restates a proposition verbatim, and the generic
 * words it shares with every other script carry no evidence that this
 * particular claim is being made.
 *
 * Tokenization deliberately keeps hyphens and digits together: "gpu-a" is the
 * identifying token, and splitting it into "gpu" + "a" both destroys the
 * identity and leaves behind a generic word that matches everything.
 */
function mentionsClaim(text: string, proposition: string): boolean {
  const tokenize = (value: string) =>
    value.toLowerCase().split(/[^a-z0-9$%.\-]+/).map((token) => token.replace(/^[.\-]+|[.\-]+$/g, "")).filter(Boolean);

  const distinctive = [...new Set(tokenize(proposition))].filter(
    (token) => token.length > 2 && !STOP_WORDS.has(token) && !GENERIC_TERMS.has(token),
  );
  if (distinctive.length === 0) return false;

  const haystack = new Set(tokenize(text));
  const hits = distinctive.filter((token) => haystack.has(token)).length;

  // Two distinct identifying tokens, or every token of a very short claim.
  return hits >= 2 || (distinctive.length <= 2 && hits === distinctive.length);
}
