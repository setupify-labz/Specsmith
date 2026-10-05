// MASTER #8: metrics sources that read a platform's OWN analytics API.
//
// WHAT THESE ARE, AND WHAT THEY ARE NOT
//
// Each factory below builds an `ObservationSource` that performs an
// AUTHENTICATED FETCH against one platform's analytics API with that account's
// own credentials, and returns what the provider said. That is the first of the
// two mechanisms `observations.ts` will accept as evidence.
//
// Building one does NOT make it trusted. A source becomes usable for production
// only by being listed in `PRODUCTION_OBSERVATION_SOURCES`, which is a reviewed
// change in `observations.ts`. These factories deliberately do not register
// themselves: a module that could enrol its own output as trusted would make the
// registry decorative.
//
// NO CREDENTIAL, NO SOURCE
//
// `...SourceFromEnv()` returns a discriminated result: a source, or a refusal
// naming the exact missing capability. It never returns a source that will
// later fail at fetch time, and it never returns a source that answers with
// zeros or placeholders. A metrics path that yields rows regardless of whether
// it was authenticated is indistinguishable from a fabricator.
//
// ABSENT IS NOT ZERO, AND PRESENT-BUT-UNREADABLE IS NOT ZERO EITHER
//
// Every mapper below emits `"unavailable"` for a field the provider did not
// return, and `"unavailable"` for a field it returned in a form that cannot be
// a measurement. Neither becomes 0. The one case that IS a real zero is a
// provider returning the number 0, which is kept as 0.

import type { VideoPlatform } from "../../types.ts";
import { metricsAccessFor, type PlatformMetricsAccess } from "./platformAccess.ts";
import {
  OBSERVATION_BATCH_KIND,
  type ObservationRequest,
  type ObservationSource,
  type ProviderObservationBatch,
} from "./observations.ts";

/** A source, or the reason one cannot be built. Never a half-working source. */
export type SourceAvailability =
  | { readonly available: true; readonly source: ObservationSource }
  | {
      readonly available: false;
      readonly platform: VideoPlatform;
      readonly reason: "no-credential" | "egress-blocked";
      readonly missingCredentials: readonly string[];
      readonly missingCapability: string;
    };

/** Minimal fetch shape, injected so tests drive the mappers without a network. */
export type HttpFetch = (url: string, init?: {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export class PlatformMetricsError extends Error {
  constructor(readonly platform: VideoPlatform, readonly detail: string) {
    super(`${platform} metrics could not be read: ${detail}`);
    this.name = "PlatformMetricsError";
  }
}

/**
 * Keep only values that can be measurements; everything else is unavailable.
 *
 * `0` passes — a provider genuinely reporting zero views is a measurement.
 * Strings, null, undefined, NaN, Infinity and negatives do not: each is either
 * a non-answer or an impossible count, and turning any of them into a number
 * would invent data.
 */
function measurementOrUnavailable(raw: unknown): number | "unavailable" {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return "unavailable";
  return raw;
}

/**
 * Build the metrics map for a batch.
 *
 * Starts every metric the platform's API serves at `"unavailable"`, then fills
 * only what the provider actually returned. Starting from unavailable rather
 * than from an empty object is deliberate: a metric the provider dropped is
 * then explicitly unavailable in the stored record, instead of simply missing
 * and left to a later reader to interpret.
 */
function metricsSkeleton(access: PlatformMetricsAccess): Record<string, number | "unavailable"> {
  const metrics: Record<string, number | "unavailable"> = {};
  for (const metric of access.metrics) {
    if (metric.servedByProvider && metric.providerField) metrics[metric.providerField] = "unavailable";
  }
  return metrics;
}

function missing(platform: VideoPlatform, env: Readonly<Record<string, string | undefined>>): SourceAvailability | null {
  const access = metricsAccessFor(platform);
  const blocked = access.hosts.filter((host) => BLOCKED_HOSTS.includes(host));
  if (blocked.length > 0) {
    return {
      available: false, platform, reason: "egress-blocked",
      missingCredentials: access.requiredCredentials.filter((name) => !env[name]?.trim()),
      missingCapability: access.missingCapability,
    };
  }
  const missingCredentials = access.requiredCredentials.filter((name) => !env[name]?.trim());
  if (missingCredentials.length > 0) {
    return { available: false, platform, reason: "no-credential", missingCredentials, missingCapability: access.missingCapability };
  }
  return null;
}

/**
 * Hosts this environment's network policy refuses CONNECT to.
 *
 * Observed, not assumed — see METRICS_ACCESS.md for the commands and the
 * proxy's own recorded denials. Listed so a factory refuses with
 * `egress-blocked` rather than `no-credential`: they are different problems and
 * only one of them is fixed by adding a secret.
 */
const BLOCKED_HOSTS: readonly string[] = Object.freeze(["open.tiktokapis.com", "graph.facebook.com", "www.youtube.com"]);

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export interface YouTubeMetricsConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** Channel that owns the video. `MINE` resolves from the credential. */
  readonly channelId?: string;
  readonly fetchImpl?: HttpFetch;
}

/**
 * Read one video's metrics from the YouTube Analytics API.
 *
 * Uses the ANALYTICS api (`youtubeAnalytics/v2/reports`), not the Data API.
 * The Data API's `statistics` part would be easier and is the wrong answer: it
 * returns public counts only, so average view duration, average percentage
 * viewed and the retention curve would all come back absent and the row would
 * look like a video nobody watched.
 *
 * The retention curve is fetched as its own report, because it needs the
 * `elapsedVideoTimeRatio` dimension, which cannot be combined with the scalar
 * metrics in one query.
 */
export function createYouTubeObservationSource(config: YouTubeMetricsConfig): ObservationSource {
  const access = metricsAccessFor("youtube-shorts");
  const doFetch = config.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<HttpFetch>);

  async function accessToken(): Promise<string> {
    const response = await doFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret,
        refresh_token: config.refreshToken, grant_type: "refresh_token",
      }).toString(),
    });
    const body = await response.text();
    if (!response.ok) throw new PlatformMetricsError("youtube-shorts", `token exchange returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    const token = (JSON.parse(body) as { access_token?: unknown }).access_token;
    if (typeof token !== "string" || !token) throw new PlatformMetricsError("youtube-shorts", "token exchange returned no access_token.");
    return token;
  }

  return {
    sourceId: "youtube-analytics-v2 (authenticated fetch, channel-owner OAuth)",
    mechanism: "authenticated-fetch",
    simulated: false,
    async fetch(request: ObservationRequest): Promise<ProviderObservationBatch> {
      const token = await accessToken();
      const headers = { Authorization: `Bearer ${token}` };
      const ids = `channel==${config.channelId?.trim() || "MINE"}`;
      // Scalar metrics the access declaration says this API serves.
      const scalarFields = access.metrics
        .filter((metric) => metric.servedByProvider && metric.providerField && metric.metricId !== "audience-retention-curve")
        .map((metric) => metric.providerField as string);
      const query = new URLSearchParams({
        ids, metrics: scalarFields.join(","), filters: `video==${request.providerPostId}`,
        startDate: "2005-02-14", endDate: new Date().toISOString().slice(0, 10),
      });
      const scalarResponse = await doFetch(`https://youtubeanalytics.googleapis.com/v2/reports?${query.toString()}`, { headers });
      const scalarBody = await scalarResponse.text();
      if (!scalarResponse.ok) {
        throw new PlatformMetricsError("youtube-shorts", `reports query returned HTTP ${scalarResponse.status}: ${scalarBody.slice(0, 300)}`);
      }
      const report = JSON.parse(scalarBody) as {
        columnHeaders?: readonly { name?: unknown }[];
        rows?: readonly (readonly unknown[])[];
      };

      const metrics = metricsSkeleton(access);
      const columns = (report.columnHeaders ?? []).map((header) => (typeof header.name === "string" ? header.name : ""));
      const row = report.rows?.[0];
      if (row) {
        for (const [index, column] of columns.entries()) {
          // Only columns this platform's declaration knows. An unexpected
          // column is kept by observations.ts as an undefined-definition field,
          // never mapped onto a metric it was not asked for.
          if (column in metrics) metrics[column] = measurementOrUnavailable(row[index]);
        }
      }
      // No row at all means the API returned nothing for this video. That is
      // not "zero views" — it is no measurement, and the skeleton already says
      // unavailable for every field.

      let retentionCurve: ProviderObservationBatch["retentionCurve"] = "unavailable";
      let retentionRaw: unknown = null;
      const curveQuery = new URLSearchParams({
        ids, dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio",
        filters: `video==${request.providerPostId}`, startDate: "2005-02-14", endDate: new Date().toISOString().slice(0, 10),
      });
      const curveResponse = await doFetch(`https://youtubeanalytics.googleapis.com/v2/reports?${curveQuery.toString()}`, { headers });
      const curveBody = await curveResponse.text();
      retentionRaw = { status: curveResponse.status, body: curveBody.slice(0, 20_000) };
      if (curveResponse.ok) {
        const curve = JSON.parse(curveBody) as { rows?: readonly (readonly unknown[])[] };
        const points = (curve.rows ?? [])
          .map((entry) => ({ ratio: entry[0], watch: entry[1] }))
          .filter((point): point is { ratio: number; watch: number } =>
            typeof point.ratio === "number" && Number.isFinite(point.ratio)
            && typeof point.watch === "number" && Number.isFinite(point.watch));
        // A partial curve is still a curve, but an empty one is not stored as a
        // flat line at zero.
        if (points.length > 0) {
          retentionCurve = {
            seconds: points.map((point) => point.ratio),
            shareWatching: points.map((point) => point.watch),
          };
        }
      }

      return {
        kind: OBSERVATION_BATCH_KIND,
        provider: "youtube",
        platform: "youtube-shorts",
        accountId: request.accountId,
        providerPostId: request.providerPostId,
        collectedAt: new Date().toISOString(),
        metrics,
        retentionCurve,
        attribution: null,
        raw: { scalar: { status: scalarResponse.status, body: scalarBody.slice(0, 20_000) }, retention: retentionRaw },
      };
    },
  };
}

export function youTubeObservationSourceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SourceAvailability {
  const unavailable = missing("youtube-shorts", env);
  if (unavailable) return unavailable;
  return {
    available: true,
    source: createYouTubeObservationSource({
      clientId: env.YOUTUBE_OAUTH_CLIENT_ID as string,
      clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET as string,
      refreshToken: env.YOUTUBE_OAUTH_REFRESH_TOKEN as string,
      channelId: env.YOUTUBE_CHANNEL_ID,
    }),
  };
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

export interface TikTokMetricsConfig {
  readonly accessToken: string;
  readonly fetchImpl?: HttpFetch;
}

/**
 * Read one video's counts from TikTok's authorized video query.
 *
 * Engagement counts only. TikTok's declaration records that this endpoint
 * serves no retention of any kind, so no retention is requested and none is
 * derived: `view_count` and a duration would give an estimate, and an estimate
 * stored beside measurements is the failure this whole layer exists to prevent.
 */
export function createTikTokObservationSource(config: TikTokMetricsConfig): ObservationSource {
  const access = metricsAccessFor("tiktok");
  const doFetch = config.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<HttpFetch>);

  return {
    sourceId: "tiktok-display-api-v2 video.query (authenticated fetch)",
    mechanism: "authenticated-fetch",
    simulated: false,
    async fetch(request: ObservationRequest): Promise<ProviderObservationBatch> {
      const fields = access.metrics
        .filter((metric) => metric.servedByProvider && metric.providerField)
        .map((metric) => metric.providerField as string);
      const url = `https://open.tiktokapis.com/v2/video/query/?fields=${encodeURIComponent(["id", ...fields].join(","))}`;
      const response = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: [request.providerPostId] } }),
      });
      const body = await response.text();
      if (!response.ok) throw new PlatformMetricsError("tiktok", `video.query returned HTTP ${response.status}: ${body.slice(0, 300)}`);
      const parsed = JSON.parse(body) as { data?: { videos?: readonly Record<string, unknown>[] } };
      const videos = parsed.data?.videos ?? [];
      const video = videos.find((entry) => entry.id === request.providerPostId);
      if (!video) {
        // The query succeeded and did not include this video. Refuse rather
        // than store a row of unavailables that reads like a collected
        // observation of a video the account may not even own.
        throw new PlatformMetricsError("tiktok", `video.query returned ${videos.length} video(s), none with id ${request.providerPostId}.`);
      }
      const metrics = metricsSkeleton(access);
      for (const field of Object.keys(metrics)) metrics[field] = measurementOrUnavailable(video[field]);

      return {
        kind: OBSERVATION_BATCH_KIND,
        provider: "tiktok",
        platform: "tiktok",
        accountId: request.accountId,
        providerPostId: request.providerPostId,
        collectedAt: new Date().toISOString(),
        metrics,
        retentionCurve: "unavailable",
        attribution: null,
        raw: { status: response.status, body: body.slice(0, 20_000) },
      };
    },
  };
}

export function tikTokObservationSourceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SourceAvailability {
  const unavailable = missing("tiktok", env);
  if (unavailable) return unavailable;
  return { available: true, source: createTikTokObservationSource({ accessToken: env.TIKTOK_ACCESS_TOKEN as string }) };
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

export interface InstagramMetricsConfig {
  readonly accessToken: string;
  readonly fetchImpl?: HttpFetch;
}

/**
 * Read one Reel's insights from the Instagram Graph API.
 *
 * Graph returns insights as a list of named entries, each with its own values
 * array, rather than one flat object — so a metric the account is not eligible
 * for is simply absent from the list, and is recorded unavailable.
 *
 * `ig_reels_avg_watch_time` is reported in MILLISECONDS. It is converted to
 * seconds here because SpecSmith's metric is defined in seconds, and a unit
 * mismatch would be a silent factor-of-1000 error in a number that looks
 * plausible. The conversion is arithmetic on a returned measurement, not a
 * derivation from unrelated fields.
 */
export function createInstagramObservationSource(config: InstagramMetricsConfig): ObservationSource {
  const access = metricsAccessFor("instagram-reels");
  const doFetch = config.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<HttpFetch>);

  return {
    sourceId: "instagram-graph-api media insights (authenticated fetch)",
    mechanism: "authenticated-fetch",
    simulated: false,
    async fetch(request: ObservationRequest): Promise<ProviderObservationBatch> {
      const fields = access.metrics
        .filter((metric) => metric.servedByProvider && metric.providerField)
        .map((metric) => metric.providerField as string);
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(request.providerPostId)}/insights`
        + `?metric=${encodeURIComponent(fields.join(","))}&access_token=${encodeURIComponent(config.accessToken)}`;
      const response = await doFetch(url, { method: "GET" });
      const body = await response.text();
      if (!response.ok) throw new PlatformMetricsError("instagram-reels", `insights returned HTTP ${response.status}: ${body.slice(0, 300)}`);
      const parsed = JSON.parse(body) as {
        data?: readonly { name?: unknown; values?: readonly { value?: unknown }[] }[];
      };
      const metrics = metricsSkeleton(access);
      for (const entry of parsed.data ?? []) {
        if (typeof entry.name !== "string" || !(entry.name in metrics)) continue;
        let value = measurementOrUnavailable(entry.values?.[0]?.value);
        if (entry.name === "ig_reels_avg_watch_time" && typeof value === "number") value = value / 1000;
        metrics[entry.name] = value;
      }

      return {
        kind: OBSERVATION_BATCH_KIND,
        provider: "instagram",
        platform: "instagram-reels",
        accountId: request.accountId,
        providerPostId: request.providerPostId,
        collectedAt: new Date().toISOString(),
        metrics,
        retentionCurve: "unavailable",
        attribution: null,
        // The access token is in the request URL for Graph, so the raw record
        // keeps the response only. A stored credential would be a leak into the
        // audit trail, which is read far more widely than it is written.
        raw: { status: response.status, body: body.slice(0, 20_000) },
      };
    },
  };
}

export function instagramObservationSourceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SourceAvailability {
  const unavailable = missing("instagram-reels", env);
  if (unavailable) return unavailable;
  return { available: true, source: createInstagramObservationSource({ accessToken: env.INSTAGRAM_ACCESS_TOKEN as string }) };
}

// ---------------------------------------------------------------------------

/** Every platform's source availability, for the capability report. */
export function allSourceAvailability(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly { platform: VideoPlatform; availability: SourceAvailability }[] {
  return [
    { platform: "youtube-shorts" as const, availability: youTubeObservationSourceFromEnv(env) },
    { platform: "tiktok" as const, availability: tikTokObservationSourceFromEnv(env) },
    { platform: "instagram-reels" as const, availability: instagramObservationSourceFromEnv(env) },
  ];
}
