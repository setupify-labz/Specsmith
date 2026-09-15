// MASTER #6 — Concept critique and revision routing (capability #6).
//
// WHY THIS EXISTS
//
// `beatRepair` already runs a revision loop, and it is a good one: it tracks
// lineage, refuses a pass that regresses a dimension, and never silently drops
// a fix it could not apply. But it operates on a storyboard that already
// exists. Section 1's defects were not beat-level: package 2's payoff was
// undermined by its own method, package 3's accessibility risk came from its
// visual mechanism, and package 1's weakness was that it ended on a negation.
// None of those is fixable by rewriting a line.
//
// So this layer critiques CONCEPTS and routes what it finds. Critically, it
// does not rewrite creative prose. Automatic rewriting of narration is exactly
// where generated-sounding copy enters, and `creativeQualityReview` already
// declares which dimensions are human-only. A machine that quietly rewrites a
// hook to clear its own check has optimised the check, not the video.
//
// The loop therefore:
//   1. Assesses each concept structurally (`assessConcept`).
//   2. Scans the copy it would actually emit (`scanForSlop`) — the existing
//      detector, not a second opinion about taste.
//   3. Assesses the SET (`assessDivergence`), because a concept can be fine and
//      the set still be three versions of one idea.
//   4. Classifies every finding as machine-applicable or human-required, and
//      applies only the machine-applicable ones, recording lineage.
//
// A concept that still has human-required findings is NOT marked ready. It is
// handed over with the findings attached, which is the honest end state for a
// creative system whose taste dimensions are human-owned.

import { scanForSlop, type SlopFinding } from "../antiSlop.ts";
import { assessConcept, toStoryboardBeats, type ConceptDefect, type CreativeConcept } from "./concept.ts";
import { assessDivergence, type DivergenceFinding } from "./divergence.ts";

export type CritiqueSource = "structure" | "copy" | "set";

export type CritiqueRouting =
  /** A machine can fix this without making a creative judgement. */
  | "machine-applicable"
  /** Fixing this requires a creative decision, so a human owns it. */
  | "human-required"
  /** Nothing can fix this here: the capability does not exist yet. */
  | "blocked-on-capability";

export interface CritiqueFinding {
  readonly source: CritiqueSource;
  readonly code: string;
  readonly conceptId: string;
  readonly detail: string;
  readonly routing: CritiqueRouting;
}

/**
 * Structural defects a machine may repair on its own.
 *
 * Deliberately tiny. Everything absent from this set is a creative decision,
 * and the default for anything unrecognised is `human-required` — a new defect
 * code must be explicitly admitted here, never silently auto-fixed.
 */
const MACHINE_APPLICABLE_DEFECTS = new Set<ConceptDefect["code"]>(["visual-never-used"]);

function routeDefect(defect: ConceptDefect): CritiqueRouting {
  if (defect.code === "missing-capability") return "blocked-on-capability";
  return MACHINE_APPLICABLE_DEFECTS.has(defect.code) ? "machine-applicable" : "human-required";
}

function routeSlop(finding: SlopFinding): CritiqueRouting {
  // Every slop finding is about wording the viewer will hear or read. Rewriting
  // it is a creative act, so none of these route to the machine.
  return "human-required";
}

function routeDivergence(finding: DivergenceFinding): CritiqueRouting {
  // Making two concepts genuinely different is the creative work itself.
  return "human-required";
}

export interface ConceptCritique {
  readonly conceptId: string;
  readonly findings: readonly CritiqueFinding[];
  readonly machineApplicable: readonly CritiqueFinding[];
  readonly humanRequired: readonly CritiqueFinding[];
  readonly blockedOnCapability: readonly CritiqueFinding[];
  /** True only when nothing at all is outstanding. */
  readonly ready: boolean;
}

export interface SetCritique {
  readonly concepts: readonly ConceptCritique[];
  readonly setFindings: readonly CritiqueFinding[];
  readonly divergent: boolean;
  /** Concepts with no outstanding findings of any kind. */
  readonly readyConceptIds: readonly string[];
  /** Concepts held back only because a capability does not exist. */
  readonly blockedConceptIds: readonly string[];
}

export interface CritiqueInput {
  readonly concepts: readonly CreativeConcept[];
  readonly availableCapabilityIds: readonly string[];
  readonly guaranteedDisclosureIds: readonly string[];
}

export function critiqueConceptSet(input: CritiqueInput): SetCritique {
  const divergence = assessDivergence(input.concepts);
  const setFindings: CritiqueFinding[] = divergence.findings.map((finding) => ({
    source: "set",
    code: finding.code,
    conceptId: finding.conceptIds.join("+"),
    detail: finding.detail,
    routing: routeDivergence(finding),
  }));

  const concepts = input.concepts.map((concept) => {
    const findings: CritiqueFinding[] = [];

    const assessment = assessConcept({
      concept,
      availableCapabilityIds: input.availableCapabilityIds,
      guaranteedDisclosureIds: input.guaranteedDisclosureIds,
    });
    for (const defect of assessment.defects) {
      findings.push({
        source: "structure",
        code: defect.code,
        conceptId: concept.conceptId,
        detail: defect.detail,
        routing: routeDefect(defect),
      });
    }

    const beats = toStoryboardBeats(concept);
    const slop = scanForSlop({
      title: concept.viewerQuestion,
      beats: beats.map((beat) => ({ onScreenText: beat.onScreenText, narration: beat.narration })),
      finalCta: beats[beats.length - 1]?.narration ?? "",
    });
    for (const finding of slop.findings) {
      findings.push({
        source: "copy",
        code: finding.code,
        conceptId: concept.conceptId,
        detail: `${finding.location}: ${finding.message} Offending text: "${finding.evidence}"`,
        routing: routeSlop(finding),
      });
    }

    const machineApplicable = findings.filter((finding) => finding.routing === "machine-applicable");
    const humanRequired = findings.filter((finding) => finding.routing === "human-required");
    const blockedOnCapability = findings.filter((finding) => finding.routing === "blocked-on-capability");

    return {
      conceptId: concept.conceptId,
      findings,
      machineApplicable,
      humanRequired,
      blockedOnCapability,
      ready: findings.length === 0,
    };
  });

  return {
    concepts,
    setFindings,
    divergent: divergence.divergent,
    readyConceptIds: concepts.filter((critique) => critique.ready).map((critique) => critique.conceptId),
    blockedConceptIds: concepts
      .filter((critique) => critique.blockedOnCapability.length > 0 && critique.humanRequired.length === 0)
      .map((critique) => critique.conceptId),
  };
}

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------

export interface ConceptRevision {
  readonly conceptId: string;
  readonly parentConceptId: string;
  readonly pass: number;
  readonly appliedCodes: readonly string[];
  /** Findings this pass deliberately did not touch, with the reason. */
  readonly deferred: readonly { readonly finding: CritiqueFinding; readonly reason: string }[];
}

export interface RevisionResult {
  readonly concept: CreativeConcept;
  readonly revisions: readonly ConceptRevision[];
  readonly stoppedBecause: "nothing-machine-applicable" | "no-further-change" | "max-passes-reached";
  readonly outstanding: readonly CritiqueFinding[];
}

const DEFERRAL_REASONS: Readonly<Record<CritiqueRouting, string>> = {
  "machine-applicable": "",
  "human-required":
    "This needs a creative decision. Rewriting it automatically would optimise the check rather than the video, and " +
    "the quality review already declares these dimensions human-owned.",
  "blocked-on-capability":
    "The capability this concept needs does not exist yet. The concept is preserved and reported rather than " +
    "silently weakened to fit what the renderer can currently do.",
};

/**
 * Apply only what a machine may honestly apply.
 *
 * Deterministic and bounded. `maxPasses` is a safety bound, not a quality
 * target: the loop stops as soon as a pass changes nothing.
 */
export function reviseConcept(
  concept: CreativeConcept,
  input: Omit<CritiqueInput, "concepts">,
  maxPasses = 3,
): RevisionResult {
  let current = concept;
  const revisions: ConceptRevision[] = [];
  let stoppedBecause: RevisionResult["stoppedBecause"] = "max-passes-reached";

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const critique = critiqueConceptSet({ ...input, concepts: [current] }).concepts[0];

    if (critique.machineApplicable.length === 0) {
      stoppedBecause = pass === 1 ? "nothing-machine-applicable" : "no-further-change";
      break;
    }

    const next = applyMachineFixes(current, critique.machineApplicable);
    if (JSON.stringify(next) === JSON.stringify(current)) {
      stoppedBecause = "no-further-change";
      break;
    }

    revisions.push({
      conceptId: `${concept.conceptId}-r${pass}`,
      parentConceptId: current.conceptId,
      pass,
      appliedCodes: critique.machineApplicable.map((finding) => finding.code),
      deferred: [...critique.humanRequired, ...critique.blockedOnCapability].map((finding) => ({
        finding,
        reason: DEFERRAL_REASONS[finding.routing],
      })),
    });
    current = { ...next, conceptId: `${concept.conceptId}-r${pass}` };
  }

  const finalCritique = critiqueConceptSet({ ...input, concepts: [current] }).concepts[0];
  return {
    concept: current,
    revisions,
    stoppedBecause,
    outstanding: finalCritique.findings,
  };
}

function applyMachineFixes(concept: CreativeConcept, findings: readonly CritiqueFinding[]): CreativeConcept {
  let next = concept;
  for (const finding of findings) {
    if (finding.code === "visual-never-used") {
      // Dropping a visual nothing shows is not a creative judgement: it removes
      // something the viewer was never going to see.
      const shown = new Set(next.beats.flatMap((beat) => beat.visualIds));
      next = { ...next, visuals: next.visuals.filter((visual) => shown.has(visual.visualId)) };
    }
  }
  return next;
}
