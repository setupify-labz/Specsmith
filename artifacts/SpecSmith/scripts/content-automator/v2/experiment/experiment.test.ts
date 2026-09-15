// MASTER #5 — Adversarial tests for design, assignment, lineage and windows.
//
// Every test here is an attempt to manufacture evidence: reassign a creative
// after seeing results, count one video five times, substitute a window,
// convert a missing metric to zero, or slip an integrity dimension in as a
// creative variable. They are written as attacks because that is how these
// failures actually arrive — as a reasonable-sounding shortcut.

import { describe, expect, it } from "vitest";

import {
  dimensionIsForbidden,
  earlyStopPermitted,
  generalizationPermitted,
  strengthPermitsReuse,
  validityPermitsCausalReading,
  widestPermittedGeneralization,
  type Experiment,
} from "./model.ts";
import {
  checkAgainstPreregistration,
  computeDesignHash,
  ExperimentDesignError,
  ExperimentRegistry,
  registerExperiment,
  validateDesign,
} from "./registry.ts";
import {
  AssignmentError,
  AssignmentLedger,
  countIndependentUnits,
  detectSelectionBias,
  relationIsIndependent,
} from "./assignment.ts";
import {
  assertOneObservationPerCreative,
  buildObservation,
  ObservationError,
  ObservationStore,
  windowStatus,
  WINDOW_TOLERANCE_HOURS,
} from "./observation.ts";
import { lookupMetric, measuredValue, primaryMetricSuitsObjective, readingFromRaw } from "./metrics.ts";
import {
  FIXTURE_IDS,
  FIXTURE_PUBLISHED_AT,
  FIXTURE_SHAS,
  fixtureCleanExperiment,
  fixtureControlAnalytics,
  fixtureCorrelatedLineage,
  fixtureLineage,
  fixtureVariantAnalytics,
  SYNTHETIC_MARKER,
} from "./engineeringFixture.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;
const PRODUCTION = { allowSynthetic: false } as const;

function registered(): Experiment {
  return registerExperiment(fixtureCleanExperiment(NOW), NOW).experiment;
}

function boundLedger(): AssignmentLedger {
  const ledger = new AssignmentLedger();
  const experiment = registered();
  ledger.bind({
    experimentId: experiment.experimentId,
    experimentRevision: 1,
    variantId: FIXTURE_IDS.controlVariantId,
    creativeId: FIXTURE_IDS.controlCreativeId,
    creativeLineageId: FIXTURE_IDS.controlLineageId,
    platform: "youtube-shorts",
    packageId: FIXTURE_IDS.packageId,
    approvedMediaSha256: FIXTURE_SHAS.control,
    providerPostId: FIXTURE_IDS.controlPostId,
    publishedAt: FIXTURE_PUBLISHED_AT,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });
  ledger.bind({
    experimentId: experiment.experimentId,
    experimentRevision: 1,
    variantId: FIXTURE_IDS.variantId,
    creativeId: FIXTURE_IDS.variantCreativeId,
    creativeLineageId: FIXTURE_IDS.variantLineageId,
    platform: "youtube-shorts",
    packageId: FIXTURE_IDS.packageId,
    approvedMediaSha256: FIXTURE_SHAS.variant,
    providerPostId: FIXTURE_IDS.variantPostId,
    publishedAt: FIXTURE_PUBLISHED_AT,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });
  return ledger;
}

describe("design validation refuses uninterpretable experiments", () => {
  it("accepts the clean fixture design", () => {
    expect(validateDesign(fixtureCleanExperiment(NOW)).filter((f) => f.severity === "hard-fail")).toEqual([]);
  });

  it("refuses an integrity dimension as a creative variable", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const hostile: Experiment = {
      ...experiment,
      variants: experiment.variants.map((variant) =>
        variant.isControl
          ? variant
          : {
              ...variant,
              differences: [{ dimension: "estimate-label" as never, control: "present", variant: "removed", rationale: "shorter" }],
            },
      ),
    };
    const findings = validateDesign(hostile);
    expect(findings.map((f) => f.code)).toContain("forbidden-dimension");
    expect(findings.find((f) => f.code === "forbidden-dimension")?.message).toMatch(/never be bought by weakening it/);
  });

  it("names every forbidden dimension so none can be proposed", () => {
    for (const dimension of ["factual-claim", "required-wording", "estimate-label", "accessibility-captions", "human-audio-review"]) {
      expect(dimensionIsForbidden(dimension), dimension).toBe(true);
    }
    expect(dimensionIsForbidden("hook-form")).toBe(false);
  });

  it("refuses a variant that declares no difference", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const hostile: Experiment = {
      ...experiment,
      variants: experiment.variants.map((v) => (v.isControl ? v : { ...v, differences: [] })),
    };
    expect(validateDesign(hostile).map((f) => f.code)).toContain("variant-has-no-difference");
  });

  it("refuses an education mission decided on click-through", () => {
    const check = primaryMetricSuitsObjective("educate-new-builders", "site-clicks", "youtube-shorts");
    expect(check.permitted).toBe(false);
    expect(check.reason).toMatch(/that is a strategy change, not a metric choice/);
  });

  it("refuses views as a primary decision metric", () => {
    const check = primaryMetricSuitsObjective("educate-new-builders", "views", "youtube-shorts");
    expect(check.permitted).toBe(false);
    expect(check.reason).toMatch(/not eligible as a primary decision metric/);
  });

  it("refuses a design with no stop conditions", () => {
    const experiment = { ...fixtureCleanExperiment(NOW), stopConditions: [] };
    const findings = validateDesign(experiment);
    expect(findings.map((f) => f.code)).toContain("no-stop-conditions");
    expect(findings.find((f) => f.code === "no-stop-conditions")?.message).toMatch(/stops when someone likes the numbers/);
  });

  it("refuses a hypothesis with no falsification condition", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const hostile = { ...experiment, hypothesis: { ...experiment.hypothesis, falsificationCondition: "nope" } };
    expect(validateDesign(hostile).map((f) => f.code)).toContain("no-falsification");
  });

  it("refuses an audience claim when the audience was unknown", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const hostile = {
      ...experiment,
      scope: { ...experiment.scope, audienceWasUnknown: true },
      hypothesis: { ...experiment.hypothesis, proposition: "For beginner viewers, result-first openings help." },
    };
    expect(validateDesign(hostile).map((f) => f.code)).toContain("audience-claimed-but-unknown");
  });

  it("refuses a design missing a mandatory guardrail", () => {
    const experiment = { ...fixtureCleanExperiment(NOW), guardrailMetricIds: ["mission-integrity"] };
    expect(validateDesign(experiment).map((f) => f.code)).toContain("missing-mandatory-guardrail");
  });

  it("refuses a hypothesis whose metric differs from the experiment's", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const hostile = { ...experiment, primaryMetricId: "saves" };
    expect(validateDesign(hostile).map((f) => f.code)).toContain("hypothesis-metric-mismatch");
  });

  it("warns that many tiny arms is exploration, not evidence", () => {
    const experiment = fixtureCleanExperiment(NOW);
    const many: Experiment = {
      ...experiment,
      variants: [
        experiment.variants[0],
        ...[1, 2, 3, 4].map((index) => ({
          variantId: `v${index}`,
          label: `v${index}`,
          isControl: false,
          differences: [{ dimension: "hook-form" as const, control: "question-first", variant: `form-${index}`, rationale: "r" }],
          description: "d",
        })),
      ],
    };
    expect(validateDesign(many).map((f) => f.code)).toContain("many-arms");
  });
});

describe("preregistration prevents post-hoc metric switching", () => {
  it("detects a primary metric changed after registration", () => {
    const { experiment, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    const switched = { ...experiment, primaryMetricId: "saves" };
    const check = checkAgainstPreregistration(switched, preregistration);
    expect(check.matches).toBe(false);
    expect(check.findings.map((f) => f.code)).toContain("primary-metric-changed");
    expect(check.findings.find((f) => f.code === "primary-metric-changed")?.message).toMatch(/any result become a win/);
  });

  it("detects a window changed after registration", () => {
    const { experiment, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    const check = checkAgainstPreregistration({ ...experiment, observationWindow: "7d" }, preregistration);
    expect(check.findings.map((f) => f.code)).toContain("window-changed");
  });

  it("detects a dropped arm after registration", () => {
    const { experiment, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    const dropped = { ...experiment, variants: [experiment.variants[0]] };
    const check = checkAgainstPreregistration(dropped, preregistration);
    expect(check.findings.map((f) => f.code)).toContain("variants-changed");
    expect(check.findings.find((f) => f.code === "variants-changed")?.message).toMatch(/survivorship bias/);
  });

  it("accepts an unchanged design", () => {
    const { experiment, preregistration } = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    expect(checkAgainstPreregistration(experiment, preregistration).matches).toBe(true);
  });

  it("hashes the design deterministically and ignores status", () => {
    const a = fixtureCleanExperiment(NOW);
    const b = { ...fixtureCleanExperiment(NOW), status: "running" as const, startedAt: NOW.toISOString() };
    expect(computeDesignHash(a)).toBe(computeDesignHash(b));
  });

  it("changes the hash when the primary metric changes", () => {
    const a = fixtureCleanExperiment(NOW);
    expect(computeDesignHash({ ...a, primaryMetricId: "saves" })).not.toBe(computeDesignHash(a));
  });

  it("refuses to register a design with hard failures", () => {
    expect(() => registerExperiment({ ...fixtureCleanExperiment(NOW), stopConditions: [] }, NOW)).toThrow(ExperimentDesignError);
  });
});

describe("the registry does not rewrite history", () => {
  it("is idempotent for an exact re-registration", () => {
    const registry = new ExperimentRegistry();
    const first = registry.register(fixtureCleanExperiment(NOW), NOW);
    const second = registry.register(fixtureCleanExperiment(NOW), NOW);
    expect(second.preregistration.designHash).toBe(first.preregistration.designHash);
    expect(registry.history(first.experiment.experimentId)).toHaveLength(1);
  });

  it("refuses a conflicting re-registration of the same revision", () => {
    const registry = new ExperimentRegistry();
    registry.register(fixtureCleanExperiment(NOW), NOW);
    // The metric must change on BOTH the experiment and its hypothesis, or the
    // design fails validation before the registry conflict can be reached.
    const changed = fixtureCleanExperiment(NOW);
    expect(() =>
      registry.register(
        {
          ...changed,
          primaryMetricId: "saves",
          secondaryMetricIds: ["average-percentage-viewed"],
          hypothesis: { ...changed.hypothesis, primaryMetricId: "saves" },
        },
        NOW,
      ),
    ).toThrow(/A changed design needs a new revision/);
  });

  it("creates a new revision and leaves the old one intact", () => {
    const registry = new ExperimentRegistry();
    const first = registry.register(fixtureCleanExperiment(NOW), NOW);
    const base = fixtureCleanExperiment(NOW);
    const second = registry.revise(
      first.experiment.experimentId,
      {
        primaryMetricId: "saves",
        secondaryMetricIds: ["average-percentage-viewed"],
        hypothesis: { ...base.hypothesis, primaryMetricId: "saves" },
      },
      NOW,
    );

    expect(second.experiment.revision).toBe(2);
    expect(registry.revision(first.experiment.experimentId, 1)?.experiment.primaryMetricId).toBe("stayed-to-watch-rate");
    expect(registry.revision(first.experiment.experimentId, 2)?.experiment.primaryMetricId).toBe("saves");
  });
});

describe("assignment cannot be moved after the fact", () => {
  it("refuses assigning one creative to two variants", () => {
    const ledger = boundLedger();
    expect(() =>
      ledger.bind({
        experimentId: FIXTURE_IDS.experimentId,
        experimentRevision: 1,
        variantId: FIXTURE_IDS.variantId,
        creativeId: FIXTURE_IDS.controlCreativeId,
        creativeLineageId: FIXTURE_IDS.controlLineageId,
        platform: "youtube-shorts",
        packageId: FIXTURE_IDS.packageId,
        approvedMediaSha256: FIXTURE_SHAS.control,
        providerPostId: FIXTURE_IDS.controlPostId,
        publishedAt: FIXTURE_PUBLISHED_AT,
        now: NOW,
      }),
    ).toThrow(/evidence for both sides of its own comparison/);
  });

  it("refuses binding one provider post to two creatives", () => {
    const ledger = boundLedger();
    expect(() =>
      ledger.bind({
        experimentId: FIXTURE_IDS.experimentId,
        experimentRevision: 1,
        variantId: FIXTURE_IDS.variantId,
        creativeId: "another-creative",
        creativeLineageId: "another-lineage",
        platform: "youtube-shorts",
        packageId: FIXTURE_IDS.packageId,
        approvedMediaSha256: FIXTURE_SHAS.variant,
        providerPostId: FIXTURE_IDS.controlPostId,
        publishedAt: FIXTURE_PUBLISHED_AT,
        now: NOW,
      }),
    ).toThrow(/attribute one post's analytics to two different videos/);
  });

  it("refuses a rebind to a different provider post", () => {
    const ledger = boundLedger();
    expect(() => ledger.recordPublication(FIXTURE_IDS.controlCreativeId, "different-post", FIXTURE_PUBLISHED_AT))
      .toThrow(/would move its analytics to a different published object/);
  });

  it("refuses an assignment whose media changed", () => {
    const ledger = boundLedger();
    expect(() =>
      ledger.bind({
        experimentId: FIXTURE_IDS.experimentId,
        experimentRevision: 1,
        variantId: FIXTURE_IDS.controlVariantId,
        creativeId: FIXTURE_IDS.controlCreativeId,
        creativeLineageId: FIXTURE_IDS.controlLineageId,
        platform: "youtube-shorts",
        packageId: FIXTURE_IDS.packageId,
        approvedMediaSha256: "c".repeat(64),
        providerPostId: FIXTURE_IDS.controlPostId,
        publishedAt: FIXTURE_PUBLISHED_AT,
        now: NOW,
      }),
    ).toThrow(/Different bytes are a different creative/);
  });

  it("refuses a loose media identifier", () => {
    const ledger = new AssignmentLedger();
    expect(() =>
      ledger.bind({
        experimentId: FIXTURE_IDS.experimentId,
        experimentRevision: 1,
        variantId: FIXTURE_IDS.controlVariantId,
        creativeId: FIXTURE_IDS.controlCreativeId,
        creativeLineageId: FIXTURE_IDS.controlLineageId,
        platform: "youtube-shorts",
        packageId: FIXTURE_IDS.packageId,
        approvedMediaSha256: "probably-this-video",
        providerPostId: null,
        publishedAt: null,
        now: NOW,
      }),
    ).toThrow(AssignmentError);
  });

  it("refuses assignment made after publication", () => {
    const ledger = new AssignmentLedger();
    expect(() =>
      ledger.bind({
        experimentId: FIXTURE_IDS.experimentId,
        experimentRevision: 1,
        variantId: FIXTURE_IDS.controlVariantId,
        creativeId: FIXTURE_IDS.controlCreativeId,
        creativeLineageId: FIXTURE_IDS.controlLineageId,
        platform: "youtube-shorts",
        packageId: FIXTURE_IDS.packageId,
        approvedMediaSha256: FIXTURE_SHAS.control,
        providerPostId: FIXTURE_IDS.controlPostId,
        publishedAt: "2026-08-01T00:00:00.000Z",
        now: NOW,
      }),
    ).toThrow(/cannot be distinguished from choosing the variant once the result was visible/);
  });

  it("is idempotent for an exact replay", () => {
    const ledger = boundLedger();
    const again = ledger.bind({
      experimentId: FIXTURE_IDS.experimentId,
      experimentRevision: 1,
      variantId: FIXTURE_IDS.controlVariantId,
      creativeId: FIXTURE_IDS.controlCreativeId,
      creativeLineageId: FIXTURE_IDS.controlLineageId,
      platform: "youtube-shorts",
      packageId: FIXTURE_IDS.packageId,
      approvedMediaSha256: FIXTURE_SHAS.control,
      providerPostId: FIXTURE_IDS.controlPostId,
      publishedAt: FIXTURE_PUBLISHED_AT,
      now: new Date("2026-08-31T12:00:00.000Z"),
    });
    expect(again.variantId).toBe(FIXTURE_IDS.controlVariantId);
  });
});

describe("sample size counts ideas, not placements", () => {
  it("counts two siblings as two independent units", () => {
    const breakdown = countIndependentUnits(fixtureLineage());
    expect(breakdown.independentUnitCount).toBe(2);
    expect(breakdown.correlatedGroups).toHaveLength(0);
  });

  it("does not count platform adaptations as extra units", () => {
    const breakdown = countIndependentUnits(fixtureCorrelatedLineage());
    expect(breakdown.rawPlacementCount).toBe(4);
    expect(breakdown.independentUnitCount).toBe(2);
    expect(breakdown.correlatedGroups).toHaveLength(1);
    expect(breakdown.correlatedGroups[0].why).toMatch(/not independent confirmations/);
  });

  it("treats a repost as correlated unless the design declared otherwise", () => {
    const withRepost = [
      ...fixtureLineage(),
      {
        creativeId: `${FIXTURE_IDS.variantCreativeId}-repost`,
        lineageId: FIXTURE_IDS.variantLineageId,
        parentCreativeId: FIXTURE_IDS.variantCreativeId,
        relation: "repost" as const,
        platform: "youtube-shorts" as const,
        topicId: FIXTURE_IDS.topicId,
      },
    ];
    expect(countIndependentUnits(withRepost).independentUnitCount).toBe(2);
    expect(relationIsIndependent("repost")).toBe(false);
    expect(relationIsIndependent("platform-adaptation")).toBe(false);
    expect(relationIsIndependent("topic-replication")).toBe(true);
  });

  it("counts a declared-independent repost when the design said so", () => {
    const withDeclared = [
      ...fixtureLineage(),
      {
        creativeId: `${FIXTURE_IDS.variantCreativeId}-repost`,
        lineageId: FIXTURE_IDS.variantLineageId,
        parentCreativeId: FIXTURE_IDS.variantCreativeId,
        relation: "repost" as const,
        platform: "youtube-shorts" as const,
        topicId: FIXTURE_IDS.topicId,
        declaredIndependentByDesign: true,
      },
    ];
    expect(countIndependentUnits(withDeclared).independentUnitCount).toBe(3);
  });
});

describe("selection bias is visible because assignments precede analysis", () => {
  it("detects an assigned creative missing from the analysis", () => {
    const ledger = boundLedger();
    const findings = detectSelectionBias(ledger.all(), [FIXTURE_IDS.controlCreativeId]);
    expect(findings.map((f) => f.code)).toContain("assigned-but-not-analysed");
    expect(findings[0].message).toMatch(/survivorship bias/);
  });

  it("detects an analysed creative that was never assigned", () => {
    const ledger = boundLedger();
    const findings = detectSelectionBias(ledger.all(), [
      FIXTURE_IDS.controlCreativeId,
      FIXTURE_IDS.variantCreativeId,
      "smuggled-creative",
    ]);
    expect(findings.map((f) => f.code)).toContain("analysed-but-not-assigned");
  });

  it("accepts a complete analysis", () => {
    const ledger = boundLedger();
    expect(detectSelectionBias(ledger.all(), [FIXTURE_IDS.controlCreativeId, FIXTURE_IDS.variantCreativeId])).toEqual([]);
  });
});

describe("windows are part of identity", () => {
  it("reports a window that has not elapsed as not-yet-due", () => {
    const status = windowStatus(FIXTURE_PUBLISHED_AT, "7d", new Date("2026-09-02T00:00:00.000Z"), false);
    expect(status.state).toBe("not-yet-due");
  });

  it("reports a long-overdue window as missed and refuses substitution", () => {
    const status = windowStatus(FIXTURE_PUBLISHED_AT, "24h", NOW, false);
    expect(status.state).toBe("missed");
    expect(status.explanation).toMatch(/may not be substituted with a neighbouring window/);
  });

  it("keeps a window collectable inside the stated tolerance", () => {
    const due = new Date(Date.parse(FIXTURE_PUBLISHED_AT) + 24 * 3_600_000);
    const withinTolerance = new Date(due.getTime() + (WINDOW_TOLERANCE_HOURS - 1) * 3_600_000);
    expect(windowStatus(FIXTURE_PUBLISHED_AT, "24h", withinTolerance, false).state).toBe("due");
  });

  it("reports a failed collection as failed, not as a result", () => {
    const status = windowStatus(FIXTURE_PUBLISHED_AT, "24h", NOW, false, true);
    expect(status.state).toBe("failed");
    expect(status.explanation).toMatch(/not a performance result/);
  });

  it("refuses one creative appearing twice in a comparison", () => {
    const ledger = boundLedger();
    const assignment = ledger.forCreative(FIXTURE_IDS.controlCreativeId)!;
    const at24h = buildObservation({
      analytics: fixtureControlAnalytics(),
      assignment,
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    expect(() => assertOneObservationPerCreative([at24h, at24h])).toThrow(/counting the windows would inflate the sample/);
  });

  it("refuses a comparison that mixes windows", () => {
    const ledger = boundLedger();
    const control = buildObservation({
      analytics: fixtureControlAnalytics(),
      assignment: ledger.forCreative(FIXTURE_IDS.controlCreativeId)!,
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    const variant = buildObservation({
      analytics: fixtureVariantAnalytics({ window: "7d", capturedAt: "2026-09-09T12:00:00.000Z" }),
      assignment: ledger.forCreative(FIXTURE_IDS.variantCreativeId)!,
      expectedWindow: "7d",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    expect(() => assertOneObservationPerCreative([control, variant])).toThrow(/would rank age rather than creative/);
  });
});

describe("observations refuse misattribution", () => {
  const ledger = boundLedger();
  const assignment = () => ledger.forCreative(FIXTURE_IDS.controlCreativeId)!;

  it("builds a valid observation from matching analytics", () => {
    const observation = buildObservation({
      analytics: fixtureControlAnalytics(),
      assignment: assignment(),
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    expect(observation.validity).toBe("valid");
    expect(measuredValue(observation.metrics.get("stayed-to-watch-rate")!)).toBe(0.54);
  });

  it("refuses synthetic analytics in production", () => {
    expect(() =>
      buildObservation({
        analytics: fixtureControlAnalytics(),
        assignment: assignment(),
        expectedWindow: "24h",
        synthetic: true,
        environment: PRODUCTION,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(/may never become a production performance result/);
  });

  it("refuses analytics for the wrong provider post", () => {
    expect(() =>
      buildObservation({
        analytics: fixtureControlAnalytics({ providerPostId: FIXTURE_IDS.variantPostId }),
        assignment: assignment(),
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(/attribute one video's numbers to another/);
  });

  it("refuses analytics at the wrong window", () => {
    expect(() =>
      buildObservation({
        analytics: fixtureControlAnalytics({ window: "7d" }),
        assignment: assignment(),
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(/not a substitute for the one that is missing/);
  });

  it("refuses a 24h result captured minutes after publication", () => {
    expect(() =>
      buildObservation({
        analytics: fixtureControlAnalytics({ capturedAt: "2026-09-01T12:10:00.000Z" }),
        assignment: assignment(),
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(/is not a 24-hour result/);
  });

  it("refuses analytics captured before publication", () => {
    expect(() =>
      buildObservation({
        analytics: fixtureControlAnalytics({ capturedAt: "2026-08-01T12:00:00.000Z" }),
        assignment: assignment(),
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    ).toThrow(ObservationError);
  });

  it("keeps an unavailable metric unavailable rather than zero", () => {
    const observation = buildObservation({
      analytics: fixtureControlAnalytics({ stayedToWatchRate: "unavailable" }),
      assignment: assignment(),
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    const reading = observation.metrics.get("stayed-to-watch-rate")!;
    expect(reading.state).toBe("unavailable");
    expect(measuredValue(reading)).toBeNull();
  });

  it("keeps an unreported metric not-collected rather than zero", () => {
    const observation = buildObservation({
      analytics: fixtureControlAnalytics(),
      assignment: assignment(),
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    const reading = observation.metrics.get("site-clicks")!;
    expect(reading.state).toBe("not-collected");
    expect(measuredValue(reading)).toBeNull();
  });

  it("reads a genuine zero as a genuine measurement", () => {
    const observation = buildObservation({
      analytics: fixtureControlAnalytics({ saves: 0 }),
      assignment: assignment(),
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    expect(measuredValue(observation.metrics.get("saves")!)).toBe(0);
  });

  it("refuses NaN and Infinity as measurements", () => {
    expect(readingFromRaw(Number.NaN, "x").state).toBe("invalid");
    expect(readingFromRaw(Number.POSITIVE_INFINITY, "x").state).toBe("invalid");
    expect(readingFromRaw(null, "x").state).toBe("unknown");
    expect(readingFromRaw("unavailable", "x").state).toBe("unavailable");
    expect(readingFromRaw(0.5, "x")).toEqual({ state: "measured", value: 0.5 });
  });
});

describe("the observation store is append-only", () => {
  it("is idempotent for an exact replay", () => {
    const ledger = boundLedger();
    const store = new ObservationStore();
    const observation = buildObservation({
      analytics: fixtureControlAnalytics(),
      assignment: ledger.forCreative(FIXTURE_IDS.controlCreativeId)!,
      expectedWindow: "24h",
      synthetic: true,
      environment: ENGINEERING,
      now: NOW,
      producedBy: "test",
    });
    store.record(observation);
    expect(() => store.record(observation)).not.toThrow();
    expect(store.all()).toHaveLength(1);
  });

  it("refuses a conflicting replay of the same observation id", () => {
    const ledger = boundLedger();
    const store = new ObservationStore();
    const assignment = ledger.forCreative(FIXTURE_IDS.controlCreativeId)!;
    store.record(
      buildObservation({
        analytics: fixtureControlAnalytics(),
        assignment,
        expectedWindow: "24h",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    );
    expect(() =>
      store.record(
        buildObservation({
          analytics: fixtureControlAnalytics({ stayedToWatchRate: 0.99 }),
          assignment,
          expectedWindow: "24h",
          synthetic: true,
          environment: ENGINEERING,
          now: NOW,
          producedBy: "test",
        }),
      ),
    ).toThrow(/Raw measurements are immutable/);
  });

  it("excludes rather than back-fills a creative missing the window", () => {
    const ledger = boundLedger();
    const store = new ObservationStore();
    store.record(
      buildObservation({
        analytics: fixtureControlAnalytics({ window: "7d", capturedAt: "2026-09-09T12:00:00.000Z" }),
        assignment: ledger.forCreative(FIXTURE_IDS.controlCreativeId)!,
        expectedWindow: "7d",
        synthetic: true,
        environment: ENGINEERING,
        now: NOW,
        producedBy: "test",
      }),
    );
    const selection = store.selectForComparison(FIXTURE_IDS.experimentId, "24h");
    expect(selection.observations).toHaveLength(0);
    expect(selection.excluded[0].reason).toMatch(/smaller honest sample beats a larger invented one/);
  });
});

describe("generalization requires evidence", () => {
  it("never permits a global claim at any strength", () => {
    for (const strength of ["anecdotal", "directional", "replicated", "strong-within-scope"] as const) {
      expect(generalizationPermitted("global", strength), strength).toBe(false);
    }
  });

  it("permits nothing at all on conflicting evidence", () => {
    for (const level of ["exact-creative", "topic-family", "platform", "cross-platform"] as const) {
      expect(generalizationPermitted(level, "conflicting"), level).toBe(false);
    }
    expect(widestPermittedGeneralization("conflicting")).toBeNull();
  });

  it("keeps anecdotal evidence at the experiment level", () => {
    expect(widestPermittedGeneralization("anecdotal")).toBe("exact-experiment");
    expect(generalizationPermitted("mission-family", "anecdotal")).toBe(false);
  });

  it("permits reuse only once replicated", () => {
    expect(strengthPermitsReuse("replicated")).toBe(true);
    expect(strengthPermitsReuse("strong-within-scope")).toBe(true);
    expect(strengthPermitsReuse("directional")).toBe(false);
    expect(strengthPermitsReuse("anecdotal")).toBe(false);
  });

  it("permits a causal reading only from a controlled design", () => {
    expect(validityPermitsCausalReading("clean-controlled")).toBe(true);
    expect(validityPermitsCausalReading("partially-controlled")).toBe(true);
    expect(validityPermitsCausalReading("confounded")).toBe(false);
    expect(validityPermitsCausalReading("observational-comparison")).toBe(false);
  });

  it("permits early stopping only for defensible reasons", () => {
    expect(earlyStopPermitted("guardrail-failure")).toBe(true);
    expect(earlyStopPermitted("design-invalidated")).toBe(true);
    expect(earlyStopPermitted("planned-units-reached")).toBe(false);
    expect(earlyStopPermitted("replication-achieved")).toBe(false);
  });
});

describe("the metric registry is platform-local", () => {
  it("defines the same metric separately per platform", () => {
    expect(lookupMetric("youtube-shorts", "stayed-to-watch-rate")).not.toBeNull();
    expect(lookupMetric("tiktok", "stayed-to-watch-rate")).not.toBeNull();
    expect(lookupMetric("youtube-shorts", "invented-metric")).toBeNull();
  });

  it("marks every metric unavailable today, because nothing is connected", () => {
    expect(lookupMetric("youtube-shorts", "views")?.availableToday).toBe(false);
  });

  it("records that comments have an ambiguous direction", () => {
    const comments = lookupMetric("youtube-shorts", "comments")!;
    expect(comments.direction).toBe("neutral");
    expect(comments.caveats.join(" ")).toMatch(/confusion and disagreement generate comments/);
  });

  it("marks the fixture unmistakably synthetic", () => {
    expect(FIXTURE_IDS.experimentId).toContain(SYNTHETIC_MARKER);
    expect(fixtureCleanExperiment(NOW).provenance.producedBy).toBe(SYNTHETIC_MARKER);
  });
});
