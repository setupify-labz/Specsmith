// Source intelligence tests.
//
// The single property worth most of this file: assessment depends on the
// QUESTION. The same source is excellent for one kind of claim and near
// worthless for another, and a system that scores domains cannot express that.

import { describe, expect, it } from "vitest";

import { assessSource, rankSourcesForClaim } from "./sourceAssessment.ts";
import type { ResearchProvenance, SourceSnapshot, SourceType } from "./model.ts";

const provenance: ResearchProvenance = { synthetic: true, producedBy: "test", producedAt: "2026-09-15T12:00:00.000Z" };

function snapshot(sourceType: SourceType, overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    snapshotId: `snap-${sourceType}`,
    source: { sourceId: `src-${sourceType}`, sourceType, publisher: `${sourceType} publisher` },
    retrievedAt: "2026-09-15T12:00:00.000Z",
    retrievalMethod: "direct-fetch",
    contentHash: "a".repeat(64),
    publishedAt: "2026-09-01T00:00:00.000Z",
    provenance,
    ...overrides,
  };
}

describe("fitness depends on the question, not on the domain", () => {
  it("rates manufacturer documentation high for a specification and low for measured performance", () => {
    const docs = snapshot("manufacturer-documentation");
    expect(assessSource(docs, "specification").relevanceToClaimKind).toBe("high");
    expect(assessSource(docs, "performance-measured").relevanceToClaimKind).toBe("low");
  });

  it("rates a vendor's own marketing low for performance, whatever its authority", () => {
    const marketing = snapshot("manufacturer-marketing");
    const assessment = assessSource(marketing, "performance-measured");
    expect(assessment.relevanceToClaimKind).toBe("low");
    expect(assessment.conflictOfInterest).toBe("likely");
    expect(assessment.limitations.join(" ")).toMatch(/commercial interest/i);
  });

  it("rates a retailer listing high for a price and low for a specification", () => {
    const listing = snapshot("retailer-listing");
    expect(assessSource(listing, "current-price").relevanceToClaimKind).toBe("high");
    expect(assessSource(listing, "specification").relevanceToClaimKind).toBe("medium");
  });

  it("rates community discussion high for what an audience asks and low for whether it is true", () => {
    const community = snapshot("community-discussion");
    expect(assessSource(community, "audience-behaviour").relevanceToClaimKind).toBe("high");
    expect(assessSource(community, "performance-measured").relevanceToClaimKind).toBe("low");
  });

  it("defaults an unconsidered pairing to low rather than assuming competence", () => {
    expect(assessSource(snapshot("social-post"), "compatibility").relevanceToClaimKind).toBe("low");
  });
});

describe("a source nobody read cannot lend its authority", () => {
  it("downgrades authority and records the limitation for a search summary", () => {
    const read = assessSource(snapshot("independent-benchmark"), "performance-measured");
    const unread = assessSource(snapshot("independent-benchmark", { retrievalMethod: "search-summary" }), "performance-measured");
    expect(read.authority).toBe("high");
    expect(read.materialObserved).toBe(true);
    expect(unread.authority).toBe("medium");
    expect(unread.materialObserved).toBe(false);
    expect(unread.limitations.join(" ")).toMatch(/report about the source, not the source/i);
  });

  it("treats a connector relay and a human transcription as material actually observed", () => {
    for (const method of ["connector-relay", "human-transcription", "specsmith-runtime"] as const) {
      expect(assessSource(snapshot("independent-review", { retrievalMethod: method }), "comparison").materialObserved).toBe(true);
    }
  });
});

describe("retelling is not a second opinion", () => {
  it("demotes directness and independence when a source declares an upstream", () => {
    const original = assessSource(snapshot("editorial-article"), "comparison");
    const retelling = assessSource(snapshot("editorial-article", { upstreamSourceId: "press-release-1" }), "comparison");
    expect(original.directness).toBe("secondary");
    expect(retelling.directness).toBe("tertiary");
    expect(retelling.independence).toBe("low");
    expect(retelling.limitations.join(" ")).toMatch(/not independent of it/i);
  });
});

describe("missing metadata is disclosed rather than assumed", () => {
  it("records the absence of a publication date and of a content hash", () => {
    const assessment = assessSource(
      snapshot("independent-review", { publishedAt: undefined, contentHash: undefined }),
      "comparison",
    );
    expect(assessment.limitations.join(" ")).toMatch(/no publication date/i);
    expect(assessment.limitations.join(" ")).toMatch(/would be undetectable/i);
  });

  it("reports unknown authority for an unknown source type rather than guessing low", () => {
    expect(assessSource(snapshot("unknown"), "specification").authority).toBe("unknown");
  });
});

describe("ranking is by fitness for the question first", () => {
  it("puts the retailer listing above the manufacturer page for a price question", () => {
    const ranked = rankSourcesForClaim(
      [snapshot("manufacturer-documentation"), snapshot("retailer-listing")],
      "current-price",
    );
    expect(ranked[0].snapshot.source.sourceType).toBe("retailer-listing");
  });

  it("reverses that order for a specification question", () => {
    const ranked = rankSourcesForClaim(
      [snapshot("retailer-listing"), snapshot("manufacturer-documentation")],
      "specification",
    );
    expect(ranked[0].snapshot.source.sourceType).toBe("manufacturer-documentation");
  });

  it("puts an independent benchmark above vendor marketing for performance", () => {
    const ranked = rankSourcesForClaim(
      [snapshot("manufacturer-marketing"), snapshot("independent-benchmark")],
      "performance-measured",
    );
    expect(ranked[0].snapshot.source.sourceType).toBe("independent-benchmark");
  });

  it("is deterministic for equivalent sources", () => {
    const inputs = [snapshot("editorial-article", { snapshotId: "b" }), snapshot("editorial-article", { snapshotId: "a" })];
    const first = rankSourcesForClaim(inputs, "comparison").map((entry) => entry.snapshot.snapshotId);
    const second = rankSourcesForClaim([...inputs].reverse(), "comparison").map((entry) => entry.snapshot.snapshotId);
    expect(first).toEqual(second);
    expect(first).toEqual(["a", "b"]);
  });
});
