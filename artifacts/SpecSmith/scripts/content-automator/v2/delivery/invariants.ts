// MASTER #4 — Truth and mission invariants (sections 12, 13, 21, 33, 34).
//
// This is the file that makes platform adaptation safe. Everything else in
// MASTER #4 decides how to package a message; this decides what packaging may
// never do to it.
//
// The governing idea, stated once:
//
//   THE SAME CORE TRUTH CAN BE PACKAGED DIFFERENTLY.
//   THE CORE TRUTH CANNOT CHANGE BECAUSE A PLATFORM PREFERS A DIFFERENT STORY.
//
// Concretely, if MASTER #2 approved
//
//   "SpecSmith estimates GPU A at approximately 15% higher modeled FPS at 1440p high"
//
// then a TikTok cut saying "GPU A is 15% faster" has not been adapted — it has
// been falsified. It kept the number and dropped the two things that made the
// number true. The check below catches exactly that: once a line mentions a
// claim, it inherits that claim's required wording, and dropping any of it is a
// hard failure regardless of which platform asked for brevity.
//
// Both checks reuse MASTER #2's `analyseMention` rather than introducing a
// second matcher. A second matcher would drift from the audited one, and the
// audited one is the only thing standing between a figure and a fabrication.

import { analyseMention, normalizeForMatching } from "../research/claimMention.ts";
import type { ResearchCreativeContract, SafeClaim } from "../research/creativeContract.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import type { ContentMission } from "../strategy/contentMission.ts";
import type { StrategicObjective } from "../strategy/model.ts";

export type InvariantSeverity = "hard-fail" | "warning";

export interface InvariantFinding {
  readonly code: string;
  readonly severity: InvariantSeverity;
  /** Where in the adapted output the problem is. */
  readonly location: string;
  readonly evidence: string;
  readonly message: string;
}

/**
 * The frozen core of a mission: everything adaptation must carry through
 * unchanged, extracted once so every platform is measured against the same
 * thing rather than against its own re-derivation.
 */
export interface TruthInvariant {
  readonly missionId: string;
  readonly researchQuestionId: string;
  readonly objective: StrategicObjective;
  readonly thesis: string;
  readonly allowedClaims: readonly SafeClaim[];
  readonly forbiddenClaims: readonly { readonly proposition: string; readonly reason: string }[];
  /** Wording that must survive: caveats, time bounds, estimate labels. */
  readonly requiredWording: readonly string[];
  /** Claims that are estimates and may never be stated as measurements. */
  readonly estimatedClaimIds: readonly string[];
  /** Claims that are measurements, whose configuration must travel with them. */
  readonly measuredClaimIds: readonly string[];
  /** The ceiling on certainty for any combined statement. */
  readonly overallState: ResearchCreativeContract["overallState"];
  readonly requiredDisclosures: readonly string[];
  readonly limitations: readonly string[];
}

/**
 * Words that turn an estimate into a measurement.
 *
 * Not a blacklist of banned vocabulary — a list of words whose presence
 * ALONGSIDE a dropped estimate label means the line has upgraded the claim.
 */
const MEASUREMENT_WORDS = ["measured", "benchmarked", "tested", "proven", "actual", "real-world", "confirmed"];

/** Words that signal an estimate is being presented as one. */
const ESTIMATE_WORDS = ["estimate", "estimated", "estimates", "modeled", "modelled", "projection", "projected", "approximate", "approximately"];

export function extractTruthInvariant(
  mission: ContentMission,
  contract: ResearchCreativeContract,
  research: ResearchResult,
): TruthInvariant {
  const safeIds = new Set(mission.permittedClaims.map((claim) => claim.claimId));
  const byId = new Map(research.claims.map((claim) => [claim.claimId, claim]));

  const estimatedClaimIds: string[] = [];
  const measuredClaimIds: string[] = [];
  for (const id of safeIds) {
    const claim = byId.get(id);
    if (claim === undefined) continue;
    if (claim.kind === "performance-estimated") estimatedClaimIds.push(id);
    if (claim.kind === "performance-measured" || claim.kind === "comparison") measuredClaimIds.push(id);
  }

  const requiredDisclosures: string[] = [];
  for (const claim of mission.permittedClaims) {
    if (claim.attribution !== undefined) {
      requiredDisclosures.push(`Name the source for "${claim.proposition}": ${claim.attribution}.`);
    }
  }
  if (estimatedClaimIds.length > 0) {
    requiredDisclosures.push(
      "State that the figures are SpecSmith estimates rather than measurements, and name the configuration they assume.",
    );
  }

  return {
    missionId: mission.missionId,
    researchQuestionId: contract.questionId,
    objective: mission.primaryObjective,
    thesis: mission.angle.thesis,
    allowedClaims: mission.permittedClaims,
    forbiddenClaims: mission.forbiddenClaims,
    requiredWording: [...new Set([...mission.requiredWording, ...mission.permittedClaims.flatMap((c) => c.requiredWording)])].sort(),
    estimatedClaimIds: estimatedClaimIds.sort(),
    measuredClaimIds: measuredClaimIds.sort(),
    overallState: contract.overallState,
    requiredDisclosures: [...new Set(requiredDisclosures)].sort(),
    limitations: contract.limitations,
  };
}

/**
 * Reduce a word to a crude stem so that inflections of the same caveat match.
 *
 * "estimated", "estimates" and "estimate" all reduce to "estimat". This is not
 * a real stemmer and does not need to be: it exists so that a required caveat
 * expressed in a different tense still counts as delivered.
 */
function stem(word: string): string {
  let result = word;
  for (const suffix of ["ing", "ed", "es", "s", "d"]) {
    if (result.length > suffix.length + 2 && result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result.endsWith("e") ? result.slice(0, -1) : result;
}

/**
 * Does this text contain the required wording?
 *
 * Two different rules, because required wording carries two different kinds of
 * obligation:
 *
 *   MULTI-WORD ("at 1440p high") is a SPECIFICATION. It must appear verbatim:
 *   "at 1440p" is a different configuration, not a rephrasing.
 *
 *   SINGLE-WORD ("estimated") is a CONCEPT. "SpecSmith estimates..." delivers
 *   the caveat to the viewer exactly as well as "estimated" does, and failing
 *   it would push writers toward stilted copy for no gain in honesty.
 *
 * The asymmetry is deliberate: loosening the multi-word case would let a
 * configuration drift, which is precisely the failure this file exists to stop.
 */
function containsWording(text: string, wording: string): boolean {
  const normalizedText = normalizeForMatching(text);
  const normalizedWording = normalizeForMatching(wording);
  if (normalizedText.includes(normalizedWording)) return true;

  const wordingTokens = normalizedWording.split(/\s+/).filter((token) => token !== "");
  if (wordingTokens.length !== 1) return false;

  const target = stem(wordingTokens[0]);
  return normalizedText.split(/\s+/).some((token) => stem(token) === target);
}

/**
 * Contractions, expanded so a negation survives the comparison.
 *
 * "doesn't matter" and "does not matter" are the same assertion, and a
 * forbidden claim that can be shipped by using an apostrophe is not forbidden.
 */
const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bdoesn'?t\b/g, "does not"],
  [/\bdon'?t\b/g, "do not"],
  [/\bdidn'?t\b/g, "did not"],
  [/\bisn'?t\b/g, "is not"],
  [/\baren'?t\b/g, "are not"],
  [/\bwasn'?t\b/g, "was not"],
  [/\bwon'?t\b/g, "will not"],
  [/\bcan'?t\b/g, "can not"],
  [/\bcannot\b/g, "can not"],
];

function expandContractions(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CONTRACTIONS) result = result.replace(pattern, replacement);
  return result;
}

/**
 * How much of a proposition's wording a line actually reproduces.
 *
 * Used ONLY for forbidden claims, as a second net beneath `analyseMention`.
 * The MASTER #2 matcher is tuned so that generic words such as "GPU" cannot
 * make every GPU claim match — correct for deciding whether a line asserts an
 * approved claim, but it means a forbidden claim built mostly from common words
 * ("More VRAM does not matter for gaming performance") can slip through when
 * paraphrased.
 *
 * The asymmetry is intentional. A miss on an approved claim costs a spurious
 * rejection; a miss on a FORBIDDEN claim ships the exact sentence the mission
 * said must never be said. The forbidden list is small, specific and
 * hand-written, so the false-positive surface here is bounded in a way it would
 * not be for claims in general — which is exactly why this stays scoped to
 * forbidden claims and never touches the audited matcher.
 */
const FORBIDDEN_COVERAGE_THRESHOLD = 0.6;

export function reproducesForbiddenWording(text: string, proposition: string): boolean {
  // Tokenized on non-word characters rather than whitespace: `normalizeForMatching`
  // keeps punctuation, so splitting on spaces alone leaves "matter." which
  // never equals "matter" — and a trailing full stop is not a defence.
  const tokenize = (value: string): readonly string[] =>
    normalizeForMatching(expandContractions(value.toLowerCase()))
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1);

  const normalizedText = normalizeForMatching(expandContractions(text.toLowerCase()));
  const tokens = tokenize(proposition);
  if (tokens.length === 0) return false;

  const textTokens = new Set(tokenize(text));
  const covered = tokens.filter((token) => textTokens.has(token)).length;
  const coverage = covered / tokens.length;
  if (coverage < FORBIDDEN_COVERAGE_THRESHOLD) return false;

  // Polarity must agree. "VRAM does not matter" and "VRAM does matter" share
  // almost every token and assert opposite things.
  const propositionNegated = /\bnot\b|\bnever\b|\bno\b/.test(
    normalizeForMatching(expandContractions(proposition.toLowerCase())),
  );
  const textNegated = /\bnot\b|\bnever\b|\bno\b/.test(normalizedText);
  return propositionNegated === textNegated;
}

function hasAnyWord(text: string, words: readonly string[]): boolean {
  const normalized = normalizeForMatching(text);
  return words.some((word) => normalized.includes(normalizeForMatching(word)));
}

/**
 * The central check: adapted text may not say more than its evidence.
 *
 * `texts` is every piece of copy going out for a platform — script lines,
 * captions, title, description and hashtags alike. Section 21 is explicit that
 * metadata is inside the evidence boundary: a forbidden claim in a caption is
 * still a forbidden claim, and a caption is often the only thing a scrolling
 * viewer reads.
 */
export function assertTruthPreserved(
  invariant: TruthInvariant,
  texts: readonly { readonly location: string; readonly text: string }[],
): readonly InvariantFinding[] {
  const findings: InvariantFinding[] = [];

  for (const { location, text } of texts) {
    if (text.trim() === "") continue;

    // 1. A forbidden claim anywhere is a hard failure, metadata included.
    for (const forbidden of invariant.forbiddenClaims) {
      const mention = analyseMention(text, forbidden.proposition);
      const reproduces = reproducesForbiddenWording(text, forbidden.proposition);
      if (!mention.mentions && !reproduces) continue;
      findings.push({
        code: "forbidden-claim-in-adaptation",
        severity: "hard-fail",
        location,
        evidence: text,
        message:
          `Platform adaptation states a forbidden claim: "${forbidden.proposition}". This line ` +
          `${mention.mentions ? mention.reason : "reproduces the claim's wording and its polarity"}. ` +
          `${forbidden.reason} Adapting for a platform never licenses a claim the mission forbids, and metadata is inside the evidence boundary.`,
      });
    }

    // 2. Once a line mentions an approved claim, it inherits that claim's
    //    required wording. This is where "15% faster" gets caught.
    for (const claim of invariant.allowedClaims) {
      const mention = analyseMention(text, claim.proposition);
      if (!mention.mentions) continue;

      for (const wording of claim.requiredWording) {
        if (containsWording(text, wording)) continue;
        findings.push({
          code: "required-wording-dropped",
          severity: "hard-fail",
          location,
          evidence: text,
          message:
            `This line states the claim "${claim.proposition}" but drops the required wording "${wording}". ` +
            `It ${mention.reason}. The wording is not a style note: without it the claim is no longer the one research approved. ` +
            "Brevity for a platform is not a reason to remove it.",
        });
      }

      // 3. An estimate may never be re-labelled as a measurement.
      if (invariant.estimatedClaimIds.includes(claim.claimId)) {
        const keepsEstimateLabel = hasAnyWord(text, ESTIMATE_WORDS);
        const assertsMeasurement = hasAnyWord(text, MEASUREMENT_WORDS);
        if (!keepsEstimateLabel) {
          findings.push({
            code: "estimate-presented-as-fact",
            severity: "hard-fail",
            location,
            evidence: text,
            message:
              `This line states the estimated claim "${claim.proposition}" without saying it is an estimate. ` +
              "An estimate stated flatly reads as a measurement. The estimator status is load-bearing and survives every platform adaptation.",
          });
        }
        if (assertsMeasurement) {
          findings.push({
            code: "estimate-upgraded-to-measurement",
            severity: "hard-fail",
            location,
            evidence: text,
            message:
              `This line describes the estimated claim "${claim.proposition}" in the language of measurement. ` +
              "MASTER #4 may change how a truth is packaged; it may never upgrade estimated to measured.",
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Check that the required wording appears somewhere in a COMPLETE platform
 * output.
 *
 * Deliberately separate from `assertTruthPreserved`, which is per-line. A
 * caption is not required to repeat every caveat the script already carries —
 * what matters is that this platform's viewer encounters the wording somewhere
 * in what actually ships to them. Running this over a partial set of texts
 * would reject honest copy for the crime of being only part of the output.
 *
 * Callers must pass everything that ships for one platform: script lines,
 * captions, title, description, tags.
 */
export function assertRequiredWordingPresent(
  invariant: TruthInvariant,
  completePlatformOutput: readonly { readonly location: string; readonly text: string }[],
): readonly InvariantFinding[] {
  const combined = completePlatformOutput.map((entry) => entry.text).join(" \n ");
  const findings: InvariantFinding[] = [];

  for (const wording of invariant.requiredWording) {
    if (containsWording(combined, wording)) continue;
    findings.push({
      code: "mission-required-wording-absent",
      severity: "hard-fail",
      location: "platform-output",
      evidence: wording,
      message:
        `The mission requires the wording "${wording}", and it appears nowhere in this platform's output. ` +
        "A caveat that exists only on another platform's cut does not protect this platform's viewer.",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Mission invariants (section 13)
// ---------------------------------------------------------------------------

/**
 * What MASTER #4 is allowed to change about a mission.
 *
 * Everything not on this list is MASTER #3's, and an adaptation that needs to
 * change it must escalate rather than proceed.
 */
export const ADAPTABLE_FIELDS: readonly string[] = [
  "wording", "ordering", "pacing", "visual-hierarchy", "explanation-depth",
  "metadata", "cta-presentation", "caption-density", "hook-form",
];

/** What MASTER #4 may never change, however convenient it would be. */
export const FROZEN_MISSION_FIELDS: readonly string[] = [
  "primaryObjective", "audienceProblem", "angle", "forbiddenClaims",
  "permittedClaims", "requiredWording", "productRoute", "resourcePosture",
  "successHypothesisId",
];

/**
 * A proposed adaptation, described declaratively so it can be checked before
 * anything is built from it.
 */
export interface ProposedAdaptation {
  readonly platform: string;
  readonly objective: StrategicObjective;
  readonly angleId: string;
  readonly thesis: string;
  readonly permittedClaimIds: readonly string[];
  readonly forbiddenPropositions: readonly string[];
  readonly requiredWording: readonly string[];
  readonly productRoute: string | null;
  readonly resourcePosture: ContentMission["resourcePosture"];
  readonly successHypothesisId: string | null;
}

/**
 * Check an adaptation against the mission it claims to serve.
 *
 * Every finding here is a hard failure by design. There is no "mostly the same
 * objective": either the adaptation serves the mission MASTER #3 authorised, or
 * it is a different piece of content that MASTER #3 never approved.
 */
export function assertMissionPreserved(
  mission: ContentMission,
  adaptation: ProposedAdaptation,
): readonly InvariantFinding[] {
  const findings: InvariantFinding[] = [];
  const fail = (code: string, evidence: string, message: string) =>
    findings.push({ code, severity: "hard-fail", location: `${adaptation.platform}:mission`, evidence, message });

  if (adaptation.objective !== mission.primaryObjective) {
    fail(
      "objective-changed",
      `${mission.primaryObjective} -> ${adaptation.objective}`,
      "Platform adaptation changed the mission's primary objective. Choosing what a piece of content is FOR is MASTER #3's decision. " +
        "If this platform genuinely serves a different objective, that is a strategy question and must be escalated, not resolved here.",
    );
  }

  if (adaptation.angleId !== mission.angle.angleId) {
    fail(
      "angle-changed",
      `${mission.angle.angleId} -> ${adaptation.angleId}`,
      "Platform adaptation silently changed the strategic angle. The angle was selected against the evidence MASTER #2 approved, " +
        "so swapping it can authorise claim kinds research never cleared.",
    );
  }

  if (normalizeForMatching(adaptation.thesis) !== normalizeForMatching(mission.angle.thesis)) {
    fail(
      "thesis-changed",
      `"${mission.angle.thesis}" -> "${adaptation.thesis}"`,
      "Platform adaptation changed the thesis. Wording may change; what the content argues may not.",
    );
  }

  const permitted = new Set(mission.permittedClaims.map((claim) => claim.claimId));
  for (const claimId of adaptation.permittedClaimIds) {
    if (permitted.has(claimId)) continue;
    fail(
      "claim-added",
      claimId,
      `Platform adaptation added claim "${claimId}", which the mission does not permit. ` +
        "MASTER #4 cannot authorise a claim; only MASTER #2 can approve one and only MASTER #3 can put it in a mission.",
    );
  }

  for (const proposition of mission.forbiddenClaims.map((claim) => normalizeForMatching(claim.proposition))) {
    if (adaptation.forbiddenPropositions.map(normalizeForMatching).includes(proposition)) continue;
    fail(
      "forbidden-claim-dropped",
      proposition,
      "Platform adaptation dropped a forbidden claim from its own prohibition list. " +
        "A prohibition that does not travel with the adaptation is not a prohibition.",
    );
  }

  for (const wording of mission.requiredWording) {
    if (adaptation.requiredWording.includes(wording)) continue;
    fail(
      "required-wording-removed",
      wording,
      `Platform adaptation removed the required wording "${wording}" from its own requirements. ` +
        "Required wording is part of the claim, not a length problem to solve.",
    );
  }

  if (adaptation.productRoute !== mission.productRoute) {
    fail(
      "product-route-changed",
      `${mission.productRoute ?? "none"} -> ${adaptation.productRoute ?? "none"}`,
      "Platform adaptation changed the product route. MASTER #3 verified product readiness before authorising this mission; " +
        "pointing at a different surface bypasses that check and can send an audience to something that does not exist.",
    );
  }

  if (adaptation.resourcePosture !== mission.resourcePosture) {
    fail(
      "resource-posture-changed",
      `${mission.resourcePosture} -> ${adaptation.resourcePosture}`,
      "Platform adaptation changed the resource posture, which is how the zero-cost guarantee is enforced.",
    );
  }

  if (adaptation.successHypothesisId !== mission.successHypothesisId) {
    fail(
      "hypothesis-identity-changed",
      `${mission.successHypothesisId ?? "none"} -> ${adaptation.successHypothesisId ?? "none"}`,
      "Platform adaptation changed which strategic hypothesis this content tests, which would make any later measurement " +
        "attach to the wrong bet.",
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// MASTER #2 handoff proof (section 33)
// ---------------------------------------------------------------------------

/**
 * Prove MASTER #4 never upgraded an epistemic state.
 *
 * Compares what the delivery layer says it may claim against what research
 * actually approved. Any claim appearing here that research did not mark safe
 * is an upgrade, and upgrades are exactly what this layer must be incapable of.
 */
export function assertNoEvidenceUpgrade(
  contract: ResearchCreativeContract,
  claimedIds: readonly string[],
): readonly InvariantFinding[] {
  const safe = new Set(contract.safeClaims.map((claim) => claim.claimId));
  const unsafe = new Map(contract.unsafeClaims.map((claim) => [claim.claimId, claim]));
  const disputed = new Map(contract.disputedClaims.map((claim) => [claim.claimId, claim]));

  const findings: InvariantFinding[] = [];
  for (const claimId of claimedIds) {
    if (safe.has(claimId)) continue;

    const unsafeClaim = unsafe.get(claimId);
    if (unsafeClaim !== undefined) {
      findings.push({
        code: "unsafe-claim-upgraded",
        severity: "hard-fail",
        location: "delivery:claims",
        evidence: claimId,
        message:
          `The delivery layer treats "${unsafeClaim.proposition}" as sayable, but research marked it ${unsafeClaim.state}. ` +
          "Platform optimization is downstream from evidence and can never promote an unsafe claim to a safe one.",
      });
      continue;
    }

    const disputedClaim = disputed.get(claimId);
    if (disputedClaim !== undefined) {
      findings.push({
        code: "disputed-claim-resolved",
        severity: "hard-fail",
        location: "delivery:claims",
        evidence: claimId,
        message:
          `The delivery layer treats the disputed claim "${disputedClaim.proposition}" as settled. ` +
          "Sources genuinely disagree; a platform preferring a cleaner story does not resolve that.",
      });
      continue;
    }

    findings.push({
      code: "unknown-claim-asserted",
      severity: "hard-fail",
      location: "delivery:claims",
      evidence: claimId,
      message:
        `The delivery layer claims "${claimId}", which appears nowhere in the research contract. ` +
        "A claim research never saw cannot become sayable by being useful to a platform.",
    });
  }
  return findings;
}

export function formatInvariantFindings(findings: readonly InvariantFinding[]): string {
  if (findings.length === 0) return "  invariants: all preserved.";
  return findings
    .map((finding) => `  ${finding.severity} ${finding.code} @ ${finding.location}: ${finding.message}`)
    .join("\n");
}
