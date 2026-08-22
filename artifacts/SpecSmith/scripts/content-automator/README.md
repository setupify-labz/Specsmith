# SpecSmith Content Automator — Creative + Logical V1

This isolated subsystem turns SpecSmith product surfaces and trusted hardware data into a daily batch of **five high-tier content plans**, then carries those ideas through platform packaging, script/storyboard planning, production planning, rendering orchestration, automated audio selection, and automated quality-review contracts. The renderer can execute end-to-end in dry-run mode now; real external media providers are still plugged in later through adapters. It does **not** post videos yet.

## Product-first rule

The content engine starts with **what SpecSmith helps a user do**, not with a random PC-video idea.

Every concept must define:

- the real SpecSmith feature powering it
- the PC/user problem being solved
- why SpecSmith is necessary to the story
- the exact site route the viewer can continue into
- the on-site payoff after the short-form content ends

If SpecSmith can be removed without changing the idea, the concept fails the product-fit gate.

Current product map:

- Builder (`/builder`)
- Compare (`/compare`)
- Build Crate (`/crate`)
- Build Guides (`/best-pc-for`)
- Gallery (`/gallery`)
- Upgrade (`/upgrade-calculator`)
- Parts Catalog / Guides (`/parts-guides`)
- Price Guesser (`/price-guesser`)

## Pipeline

`SpecSmith idea -> platform package -> script/storyboard -> production plan -> audio decision -> renderer -> AI reviewer -> later publishing + analytics`

The renderer is capability-based instead of hardcoded to one vendor. Production tasks request capabilities such as deterministic SpecSmith UI, video generation, image generation, TTS, audio, captions, and composition. Provider adapters can then be swapped without rewriting the creative pipeline.

## Trending audio scanner + selector

`audioTrend.ts` makes a platform-specific audio decision for every selected idea.

It can choose between:

- a current trending/platform-native sound
- a commercially cleared trending sound that can be rendered into the master
- a safe original/licensed SpecSmith music bed and SFX fallback

The selector scores candidates using trend velocity, popularity, freshness, saturation, and creative fit to the actual video concept. Trending audio is rejected when it is stale, uncleared, unknown-rights, or a weak creative match. A huge sound is not allowed to win just because it is popular.

Platform-cleared sounds are marked `platform-publish`, which means they should be attached through the platform's own publishing/audio system instead of being baked into the video file. Commercially cleared tracks can be marked for render-time use.

The daily generator optionally reads:

`content-ideas/generated/audio-trends.json`

with this shape:

```json
{
  "capturedAt": "2026-08-22T20:00:00Z",
  "candidates": [
    {
      "id": "platform-sound-id",
      "platform": "tiktok",
      "title": "Sound title",
      "artist": "Artist",
      "capturedAt": "2026-08-22T20:00:00Z",
      "rightsStatus": "platform-cleared",
      "popularityScore": 82,
      "velocityScore": 95,
      "saturationScore": 35,
      "tags": ["countdown", "tension", "reveal"]
    }
  ]
}
```

If no fresh feed exists, the automator fails safely to original/licensed audio instead of guessing that a popular song is legal to use.

## Rendering orchestration

`rendering.ts` now provides the executable rendering layer.

It includes:

- an adapter registry keyed by production capability
- strict render-order/dependency validation
- task-by-task artifact passing into later tasks
- retry support
- video-generation -> image-generation fallback where the production plan allows it
- fail-closed behavior when a required renderer is unavailable
- final composed-artifact tracking
- one result per platform render
- a full dry-run registry for testing the entire pipeline without spending provider credits

A failed evidence/UI render cannot be silently ignored. Dependent composition is skipped, so an incomplete video cannot be mistaken for a successful render.

Run the logical renderer validation after generating a batch:

```bash
npm run content:strategist
npm run content:render:dry-run
```

The dry run writes:

`content-ideas/generated/latest-render-dry-run.json`

It validates all five packages across YouTube Shorts, TikTok, and Instagram Reels: **15 platform renders per daily batch**.

## Daily five rules

- Exactly **5** publishable concepts.
- Internal quality floor: **7.5/10**.
- At least **3 of 5** use experimental/interactive formats.
- `productFit` must be at least **9/10**.
- `siteContinuation` must be at least **9/10**.
- Repeated formats, product surfaces, visual worlds, and hardware subjects are penalized.
- Weak batches regenerate stronger presentations instead of lowering the standard.
- Historical performance can move a candidate by at most **±0.8 points**.

## Creative rule

Creativity sits **on top of the product problem**.

Good: "Build Crate picked the PC; you can change one part before we send it to Builder."

Bad: a visually unusual GPU metaphor that has no meaningful reason to lead into SpecSmith.

Every idea still carries creative DNA: visual world, narrative engine, first frame, pattern interrupt, timed retention beats, payoff, audio direction, originality constraint, and anti-slop rules.

## Cross-platform content packages

Every selected idea becomes one coordinated package instead of three copy-pasted social posts. The package includes YouTube Shorts, TikTok, Instagram Reels, the exact SpecSmith continuation, platform CTA, campaign attribution, and required factual inputs.

## Script + storyboard layer

Each platform version becomes a timed storyboard with a hook, viewer commitment, evidence, reversal/tradeoff, payoff, and exact SpecSmith CTA. Facts are attached to the beats that depend on them so later stages can verify claims instead of inventing them.

## Production plan

The production planner routes real product states/evidence to deterministic SpecSmith rendering and creative presentation to generative visual capabilities. It also plans TTS, music/SFX, captions, and motion composition. Generated visuals are not allowed to impersonate real SpecSmith UI.

## Automated quality reviewer

`qualityReviewer.ts` creates one review contract for every platform render and evaluates the finished output before publication.

It checks factual claims/evidence, fake SpecSmith UI, FPS labeling, hook clarity, captions, audio, visual coherence, pacing, SpecSmith relevance, CTA accuracy, generic AI-B-roll ratio, and duration drift.

Hard blockers cannot be averaged away by a good overall score. Reviewer decisions are `pass`, `regenerate-targeted`, `regenerate-full`, or `hold-for-human-review`.

## Data integrity

- Uses canonical local hardware data where available.
- Build Crate concepts require an **actual recorded pull** before publishing.
- Gallery concepts require a real published Gallery build.
- Builder/upgrade concepts require an actual supported result before making compatibility or outcome claims.
- Fresh prices must be re-verified before publication.
- `benchmark_score` is not measured game FPS.
- Estimated FPS must remain explicitly labeled `Estimated FPS`.
- Measured FPS requires real benchmark evidence before publication.
- Unknown/uncleared popular audio is never auto-selected for commercial SpecSmith content.

## Learning loop

`performance.ts` evaluates hook, retention, engagement, and conversion. Raw views do not decide creative quality. Small samples are treated cautiously, and one lucky upload cannot teach the selector to clone one style forever.

## Current boundary

Built now:

- SpecSmith product map + SpecSmith-first concept generation
- creative DNA + five-video quality gate
- cross-platform content packages
- script/storyboard generation
- production capability routing
- trending-audio scoring, rights gating, and platform-specific selection
- executable rendering orchestrator
- retries, dependencies, fallback handling, artifact propagation
- full rendering dry run across all platform variants
- automated AI-review contracts and repair decisions
- performance learner
- tests, typecheck/build checks, and CI workflow

Still later:

- live platform trend-source adapters that automatically populate the audio trend feed
- real provider adapters that produce media bytes for video/image/TTS/audio/composition
- deterministic browser/UI screenshot renderer for live SpecSmith product states
- multimodal observation extraction from finished media
- automatic regeneration execution after reviewer feedback
- publishing adapters/autopost, including platform-native trending-audio attachment
- live analytics collectors
