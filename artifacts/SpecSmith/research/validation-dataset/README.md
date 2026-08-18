# Verified-Benchmark Validation Dataset

> **Research-only tooling. Not wired into production.** This directory
> reads `src/data/benchmarkRecords.json` (and the Estimator's catalog
> files) but never writes to them, and nothing in `src/` imports anything
> from here. No estimator has been built yet — this is dataset
> construction and coverage analysis only, in preparation for future
> estimator-accuracy testing against real measured data.

## What this is

SpecSmith's Verified Benchmarks system (`src/lib/benchmarks/`) stores real,
cited FPS measurements — the opposite of the Estimator's formula-based
guesses. Eventually it would be useful to check how close the Estimator's
predictions come to these real numbers. To do that honestly, you need a
**held-out** set of real records the estimator-tuning process never saw —
otherwise "validation" just measures how well a model memorized its own
training data.

This tooling builds that split now, from the 23 records that currently
exist, so it's ready whenever estimator work starts.

## Why "select a diverse sample" became "use the full corpus"

The originating request asked for a diverse *sample*. With only 23
verified records in existence, down-sampling further would only shrink
coverage — it can't increase diversity, and it would actively work against
the goal of surfacing coverage gaps honestly. So the "sample" here is the
full corpus, stratified by game for the split (below) rather than a
subset. If the record count grows substantially, revisit this — at that
point a genuine diversity-maximizing subsample (e.g. greedy coverage over
game × GPU × resolution × preset × RT × upscaler) becomes worth building
separately from the calibration/holdout split.

## Files

- **`build-dataset.mjs`** — the generator. Read-only against `src/data/`;
  writes only within this directory. Run it with:
  ```
  node research/validation-dataset/build-dataset.mjs
  ```
- **`dataset.json`** *(generated)* — every current verified record,
  annotated with a flattened stratification signature (game/GPU/CPU/
  resolution/preset/RT/upscaler/frameGeneration/percentile-field presence)
  and its `calibration` or `holdout` assignment.
- **`coverage-report.md`** *(generated)* — the human-readable report:
  usable-observation counts, the calibration/holdout split per game,
  coverage by dimension, and the ranked list of coverage gaps.

Both generated files are checked in so the split is stable and reviewable
without re-running the script — but they're fully reproducible; regenerate
either any time `benchmarkRecords.json` changes.

## Split methodology

Default (`--strategy=deterministic`): for each game, sort its records by
`id` and hold out `floor(n/2)` (minimum 1) — the *last* records in sort
order — keeping the rest for calibration. This guarantees every game with
2+ records contributes to both sides, which matters enormously at n=23:
a naive random split can easily strand an entire game on one side by
chance. A game with exactly 1 record can't be split at all; it stays
calibration-only and is flagged in the report as a "stranded singleton."
As of the current dataset, every one of the 11 verified games has 2+
records, so there are no stranded singletons yet — but the tooling handles
the case for when there are.

An alternate seeded-random mode also exists for when the record count is
large enough that a stratified random split stops being fragile:
```
node research/validation-dataset/build-dataset.mjs --strategy=random --seed=1 --holdout-fraction=0.35
```

## Extension: collection-plan.mjs

Built on top of the same coverage analysis, `collection-plan.mjs` turns
`coverage-report.md`'s gap list into a concrete, prioritized list of the
next 50 benchmark *targets* to go find real sources for — not measured
data. Run it with:
```
node research/validation-dataset/collection-plan.mjs
```
It writes `collection-matrix.json` (machine-readable) and
`collection-plan.md` (the research plan). See that file for the full
rationale; in short, every target changes exactly one dimension away from
an existing verified record (resolution, GPU, CPU, upscaler, or RT) so
whatever number eventually gets collected has a direct, apples-to-apples
comparison already in the dataset. No FPS values are invented — every
target row is unmeasured by design, and the script validates every
game/GPU/CPU id it references against the real catalogs before writing
anything.

## Current numbers (see `coverage-report.md` for the full breakdown)

- 23 total records, all usable for average-FPS validation; 10 of 23 also
  carry a confirmed `onePercentLow` (usable for low-percentile validation);
  none carry `zeroPointOnePercentLow` yet.
- Split: 12 calibration / 11 holdout, every game represented on both sides.
- Biggest gaps: no 4K records, only 2 CPUs and 3 GPUs ever benchmarked
  (out of the Estimator's 57 GPUs / 51 CPUs), no FSR or XeSS records, no
  Low/Medium preset records, and no game has both an RT-on and RT-off
  record (so RT's isolated FPS cost is unmeasurable from this data alone).

## Explicitly out of scope here

No estimator, formula, or scoring model was built or modified. No
production file was touched — `src/`, `package.json`, and every file the
app ships are unchanged. This is dataset + tooling + a coverage report
only.
