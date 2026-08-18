# UserBenchmark EFPS extraction

Research-only. This directory documents the EFPS dataset embedded in
**locally saved** UserBenchmark FPS-Estimates game pages. Nothing here fetches,
crawls, follows links, or contacts UserBenchmark.

## Contents

| File | Purpose |
|---|---|
| [`configuration-analysis.md`](configuration-analysis.md) | **The evidence report.** How the EFPS URL and the game-page filter path decode, what is proven, and what is explicitly unresolved. |
| `extract-efps.mjs` | Single-page CLI. Delegates to `../lib/efps.mjs`. |
| `parsed/` | Its per-game output. |

The extraction core lives in [`../lib/efps.mjs`](../lib/efps.mjs) and is shared
by `extract-efps.mjs`, `../ingest.mjs`, `../parse.mjs` and the test suite, so
there is one implementation to keep correct.

## What is extracted

Every embedded object is preserved with its exact `id`, title (`t`) and FPS
(`p`) values, plus the raw URL payload:

```text
{id: 'https://www.userbenchmark.com/EFps/,,,_,,,_PUBG,2060S,3600,', t: 'PUBG 3600 2060S', p: '119'}
```

Records are classified `direct` or `comparison` **from the URL structure**, not
from the title text. A comparison keeps both sides:

```text
{id: '...,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,', t: 'Fortnite 5700-XT vs 1660-Ti - 9400F', p: '137 vs 108'}
  → side 5700-XT = 137, side 1660-Ti = 108, shared CPU 9400F
```

**Malformed records are never silently discarded.** Anything that fails to
parse lands in `rejected` with a reason and its raw source text.

## Workflow

```bash
# One page
node research/userbenchmark/efps/extract-efps.mjs path/to/page.html

# The whole corpus, with normalization, dedup, validation and coverage
node research/userbenchmark/ingest.mjs
```

## Configuration decoding — status update

An earlier version of this README said the extractor "deliberately does not
infer CPU/GPU names or resolution/settings from the URL until that encoding is
independently validated." That validation has since been done, so the position
has changed for some fields and **not** for others:

| Field | Then | Now |
|---|---|---|
| EFPS field 0 | undecoded | **proven: game** |
| EFPS field 1 | undecoded | **proven: GPU** |
| EFPS field 2 | undecoded | **proven: CPU** |
| EFPS field 3 | undecoded | **still unresolved** — never populated on any saved source |
| Resolution / settings | undecoded | **proven absent** — not encoded per observation anywhere |

The GPU/CPU decoding is not asserted from inspection alone. It is confirmed by
a self-consistency check the source itself makes possible: many comparison
sides describe a `(game, GPU, CPU)` configuration that also appears as a
standalone direct record, and those two independently-encoded values must
agree. **338 sides were cross-checkable; 338 agreed exactly; 0 mismatched.**
Full method and worked examples in
[`configuration-analysis.md`](configuration-analysis.md).

Fields that remain unproven are preserved raw and flagged
(`unresolvedFields`, `unresolvedPositions`). They are deliberately **not**
given invented names.

### Resolution and settings are not available per record

Neither the EFPS URL nor the filter path encodes resolution or quality
settings. Those exist only as page-level aggregate charts, which cannot be
joined to an individual observation. An EFPS value is *FPS at an unspecified
mix of resolutions and presets* — attributing one to 1080p, or to High, would
be fabrication.

## Important distinctions

`p` is an explicit FPS value embedded in the page. It must **not** be
reconstructed from Bench %, Value %, the histogram, or sample counts. Bench %
and Value % are UserBenchmark's own composite scores with no published FPS
relationship; the pipeline carries them as their own fields and never converts
them.

These are crowd-sourced, self-reported third-party values. Parsing cleanly
makes a record *structurally validated* and nothing more — it is not verified
benchmark ground truth.

Nothing in this directory creates or updates `src/data/benchmarkRecords.json`.
