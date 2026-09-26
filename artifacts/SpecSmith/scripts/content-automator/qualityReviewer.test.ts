import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import {
  buildQualityReviewRequest,
  reviewRenderedVideo,
  matchRenderToRecordedEvidence,
  parseRecordedRenderEvidence,
  RecordedRenderEvidenceError,
  type RenderedVideoObservation,
  type RecordedRenderEvidence,
  type ReviewOptions,
} from "./qualityReviewer.ts";
import type { ContentIdea } from "./types.ts";
import type { RenderReceipt } from "./motionCompositor.ts";
import { constructedTestListen, renderControl, type ControlRender } from "./publishBoundary.testkit.ts";
import { isIssuedListeningReview, ListeningReviewError, recordListeningReview } from "./listeningReview.ts";
import { PRICE_FRESHNESS_MS } from "../../src/lib/retail/partPricing.ts";

const idea: ContentIdea = {
  id: "builder-budget-challenge",
  format: "build",
  title: "What does another $200 actually change in this SpecSmith build?",
  hook: "You get $200 more. Where should it go?",
  angle: "Use Builder to show the highest-impact place to spend the extra budget.",
  targetAudience: "PC builders",
  requiredFacts: ["current build price", "compatible upgrade options", "part price deltas"],
  subjectIds: ["g1", "c1"],
  productConnection: {
    feature: "builder",
    route: "/builder",
    userProblem: "Builders struggle to know which component deserves the next chunk of budget.",
    whySpecSmith: "SpecSmith Builder can hold the full build constant while changing one real compatible component at a time.",
    continuationAction: "Open Builder, recreate the build, and test where your next $200 changes the result most.",
    sitePayoff: "The viewer can continue the exact budget experiment using their own build.",
  },
  creativeDNA: {
    conceptName: "Budget Lock",
    visualWorld: "Budget Lock — the build stays fixed while one upgrade slot opens",
    narrativeEngine: "constraint -> choice -> evidence -> payoff",
    openingImage: "A real build total and one locked upgrade slot are visible.",
    patternInterrupt: "The budget can only move once.",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Show the strongest compatible spend based on verified inputs.",
    audioDirection: "Tight impacts and silence before reveal.",
    originalityConstraint: "The Builder state must be essential to the story.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 10,
    visualPotential: 9,
    purchaseIntent: 9,
    novelty: 8,
    originality: 9,
    retentionPotential: 9,
    shareability: 8,
    productFit: 10,
    siteContinuation: 10,
    total: 9.2,
  },
};

const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
const scripts = buildScriptStoryboardPackage(idea, content);
const production = buildProductionPlanPackage(scripts);
const request = buildQualityReviewRequest(content, scripts, production, "youtube-shorts");

/**
 * THE REVIEWED MASTER IS A REAL RENDER. A pass now needs a listening record
 * bound to a genuine compositor receipt, so the clean path reviews a tiny
 * fixture render (QC judges what was watched and heard; the publish gate, not
 * QC, refuses fixtures). Its listen is `constructedTestListen`: built for the
 * test, in memory, and says so. No one listened.
 */
const REVIEWED: ControlRender = await renderControl({ fixtureNarration: true });
afterAll(async () => { await rm(REVIEWED.dir, { recursive: true, force: true }); });
const MASTER_SHA256 = REVIEWED.receipt.masterSha256;
const NOW = new Date("2026-09-20T12:00:00.000Z");

/** Reviews against the real receipt with a bound full listen, unless overridden. */
function review(observation: RenderedVideoObservation, options: ReviewOptions = {}) {
  return reviewRenderedVideo(request, observation, REVIEWED.receipt, {
    listeningReview: constructedTestListen(REVIEWED.receipt),
    now: NOW,
    ...options,
  });
}

function cleanObservation(overrides: Partial<RenderedVideoObservation> = {}): RenderedVideoObservation {
  return {
    packageId: content.packageId,
    platform: "youtube-shorts",
    // The digest of the exact file the reviewer watched. It is carried through
    // to QualityReviewResult.reviewedMediaSha256 and is what the publishing
    // gate binds the published bytes to.
    masterSha256: MASTER_SHA256,
    durationSeconds: 24,
    openingDecisionClearWithoutAudio: true,
    captionsLegibilityScore: 9.5,
    captionSafeAreaRatio: 1,
    audioClarityScore: 9.3,
    visualCoherenceScore: 9.2,
    pacingScore: 9.1,
    specSmithRelevanceScore: 9.7,
    genericAiBrollRatio: 0.15,
    observedCtaRoute: "/builder",
    claims: [
      {
        text: "The build total shown is SpecSmith's catalogue estimate from the Builder state.",
        kind: "price",
        verification: "verified",
        evidenceRefs: ["builder-state:build-1"],
        displayLabel: "Est. $1,249",
        priceProvenance: { kind: "catalogue-estimate" },
      },
      {
        text: "The upgrade option is compatible with the selected build.",
        kind: "compatibility",
        verification: "verified",
        evidenceRefs: ["compatibility-engine:build-1"],
      },
    ],
    uiShots: [
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-3-visual" },
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-5-visual" },
    ],
    missingRequiredFacts: [],
    failedTaskIds: [],
    ...overrides,
  };
}

describe("automated quality reviewer", () => {
  it("builds a strict review contract from the content, storyboard, and production plans", () => {
    expect(request.expectedRoute).toBe("/builder");
    expect(request.requiredFacts).toEqual(idea.requiredFacts);
    expect(request.expectedTaskIds.length).toBeGreaterThan(8);
    expect(request.hardBlockers.some((rule) => rule.includes("measured game FPS"))).toBe(true);
    expect(request.productionChecks.some((rule) => rule.includes("generic AI B-roll"))).toBe(true);
  });

  it("passes a strong render and marks it publishable", () => {
    const result = review(cleanObservation());
    expect(result.decision).toBe("pass");
    expect(result.publishable).toBe(true);
    expect(result.overallScore).toBeGreaterThanOrEqual(8.5);
    expect(result.issues.filter((issue) => issue.severity !== "warning")).toHaveLength(0);
  });

  it("holds uncertain factual claims instead of guessing or auto-publishing", () => {
    const result = review(cleanObservation({
      claims: [{
        text: "This upgrade is 17% faster.",
        kind: "other",
        verification: "unverified",
        evidenceRefs: [],
      }],
    }));
    expect(result.decision).toBe("hold-for-human-review");
    expect(result.publishable).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unverified-claim")).toBe(true);
  });

  it("forces a full regeneration for fake SpecSmith UI, wrong CTA, or dangerous FPS labeling", () => {
    const result = review(cleanObservation({
      observedCtaRoute: "/",
      claims: [{
        text: "Expected game performance",
        kind: "estimated-fps",
        verification: "verified",
        evidenceRefs: ["estimator:run-1"],
        displayLabel: "FPS",
      }],
      uiShots: [{ source: "generated", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-5-visual" }],
    }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.publishable).toBe(false);
    expect(result.issues.some((issue) => issue.code === "fake-specsmith-ui")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "wrong-cta-route")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "estimated-fps-unlabeled")).toBe(true);
  });

  it("targets only repairable caption/audio tasks when the rest of the video is strong", () => {
    const result = review(cleanObservation({
      captionsLegibilityScore: 6.5,
      captionSafeAreaRatio: 0.88,
      audioClarityScore: 7,
    }));
    expect(result.decision).toBe("regenerate-targeted");
    expect(result.publishable).toBe(false);
    expect(result.regenerateTaskIds.some((id) => id.includes("captions"))).toBe(true);
    expect(result.regenerateTaskIds.some((id) => id.includes("voice"))).toBe(true);
    expect(result.regenerateTaskIds.some((id) => id.includes("compose"))).toBe(true);
  });

  it("rejects AI-slop-dominant visuals even if the other numeric scores look good", () => {
    const result = review(cleanObservation({ genericAiBrollRatio: 0.75 }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.issues.some((issue) => issue.code === "ai-slop-dominant")).toBe(true);
  });

  it("prevents an internal SpecSmith score from masquerading as measured game FPS", () => {
    const result = review(cleanObservation({
      claims: [{
        text: "SpecSmith benchmark score 285",
        kind: "specsmith-score",
        verification: "verified",
        evidenceRefs: ["catalog:g1"],
        displayLabel: "Measured 285 FPS",
      }],
    }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.issues.some((issue) => issue.code === "score-mislabeled-as-measured-fps")).toBe(true);
  });
});

/**
 * Blocker #2 fix: a RenderedVideoObservation's scores/claims must never be
 * trusted for a render whose actual bytes were never inspected. These tests
 * cover matchRenderToRecordedEvidence and parseRecordedRenderEvidence — the
 * reusable helpers endToEndOfflinePipeline.ts binds a fresh render's sha256
 * against — directly, since the full offline pipeline's own render is not
 * byte-reproducible run to run (real, timing-sensitive browser capture
 * during its UI-sequence step), so its "matched" path cannot be exercised
 * deterministically end-to-end in CI. See qualityReviewer.ts's
 * RecordedRenderEvidence doc comment for why this exists.
 */
describe("recorded render evidence binds an observation to one exact render's bytes", () => {
  function recordedEvidence(overrides: Partial<RecordedRenderEvidence> = {}): RecordedRenderEvidence {
    return {
      masterSha256: MASTER_SHA256,
      reviewedBy: "claude-code-manual-review",
      reviewedAt: "2026-09-02T18:05:00.000Z",
      notes: ["Frames extracted and actually inspected for this exact render."],
      observation: cleanObservation({ masterSha256: MASTER_SHA256 }),
      ...overrides,
    };
  }

  it("proceeds with the recorded observation when this run's actual sha256 matches the committed record", () => {
    const evidence = recordedEvidence();
    const match = matchRenderToRecordedEvidence(MASTER_SHA256, evidence);
    expect(match.matched).toBe(true);
    if (!match.matched) throw new Error("expected a match");
    expect(match.observation).toEqual(evidence.observation);

    // The downstream review gate then runs exactly as it would with any
    // other observation — evidence-binding only decides whether the
    // observation may be used at all, not how it is scored.
    const result = review({ ...match.observation, packageId: content.packageId, platform: "youtube-shorts" });
    expect(result.publishable).toBe(true);
  });

  it("stops, not-publishable, when this run's actual sha256 does not match the committed record", () => {
    const evidence = recordedEvidence();
    const freshlyRenderedSha256 = "c".repeat(64);
    const match = matchRenderToRecordedEvidence(freshlyRenderedSha256, evidence);
    expect(match.matched).toBe(false);
    if (match.matched) throw new Error("expected no match");
    expect(match.reason).toContain(freshlyRenderedSha256);
    expect(match.reason).toContain(MASTER_SHA256);
    expect(match.reason.toLowerCase()).toContain("awaiting review");
  });

  it("refuses an internally inconsistent evidence record (its own masterSha256 disagrees with its observation)", () => {
    const evidence = recordedEvidence({
      observation: cleanObservation({ masterSha256: "d".repeat(64) }),
    });
    const match = matchRenderToRecordedEvidence(MASTER_SHA256, evidence);
    expect(match.matched).toBe(false);
    if (match.matched) throw new Error("expected no match");
    expect(match.reason).toContain("internally inconsistent");
  });

  it("parses a well-formed evidence JSON file's shape", () => {
    const evidence = recordedEvidence();
    const parsed = parseRecordedRenderEvidence(JSON.parse(JSON.stringify(evidence)));
    expect(parsed.masterSha256).toBe(MASTER_SHA256);
    expect(parsed.reviewedBy).toBe("claude-code-manual-review");
    expect(parsed.observation.masterSha256).toBe(MASTER_SHA256);
  });

  it("fails closed on a malformed evidence file rather than silently producing undefined fields", () => {
    expect(() => parseRecordedRenderEvidence(null)).toThrow(RecordedRenderEvidenceError);
    expect(() => parseRecordedRenderEvidence({})).toThrow(RecordedRenderEvidenceError);
    expect(() => parseRecordedRenderEvidence({ masterSha256: MASTER_SHA256, reviewedBy: "x", reviewedAt: "x", notes: [] }))
      .toThrow(/observation/i);
    expect(() => parseRecordedRenderEvidence({
      masterSha256: MASTER_SHA256,
      reviewedBy: "x",
      reviewedAt: "x",
      notes: "not-an-array",
      observation: recordedEvidence().observation,
    })).toThrow(/notes/i);
  });

  it("the real committed offline-smoke evidence file parses and is internally consistent", () => {
    // Guards the actual file endToEndOfflinePipeline.ts reads at run time —
    // a malformed commit here would fail every future run of that script,
    // not just this test.
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, "fixtures", "mp4-smoke-offline-observation.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const evidence = parseRecordedRenderEvidence(raw);
    expect(evidence.masterSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.observation.masterSha256.toLowerCase()).toBe(evidence.masterSha256);
    expect(evidence.notes.length).toBeGreaterThan(0);
    // The gate must actually pass for the exact recorded bytes.
    const match = matchRenderToRecordedEvidence(evidence.masterSha256, evidence);
    expect(match.matched).toBe(true);
  });

  it("the committed evidence file's referenced frames actually exist, so a reviewer can open the exact bytes it approves", () => {
    // Independent review correctly pointed out that a downloaded CI artifact
    // for any given run almost never contains the bytes this record
    // approves (see the file's own note on non-determinism) — these
    // committed PNGs, extracted from the one masterSha256 this record is
    // about, are the only durable, independently-openable evidence of what
    // was actually inspected. A missing file here would make that claim
    // false.
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, "fixtures", "mp4-smoke-offline-observation.json"), "utf8"));
    const frameRefs: unknown = raw.frameRefs;
    expect(Array.isArray(frameRefs)).toBe(true);
    expect((frameRefs as unknown[]).length).toBeGreaterThan(0);
    for (const ref of frameRefs as string[]) {
      const framePath = join(here, "fixtures", ref);
      expect(existsSync(framePath), `missing committed frame: ${ref}`).toBe(true);
    }
  });
});

// QC BINDS TO THE COMPOSITOR'S RECEIPT, OR TO NOTHING. The reviewer records a
// receipt digest only from a genuine compositor receipt describing exactly the
// master it watched; otherwise the result carries none and the publish gate
// refuses it. It never copies a digest from a caller.
describe("the review verdict is bound to the genuine render receipt", () => {
  let control: ControlRender;
  let other: ControlRender;
  beforeAll(async () => {
    // Fixture renders are enough: this is about binding, not provenance.
    control = await renderControl({ fixtureNarration: true });
    other = await renderControl({ fixtureNarration: true, fixtureHook: true });
  }, 120_000);
  afterAll(async () => {
    for (const render of [control, other]) if (render) await rm(render.dir, { recursive: true, force: true });
  });

  it("records the receipt digest when the receipt's master is the observed master", () => {
    const result = reviewRenderedVideo(request, cleanObservation({ masterSha256: control.receipt.masterSha256 }), control.receipt);
    expect(result.reviewedReceiptDigest).toBe(control.receipt.digest);
    expect(result.reviewedMediaSha256).toBe(control.receipt.masterSha256);
  });

  it("records no receipt digest when no receipt is supplied", () => {
    const result = reviewRenderedVideo(request, cleanObservation({ masterSha256: control.receipt.masterSha256 }));
    expect(result.reviewedReceiptDigest).toBeUndefined();
  });

  it("refuses a receipt for a master the reviewer did not watch", () => {
    expect(() => reviewRenderedVideo(request, cleanObservation({ masterSha256: control.receipt.masterSha256 }), other.receipt))
      .toThrow(/did not watch/);
  });

  it("refuses a copied receipt", () => {
    expect(() => reviewRenderedVideo(
      request,
      cleanObservation({ masterSha256: control.receipt.masterSha256 }),
      { ...control.receipt } as RenderReceipt,
    )).toThrow(/did not issue/);
  });
});

// ---------------------------------------------------------------------------
// #157: PRICE PROVENANCE. Every price on screen says what kind of number it
// is, and its on-screen wording must be one that kind supports. Wording is
// judged on the display label only, never the reviewer's prose.
// ---------------------------------------------------------------------------
describe("price claims carry a provenance, and the label must match it", () => {
  const OBSERVED_AT = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
  const price = (over: Partial<RenderedVideoObservation["claims"][number]>) => ({
    text: "The RTX 4070 SUPER price shown.",
    kind: "price" as const,
    verification: "verified" as const,
    evidenceRefs: ["retail-parts:newegg-rtx-4070-super"],
    ...over,
  });
  const observation = (claim: RenderedVideoObservation["claims"][number]) => ({
    ...cleanObservation(),
    claims: [claim],
  });
  const codes = (claim: RenderedVideoObservation["claims"][number]) =>
    review(observation(claim)).issues.map((issue) => issue.code);
  const RETAILER = {
    kind: "retailer-observation" as const,
    retailer: "Newegg",
    observedAt: OBSERVED_AT,
    evidenceRef: "retail-parts:newegg-rtx-4070-super",
  };

  it("holds a price claim with no provenance, however verified it looks", () => {
    const result = review(observation(price({ displayLabel: "$599" })));
    expect(result.issues.map((issue) => issue.code)).toContain("price-provenance-missing");
    expect(result.decision).toBe("hold-for-human-review");
    expect(result.publishable).toBe(false);
  });

  it("holds a provenance outside the closed set, MSRP included", () => {
    const claim = price({ displayLabel: "MSRP $599", priceProvenance: { kind: "manufacturer-msrp" } as never });
    expect(codes(claim)).toContain("price-provenance-missing");
  });

  it("blocks a catalogue estimate shown without an estimate label", () => {
    const result = review(observation(price({ displayLabel: "$599", priceProvenance: { kind: "catalogue-estimate" } })));
    expect(result.issues.map((issue) => issue.code)).toContain("price-estimate-unlabeled");
    expect(result.publishable).toBe(false);
  });

  it("passes a catalogue estimate labelled the way the site labels it", () => {
    for (const label of ["Est. $599", "Estimated price: $599", "SpecSmith estimate $599"]) {
      const result = review(observation(price({ displayLabel: label, priceProvenance: { kind: "catalogue-estimate" } })));
      expect(result.issues.filter((issue) => issue.code.startsWith("price")), label).toEqual([]);
      expect(result.publishable, label).toBe(true);
    }
  });

  it("never lets an estimate be called live, real or current", () => {
    for (const label of ["Est. live price $599", "Est. real price $599", "Est. current price $599", "Est. today's price $599"]) {
      const claim = price({ displayLabel: label, priceProvenance: { kind: "catalogue-estimate" } });
      expect(codes(claim), label).toContain("price-live-wording-not-observed");
    }
  });

  it("judges wording on the on-screen label, not the reviewer's accurate prose (the #92 lesson)", () => {
    const claim = price({
      text: "SpecSmith catalogue estimate; not live or verified current retailer prices.",
      displayLabel: "Est. $599",
      priceProvenance: { kind: "catalogue-estimate" },
    });
    expect(codes(claim).filter((code) => code.startsWith("price"))).toEqual([]);
  });

  it("blocks an unlabelled fixture price, and never publishes a labelled one", () => {
    expect(codes(price({ displayLabel: "$599", priceProvenance: { kind: "fixture" } })))
      .toEqual(expect.arrayContaining(["price-fixture-unlabeled", "fixture-price"]));
    const labelled = review(observation(price({ displayLabel: "Sample price $599", priceProvenance: { kind: "fixture" } })));
    const labelledCodes = labelled.issues.map((issue) => issue.code);
    expect(labelledCodes).toContain("fixture-price");
    expect(labelledCodes).not.toContain("price-fixture-unlabeled");
    expect(labelled.publishable).toBe(false);
  });

  it("never lets a fixture be called live", () => {
    expect(codes(price({ displayLabel: "Sample live price $599", priceProvenance: { kind: "fixture" } })))
      .toContain("price-live-wording-not-observed");
  });

  it("lets a complete, fresh retailer observation be called live", () => {
    const result = review(observation(price({ displayLabel: "Live at Newegg: $599", priceProvenance: RETAILER })));
    expect(result.issues.filter((issue) => issue.code.startsWith("price") || issue.code.includes("stale"))).toEqual([]);
    expect(result.publishable).toBe(true);
  });

  it("holds a retailer observation missing its retailer, time or evidence", () => {
    const incomplete = [
      { ...RETAILER, retailer: "" },
      { ...RETAILER, observedAt: "" },
      { ...RETAILER, observedAt: "yesterday" },
      { ...RETAILER, observedAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString() },
      { ...RETAILER, evidenceRef: "" },
      { ...RETAILER, evidenceRef: "retail-parts:some-other-listing" },
    ];
    for (const provenance of incomplete) {
      const result = review(observation(price({ displayLabel: "$599 at Newegg", priceProvenance: provenance })));
      expect(result.issues.map((issue) => issue.code), JSON.stringify(provenance)).toContain("price-observation-incomplete");
      expect(result.decision).toBe("hold-for-human-review");
    }
  });

  it("blocks a stale observation described as live, and allows it without live wording", () => {
    const stale = { ...RETAILER, observedAt: new Date(NOW.getTime() - PRICE_FRESHNESS_MS - 60_000).toISOString() };
    expect(codes(price({ displayLabel: "Live at Newegg: $599", priceProvenance: stale }))).toContain("stale-price-presented-as-live");
    const dated = review(observation(price({ displayLabel: "$599 at Newegg on Sep 18", priceProvenance: stale })));
    expect(dated.issues.filter((issue) => issue.code.startsWith("price") || issue.code.includes("stale"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #157: HOW THE AUDIO WAS REVIEWED. A passing audio verdict needs an issued
// record that someone listened to the whole of these exact bytes under this
// exact receipt. A score or signal statistics hold; they never pass.
// ---------------------------------------------------------------------------
describe("audio passes only with a full listen bound to this receipt and master", () => {
  let other: ControlRender;
  beforeAll(async () => {
    other = await renderControl({ fixtureNarration: true, fixtureHook: true });
  }, 120_000);
  afterAll(async () => {
    if (other) await rm(other.dir, { recursive: true, force: true });
  });

  const bound = (receipt: RenderReceipt, over: Record<string, unknown> = {}) => ({
    method: "listened-full",
    reviewedBy: "constructed-test-control (no one listened)",
    reviewedAt: "2026-09-20T10:00:00.000Z",
    masterSha256: receipt.masterSha256,
    receiptDigest: receipt.digest,
    notes: ["CONSTRUCTED FOR A TEST: no one listened to these temporary bytes."],
    ...over,
  });

  it("holds a render with perfect audio scores when no one has listened", () => {
    const result = review(cleanObservation({ audioClarityScore: 10 }), { listeningReview: undefined });
    expect(result.issues.map((issue) => issue.code)).toContain("audio-not-listened");
    expect(result.decision).toBe("hold-for-human-review");
    expect(result.publishable).toBe(false);
    expect(result.audioReview).toBeUndefined();
  });

  it("holds signal-analysis-only and not-reviewed; neither counts as a listen", () => {
    for (const method of ["signal-analysis-only", "not-reviewed"] as const) {
      const result = review(cleanObservation({ audioClarityScore: 10 }), {
        listeningReview: constructedTestListen(REVIEWED.receipt, method),
      });
      expect(result.issues.map((issue) => issue.code), method).toContain("audio-not-listened");
      expect(result.decision, method).toBe("hold-for-human-review");
      expect(result.publishable, method).toBe(false);
    }
  });

  it("records the bound listen on the verdict for the publish gate to re-check", () => {
    const listen = constructedTestListen(REVIEWED.receipt);
    const result = review(cleanObservation(), { listeningReview: listen });
    expect(result.audioReview).toBe(listen);
    expect(result.publishable).toBe(true);
  });

  it("refuses a listen to another render's bytes (a replayed approval)", () => {
    const result = review(cleanObservation(), { listeningReview: constructedTestListen(other.receipt) });
    expect(result.issues.map((issue) => issue.code)).toContain("stale-audio-review");
    expect(result.publishable).toBe(false);
    expect(result.audioReview).toBeUndefined();
  });

  it("refuses a listen when the review is bound to no receipt at all", () => {
    const result = reviewRenderedVideo(request, cleanObservation(), undefined, {
      listeningReview: constructedTestListen(REVIEWED.receipt), now: NOW,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("stale-audio-review");
    expect(result.publishable).toBe(false);
  });

  it("refuses a hand-written listening record outright", () => {
    const forged = { ...constructedTestListen(REVIEWED.receipt) };
    expect(() => review(cleanObservation(), { listeningReview: forged as never })).toThrow(/did not issue/);
  });

  it("will not issue a listen for another master, another receipt, or a copied receipt", () => {
    const receipt = REVIEWED.receipt;
    expect(() => recordListeningReview(receipt, bound(receipt, { masterSha256: other.receipt.masterSha256 }), NOW))
      .toThrow(/not this master/);
    expect(() => recordListeningReview(receipt, bound(receipt, { receiptDigest: other.receipt.digest }), NOW))
      .toThrow(/not this receipt/);
    expect(() => recordListeningReview({ ...receipt } as RenderReceipt, bound(receipt), NOW))
      .toThrow(/compositor issued/);
  });

  it("will not issue a malformed listen", () => {
    const receipt = REVIEWED.receipt;
    const malformed: Array<[Record<string, unknown>, RegExp]> = [
      [bound(receipt, { method: "listened-partly" }), /not one of/],
      [bound(receipt, { method: undefined }), /not one of/],
      [bound(receipt, { reviewedBy: " " }), /reviewedBy/],
      [bound(receipt, { reviewedAt: "soon" }), /reviewedAt/],
      [bound(receipt, { reviewedAt: "2026-12-01T00:00:00.000Z" }), /future/],
      [bound(receipt, { notes: [] }), /what was heard/],
      [bound(receipt, { notes: "listened" }), /notes/],
      [bound(receipt, { masterSha256: "not-a-digest" }), /masterSha256/],
    ];
    for (const [record, message] of malformed) {
      expect(() => recordListeningReview(receipt, record, NOW), JSON.stringify(record)).toThrow(ListeningReviewError);
      expect(() => recordListeningReview(receipt, record, NOW)).toThrow(message);
    }
  });

  it("an issued listen is frozen and cannot be edited into a full listen", () => {
    const listen = constructedTestListen(REVIEWED.receipt, "signal-analysis-only");
    expect(Object.isFrozen(listen)).toBe(true);
    expect(() => { (listen as { method: string }).method = "listened-full"; }).toThrow();
    expect(isIssuedListeningReview(listen)).toBe(true);
    expect(isIssuedListeningReview(JSON.parse(JSON.stringify(listen)))).toBe(false);
  });

  it("the committed offline evidence records no listen, so even a matching render would hold", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, "fixtures", "mp4-smoke-offline-observation.json"), "utf8"));
    const evidence = parseRecordedRenderEvidence(raw);
    // Its notes describe the narration, but no full listen of those bytes is
    // recorded, and none is invented here.
    expect(evidence.audioReview).toBeUndefined();
  });

  it("parses a recorded listen's shape and refuses a non-object", () => {
    const base = {
      masterSha256: MASTER_SHA256, reviewedBy: "x", reviewedAt: "2026-09-02T18:05:00.000Z", notes: [],
      observation: cleanObservation(),
    };
    expect(parseRecordedRenderEvidence({ ...base, audioReview: bound(REVIEWED.receipt) }).audioReview?.method).toBe("listened-full");
    expect(() => parseRecordedRenderEvidence({ ...base, audioReview: "listened-full" })).toThrow(/audioReview/);
    expect(() => parseRecordedRenderEvidence({ ...base, audioReview: null })).toThrow(/audioReview/);
  });
});
