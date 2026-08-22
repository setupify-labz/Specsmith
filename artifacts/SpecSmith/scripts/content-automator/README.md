# SpecSmith Content Automator — Creative + Logical V1

This is the first isolated subsystem of the autonomous video pipeline. It does **not** render or post videos yet. Its job is to turn trusted local SpecSmith hardware data into a daily batch of **five high-tier video plans** and learn from historical performance without collapsing into repetitive winner-cloning.

## Goal

Generate many candidate PC-content ideas, aggressively mutate them away from normal review/listicle grammar, reject weak concepts, select five diverse high-retention experiments, and use normalized audience behavior to improve future batches.

The standard is not "AI made a video." The standard is: the concept should have a visual mechanic and story structure that would still be interesting with the sound off, remain factually grounded, and teach the system something measurable after it is published.

## Run

```bash
npm run content:strategist
```

Output:

`content-ideas/generated/latest-strategy.json`

If `content-ideas/generated/performance-history.json` exists, the run automatically analyzes it and applies a bounded historical-learning adjustment. If it does not exist, the batch stays exploration-first.

## Daily five rules

- Exactly **5** publishable concepts.
- Internal creative quality floor: **7.5/10**.
- At least **3 of 5** must use radical formats such as experiments, visual stories, games, or simulations.
- Repeated formats, visual worlds, and hardware subjects are penalized during selection.
- Weak batches fail closed: if five concepts do not clear the quality gate, the system throws instead of silently lowering the standard.
- Historical performance can move a candidate by at most **±0.8 points**, so one previously successful format cannot take over the entire feed.

## Creative DNA

Every candidate carries a `creativeDNA` package:

- named visual world
- narrative engine
- first-frame opening image
- pattern interrupt
- five timed retention beats
- payoff rule
- audio direction
- originality constraint
- anti-slop rejection rules

Current worlds include Silicon Gravity Well, Neon Evidence Lab, Performance Boss Fight, PC Part Stock Exchange, Budget Heist Board, Hardware Courtroom, Blind Draft Arena, Upgrade Time Loop, Silicon X-Ray, Price-Tag Physics, Spec Roulette, and Impossible Museum.

These are not cosmetic skins. The visual mechanic must be tied to real hardware data. If an idea can be replaced by generic RGB B-roll plus captions, the later creative agent should reject it.

## Logical learner

`performance.ts` converts raw platform metrics into four separate quality questions:

1. **Hook** — did people stop instead of swipe?
2. **Retention** — did they stay through the story and payoff?
3. **Engagement** — did they share, save, comment, or follow?
4. **Conversion** — did the video send people into SpecSmith and deeper product actions?

Raw view count is deliberately excluded from the quality score. Views are used for confidence because distribution is not the same thing as creative quality.

The learner groups results by:

- format
- visual world
- narrative engine
- hook family

A factor needs at least three examples before it can be promoted or retired. Small samples are shrunk toward the overall baseline so one lucky upload does not teach the system a fake lesson.

See `ANALYTICS.md` for the data contract and collection plan.

## Experiment design

Every selected video includes a hypothesis, primary metric, and controls. Five daily uploads should be five useful experiments, not five random videos.

Examples:

- blind-choice game -> optimize hook/stayed-to-watch
- visual metaphor -> optimize retention
- buyer warning/comparison -> optimize attributed site clicks
- strange narrative experiment -> optimize shares

As data accumulates, tomorrow's selector receives evidence from yesterday while preserving exploration.

## Data and integrity rules

- Reads canonical `gpus.json` and `cpus.json`; it does not invent hardware.
- Filters stale/invalid rows before idea generation.
- Every idea includes `requiredFacts` so later AI stages know what must be verified before scripting.
- `benchmark_score` is never represented as measured game FPS.
- Estimated FPS must remain explicitly labeled estimated if a later stage uses it.
- Unsupported analytics fields remain absent; they are never guessed to make cross-platform rows look complete.
- The creative layer may invent metaphors, worlds, editing mechanics, and narrative structures. It may not invent factual product claims.

## Current boundary

This branch now has the **creative strategist + five-video quality gate + performance learner**. It still needs the later production stages: AI creative expansion, script/storyboard, asset generation, video-model routing, rendering, automated visual critique, publishing adapters, and live analytics collectors.

The branch also has an isolated GitHub Actions workflow that runs the content-automator tests, SpecSmith typecheck, and a real five-video generation pass before this work is treated as ready.

Originality cannot be guaranteed by a prompt or score. It has to survive real audience behavior. The architecture is therefore built to generate unusual concepts, measure them, learn cautiously, and keep experimenting rather than converging into repetitive AI slop.
