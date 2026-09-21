// The machine-readable record of what the V2 Content Machine expansion has
// actually built, and what it has not.
//
// WHY THIS IS CODE AND NOT A MARKDOWN CHECKLIST
// ---------------------------------------------
// A roadmap document drifts from the repository within days. This ledger is
// validated by a test that reads the real source tree: a capability cannot be
// marked `integrated` unless the module it names exists and something imports
// it, and cannot be marked `verified` unless a test file covers it. The
// statuses therefore mean what they say rather than what someone hoped.
//
// THE STATUSES, AND THE DIFFERENCE BETWEEN THEM
// ----------------------------------------------
// The distinction that matters most here is between `implemented` and
// `integrated`. A module that exists, compiles and has tests but nothing calls
// is architecture theatre — it is `implemented`, never `integrated`, and it
// should be deleted rather than left to rot. `verified` additionally requires
// evidence that removing or breaking it changes behaviour.

export type CapabilityStatus =
  | "not-started"
  | "in-progress"
  /** Module exists with tests, but NOTHING in the real pipeline calls it. */
  | "implemented"
  /** A real production caller consumes its output and acts on it. */
  | "integrated"
  /** Integrated, plus negative controls prove it is load-bearing. */
  | "verified"
  /** Cannot proceed without something outside this repository. */
  | "blocked-external"
  /** Cannot proceed without a person's perception or decision. */
  | "blocked-human"
  /** Considered and deliberately not built. The reason is the point. */
  | "rejected-not-useful";

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "not-started", "in-progress", "implemented", "integrated", "verified",
  "blocked-external", "blocked-human", "rejected-not-useful",
];

export interface CapabilityRecord {
  /** Roadmap section number, so this maps onto the brief without ambiguity. */
  readonly section: number;
  readonly name: string;
  readonly status: CapabilityStatus;
  /** Source modules this capability lives in, relative to content-automator/. */
  readonly modules: readonly string[];
  /** What actually calls it in production. Empty unless integrated or better. */
  readonly callers: readonly string[];
  /** Test files covering it. */
  readonly tests: readonly string[];
  /**
   * Required for every status that is not `verified`. States plainly what is
   * missing, so a reader never has to guess whether something is unfinished or
   * deliberately excluded.
   */
  readonly note: string;
}

/**
 * THE LEDGER.
 *
 * Statuses here are deliberately conservative. Several roadmap sections depend
 * on performance data that does not exist yet — not one SpecSmith creative has
 * ever been published — and the brief forbids fabricating sample production
 * data. Those are `blocked-external` with the boundary implemented, which is
 * the honest state, not a failure to try.
 */
export const CAPABILITY_LEDGER: readonly CapabilityRecord[] = [
  {
    section: 1,
    name: "Creative Director layer (CreativeQualityReview)",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Scores the generated storyboard and its real caption cues. Every dimension carries provenance; dimensions needing human or model perception are emitted as not-assessed WITH a reason rather than given an invented number.",
  },
  {
    section: 2,
    name: "Beat-level targeted repair",
    status: "verified",
    modules: ["v2/beatRepair.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/beatRepair.test.ts"],
    note: "Rewrites only the beats a review names, asserts every other beat survives byte for byte, records lineage, and rejects a pass that neither raises the score nor clears a hard failure. The repaired storyboard is what the production plan is then built from.",
  },
  {
    section: 3,
    name: "Composition intelligence / visual worlds",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Requires the generated-plan render path from PR #92, which is unmerged. On this branch the pipeline still renders a hand-authored smoke timeline, so a visual-world system would have no renderer to drive and could not be shown to change any output.",
  },
  {
    section: 4,
    name: "Shot diversity / anti-repetition",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Measured within one video from real beat visual directions and on-screen text. Cross-video fatigue needs a corpus of published creatives, which does not exist yet: see section 13.",
  },
  {
    section: 5,
    name: "Pacing intelligence",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Hook duration, beat duration spread, dead time and visual-change frequency measured against per-format envelopes. The envelopes are starting values, explicitly NOT derived from performance data, because there is none.",
  },
  {
    section: 6,
    name: "Typography / visual hierarchy rules",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Caption line count and line length measured against the wrapping the burned-in renderer actually performs, not a separate rule. Relative type size and weight are composition properties and are reported as not-assessed.",
  },
  {
    section: 7,
    name: "Motion-design primitives",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Same dependency as section 3: the compositor consumes a generated visual timeline only on PR #92's branch. Motion primitives with no compositor to execute them would have no real consumer.",
  },
  {
    section: 8,
    name: "Hook intelligence and fatigue",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Hook families already exist in creativeFingerprint. Learning which of them perform requires published creatives with analytics, and zero have ever been published. Inventing sample performance would fabricate the evidence the feature exists to read.",
  },
  {
    section: 9,
    name: "Narrative structure",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Opening on a hook, closing on a CTA, carrying an evidence beat and a payoff or reversal, and not repeating one narrative move twice in a row, are ordering facts about the storyboard and are measured. Whether the payoff satisfies the promise is reported as not-assessed.",
  },
  {
    section: 10,
    name: "Brand consistency",
    status: "in-progress",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "The review emits branding-consistency as not-assessed with the reason: no visual brand reference is captured anywhere in this repository, so there is nothing to compare rendered frames against. The boundary is real; the comparison is not built.",
  },
  {
    section: 11,
    name: "Audio-quality intelligence",
    status: "in-progress",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Objective loudness, true peak, clipping and dead-air are scored when ffmpeg evidence is supplied. Voice naturalness is never machine-scored and PR #92's human listening gate is untouched and unweakened.",
  },
  {
    section: 12,
    name: "Caption intelligence",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Words per caption, dwell time, reading speed and cue overlap measured from the cues the renderer will actually burn in, shared with productionPlan so there is one source of truth.",
  },
  {
    section: 13,
    name: "Creative fatigue detection",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Needs a corpus of recently published creatives. The publication store is empty until the first real rehearsal publishes something.",
  },
  {
    section: 14,
    name: "Winner remixing",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Requires a creative with enough performance evidence to be called a winner. None exists, and naming one without evidence would be the exact fabrication this repository forbids.",
  },
  {
    section: 15,
    name: "Loser diagnosis",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Same dependency as section 14: a diagnosis of why something underperformed requires a measured underperformance.",
  },
  {
    section: 16,
    name: "Explore / exploit balance",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Exploitation requires something known to work. With zero published creatives every choice is exploration, and a ratio computed over an empty history would be arithmetic on nothing.",
  },
  {
    section: 17,
    name: "Per-platform strategy",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "Hook, beat and dead-time envelopes differ per platform and are asserted to differ: the same storyboard passes for YouTube Shorts and fails for TikTok. Which envelope performs better is section 23's question and is unanswered.",
  },
  {
    section: 18,
    name: "Series and franchise planning",
    status: "not-started",
    modules: [],
    callers: [],
    tests: [],
    note: "Nothing in the pipeline generates more than one creative per idea, so a series planner would have no production consumer. It is deferred rather than blocked: no external evidence is missing, only a caller.",
  },
  {
    section: 19,
    name: "Subject / opportunity scoring",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Needs real search-demand, impression or trend signals. No such source is connected on this branch, and inventing trend data is forbidden.",
  },
  {
    section: 20,
    name: "Experiment design",
    status: "in-progress",
    modules: ["types.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["creativeFingerprint.test.ts"],
    note: "The design half is real: each ranked idea carries a hypothesis, a primary metric and the variables held constant, and the pipeline sets them. Evaluating an experiment requires results, which do not exist, so the readout half is blocked.",
  },
  {
    section: 21,
    name: "Creative memory / fingerprinting",
    status: "verified",
    modules: ["creativeFingerprint.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["creativeFingerprint.test.ts"],
    note: "Every creative's structural DNA is recorded and persisted with the publication ledger, so a future learner can attribute performance to construction choices. The memory is being written now even though nothing can read it yet.",
  },
  {
    section: 22,
    name: "Quality separated from performance",
    status: "verified",
    modules: ["v2/creativeQualityReview.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts"],
    note: "productionQualityScore is computed only from construction evidence, nothing in the module imports the learner, and a test asserts the score is identical regardless of when it ran. A viral ugly video cannot teach this system that ugly is good.",
  },
  {
    section: 23,
    name: "Cross-video benchmarking",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "A baseline requires published history. Inventing one would manufacture the statistical significance the brief explicitly forbids.",
  },
  {
    section: 24,
    name: "Quality thresholds",
    status: "in-progress",
    modules: ["v2/creativeQualityReview.ts", "v2/beatRepair.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/creativeQualityReview.test.ts", "v2/beatRepair.test.ts"],
    note: "Construction thresholds are real and enforced: pacing envelopes, caption reading speed, the repair loop's minimum improvement and its quality target. Performance thresholds are blocked on section 23.",
  },
  {
    section: 25,
    name: "A/B candidate generation",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Generating two variants is cheap; deciding between them requires a readout that does not exist. Shipping a generator whose result nobody can evaluate would be architecture theatre.",
  },
  {
    section: 26,
    name: "Cost accounting",
    status: "not-started",
    modules: [],
    callers: [],
    tests: [],
    note: "No paid API is called anywhere on this branch — narration is local espeak-ng, the Metricool REST publisher is inert — so there is no spend to account for. A cost ledger recording zero would imply measurement that never happened.",
  },
  {
    section: 27,
    name: "Dashboard data model",
    status: "not-started",
    modules: [],
    callers: [],
    tests: [],
    note: "Section 34's CONTENT_CREATIVE_REPORT is already the structured data a dashboard would render, and no second data source exists to combine with it. A separate dashboard model would duplicate it without adding information.",
  },
  {
    section: 28,
    name: "Recommendation generation",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "The brief's own rule is: no evidence, no recommendation. There is no performance evidence yet, so no recommendation can be honestly generated.",
  },
  {
    section: 29,
    name: "Contradiction protection",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "Protecting against contradictory evidence requires at least two pieces of evidence. There are none.",
  },
  {
    section: 30,
    name: "Strategy planner",
    status: "blocked-external",
    modules: [],
    callers: [],
    tests: [],
    note: "A planner allocating effort across formats and platforms needs the performance signal of sections 23 and 28 to allocate against.",
  },
  {
    section: 31,
    name: "Anti-slop rules",
    status: "verified",
    modules: ["v2/antiSlop.ts"],
    callers: ["v2/creativeQualityReview.ts"],
    tests: ["v2/antiSlop.test.ts"],
    note: "Detects fake urgency, unsupported superlatives, claims of measurements SpecSmith never performed, generic filler, emoji spam, repeated captions and undelivered clickbait, before any of it can be rendered. Tested to stay silent on honest comparison prose.",
  },
  {
    section: 32,
    name: "Evidence integrity preserved",
    status: "verified",
    modules: ["v2/antiSlop.ts", "qualityReviewer.ts"],
    callers: ["v2/creativeQualityReview.ts", "endToEndOfflinePipeline.ts"],
    tests: ["v2/antiSlop.test.ts", "qualityReviewer.test.ts"],
    note: "The existing price-provenance and estimated-versus-measured rules are unchanged, and generated copy is additionally blocked from claiming a benchmark SpecSmith never ran.",
  },
  {
    section: 33,
    name: "Regression protection for the ledger itself",
    status: "verified",
    modules: ["v2/capabilityLedger.ts"],
    callers: ["v2/capabilityLedger.test.ts"],
    tests: ["v2/capabilityLedger.test.ts"],
    note: "This ledger is validated against the real source tree: a capability cannot claim integrated unless a named caller genuinely imports one of its modules, nor verified without an existing test file. Marking something done requires doing it.",
  },
  {
    section: 34,
    name: "CONTENT_CREATIVE_REPORT",
    status: "verified",
    modules: ["v2/contentCreativeReport.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/contentCreativeReport.test.ts"],
    note: "One structured report binding identity, media SHA, fingerprint, quality, revision lineage and the human gates still outstanding. publishReady is false while any gate is undecided, and no machine score can close one.",
  },
  {
    section: 35,
    name: "Explicit stop conditions",
    status: "verified",
    modules: ["v2/beatRepair.ts"],
    callers: ["endToEndOfflinePipeline.ts"],
    tests: ["v2/beatRepair.test.ts"],
    note: "The repair loop stops on a named condition — no fixes remaining, quality target met, no further improvement, or the pass ceiling — and the reason is reported rather than the loop silently exhausting a budget.",
  },
];

export function ledgerByStatus(status: CapabilityStatus): readonly CapabilityRecord[] {
  return CAPABILITY_LEDGER.filter((record) => record.status === status);
}

/** Renders the ledger for a human, grouped by status. */
export function formatLedger(records: readonly CapabilityRecord[] = CAPABILITY_LEDGER): string {
  const lines: string[] = [];
  for (const status of CAPABILITY_STATUSES) {
    const group = records.filter((record) => record.status === status);
    if (group.length === 0) continue;
    lines.push(`${status} (${group.length}):`);
    for (const record of group.slice().sort((a, b) => a.section - b.section)) {
      lines.push(`  §${record.section} ${record.name}`);
      if (record.status !== "verified") lines.push(`      ${record.note}`);
    }
  }
  return lines.join("\n");
}
