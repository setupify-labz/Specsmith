// MASTER #4 — Platform intelligence model (sections 7, 8, 9, 28).
//
// The central distinction: a platform FACT is not all one thing.
//
//   "Vertical 9:16 is supported"     — a stable technical constraint.
//   "Post at 7pm for best reach"     — volatile, account-specific folklore.
//
// Treating those the same is how content systems end up encoding superstition
// as engineering. Here they are different categories with different freshness
// rules, and volatile guidance fails closed to `unknown` when it goes stale.
//
// Nothing in this file encodes an algorithm. We do not know how any of these
// platforms rank content, and a registry that pretends otherwise would be
// fabricated platform facts with extra steps.

import type { VideoPlatform } from "../../types.ts";

/**
 * The platform identifier, reused from the existing Content Automator types
 * rather than redeclared. A second parallel platform enum would drift from the
 * one publishing and hashtags already use, and drift here means a brief built
 * for one platform being applied to another.
 */
export type PlatformId = VideoPlatform;

export const PLATFORM_IDS: readonly PlatformId[] = ["youtube-shorts", "tiktok", "instagram-reels"];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/**
 * How well a platform fact is known.
 *
 * `current-guidance` is the dangerous one: it is real, sourced, and expires.
 * Everything downstream must check freshness before relying on it.
 */
export type PlatformKnowledgeStatus =
  /** A technical constraint that does not drift week to week. */
  | "stable-constraint"
  /** Something the platform demonstrably does, verified against the product. */
  | "observed-capability"
  /** Sourced recommendation that is true for now and will expire. */
  | "current-guidance"
  /** Believed, unverified. Must never drive a hard constraint. */
  | "hypothesis"
  | "unknown"
  /** Was current guidance; its window has passed. Not usable as fact. */
  | "stale"
  /** The platform removed it. Actively wrong to rely on. */
  | "deprecated";

export const PLATFORM_KNOWLEDGE_STATUSES: readonly PlatformKnowledgeStatus[] = [
  "stable-constraint", "observed-capability", "current-guidance",
  "hypothesis", "unknown", "stale", "deprecated",
];

/** Statuses a hard execution constraint may be derived from. */
const BINDING_STATUSES = new Set<PlatformKnowledgeStatus>(["stable-constraint", "observed-capability"]);

export function statusIsBinding(status: PlatformKnowledgeStatus): boolean {
  return BINDING_STATUSES.has(status);
}

/** Statuses that must not be presented as true right now. */
const UNUSABLE_STATUSES = new Set<PlatformKnowledgeStatus>(["unknown", "stale", "deprecated"]);

export function statusIsUsable(status: PlatformKnowledgeStatus): boolean {
  return !UNUSABLE_STATUSES.has(status);
}

export type PlatformFactCategory =
  | "media-constraint"
  | "text-capability"
  | "interaction-capability"
  | "accessibility-capability"
  | "publishing-capability"
  | "analytics-capability"
  | "distribution-guidance"
  | "posting-time"
  | "trend";

/**
 * Categories that are inherently volatile.
 *
 * Volatility is a property of the SUBJECT, not of how confident someone felt
 * when they wrote it down. A posting-time fact is volatile even if the source
 * was excellent.
 */
export const VOLATILE_CATEGORIES: readonly PlatformFactCategory[] = [
  "distribution-guidance", "posting-time", "trend",
];

export function categoryIsVolatile(category: PlatformFactCategory): boolean {
  return VOLATILE_CATEGORIES.includes(category);
}

export type SourceQuality =
  /** The platform's own published documentation. */
  | "platform-official"
  /** Verified by observing the product behave that way. */
  | "direct-observation"
  /** A connected analytics provider reporting on our own account. */
  | "first-party-analytics"
  /** A named third party with a method. */
  | "reputable-third-party"
  /** Someone said so. Never sufficient for a binding constraint. */
  | "anecdote";

export const SOURCE_QUALITIES: readonly SourceQuality[] = [
  "platform-official", "direct-observation", "first-party-analytics", "reputable-third-party", "anecdote",
];

/**
 * Default usable lifetime per category, in days.
 *
 * `null` means it does not expire on a clock: a stable constraint changes when
 * the platform changes it, and that arrives as a new snapshot rather than as a
 * timeout. Volatile categories all expire, and quickly.
 */
export const CATEGORY_FRESHNESS_DAYS: Record<PlatformFactCategory, number | null> = {
  // 9:16 vertical is the defining shape of the format and is verified against
  // our own renders, so it does not expire on a clock.
  "media-constraint": null,
  // Character limits and link behaviour ARE changed by platforms, just slowly.
  // Giving them no expiry would mean a documented limit recorded once stayed
  // "current" forever, which is how a registry quietly becomes wrong.
  "text-capability": 365,
  "interaction-capability": 365,
  // About SpecSmith's own renderer rather than the platform, so ours to change.
  "accessibility-capability": null,
  "publishing-capability": 180,
  "analytics-capability": 180,
  "distribution-guidance": 90,
  // Best-time claims are account-specific and drift with audience behaviour.
  "posting-time": 30,
  // A trend that is three weeks old is not a trend.
  trend: 14,
};

/**
 * A single fact about a platform, with everything needed to audit it.
 *
 * `expiresAt`/`recheckAt` are computed from the category at ingestion rather
 * than trusted from the source, so a source cannot declare its own folklore
 * evergreen.
 */
export interface PlatformFact {
  readonly factId: string;
  readonly platform: PlatformId;
  readonly claim: string;
  readonly category: PlatformFactCategory;
  readonly status: PlatformKnowledgeStatus;
  readonly source: string;
  readonly sourceQuality: SourceQuality;
  readonly capturedAt: string;
  /** When the platform behaviour began, when that is known. */
  readonly effectiveAt: string | null;
  /** Computed from the category. Null only for non-expiring categories. */
  readonly expiresAt: string | null;
  readonly confidence: "high" | "moderate" | "low";
  readonly notes: string;
}

/**
 * An immutable, versioned snapshot of what we believed about a platform
 * (section 28).
 *
 * A creative brief stores the snapshot ID it used, so a decision made in March
 * remains explainable in June even after the guidance has changed. Updates
 * create a new snapshot; they never edit an old one.
 */
export interface PlatformSnapshot {
  readonly version: "platform-snapshot-v1";
  readonly snapshotId: string;
  readonly platform: PlatformId;
  readonly revision: number;
  readonly capturedAt: string;
  readonly facts: readonly PlatformFact[];
  readonly capability: PlatformCapability;
  readonly provenance: { readonly synthetic: boolean; readonly producedBy: string; readonly producedAt: string };
}

// ---------------------------------------------------------------------------
// Capability registry (section 9)
// ---------------------------------------------------------------------------

/**
 * A capability value that knows whether it is actually established.
 *
 * `null` value with `unknown` status is the default for everything we have not
 * verified — which, for anything behavioural, is most of it.
 */
export interface Capability<T> {
  readonly value: T | null;
  readonly status: PlatformKnowledgeStatus;
  readonly factId: string | null;
  readonly basis: string;
}

export function unknownCapability<T>(basis: string): Capability<T> {
  return { value: null, status: "unknown", factId: null, basis };
}

export interface MediaCapability {
  readonly orientation: Capability<"vertical" | "horizontal" | "square">;
  readonly aspectRatio: Capability<string>;
  readonly recommendedWidth: Capability<number>;
  readonly recommendedHeight: Capability<number>;
  readonly minDurationSeconds: Capability<number>;
  readonly maxDurationSeconds: Capability<number>;
  readonly audioSupported: Capability<boolean>;
  readonly container: Capability<string>;
  /** Fraction of the frame obscured by platform UI at top and bottom. */
  readonly safeAreaTopFraction: Capability<number>;
  readonly safeAreaBottomFraction: Capability<number>;
}

export interface TextCapability {
  readonly titleMaxChars: Capability<number>;
  readonly descriptionMaxChars: Capability<number>;
  readonly hashtagsSupported: Capability<boolean>;
  readonly platformCaptionsAvailable: Capability<boolean>;
  readonly burnedInCaptionsAdvisable: Capability<boolean>;
}

export interface InteractionCapability {
  readonly commentsAvailable: Capability<boolean>;
  readonly outboundLinkInDescription: Capability<boolean>;
  readonly profileLinkAvailable: Capability<boolean>;
}

export interface AccessibilityCapability {
  readonly platformGeneratedCaptions: Capability<boolean>;
  readonly captionStylingControl: Capability<boolean>;
  readonly audioIndependentComprehensionRequired: Capability<boolean>;
}

export interface PublishingCapability {
  readonly schedulingAvailable: Capability<boolean>;
  readonly draftAvailable: Capability<boolean>;
  /** How SpecSmith could publish here today, if it were permitted to. */
  readonly transport: Capability<string>;
}

export interface AnalyticsCapability {
  readonly availableMetrics: Capability<readonly string[]>;
  readonly unavailableMetrics: Capability<readonly string[]>;
  readonly deprecatedMetrics: Capability<readonly string[]>;
  readonly windowBehaviour: Capability<string>;
}

export interface PlatformCapability {
  readonly media: MediaCapability;
  readonly text: TextCapability;
  readonly interaction: InteractionCapability;
  readonly accessibility: AccessibilityCapability;
  readonly publishing: PublishingCapability;
  readonly analytics: AnalyticsCapability;
}

// ---------------------------------------------------------------------------
// Volatile states (sections 23, 24)
// ---------------------------------------------------------------------------

/**
 * Posting time.
 *
 * There is exactly one honest value in this repository today, and it is
 * `unknown`. A scheduler may use an operational default; this layer must never
 * call that default optimal, because nobody measured it.
 */
export type PostingTimeState =
  | { readonly state: "unknown"; readonly reason: string }
  | {
      readonly state: "observed";
      readonly windows: readonly string[];
      readonly factId: string;
      readonly accountScope: string;
      readonly observedAt: string;
    }
  | { readonly state: "stale"; readonly reason: string; readonly factId: string };

/** A trend. Requires a real observation with a scope and an expiry. */
export type TrendState =
  | { readonly state: "unknown"; readonly reason: string }
  | {
      readonly state: "observed";
      readonly descriptor: string;
      readonly factId: string;
      readonly scope: string;
      readonly observedAt: string;
      readonly expiresAt: string;
    }
  | { readonly state: "expired"; readonly reason: string; readonly factId: string };

/** Tag provenance (section 22). Three kinds that must not be confused. */
export type TagKind =
  /** Observed in real platform data as relevant/used. */
  | "observed"
  /** Believed useful. A guess, labelled as one. */
  | "hypothesized"
  /** Plainly describes the content. Requires no evidence because it claims none. */
  | "generic-descriptive";

export interface PlatformTag {
  readonly tag: string;
  readonly kind: TagKind;
  readonly basis: string;
  /** Only ever set for an observed tag backed by a fact. */
  readonly factId: string | null;
}
