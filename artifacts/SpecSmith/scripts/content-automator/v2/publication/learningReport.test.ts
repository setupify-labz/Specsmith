// The learning report: comparable observations only, observation kept apart
// from hypothesis, every invalid comparison named with its reason, and a next
// brief that re-enters the normal workflow carrying its evidence.
//
// All publications and numbers here are SIMULATED, in a labelled simulation
// store; the report says so, and a production mission refuses it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_MISSION } from "../../creativeFileWorkflowCli.ts";
import { createStoredPublicationLedger, initPublicationStore } from "../../publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "../../types.ts";
import { buildCreativeBrief } from "../creative/fileWorkflow.ts";
import { seedSimulatedLedger } from "./boundary.ts";
import { buildLearningReport, formatLearningReport } from "./learningReport.ts";
import { nextBriefForWorkflow } from "./nextBrief.ts";
import { createSimulatedObservationSource, importProviderObservations, type ProviderObservationBatch } from "./observations.ts";

// Each scenario writes several ledgers and observation sets to disk; under a
// loaded parallel run that can exceed the 5s default without being slow.
vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const NOW = new Date("2026-09-05T00:00:00.000Z");
const PUBLISHED = "2026-09-01T12:00:00.000Z";
const AT_24H = "2026-09-02T12:00:00.000Z";

function fingerprint(creativeId: string, platform: VideoPlatform, overrides: Partial<CreativeFingerprint>): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1", creativeId, packageId: "p", campaignId: "c", ideaId: "i", platform, format: "comparison",
    feature: "compare", subjectIds: [], hookFamily: "question", hookText: "Is A faster?", visualWorld: "ui", narrativeEngine: "tally-then-average",
    targetDurationSeconds: 20, beatCount: 4, plannedBeatChangesPer10Seconds: 2, editDensity: "medium", captionedBeatRatio: 1,
    captionDensity: "medium", firstVisualType: "deterministic-ui", voiceName: "espeak fixture", sfxDensity: "low", ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late", hashtagStrategy: "intent-balanced-v1", hashtags: [], experimentId: "none", experimentPrimaryMetric: "retention",
    changedVariable: "none", contentFreshness: "evergreen", ...overrides,
  } as CreativeFingerprint;
}

async function publish(root: string, creativeId: string, platform: VideoPlatform, overrides: Partial<CreativeFingerprint>, publishedAt = PUBLISHED) {
  await createStoredPublicationLedger(root, fingerprint(creativeId, platform, overrides));
  await seedSimulatedLedger({ storeRoot: root, creativeId, through: "published", providerPostId: `SIM-${creativeId}`, at: new Date(publishedAt),
    mediaSha256: "a".repeat(64), variantId: `${platform}-1080x1920-30`, destination: { provider: "metricool", accountId: "acct-1", platform }, title: "t", description: "d" });
}

const METRICS = createSimulatedObservationSource();

async function observe(root: string, creativeId: string, platform: VideoPlatform, collectedAt: string, metrics: ProviderObservationBatch["metrics"],
  retentionCurve: ProviderObservationBatch["retentionCurve"] = "unavailable") {
  await importProviderObservations({ storeRoot: root, now: NOW, batch: METRICS.respond({
    kind: "PROVIDER_OBSERVATIONS", provider: "metricool", platform, accountId: "acct-1",
    providerPostId: `SIM-${creativeId}`, collectedAt, metrics, retentionCurve, raw: { note: "SIMULATED" },
  }) });
}

/** Five simulated publications, each built to exercise one comparison rule. */
async function scenario(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "master8-learning-"));
  roots.push(root);
  await initPublicationStore(root, "simulation", "learning report test");
  // a and b differ in exactly one recorded variable: the hook.
  await publish(root, "creative-a", "youtube-shorts", { hookFamily: "question" });
  await publish(root, "creative-b", "youtube-shorts", { hookFamily: "result-first" });
  // c changes the hook's partner variables too: duration and CTA.
  await publish(root, "creative-c", "youtube-shorts", { hookFamily: "question", targetDurationSeconds: 35, ctaFamily: "builder-link" });
  // d is ten hours old.
  await publish(root, "creative-d", "youtube-shorts", { hookFamily: "result-first" }, "2026-09-04T14:00:00.000Z");
  // e is alone on its platform.
  await publish(root, "creative-e", "tiktok", { hookFamily: "question" });

  await observe(root, "creative-a", "youtube-shorts", AT_24H, { views: 5200, stayedToWatchRate: 0.62, averagePercentageViewed: 0.48, saves: 30 },
    { seconds: [0, 1, 2, 3, 6, 9], shareWatching: [1, 0.92, 0.85, 0.62, 0.55, 0.5] });
  await observe(root, "creative-b", "youtube-shorts", AT_24H, { views: 4900, stayedToWatchRate: 0.45, averagePercentageViewed: 0.44, saves: "unavailable" });
  await observe(root, "creative-c", "youtube-shorts", AT_24H, { views: 7000, stayedToWatchRate: 0.7, averagePercentageViewed: 0.3, saves: 40 });
  await observe(root, "creative-d", "youtube-shorts", "2026-09-04T23:00:00.000Z", { views: 300, stayedToWatchRate: 0.9 });
  await observe(root, "creative-e", "tiktok", AT_24H, { views: 800, stayedToWatchRate: 0.55 });
  return root;
}

const find = (report: Awaited<ReturnType<typeof buildLearningReport>>, a: string, b: string, metric: string, hours = 24) =>
  report.comparisons.find((entry) => entry.a.creativeId === a && entry.b.creativeId === b && entry.metricId === metric && entry.checkpointHours === hours)!;

describe("only comparable observations are compared", () => {
  it("a single-variable difference at the same age, platform and definition is a valid observation, with a separate hypothesis", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    const ab = find(report, "creative-a", "creative-b", "stayed-to-watch-rate");
    expect(ab.valid).toBe(true);
    expect(ab.differingVariables).toEqual(["hookFamily"]);
    expect(ab.observation).toBe("[SIMULATED] At 24h on youtube-shorts, creative-a (hookFamily = question) had a higher stayed-to-watch-rate than creative-b (hookFamily = result-first): 0.62 vs 0.45.");
    expect(ab.hypothesis).toMatch(/may have contributed\. One video per side: this is a hypothesis to test, not a finding/);
  });

  it("a difference under 10% is reported as indistinguishable, with no hypothesis", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    const ab = find(report, "creative-a", "creative-b", "average-percentage-viewed");
    expect(ab).toMatchObject({ valid: true, hypothesis: null });
    expect(ab.observation).toMatch(/within 10% of each other \(0\.48 vs 0\.44\)/);
  });

  it("several changed variables, a too-new upload, an unavailable value, or a missing window make a comparison invalid, by name", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    expect(find(report, "creative-a", "creative-c", "stayed-to-watch-rate").invalidReasons.join(" ")).toMatch(/3 variables changed at once \(hookFamily|variables changed at once/);
    expect(find(report, "creative-a", "creative-d", "stayed-to-watch-rate").invalidReasons.join(" ")).toMatch(/creative-d is \d+(\.\d)?h old, too new for a 24h comparison/);
    expect(find(report, "creative-a", "creative-b", "saves").invalidReasons.join(" ")).toMatch(/creative-b's saves is unavailable/);
    // A 24h number is not a 72h number: stale relative to the checkpoint, so not used.
    expect(find(report, "creative-a", "creative-b", "stayed-to-watch-rate", 72).invalidReasons.join(" ")).toMatch(/no stayed-to-watch-rate observation within 6h of 72h/);
    for (const entry of report.comparisons.filter((comparison) => !comparison.valid)) {
      expect(entry.observation).toBeNull();
      expect(entry.hypothesis).toBeNull();
    }
  });

  it("never compares across platforms, or on a field SpecSmith has no definition for", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    expect(report.comparisons.some((entry) => entry.a.creativeId === "creative-e" || entry.b.creativeId === "creative-e")).toBe(false);
    expect(report.comparisons.every((entry) => !entry.metricId.startsWith("provider:"))).toBe(true);
    expect(report.unknowns).toContain("Only 1 published tiktok video(s): nothing on tiktok can be compared yet.");
  });

  it("says where viewers left only where the provider returned a curve", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    expect(report.retention.find((entry) => entry.creativeId === "creative-a")).toMatchObject({ available: true, note: expect.stringMatching(/steepest loss between 2s and 3s \(85% → 62% still watching\)/) });
    expect(report.retention.find((entry) => entry.creativeId === "creative-b")).toMatchObject({ available: false, note: expect.stringMatching(/unknown/) });
  });
});

describe("the editor report and the next brief", () => {
  it("answers the five questions, labels simulated data, and claims no causation", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    const text = formatLearningReport(report);
    for (const heading of ["Which videos have enough comparable data?", "Where did viewers appear to leave?",
      "Which creative choices are associated with stronger or weaker results?", "What remains unknown?", "One testable change for the next brief:"]) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/SIMULATED DATA, NOT REAL PERFORMANCE/);
    expect(text).not.toMatch(/\b(causes?|caused|proves?|proven|winner|because of)\b/i);
    expect(text).toMatch(/cannot approve a claim, change benchmark data, schedule a post or authorize publishing/);
  });

  it("proposes one change, holding everything else constant, from the strongest valid comparison", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    expect(report.nextBrief.proposedChange).toMatchObject({
      variable: "hookFamily", tryValue: "question", insteadOf: "result-first", metric: "stayed-to-watch-rate", checkpointHours: 24,
    });
    expect(report.nextBrief.proposedChange!.holdConstant).toEqual(expect.arrayContaining(["targetDurationSeconds = 20", "ctaFamily = compare-on-specsmithpc"]));
    expect(report.nextBrief.proposedChange!.status).toMatch(/not a causal result/);
  });

  it("proposes nothing when nothing qualifies, rather than inventing a change", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-learning-"));
    roots.push(root);
    await initPublicationStore(root, "simulation", "learning report test");
    await publish(root, "creative-a", "youtube-shorts", {});
    await observe(root, "creative-a", "youtube-shorts", AT_24H, { views: 100 });
    const report = await buildLearningReport({ storeRoot: root, now: NOW });
    expect(report.nextBrief.proposedChange).toBeNull();
    expect(formatLearningReport(report)).toMatch(/None justified yet/);
  });

  it("an empty production store reports that there is nothing to learn from", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-learning-prod-"));
    roots.push(root);
    const report = await buildLearningReport({ storeRoot: root, now: NOW });
    expect(report).toMatchObject({ storeMode: "production", videos: [], comparisons: [] });
    expect(report.unknowns[0]).toMatch(/No provider-confirmed publication exists/);
  });

  it("re-enters the normal workflow through buildCreativeBrief, carrying its evidence, without changing what may be said", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    const handoff = nextBriefForWorkflow(report.nextBrief, DEMO_MISSION);
    const baseline = buildCreativeBrief(DEMO_MISSION, []);
    expect(handoff.brief.memoryObservations).toEqual(report.nextBrief.memoryObservations);
    expect(handoff.brief.memoryObservations.every((line) => line.includes(report.reportId))).toBe(true);
    expect(handoff.brief.memoryObservations.join(" ")).toMatch(/Hypothesis to test .* try hookFamily = "question" instead of "result-first"/);
    expect(handoff.brief.briefHash).not.toBe(baseline.briefHash);
    // Performance evidence does not touch claims, disclosures or capture views.
    expect(handoff.brief.approvedClaims).toEqual(baseline.approvedClaims);
    expect(handoff.brief.refusedClaims).toEqual(baseline.refusedClaims);
    expect(handoff.brief.requiredDisclosures).toEqual(baseline.requiredDisclosures);
    expect(handoff.brief.captureViews).toEqual(baseline.captureViews);
    expect(handoff.evidence).toMatchObject({ reportId: report.reportId, creativeIds: expect.arrayContaining(["creative-a", "creative-b"]) });
    expect(handoff.evidence.observationIds.length).toBeGreaterThan(0);
    expect(handoff.evidence.reviewPacketIds).toEqual(expect.arrayContaining(["SEEDED-creative-a"]));
  });

  it("a report built on simulated data cannot inform a production brief", async () => {
    const report = await buildLearningReport({ storeRoot: await scenario(), now: NOW });
    expect(() => nextBriefForWorkflow(report.nextBrief, { ...DEMO_MISSION, researchSynthetic: false })).toThrow(/simulated performance data; it may inform only an engineering/);
  });
});
