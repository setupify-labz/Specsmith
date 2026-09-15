// MASTER #6 — Concept divergence (capability #4 from the section-1 critique).
//
// WHY THIS EXISTS
//
// The brief asked for three GENUINELY different creative packages, and section 1
// found that the honest definition of "different" is not wording: it is the
// three axes in `concept.ts`. Two concepts that open with different sentences
// and then do the same thing on screen produce identical rows.
//
// This module makes that checkable, and it deliberately checks STRUCTURE rather
// than text. A text-similarity score would be trivially defeated by a thesaurus
// and would punish two genuinely different concepts that happen to share the
// subject's vocabulary — which, for a set of concepts about one audience
// problem, is all of them.
//
// A set is divergent when no two concepts share all three axes, and when the set
// as a whole exercises more than one value on at least two axes. The second rule
// matters: three concepts that all differ only on visual mechanism are three
// versions of one idea.
//
// What this module does NOT do: judge which concept is better, score
// originality, or reject a concept for being similar to something in memory.
// Taste stays human (`HUMAN_ONLY_DIMENSIONS`).

import type { CreativeAxes, CreativeConcept } from "./concept.ts";

export type DivergenceCode =
  | "identical-axes"
  | "single-axis-variation"
  | "shared-viewer-takeaway"
  | "duplicate-treatment"
  | "too-few-concepts";

export interface DivergenceFinding {
  readonly code: DivergenceCode;
  readonly conceptIds: readonly string[];
  readonly detail: string;
}

export interface DivergenceReport {
  readonly findings: readonly DivergenceFinding[];
  readonly divergent: boolean;
  /** How many distinct values the set uses on each axis. */
  readonly axisSpread: {
    readonly audienceExperience: number;
    readonly explanatoryStructure: number;
    readonly visualMechanism: number;
  };
}

function axesKey(axes: CreativeAxes): string {
  return `${axes.audienceExperience}|${axes.explanatoryStructure}|${axes.visualMechanism}`;
}

function normalizeTakeaway(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function assessDivergence(concepts: readonly CreativeConcept[]): DivergenceReport {
  const findings: DivergenceFinding[] = [];

  const axisSpread = {
    audienceExperience: new Set(concepts.map((concept) => concept.axes.audienceExperience)).size,
    explanatoryStructure: new Set(concepts.map((concept) => concept.axes.explanatoryStructure)).size,
    visualMechanism: new Set(concepts.map((concept) => concept.axes.visualMechanism)).size,
  };

  if (concepts.length < 2) {
    findings.push({
      code: "too-few-concepts",
      conceptIds: concepts.map((concept) => concept.conceptId),
      detail: "Divergence is a property of a set. A single concept cannot be shown to be different from anything.",
    });
    return { findings, divergent: false, axisSpread };
  }

  const byKey = new Map<string, string[]>();
  for (const concept of concepts) {
    const key = axesKey(concept.axes);
    byKey.set(key, [...(byKey.get(key) ?? []), concept.conceptId]);
  }
  for (const [key, ids] of byKey) {
    if (ids.length > 1) {
      findings.push({
        code: "identical-axes",
        conceptIds: ids,
        detail:
          `These concepts occupy the same point (${key}) on all three axes. Whatever differs between them is ` +
          "wording, and wording is not a different creative package.",
      });
    }
  }

  const axesVaried = Object.values(axisSpread).filter((count) => count > 1).length;
  if (axesVaried < 2) {
    findings.push({
      code: "single-axis-variation",
      conceptIds: concepts.map((concept) => concept.conceptId),
      detail:
        "The set varies on fewer than two axes, so these are versions of one idea rather than genuinely different " +
        "approaches to the problem.",
    });
  }

  // A shared answer is expected for controlled creative treatments. Check the
  // actual beat content instead: changing three self-declared labels must not
  // make identical scripts look original. This is not a semantic originality test.
  const treatments = new Map<string, string[]>();
  for (const concept of concepts) {
    const key = JSON.stringify(concept.beats.map((beat) => [beat.purpose,
      normalizeTakeaway(beat.narration), normalizeTakeaway(beat.onScreenText),
      beat.visualIds.map((id) => concept.visuals.find((visual) => visual.visualId === id)?.kind)]));
    treatments.set(key, [...(treatments.get(key) ?? []), concept.conceptId]);
  }
  for (const ids of treatments.values()) {
    if (ids.length > 1) {
      findings.push({
        code: "duplicate-treatment",
        conceptIds: ids,
        detail: "These concepts contain the same treatment despite their labels; a distinct answer is not required, but distinct creative execution is.",
      });
    }
  }

  return { findings, divergent: findings.length === 0, axisSpread };
}
