// Claim atomization and quote integrity.

import { describe, expect, it } from "vitest";

import { atomizeClaim, describeLeap, isQuotable, QuoteIntegrityError, renderObservationForScript, riskFor, weakestRisk } from "./claims.ts";
import type { AtomicClaim, Observation, ResearchProvenance } from "./model.ts";

const provenance: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: "2026-09-15T12:00:00.000Z" };

const base = {
  questionId: "q-1",
  defaultKind: "comparison" as const,
  subjectIds: ["gpu-a", "gpu-b"],
  provenance,
  idPrefix: "claim",
};

describe("atomizeClaim", () => {
  it("splits a compound statement into independently-evidenced claims", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM, is 40% faster than GPU-B, and costs $549.99" });
    expect(claims).toHaveLength(3);
    expect(claims.map((claim) => claim.kind)).toEqual(["specification", "comparison", "current-price"]);
  });

  it("gives each fragment a standalone, readable proposition", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM, is 40% faster than GPU-B, and costs $549.99" });
    // The subject is re-attached, and no duplicate verb is introduced.
    expect(claims[1].proposition).toBe("GPU-A is 40% faster than GPU-B");
    expect(claims[2].proposition).toBe("GPU-A costs $549.99");
    for (const claim of claims) expect(claim.proposition).not.toMatch(/\b(is is|is costs|is has)\b/);
  });

  it("gives the price fragment a higher risk than the spec fragment", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM and costs $549.99" });
    const spec = claims.find((claim) => claim.kind === "specification");
    const price = claims.find((claim) => claim.kind === "current-price");
    expect(spec?.risk).toBe("low");
    expect(price?.risk).toBe("high");
  });

  it("does not split a qualifier into its own claim", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A is 40% faster, at 1440p" });
    expect(claims).toHaveLength(1);
    expect(claims[0].proposition).toContain("1440p");
  });

  it("returns one claim for an already-atomic statement", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM", defaultKind: "specification" });
    expect(claims).toHaveLength(1);
    expect(claims[0].claimId).toBe("claim-1");
  });

  it("produces the same ids for the same input, so a re-run is comparable", () => {
    const first = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM and costs $549.99" });
    const second = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM and costs $549.99" });
    expect(first.map((claim) => claim.claimId)).toEqual(second.map((claim) => claim.claimId));
    expect(first).toEqual(second);
  });
});

describe("risk floors cannot be talked down", () => {
  it("raises a price claim to high even when low was requested", () => {
    expect(riskFor("current-price", "low")).toBe("high");
  });

  it("keeps a caller's higher risk for a low-floor kind", () => {
    expect(riskFor("specification", "high")).toBe("high");
    expect(riskFor("specification", "low")).toBe("low");
  });

  it("reports the weakest claim in a set, which a combined statement inherits", () => {
    const claims = atomizeClaim({ ...base, statement: "GPU-A has 12GB of VRAM and costs $549.99" });
    expect(weakestRisk(claims)).toBe("high");
  });
});

describe("quote integrity", () => {
  const observation = (form: Observation["form"]): Observation => ({
    observationId: "obs-1",
    snapshotId: "snap-1",
    form,
    content: "GPU-A ships with 12GB of memory",
    observedAt: "2026-09-15T11:00:00.000Z",
    provenance,
  });

  it("quotes an exact quote", () => {
    expect(renderObservationForScript(observation("exact-quote"), { asQuote: true })).toBe('"GPU-A ships with 12GB of memory"');
  });

  it("refuses to put quotation marks around a paraphrase", () => {
    expect(() => renderObservationForScript(observation("paraphrase"), { asQuote: true })).toThrow(QuoteIntegrityError);
  });

  it("refuses to quote a model summary or an inference", () => {
    for (const form of ["model-summary", "inference"] as const) {
      expect(() => renderObservationForScript(observation(form), { asQuote: true })).toThrow(/may never be presented as a quotation/);
    }
  });

  it("renders a paraphrase attributed but unquoted", () => {
    const rendered = renderObservationForScript(observation("paraphrase"), { asQuote: false });
    expect(rendered).not.toContain('"');
    expect(rendered).toContain("per the source");
  });

  it("labels an inference as SpecSmith's own rather than as the source's", () => {
    expect(renderObservationForScript(observation("inference"), { asQuote: false })).toContain("SpecSmith inference");
  });

  it("names exactly the two quotable forms", () => {
    expect(isQuotable("exact-quote")).toBe(true);
    expect(isQuotable("structured-value")).toBe(true);
    expect(isQuotable("paraphrase")).toBe(false);
  });
});

describe("describeLeap catches a claim outrunning its observation", () => {
  const observation: Observation = {
    observationId: "obs-1",
    snapshotId: "snap-1",
    form: "structured-value",
    content: "549.99",
    observedAt: "2026-09-15T11:00:00.000Z",
    configuration: { sku: "VENDOR-A-OC", resolution: "1440p" },
    provenance,
  };

  const claim = (overrides: Partial<AtomicClaim>): AtomicClaim => ({
    claimId: "claim-1",
    questionId: "q-1",
    proposition: "GPU-A costs $549.99",
    kind: "current-price",
    risk: "high",
    subjectIds: ["gpu-a"],
    provenance,
    ...overrides,
  });

  it("flags a price stated with no time or seller", () => {
    expect(describeLeap(claim({}), observation).join(" ")).toMatch(/one moment and one listing/i);
  });

  it("accepts a price claim that keeps its time bound", () => {
    expect(describeLeap(claim({ proposition: "GPU-A was $549.99 at 11:00 on one listing" }), observation)).toEqual([]);
  });

  it("flags a claim about a configuration the observation did not fix", () => {
    const leaps = describeLeap(
      claim({ kind: "performance-measured", proposition: "GPU-A gets 90fps at 4k", configuration: { resolution: "4k" } }),
      observation,
    );
    expect(leaps.join(" ")).toContain("resolution=1440p");
  });

  it("flags a family-wide specification drawn from one SKU", () => {
    const leaps = describeLeap(
      claim({ kind: "specification", proposition: "GPU-A has 12GB", configuration: { resolution: "1440p" } }),
      observation,
    );
    expect(leaps.join(" ")).toMatch(/property of the whole family/i);
  });
});
