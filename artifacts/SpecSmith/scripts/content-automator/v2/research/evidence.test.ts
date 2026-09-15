// Evidence evaluation tests: the adversarial cases.
//
// Every test here is a way real evidence can be true and still not support the
// claim in front of it. These are the cases a research system gets wrong
// quietly — the answer looks reasonable, the source is real, and the conclusion
// is about a different product, a different patch, or a different week.

import { describe, expect, it } from "vitest";

import { assessApplicability, assessCorroboration, assessFreshness, detectConflict, linkEvidence, weakestApplicability } from "./evidence.ts";
import type { AtomicClaim, ClaimConfiguration, Observation, ResearchProvenance, SourceSnapshot } from "./model.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const provenance: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: ago(0) };

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationId: "obs-1",
    snapshotId: "snap-1",
    form: "structured-value",
    content: "content",
    observedAt: ago(HOUR),
    provenance,
    ...overrides,
  };
}

function claim(overrides: Partial<AtomicClaim> = {}): AtomicClaim {
  return {
    claimId: "claim-1",
    questionId: "q-1",
    proposition: "a proposition",
    kind: "performance-measured",
    risk: "high",
    subjectIds: ["gpu-a"],
    provenance,
    ...overrides,
  };
}

function snapshot(id: string, publisher: string, upstreamSourceId?: string): SourceSnapshot {
  return {
    snapshotId: id,
    source: { sourceId: `src-${id}`, sourceType: "editorial-article", publisher },
    retrievedAt: ago(HOUR),
    retrievalMethod: "direct-fetch",
    upstreamSourceId,
    provenance,
  };
}

describe("freshness is per claim kind, not one global TTL", () => {
  it("treats a four-hour-old price as current and a four-day-old price as stale", () => {
    const fresh = assessFreshness(observation({ observedAt: ago(4 * HOUR) }), "current-price", NOW);
    const old = assessFreshness(observation({ observedAt: ago(4 * DAY) }), "current-price", NOW);
    expect(fresh.freshness).toBe("current");
    expect(old.freshness).toBe("stale");
    expect(old.reason).toMatch(/prices move daily/i);
  });

  it("treats the same four-day-old observation as timeless for a specification", () => {
    const result = assessFreshness(observation({ observedAt: ago(4 * DAY) }), "specification", NOW);
    expect(result.freshness).toBe("timeless");
  });

  it("treats a six-month-old benchmark as still usable, unlike a six-month-old price", () => {
    const benchmark = assessFreshness(observation({ observedAt: ago(150 * DAY) }), "performance-measured", NOW);
    const price = assessFreshness(observation({ observedAt: ago(150 * DAY) }), "current-price", NOW);
    expect(benchmark.freshness).toBe("aging");
    expect(price.freshness).toBe("stale");
  });

  it("expires a benchmark on a version mismatch regardless of how recent it is", () => {
    const result = assessFreshness(
      observation({ observedAt: ago(HOUR), configuration: { gameVersion: "1.3" } }),
      "performance-measured",
      NOW,
      { gameVersion: "1.4" },
    );
    // An hour old, and useless: the patch moved underneath it.
    expect(result.freshness).toBe("expired");
    expect(result.reason).toMatch(/gameVersion=1\.3.*gameVersion=1\.4/);
  });

  it("reports unknown rather than guessing when the observation has no usable time", () => {
    const result = assessFreshness(observation({ observedAt: "not-a-date" }), "current-price", NOW);
    expect(result.freshness).toBe("unknown");
  });

  it("refuses to treat a future observation as maximally fresh", () => {
    const result = assessFreshness(observation({ observedAt: new Date(NOW.getTime() + DAY).toISOString() }), "current-price", NOW);
    expect(result.freshness).toBe("unknown");
  });
});

describe("applicability: true, of something else", () => {
  const desktop: ClaimConfiguration = { gpu: "Example GPU-A", formFactor: "desktop", resolution: "1440p" };

  it("refuses a laptop benchmark for a desktop claim, however good the source", () => {
    const result = assessApplicability(
      claim({ configuration: desktop }),
      observation({ configuration: { gpu: "Example GPU-A Laptop GPU", formFactor: "laptop", resolution: "1440p" } }),
    );
    expect(result.applicability).toBe("not-applicable");
    expect(result.reasons.join(" ")).toMatch(/different products that share a name/i);
  });

  it("classifies form factor from the name when it is not stated, using the shared catalogue rule", () => {
    // No formFactor field at all: the classifier has to read the name, and it
    // is the SAME classifier the measured-observation system uses.
    const result = assessApplicability(
      claim({ configuration: { gpu: "Example GPU-A" } }),
      observation({ configuration: { gpu: "Example GPU-A Laptop GPU" } }),
    );
    expect(result.applicability).toBe("not-applicable");
  });

  it("refuses a frame-generated figure for a rendered-frame claim", () => {
    const result = assessApplicability(
      claim({ configuration: { ...desktop, frameGeneration: false } }),
      observation({ configuration: { ...desktop, frameGeneration: true } }),
    );
    expect(result.applicability).toBe("not-applicable");
    expect(result.reasons.join(" ")).toMatch(/not the same measurement/i);
  });

  it("refuses evidence for a different exact SKU", () => {
    const result = assessApplicability(
      claim({ configuration: { ...desktop, sku: "VENDOR-A-OC" } }),
      observation({ configuration: { ...desktop, sku: "VENDOR-A-BASE" } }),
    );
    expect(result.applicability).toBe("not-applicable");
  });

  it("flags a SKU-specific claim backed by non-SKU-specific evidence", () => {
    const result = assessApplicability(
      claim({ configuration: { ...desktop, sku: "VENDOR-A-OC" } }),
      observation({ configuration: desktop }),
    );
    expect(result.applicability).not.toBe("exact");
    expect(result.reasons.join(" ")).toMatch(/board-partner differences/i);
  });

  it("calls a fully matching configuration exact", () => {
    const result = assessApplicability(claim({ configuration: desktop }), observation({ configuration: desktop }));
    expect(result.applicability).toBe("exact");
  });

  it("degrades with each mismatched condition rather than failing outright", () => {
    const one = assessApplicability(
      claim({ configuration: { ...desktop, preset: "high" } }),
      observation({ configuration: { ...desktop, preset: "ultra" } }),
    );
    const two = assessApplicability(
      claim({ configuration: { ...desktop, preset: "high", upscaler: "native" } }),
      observation({ configuration: { ...desktop, preset: "ultra", upscaler: "dlss" } }),
    );
    expect(one.applicability).toBe("partial");
    expect(two.applicability).toBe("weak");
  });

  it("reports unknown, not exact, when a configuration is missing entirely", () => {
    expect(assessApplicability(claim({ configuration: desktop }), observation()).applicability).toBe("unknown");
  });
});

describe("corroboration counts origins, not URLs", () => {
  it("collapses three articles restating one press release into one origin", () => {
    const result = assessCorroboration("claim-1", [
      snapshot("s1", "News A", "vendor-press-release"),
      snapshot("s2", "News B", "vendor-press-release"),
      snapshot("s3", "News C", "vendor-press-release"),
    ]);
    expect(result.independentOriginCount).toBe(1);
    expect(result.dependentGroups).toHaveLength(1);
    expect(result.reason).toMatch(/do not corroborate each other/i);
  });

  it("collapses two pages from one publisher into one origin", () => {
    const result = assessCorroboration("claim-1", [snapshot("s1", "News A"), snapshot("s2", "News A")]);
    expect(result.independentOriginCount).toBe(1);
  });

  it("counts genuinely separate publishers separately", () => {
    const result = assessCorroboration("claim-1", [snapshot("s1", "Lab A"), snapshot("s2", "Lab B")]);
    expect(result.independentOriginCount).toBe(2);
    expect(result.dependentGroups).toEqual([]);
  });

  it("treats publisher names case-insensitively so casing cannot fake independence", () => {
    const result = assessCorroboration("claim-1", [snapshot("s1", "News A"), snapshot("s2", "news a")]);
    expect(result.independentOriginCount).toBe(1);
  });
});

describe("conflict is preserved, never averaged", () => {
  it("records a real disagreement between two sources", () => {
    const conflict = detectConflict(claim(), [
      observation({ observationId: "o1", snapshotId: "s1", fields: { averageFps: 60 }, configuration: { resolution: "1440p" } }),
      observation({ observationId: "o2", snapshotId: "s2", fields: { averageFps: 95 }, configuration: { resolution: "1440p" } }),
    ]);
    expect(conflict).not.toBeNull();
    expect(conflict?.resolved).toBe(false);
    expect(conflict?.whatConflicts).toContain("averageFps");
    // The point: no third number was invented.
    expect(conflict?.whatConflicts).not.toContain("77");
  });

  it("resolves an apparent conflict explained by a different configuration", () => {
    const conflict = detectConflict(claim(), [
      observation({ observationId: "o1", snapshotId: "s1", fields: { averageFps: 60 }, configuration: { resolution: "4k" } }),
      observation({ observationId: "o2", snapshotId: "s2", fields: { averageFps: 95 }, configuration: { resolution: "1080p" } }),
    ]);
    expect(conflict?.explanation).toBe("different-configuration");
    expect(conflict?.resolved).toBe(true);
  });

  it("ignores differences too small to be a disagreement", () => {
    const conflict = detectConflict(claim(), [
      observation({ observationId: "o1", snapshotId: "s1", fields: { averageFps: 90 } }),
      observation({ observationId: "o2", snapshotId: "s2", fields: { averageFps: 92 } }),
    ]);
    expect(conflict).toBeNull();
  });

  it("reports no conflict when only one source has figures", () => {
    expect(detectConflict(claim(), [observation({ fields: { averageFps: 90 } })])).toBeNull();
  });
});

describe("linkEvidence combines the judgments", () => {
  it("records a generalisation when a price claim drops its time bound", () => {
    const link = linkEvidence(
      claim({ kind: "current-price", proposition: "GPU-A costs $549.99" }),
      observation({ observedAt: ago(HOUR), fields: { priceUsd: 549.99 } }),
      "supports",
      NOW,
    );
    expect(link.generalisesBeyondObservation).toBe(true);
  });

  it("accepts a price claim that states when it was observed", () => {
    const link = linkEvidence(
      claim({ kind: "current-price", proposition: "GPU-A was $549.99 at 09:00 on one listing" }),
      observation({ observedAt: ago(HOUR) }),
      "supports",
      NOW,
    );
    expect(link.generalisesBeyondObservation).toBe(false);
  });
});

describe("weakestApplicability governs", () => {
  it("returns the worst applicability in a set, not the best or the average", () => {
    const links = [
      linkEvidence(claim({ configuration: { resolution: "1440p" } }), observation({ configuration: { resolution: "1440p" } }), "supports", NOW),
      linkEvidence(claim({ configuration: { resolution: "1440p", preset: "high" } }), observation({ configuration: { resolution: "1080p", preset: "low" } }), "supports", NOW),
    ];
    expect(weakestApplicability(links)).toBe("weak");
  });

  it("returns unknown for an empty set rather than a confident default", () => {
    expect(weakestApplicability([])).toBe("unknown");
  });
});
