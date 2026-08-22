# SpecSmith Content Automator — V1 Creative Strategist

This is the first isolated subsystem of the autonomous video pipeline.
It does **not** render or post videos. Its job is to turn trusted local SpecSmith hardware data into a ranked daily idea batch with enough creative direction that the later video system is not starting from generic tech-content prompts.

## Goal

Generate many candidate PC-content ideas, aggressively mutate them away from normal review/listicle grammar, score them for retention/usefulness/purchase intent/visual potential/novelty/originality/shareability, and select four visually distinct ideas worth sending to a future script/storyboard agent.

The standard is not "AI made a video." The standard is: the concept should have a visual mechanic and story structure that would still be interesting with the sound off.

## Run

```bash
npm run content:strategist
```

Output:

`content-ideas/generated/latest-strategy.json`

## Creative DNA

Every candidate now carries a `creativeDNA` package:

- a named visual world
- a narrative engine
- a first-frame opening image
- a pattern interrupt
- five timed retention beats
- a payoff rule
- audio direction
- an originality constraint
- anti-slop rejection rules

Current visual worlds include concepts such as Silicon Gravity Well, Neon Evidence Lab, Performance Boss Fight, PC Part Stock Exchange, Budget Heist Board, Hardware Courtroom, Blind Draft Arena, Upgrade Time Loop, Silicon X-Ray, Price-Tag Physics, Spec Roulette, and Impossible Museum.

These are not cosmetic skins. The rule is that the visual mechanic must be tied to the real hardware data. If the idea could be replaced by generic RGB stock footage plus captions, the later creative agent should reject it.

## Wildcard formats

In addition to ordinary buyer/comparison ideas, the strategist deliberately creates stranger formats such as:

- visual stories where price becomes physical gravity
- blind GPU drafts where brand/name stays hidden until the viewer chooses
- game-like simulations where the visualization rules are explicitly shown
- budget-heist stories driven by real price gaps

The purpose is to create concepts with genuine viewer participation, prediction, reversal, and payoff rather than simply making prettier specification cards.

## Data and integrity rules

- Reads canonical `gpus.json` and `cpus.json`; it does not invent hardware.
- Filters stale/invalid rows before idea generation.
- Every idea includes `requiredFacts` so later AI stages know what must be verified before scripting.
- `benchmark_score` is never represented as measured game FPS.
- Estimated FPS must remain explicitly labeled estimated if a later stage uses it.
- The creative layer is allowed to invent metaphors, worlds, editing mechanics, and narrative structures. It is not allowed to invent factual product claims.

## Batch rules

Four daily videos should feel like four separate inventions, not one template with four different SKUs. Selection therefore tries to diversify both content format and visual world.

## Deliberate V1 limit

The current creative strategist is deterministic. That is useful for testing, reproducibility, and keeping factual inputs controlled, but deterministic mutation alone will not make this the best autonomous video system.

The next creative stage should use a strong language/reasoning model to generate and attack much larger concept sets while treating this strategist output as grounded source material. The model should be provider-agnostic so SpecSmith can benchmark multiple creative models rather than locking the system to one vendor.

Originality cannot be guaranteed by a prompt or score. It has to be tested against real outputs and audience behavior. The system therefore treats "originality" as a rejection constraint and experimental objective, not a marketing claim.
