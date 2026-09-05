import { describe, expect, it } from "vitest";
import { GENERATED_PLAN_CREATIVE_RUNTIME_METADATA } from "./generatedPlanCreativeRuntime.ts";
import { buildCreativeFingerprint } from "./creativeFingerprint.ts";
import { buildGeneratedPlanPackages, GENERATED_PLAN_IDEA, GENERATED_PLAN_PLATFORM } from "./offlineGeneratedPlanRender.ts";
import type { DailyVideoPlan } from "./types.ts";

describe("generated-plan creative runtime metadata does not fabricate asset-mix classifications", () => {
  it("records zero generated-visual and exact-product-asset ratios, not fractions that merely look plausible", () => {
    // localFixtureVideo.ts's own asset metadata says `generated: false` for
    // the hook beat (a plain offline fixture card, not paid/AI-generated
    // video) — no beat in this render is a "generated visual."
    expect(GENERATED_PLAN_CREATIVE_RUNTIME_METADATA.generatedVisualRatio).toBe(0);
    // The 5 UI beats are captures of SpecSmith's own Compare page, not
    // photography of a GPU or any other physical product — "real UI proof"
    // and "exact product asset" are different claims.
    expect(GENERATED_PLAN_CREATIVE_RUNTIME_METADATA.exactProductAssetRatio).toBe(0);
    // uiProofRatio is the field that genuinely earns a nonzero value here.
    expect(GENERATED_PLAN_CREATIVE_RUNTIME_METADATA.uiProofRatio).toBeCloseTo(5 / 6, 5);
  });

  it("carries those exact values through buildCreativeFingerprint unchanged", () => {
    const generatedAt = new Date("2026-09-04T00:00:00Z");
    const { content, storyboard } = buildGeneratedPlanPackages(generatedAt);
    const script = storyboard.scripts.find((entry) => entry.platform === GENERATED_PLAN_PLATFORM);
    if (!script) throw new Error(`No ${GENERATED_PLAN_PLATFORM} script in the storyboard.`);

    const plan: DailyVideoPlan = {
      rank: 1,
      idea: GENERATED_PLAN_IDEA,
      qualityScore: 9,
      learningAdjustment: 0,
      experiment: { hypothesis: "Real UI evidence out-converts generic B-roll.", primaryMetric: "site-clicks", holdConstant: ["cpu"] },
    };

    const fingerprint = buildCreativeFingerprint(plan, content, script, GENERATED_PLAN_CREATIVE_RUNTIME_METADATA);
    expect(fingerprint.generatedVisualRatio).toBe(0);
    expect(fingerprint.exactProductAssetRatio).toBe(0);
    // buildCreativeFingerprint rounds ratios to 3 decimal digits.
    expect(fingerprint.uiProofRatio).toBeCloseTo(5 / 6, 3);
  });
});
