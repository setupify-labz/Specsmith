// MASTER #4 — Platform intelligence tests.

import { describe, expect, it } from "vitest";

import {
  CATEGORY_FRESHNESS_DAYS,
  PLATFORM_IDS,
  statusIsBinding,
  statusIsUsable,
  type PlatformFact,
} from "./model.ts";
import {
  baselinePlatformSnapshot,
  baselineSnapshots,
  postingTimeFor,
  REGISTRY_REVIEWED_AT,
  trendFor,
} from "./registry.ts";
import {
  evaluateFreshness,
  ingestPostingTime,
  ingestTrend,
  parsePlatformGuidance,
  PlatformIngestionError,
  readMetric,
} from "./ingestion.ts";
import {
  fixtureAnecdotalTrend,
  fixtureCrossPlatformLeak,
  fixturePlatformGuidance,
  fixtureStalePlatformGuidance,
  fixtureThirdPartyPostingTime,
  fixtureVolatileClaimedStable,
} from "../delivery/engineeringFixture.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const DAY = 86_400_000;
const ENGINEERING = { allowSynthetic: true } as const;
const PRODUCTION = { allowSynthetic: false } as const;

describe("the baseline registry does not turn renderer facts into platform facts", () => {
  it("keeps external media acceptance unknown", () => {
    const snapshot = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);
    expect(snapshot.facts).toEqual([]);
    expect(snapshot.capability.media.orientation.status).toBe("unknown");
    expect(snapshot.capability.media.orientation.value).toBeNull();
    expect(snapshot.capability.media.aspectRatio.value).toBeNull();
    expect(snapshot.capability.media.maxDurationSeconds.value).toBeNull();
    expect(snapshot.capability.media.audioSupported.value).toBeNull();
  });

  it("does not encode an accepted-duration floor as a maximum", () => {
    for (const snapshot of Object.values(baselineSnapshots(REGISTRY_REVIEWED_AT))) {
      expect(snapshot.capability.media.maxDurationSeconds.status).toBe("unknown");
      expect(snapshot.capability.media.maxDurationSeconds.value).toBeNull();
      expect(JSON.stringify(snapshot).toLowerCase()).not.toContain("conservative floor");
    }
  });

  it("keeps volatile text/link claims unknown instead of using unnamed documentation", () => {
    const snapshots = baselineSnapshots(REGISTRY_REVIEWED_AT);
    for (const snapshot of Object.values(snapshots)) {
      expect(snapshot.capability.text.titleMaxChars.status).toBe("unknown");
      expect(snapshot.capability.text.descriptionMaxChars.status).toBe("unknown");
      expect(snapshot.capability.interaction.outboundLinkInDescription.status).toBe("unknown");
      expect(snapshot.capability.interaction.profileLinkAvailable.status).toBe("unknown");
    }
  });

  it("keeps SpecSmith-owned caption behaviour explicit without calling it a platform fact", () => {
    const snapshot = baselinePlatformSnapshot("instagram-reels", REGISTRY_REVIEWED_AT);
    expect(snapshot.capability.text.burnedInCaptionsAdvisable.value).toBe(true);
    expect(snapshot.capability.text.burnedInCaptionsAdvisable.factId).toBeNull();
    expect(snapshot.capability.text.burnedInCaptionsAdvisable.basis).toMatch(/SpecSmith renders/i);
  });

  it("leaves every analytics capability unknown, never empty", () => {
    const analytics = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT).capability.analytics;
    expect(analytics.availableMetrics.status).toBe("unknown");
    expect(analytics.availableMetrics.value).toBeNull();
    expect(analytics.unavailableMetrics.value).toBeNull();
  });

  it("contains no algorithm or unsupported distribution claim", () => {
    const text = JSON.stringify(baselineSnapshots(REGISTRY_REVIEWED_AT)).toLowerCase();
    for (const forbidden of ["suppress", "boost", "reach more", "the platform rewards", "favours", "favors"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("keeps each platform snapshot isolated", () => {
    const snapshots = baselineSnapshots(REGISTRY_REVIEWED_AT);
    const ids = PLATFORM_IDS.map((platform) => snapshots[platform].snapshotId);
    expect(new Set(ids).size).toBe(PLATFORM_IDS.length);
    expect(Object.values(snapshots).every((snapshot) => snapshot.facts.every((fact) => fact.platform === snapshot.platform))).toBe(true);
  });
});

describe("strict platform guidance ingestion", () => {
  it("refuses a document that files one platform's fact under another", () => {
    expect(() => parsePlatformGuidance(fixtureCrossPlatformLeak(NOW), ENGINEERING)).toThrow(/may never be filed under another/);
  });

  it("demotes guidance that has passed its window to stale", () => {
    const document = parsePlatformGuidance(fixtureStalePlatformGuidance("tiktok", NOW), ENGINEERING);
    const evaluated = evaluateFreshness(document.facts[0], NOW);
    expect(evaluated.status).toBe("stale");
    expect(statusIsUsable(evaluated.status)).toBe(false);
  });

  it("leaves guidance inside its window alone", () => {
    const document = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    expect(evaluateFreshness(document.facts[0], NOW).status).toBe("current-guidance");
  });

  it("computes expiry from category rather than trusting the document", () => {
    const document = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    const expected = NOW.getTime() + (CATEGORY_FRESHNESS_DAYS["distribution-guidance"] ?? 0) * DAY;
    expect(Date.parse(document.facts[0].expiresAt!)).toBe(expected);
  });

  it("refuses volatile facts submitted as stable constraints", () => {
    expect(() => parsePlatformGuidance(fixtureVolatileClaimedStable("tiktok", NOW), ENGINEERING)).toThrow(/volatile by nature/i);
  });

  it("refuses anecdotes submitted as binding constraints", () => {
    const raw = fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>;
    const facts = (raw.facts as Record<string, unknown>[]).map((fact) => ({
      ...fact,
      category: "text-capability",
      status: "stable-constraint",
      sourceQuality: "anecdote",
    }));
    expect(() => parsePlatformGuidance({ ...raw, facts }, ENGINEERING)).toThrow(/never as a binding constraint/);
  });

  it("refuses synthetic guidance in production", () => {
    expect(() => parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), PRODUCTION)).toThrow(/may never become production platform intelligence/);
  });

  it("requires explicit synthetic provenance", () => {
    const raw = {
      ...(fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>),
      provenance: { producedBy: "x", producedAt: NOW.toISOString() },
    };
    expect(() => parsePlatformGuidance(raw, ENGINEERING)).toThrow(/must be an explicit boolean/);
  });

  it("refuses duplicate fact identifiers", () => {
    const raw = fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>;
    const fact = (raw.facts as unknown[])[0];
    expect(() => parsePlatformGuidance({ ...raw, facts: [fact, fact] }, ENGINEERING)).toThrow(/appears twice/);
  });

  it("refuses an unknown platform", () => {
    const raw = { ...(fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>), platform: "bluesky-video" };
    expect(() => parsePlatformGuidance(raw, ENGINEERING)).toThrow(PlatformIngestionError);
  });

  it("is deterministic/idempotent", () => {
    expect(parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING)).toEqual(
      parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING),
    );
  });
});

describe("posting time and trends stay evidence-bound", () => {
  it("reports posting time unknown for every baseline platform", () => {
    for (const platform of PLATFORM_IDS) {
      const state = postingTimeFor(platform);
      expect(state.state).toBe("unknown");
      if (state.state === "unknown") expect(state.reason).toMatch(/unknown, not best/);
    }
  });

  it("refuses a third-party best-time as an observation of this account", () => {
    const state = ingestPostingTime(fixtureThirdPartyPostingTime("tiktok", NOW), "fictional-account", NOW);
    expect(state.state).toBe("unknown");
  });

  it("accepts a first-party posting-time observation and expires it later", () => {
    const fresh: PlatformFact = { ...fixtureThirdPartyPostingTime("tiktok", NOW), sourceQuality: "first-party-analytics" };
    expect(ingestPostingTime(fresh, "specsmith-tiktok", NOW).state).toBe("observed");
    const stale: PlatformFact = {
      ...fixtureThirdPartyPostingTime("tiktok", new Date(NOW.getTime() - 60 * DAY)),
      sourceQuality: "first-party-analytics",
    };
    expect(ingestPostingTime(stale, "specsmith-tiktok", NOW).state).toBe("stale");
  });

  it("reports trends unknown without a collector and rejects anecdotes", () => {
    for (const platform of PLATFORM_IDS) expect(trendFor(platform).state).toBe("unknown");
    expect(ingestTrend(fixtureAnecdotalTrend("tiktok", NOW), "fictional", NOW).state).toBe("unknown");
  });

  it("accepts a fresh scoped trend observation and expires stale ones", () => {
    const fresh: PlatformFact = { ...fixtureAnecdotalTrend("tiktok", NOW), sourceQuality: "first-party-analytics" };
    expect(ingestTrend(fresh, "specsmith-tiktok", NOW).state).toBe("observed");
    const stale: PlatformFact = {
      ...fixtureAnecdotalTrend("tiktok", new Date(NOW.getTime() - 30 * DAY)),
      sourceQuality: "direct-observation",
      expiresAt: new Date(NOW.getTime() - 16 * DAY).toISOString(),
    };
    expect(ingestTrend(stale, "fictional", NOW).state).toBe("expired");
  });
});

describe("analytics unknown is never zero", () => {
  it("distinguishes no observation, missing/null metrics and a genuine zero", () => {
    expect(readMetric(null, "views", "f1").state).toBe("unknown");
    expect(readMetric({ reach: 10 }, "views", "f1").state).toBe("unknown");
    expect(readMetric({ views: null }, "views", "f1").state).toBe("unknown");
    const zero = readMetric({ views: 0 }, "views", "f1");
    expect(zero.state).toBe("available");
    if (zero.state === "available") expect(zero.value).toBe(0);
  });
});

describe("binding status", () => {
  it("treats only stable constraints and observed capabilities as binding", () => {
    expect(statusIsBinding("stable-constraint")).toBe(true);
    expect(statusIsBinding("observed-capability")).toBe(true);
    expect(statusIsBinding("current-guidance")).toBe(false);
    expect(statusIsBinding("hypothesis")).toBe(false);
    expect(statusIsBinding("stale")).toBe(false);
  });
});
