// MASTER #8: what each platform's metrics API requires, and what SpecSmith has.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE ADAPTERS
//
// "We cannot read metrics" is useless on its own. The useful statement names
// which host, which endpoint, which credential and which scope is missing, per
// platform and per metric, so the gap can be closed deliberately instead of
// guessed at. That is all this module does: it declares requirements and
// reports observed facts. It fetches no metrics and holds no numbers.
//
// THE DISTINCTION THIS MODULE KEEPS, WHICH IS EASY TO LOSE
//
// There are two different claims about a metric, and conflating them is how a
// documented field turns into a fabricated number:
//
//   1. DOCUMENTED — the platform's API documents a field for this metric.
//      That is a statement about the API, taken from its published reference.
//      SpecSmith has NOT seen it return for our account.
//   2. OBSERVED — SpecSmith called the endpoint with the account's own
//      credentials and the provider returned this field.
//
// Only (2) is evidence. Every `providerCapability` below is (1), and is
// labelled as such in `capabilityBasis`. Nothing in this file may be read as
// SpecSmith having measured anything. `observationState` is the only field that
// reports what we actually know, and today it is `no-credential` or
// `egress-blocked` for every platform.
//
// Sources for the DOCUMENTED column are named per platform in `reference`, so a
// reviewer can check the claim rather than trust this comment.

import type { VideoPlatform } from "../../types.ts";

/** Why a metric cannot be read today, as a fact about access rather than performance. */
export type AccessState =
  /** No credential is configured for this platform's metrics API. */
  | "no-credential"
  /** The network policy refuses CONNECT to the API host; a credential would not help. */
  | "egress-blocked"
  /** Credential present and host reachable, but the account lacks the required scope. */
  | "insufficient-scope"
  /** Everything required is present. */
  | "available";

/** How we know a platform's API exposes a metric. */
export type CapabilityBasis =
  /** Taken from the platform's published API reference. NOT measured by SpecSmith. */
  | "documented-by-provider"
  /** SpecSmith called the endpoint and the provider returned this field. */
  | "observed-by-specsmith";

/**
 * One metric SpecSmith wants, and what the platform's API requires to serve it.
 *
 * `providerField` is the field name on the platform's OWN response, not
 * SpecSmith's internal name. They differ on every platform, which is the whole
 * reason per-platform adapters exist.
 */
export interface MetricAccessRequirement {
  /** SpecSmith's internal metric id, as registered in v2/experiment/metrics.ts. */
  readonly metricId: string;
  /** The platform's own field or metric name. Null when the platform has no such field. */
  readonly providerField: string | null;
  /** The specific API and endpoint that serves it. */
  readonly endpoint: string;
  /** OAuth scopes required, or [] when a simple API key suffices. */
  readonly scopes: readonly string[];
  /** Whether the platform's API documents this at all. */
  readonly servedByProvider: boolean;
  readonly capabilityBasis: CapabilityBasis;
  /** When `servedByProvider` is false, why the platform cannot provide it. */
  readonly absenceReason?: string;
}

export interface PlatformMetricsAccess {
  readonly platform: VideoPlatform;
  /** The metrics provider for this platform, distinct from the PUBLISHING provider. */
  readonly metricsProvider: "youtube" | "tiktok" | "instagram";
  /** Hosts that must be reachable. */
  readonly hosts: readonly string[];
  /** Environment variables that must carry credentials. */
  readonly requiredCredentials: readonly string[];
  /** Published API reference backing the DOCUMENTED claims below. */
  readonly reference: readonly string[];
  readonly metrics: readonly MetricAccessRequirement[];
  /** The exact capability that must be built or granted, in one sentence a reviewer can act on. */
  readonly missingCapability: string;
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
//
// TWO DIFFERENT APIS, AND THE DIFFERENCE IS THE WHOLE POINT.
//
// Data API v3 (`youtube/v3/videos?part=statistics`) returns PUBLIC counts for
// any video, with only an API key: viewCount, likeCount, commentCount. It does
// NOT return retention, and it does not return viewed-versus-swiped.
//
// Analytics API v2 (`youtubeAnalytics/v2/reports`) returns the owner-only
// measurements — average view duration, average percentage viewed, and the
// audience-retention curve via `elapsedVideoTimeRatio` + `audienceWatchRatio`.
// It requires OAuth 2.0 as the CHANNEL OWNER. An API key cannot reach it.
//
// So "get YouTube metrics" has two separate credential answers depending on
// which metric, and a single API key would quietly yield a row with views and
// nothing else. That is exactly the shape that tempts someone to fill the rest
// with zeros.

const YOUTUBE: PlatformMetricsAccess = {
  platform: "youtube-shorts",
  metricsProvider: "youtube",
  hosts: ["www.googleapis.com", "youtubeanalytics.googleapis.com"],
  requiredCredentials: ["YOUTUBE_OAUTH_REFRESH_TOKEN", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"],
  reference: [
    "https://developers.google.com/youtube/v3/docs/videos (statistics part)",
    "https://developers.google.com/youtube/analytics/reference/reports/query",
    "https://developers.google.com/youtube/analytics/dimensions#Audience_Retention_Dimensions",
  ],
  metrics: [
    {
      metricId: "views",
      providerField: "views",
      endpoint: "youtubeAnalytics/v2/reports?metrics=views&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "average-view-duration-seconds",
      providerField: "averageViewDuration",
      endpoint: "youtubeAnalytics/v2/reports?metrics=averageViewDuration&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "average-percentage-viewed",
      providerField: "averageViewPercentage",
      endpoint: "youtubeAnalytics/v2/reports?metrics=averageViewPercentage&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      // The retention CURVE, not a single number. Stored as a curve or not at all.
      metricId: "audience-retention-curve",
      providerField: "audienceWatchRatio",
      endpoint: "youtubeAnalytics/v2/reports?dimensions=elapsedVideoTimeRatio&metrics=audienceWatchRatio,relativeRetentionPerformance&filters=video=={videoId},audienceType==ORGANIC",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      // "Viewed vs swiped away" is what Studio CALLS it. There is no field of
      // that name. It is derived from the Shorts-feed dimensions, and whether
      // the API exposes them to a given channel is not something this
      // repository has verified for our account — so it is NOT asserted as
      // documented-and-available here, and the adapter must not invent it.
      metricId: "stayed-to-watch-rate",
      providerField: null,
      endpoint: "youtubeAnalytics/v2/reports (Shorts feed dimensions; exact availability unverified for this channel)",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason:
        "YouTube Studio displays 'Viewed vs. Swiped away' for Shorts, but SpecSmith has not confirmed a reporting API " +
        "field that returns it for this channel. Until an authenticated call is seen to return it, it stays unavailable " +
        "rather than being derived from views, impressions or any other number that happens to be present.",
    },
    {
      metricId: "likes",
      providerField: "likes",
      endpoint: "youtubeAnalytics/v2/reports?metrics=likes&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "comments",
      providerField: "comments",
      endpoint: "youtubeAnalytics/v2/reports?metrics=comments&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "shares",
      providerField: "shares",
      endpoint: "youtubeAnalytics/v2/reports?metrics=shares&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "follows-gained",
      providerField: "subscribersGained",
      endpoint: "youtubeAnalytics/v2/reports?metrics=subscribersGained&filters=video=={videoId}",
      scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "saves",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason:
        "YouTube has no 'save' action equivalent to a TikTok favourite or an Instagram save. The nearest measurement is " +
        "videosAddedToPlaylists, which is a different viewer action and is NOT mapped onto saves.",
    },
    {
      metricId: "profile-visits",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason: "YouTube reporting does not attribute channel-page visits to an individual video.",
    },
  ],
  missingCapability:
    "YouTube metrics require an OAuth 2.0 credential for the channel that owns the video, with scope " +
    "https://www.googleapis.com/auth/yt-analytics.readonly, supplied as YOUTUBE_OAUTH_REFRESH_TOKEN plus " +
    "YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET. None is configured. An API key is NOT sufficient: it reaches " +
    "youtube/v3/videos for public counts only, and cannot reach youtubeAnalytics/v2/reports, where average view duration, " +
    "average percentage viewed and the audience-retention curve live.",
};

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------
//
// The Display API's authorized video query returns engagement counts and no
// retention. The Research API exposes more, but it has separate eligibility and
// is not something a production creator account simply has — ANALYTICS.md is
// explicit that it must not be assumed. So retention is absent here, and the
// absence is recorded as absence.

const TIKTOK: PlatformMetricsAccess = {
  platform: "tiktok",
  metricsProvider: "tiktok",
  hosts: ["open.tiktokapis.com"],
  requiredCredentials: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  reference: [
    "https://developers.tiktok.com/doc/display-api-video-query",
    "https://developers.tiktok.com/doc/research-api-specs-query-videos",
  ],
  metrics: [
    {
      metricId: "views",
      providerField: "view_count",
      endpoint: "POST open.tiktokapis.com/v2/video/query/?fields=view_count",
      scopes: ["video.list"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "likes",
      providerField: "like_count",
      endpoint: "POST open.tiktokapis.com/v2/video/query/?fields=like_count",
      scopes: ["video.list"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "comments",
      providerField: "comment_count",
      endpoint: "POST open.tiktokapis.com/v2/video/query/?fields=comment_count",
      scopes: ["video.list"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "shares",
      providerField: "share_count",
      endpoint: "POST open.tiktokapis.com/v2/video/query/?fields=share_count",
      scopes: ["video.list"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "average-percentage-viewed",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason:
        "The Display API video query returns no watch-time or retention field. It must not be derived from view_count " +
        "and duration, which would be an estimate presented as a measurement.",
    },
    {
      metricId: "stayed-to-watch-rate",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason: "TikTok exposes no early-retention or swipe-away rate through the authorized video query.",
    },
    {
      metricId: "audience-retention-curve",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason: "No per-second retention curve is exposed to a standard creator account.",
    },
  ],
  missingCapability:
    "TikTok metrics are unreachable for two independent reasons. First, this environment's network policy refuses CONNECT " +
    "to open.tiktokapis.com, so no credential would help until the host is allowed. Second, no TIKTOK_ACCESS_TOKEN with the " +
    "video.list scope is configured. Separately, TikTok's authorized video query exposes no retention of any kind, so " +
    "retention will remain unavailable for TikTok even once access works.",
};

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

const INSTAGRAM: PlatformMetricsAccess = {
  platform: "instagram-reels",
  metricsProvider: "instagram",
  hosts: ["graph.facebook.com"],
  requiredCredentials: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
  reference: [
    "https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-media/insights",
  ],
  metrics: [
    {
      metricId: "views",
      providerField: "views",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=views",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "likes",
      providerField: "likes",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=likes",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "comments",
      providerField: "comments",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=comments",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "shares",
      providerField: "shares",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=shares",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "saves",
      providerField: "saved",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=saved",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      metricId: "average-view-duration-seconds",
      providerField: "ig_reels_avg_watch_time",
      endpoint: "GET graph.facebook.com/{mediaId}/insights?metric=ig_reels_avg_watch_time",
      scopes: ["instagram_basic", "instagram_manage_insights"],
      servedByProvider: true,
      capabilityBasis: "documented-by-provider",
    },
    {
      // Instagram reports average watch time in MILLISECONDS. The adapter must
      // convert, and the conversion is a derivation, not an observation.
      metricId: "average-percentage-viewed",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason:
        "Instagram reports average watch time, not average percentage viewed. Dividing it by the media duration would be a " +
        "derived ratio, and is stored as derived if ever computed — never as an observed provider metric.",
    },
    {
      metricId: "stayed-to-watch-rate",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason: "Instagram media insights expose no early-retention or swipe-away rate.",
    },
    {
      metricId: "audience-retention-curve",
      providerField: null,
      endpoint: "n/a",
      scopes: [],
      servedByProvider: false,
      capabilityBasis: "documented-by-provider",
      absenceReason: "No per-second retention curve is exposed for Reels.",
    },
  ],
  missingCapability:
    "Instagram metrics are unreachable for two independent reasons. First, this environment's network policy refuses CONNECT " +
    "to graph.facebook.com. Second, no INSTAGRAM_ACCESS_TOKEN for a business/creator account with instagram_manage_insights, " +
    "and no INSTAGRAM_BUSINESS_ACCOUNT_ID, is configured. Reels insights also expose no retention curve or swipe-away rate, " +
    "so those stay unavailable for Instagram even once access works.",
};

const ACCESS: ReadonlyMap<VideoPlatform, PlatformMetricsAccess> = new Map([
  [YOUTUBE.platform, YOUTUBE],
  [TIKTOK.platform, TIKTOK],
  [INSTAGRAM.platform, INSTAGRAM],
]);

export function metricsAccessFor(platform: VideoPlatform): PlatformMetricsAccess {
  const access = ACCESS.get(platform);
  if (!access) throw new Error(`No metrics-access declaration for platform ${platform}.`);
  return access;
}

export function allMetricsAccess(): readonly PlatformMetricsAccess[] {
  return [...ACCESS.values()];
}

/**
 * The provider field for one metric on one platform, or null.
 *
 * Null means this platform does not serve the metric. An adapter that gets null
 * must record the metric as unavailable; it must not substitute another field.
 */
export function providerFieldFor(platform: VideoPlatform, metricId: string): string | null {
  return metricsAccessFor(platform).metrics.find((metric) => metric.metricId === metricId)?.providerField ?? null;
}

/** Metrics this platform's API serves at all, as documented by the provider. */
export function servedMetricIds(platform: VideoPlatform): readonly string[] {
  return metricsAccessFor(platform).metrics.filter((metric) => metric.servedByProvider).map((metric) => metric.metricId);
}

/** Metrics SpecSmith wants that this platform cannot give, with the reason. */
export function unservedMetrics(platform: VideoPlatform): readonly { metricId: string; reason: string }[] {
  return metricsAccessFor(platform).metrics
    .filter((metric) => !metric.servedByProvider)
    .map((metric) => ({ metricId: metric.metricId, reason: metric.absenceReason ?? "No reason recorded." }));
}

// ---------------------------------------------------------------------------
// What SpecSmith actually has, today
// ---------------------------------------------------------------------------

/** One platform's readiness. Facts only; no metric values anywhere near this. */
export interface PlatformAccessStatus {
  readonly platform: VideoPlatform;
  readonly metricsProvider: PlatformMetricsAccess["metricsProvider"];
  readonly state: AccessState;
  /** Credentials this platform needs that are absent from the environment. */
  readonly missingCredentials: readonly string[];
  /** Hosts observed to refuse CONNECT, when a probe recorded that. */
  readonly blockedHosts: readonly string[];
  readonly missingCapability: string;
  /** True only when a real observation source is registered for production. */
  readonly canIngestToday: false;
}

/**
 * Hosts a probe observed the network policy refusing.
 *
 * These are RECORDED OBSERVATIONS from this environment, not assumptions: the
 * agent proxy answered 403 to CONNECT for each, and the facts are reproduced in
 * METRICS_ACCESS.md with the command that produced them. They are listed here
 * so `platformAccessStatus` can distinguish "no credential" from "a credential
 * would not help", which are different problems with different fixes.
 */
export const OBSERVED_BLOCKED_HOSTS: readonly string[] = Object.freeze([
  "open.tiktokapis.com",
  "graph.facebook.com",
  "www.youtube.com",
]);

/**
 * Report one platform's readiness from the environment, without calling out.
 *
 * `env` is injected so tests can describe a fully-credentialled environment and
 * assert that the answer is STILL `canIngestToday: false` — because a credential
 * alone does not make a trusted source. Registration in
 * PRODUCTION_OBSERVATION_SOURCES is a separate, reviewed step.
 */
export function platformAccessStatus(
  platform: VideoPlatform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlatformAccessStatus {
  const access = metricsAccessFor(platform);
  const missingCredentials = access.requiredCredentials.filter((name) => !env[name]?.trim());
  const blockedHosts = access.hosts.filter((host) => OBSERVED_BLOCKED_HOSTS.includes(host));
  const state: AccessState = blockedHosts.length > 0
    ? "egress-blocked"
    : missingCredentials.length > 0
      ? "no-credential"
      : "insufficient-scope";
  return {
    platform,
    metricsProvider: access.metricsProvider,
    state,
    missingCredentials,
    blockedHosts,
    missingCapability: access.missingCapability,
    canIngestToday: false,
  };
}

export function allPlatformAccessStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly PlatformAccessStatus[] {
  return allMetricsAccess().map((access) => platformAccessStatus(access.platform, env));
}
