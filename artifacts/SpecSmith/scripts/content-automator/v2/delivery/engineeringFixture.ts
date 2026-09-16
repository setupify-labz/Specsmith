// MASTER #4 — Engineering fixtures (section 40).
//
// Every fixture here is marked SYNTHETIC_ENGINEERING_FIXTURE and every
// production ingestion path refuses them by name. They exist so the delivery
// chain can be exercised end to end without inventing a single real observation
// about a real person or a real platform.
//
// The naming is deliberately conspicuous — "EXAMPLE GPU-A", "example.invalid" —
// so that a fixture leaking into a report is obvious to a human reader at a
// glance, not only to a type check.

import type { AudienceSignalBundle } from "../audience/signals.ts";
import type { PlatformFact, PlatformId } from "../platform/model.ts";

export const SYNTHETIC_MARKER = "SYNTHETIC_ENGINEERING_FIXTURE";

function provenance(now: Date) {
  return {
    synthetic: true,
    producedBy: SYNTHETIC_MARKER,
    producedAt: now.toISOString(),
  };
}

/**
 * No audience signals at all.
 *
 * This is the shape production actually has today, expressed as a fixture so
 * the "everything is unknown" path is exercised rather than assumed.
 */
export function fixtureNoAudienceSignals(now: Date): unknown {
  return {
    version: "audience-signal-result-v1",
    bundleId: `${SYNTHETIC_MARKER}-no-audience-signals`,
    capturedAt: now.toISOString(),
    signals: [],
    provenance: provenance(now),
    unavailableFamilies: [
      "specsmith-search-query", "specsmith-internal-search", "community-discussion",
      "comment-thread", "published-creative-analytics", "search-console-query",
    ],
  };
}

/**
 * A bundle with real observed language and a real expertise observation.
 *
 * Used to exercise the path where audience dimensions actually reach
 * `observed` — which no production pass can currently do, because no collector
 * exists. Every phrase is obviously fictional.
 */
export function fixtureObservedAudience(now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "audience-signal-result-v1",
    bundleId: `${SYNTHETIC_MARKER}-observed-audience`,
    capturedAt,
    signals: [
      {
        signalId: `${SYNTHETIC_MARKER}-phrase-1`,
        sourceFamily: "search-console-query",
        sourceReference: "https://example.invalid/search-console/specsmith",
        capturedAt,
        observedAt: capturedAt,
        scope: "Fictional queries reaching a fictional property. Not a real audience.",
        sampleSize: 140,
        limitations: ["Entirely invented for engineering verification."],
        evidenceState: "observed",
        dimensions: ["language.phrase"],
        observation: "is example gpu-a enough for 1440p",
      },
      {
        signalId: `${SYNTHETIC_MARKER}-phrase-2`,
        sourceFamily: "search-console-query",
        sourceReference: "https://example.invalid/search-console/specsmith",
        capturedAt,
        observedAt: capturedAt,
        scope: "Fictional queries reaching a fictional property. Not a real audience.",
        sampleSize: 90,
        limitations: ["Entirely invented for engineering verification."],
        evidenceState: "observed",
        dimensions: ["language.phrase"],
        observation: "what is vram and does it matter",
      },
      {
        signalId: `${SYNTHETIC_MARKER}-expertise`,
        sourceFamily: "specsmith-tool-usage",
        sourceReference: "https://example.invalid/tool-usage/fictional",
        capturedAt,
        observedAt: capturedAt,
        scope: "Fictional tool sessions. Not real users.",
        sampleSize: 55,
        limitations: ["Entirely invented for engineering verification."],
        evidenceState: "observed",
        dimensions: ["expertise"],
        observation: "beginner",
      },
    ],
    provenance: provenance(now),
    unavailableFamilies: ["community-discussion", "published-creative-analytics"],
  };
}

/**
 * A bundle that reports a sample size of zero.
 *
 * Exists to prove ingestion refuses it: zero asserts that a collector looked
 * and found nobody, which is a measurement. An unreported count must be null.
 */
export function fixtureZeroSampleSize(now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "audience-signal-result-v1",
    bundleId: `${SYNTHETIC_MARKER}-zero-sample`,
    capturedAt,
    signals: [
      {
        signalId: `${SYNTHETIC_MARKER}-zero`,
        sourceFamily: "community-discussion",
        sourceReference: "https://example.invalid/forum",
        capturedAt,
        observedAt: null,
        scope: "Fictional.",
        sampleSize: 0,
        limitations: [],
        evidenceState: "observed",
        dimensions: ["objection"],
        observation: "nobody asked anything",
      },
    ],
    provenance: provenance(now),
    unavailableFamilies: [],
  };
}

/**
 * A bundle that tries to establish a demographic from behaviour.
 *
 * Exists to prove ingestion refuses it: no configured source family can
 * establish age, and inferring one from tool usage is how a persona is born.
 */
export function fixtureDemographicClaim(now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "audience-signal-result-v1",
    bundleId: `${SYNTHETIC_MARKER}-demographic`,
    capturedAt,
    signals: [
      {
        signalId: `${SYNTHETIC_MARKER}-age`,
        sourceFamily: "specsmith-tool-usage",
        sourceReference: "https://example.invalid/tool-usage",
        capturedAt,
        observedAt: null,
        scope: "Fictional.",
        sampleSize: 200,
        limitations: [],
        evidenceState: "observed",
        dimensions: ["demographics.age"],
        observation: "18-24",
      },
    ],
    provenance: provenance(now),
    unavailableFamilies: [],
  };
}

/**
 * Platform guidance documents.
 *
 * `fixtureStalePlatformGuidance` is the important one: guidance captured long
 * enough ago that the freshness rule must demote it, proving the rule fires
 * rather than merely existing.
 */
export function fixturePlatformGuidance(platform: PlatformId, now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "platform-guidance-result-v1",
    documentId: `${SYNTHETIC_MARKER}-guidance-${platform}`,
    platform,
    capturedAt,
    facts: [
      {
        factId: `${SYNTHETIC_MARKER}-${platform}-guidance-1`,
        platform,
        claim: "A fictional distribution recommendation recorded for engineering verification.",
        category: "distribution-guidance",
        status: "current-guidance",
        source: "https://example.invalid/platform-docs",
        sourceQuality: "reputable-third-party",
        capturedAt,
        effectiveAt: null,
        confidence: "moderate",
        notes: SYNTHETIC_MARKER,
      },
    ],
    provenance: provenance(now),
  };
}

/** Guidance captured 200 days ago: past the 90-day distribution window. */
export function fixtureStalePlatformGuidance(platform: PlatformId, now: Date): unknown {
  const capturedAt = new Date(now.getTime() - 200 * 86_400_000).toISOString();
  return {
    version: "platform-guidance-result-v1",
    documentId: `${SYNTHETIC_MARKER}-stale-guidance-${platform}`,
    platform,
    capturedAt,
    facts: [
      {
        factId: `${SYNTHETIC_MARKER}-${platform}-stale`,
        platform,
        claim: "A fictional recommendation that was captured long enough ago to be past its window.",
        category: "distribution-guidance",
        status: "current-guidance",
        source: "https://example.invalid/platform-docs",
        sourceQuality: "reputable-third-party",
        capturedAt,
        effectiveAt: null,
        confidence: "moderate",
        notes: SYNTHETIC_MARKER,
      },
    ],
    provenance: provenance(now),
  };
}

/**
 * A document claiming a best posting time from a third party.
 *
 * Exists to prove the posting-time rule refuses it: an industry-wide average is
 * not a measurement of OUR audience, and accepting it would be the invented
 * optimum section 23 forbids.
 */
export function fixtureThirdPartyPostingTime(platform: PlatformId, now: Date): PlatformFact {
  return {
    factId: `${SYNTHETIC_MARKER}-${platform}-posting-time`,
    platform,
    claim: "19:00-21:00 local",
    category: "posting-time",
    status: "current-guidance",
    source: "https://example.invalid/social-media-tips",
    sourceQuality: "reputable-third-party",
    capturedAt: now.toISOString(),
    effectiveAt: null,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    confidence: "low",
    notes: `${SYNTHETIC_MARKER}. An industry average, not a measurement of this account.`,
  };
}

/** A trend claimed from an anecdote. Must be refused. */
export function fixtureAnecdotalTrend(platform: PlatformId, now: Date): PlatformFact {
  return {
    factId: `${SYNTHETIC_MARKER}-${platform}-trend`,
    platform,
    claim: "Fictional format is doing numbers right now",
    category: "trend",
    status: "hypothesis",
    source: "https://example.invalid/someone-said-so",
    sourceQuality: "anecdote",
    capturedAt: now.toISOString(),
    effectiveAt: null,
    expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    confidence: "low",
    notes: `${SYNTHETIC_MARKER}. Somebody's impression, not an observation.`,
  };
}

/** A volatile fact submitted as a stable constraint. Must be refused. */
export function fixtureVolatileClaimedStable(platform: PlatformId, now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "platform-guidance-result-v1",
    documentId: `${SYNTHETIC_MARKER}-volatile-stable-${platform}`,
    platform,
    capturedAt,
    facts: [
      {
        factId: `${SYNTHETIC_MARKER}-${platform}-volatile-stable`,
        platform,
        claim: "Posting at 19:00 always performs best.",
        category: "posting-time",
        status: "stable-constraint",
        source: "https://example.invalid/confident-blog",
        sourceQuality: "reputable-third-party",
        capturedAt,
        effectiveAt: null,
        confidence: "high",
        notes: SYNTHETIC_MARKER,
      },
    ],
    provenance: provenance(now),
  };
}

/** A document filing one platform's fact under another platform. Must be refused. */
export function fixtureCrossPlatformLeak(now: Date): unknown {
  const capturedAt = now.toISOString();
  return {
    version: "platform-guidance-result-v1",
    documentId: `${SYNTHETIC_MARKER}-leak`,
    platform: "tiktok",
    capturedAt,
    facts: [
      {
        factId: `${SYNTHETIC_MARKER}-leaked-fact`,
        platform: "youtube-shorts",
        claim: "A fact about a different platform entirely.",
        category: "text-capability",
        status: "current-guidance",
        source: "https://example.invalid/docs",
        sourceQuality: "reputable-third-party",
        capturedAt,
        effectiveAt: null,
        confidence: "moderate",
        notes: SYNTHETIC_MARKER,
      },
    ],
    provenance: provenance(now),
  };
}

/**
 * Assert a bundle is unmistakably synthetic.
 *
 * Used by the pipeline to prove the fixture boundary holds, rather than
 * trusting that whoever wrote the fixture remembered to mark it.
 */
export function assertUnmistakablySynthetic(bundle: AudienceSignalBundle): void {
  if (!bundle.provenance.synthetic) {
    throw new Error(`Bundle ${bundle.bundleId} is not marked synthetic but came from the fixture module.`);
  }
  if (!bundle.provenance.producedBy.includes(SYNTHETIC_MARKER)) {
    throw new Error(
      `Bundle ${bundle.bundleId} is marked synthetic but its producedBy does not carry ${SYNTHETIC_MARKER}, ` +
        "so a human reading a report could not tell it was fixture data.",
    );
  }
}

// ---------------------------------------------------------------------------
// The full-chain demonstration (section 40)
// ---------------------------------------------------------------------------

/**
 * A complete, deterministic input triple for exercising the whole delivery
 * chain: RESEARCH_RESULT -> CONTENT_MISSION -> AUDIENCE -> PLATFORM -> FIT ->
 * PLATFORM_CREATIVE_BRIEF -> MASTER #1 handoff.
 *
 * Re-exported from the shared fixture module so there is exactly one definition
 * of this example rather than a test copy and a pipeline copy that can drift.
 *
 * Every part of it is fictional and every provenance field is marked synthetic,
 * so nothing produced from it can pass a production ingestion boundary. It
 * exists because the production path currently — and correctly — authorises no
 * mission, which means the brief-producing half of MASTER #4 would otherwise
 * never be demonstrated end to end.
 */
export {
  missionFixture as fixtureChainMission,
  contractFixture as fixtureChainContract,
  researchFixture as fixtureChainResearch,
} from "./testFixtures.ts";
