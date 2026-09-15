// MASTER #4 — Platform intelligence tests.
//
// Two properties under test: volatile guidance fails closed when it ages, and
// no platform folklore can enter the registry through any door — not as a fact,
// not as a posting time, not as a trend, not as an analytics zero.

import { describe, expect, it } from "vitest";

import {
  categoryIsVolatile,
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
  refreshSnapshot,
  unusableFacts,
  usableFacts,
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

describe("the registry states only what it can defend", () => {
  const snapshot = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);

  it("asserts the vertical format from direct observation of our own renders", () => {
    expect(snapshot.capability.media.aspectRatio.value).toBe("9:16");
    expect(snapshot.capability.media.recommendedHeight.value).toBe(1920);
    expect(snapshot.capability.media.orientation.status).toBe("stable-constraint");
  });

  it("states duration as a conservative floor rather than a current limit", () => {
    const duration = snapshot.facts.find((fact) => fact.factId === "tiktok-duration-floor");
    expect(duration?.claim).toMatch(/60 seconds or less/);
    expect(duration?.notes).toMatch(/NOT a claim about the current maximum/);
  });

  it("leaves safe areas unknown rather than guessing them", () => {
    expect(snapshot.capability.media.safeAreaTopFraction.status).toBe("unknown");
    expect(snapshot.capability.media.safeAreaTopFraction.value).toBeNull();
    expect(snapshot.capability.media.safeAreaBottomFraction.value).toBeNull();
  });

  it("leaves every analytics capability unknown, never empty", () => {
    const analytics = snapshot.capability.analytics;
    expect(analytics.availableMetrics.status).toBe("unknown");
    expect(analytics.availableMetrics.value).toBeNull();
    expect(analytics.unavailableMetrics.value).toBeNull();
    expect(analytics.availableMetrics.basis).toMatch(/not empty, and certainly not zero/);
  });

  it("contains no claim about ranking, promotion or suppression", () => {
    const text = JSON.stringify(baselineSnapshots(REGISTRY_REVIEWED_AT)).toLowerCase();
    for (const forbidden of ["algorithm", "suppress", "boost", "reach more", "the platform rewards", "favours", "favors"]) {
      expect(text, `registry should not claim: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("gives volatile facts an expiry and stable ones none", () => {
    for (const fact of snapshot.facts) {
      if (categoryIsVolatile(fact.category)) {
        expect(fact.expiresAt, fact.factId).not.toBeNull();
      }
    }
    const vertical = snapshot.facts.find((fact) => fact.factId === "tiktok-vertical");
    expect(vertical?.expiresAt).toBeNull();
  });
});

describe("one platform's constraints do not leak into another", () => {
  it("gives each platform its own snapshot identity", () => {
    const snapshots = baselineSnapshots(REGISTRY_REVIEWED_AT);
    const ids = PLATFORM_IDS.map((platform) => snapshots[platform].snapshotId);
    expect(new Set(ids).size).toBe(PLATFORM_IDS.length);
    for (const platform of PLATFORM_IDS) {
      expect(snapshots[platform].facts.every((fact) => fact.platform === platform)).toBe(true);
    }
  });

  it("keeps the documented link difference between platforms", () => {
    const snapshots = baselineSnapshots(REGISTRY_REVIEWED_AT);
    expect(snapshots["youtube-shorts"].capability.interaction.outboundLinkInDescription.value).toBe(true);
    expect(snapshots.tiktok.capability.interaction.outboundLinkInDescription.value).toBe(false);
    expect(snapshots["instagram-reels"].capability.interaction.outboundLinkInDescription.value).toBe(false);
  });

  it("keeps the documented title-field difference between platforms", () => {
    const snapshots = baselineSnapshots(REGISTRY_REVIEWED_AT);
    expect(snapshots["youtube-shorts"].capability.text.titleMaxChars.value).toBe(100);
    expect(snapshots.tiktok.capability.text.titleMaxChars.value).toBeNull();
  });

  it("refuses a document that files one platform's fact under another", () => {
    expect(() => parsePlatformGuidance(fixtureCrossPlatformLeak(NOW), ENGINEERING))
      .toThrow(/may never be filed under another/);
  });
});

describe("volatile guidance fails closed", () => {
  it("demotes guidance that has passed its window to stale", () => {
    const document = parsePlatformGuidance(fixtureStalePlatformGuidance("tiktok", NOW), ENGINEERING);
    const evaluated = evaluateFreshness(document.facts[0], NOW);
    expect(evaluated.status).toBe("stale");
    expect(statusIsUsable(evaluated.status)).toBe(false);
    expect(evaluated.notes).toMatch(/fails closed rather than continuing to look current/);
  });

  it("leaves guidance inside its window alone", () => {
    const document = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    expect(evaluateFreshness(document.facts[0], NOW).status).toBe("current-guidance");
  });

  it("computes the expiry from the category, not from the document", () => {
    const document = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    const expected = NOW.getTime() + (CATEGORY_FRESHNESS_DAYS["distribution-guidance"] ?? 0) * DAY;
    expect(Date.parse(document.facts[0].expiresAt!)).toBe(expected);
  });

  it("refuses a volatile fact submitted as a stable constraint", () => {
    expect(() => parsePlatformGuidance(fixtureVolatileClaimedStable("tiktok", NOW), ENGINEERING))
      .toThrow(/volatile by nature and can never be stable constraints/i);
  });

  it("refuses an anecdote submitted as a binding constraint", () => {
    const raw = fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>;
    const facts = (raw.facts as Record<string, unknown>[]).map((fact) => ({
      ...fact, category: "text-capability", status: "stable-constraint", sourceQuality: "anecdote",
    }));
    expect(() => parsePlatformGuidance({ ...raw, facts }, ENGINEERING))
      .toThrow(/may be recorded as a hypothesis, never as a binding constraint/);
  });

  // A fact carries the date its constant was REVIEWED, not the date a snapshot
  // was assembled, so ageing comes from evaluating later rather than from
  // building an old snapshot. `MUCH_LATER` is past the 365-day text/interaction
  // window but not past anything that genuinely does not expire.
  const MUCH_LATER = new Date(Date.parse(REGISTRY_REVIEWED_AT) + 400 * DAY);

  it("creates a new snapshot revision rather than mutating history", () => {
    const original = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);
    const refreshed = refreshSnapshot(original, MUCH_LATER);
    expect(refreshed.revision).toBe(original.revision + 1);
    expect(refreshed.snapshotId).not.toBe(original.snapshotId);
    // The original is untouched: a brief that cited it can still be reconstructed.
    expect(original.facts.every((fact) => fact.status !== "stale")).toBe(true);
    expect(refreshed.facts.some((fact) => fact.status === "stale")).toBe(true);
  });

  it("leaves a snapshot alone when nothing has aged out", () => {
    const original = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);
    expect(refreshSnapshot(original, new Date(Date.parse(REGISTRY_REVIEWED_AT) + DAY))).toBe(original);
  });

  it("ages documented limits but never the format itself", () => {
    const snapshot = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);
    const aged = refreshSnapshot(snapshot, MUCH_LATER);
    const vertical = aged.facts.find((fact) => fact.factId === "tiktok-vertical");
    const limit = aged.facts.find((fact) => fact.factId === "tiktok-description-limit");
    expect(vertical?.status).toBe("stable-constraint");
    expect(limit?.status).toBe("stale");
  });

  it("separates usable from unusable facts", () => {
    const snapshot = baselinePlatformSnapshot("tiktok", REGISTRY_REVIEWED_AT);
    const usable = usableFacts(snapshot, MUCH_LATER);
    const unusable = unusableFacts(snapshot, MUCH_LATER);
    expect(usable.length + unusable.length).toBe(snapshot.facts.length);
    expect(unusable.length).toBeGreaterThan(0);
    expect(usable.every((fact) => statusIsUsable(fact.status))).toBe(true);
  });
});

describe("posting time is unknown and stays unknown", () => {
  it("reports unknown for every platform", () => {
    for (const platform of PLATFORM_IDS) {
      const state = postingTimeFor(platform);
      expect(state.state).toBe("unknown");
      if (state.state === "unknown") {
        expect(state.reason).toMatch(/an unmeasured time is unknown, not best/);
      }
    }
  });

  it("refuses a third-party best-time as a measurement of this account", () => {
    const state = ingestPostingTime(fixtureThirdPartyPostingTime("tiktok", NOW), "fictional-account", NOW);
    expect(state.state).toBe("unknown");
    if (state.state === "unknown") {
      expect(state.reason).toMatch(/an industry average is not a measurement of us/);
    }
  });

  it("accepts a first-party observation about our own account", () => {
    const fact: PlatformFact = {
      ...fixtureThirdPartyPostingTime("tiktok", NOW),
      sourceQuality: "first-party-analytics",
    };
    const state = ingestPostingTime(fact, "specsmith-tiktok", NOW);
    expect(state.state).toBe("observed");
    if (state.state === "observed") {
      expect(state.windows).toEqual(["19:00-21:00 local"]);
      expect(state.accountScope).toBe("specsmith-tiktok");
    }
  });

  it("expires a first-party observation once it ages out", () => {
    const fact: PlatformFact = {
      ...fixtureThirdPartyPostingTime("tiktok", new Date(NOW.getTime() - 60 * DAY)),
      sourceQuality: "first-party-analytics",
    };
    expect(ingestPostingTime(fact, "specsmith-tiktok", NOW).state).toBe("stale");
  });
});

describe("trends require a real observation", () => {
  it("reports unknown for every platform with no collector", () => {
    for (const platform of PLATFORM_IDS) {
      const state = trendFor(platform);
      expect(state.state).toBe("unknown");
      if (state.state === "unknown") {
        expect(state.reason).toMatch(/Nothing may be described as trending/);
      }
    }
  });

  it("refuses a trend asserted from an anecdote", () => {
    const state = ingestTrend(fixtureAnecdotalTrend("tiktok", NOW), "fictional", NOW);
    expect(state.state).toBe("unknown");
    if (state.state === "unknown") {
      expect(state.reason).toMatch(/not a claim that something feels popular/);
    }
  });

  it("expires a trend past its window", () => {
    const fact: PlatformFact = {
      ...fixtureAnecdotalTrend("tiktok", new Date(NOW.getTime() - 30 * DAY)),
      sourceQuality: "direct-observation",
      expiresAt: new Date(NOW.getTime() - 16 * DAY).toISOString(),
    };
    expect(ingestTrend(fact, "fictional", NOW).state).toBe("expired");
  });

  it("accepts a real, fresh, scoped observation", () => {
    const fact: PlatformFact = { ...fixtureAnecdotalTrend("tiktok", NOW), sourceQuality: "first-party-analytics" };
    const state = ingestTrend(fact, "specsmith-tiktok", NOW);
    expect(state.state).toBe("observed");
  });
});

describe("an unknown metric is never zero", () => {
  it("reports unknown when no analytics document exists", () => {
    const result = readMetric(null, "views", "f1");
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") expect(result.reason).toMatch(/not the same as having measured zero/);
  });

  it("reports unknown for an unreported metric", () => {
    const result = readMetric({ reach: 10 }, "views", "f1");
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") expect(result.reason).toMatch(/converting it to 0 would fabricate a measurement/);
  });

  it("reports unknown for a null metric rather than reading it as zero", () => {
    const result = readMetric({ views: null }, "views", "f1");
    expect(result.state).toBe("unknown");
  });

  it("reads a genuine zero as a genuine measurement", () => {
    const result = readMetric({ views: 0 }, "views", "f1");
    expect(result.state).toBe("available");
    if (result.state === "available") expect(result.value).toBe(0);
  });
});

describe("the synthetic platform boundary", () => {
  it("refuses a synthetic guidance document in production", () => {
    expect(() => parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), PRODUCTION))
      .toThrow(/may never become production platform intelligence/);
  });

  it("refuses a document that does not declare whether it is synthetic", () => {
    const raw = { ...(fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>), provenance: { producedBy: "x", producedAt: NOW.toISOString() } };
    expect(() => parsePlatformGuidance(raw, ENGINEERING)).toThrow(/must be an explicit boolean/);
  });

  it("refuses a duplicate fact id", () => {
    const raw = fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>;
    const fact = (raw.facts as unknown[])[0];
    expect(() => parsePlatformGuidance({ ...raw, facts: [fact, fact] }, ENGINEERING)).toThrow(/appears twice/);
  });

  it("refuses an unknown platform rather than defaulting it", () => {
    const raw = { ...(fixturePlatformGuidance("tiktok", NOW) as Record<string, unknown>), platform: "bluesky-video" };
    expect(() => parsePlatformGuidance(raw, ENGINEERING)).toThrow(PlatformIngestionError);
  });

  it("is idempotent: parsing twice yields the same document", () => {
    const first = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    const second = parsePlatformGuidance(fixturePlatformGuidance("tiktok", NOW), ENGINEERING);
    expect(first).toEqual(second);
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
