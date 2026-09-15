import { describe, expect, it } from "vitest";

import { buildAudienceProfile, assessAudienceFit } from "../audience/profile.ts";
import { unavailableAudienceSignals } from "../audience/signals.ts";
import { baselinePlatformSnapshot, postingTimeFor, trendFor, REGISTRY_REVIEWED_AT } from "../platform/registry.ts";
import { buildPlatformBrief } from "./brief.ts";
import { assessAudiencePlatformFit } from "./fit.ts";
import { extractTruthInvariant } from "./invariants.ts";
import { missionFixture, researchFixture, contractFixture } from "./testFixtures.ts";
import type { PlatformSnapshot } from "../platform/model.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function inputs(snapshot: PlatformSnapshot) {
  const mission = missionFixture();
  const research = researchFixture();
  const contract = contractFixture();
  const invariant = extractTruthInvariant(mission, contract, research);
  const profile = buildAudienceProfile({
    mission,
    contract,
    research,
    signals: unavailableAudienceSignals(NOW.toISOString()),
    hypotheses: [],
    now: NOW,
    producedBy: "platform-provenance-test",
  });
  const audienceFit = assessAudienceFit(profile, mission);
  const fit = assessAudiencePlatformFit({
    mission,
    profile,
    audienceFit,
    invariant,
    snapshot,
    postingTime: postingTimeFor(snapshot.platform),
    trend: trendFor(snapshot.platform),
    now: NOW,
  });
  return { mission, contract, invariant, profile, fit };
}

describe("platform capability provenance is load-bearing", () => {
  it("ignores an unsourced one-second maximum instead of refusing the mission", () => {
    const baseline = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const forged: PlatformSnapshot = {
      ...baseline,
      capability: {
        ...baseline.capability,
        media: {
          ...baseline.capability.media,
          maxDurationSeconds: {
            value: 1,
            status: "stable-constraint",
            factId: "missing-fact",
            basis: "forged capability with no matching snapshot fact",
          },
        },
      },
    };

    const { fit } = inputs(forged);
    expect(fit.verdict).toBe("unknown");
    expect(fit.refusals.map((refusal) => refusal.code)).not.toContain("evidence-cannot-fit-honestly");
    expect(fit.unresolvedAssumptions.join(" ")).toMatch(/source-bound provenance/i);
  });

  it("does not turn an unsourced clickable-link value into CTA placement or adaptation evidence", () => {
    const baseline = baselinePlatformSnapshot("youtube-shorts", REGISTRY_REVIEWED_AT);
    const forged: PlatformSnapshot = {
      ...baseline,
      capability: {
        ...baseline.capability,
        interaction: {
          ...baseline.capability.interaction,
          outboundLinkInDescription: {
            value: true,
            status: "observed-capability",
            factId: "missing-link-fact",
            basis: "forged capability with no matching snapshot fact",
          },
        },
      },
    };

    const { mission, invariant, profile, fit } = inputs(forged);
    expect(fit.cta.treatment).toMatch(/show .* on screen/i);
    expect(fit.cta.treatment).not.toMatch(/place .* in the description/i);

    const brief = buildPlatformBrief({
      mission,
      invariant,
      profile,
      fit,
      snapshot: forged,
      hypotheses: [],
      strategyRunId: "strategy-test",
      creativeId: "creative-test",
      now: NOW,
      producedBy: "platform-provenance-test",
    });
    expect(brief.adaptationEvidence).toEqual([]);
  });
});
