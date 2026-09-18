// SYNTHETIC_ENGINEERING_FIXTURE — strategic signals for testing only.
//
// Every bundle here is marked `synthetic: true`, and `parseSignalBundle` refuses
// synthetic input whenever `allowSynthetic` is false. Nothing in this file
// describes a real product, a real launch, a real search volume or a real
// community. The numbers are chosen to trip specific guards.
//
// WHY THE FIXTURES ARE MOSTLY HOSTILE
// -----------------------------------
// A fixture that lets the system succeed proves only that the happy path runs.
// These are built so the correct answer is usually "no", because refusing well
// is the harder half: an attractive opportunity resting on a stale price, a
// "trend" with no trend source, a high-commission recommendation with no
// evidence, a product CTA to a surface that is not shipped.

import type { StrategyProvenance } from "./model.ts";

/** The marker that makes fixture data unmistakable in any dump or log. */
export const SYNTHETIC_MARKER = "SYNTHETIC_ENGINEERING_FIXTURE";

function syntheticProvenance(at: string): StrategyProvenance {
  return { synthetic: true, producedBy: SYNTHETIC_MARKER, producedAt: at };
}

const DAY = 24 * 3_600_000;

/**
 * The bundle where nothing is connected.
 *
 * This is the closest fixture to production reality: no search, no trends, no
 * community, no competitor survey. Only product state is known, because
 * SpecSmith can read its own routes.
 */
export function fixtureNoSignals(now: Date): unknown {
  const at = now.toISOString();
  return {
    bundleId: `${SYNTHETIC_MARKER}-no-signals`,
    capturedAt: at,
    search: [],
    community: [],
    trends: [],
    competitors: [],
    productState: [
      { surface: "builder", readiness: "shipped", route: "/builder", evidence: "Route exists in the prerendered sitemap." },
      { surface: "compare", readiness: "shipped", route: "/compare", evidence: "Route exists in the prerendered sitemap." },
      { surface: "upgrade", readiness: "shipped", route: "/upgrade", evidence: "Route exists in the prerendered sitemap." },
    ],
    provenance: syntheticProvenance(at),
  };
}

/**
 * A bundle with real-shaped signals, for exercising the paths that need them.
 *
 * Note the deliberate mixture: one query above the impression floor and one
 * below it, one question above the community floor and one below, a rising trend
 * and a three-point series that is long enough to read.
 */
export function fixtureRichSignals(now: Date): unknown {
  const at = now.toISOString();
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return {
    bundleId: `${SYNTHETIC_MARKER}-rich-signals`,
    capturedAt: at,
    search: [
      { query: "example gpu-a upgrade worth it", impressions: 1400, clicks: 90, position: 8.2, observedAt: ago(1), previousImpressions: 900 },
      // Below MIN_SEARCH_IMPRESSIONS: must read as unknown, never as "low demand".
      { query: "example gpu-a coil whine", impressions: 3, clicks: 0, position: 44, observedAt: ago(1), previousImpressions: null },
    ],
    community: [
      { question: "example gpu-a upgrade worth it", observationCount: 31, firstObservedAt: ago(40), lastObservedAt: ago(1) },
      // Below MIN_COMMUNITY_OBSERVATIONS: one person asking is not a cluster.
      { question: "example gpu-a coil whine", observationCount: 1, firstObservedAt: ago(3), lastObservedAt: ago(3) },
    ],
    trends: [
      { subject: "example gpu-a upgrade worth it", series: [
        { at: ago(21), value: 100 }, { at: ago(14), value: 160 }, { at: ago(7), value: 240 },
      ] },
    ],
    competitors: [
      { question: "example gpu-a upgrade worth it", observedCoveringPieces: 2, weaknessesObserved: ["no interactive tool", "no compatibility context"] },
    ],
    productState: [
      { surface: "builder", readiness: "shipped", route: "/builder", evidence: "Route exists." },
      { surface: "compare", readiness: "shipped", route: "/compare", evidence: "Route exists." },
      { surface: "upgrade", readiness: "shipped", route: "/upgrade", evidence: "Route exists." },
    ],
    provenance: syntheticProvenance(at),
  };
}

/**
 * A bundle where the product surface is NOT shipped.
 *
 * The guard this exercises: content may not point an audience at, or promise
 * the behaviour of, a surface that does not exist. A planned feature is not a
 * feature.
 */
export function fixtureProductNotReady(now: Date): unknown {
  const at = now.toISOString();
  return {
    bundleId: `${SYNTHETIC_MARKER}-product-not-ready`,
    capturedAt: at,
    search: [],
    community: [],
    trends: [],
    competitors: [],
    productState: [
      { surface: "builder", readiness: "planned", evidence: "Named in the roadmap; no route exists." },
      { surface: "compare", readiness: "partial", evidence: "Reachable but incomplete; not good enough to send an audience to." },
      { surface: "upgrade", readiness: "absent", evidence: "No such surface." },
    ],
    provenance: syntheticProvenance(at),
  };
}

/**
 * A bundle asserting a trend with a series too short to read.
 *
 * Two points cannot describe a direction. The correct answer is `unknown` with
 * `insufficient-sample`, and an opportunity built on it must not claim urgency.
 */
export function fixtureFakeTrend(now: Date): unknown {
  const at = now.toISOString();
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return {
    bundleId: `${SYNTHETIC_MARKER}-fake-trend`,
    capturedAt: at,
    search: [],
    community: [],
    trends: [{ subject: "example gpu-a is trending", series: [{ at: ago(2), value: 10 }, { at: ago(1), value: 900 }] }],
    competitors: [],
    productState: [{ surface: "compare", readiness: "shipped", route: "/compare", evidence: "Route exists." }],
    provenance: syntheticProvenance(at),
  };
}

/**
 * A bundle claiming competitive whitespace from a survey that covers nothing.
 *
 * Zero observed pieces for a question the survey does not cover is `unknown`,
 * not `whitespace` — "we did not look" is not "nobody does this".
 */
export function fixtureEmptyCompetitorSurvey(now: Date): unknown {
  const at = now.toISOString();
  return {
    bundleId: `${SYNTHETIC_MARKER}-empty-survey`,
    capturedAt: at,
    search: [],
    community: [],
    trends: [],
    competitors: [{ question: "something else entirely", observedCoveringPieces: 0, weaknessesObserved: [] }],
    productState: [{ surface: "compare", readiness: "shipped", route: "/compare", evidence: "Route exists." }],
    provenance: syntheticProvenance(at),
  };
}

/**
 * A portfolio history, for exercising duplication and saturation.
 *
 * `complete: true` is what makes these checks meaningful — with an incomplete
 * history every verdict is `unknown`, which is the honest production answer but
 * proves nothing about the logic.
 */
export function fixturePortfolioHistory(now: Date) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return {
    complete: true,
    note: `${SYNTHETIC_MARKER}: a fabricated publication history for engineering tests only.`,
    entries: [
      { entryId: "fixture-entry-1", publishedAt: ago(3), pillar: "gpu-comparisons" as const, type: "comparison" as const,
        objective: "shareable-comparison" as const, thesis: "Example GPU-A is faster than GPU-B",
        subjectIds: ["example-gpu-a", "example-gpu-b"], angleId: "angle-gpu-comparisons-blind", formatClass: "blind-comparison" },
      { entryId: "fixture-entry-2", publishedAt: ago(6), pillar: "gpu-comparisons" as const, type: "comparison" as const,
        objective: "shareable-comparison" as const, thesis: "Example GPU-C beats GPU-D at 1440p",
        subjectIds: ["example-gpu-c", "example-gpu-d"], angleId: "angle-gpu-comparisons-side", formatClass: "side-by-side" },
      { entryId: "fixture-entry-3", publishedAt: ago(9), pillar: "gpu-comparisons" as const, type: "comparison" as const,
        objective: "shareable-comparison" as const, thesis: "Example GPU-E versus GPU-F",
        subjectIds: ["example-gpu-e", "example-gpu-f"], angleId: "angle-gpu-comparisons-blind", formatClass: "blind-comparison" },
      { entryId: "fixture-entry-4", publishedAt: ago(12), pillar: "gpu-comparisons" as const, type: "comparison" as const,
        objective: "shareable-comparison" as const, thesis: "Example GPU-G against GPU-H",
        subjectIds: ["example-gpu-g", "example-gpu-h"], angleId: "angle-gpu-comparisons-side", formatClass: "side-by-side" },
      { entryId: "fixture-entry-5", publishedAt: ago(15), pillar: "gpu-comparisons" as const, type: "comparison" as const,
        objective: "shareable-comparison" as const, thesis: "Example GPU-I or GPU-J",
        subjectIds: ["example-gpu-i", "example-gpu-j"], angleId: "angle-gpu-comparisons-blind", formatClass: "blind-comparison" },
    ],
  };
}
