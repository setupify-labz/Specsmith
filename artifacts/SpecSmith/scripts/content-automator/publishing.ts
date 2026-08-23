import type { QualityReviewResult } from "./qualityReviewer.ts";
import type { PublicationAssetBundleResult } from "./productVisualAssets.ts";
import type { ContentIdea, ContentPackage, CreativeFingerprint, VideoPlatform } from "./types.ts";

export type MetricoolNetwork = "instagram" | "tiktok" | "youtube";
export type PublicationStatus =
  | "generated"
  | "qc-passed"
  | "scheduled"
  | "published"
  | "analytics-partial"
  | "analytics-complete"
  | "rejected"
  | "failed";

export interface PublishingConfig {
  blogId: string;
  timezone: string;
  siteBaseUrl: string;
  connectedNetworks: MetricoolNetwork[];
  youtubeMadeForKids?: boolean;
}

export interface PublishingGateInput {
  qualityReview: QualityReviewResult;
  assetBundle: PublicationAssetBundleResult;
  finalMediaRef: string;
  finalMediaSha256?: string;
}

export interface MetricoolPublishingRequest {
  requestId: string;
  creativeId: string;
  packageId: string;
  campaignId: string;
  ideaId: string;
  platform: VideoPlatform;
  blog_id: string;
  networks: MetricoolNetwork[];
  text: string;
  date: string;
  timezone: string;
  media: string[];
  content_type?: "REEL";
  youtube_title?: string;
  tiktok_title?: string;
  youtube_made_for_kids?: boolean;
  trackedWebsiteUrl: string;
  websiteCtaMode: "direct-link" | "profile-link";
  hashtagStrategy: CreativeFingerprint["hashtagStrategy"];
  hashtags: string[];
  finalMediaSha256?: string;
}

export interface PublicationEvent {
  status: PublicationStatus;
  at: string;
  note?: string;
  providerPostId?: string;
  providerUuid?: string;
  providerUrl?: string;
}

export interface PublicationLedger {
  creativeId: string;
  packageId: string;
  platform: VideoPlatform;
  events: PublicationEvent[];
}

const PLATFORM_NETWORK: Record<VideoPlatform, MetricoolNetwork> = {
  "youtube-shorts": "youtube",
  tiktok: "tiktok",
  "instagram-reels": "instagram",
};

const ALLOWED_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  generated: ["qc-passed", "rejected", "failed"],
  "qc-passed": ["scheduled", "rejected", "failed"],
  scheduled: ["published", "failed"],
  published: ["analytics-partial", "analytics-complete", "failed"],
  "analytics-partial": ["analytics-partial", "analytics-complete", "failed"],
  "analytics-complete": [],
  rejected: [],
  failed: [],
};

function nonEmpty(name: string, value: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function normalizeBaseUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("siteBaseUrl must be an absolute https URL.");
  }
  if (url.protocol !== "https:") throw new Error("siteBaseUrl must use https.");
  url.hash = "";
  url.search = "";
  return url;
}

function validateScheduleDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error("Metricool schedule date must be local YYYY-MM-DDTHH:mm:ss; timezone is supplied separately.");
  }
  const parsed = Date.parse(`${value}Z`);
  if (!Number.isFinite(parsed)) throw new Error("Metricool schedule date is invalid.");
  return value;
}

function truncate(input: string, max: number): string {
  const text = input.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function platformVariant(contentPackage: ContentPackage, platform: VideoPlatform) {
  const variant = contentPackage.platforms.find((entry) => entry.platform === platform);
  if (!variant) throw new Error(`Missing ${platform} content variant for ${contentPackage.packageId}.`);
  return variant;
}

export function buildTrackedWebsiteUrl(
  contentPackage: ContentPackage,
  creativeId: string,
  platform: VideoPlatform,
  siteBaseUrl: string,
): string {
  if (!contentPackage.site.route.startsWith("/")) throw new Error("SpecSmithPC route must start with '/'.");
  const base = normalizeBaseUrl(siteBaseUrl);
  const destination = new URL(contentPackage.site.route, base);
  destination.searchParams.set("utm_source", contentPackage.attribution.utmSourceByPlatform[platform]);
  destination.searchParams.set("utm_medium", contentPackage.attribution.utmMedium);
  destination.searchParams.set("utm_campaign", contentPackage.attribution.utmCampaign);
  destination.searchParams.set("utm_content", nonEmpty("creativeId", creativeId));
  return destination.toString();
}

function postText(
  contentPackage: ContentPackage,
  platform: VideoPlatform,
  trackedUrl: string,
): { text: string; websiteCtaMode: "direct-link" | "profile-link" } {
  const variant = platformVariant(contentPackage, platform);
  const tags = variant.hashtags.join(" ");

  if (platform === "youtube-shorts") {
    return {
      websiteCtaMode: "direct-link",
      text: `${variant.captionAngle}\n\nSee the full decision on SpecSmithPC:\n${trackedUrl}\n\n${tags}`.trim(),
    };
  }

  if (platform === "tiktok") {
    return {
      websiteCtaMode: "profile-link",
      text: `${variant.captionAngle}\n\nRun the full comparison on SpecSmithPC — link in bio.\n\n${tags}`.trim(),
    };
  }

  return {
    websiteCtaMode: "profile-link",
    text: `${variant.captionAngle}\n\nSee the full decision on SpecSmithPC — link in bio.\n\n${tags}`.trim(),
  };
}

function assertPublishGate(
  contentPackage: ContentPackage,
  fingerprint: CreativeFingerprint,
  gate: PublishingGateInput,
): void {
  if (gate.qualityReview.packageId !== contentPackage.packageId) {
    throw new Error(`Quality review package mismatch for ${contentPackage.packageId}.`);
  }
  if (gate.qualityReview.platform !== fingerprint.platform) {
    throw new Error(`Quality review platform mismatch for ${fingerprint.creativeId}.`);
  }
  if (!gate.qualityReview.publishable || gate.qualityReview.decision !== "pass") {
    throw new Error(`Publication blocked: quality review did not pass for ${fingerprint.creativeId}.`);
  }
  if (!gate.assetBundle.publishable) {
    const failures = [
      ...gate.assetBundle.missingAssetIds.map((id) => `missing:${id}`),
      ...gate.assetBundle.untrackedAssetIds.map((id) => `untracked:${id}`),
      ...gate.assetBundle.nonApprovedAssetIds.map((id) => `not-approved:${id}`),
    ];
    throw new Error(`Publication blocked by asset-rights bundle${failures.length ? ` (${failures.join(", ")})` : ""}.`);
  }
  nonEmpty("finalMediaRef", gate.finalMediaRef);
  if (gate.finalMediaSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(gate.finalMediaSha256)) {
    throw new Error("finalMediaSha256 must be a 64-character SHA-256 hex digest.");
  }
}

export function buildMetricoolPublishingRequest(
  idea: ContentIdea,
  contentPackage: ContentPackage,
  fingerprint: CreativeFingerprint,
  gate: PublishingGateInput,
  config: PublishingConfig,
  publishAt: string,
): MetricoolPublishingRequest {
  if (idea.id !== contentPackage.ideaId || idea.id !== fingerprint.ideaId) {
    throw new Error(`Publishing inputs do not refer to the same idea: ${idea.id}.`);
  }
  if (fingerprint.packageId !== contentPackage.packageId || fingerprint.campaignId !== contentPackage.campaignId) {
    throw new Error(`Publishing fingerprint does not belong to ${contentPackage.packageId}.`);
  }
  assertPublishGate(contentPackage, fingerprint, gate);

  const blogId = nonEmpty("blogId", config.blogId);
  const timezone = nonEmpty("timezone", config.timezone);
  const network = PLATFORM_NETWORK[fingerprint.platform];
  if (!config.connectedNetworks.includes(network)) {
    throw new Error(`Publication blocked: ${network} is not connected in the publishing config.`);
  }

  const trackedWebsiteUrl = buildTrackedWebsiteUrl(
    contentPackage,
    fingerprint.creativeId,
    fingerprint.platform,
    config.siteBaseUrl,
  );
  const copy = postText(contentPackage, fingerprint.platform, trackedWebsiteUrl);
  const variant = platformVariant(contentPackage, fingerprint.platform);
  const request: MetricoolPublishingRequest = {
    requestId: `metricool-${fingerprint.creativeId}`,
    creativeId: fingerprint.creativeId,
    packageId: contentPackage.packageId,
    campaignId: contentPackage.campaignId,
    ideaId: idea.id,
    platform: fingerprint.platform,
    blog_id: blogId,
    networks: [network],
    text: copy.text,
    date: validateScheduleDate(publishAt),
    timezone,
    media: [gate.finalMediaRef.trim()],
    trackedWebsiteUrl,
    websiteCtaMode: copy.websiteCtaMode,
    hashtagStrategy: variant.hashtagStrategy,
    hashtags: [...variant.hashtags],
    finalMediaSha256: gate.finalMediaSha256?.toLowerCase(),
  };

  if (fingerprint.platform === "youtube-shorts") {
    request.youtube_title = truncate(idea.title, 100);
    request.youtube_made_for_kids = config.youtubeMadeForKids ?? false;
  } else if (fingerprint.platform === "tiktok") {
    request.tiktok_title = truncate(idea.title, 150);
  } else {
    request.content_type = "REEL";
  }

  return request;
}

export function startPublicationLedger(
  fingerprint: CreativeFingerprint,
  at = new Date(),
): PublicationLedger {
  return {
    creativeId: fingerprint.creativeId,
    packageId: fingerprint.packageId,
    platform: fingerprint.platform,
    events: [{ status: "generated", at: at.toISOString() }],
  };
}

export function advancePublicationLedger(
  ledger: PublicationLedger,
  event: Omit<PublicationEvent, "at"> & { at?: string },
): PublicationLedger {
  const last = ledger.events.at(-1);
  if (!last) throw new Error("Publication ledger has no current state.");
  const allowed = ALLOWED_TRANSITIONS[last.status];
  if (!allowed.includes(event.status)) {
    throw new Error(`Invalid publication transition ${last.status} -> ${event.status} for ${ledger.creativeId}.`);
  }

  if (event.status === "published" && ledger.events.some((entry) => entry.status === "published")) {
    throw new Error(`Creative ${ledger.creativeId} is already marked published.`);
  }

  const at = event.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error("Publication event timestamp is invalid.");
  return {
    ...ledger,
    events: [...ledger.events, { ...event, at }],
  };
}
