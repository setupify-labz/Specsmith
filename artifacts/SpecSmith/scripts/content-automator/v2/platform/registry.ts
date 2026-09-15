// MASTER #4 — Platform capability registry (sections 9, 10).
//
// This baseline is deliberately conservative. A fact about what SpecSmith's
// renderer PRODUCES is not evidence that an external platform ACCEPTS it.
// External platform capabilities therefore remain unknown until a sourced
// platform observation/guidance document establishes them.

import {
  unknownCapability,
  type Capability,
  type PlatformCapability,
  type PlatformId,
  type PlatformSnapshot,
  type PostingTimeState,
  type TrendState,
} from "./model.ts";

/**
 * Date this baseline policy was reviewed. It is NOT a claim that external
 * platform behaviour was verified on this date.
 */
export const REGISTRY_REVIEWED_AT = "2026-09-15T00:00:00.000Z";

function knownInternal<T>(value: T, basis: string): Capability<T> {
  return {
    value,
    status: "observed-capability",
    factId: null,
    basis,
  };
}

function unknownExternal<T>(subject: string): Capability<T> {
  return unknownCapability<T>(
    `${subject} has not been established by a traceable platform source or direct platform observation. ` +
      "SpecSmith's local renderer cannot establish external platform behaviour.",
  );
}

/**
 * Baseline capability state.
 *
 * Platform-facing fields are unknown until real platform evidence is ingested.
 * The few known fields below describe SpecSmith-owned behaviour only and are
 * explicitly labelled as such; they must never be counted as platform facts.
 */
function baselineCapability(_platform: PlatformId): PlatformCapability {
  return {
    media: {
      orientation: unknownExternal("Accepted orientation"),
      aspectRatio: unknownExternal("Accepted aspect ratio"),
      recommendedWidth: unknownExternal("Accepted/recommended width"),
      recommendedHeight: unknownExternal("Accepted/recommended height"),
      minDurationSeconds: unknownExternal("Minimum accepted duration"),
      maxDurationSeconds: unknownExternal("Maximum accepted duration"),
      audioSupported: unknownExternal("Audio-track support"),
      container: unknownExternal("Accepted media container/codec"),
      safeAreaTopFraction: unknownExternal("Top UI safe area"),
      safeAreaBottomFraction: unknownExternal("Bottom UI safe area"),
    },
    text: {
      titleMaxChars: unknownExternal("Separate title field and title character limit"),
      descriptionMaxChars: unknownExternal("Description/caption character limit"),
      hashtagsSupported: unknownExternal("Hashtag support"),
      platformCaptionsAvailable: unknownExternal("Platform-generated caption availability"),
      // This is a SpecSmith-owned production choice, not a platform claim.
      burnedInCaptionsAdvisable: knownInternal(
        true,
        "SpecSmith renders and inspects burned-in captions itself; this says nothing about a platform's native caption features.",
      ),
    },
    interaction: {
      commentsAvailable: unknownExternal("Comment availability"),
      outboundLinkInDescription: unknownExternal("Description/caption link clickability"),
      profileLinkAvailable: unknownExternal("Profile-link availability"),
    },
    accessibility: {
      platformGeneratedCaptions: unknownExternal("Platform-generated caption availability"),
      // Also SpecSmith-owned: styling is applied before upload.
      captionStylingControl: knownInternal(
        true,
        "SpecSmith controls styling of captions burned into its own rendered video before any platform receives it.",
      ),
      audioIndependentComprehensionRequired: knownInternal(
        true,
        "SpecSmith's accessibility policy requires audio-independent comprehension; this is a product requirement, not a platform fact.",
      ),
    },
    publishing: {
      schedulingAvailable: unknownExternal("Scheduling availability"),
      draftAvailable: unknownExternal("Draft availability"),
      transport: knownInternal(
        "manual-handoff",
        "The repository's verified transport is a tracked handoff. No external platform transport is assumed by the core path.",
      ),
    },
    analytics: {
      availableMetrics: unknownExternal("Available analytics metrics"),
      unavailableMetrics: unknownExternal("Unavailable analytics metrics"),
      deprecatedMetrics: unknownExternal("Deprecated analytics metrics"),
      windowBehaviour: unknownExternal("Analytics window behaviour"),
    },
  };
}

/**
 * Build a deterministic baseline snapshot.
 *
 * `facts` is intentionally empty: we do not manufacture external facts from
 * renderer behaviour, memory, or unnamed "widely documented" guidance. Real
 * platform facts enter through the strict ingestion boundary and can later be
 * represented in a newer snapshot revision.
 */
export function baselinePlatformSnapshot(platform: PlatformId, capturedAt: string): PlatformSnapshot {
  return {
    version: "platform-snapshot-v1",
    snapshotId: `platform-${platform}-${capturedAt}`,
    platform,
    revision: 1,
    capturedAt,
    facts: [],
    capability: baselineCapability(platform),
    provenance: {
      synthetic: false,
      producedBy: "specsmith-platform-registry-baseline",
      producedAt: capturedAt,
    },
  };
}

export function baselineSnapshots(capturedAt: string): Record<PlatformId, PlatformSnapshot> {
  return {
    "youtube-shorts": baselinePlatformSnapshot("youtube-shorts", capturedAt),
    tiktok: baselinePlatformSnapshot("tiktok", capturedAt),
    "instagram-reels": baselinePlatformSnapshot("instagram-reels", capturedAt),
  };
}

export function postingTimeFor(_platform: PlatformId): PostingTimeState {
  return {
    state: "unknown",
    reason:
      "No first-party analytics observation establishes a best posting time for this account. " +
      "A scheduler may use an operational default, but an unmeasured time is unknown, not best.",
  };
}

export function trendFor(_platform: PlatformId): TrendState {
  return {
    state: "unknown",
    reason:
      "No platform trend collector is connected. Nothing may be described as trending, and no adaptation may be " +
      "justified by a trend that was never observed.",
  };
}
