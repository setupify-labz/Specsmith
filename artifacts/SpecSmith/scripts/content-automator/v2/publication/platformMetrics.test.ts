// Native platform metrics: what each platform can serve, what it cannot, and
// that nothing absent, unreadable or hand-written becomes a number.
//
// The existing observations.test.ts already covers fabrication on the Metricool
// aggregator path. These tests cover the surface added for reading YouTube,
// TikTok and Instagram directly: the access declarations, the three adapters'
// field mapping, and the refusals that happen when access does not exist.
//
// Every adapter here is driven through an injected fetch. Nothing in this file
// touches the network, and nothing in it is a trusted source.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStoredPublicationLedger, initPublicationStore } from "../../publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "../../types.ts";
import { lookupMetric, metricsForPlatform } from "../experiment/metrics.ts";
import { seedSimulatedLedger } from "./boundary.ts";
import {
  allMetricsAccess,
  metricsAccessFor,
  OBSERVED_BLOCKED_HOSTS,
  platformAccessStatus,
  providerFieldFor,
  servedMetricIds,
  unservedMetrics,
} from "./platformAccess.ts";
import {
  createInstagramObservationSource,
  createTikTokObservationSource,
  createYouTubeObservationSource,
  type HttpFetch,
  instagramObservationSourceFromEnv,
  tikTokObservationSourceFromEnv,
  youTubeObservationSourceFromEnv,
} from "./platformObservationSources.ts";
import {
  importProviderObservations,
  NATIVE_PLATFORM_PROVIDERS,
  OBSERVATION_BATCH_KIND,
  PRODUCTION_OBSERVATION_SOURCES,
  type ProviderObservationBatch,
} from "./observations.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PUBLISHED_AT = "2026-09-01T12:00:00.000Z";
const NOW = new Date("2026-09-10T00:00:00.000Z");

/** A fetch that answers a fixed body per URL substring, and records what was asked. */
function stubFetch(routes: readonly { match: string; status?: number; body: unknown }[]): HttpFetch & { urls: string[] } {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    const route = routes.find((candidate) => url.includes(candidate.match));
    if (!route) return { ok: false, status: 404, async text() { return JSON.stringify({ error: `no stub for ${url}` }); } };
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, async text() { return typeof route.body === "string" ? route.body : JSON.stringify(route.body); } };
  }) as HttpFetch & { urls: string[] };
  impl.urls = urls;
  return impl;
}

const YOUTUBE_TOKEN_ROUTE = { match: "oauth2.googleapis.com/token", body: { access_token: "stub-token" } };

const REQUEST = { provider: "youtube" as const, platform: "youtube-shorts" as const, accountId: "acct-1", providerPostId: "cSDhjFC-CI8" };

function valueOf(batch: ProviderObservationBatch, field: string): number | "unavailable" | null | undefined {
  return batch.metrics[field];
}

// ---------------------------------------------------------------------------

describe("each platform's access declaration says what that platform can and cannot serve", () => {
  it("covers all three platforms, each with its own provider, hosts and credentials", () => {
    const platforms = allMetricsAccess().map((access) => access.platform).sort();
    expect(platforms).toEqual(["instagram-reels", "tiktok", "youtube-shorts"]);
    for (const access of allMetricsAccess()) {
      expect(access.hosts.length, access.platform).toBeGreaterThan(0);
      expect(access.requiredCredentials.length, access.platform).toBeGreaterThan(0);
      expect(access.reference.length, access.platform).toBeGreaterThan(0);
      // The gap must be stated in terms a reviewer can act on, not "unavailable".
      expect(access.missingCapability.length, access.platform).toBeGreaterThan(80);
    }
  });

  it("only YouTube serves retention, and the other two record WHY they cannot", () => {
    // The point of the whole layer: TikTok and Instagram expose no retention,
    // and that absence must be a stated reason rather than a gap someone later
    // fills with an estimate from view count and duration.
    expect(servedMetricIds("youtube-shorts")).toContain("audience-retention-curve");
    for (const platform of ["tiktok", "instagram-reels"] as const) {
      expect(servedMetricIds(platform)).not.toContain("audience-retention-curve");
      const absent = unservedMetrics(platform).find((metric) => metric.metricId === "audience-retention-curve");
      expect(absent, platform).toBeDefined();
      expect(absent!.reason.length, platform).toBeGreaterThan(30);
    }
  });

  it("no platform claims viewed-versus-swiped, because none was confirmed to return it", () => {
    // YouTube Studio displays "Viewed vs. Swiped away", which makes it tempting
    // to assert the API serves it. No call has been seen to return it for this
    // channel, so it is unavailable everywhere, with the reason recorded.
    for (const access of allMetricsAccess()) {
      const swipe = access.metrics.find((metric) => metric.metricId === "stayed-to-watch-rate");
      expect(swipe, access.platform).toBeDefined();
      expect(swipe!.servedByProvider, access.platform).toBe(false);
      expect(swipe!.providerField, access.platform).toBeNull();
      expect(swipe!.absenceReason, access.platform).toBeTruthy();
    }
  });

  it("every documented capability is labelled as documented, never as something SpecSmith measured", () => {
    // The distinction that keeps a published API reference from becoming
    // evidence about our own account.
    for (const access of allMetricsAccess()) {
      for (const metric of access.metrics) {
        expect(metric.capabilityBasis, `${access.platform}:${metric.metricId}`).toBe("documented-by-provider");
      }
    }
  });

  it("a metric a platform does not serve has no provider field to read", () => {
    // providerFieldFor returning null is what makes the adapters record
    // unavailable instead of substituting a different field.
    expect(providerFieldFor("tiktok", "views")).toBe("view_count");
    expect(providerFieldFor("tiktok", "audience-retention-curve")).toBeNull();
    expect(providerFieldFor("youtube-shorts", "saves")).toBeNull();
    expect(providerFieldFor("instagram-reels", "average-view-duration-seconds")).toBe("ig_reels_avg_watch_time");
  });
});

describe("the metric registry is platform-local, and its field names are provider-local", () => {
  it("registers a platform's unserved metrics as unserved, with the reason, rather than dropping them", () => {
    // Keeping them registered is what makes the absence reportable. Dropping
    // them would make "TikTok has no retention" indistinguishable from "nobody
    // asked about TikTok retention".
    const tiktokRetention = lookupMetric("tiktok", "audience-retention-curve");
    expect(tiktokRetention).not.toBeNull();
    expect(tiktokRetention!.servedByPlatformApi).toBe(false);
    expect(tiktokRetention!.nativeField).toBeNull();
    expect(tiktokRetention!.platformAbsenceReason).toBeTruthy();
  });

  it("keeps the aggregator contract name AND the platform-native name, which are different", () => {
    // THE REGRESSION THIS GUARDS. An earlier version of this change replaced
    // providerField with the native name. Metricool sends `views`; TikTok sends
    // `view_count`. With one field for both, the import loop looked up
    // `view_count` in a Metricool batch keyed `views`, read undefined, and
    // recorded a metric the provider HAD returned as unavailable — reading a
    // present number as absent, which is the mirror of turning an absent one
    // into zero.
    const tiktokViews = lookupMetric("tiktok", "views")!;
    expect(tiktokViews.providerField).toBe("views");       // aggregator contract
    expect(tiktokViews.nativeField).toBe("view_count");     // TikTok's own field
    expect(tiktokViews.providerField).not.toBe(tiktokViews.nativeField);
  });

  it("does not give every platform the same metric list", () => {
    // What leaked before: one list returned three times, so TikTok was
    // registered as serving stayed-to-watch-rate and YouTube as serving saves.
    const servedBy = (platform: VideoPlatform) => metricsForPlatform(platform)
      .filter((definition) => definition.servedByPlatformApi).map((definition) => definition.metricId).sort();
    expect(servedBy("youtube-shorts")).not.toEqual(servedBy("tiktok"));
    expect(servedBy("tiktok")).not.toEqual(servedBy("instagram-reels"));
    expect(servedBy("youtube-shorts")).not.toContain("saves");
    expect(servedBy("tiktok")).not.toContain("stayed-to-watch-rate");
    expect(servedBy("instagram-reels")).toContain("saves");
  });

  it("marks every metric unavailable today, whatever the platform documents", () => {
    for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as const) {
      for (const definition of metricsForPlatform(platform)) {
        expect(definition.availableToday, `${platform}:${definition.metricId}`).toBe(false);
      }
    }
  });
});

describe("no credential, no source — and a credential alone is still not trust", () => {
  const FULL_ENV = Object.freeze({
    YOUTUBE_OAUTH_CLIENT_ID: "id", YOUTUBE_OAUTH_CLIENT_SECRET: "secret", YOUTUBE_OAUTH_REFRESH_TOKEN: "refresh",
    TIKTOK_ACCESS_TOKEN: "token", TIKTOK_CLIENT_KEY: "key", TIKTOK_CLIENT_SECRET: "secret",
    INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_BUSINESS_ACCOUNT_ID: "ig-1",
  });

  it("refuses with the exact missing credentials when the environment is empty", () => {
    const youtube = youTubeObservationSourceFromEnv({});
    expect(youtube.available).toBe(false);
    if (youtube.available) throw new Error("unreachable");
    expect(youtube.reason).toBe("no-credential");
    expect(youtube.missingCredentials).toEqual([
      "YOUTUBE_OAUTH_REFRESH_TOKEN", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET",
    ]);
    // The refusal has to name the capability, not just fail.
    expect(youtube.missingCapability).toMatch(/yt-analytics\.readonly/);
    expect(youtube.missingCapability).toMatch(/API key is NOT sufficient/i);
  });

  it("distinguishes a blocked host from a missing credential, because only one is fixed by a secret", () => {
    // TikTok and Instagram hosts are refused by this environment's network
    // policy. Reporting that as "no credential" would send someone to
    // provision a token that cannot be used.
    for (const availability of [tikTokObservationSourceFromEnv(FULL_ENV), instagramObservationSourceFromEnv(FULL_ENV)]) {
      expect(availability.available).toBe(false);
      if (availability.available) throw new Error("unreachable");
      expect(availability.reason).toBe("egress-blocked");
      expect(availability.missingCredentials).toEqual([]);  // they ARE present
    }
    expect(OBSERVED_BLOCKED_HOSTS).toContain("open.tiktokapis.com");
    expect(OBSERVED_BLOCKED_HOSTS).toContain("graph.facebook.com");
  });

  it("a fully credentialled environment still cannot ingest, because registration is a separate reviewed step", () => {
    // The trap this guards: "we have the token, so metrics work now". A source
    // becomes trusted by being listed in PRODUCTION_OBSERVATION_SOURCES, which
    // is a code change under review, not by existing.
    for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as const) {
      expect(platformAccessStatus(platform, FULL_ENV).canIngestToday).toBe(false);
    }
    expect(PRODUCTION_OBSERVATION_SOURCES).toHaveLength(0);
  });

  it("none of the native adapters is registered as a production source", () => {
    const youtube = createYouTubeObservationSource({ clientId: "a", clientSecret: "b", refreshToken: "c", fetchImpl: stubFetch([]) });
    const tiktok = createTikTokObservationSource({ accessToken: "t", fetchImpl: stubFetch([]) });
    const instagram = createInstagramObservationSource({ accessToken: "t", fetchImpl: stubFetch([]) });
    for (const source of [youtube, tiktok, instagram]) {
      expect(PRODUCTION_OBSERVATION_SOURCES.includes(source)).toBe(false);
      // They describe themselves as authenticated fetches, which is what they
      // are. Saying so is not what makes them trusted.
      expect(source.mechanism).toBe("authenticated-fetch");
      expect(source.simulated).toBe(false);
    }
  });
});

describe("the YouTube adapter maps only what the Analytics API returned", () => {
  function youtube(routes: readonly { match: string; status?: number; body: unknown }[]) {
    const impl = stubFetch([YOUTUBE_TOKEN_ROUTE, ...routes]);
    return { source: createYouTubeObservationSource({ clientId: "a", clientSecret: "b", refreshToken: "c", fetchImpl: impl }), impl };
  }

  it("reads the Analytics API, not the Data API, because retention only exists on one of them", async () => {
    const { source, impl } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [[0, 1], [0.5, 0.6]] } },
      { match: "youtubeanalytics.googleapis.com/v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[4800]] } },
    ]);
    await source.fetch(REQUEST);
    expect(impl.urls.some((url) => url.includes("youtubeanalytics.googleapis.com"))).toBe(true);
    // The Data API would be easier and would silently lose retention.
    expect(impl.urls.some((url) => url.includes("youtube/v3/videos"))).toBe(false);
  });

  it("keeps a returned zero as zero, and leaves an unreturned metric unavailable", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }, { name: "shares" }], rows: [[0, 7]] } },
    ]);
    const batch = await source.fetch(REQUEST);
    // A provider genuinely reporting zero shares IS a measurement.
    expect(valueOf(batch, "views")).toBe(0);
    expect(valueOf(batch, "shares")).toBe(7);
    // Never returned, so never zero.
    expect(valueOf(batch, "likes")).toBe("unavailable");
    expect(valueOf(batch, "comments")).toBe("unavailable");
    expect(valueOf(batch, "averageViewDuration")).toBe("unavailable");
  });

  it("treats an empty retention report as unavailable, not as a flat line at zero", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[10]] } },
    ]);
    expect((await source.fetch(REQUEST)).retentionCurve).toBe("unavailable");
  });

  it("stores a real retention curve when one comes back", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [[0, 1], [0.25, 0.8], [0.5, 0.55]] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[10]] } },
    ]);
    const curve = (await source.fetch(REQUEST)).retentionCurve;
    expect(curve).not.toBe("unavailable");
    expect(curve).toMatchObject({ seconds: [0, 0.25, 0.5], shareWatching: [1, 0.8, 0.55] });
  });

  it("drops curve points that are not numbers rather than coercing them", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [[0, 1], ["bad", 0.5], [0.5, null], [0.75, 0.3]] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[10]] } },
    ]);
    expect((await source.fetch(REQUEST)).retentionCurve).toMatchObject({ seconds: [0, 0.75], shareWatching: [1, 0.3] });
  });

  it("records every metric unavailable when the report has no rows at all", async () => {
    // No row is "no measurement", not "a video nobody watched".
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }] } },
    ]);
    const batch = await source.fetch(REQUEST);
    expect(Object.values(batch.metrics).every((value) => value === "unavailable")).toBe(true);
    expect(Object.values(batch.metrics).length).toBeGreaterThan(3);
  });

  it("refuses values that cannot be measurements instead of storing them", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [] } },
      { match: "v2/reports", body: {
        columnHeaders: [{ name: "views" }, { name: "likes" }, { name: "shares" }, { name: "comments" }],
        rows: [["4800", -3, null, 12]],
      } },
    ]);
    const batch = await source.fetch(REQUEST);
    expect(valueOf(batch, "views")).toBe("unavailable");    // a numeric STRING is not a number
    expect(valueOf(batch, "likes")).toBe("unavailable");    // a negative count is impossible
    expect(valueOf(batch, "shares")).toBe("unavailable");   // null is not zero
    expect(valueOf(batch, "comments")).toBe(12);
  });

  it("fails loudly when the token exchange or the report fails", async () => {
    const broken = createYouTubeObservationSource({ clientId: "a", clientSecret: "b", refreshToken: "c",
      fetchImpl: stubFetch([{ match: "oauth2.googleapis.com/token", status: 400, body: { error: "invalid_grant" } }]) });
    await expect(broken.fetch(REQUEST)).rejects.toThrow(/token exchange returned HTTP 400/);

    const { source } = youtube([{ match: "v2/reports", status: 403, body: { error: "forbidden" } }]);
    await expect(source.fetch(REQUEST)).rejects.toThrow(/reports query returned HTTP 403/);
  });

  it("never writes a credential into the audit record", async () => {
    const { source } = youtube([
      { match: "elapsedVideoTimeRatio", body: { rows: [] } },
      { match: "v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[1]] } },
    ]);
    const batch = await source.fetch(REQUEST);
    const serialized = JSON.stringify(batch);
    for (const secret of ["stub-token", "refresh", "secret"]) expect(serialized).not.toContain(secret);
  });
});

describe("the TikTok adapter takes counts and refuses to invent retention", () => {
  function tiktok(body: unknown, status = 200) {
    return createTikTokObservationSource({ accessToken: "t", fetchImpl: stubFetch([{ match: "open.tiktokapis.com", status, body }]) });
  }
  const ASK = { provider: "tiktok" as const, platform: "tiktok" as const, accountId: "acct-1", providerPostId: "7300000000000000001" };

  it("maps TikTok's own field names and asks for no retention field", async () => {
    const source = tiktok({ data: { videos: [{ id: ASK.providerPostId, view_count: 98000, like_count: 4100, comment_count: 56, share_count: 220 }] } });
    const batch = await source.fetch(ASK);
    expect(batch.metrics).toEqual({ view_count: 98000, like_count: 4100, comment_count: 56, share_count: 220 });
    // Not derived from view_count and duration, which would be an estimate.
    expect(batch.retentionCurve).toBe("unavailable");
  });

  it("refuses when a successful query does not contain the video asked about", async () => {
    // Storing a row of unavailables here would read like a collected
    // observation of a video this account may not even own.
    const source = tiktok({ data: { videos: [{ id: "7399999999999999999", view_count: 10 }] } });
    await expect(source.fetch(ASK)).rejects.toThrow(/none with id 7300000000000000001/);
  });

  it("leaves a field the query omitted unavailable", async () => {
    const source = tiktok({ data: { videos: [{ id: ASK.providerPostId, view_count: 98000 }] } });
    const batch = await source.fetch(ASK);
    expect(valueOf(batch, "view_count")).toBe(98000);
    expect(valueOf(batch, "like_count")).toBe("unavailable");
    expect(valueOf(batch, "share_count")).toBe("unavailable");
  });

  it("fails loudly on an HTTP error", async () => {
    await expect(tiktok({ error: { code: "scope_not_authorized" } }, 401).fetch(ASK)).rejects.toThrow(/HTTP 401/);
  });
});

describe("the Instagram adapter reads the insights list and fixes the unit", () => {
  function instagram(body: unknown, status = 200) {
    return createInstagramObservationSource({ accessToken: "t", fetchImpl: stubFetch([{ match: "graph.facebook.com", status, body }]) });
  }
  const ASK = { provider: "instagram" as const, platform: "instagram-reels" as const, accountId: "acct-1", providerPostId: "178000000000001" };

  it("converts average watch time from milliseconds to seconds", async () => {
    // Graph reports milliseconds; the SpecSmith metric is seconds. Skipping the
    // conversion is a silent factor-of-1000 error in a plausible number.
    const source = instagram({ data: [
      { name: "views", values: [{ value: 12000 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 7400 }] },
    ] });
    const batch = await source.fetch(ASK);
    expect(valueOf(batch, "views")).toBe(12000);
    expect(valueOf(batch, "ig_reels_avg_watch_time")).toBe(7.4);
  });

  it("leaves a metric absent from the insights list unavailable", async () => {
    const source = instagram({ data: [{ name: "views", values: [{ value: 12000 }] }] });
    const batch = await source.fetch(ASK);
    expect(valueOf(batch, "saved")).toBe("unavailable");
    expect(valueOf(batch, "shares")).toBe("unavailable");
    expect(valueOf(batch, "ig_reels_avg_watch_time")).toBe("unavailable");
  });

  it("ignores insight entries SpecSmith did not ask for", async () => {
    const source = instagram({ data: [
      { name: "views", values: [{ value: 5 }] },
      { name: "some_new_metric", values: [{ value: 999 }] },
    ] });
    const batch = await source.fetch(ASK);
    expect(batch.metrics).not.toHaveProperty("some_new_metric");
    expect(valueOf(batch, "views")).toBe(5);
  });

  it("does not put the access token in the stored record, even though Graph takes it in the URL", async () => {
    const source = instagram({ data: [{ name: "views", values: [{ value: 5 }] }] });
    expect(JSON.stringify(await source.fetch(ASK))).not.toContain("t&");
    expect(JSON.stringify((await source.fetch(ASK)).raw)).not.toMatch(/access_token/);
  });
});

describe("a hand-assembled native batch is not evidence, whatever it claims", () => {
  async function productionStore(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "platform-metrics-"));
    roots.push(root);
    await initPublicationStore(root, "production", "native metrics test");
    return root;
  }

  async function publishedSimulationStore(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "platform-metrics-sim-"));
    roots.push(root);
    await initPublicationStore(root, "simulation", "native metrics test");
    await createStoredPublicationLedger(root, { creativeId: "creative-1", packageId: "p", platform: "youtube-shorts", ideaId: "i", campaignId: "c", targetDurationSeconds: 20 } as CreativeFingerprint);
    await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-1", through: "published", providerPostId: "SIM-POST-1",
      at: new Date(PUBLISHED_AT), mediaSha256: "a".repeat(64), variantId: "youtube-shorts-1080x1920-30",
      destination: { provider: "metricool", accountId: "acct-1", platform: "youtube-shorts" }, title: "t", description: "d" });
    return root;
  }

  /** A batch a person typed, dressed as a YouTube Analytics response. */
  function typedByHand(overrides: Partial<ProviderObservationBatch> = {}): ProviderObservationBatch {
    return {
      kind: OBSERVATION_BATCH_KIND, provider: "youtube", platform: "youtube-shorts",
      accountId: "acct-1", providerPostId: "cSDhjFC-CI8", collectedAt: "2026-09-02T12:00:00.000Z",
      metrics: { views: 98000, likes: 4100, averageViewPercentage: 0.77 },
      retentionCurve: { seconds: [0, 0.5], shareWatching: [1, 0.6] },
      attribution: null,
      raw: { note: "read off the YouTube Studio dashboard" },
      ...overrides,
    };
  }

  it("refuses a typed batch in production and names the capability that would make metrics real", async () => {
    const root = await productionStore();
    await expect(importProviderObservations({ storeRoot: root, batch: typedByHand(), now: NOW }))
      .rejects.toMatchObject({ code: "no-verified-source" });
  });

  it("refuses it even when it claims a real adapter's own sourceId and mechanism", async () => {
    // Self-description is not provenance. The registry remembers which batches
    // it issued; a caller-built object is not among them however it is labelled.
    const root = await productionStore();
    await expect(importProviderObservations({
      storeRoot: root,
      batch: typedByHand({ raw: { source: "youtube-analytics-v2 (authenticated fetch, channel-owner OAuth)", mechanism: "authenticated-fetch", simulated: false } }),
      now: NOW,
    })).rejects.toMatchObject({ code: "no-verified-source" });
  });

  it("refuses it in a simulation store too, so there is nowhere a typed number lands as an observation", async () => {
    const root = await publishedSimulationStore();
    await expect(importProviderObservations({ storeRoot: root, batch: typedByHand({ providerPostId: "SIM-POST-1" }), now: NOW }))
      .rejects.toMatchObject({ code: "unverified-source" });
  });
});

describe("the native path cannot attribute a platform id to a creative yet", () => {
  it("records the schema gap: the ledger knows only the publishing provider's post id", async () => {
    // THE BLOCKER NO CREDENTIAL FIXES, asserted so it cannot be forgotten once
    // OAuth arrives and the credential gap closes.
    //
    // A creative is bound to provider + providerPostId, where the provider is
    // whoever published (Metricool). YouTube Analytics knows the video only by
    // its own id. There is no platform-native id recorded at publication, so a
    // genuine, fully-authenticated YouTube batch for cSDhjFC-CI8 still has no
    // path to a creative — and is correctly refused rather than attributed by
    // guess. Closing this needs a field on the publication event, not a secret.
    const root = await mkdtemp(join(tmpdir(), "platform-metrics-attr-"));
    roots.push(root);
    await initPublicationStore(root, "simulation", "attribution gap");
    await createStoredPublicationLedger(root, { creativeId: "creative-1", packageId: "p", platform: "youtube-shorts", ideaId: "i", campaignId: "c", targetDurationSeconds: 20 } as CreativeFingerprint);
    await seedSimulatedLedger({ storeRoot: root, creativeId: "creative-1", through: "published", providerPostId: "SIM-POST-1",
      at: new Date(PUBLISHED_AT), mediaSha256: "a".repeat(64), variantId: "youtube-shorts-1080x1920-30",
      destination: { provider: "metricool", accountId: "acct-1", platform: "youtube-shorts" }, title: "t", description: "d" });

    // The publication is recorded under the PUBLISHING provider's id...
    const source = createYouTubeObservationSource({ clientId: "a", clientSecret: "b", refreshToken: "c",
      fetchImpl: stubFetch([YOUTUBE_TOKEN_ROUTE,
        { match: "elapsedVideoTimeRatio", body: { rows: [] } },
        { match: "v2/reports", body: { columnHeaders: [{ name: "views" }], rows: [[4800]] } }]) });
    // ...so a YouTube-native batch, however genuine, is for an unknown post.
    const batch = await source.fetch(REQUEST);
    await expect(importProviderObservations({ storeRoot: root, batch, now: NOW })).rejects.toMatchObject({
      code: expect.stringMatching(/unverified-source|unknown-post/),
    });
  });

  it("names the three native providers, distinct from the publishing provider", () => {
    expect([...NATIVE_PLATFORM_PROVIDERS].sort()).toEqual(["instagram", "tiktok", "youtube"]);
    expect(NATIVE_PLATFORM_PROVIDERS).not.toContain("metricool");
    for (const platform of ["youtube-shorts", "tiktok", "instagram-reels"] as const) {
      expect(NATIVE_PLATFORM_PROVIDERS).toContain(metricsAccessFor(platform).metricsProvider);
    }
  });
});
