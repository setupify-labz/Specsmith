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

  // Concepts about one audience problem SHOULD share a core truth. They should
  // not leave the viewer with the identical takeaway, because then only one of
  // them needed to exist.
  const takeaways = new Map<string, string[]>();
  for (const concept of concepts) {
    const key = normalizeTakeaway(concept.viewerTakeaway);
    takeaways.set(key, [...(takeaways.get(key) ?? []), concept.conceptId]);
  }
  for (const ids of takeaways.values()) {
    if (ids.length > 1) {
      findings.push({
        code: "shared-viewer-takeaway",
        conceptIds: ids,
        detail: "These concepts leave the viewer with the same takeaway, so only one of them needed to be made.",
      });
    }
  }

  return { findings, divergent: findings.length === 0, axisSpread };
}
