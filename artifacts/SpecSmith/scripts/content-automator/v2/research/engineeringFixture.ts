// The engineering fixture: hostile evidence, for verifying the research brain.
//
// WHY THIS FILE EXISTS AND WHAT IT IS NOT
// ----------------------------------------
// SpecSmith has no autonomous web access on this branch, so there is no real
// research corpus to run the pipeline against. Rather than fabricate plausible
// research and present the feature as proven, this is EXPLICITLY SYNTHETIC
// evidence — every record carries `provenance.synthetic: true`, and production
// ingestion refuses those outright (see ingestion.ts). It exists to prove the
// machinery works on the cases that matter, not to stand in for real findings.
//
// Nothing here should be read as a fact about any real product. The numbers are
// chosen to trip specific guards, not to describe the world.
//
// WHAT EACH PIECE IS DESIGNED TO CATCH
// -------------------------------------
//   snap-vendor-marketing   a vendor's own performance chart, which must not
//                           count as a measurement
//   snap-review-laptop      a real benchmark of the LAPTOP part, which must not
//                           apply to a desktop claim
//   snap-press-a/b/c        three publishers restating one press release, which
//                           must collapse to one independent origin
//   snap-retail-stale       a real listing observed days ago, which must not be
//                           presented as a current price
//   snap-vendor-spec        the one piece of evidence strong enough to support
//                           its claim, so the fixture proves the system can say
//                           yes as well as no

import type { ResearchProvenance } from "./model.ts";

/** Every record this file produces is marked synthetic. There is no option. */
function syntheticProvenance(producedAt: string): ResearchProvenance {
  return { synthetic: true, producedBy: "specsmith-engineering-fixture", producedAt };
}

export interface FixtureTimes {
  /** The moment the pass runs. Everything else is relative to it. */
  readonly now: Date;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Builds the ingestion document.
 *
 * Returned as a plain object rather than as typed records so it goes through
 * the real strict parser, exactly as a connector document would. A fixture that
 * skipped the parser would not prove the parser works.
 */
export function buildFixtureIngestionDocument(times: FixtureTimes): unknown {
  const { now } = times;
  const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  const provenance = syntheticProvenance(at(0));

  return {
    snapshots: [
      {
        snapshotId: "snap-vendor-spec",
        source: {
          sourceId: "vendor-docs-gpu-a",
          sourceType: "manufacturer-documentation",
          publisher: "Example Vendor",
          url: "https://vendor.example/products/gpu-a/specifications",
          title: "GPU-A specifications",
          publishedAt: at(200 * DAY),
        },
        retrievedAt: at(2 * HOUR),
        retrievalMethod: "direct-fetch",
        contentHash: "a".repeat(64),
        parserVersion: "fixture-1",
        provenance,
      },
      {
        snapshotId: "snap-vendor-marketing",
        source: {
          sourceId: "vendor-marketing-gpu-a",
          sourceType: "manufacturer-marketing",
          publisher: "Example Vendor",
          url: "https://vendor.example/gpu-a/performance",
          title: "GPU-A performance",
          publishedAt: at(190 * DAY),
        },
        retrievedAt: at(2 * HOUR),
        retrievalMethod: "direct-fetch",
        contentHash: "b".repeat(64),
        provenance,
      },
      {
        snapshotId: "snap-review-laptop",
        source: {
          sourceId: "review-lab-laptop-gpu-a",
          sourceType: "independent-benchmark",
          publisher: "Example Review Lab",
          url: "https://reviews.example/gpu-a-laptop-tested",
          title: "GPU-A Laptop GPU tested",
          publishedAt: at(40 * DAY),
        },
        retrievedAt: at(3 * HOUR),
        retrievalMethod: "direct-fetch",
        contentHash: "c".repeat(64),
        provenance,
      },
      // Three publishers, one press release. The upstreamSourceId is what makes
      // their agreement worth nothing.
      {
        snapshotId: "snap-press-a",
        source: {
          sourceId: "news-a",
          sourceType: "editorial-article",
          publisher: "Example News A",
          url: "https://news-a.example/gpu-a-launch",
          publishedAt: at(30 * DAY),
        },
        retrievedAt: at(4 * HOUR),
        retrievalMethod: "direct-fetch",
        upstreamSourceId: "vendor-press-release-gpu-a",
        provenance,
      },
      {
        snapshotId: "snap-press-b",
        source: {
          sourceId: "news-b",
          sourceType: "editorial-article",
          publisher: "Example News B",
          url: "https://news-b.example/gpu-a-launch",
          publishedAt: at(30 * DAY),
        },
        retrievedAt: at(4 * HOUR),
        retrievalMethod: "search-summary",
        upstreamSourceId: "vendor-press-release-gpu-a",
        provenance,
      },
      {
        snapshotId: "snap-press-c",
        source: {
          sourceId: "news-c",
          sourceType: "editorial-article",
          publisher: "Example News C",
          url: "https://news-c.example/gpu-a-launch",
          publishedAt: at(29 * DAY),
        },
        retrievedAt: at(4 * HOUR),
        retrievalMethod: "search-summary",
        upstreamSourceId: "vendor-press-release-gpu-a",
        provenance,
      },
      {
        snapshotId: "snap-retail-stale",
        source: {
          sourceId: "retailer-listing-gpu-a",
          sourceType: "retailer-listing",
          publisher: "Example Retailer",
          url: "https://shop.example/gpu-a",
        },
        // Observed four days ago: a real listing, genuinely seen, long stale for
        // a price claim.
        retrievedAt: at(4 * DAY),
        retrievalMethod: "direct-fetch",
        contentHash: "d".repeat(64),
        provenance,
      },
    ],
    observations: [
      {
        observationId: "obs-vram",
        snapshotId: "snap-vendor-spec",
        form: "structured-value",
        content: "Memory: 12 GB GDDR6",
        fields: { vramGb: 12 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop" },
        observedAt: at(2 * HOUR),
        provenance,
      },
      {
        observationId: "obs-vendor-claim",
        snapshotId: "snap-vendor-marketing",
        form: "paraphrase",
        content: "The vendor's own chart shows GPU-A ahead of GPU-B by a wide margin",
        fields: { claimedUpliftPercent: 40 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop", gameId: "example-game", resolution: "1440p" },
        observedAt: at(2 * HOUR),
        provenance,
      },
      {
        observationId: "obs-laptop-bench",
        snapshotId: "snap-review-laptop",
        form: "structured-value",
        content: "Example GPU-A Laptop GPU averaged 71 fps",
        fields: { averageFps: 71 },
        // A LAPTOP part. The applicability check must refuse to let this
        // support a desktop claim, however good the source is.
        configuration: {
          gpu: "Example GPU-A Laptop GPU",
          formFactor: "laptop",
          gameId: "example-game",
          resolution: "1440p",
          preset: "high",
          gameVersion: "1.4",
        },
        observedAt: at(3 * HOUR),
        provenance,
      },
      {
        observationId: "obs-press-a",
        snapshotId: "snap-press-a",
        form: "paraphrase",
        content: "Coverage reports a large generational uplift for GPU-A",
        fields: { claimedUpliftPercent: 40 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop", gameId: "example-game", resolution: "1440p" },
        observedAt: at(4 * HOUR),
        provenance,
      },
      {
        observationId: "obs-press-b",
        snapshotId: "snap-press-b",
        form: "model-summary",
        content: "Coverage reports a large generational uplift for GPU-A",
        fields: { claimedUpliftPercent: 40 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop", gameId: "example-game", resolution: "1440p" },
        observedAt: at(4 * HOUR),
        provenance,
      },
      {
        observationId: "obs-press-c",
        snapshotId: "snap-press-c",
        form: "model-summary",
        content: "Coverage reports a large generational uplift for GPU-A",
        fields: { claimedUpliftPercent: 40 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop", gameId: "example-game", resolution: "1440p" },
        observedAt: at(4 * HOUR),
        provenance,
      },
      {
        observationId: "obs-price",
        snapshotId: "snap-retail-stale",
        form: "structured-value",
        content: "Listing displayed 549.99 USD",
        fields: { priceUsd: 549.99 },
        configuration: { gpu: "Example GPU-A", formFactor: "desktop", sku: "VENDOR-GPU-A-12G-OC" },
        observedAt: at(4 * DAY),
        provenance,
      },
    ],
  };
}

/** The claims the fixture asks the research brain to adjudicate. */
export function buildFixtureClaims(questionId: string, now: Date) {
  const provenance = syntheticProvenance(now.toISOString());
  return {
    questionId,
    provenance,
    /** The compound statement, to be atomized rather than evaluated whole. */
    compoundStatement: "Example GPU-A has 12GB of VRAM, is 40% faster than GPU-B, and costs $549.99",
    subjectIds: ["example-gpu-a", "example-gpu-b"],
    configuration: {
      gpu: "Example GPU-A",
      formFactor: "desktop" as const,
      gameId: "example-game",
      resolution: "1440p",
    },
  };
}

/**
 * Which observation bears on which claim.
 *
 * Supplied explicitly because deciding that a piece of evidence is ABOUT a
 * claim is a judgment. A keyword matcher making it silently is how a laptop
 * benchmark ends up counted as support for a desktop claim without anyone
 * choosing that.
 */
export function fixtureStances(claimIds: { vram: string; comparison: string; price: string }) {
  return [
    { claimId: claimIds.vram, observationId: "obs-vram", stance: "supports" as const },
    { claimId: claimIds.comparison, observationId: "obs-vendor-claim", stance: "supports" as const },
    { claimId: claimIds.comparison, observationId: "obs-laptop-bench", stance: "supports" as const },
    { claimId: claimIds.comparison, observationId: "obs-press-a", stance: "supports" as const },
    { claimId: claimIds.comparison, observationId: "obs-press-b", stance: "supports" as const },
    { claimId: claimIds.comparison, observationId: "obs-press-c", stance: "supports" as const },
    { claimId: claimIds.price, observationId: "obs-price", stance: "supports" as const },
  ];
}
