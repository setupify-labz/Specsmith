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
  /** Opt out of draft only deliberately; omitted means draft. */
  autoPublish?: boolean;
}

export interface PublishingGateInput {
  /**
   * The QC verdict for this creative. Its `reviewedMediaSha256` is the digest
   * of the bytes a reviewer actually watched — the gate reads it from here
   * rather than accepting a hash argument, because a caller-supplied digest
   * proves nothing about what was reviewed.
   */
  qualityReview: QualityReviewResult;
  /**
   * The rights verdict for this creative. Its `approvedMasterSha256` is
   * resolved from the asset registry's stored record for the master, so it is
   * likewise a fact about the registry rather than an assertion by the caller.
   */
  assetBundle: PublicationAssetBundleResult;
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
  /**
   * Metricool's optional draft flag. Defaults to TRUE here so the builder can
   * never emit a request that auto-publishes: promoting to a live post has to
   * be a deliberate, separate decision.
   */
  draft: boolean;
  trackedWebsiteUrl: string;
  websiteCtaMode: "direct-link" | "profile-link";
  hashtagStrategy: CreativeFingerprint["hashtagStrategy"];
  hashtags: string[];
  finalMediaSha256: string;
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

/**
 * The UTC offset, in milliseconds, that `timeZone` was observing at `instant`.
 *
 * Derived by formatting the instant in the zone and measuring how far the
 * resulting wall clock has drifted from UTC, which is the only way to get a
 * real offset — including the DST one in force on that date — without a
 * timezone library.
 */
function zoneOffsetMsAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Timezone ${timeZone} produced no ${type} field.`);
    return Number(found.value);
  };
  const wallClock = Date.UTC(field("year"), field("month") - 1, field("day"), field("hour"), field("minute"), field("second"));
  return wallClock - instant;
}

function localTimeAt(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const field = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Timezone ${timeZone} produced no ${type} field.`);
    return found.value;
  };
  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}:${field("second")}`;
}

/**
 * The unique UTC instant at which `local` wall-clock time occurs in `timeZone`.
 *
 * A local time in a spring-forward gap has no matching instant. A local time
 * in a fall-back overlap has two. Neither is safe for an unattended publisher,
 * so this resolver round-trips every plausible offset and rejects both cases.
 */
function instantOfLocalTime(local: string, timeZone: string): number {
  const asIfUtc = Date.parse(`${local}Z`);
  if (!Number.isFinite(asIfUtc)) throw new Error("Metricool schedule date is invalid.");

  const hour = 60 * 60 * 1_000;
  const offsets = new Set(
    [-48, -24, 0, 24, 48].map((deltaHours) => zoneOffsetMsAt(asIfUtc + deltaHours * hour, timeZone)),
  );
  const candidates = [...offsets]
    .map((offset) => asIfUtc - offset)
    .filter((instant, index, all) => all.indexOf(instant) === index)
    .filter((instant) => localTimeAt(instant, timeZone) === local);

  if (candidates.length === 0) {
    throw new Error(`Metricool schedule date ${local} does not exist in ${timeZone} because of a timezone transition.`);
  }
  if (candidates.length > 1) {
    throw new Error(`Metricool schedule date ${local} is ambiguous in ${timeZone} because of a timezone transition.`);
  }
  return candidates[0];
}

/**
 * Accepts only a slot that is still in the future in the timezone the post
 * will actually be scheduled against.
 *
 * The previous version compared the wall clock to `now` as though it were UTC
 * and allowed a 24-hour grace window, which meant a slot up to a day in the
 * past — and any slot inside the zone's offset — was accepted and silently
 * handed to Metricool. Scheduling into the past is not a schedule; the offset
 * for the supplied IANA zone is resolved here and the comparison is exact.
 */
function validateScheduleDate(value: string, timeZone: string, now: Date): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error("Metricool schedule date must be local YYYY-MM-DDTHH:mm:ss; timezone is supplied separately.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`timezone ${timeZone} is not a recognised IANA timezone identifier.`);
  }

  const scheduled = instantOfLocalTime(value, timeZone);
  if (!Number.isFinite(scheduled)) throw new Error("Metricool schedule date is invalid.");
  if (scheduled <= now.getTime()) {
    throw new Error(
      `Metricool schedule date ${value} (${timeZone}) is not in the future; refusing to schedule a post into the past.`,
    );
  }
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
    // TikTok captions are a single run of text: newlines typed into a caption
    // are not preserved in the rendered post, so shipping them just means the
    // published caption differs from the one that was reviewed. Joined with
    // spaces instead, which is what the platform would have collapsed them to.
    return {
      websiteCtaMode: "profile-link",
      text: `${variant.captionAngle} Run the full comparison on SpecSmithPC — link in bio. ${tags}`.replace(/\s+/g, " ").trim(),
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
): { mediaUrl: string; digest: string } {
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
  const mediaRef = nonEmpty("assetBundle.approvedMasterUri", gate.assetBundle.approvedMasterUri ?? "");
  let mediaUrl: URL;
  try {
    mediaUrl = new URL(mediaRef);
  } catch {
    throw new Error("assetBundle.approvedMasterUri must be an absolute https URL that Metricool can fetch.");
  }
  if (mediaUrl.protocol !== "https:") {
    throw new Error(`assetBundle.approvedMasterUri must use https; Metricool cannot fetch ${mediaUrl.protocol}// media.`);
  }

  // Both digests are DERIVED, never passed in. `reviewedMediaSha256` comes from
  // the observation a reviewer recorded while watching the file;
  // `approvedMasterSha256` comes from the rights registry's stored record for
  // the master asset. A caller can therefore no longer make an unreviewed
  // render look cleared by handing the gate two matching strings.
  const digest = nonEmpty("qualityReview.reviewedMediaSha256", gate.qualityReview.reviewedMediaSha256).toLowerCase();
  const approved = gate.assetBundle.approvedMasterSha256?.trim().toLowerCase() ?? "";
  if (!approved) {
    throw new Error(
      "Publication blocked: the asset bundle resolved no approved master hash, so there is nothing to bind the render to.",
    );
  }
  for (const [name, value] of [
    ["qualityReview.reviewedMediaSha256", digest],
    ["assetBundle.approvedMasterSha256", approved],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a 64-character SHA-256 hex digest.`);
  }
  // The binding that makes QC and rights mean something: the bytes about to be
  // published are the bytes that were reviewed.
  if (digest !== approved) {
    throw new Error(
      `Publication blocked: reviewed media ${digest} is not the rights-approved master ${approved}. QC and rights clearance do not transfer across renders.`,
    );
  }
  return { mediaUrl: mediaUrl.toString(), digest };
}

export function buildMetricoolPublishingRequest(
  idea: ContentIdea,
  contentPackage: ContentPackage,
  fingerprint: CreativeFingerprint,
  gate: PublishingGateInput,
  config: PublishingConfig,
  publishAt: string,
  now: Date = new Date(),
): MetricoolPublishingRequest {
  if (idea.id !== contentPackage.ideaId || idea.id !== fingerprint.ideaId) {
    throw new Error(`Publishing inputs do not refer to the same idea: ${idea.id}.`);
  }
  if (fingerprint.packageId !== contentPackage.packageId || fingerprint.campaignId !== contentPackage.campaignId) {
    throw new Error(`Publishing fingerprint does not belong to ${contentPackage.packageId}.`);
  }
  const approvedMaster = assertPublishGate(contentPackage, fingerprint, gate);

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
    date: validateScheduleDate(publishAt, timezone, now),
    timezone,
    media: [approvedMaster.mediaUrl],
    trackedWebsiteUrl,
    websiteCtaMode: copy.websiteCtaMode,
    hashtagStrategy: variant.hashtagStrategy,
    hashtags: [...variant.hashtags],
    draft: config.autoPublish !== true,
    finalMediaSha256: approvedMaster.digest,
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

/**
 * Cross-ledger duplicate guard.
 *
 * advancePublicationLedger's transition table already makes a second publish
 * impossible WITHIN one ledger — `published` is reachable only from
 * `scheduled`, and no state that already holds a published event allows it
 * again. (The previous in-function `some(published)` check was therefore
 * unreachable and has been removed rather than left as false assurance.)
 *
 * What that table cannot see is a SECOND LEDGER for the same creative, which
 * is exactly what a re-run produces: startPublicationLedger mints a fresh
 * in-memory object every time. Callers must load every known ledger for the
 * creative and pass them here before scheduling.
 *
 * NOTE: this repository still has no ledger persistence, so today the caller
 * has nothing durable to pass. Until ledgers are stored, duplicate protection
 * across runs is the caller's responsibility and is NOT provided by this
 * module.
 */
export function assertNotAlreadyPublished(
  knownLedgers: readonly PublicationLedger[],
  creativeId: string,
): void {
  const published = knownLedgers.filter(
    (ledger) => ledger.creativeId === creativeId && ledger.events.some((entry) => entry.status === "published"),
  );
  if (published.length > 0) {
    const when = published[0].events.find((entry) => entry.status === "published")?.at ?? "unknown time";
    throw new Error(`Creative ${creativeId} was already published at ${when}; refusing to publish it again.`);
  }
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

  const at = event.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error("Publication event timestamp is invalid.");
  return {
    ...ledger,
    events: [...ledger.events, { ...event, at }],
  };
}
