# UserBenchmark EFPS — research notes

Research-only. This directory holds the **evidence and findings** for how
UserBenchmark's embedded EFPS dataset is structured. It contains no code.

Nothing in this project fetches, crawls, follows links, or contacts
UserBenchmark. Everything is derived from page sources a human already saved to
`../pages/`.

## Contents

| File | Purpose |
|---|---|
| [`configuration-analysis.md`](configuration-analysis.md) | The evidence report: how the EFPS URL and the game-page filter path decode, what is proven, what is explicitly unresolved, and how the decoding was independently verified. |

## Where the code lives

There is **one** EFPS implementation:
[`../lib/efps.mjs`](../lib/efps.mjs). It is used by
[`../ingest.mjs`](../ingest.mjs) (corpus pipeline),
[`../parse.mjs`](../parse.mjs) (single page) and the test suite.

```bash
# Whole corpus: parse → EFPS → normalize → dedupe → validate → datasets
node research/userbenchmark/ingest.mjs

# One page
node research/userbenchmark/parse.mjs [filename]
```

An earlier `efps/extract-efps.mjs` CLI and its `efps/parsed/` output tree were
removed during reconciliation: it was a second entry point writing a third copy
of records that `../parsed/` and `../dataset/` already carry. Its history is in
git. See the root [`README.md`](../README.md#reconciliation-record) for what
happened and why.

## What is extracted

Every embedded object is preserved with its exact `id`, title (`t`) and FPS
(`p`) value, plus the raw URL payload:

```text
{id: 'https://www.userbenchmark.com/EFps/,,,_,,,_PUBG,2060S,3600,', t: 'PUBG 3600 2060S', p: '119'}
```

Records are classified `direct` or `comparison` **from the URL structure**, not
from the title text. A comparison keeps both sides rather than being split into
two standalone records:

```text
{id: '...,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,', t: 'Fortnite 5700-XT vs 1660-Ti - 9400F', p: '137 vs 108'}
  → side 5700-XT = 137, side 1660-Ti = 108, shared CPU 9400F
```

**Malformed records are never silently discarded.** Anything that fails to
parse lands in `../dataset/rejected-records.jsonl` with a reason and its raw
source text.

## Configuration decoding — current status

| Field | Status |
|---|---|
| EFPS field 0 | **proven: game** |
| EFPS field 1 | **proven: GPU** |
| EFPS field 2 | **proven: CPU** |
| EFPS field 3 | **unresolved** — never populated on any saved source |
| Filter path positions 0 / 1 / 4 | **proven:** gpuId / cpuId / cpuFamilyFilter |
| Filter path positions 2, 3 | **unresolved** — never populated |
| Resolution / settings | **proven absent** — not encoded per observation anywhere |

The GPU/CPU decoding is not asserted from inspection alone. It is confirmed by
a self-consistency check the source itself makes possible: many comparison
sides describe a `(game, GPU, CPU)` configuration that also appears as a
standalone direct record, and those two independently-encoded values must
agree. **338 sides were cross-checkable; 338 agreed exactly; 0 mismatched.**
Method and worked examples in
[`configuration-analysis.md`](configuration-analysis.md).

Fields that remain unproven are preserved raw and flagged
(`unresolvedFields`, `unresolvedPositions`). They are deliberately **not** given
invented names.

### Resolution and settings are not available per record

Neither the EFPS URL nor the filter path encodes resolution or quality
settings. Those exist only as page-level aggregate charts, which cannot be
joined to an individual observation. An EFPS value is *FPS at an unspecified
mix of resolutions and presets* — attributing one to 1080p, or to High, would be
fabrication.

## Important distinctions

`p` is an explicit FPS value embedded in the page. It must **not** be
reconstructed from Bench %, Value %, the histogram, or sample counts. Bench %
and Value % are UserBenchmark's own composite scores with no published FPS
relationship; the pipeline carries them as their own fields and never converts
them.

These are crowd-sourced, self-reported third-party values. Parsing cleanly
makes a record *structurally validated* and nothing more — it is not verified
benchmark ground truth.

Nothing in this project creates or updates `src/data/benchmarkRecords.json`.
