# SpecSmith Content Automator — Creative + Logical V1

This isolated subsystem turns SpecSmith product surfaces and trusted hardware data into a daily batch of **five high-tier content plans**, then carries those ideas through platform packaging, script/storyboard planning, production planning, and automated quality-review contracts. It does **not** render or post videos yet.

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

Examples now come from product actions such as build challenges, build rescue, blind comparisons, one-upgrade decisions, real Build Crate pulls, Gallery inspections, budget ladders, and Price Guesser rounds.

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

Every selected idea becomes one coordinated package instead of three copy-pasted social posts.

The package includes:

- YouTube Shorts version
- TikTok version
- Instagram Reels version
- exact SpecSmith site continuation
- platform CTA
- campaign id and attribution metadata
- required factual inputs

The core decision stays the same, while each platform gets a different presentation objective.

## Script + storyboard layer

Each platform version becomes a timed storyboard with:

- hook
- viewer commitment/choice
- evidence
- reversal/tradeoff
- payoff
- exact SpecSmith CTA

Facts are attached to the beats that depend on them so later stages can verify claims instead of inventing them.

## Production plan

The production planner decides what capability each part needs:

- deterministic SpecSmith UI rendering for real product states/evidence
- generative video or image visuals for creative presentation
- text-to-speech
- music/SFX
- captions
- motion composition

Generated visuals are not allowed to impersonate real SpecSmith UI. Product evidence should come from real or deterministic SpecSmith state.

## Automated quality reviewer

`qualityReviewer.ts` creates one review contract for every platform render and evaluates the finished output before publication.

It checks:

- factual claims and evidence
- fake/generated SpecSmith UI
- measured FPS vs estimated FPS labeling
- first-two-second hook clarity
- caption legibility and safe areas
- narration/audio clarity
- visual coherence
- pacing
- SpecSmith relevance
- CTA route accuracy
- generic AI-B-roll/slop ratio
- duration drift

Hard blockers cannot be averaged away by a good overall score. A video with false facts, fake product UI, a wrong CTA, or dangerous FPS labeling cannot publish just because its visuals scored highly.

Reviewer decisions are:

- `pass`
- `regenerate-targeted`
- `regenerate-full`
- `hold-for-human-review`

Uncertain facts are held for review instead of guessed. Repairable problems can target only the affected production tasks instead of remaking a strong video from scratch.

## Data integrity

- Uses canonical local hardware data where available.
- Build Crate concepts require an **actual recorded pull** before publishing; no scripted fake legendary result.
- Gallery concepts require a real published Gallery build.
- Builder/upgrade concepts require an actual supported result before making compatibility or outcome claims.
- Fresh prices must be re-verified before publication.
- `benchmark_score` is not measured game FPS.
- Estimated FPS must remain explicitly labeled `Estimated FPS`.
- Measured FPS requires real benchmark evidence before publication.

## Learning loop

`performance.ts` evaluates:

1. Hook — did people stop instead of swipe?
2. Retention — did they stay through the payoff?
3. Engagement — did they share, save, comment, or follow?
4. Conversion — did they continue into SpecSmith and deeper product actions?

Raw views do not decide creative quality. Small samples are treated cautiously, and one lucky upload cannot teach the selector to clone one style forever.

Each selected video has a hypothesis, primary metric, controls, and an exact SpecSmith continuation route.

## Run

```bash
npm run content:strategist
```

Output:

`content-ideas/generated/latest-strategy.json`

The generated strategy now includes the daily five, cross-platform content packages, script/storyboards, production plans, and one quality-review contract per platform version.

## Current boundary

Built now:

- SpecSmith product map
- SpecSmith-first concept generation
- creative DNA
- five-video quality gate
- product-fit/site-continuation gates
- cross-platform content packages
- script/storyboard generation
- production capability routing and render plans
- automated quality-review contracts
- automated reviewer decisions and targeted regeneration instructions
- performance learner
- tests and CI workflow

Still later:

- actual video/image/UI rendering adapters
- multimodal observation extraction from finished renders
- automatic regeneration execution
- publishing adapters/autopost
- live analytics collectors
