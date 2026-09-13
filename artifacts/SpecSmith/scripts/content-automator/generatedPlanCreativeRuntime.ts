import type { CreativeRuntimeMetadata } from "./creativeFingerprint.ts";

/**
 * The creative-fingerprint runtime metadata for the offline generated-plan
 * render (endToEndOfflinePipeline.ts / offlineGeneratedPlanRender.ts),
 * pulled out into its own module so its asset-mix classification can be
 * unit tested directly instead of only by reading endToEndOfflinePipeline.ts
 * as text — that script calls `main()` at import time and cannot safely be
 * imported by a test.
 *
 * Independent review of PR #92 correctly flagged that an earlier version of
 * this object fabricated its asset-mix ratios:
 * - `generatedVisualRatio` was recorded as 1/6, implying one beat used a
 *   paid/AI-generated visual. localFixtureVideo.ts's own asset metadata
 *   says `generated: false` for that beat (a plain offline fixture card) —
 *   no beat in this render is a generated visual, so this must be 0.
 * - `exactProductAssetRatio` was recorded as 5/6, implying five beats show
 *   exact product imagery. Those five beats are captures of SpecSmith's own
 *   Compare page UI (already correctly counted by `uiProofRatio`), not
 *   photography of a GPU or any other physical product — so this must be 0
 *   too. "Real UI proof" and "exact product asset" are different claims;
 *   conflating them is exactly the fabricated classification review flagged.
 */
export const GENERATED_PLAN_CREATIVE_RUNTIME_METADATA: CreativeRuntimeMetadata = {
  voiceName: "local-espeak-tts-fixture (offline, not production voice)",
  firstVisualType: "mixed",
  uiProofRatio: 5 / 6,
  generatedVisualRatio: 0,
  exactProductAssetRatio: 0,
};
