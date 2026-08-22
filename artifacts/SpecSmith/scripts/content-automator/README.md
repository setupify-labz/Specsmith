# SpecSmith Content Automator — V1 Strategist

This is the first isolated subsystem of the autonomous video pipeline.
It does **not** render or post videos. Its job is to turn trusted local SpecSmith hardware data into a ranked daily idea batch.

## Goal

Generate many candidate PC-content ideas, score them for retention/usefulness/purchase intent/visual potential/novelty, and select four diverse ideas worth sending to a future script/storyboard agent.

## Run

```bash
npm run content:strategist
```

Output:

`content-ideas/generated/latest-strategy.json`

## Current rules

- Reads canonical `gpus.json` and `cpus.json`; it does not invent hardware.
- Filters stale/invalid rows before idea generation.
- Produces comparison, value, buyer-warning, and build angles.
- Scores every candidate on five explicit dimensions.
- Forces format diversity in the top four so a batch is useful as an experiment.
- Every idea includes `requiredFacts` so later AI stages know what must be verified before scripting.
- Estimated FPS is never represented as measured FPS.

## Deliberate V1 limit

The ranking engine is deterministic. It is the trusted planning layer that a later LLM strategist can expand, critique, and rewrite without being allowed to manufacture factual hardware claims. The next stage should consume this JSON rather than coupling an AI provider directly to the production site.
