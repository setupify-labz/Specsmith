// Signal boundary tests.
//
// The property under test throughout: absence stays absence. Every assertion
// that something is `unknown` is an assertion that the system did NOT invent a
// number, and those are the tests that stop a strategy layer describing things
// as trending because it would like them to be.

import { describe, expect, it } from "vitest";

import {
  communityPainFor,
  competitorCoverageFor,
  MIN_COMMUNITY_OBSERVATIONS,
  MIN_SEARCH_IMPRESSIONS,
  parseSignalBundle,
  productReadinessFor,
  searchDemandFor,
  SignalIngestionError,
  trendFor,
  unavailableSignalBundle,
} from "./signals.ts";
import {
  fixtureEmptyCompetitorSurvey,
  fixtureFakeTrend,
  fixtureNoSignals,
  fixtureProductNotReady,
  fixtureRichSignals,
} from "./engineeringFixture.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;
const PRODUCTION = { allowSynthetic: false } as const;

describe("nothing connected means unknown, never a default", () => {
  const empty = unavailableSignalBundle(NOW.toISOString());

  it("reports search demand as unknown and not-configured, never low", () => {
    const result = searchDemandFor(empty, "will this bottleneck");
    expect(result.state).toBe("unknown");
    expect(result.available).toBe(false);
    expect(result.reason).toBe("not-configured");
    expect(result.explanation).toMatch(/unobserved rather than low/i);
  });

  it("reports trend as unknown, which is why nothing may be called trending", () => {
    const result = trendFor(empty, "example gpu-a");
    expect(result.state).toBe("unknown");
    expect(result.explanation).toMatch(/nothing here may be described as trending/i);
  });

  it("reports community pain as unknown, never rare", () => {
    expect(communityPainFor(empty, "what psu do i need").state).toBe("unknown");
  });

  it("reports competitor coverage as unknown, never whitespace", () => {
    const result = competitorCoverageFor(empty, "what psu do i need");
    expect(result.state).toBe("unknown");
    expect(result.explanation).toMatch(/nobody covers this, which nobody checked/i);
  });

  it("treats a pillar with no surface as absent rather than shipped", () => {
    expect(productReadinessFor(empty, null).readiness).toBe("absent");
  });
});

describe("small samples are refused as noise", () => {
  const rich = parseSignalBundle(fixtureRichSignals(NOW), ENGINEERING);

  it("reads a query above the impression floor as real demand", () => {
    const result = searchDemandFor(rich, "example gpu-a upgrade worth it");
    expect(result.available).toBe(true);
    expect(result.state).toBe("high");
  });

  it("refuses a three-impression query as unknown rather than low", () => {
    const result = searchDemandFor(rich, "example gpu-a coil whine");
    expect(result.state).toBe("unknown");
    expect(result.reason).toBe("insufficient-sample");
    expect(result.explanation).toContain(`${MIN_SEARCH_IMPRESSIONS} floor`);
  });

  it("reads a question above the community floor as a real cluster", () => {
    expect(communityPainFor(rich, "example gpu-a upgrade worth it").state).toBe("widespread");
  });

  it("refuses one person asking as a pain cluster", () => {
    const result = communityPainFor(rich, "example gpu-a coil whine");
    expect(result.state).toBe("unknown");
    expect(result.explanation).toContain(`${MIN_COMMUNITY_OBSERVATIONS} floor`);
    expect(result.explanation).toMatch(/One person asking is not a pain cluster/i);
  });

  it("reads a three-point rising series as rising", () => {
    const result = trendFor(rich, "example gpu-a upgrade worth it");
    expect(result.available).toBe(true);
    expect(result.state).toBe("rising");
  });

  it("refuses a two-point series as unable to describe a direction", () => {
    const fake = parseSignalBundle(fixtureFakeTrend(NOW), ENGINEERING);
    const result = trendFor(fake, "example gpu-a is trending");
    // A 10 -> 900 jump looks dramatic and says nothing: two points is not a trend.
    expect(result.state).toBe("unknown");
    expect(result.reason).toBe("insufficient-sample");
  });

  it("refuses whitespace from a survey that does not cover the question", () => {
    const survey = parseSignalBundle(fixtureEmptyCompetitorSurvey(NOW), ENGINEERING);
    const result = competitorCoverageFor(survey, "example gpu-a upgrade worth it");
    expect(result.state).toBe("unknown");
    expect(result.reason).toBe("insufficient-sample");
  });

  it("reads real whitespace when the survey does cover it", () => {
    const survey = parseSignalBundle(fixtureEmptyCompetitorSurvey(NOW), ENGINEERING);
    expect(competitorCoverageFor(survey, "something else entirely").state).toBe("whitespace");
  });
});

describe("the synthetic boundary", () => {
  it("accepts a fixture bundle in the engineering environment", () => {
    expect(parseSignalBundle(fixtureNoSignals(NOW), ENGINEERING).provenance.synthetic).toBe(true);
  });

  it("refuses the same bundle in production, by name", () => {
    expect(() => parseSignalBundle(fixtureNoSignals(NOW), PRODUCTION))
      .toThrow(/may never drive production strategy/);
  });

  it("refuses a bundle that does not say whether it is synthetic", () => {
    const raw = { ...(fixtureNoSignals(NOW) as Record<string, unknown>), provenance: { producedBy: "x", producedAt: NOW.toISOString() } };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(/must be an explicit boolean/);
  });
});

describe("impossible signals are refused, not repaired", () => {
  const base = () => fixtureNoSignals(NOW) as Record<string, unknown>;

  it("refuses more clicks than impressions", () => {
    const raw = { ...base(), search: [{ query: "q", impressions: 5, clicks: 9, position: 1, observedAt: NOW.toISOString(), previousImpressions: null }] };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(/more clicks .* than impressions/);
  });

  it("refuses a question last observed before it was first observed", () => {
    const raw = {
      ...base(),
      community: [{ question: "q", observationCount: 4, firstObservedAt: NOW.toISOString(), lastObservedAt: "2026-01-01T00:00:00.000Z" }],
    };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(/last observed before it was first observed/);
  });

  it("refuses a route on a surface that is not shipped", () => {
    const raw = { ...base(), productState: [{ surface: "builder", readiness: "planned", route: "/builder", evidence: "e" }] };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(/only a shipped surface has a route/);
  });

  it("refuses an unrecognised readiness rather than defaulting it", () => {
    const raw = { ...base(), productState: [{ surface: "builder", readiness: "probably-fine", evidence: "e" }] };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(SignalIngestionError);
  });

  it("refuses a negative count", () => {
    const raw = { ...base(), search: [{ query: "q", impressions: -1, clicks: 0, position: null, observedAt: NOW.toISOString(), previousImpressions: null }] };
    expect(() => parseSignalBundle(raw, ENGINEERING)).toThrow(/non-negative integer/);
  });
});

describe("product readiness", () => {
  it("reports a shipped surface with its route", () => {
    const bundle = parseSignalBundle(fixtureNoSignals(NOW), ENGINEERING);
    const result = productReadinessFor(bundle, "builder");
    expect(result.readiness).toBe("shipped");
    expect(result.route).toBe("/builder");
  });

  it("reports planned and partial surfaces without a route", () => {
    const bundle = parseSignalBundle(fixtureProductNotReady(NOW), ENGINEERING);
    expect(productReadinessFor(bundle, "builder").readiness).toBe("planned");
    expect(productReadinessFor(bundle, "builder").route).toBeNull();
    expect(productReadinessFor(bundle, "compare").readiness).toBe("partial");
  });

  it("reports an unknown surface as absent rather than assuming it exists", () => {
    const bundle = parseSignalBundle(fixtureNoSignals(NOW), ENGINEERING);
    const result = productReadinessFor(bundle, "ai-coach");
    expect(result.readiness).toBe("absent");
    expect(result.evidence).toMatch(/may not be promised to an audience/i);
  });
});
