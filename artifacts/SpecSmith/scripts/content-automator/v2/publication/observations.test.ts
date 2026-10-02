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
import {
  importProviderObservations,
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
    kind: "PROVIDER_OBSERVATIONS", provider: "metricool", source: { adapter: "simulated-provider", simulated: true },
    platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1", collectedAt: "2026-09-02T12:00:00.000Z",
    metrics: { views: 4800, stayedToWatchRate: 0.62, averagePercentageViewed: "unavailable" },
    retentionCurve: { seconds: [0, 2, 4, 6], shareWatching: [1, 0.7, 0.6, 0.55] },
    raw: { simulated: "SIMULATED provider response" },
    ...overrides,
  };
}

describe("an observation carries its identities and its kind", () => {
  it("binds each number to the platform, account, post, creative, cut, media hash, definition, source and age", async () => {
    const root = await publishedStore();
    const report = await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    const views = report.stored.find((record) => record.metricId === "views")!;
    expect(views).toMatchObject({
      platform: "youtube-shorts", accountId: "acct-1", providerPostId: "SIM-POST-1", creativeId: "creative-1",
      variantId: "youtube-shorts-1080x1920-30", mediaSha256: "a".repeat(64), value: 4800, unit: "count",
      definitionId: "youtube-shorts:views", state: "observed", source: "simulated-provider", simulated: true,
      collectedAt: "2026-09-02T12:00:00.000Z", publishedAt: PUBLISHED_AT, publicationAgeHours: 24,
    });
    expect(views.definition).toMatch(/Times the video was played/);
    expect(views.rawSha256).toBe(report.rawSha256);
  });

  it("never turns a missing or unavailable metric into zero", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    const byId = (id: string) => stored.find((record) => record.metricId === id)!;
    expect(byId("average-percentage-viewed")).toMatchObject({ value: null, state: "unavailable", unavailableReason: "The provider reported it unavailable." });
    expect(byId("shares")).toMatchObject({ value: null, state: "unavailable", unavailableReason: "The provider did not return this field." });
    expect(stored.some((record) => record.value === 0)).toBe(false);
  });

  it("labels a derived number with its formula and the observations it came from", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    const perHour = stored.find((record) => record.metricId === "views-per-hour")!;
    expect(perHour).toMatchObject({ state: "derived", value: 200, formula: "views / publicationAgeHours (4800 / 24)" });
    expect(perHour.derivedFrom).toEqual([stored.find((record) => record.metricId === "views")!.observationId]);
  });

  it("keeps fields SpecSmith has no definition for, and never makes them comparable", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: batch({ metrics: { views: 10, impressionsShownInFeed: 900 } }), now: NOW });
    expect(stored.find((record) => record.metricId === "provider:impressionsShownInFeed")).toMatchObject({ definitionId: null, unit: null, value: 900 });
  });

  it("records where viewers left only when the provider returns a curve", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: batch({ retentionCurve: "unavailable" }), now: NOW });
    const curve = stored.find((record) => record.metricId === "retention-curve")!;
    expect(curve).toMatchObject({ state: "unavailable", value: null, unavailableReason: expect.stringMatching(/where viewers left is unknown/) });
    expect(curve.curve).toBeUndefined();
  });
});

describe("site clicks need real attribution; nothing else is inferred", () => {
  it("drops a click count with no tracked URL for this creative", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, batch: batch({ metrics: { views: 10, siteClicks: 37 } }), now: NOW });
    expect(stored.find((record) => record.metricId === "site-clicks")).toMatchObject({ value: null, state: "unavailable", unavailableReason: expect.stringMatching(/without attribution/) });
  });

  it("keeps it with a tracked URL whose utm_content is this creative and a measuring source", async () => {
    const root = await publishedStore();
    const { stored } = await importProviderObservations({ storeRoot: root, now: NOW, batch: batch({ metrics: { views: 10, siteClicks: 37 },
      attribution: { trackedUrl: "https://specsmithpc.com/compare?utm_content=creative-1", utmContent: "creative-1", measuredBy: "site analytics (simulated)" } }) });
    expect(stored.find((record) => record.metricId === "site-clicks")).toMatchObject({ value: 37, state: "observed" });
    expect(stored.some((record) => /conversion|sale|revenue/i.test(record.metricId))).toBe(false);
  });
});

describe("imports are idempotent and history-preserving", () => {
  it("the same batch twice stores nothing new", async () => {
    const root = await publishedStore();
    const first = await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    const second = await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    expect(second.stored).toEqual([]);
    expect(second.alreadyPresent).toBe(first.stored.length);
  });

  it("a different value for the same metric and time is refused", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ metrics: { views: 9999, stayedToWatchRate: 0.62, averagePercentageViewed: "unavailable" } }), now: NOW }))
      .rejects.toMatchObject({ code: "conflicting-observation" });
  });

  it("an older batch arriving late is kept, and never replaces the newer number", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: batch({ collectedAt: "2026-09-04T12:00:00.000Z", metrics: { views: 9000 } }), now: NOW });
    await importProviderObservations({ storeRoot: root, batch: batch({ collectedAt: "2026-09-02T12:00:00.000Z", metrics: { views: 4800 } }), now: NOW });
    const records = await loadObservations(root, "SIM-POST-1");
    expect(records.filter((record) => record.metricId === "views").map((record) => record.value)).toEqual([4800, 9000]);
    expect(latestObservation(records, "views")?.value).toBe(9000);
  });

  it("records metrics observed on the ledger, after publication only", async () => {
    const root = await publishedStore();
    await importProviderObservations({ storeRoot: root, batch: batch(), now: NOW });
    const ledger = (await loadStoredPublicationLedger(root, "creative-1"))!;
    expect(ledger.events.at(-1)).toMatchObject({ status: "analytics-partial", simulated: true });
    await importProviderObservations({ storeRoot: root, batch: batch({ collectedAt: "2026-09-08T13:00:00.000Z" }), now: NOW });
    expect((await loadStoredPublicationLedger(root, "creative-1"))!.events.at(-1)!.status).toBe("analytics-complete");
  });
});

describe("observations that cannot be attributed are refused whole", () => {
  it("a post SpecSmith did not publish", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ providerPostId: "SIM-POST-somebody-else" }), now: NOW })).rejects.toMatchObject({ code: "unknown-post" });
  });

  it("another account or platform than was authorized", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ accountId: "acct-2" }), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ platform: "tiktok" }), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("collected before publication, or in the future", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ collectedAt: "2026-08-31T00:00:00.000Z" }), now: NOW })).rejects.toMatchObject({ code: "impossible-timing" });
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ collectedAt: "2026-09-11T00:00:00.000Z" }), now: NOW })).rejects.toMatchObject({ code: "impossible-timing" });
  });

  it("a post that was only scheduled, not confirmed published", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-observations-"));
    roots.push(root);
    await initPublicationStore(root, "simulation", "observation test");
    await createStoredPublicationLedger(root, { creativeId: "creative-1", packageId: "p", platform: "youtube-shorts" } as CreativeFingerprint);
    await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-1", through: "scheduled", providerPostId: "SIM-POST-1", mediaSha256: "a".repeat(64),
      variantId: "v", destination: { provider: "metricool", accountId: "acct-1", platform: "youtube-shorts" }, title: "t", description: "d" });
    await expect(importProviderObservations({ storeRoot: root, batch: batch(), now: NOW })).rejects.toMatchObject({ code: "not-published" });
  });
});

describe("simulated and real numbers never mix", () => {
  it("a production store refuses simulated, fixture or synthetic batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-observations-prod-"));
    roots.push(root);
    await expect(importProviderObservations({ storeRoot: root, batch: batch(), now: NOW })).rejects.toMatchObject({ code: "synthetic-in-production" });
    await expect(importProviderObservations({ storeRoot: root, now: NOW, batch: batch({ source: { adapter: "metricool-rest", simulated: false }, raw: { note: "FIXTURE data for a demo" } }) }))
      .rejects.toMatchObject({ code: "synthetic-in-production" });
  });

  it("a production store gets past that check for a real-looking batch, and then needs a real publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "master8-observations-prod-"));
    roots.push(root);
    await expect(importProviderObservations({ storeRoot: root, now: NOW, batch: batch({ source: { adapter: "metricool-rest", simulated: false }, providerPostId: "real-post-9", raw: { views: 10 } }) }))
      .rejects.toMatchObject({ code: "unknown-post" });
  });

  it("a simulation store refuses a batch that claims to be real", async () => {
    const root = await publishedStore();
    await expect(importProviderObservations({ storeRoot: root, batch: batch({ source: { adapter: "metricool-rest", simulated: false } }), now: NOW })).rejects.toMatchObject({ code: "store-mode" });
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
