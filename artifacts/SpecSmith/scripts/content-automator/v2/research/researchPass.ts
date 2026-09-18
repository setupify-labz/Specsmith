// One research pass: question in, RESEARCH_RESULT out.
//
// WHAT THIS IS AND IS NOT
// ------------------------
// This is the orchestrator that walks the canonical chain for one question:
//
//   question -> gaps -> evidence -> source assessment -> observations
//            -> atomic claims -> applicability/freshness/corroboration/conflict
//            -> confidence -> stopping decision -> result
//
// It is transport-independent on purpose. Nothing in this file fetches
// anything, and there is deliberately no HTTP client anywhere in the research
// modules: SpecSmith has no autonomous web access on this branch, and adding a
// fake network client to make the architecture look finished would be exactly
// the "research theater" the brief forbids. Evidence arrives through
// ingestion.ts, from a connector or a person, and this consumes what arrived.
//
// STOPPING IS A FIRST-CLASS OUTCOME
// ----------------------------------
// "Insufficient reliable evidence" is a CORRECT result, not a failure. A
// research system that must always produce an answer will produce one whether
// or not it has grounds, which is the single most dangerous property such a
// system can have. Every pass here ends in a named StoppingReason, and six of
// the ten are successful stops.

import {
  SUCCESSFUL_STOPS,
  type AtomicClaim,
  type ClaimEvidenceLink,
  type ConfidenceAssessment,
  type Conflict,
  type Corroboration,
  type KnowledgeGap,
  type Observation,
  type ResearchBudget,
  type ResearchQuestion,
  type SourceAssessment,
  type SourceSnapshot,
  type StoppingReason,
} from "./model.ts";
import { assessSource } from "./sourceAssessment.ts";
import { assessCorroboration, detectConflict, linkEvidence } from "./evidence.ts";
import { assessConfidence, meetsAcceptableUncertainty, requiredStateForRisk } from "./confidence.ts";
import { buildResearchCreativeContract, type ResearchCreativeContract } from "./creativeContract.ts";

/**
 * The completed pass. Transport-independent and fully self-describing: every
 * conclusion in it can be traced back through claims to observations to the
 * exact snapshot that carried them.
 */
export interface ResearchResult {
  readonly version: "research-result-v1";
  readonly researchId: string;
  readonly question: ResearchQuestion;
  readonly startedAt: string;
  readonly completedAt: string;

  readonly snapshots: readonly SourceSnapshot[];
  readonly assessments: readonly SourceAssessment[];
  readonly observations: readonly Observation[];
  readonly claims: readonly AtomicClaim[];
  readonly links: readonly ClaimEvidenceLink[];
  readonly corroborations: readonly Corroboration[];
  readonly conflicts: readonly Conflict[];
  readonly gaps: readonly KnowledgeGap[];
  readonly confidence: ReadonlyMap<string, ConfidenceAssessment>;

  readonly stoppingReason: StoppingReason;
  /** True when the stop was a correct outcome rather than a breakdown. */
  readonly stoppedSuccessfully: boolean;
  readonly budget: ResearchBudget;
  readonly limitations: readonly string[];
  /** True when any evidence in this pass is engineering fixture data. */
  readonly containsSyntheticEvidence: boolean;
  readonly contract: ResearchCreativeContract;
}

export interface ResearchPassInput {
  readonly researchId: string;
  readonly question: ResearchQuestion;
  readonly claims: readonly AtomicClaim[];
  readonly snapshots: readonly SourceSnapshot[];
  readonly observations: readonly Observation[];
  /**
   * Which observations bear on which claims, and how. Supplied rather than
   * inferred: deciding that an observation supports a claim is a judgment, and
   * a keyword-matching heuristic making it silently is how irrelevant evidence
   * ends up counted as support.
   */
  readonly stances: readonly { readonly claimId: string; readonly observationId: string; readonly stance: ClaimEvidenceLink["stance"] }[];
  readonly startedAt: Date;
  readonly now: Date;
  readonly duplicatesSkipped?: number;
  readonly cachedReuseCount?: number;
  readonly quotaExhausted?: readonly string[];
}

/**
 * Identifies what is missing before concluding anything.
 *
 * Gaps are derived from the question's own requirements, not from whatever the
 * evidence happens to lack — otherwise a pass with no evidence would report no
 * gaps, which is precisely backwards.
 */
export function detectKnowledgeGaps(
  question: ResearchQuestion,
  claims: readonly AtomicClaim[],
  links: readonly ClaimEvidenceLink[],
  snapshots: readonly SourceSnapshot[],
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const add = (code: string, description: string, decisionImpact: KnowledgeGap["decisionImpact"]) => {
    gaps.push({ gapId: `${question.questionId}-gap-${gaps.length + 1}`, questionId: question.questionId, code, description, decisionImpact });
  };

  for (const claim of claims) {
    const supporting = links.filter((link) => link.claimId === claim.claimId && link.stance === "supports");
    if (supporting.length === 0) {
      add("missing-evidence", `No supporting evidence for: ${claim.proposition}`, claim.risk === "high" ? "blocking" : "high");
      continue;
    }
    if (supporting.every((link) => link.applicability === "not-applicable")) {
      add("evidence-not-applicable", `All evidence for "${claim.proposition}" is about a different configuration.`, "blocking");
    }
    if (supporting.every((link) => link.freshness === "stale" || link.freshness === "expired")) {
      add(`stale-${claim.kind}`, `Only stale evidence exists for: ${claim.proposition}`, claim.risk === "high" ? "blocking" : "medium");
    }
    if (claim.kind === "current-price" && !snapshots.some((entry) => entry.source.sourceType === "retailer-listing")) {
      add("missing-current-price", `A price claim with no retailer listing behind it: ${claim.proposition}`, "blocking");
    }
    if (claim.kind === "performance-measured" && !snapshots.some((entry) =>
      entry.source.sourceType === "independent-benchmark" || entry.source.sourceType === "first-party-specsmith")) {
      add("missing-independent-performance-evidence", `A measured-performance claim with no independent measurement: ${claim.proposition}`, "blocking");
    }
    if (claim.configuration && claim.kind === "performance-measured" && !claim.configuration.gameVersion) {
      add("missing-game-version", `Performance claim does not fix a game version: ${claim.proposition}`, "medium");
    }
  }

  return gaps;
}

/**
 * Decides why the pass stopped.
 *
 * The order encodes precedence: a question nothing could answer is invalid
 * before it is under-evidenced, and an unresolved conflict outranks having
 * enough sources, because more agreement on a disputed point is still disputed.
 */
function decideStop(input: {
  question: ResearchQuestion;
  claims: readonly AtomicClaim[];
  links: readonly ClaimEvidenceLink[];
  conflicts: readonly Conflict[];
  confidence: ReadonlyMap<string, ConfidenceAssessment>;
  quotaExhausted: readonly string[];
}): StoppingReason {
  if (input.claims.length === 0) return "question-invalid";
  if (input.quotaExhausted.length > 0 && input.links.length === 0) return "quota-exhausted";

  const states = input.claims.map((claim) => input.confidence.get(claim.claimId)?.state ?? "unknown");

  if (input.conflicts.some((conflict) => !conflict.resolved)) return "conflicting-evidence";
  if (states.every((state) => state === "stale")) return "stale-evidence-only";
  if (states.every((state) => state === "insufficient-evidence" && input.links.length > 0)) return "evidence-not-applicable";

  const allMeet = input.claims.every((claim) => {
    const state = input.confidence.get(claim.claimId)?.state ?? "unknown";
    return meetsAcceptableUncertainty(state, requiredStateForRisk(claim.risk));
  });
  if (allMeet) return "sufficient-evidence";

  return "insufficient-evidence";
}

/**
 * Runs one pass over supplied evidence. Pure: no I/O, no network, no clock
 * beyond the `now` it is handed.
 */
export function runResearchPass(input: ResearchPassInput): ResearchResult {
  const claimsById = new Map(input.claims.map((claim) => [claim.claimId, claim]));
  const observationsById = new Map(input.observations.map((entry) => [entry.observationId, entry]));
  const snapshotsById = new Map(input.snapshots.map((entry) => [entry.snapshotId, entry]));

  // Every snapshot is assessed FOR THIS QUESTION's claim kind. The same page
  // assessed for a different question would get a different grade, which is
  // the whole point of assessSource taking the kind.
  const assessments = input.snapshots.map((snapshot) => assessSource(snapshot, input.question.claimKind));

  const links: ClaimEvidenceLink[] = [];
  for (const stance of input.stances) {
    const claim = claimsById.get(stance.claimId);
    const observation = observationsById.get(stance.observationId);
    if (!claim || !observation) continue;
    links.push(linkEvidence(claim, observation, stance.stance, input.now));
  }

  const corroborations: Corroboration[] = [];
  const conflicts: Conflict[] = [];
  const confidence = new Map<string, ConfidenceAssessment>();

  for (const claim of input.claims) {
    // APPLICABILITY GATES SOURCE STRENGTH, and this is the load-bearing line.
    //
    // An earlier version counted every "supports" link here, so a first-rate
    // independent benchmark of the LAPTOP part still lent its authority and its
    // independent-origin count to a claim about the DESKTOP part. The evidence
    // had already been ruled not-applicable; the source's reputation was
    // travelling without it. A source that measured something else is not a
    // weaker witness to this claim — it is not a witness to it at all.
    const applicableSupport = links.filter(
      (link) => link.claimId === claim.claimId && link.stance === "supports" && link.applicability !== "not-applicable",
    );

    const supportingObservations = applicableSupport
      .map((link) => observationsById.get(link.observationId))
      .filter((entry): entry is Observation => entry !== undefined);

    const supportingSnapshots = [...new Set(supportingObservations.map((entry) => entry.snapshotId))]
      .map((id) => snapshotsById.get(id))
      .filter((entry): entry is SourceSnapshot => entry !== undefined);

    const corroboration = assessCorroboration(claim.claimId, supportingSnapshots);
    corroborations.push(corroboration);

    // Conflict detection runs over every observation linked to the claim,
    // supporting or contradicting: a contradiction between two "supporting"
    // sources is exactly the case that must not be averaged away.
    const linkedObservations = links
      .filter((link) => link.claimId === claim.claimId && link.stance !== "irrelevant")
      .map((link) => observationsById.get(link.observationId))
      .filter((entry): entry is Observation => entry !== undefined);

    const conflict = detectConflict(claim, linkedObservations);
    if (conflict) conflicts.push(conflict);

    confidence.set(claim.claimId, assessConfidence({
      claim,
      links: links.filter((link) => link.claimId === claim.claimId),
      assessments: assessments.filter((entry) => supportingSnapshots.some((snapshot) => snapshot.snapshotId === entry.snapshotId)),
      corroboration,
      conflict,
    }));
  }

  const gaps = detectKnowledgeGaps(input.question, input.claims, links, input.snapshots);
  const quotaExhausted = input.quotaExhausted ?? [];
  const stoppingReason = decideStop({
    question: input.question,
    claims: input.claims,
    links,
    conflicts,
    confidence,
    quotaExhausted,
  });

  const contract = buildResearchCreativeContract({
    questionId: input.question.questionId,
    claims: input.claims,
    confidence,
    links,
    observations: input.observations,
    snapshots: input.snapshots,
    now: input.now,
  });

  const containsSyntheticEvidence =
    input.snapshots.some((entry) => entry.provenance.synthetic) ||
    input.observations.some((entry) => entry.provenance.synthetic);

  const limitations: string[] = [];
  if (containsSyntheticEvidence) {
    limitations.push("This pass includes synthetic engineering fixture evidence and is not a production research result.");
  }
  const unread = assessments.filter((entry) => !entry.materialObserved);
  if (unread.length > 0) {
    limitations.push(`${unread.length} source(s) were never read directly; their content is reported, not observed.`);
  }
  const blocking = gaps.filter((gap) => gap.decisionImpact === "blocking");
  if (blocking.length > 0) {
    limitations.push(`${blocking.length} blocking knowledge gap(s) remain: ${blocking.map((gap) => gap.code).join(", ")}.`);
  }
  if (quotaExhausted.length > 0) {
    limitations.push(`Free-tier quota exhausted for: ${quotaExhausted.join(", ")}. No paid fallback was used.`);
  }

  return {
    version: "research-result-v1",
    researchId: input.researchId,
    question: input.question,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.now.toISOString(),
    snapshots: input.snapshots,
    assessments,
    observations: input.observations,
    claims: input.claims,
    links,
    corroborations,
    conflicts,
    gaps,
    confidence,
    stoppingReason,
    stoppedSuccessfully: SUCCESSFUL_STOPS.includes(stoppingReason),
    budget: {
      sourcesConsulted: input.snapshots.length,
      snapshotsIngested: input.snapshots.length,
      cachedReuseCount: input.cachedReuseCount ?? 0,
      duplicateEvidenceCount: input.duplicatesSkipped ?? 0,
      quotaExhausted,
    },
    limitations,
    containsSyntheticEvidence,
    contract,
  };
}

/**
 * The human-and-machine-readable report.
 *
 * Deliberately has no headline score. A single number would be the first thing
 * anyone read and the last thing they checked, and the interesting content here
 * is which specific claims survived and which did not.
 */
export function formatResearchReport(result: ResearchResult): string {
  const lines: string[] = [];
  lines.push(`CONTENT_RESEARCH_REPORT ${result.researchId}`);
  lines.push(`  question:      ${result.question.question}`);
  lines.push(`  informs:       ${result.question.informsDecision}`);
  lines.push(`  stopped:       ${result.stoppingReason} (${result.stoppedSuccessfully ? "a correct outcome" : "a breakdown"})`);
  lines.push(`  evidence:      ${result.snapshots.length} snapshot(s), ${result.observations.length} observation(s), ${result.claims.length} atomic claim(s)`);
  if (result.containsSyntheticEvidence) lines.push("  SYNTHETIC:     this pass contains engineering fixture evidence and is not production research");

  lines.push(`  safe to say:   ${result.contract.safeClaims.length}`);
  for (const claim of result.contract.safeClaims) {
    lines.push(`    [${claim.state}] ${claim.proposition}`);
    for (const wording of claim.requiredWording) lines.push(`        required wording: ${wording}`);
    if (claim.attribution) lines.push(`        attribute to: ${claim.attribution}`);
  }

  lines.push(`  NOT safe:      ${result.contract.unsafeClaims.length}`);
  for (const claim of result.contract.unsafeClaims) {
    lines.push(`    [${claim.state}] ${claim.proposition}`);
    lines.push(`        why: ${claim.reason}`);
    for (const fix of claim.wouldBecomeSafeIf) lines.push(`        would become safe if: ${fix}`);
  }

  if (result.contract.disputedClaims.length > 0) {
    lines.push(`  disputed:      ${result.contract.disputedClaims.length}`);
    for (const claim of result.contract.disputedClaims) lines.push(`    ${claim.proposition} — ${claim.reason}`);
  }

  for (const conflict of result.conflicts) {
    lines.push(`  conflict:      ${conflict.whatConflicts}${conflict.resolved ? ` (resolved: ${conflict.resolutionReason})` : " (UNRESOLVED)"}`);
  }
  for (const corroboration of result.corroborations.filter((entry) => entry.dependentGroups.length > 0)) {
    lines.push(`  corroboration: ${corroboration.reason}`);
  }
  for (const gap of result.gaps) {
    lines.push(`  gap [${gap.decisionImpact}]: ${gap.code} — ${gap.description}`);
  }
  lines.push(`  budget:        ${result.budget.sourcesConsulted} source(s), ${result.budget.duplicateEvidenceCount} duplicate(s) skipped, ${result.budget.cachedReuseCount} cached reuse(s)`);
  for (const limitation of result.limitations) lines.push(`  limitation:    ${limitation}`);
  return lines.join("\n");
}
