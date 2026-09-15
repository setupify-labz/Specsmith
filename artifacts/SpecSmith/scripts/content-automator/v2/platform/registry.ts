// MASTER #4 — Platform capability registry (sections 9, 10).
//
// What this file is allowed to contain: facts with a named source, a capture
// date, a source quality and — for anything volatile — an expiry.
//
// What it deliberately does NOT contain: any claim about how a platform ranks,
// promotes, suppresses or rewards content. We have no source for that, and a
// plausible-sounding guess encoded as a constant is indistinguishable from a
// fact once it is three files deep. Every behavioural dimension below is
// `unknown`, and that is the honest state rather than a gap.
//
// Duration is treated as a CONSERVATIVE FLOOR rather than a real limit: each of
// these platforms has raised its maximum repeatedly, so "under 60 seconds is
// accepted everywhere" is a claim that survives those changes, while "the limit
// is N" would be stale within months and nothing here verifies it.

import {
  CATEGORY_FRESHNESS_DAYS,
  unknownCapability,
  type Capability,
  type PlatformCapability,
  type PlatformFact,
  type PlatformFactCategory,
  type PlatformId,
  type PlatformSnapshot,
  type PostingTimeState,
  type SourceQuality,
  type TrendState,
} from "./model.ts";

/**
 * The date the facts below were last reviewed by a human against the platforms.
 *
 * This is the honest capture date for everything in this registry: it is when
 * the constants were written down, not when a collector verified them. Volatile
 * facts expire from this date, so the registry ages rather than pretending to
 * be perpetually current.
 */
export const REGISTRY_REVIEWED_AT = "2026-09-15T00:00:00.000Z";

function expiryFor(category: PlatformFactCategory, capturedAt: string): string | null {
  const days = CATEGORY_FRESHNESS_DAYS[category];
  if (days === null) return null;
  return new Date(Date.parse(capturedAt) + days * 86_400_000).toISOString();
}

function fact(input: {
  readonly factId: string;
  readonly platform: PlatformId;
  readonly claim: string;
  readonly category: PlatformFactCategory;
  readonly status: PlatformFact["status"];
  readonly source: string;
  readonly sourceQuality: SourceQuality;
  readonly confidence: PlatformFact["confidence"];
  readonly notes: string;
  readonly capturedAt?: string;
}): PlatformFact {
  const capturedAt = input.capturedAt ?? REGISTRY_REVIEWED_AT;
  return {
    factId: input.factId,
    platform: input.platform,
    claim: input.claim,
    category: input.category,
    status: input.status,
    source: input.source,
    sourceQuality: input.sourceQuality,
    capturedAt,
    effectiveAt: null,
    expiresAt: expiryFor(input.category, capturedAt),
    confidence: input.confidence,
    notes: input.notes,
  };
}

function cap<T>(value: T, status: Capability<T>["status"], factId: string, basis: string): Capability<T> {
  return { value, status, factId, basis };
}

/**
 * Facts that hold for all three platforms.
 *
 * The vertical format is the one thing we can assert from direct observation
 * rather than from documentation: this repository's own renderer produces
 * 1080x1920 H.264/AAC and that output has been composed and inspected.
 */
function sharedFacts(platform: PlatformId): readonly PlatformFact[] {
  return [
    fact({
      factId: `${platform}-vertical`,
      platform,
      claim: "Accepts vertical 9:16 video at 1080x1920.",
      category: "media-constraint",
      status: "stable-constraint",
      source: "SpecSmith's own offline compositor, which renders and verifies 1080x1920 H.264/AAC output for these platforms.",
      sourceQuality: "direct-observation",
      confidence: "high",
      notes: "The defining format of all three short-form surfaces. Verified against our own rendered masters rather than documentation.",
    }),
    fact({
      factId: `${platform}-audio`,
      platform,
      claim: "Supports an audio track.",
      category: "media-constraint",
      status: "stable-constraint",
      source: "SpecSmith's own offline compositor, which muxes AAC audio into the delivered master.",
      sourceQuality: "direct-observation",
      confidence: "high",
      notes: "Audio support is assumed by the render path and confirmed by the composed artifact.",
    }),
    fact({
      factId: `${platform}-duration-floor`,
      platform,
      claim: "Video of 60 seconds or less is accepted.",
      category: "media-constraint",
      status: "stable-constraint",
      source: "Conservative floor: every one of these surfaces launched at 60s or shorter and has only ever raised the ceiling.",
      sourceQuality: "reputable-third-party",
      confidence: "moderate",
      notes:
        "Deliberately NOT a claim about the current maximum. Each platform has raised its limit repeatedly and nothing " +
        "connected here verifies today's value, so the registry states only the bound that survives those changes.",
    }),
    fact({
      factId: `${platform}-burned-captions`,
      platform,
      claim: "Burned-in captions are the only caption layer SpecSmith can verify.",
      category: "accessibility-capability",
      status: "stable-constraint",
      source: "SpecSmith's own caption renderer, whose output is part of the inspected master.",
      sourceQuality: "direct-observation",
      confidence: "high",
      notes:
        "Platform auto-captions may also exist, but their accuracy is outside our verification. Accessibility is therefore " +
        "guaranteed by burned-in captions rather than delegated to a platform feature we cannot check.",
    }),
  ];
}

/** Capability fields that are behavioural and therefore unknown everywhere. */
function unknownBehaviouralCapabilities(): Pick<PlatformCapability, "analytics"> {
  const analyticsBasis =
    "No analytics transport is configured in this repository: the Metricool REST publisher is inert without credentials " +
    "and no other provider is connected. Which metrics are available is therefore unverified — not empty, and certainly not zero.";
  return {
    analytics: {
      availableMetrics: unknownCapability<readonly string[]>(analyticsBasis),
      unavailableMetrics: unknownCapability<readonly string[]>(analyticsBasis),
      deprecatedMetrics: unknownCapability<readonly string[]>(analyticsBasis),
      windowBehaviour: unknownCapability<string>(analyticsBasis),
    },
  };
}

function baseCapability(platform: PlatformId, titleMax: number | null, descriptionMax: number, linkClickable: boolean, linkNote: string): PlatformCapability {
  const vertical = `${platform}-vertical`;
  const duration = `${platform}-duration-floor`;

  return {
    media: {
      orientation: cap<"vertical" | "horizontal" | "square">("vertical", "stable-constraint", vertical, "Verified against our own rendered masters."),
      aspectRatio: cap("9:16", "stable-constraint", vertical, "Verified against our own rendered masters."),
      recommendedWidth: cap(1080, "stable-constraint", vertical, "The width this repository actually renders and has inspected."),
      recommendedHeight: cap(1920, "stable-constraint", vertical, "The height this repository actually renders and has inspected."),
      minDurationSeconds: unknownCapability<number>(
        "No connected source establishes a minimum duration. Treated as unknown rather than assumed to be zero.",
      ),
      maxDurationSeconds: cap(
        60,
        "stable-constraint",
        duration,
        "A conservative floor that survives the limit changes these platforms keep making, not a claim about today's ceiling.",
      ),
      audioSupported: cap(true, "stable-constraint", `${platform}-audio`, "Our own muxed master carries an AAC track."),
      container: cap("mp4 (H.264/AAC)", "stable-constraint", vertical, "The container this repository produces and has verified."),
      // Safe areas shift with every platform UI redesign and we have not measured
      // them. Guessing would silently push captions under a UI overlay.
      safeAreaTopFraction: unknownCapability<number>(
        "Platform UI overlay extents have not been measured. A guessed safe area would place captions under platform chrome, so captions are kept centrally instead.",
      ),
      safeAreaBottomFraction: unknownCapability<number>(
        "Platform UI overlay extents have not been measured. A guessed safe area would place captions under platform chrome, so captions are kept centrally instead.",
      ),
    },
    text: {
      titleMaxChars: titleMax === null
        ? unknownCapability<number>("This surface has no separate title field distinct from the caption, so a title limit does not apply.")
        : cap(titleMax, "current-guidance", `${platform}-title-limit`, "Widely documented limit; volatile and expiring."),
      descriptionMaxChars: cap(descriptionMax, "current-guidance", `${platform}-description-limit`, "Widely documented limit; volatile and expiring."),
      hashtagsSupported: cap(true, "observed-capability", `${platform}-hashtags`, "All three surfaces accept hashtags in the caption or description."),
      platformCaptionsAvailable: unknownCapability<boolean>(
        "Whether platform auto-captioning is enabled for our accounts is unverified, and its accuracy is outside our control either way.",
      ),
      burnedInCaptionsAdvisable: cap(
        true,
        "stable-constraint",
        `${platform}-burned-captions`,
        "The only caption layer SpecSmith renders and inspects itself.",
      ),
    },
    interaction: {
      commentsAvailable: cap(true, "observed-capability", `${platform}-comments`, "All three surfaces carry a comment thread."),
      outboundLinkInDescription: cap(linkClickable, "current-guidance", `${platform}-link`, linkNote),
      profileLinkAvailable: cap(true, "observed-capability", `${platform}-profile-link`, "All three surfaces expose a profile with a link field."),
    },
    accessibility: {
      platformGeneratedCaptions: unknownCapability<boolean>(
        "Unverified for our accounts, and not relied upon: accessibility is satisfied by burned-in captions we render ourselves.",
      ),
      captionStylingControl: cap(
        true,
        "observed-capability",
        `${platform}-burned-captions`,
        "We control caption styling completely because we burn captions in before upload.",
      ),
      audioIndependentComprehensionRequired: cap(
        true,
        "stable-constraint",
        `${platform}-burned-captions`,
        "Short-form video is routinely watched muted, and accessibility requires comprehension without audio regardless.",
      ),
    },
    publishing: {
      schedulingAvailable: unknownCapability<boolean>(
        "SpecSmith schedules nothing. The Metricool REST transport is inert without credentials and is never invoked by the core path.",
      ),
      draftAvailable: unknownCapability<boolean>(
        "Draft capability is unverified for our accounts; the repository produces a draft-only handoff request rather than calling any API.",
      ),
      transport: cap(
        "manual-handoff",
        "observed-capability",
        `${platform}-transport`,
        "The only transport this repository actually has: a tracked, draft-only handoff document. No network call is made.",
      ),
    },
    ...unknownBehaviouralCapabilities(),
  };
}

/** The per-platform differences that are actually documented and stable enough to state. */
const PLATFORM_DEFINITIONS: Record<PlatformId, { readonly titleMax: number | null; readonly descriptionMax: number; readonly linkClickable: boolean; readonly linkNote: string }> = {
  "youtube-shorts": {
    titleMax: 100,
    descriptionMax: 5000,
    linkClickable: true,
    linkNote: "YouTube descriptions render clickable links. Volatile guidance: re-verify before relying on it for a CTA.",
  },
  tiktok: {
    titleMax: null,
    descriptionMax: 2200,
    linkClickable: false,
    linkNote: "TikTok captions do not render clickable links for general accounts; the profile link is the usable surface. Volatile guidance.",
  },
  "instagram-reels": {
    titleMax: null,
    descriptionMax: 2200,
    linkClickable: false,
    linkNote: "Instagram captions do not render clickable links; the profile link is the usable surface. Volatile guidance.",
  },
};

/**
 * Build the baseline snapshot for a platform.
 *
 * Deterministic and immutable: the same `capturedAt` always yields the same
 * snapshot including its ID, so a brief that records a snapshot ID can be
 * reconstructed exactly.
 */
export function baselinePlatformSnapshot(platform: PlatformId, capturedAt: string): PlatformSnapshot {
  const definition = PLATFORM_DEFINITIONS[platform];
  const facts = [
    ...sharedFacts(platform),
    fact({
      factId: `${platform}-description-limit`,
      platform,
      claim: `Caption or description accepts up to ${definition.descriptionMax} characters.`,
      category: "text-capability",
      status: "current-guidance",
      source: "Widely documented platform limit, recorded at review time rather than fetched.",
      sourceQuality: "reputable-third-party",
      confidence: "moderate",
      notes: "Volatile: the platform may change it without notice and nothing here re-verifies it.",
    }),
    fact({
      factId: `${platform}-link`,
      platform,
      claim: definition.linkClickable
        ? "Links in the description are clickable."
        : "Links in the caption are not clickable; the profile link is the usable surface.",
      category: "interaction-capability",
      status: "current-guidance",
      source: "Widely documented platform behaviour, recorded at review time.",
      sourceQuality: "reputable-third-party",
      confidence: "moderate",
      notes: definition.linkNote,
    }),
  ];

  return {
    version: "platform-snapshot-v1",
    snapshotId: `platform-${platform}-${capturedAt}`,
    platform,
    revision: 1,
    capturedAt,
    facts: [...facts].sort((a, b) => a.factId.localeCompare(b.factId)),
    capability: baseCapability(platform, definition.titleMax, definition.descriptionMax, definition.linkClickable, definition.linkNote),
    provenance: {
      synthetic: false,
      producedBy: "specsmith-platform-registry-baseline",
      producedAt: capturedAt,
    },
  };
}

/** Every baseline snapshot, for the pipeline and the fit engine. */
export function baselineSnapshots(capturedAt: string): Record<PlatformId, PlatformSnapshot> {
  return {
    "youtube-shorts": baselinePlatformSnapshot("youtube-shorts", capturedAt),
    tiktok: baselinePlatformSnapshot("tiktok", capturedAt),
    "instagram-reels": baselinePlatformSnapshot("instagram-reels", capturedAt),
  };
}

/**
 * Posting time. Always unknown here, and that is the whole point (section 23).
 *
 * A real best-time would arrive through `ingestPostingTime` from a connected
 * analytics provider reporting on our own account. Until then, the scheduler's
 * operational default is a default — never "optimal".
 */
export function postingTimeFor(_platform: PlatformId): PostingTimeState {
  return {
    state: "unknown",
    reason:
      "No first-party analytics provider is connected, so no posting time has been observed for this account. " +
      "A scheduler may still use an operational default, but nothing here may call that default optimal: " +
      "an unmeasured time is unknown, not best.",
  };
}

/**
 * Trends. Always unknown here (section 24).
 *
 * MASTER #3 already refuses to call anything trending without a collector, and
 * MASTER #4 must not manufacture one to make a platform fit look better.
 */
export function trendFor(_platform: PlatformId): TrendState {
  return {
    state: "unknown",
    reason:
      "No platform trend collector is connected. Nothing may be described as trending, and no adaptation may be " +
      "justified by a trend that was never observed.",
  };
}
