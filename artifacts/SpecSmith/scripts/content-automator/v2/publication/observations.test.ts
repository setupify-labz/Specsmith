// Provider observations: what is stored, what is refused, and that nothing
// missing becomes a zero. Publications here are seeded simulated preconditions
// in a simulation store; production-store tests show the refusals that happen
// before any number is accepted.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStoredPublicationLedger, initPublicationStore, loadStoredPublicationLedger } from "../../publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "../../types.ts";
import { seedSimulatedLedger } from "./boundary.ts";
import { buildLearningReport } from "./learningReport.ts";
import {
  collectProviderObservations,
  createSimulatedObservationSource,
  importProviderObservations,
  loadUnverifiedObservations,
  type ObservationSource,
  PRODUCTION_OBSERVATION_SOURCES,
  recordUnverifiedObservations,
  latestObservation,
  loadObservationFailures,
  loadObservations,
  recordObservationFailure,
  type ProviderObservationBatch,
} from "./observations.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";
const NOW = new Date("2026-09-10T00:00:00.000Z");

async function publishedStore(platform: VideoPlatform = "youtube-shorts", creativeId = "creative-1", postId = "SIM-POST-1"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "master8-observations-"));
  roots.push(root);
  await initPublicationStore(root, "simulation", "observation test");
  await createStoredPublicationLedger(root, { creativeId, packageId: "p", platform, ideaId: "i", campaignId: "c", targetDurationSeconds: 20 } as CreativeFingerprint);
  await seedSimulatedLedger({ storeRoot: root, creativeId, through: "published", providerPostId: postId, at: new Date(PUBLISHED_AT), mediaSha256: "a".repeat(64),
    variantId: `${platform}-1080x1920-30`, destination: { provider: "metricool", accountId: "acct-1", platform }, title: "t", description: "d" });
  return root;
}

function batch(overrides: Partial<ProviderObservationBatch> = {}): ProviderObservationBatch {
  return {
    kind: "PROVIDER_OBSERVATIONS", provider: "metricool",
    platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1", collectedAt: "2026-09-02T12:00:00.000Z",
    metrics: { views: 4800, stayedToWatchRate: 0.62, averagePercentageViewed: "unavailable" },
    retentionCurve: { seconds: [0, 2, 4, 6], shareWatching: [1, 0.7, 0.6, 0.55] },
    raw: { simulated: "SIMULATED provider response" },
    ...overrides,
  };
}

/** What a registered simulated source returns: an issued batch. */
const sim = createSimulatedObservationSource();
const issued = (overrides: Partial<ProviderObservationBatch> = {}) => sim.respond(batch(overrides));

describe("an observation carries its identities and its kind", () => {
  it("binds each number to the platform, account, post, creative, cut, media hash, definition, source and age", async () => {
    const root = await publishedStore();
    const report = await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    const views = report.stored.find((record) => record.metricId === "views")!;
    expect(views).toMatchObject({
      platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1", creativeId: "creative-1",
      variantId: "youtube-shorts-1080x1920-30", mediaSha256: "a".repeat(64), value: 4800, unit: "count",
      definitionId: "youtube-shorts:views", state: "observed", source: sim.sourceId, sourceMechanism: "simulated", simulated: true,
      collectedAt: "2026-09-02T12:00:00.000Z", publishedAt: PUBLISHED_AT, publicationAgeHours: 24,
    });
    expect(views.definition).toMatch(/Times the video was played/);
    expect(views.rawSha256).toBe(report.rawSha256);
  });

  it("never turns a missing or unavailable metric into zero", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    const byId = (id: string) => stored.find((record) => record.metricId === id)!;
    expect(byId("average-percentage-viewed")).toMatchObject({ value: null, state: "unavailable", unavailableReason: "The provider reported it unavailable." });
    expect(byId("shares")).toMatchObject({ value: null, state: "unavailable", unavailableReason: "The provider did not return this field." });
    expect(stored.some((record) => record.value === 0)).toBe(false);
  });

  it("labels a derived number with its formula and the observations it came from", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    const perHour = stored.find((record) => record.metricId === "views-per-hour")!;
    expect(perHour).toMatchObject({ state: "derived", value: 200, formula: "views / publicationAgeHours (4800 / 24)" });
    expect(perHour.derivedFrom).toEqual([stored.find((record) => record.metricId === "views")!.observationId]);
  });

  it("keeps fields SpecSmith has no definition for, and never makes them comparable", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: issued({ metrics: { views: 10, impressionsShownInFeed: 900 } }), now: NOW });
    expect(stored.find((record) => record.metricId === "provider:impressionsShownInFeed")).toMatchObject({ definitionId: null, unit: null, value: 900 });
  });

  it("records where viewers left only when the provider returns a curve", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: issued({ retentionCurve: "unavailable" }), now: NOW });
    const curve = stored.find((record) => record.metricId === "retention-curve")!;
    expect(curve).toMatchObject({ state: "unavailable", value: null, unavailableReason: expect.stringMatching(/where viewers left is unknown/) });
    expect(curve.curve).toBeUndefined();
  });
});

describe("site clicks need real attribution; nothing else is inferred", () => {
  it("drops a click count with no tracked URL for this creative", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: issued({ metrics: { views: 10, siteClicks: 37 } }), now: NOW });
    expect(stored.find((record) => record.metricId === "site-clicks")).toMatchObject({ value: null, state: "unavailable", unavailableReason: expect.stringMatching(/without attribution/) });
  });

  it("keeps it with a tracked URL whose utm_content is this creative and a measuring source", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, now: NOW, batch: issued({ metrics: { views: 10, siteClicks: 37 },
      attribution: { trackedUrl: "https://specsmithpc.com/compare?utm_content=creative-1", utmContent: "creative-1", measuredBy: "site analytics (simulated)" } }) });
    expect(stored.find((record) => record.metricId === "site-clicks")).toMatchObject({ value: 37, state: "observed" });
    expect(stored.some((record) => /conversion|sale|revenue/i.test(record.metricId))).toBe(false);
  });
});

describe("imports are idempotent and history-preserving", () => {
  it("the same batch twice stores nothing new", async () => {
    const root = await publishedStore();
    const first = await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    const second = await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    expect(second.stored).toEqual([]);
    expect(second.alreadyPresent).toBe(first.stored.length);
  });

  it("a different value for the same metric and time is refused", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ metrics: { views: 9999, stayedToWatchRate: 0.62, averagePercentageViewed: "unavailable" } }), now: NOW }))
      .rejects.toMatchObject({ code: "conflicting-observation" });
  });

  it("an older batch arriving late is kept, and never replaces the newer number", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: issued({ collectedAt: "2026-09-04T12:00:00.000Z", metrics: { views: 9000 } }), now: NOW });
    await importProviderObservations({ storeRoot: root, batch: issued({ collectedAt: "2026-09-02T12:00:00.000Z", metrics: { views: 4800 } }), now: NOW });
    const records = await loadObservations(root, "SIM-POST-1");
    expect(records.filter((record) => record.metricId === "views").map((record) => record.value)).toEqual([4800, 9000]);
    expect(latestObservation(records, "views")?.value).toBe(9000);
  });

  it("records metrics observed on the ledger, after publication only", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: issued(), now: NOW });
    const ledger = (await loadStoredPublicationLedger(root, "creative-1"))!;
    expect(ledger.events.at(-1)).toMatchObject({ status: "analytics-partial", simulated: true });
    await importProviderObservations({ storeRoot: root, batch: issued({ collectedAt: "2026-09-08T13:00:00.000Z" }), now: NOW });
    expect((await loadStoredPublicationLedger(root, "creative-1"))!.events.at(-1)!.status).toBe("analytics-complete");
  });
});

describe("observations that cannot be attributed are refused whole", () => {
  it("a post SpecSmith did not publish", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ providerPostId: "SIM-POST-somebody-else" }), now: NOW })).rejects.toMatchObject({ code: "unknown-post" });
  });

  it("another account or platform than was authorized", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ accountId: "acct-2" }), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ platform: "tiktok" }), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("collected before publication, or in the future", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ collectedAt: "2026-08-31T00:00:00.000Z" }), now: NOW })).rejects.toMatchObject({ code: "impossible-timing" });
    await expect(importProviderObservations({ storeRoot: root, batch: issued({ collectedAt: "2026-09-11T00:00:00.000Z" }), now: NOW })).rejects.toMatchObject({ code: "impossible-timing" });
  });

  it("a post that was only scheduled, not confirmed published", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-observations-"));
    roots.push(root);
    await initPublicationStore(root, "simulation", "observation test");
    await createStoredPublicationLedger(root, { creativeId: "creative-1", packageId: "p", platform: "youtube-shorts" } as CreativeFingerprint);
    await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-1", through: "scheduled", providerPostId: "SIM-POST-1", mediaSha256: "a".repeat(64),
      variantId: "v", destination: { provider: "metricool", accountId: "acct-1", platform: "youtube-shorts" }, title: "t", description: "d" });
    await expect(importProviderObservations({ storeRoot: root, batch: issued(), now: NOW })).rejects.toMatchObject({ code: "not-published" });
  });
});

async function productionStore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "master8-observations-prod-"));
  roots.push(root);
  return root;
}

/** A hand-built batch dressed as a real Metricool fetch: plausible ids, a 200 response, `simulated: false`. */
function fabricated(overrides: Record<string, unknown> = {}): ProviderObservationBatch {
  return {
    ...batch({ providerPostId: "7300000000000000001", metrics: { views: 98000, stayedToWatchRate: 0.81, averagePercentageViewed: 0.77 }, raw: { status: 200, body: { views: 98000 } } }),
    source: { adapter: "metricool-rest", simulated: false, authenticated: true },
    ...overrides,
  } as ProviderObservationBatch;
}

describe("ADVERSARIAL: fabricated metrics never enter as observed provider data", () => {
  it("production ingestion is closed: no verified source is registered", () => {
    expect(PRODUCTION_OBSERVATION_SOURCES).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_OBSERVATION_SOURCES)).toBe(true);
  });

  it("a production store refuses a hand-built batch that calls itself real, stores nothing, and names the missing capability", async () => {
    const root = await productionStore();
    await expect(importProviderObservations({ storeRoot: root, batch: fabricated(), now: NOW }))
      .rejects.toMatchObject({ code: "no-verified-source", message: expect.stringMatching(/assembled by a caller.*authenticated provider fetch.*verifiable export/s) });
    expect(await loadObservations(root, "7300000000000000001")).toEqual([]);
  });

  it("a production store refuses batches from the simulated source", async () => {
    const root = await productionStore();
    await expect(importProviderObservations({ storeRoot: root, batch: issued(), now: NOW })).rejects.toMatchObject({ code: "synthetic-in-production" });
    await expect(collectProviderObservations({ storeRoot: root, source: sim, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1" } })).rejects.toMatchObject({ code: "synthetic-in-production" });
  });

  it("a caller-written source claiming an authenticated fetch is refused before it is even called", async () => {
    const root = await productionStore();
    let called = false;
    const impostor: ObservationSource = {
      sourceId: "metricool-rest", mechanism: "authenticated-fetch", simulated: false,
      async fetch() { called = true; return fabricated(); },
    };
    await expect(collectProviderObservations({ storeRoot: root, source: impostor, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-1", providerPostId: "7300000000000000001" } })).rejects.toMatchObject({ code: "no-verified-source" });
    expect(called).toBe(false);
  });

  it("a simulation store refuses a caller-written source and a hand-built batch, even when they say they are simulated", async () => {
    const root = await publishedStore();
    let called = false;
    const impostor: ObservationSource = { sourceId: "SIMULATED metrics source", mechanism: "simulated", simulated: true, async fetch() { called = true; return batch(); } };
    await expect(collectProviderObservations({ storeRoot: root, source: impostor, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1" } })).rejects.toMatchObject({ code: "unverified-source" });
    expect(called).toBe(false);
    await expect(importProviderObservations({ storeRoot: root, batch: batch(), now: NOW })).rejects.toMatchObject({ code: "unverified-source" });
    await expect(importProviderObservations({ storeRoot: root, batch: fabricated({ providerPostId: "SIM-POST-1" }), now: NOW })).rejects.toMatchObject({ code: "unverified-source" });
    expect(await loadObservations(root, "SIM-POST-1")).toEqual([]);
  });

  it("an issued batch cannot be copied, round-tripped or edited into new numbers", async () => {
    const root = await publishedStore();
    const genuine = issued();
    expect(() => { (genuine.metrics as Record<string, number>).views = 999999; }).toThrow(TypeError);
    await expect(importProviderObservations({ storeRoot: root, batch: { ...genuine, metrics: { ...genuine.metrics, views: 999999 } }, now: NOW }))
      .rejects.toMatchObject({ code: "unverified-source" });
    await expect(importProviderObservations({ storeRoot: root, batch: JSON.parse(JSON.stringify(genuine)), now: NOW }))
      .rejects.toMatchObject({ code: "unverified-source" });
    const report = await importProviderObservations({ storeRoot: root, batch: genuine, now: NOW });
    expect(report.stored.find((record) => record.metricId === "views")?.value).toBe(4800);
  });

  it("a source that answers about another post than the one asked for is refused", async () => {
    const root = await publishedStore();
    const source = createSimulatedObservationSource();
    source.stage(batch({ providerPostId: "SIM-POST-1" }));
    await expect(collectProviderObservations({ storeRoot: root, source, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-2", providerPostId: "SIM-POST-1" } })).rejects.toMatchObject({ code: "identity-mismatch" });
    const ok = await collectProviderObservations({ storeRoot: root, source, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1" } });
    expect(ok.stored.length).toBeGreaterThan(0);
  });

  it("numbers supplied by hand are kept, labelled unverified, and never become observations or learning", async () => {
    const root = await publishedStore();
    const kept = await recordUnverifiedObservations({ storeRoot: root, providerPostId: "SIM-POST-1", suppliedBy: "editor, typed from the dashboard",
      supplied: { views: 98000, stayedToWatchRate: 0.81 }, now: NOW });
    expect(kept).toMatchObject({ verification: "unverified", reason: expect.stringMatching(/Not evidence of performance/) });
    expect(await loadUnverifiedObservations(root, "SIM-POST-1")).toHaveLength(1);
    expect(await loadObservations(root, "SIM-POST-1")).toEqual([]);
    expect((await loadStoredPublicationLedger(root, "creative-1"))!.events.at(-1)!.status).toBe("published");
    const report = await buildLearningReport({ storeRoot: root, now: NOW });
    expect(report.nextBrief.evidence.observationIds).toEqual([]);
    expect(report.unknowns.join("\n")).toMatch(/supplied by hand and kept as UNVERIFIED were not used: creative-1 \(1\)/);
  });
});

describe("simulated and real numbers never mix", () => {
  it("a simulation store refuses a real source's batch", async () => {
    const root = await publishedStore();
    const realLooking: ObservationSource = { sourceId: "metricool-rest", mechanism: "authenticated-fetch", simulated: false, async fetch() { return batch(); } };
    await expect(collectProviderObservations({ storeRoot: root, source: realLooking, now: NOW,
      request: { provider: "metricool", platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1" } })).rejects.toMatchObject({ code: "store-mode" });
  });
});

describe("failures are recorded without numbers", () => {
  it("keeps a failed or temporarily unavailable collection as a fact, with no values", async () => {
    const root = await publishedStore();
    await recordObservationFailure({ storeRoot: root, providerPostId: "SIM-POST-1", attemptedAt: "2026-09-02T12:00:00.000Z", reason: "provider returned 503", temporary: true });
    expect(await loadObservationFailures(root, "SIM-POST-1")).toEqual([expect.objectContaining({ reason: "provider returned 503", temporary: true, recordedValues: "none" })]);
    expect(await loadObservations(root, "SIM-POST-1")).toEqual([]);
  });
});
