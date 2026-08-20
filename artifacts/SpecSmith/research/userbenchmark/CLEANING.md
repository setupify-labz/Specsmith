# UserBenchmark data cleaning

**Research-only.** Nothing in this document or the pipeline it describes feeds
the production benchmark system. `src/data/` and the measured-observation store
are untouched.

    node research/userbenchmark/clean.mjs      # dataset/*.jsonl -> clean/*

---

## Part 1 — What is actually in `dataset/`

Ten JSONL files plus `coverage.json`, produced by `ingest.mjs` from 19 saved
FPS-Estimates pages. Row counts as of this writing:

| File | Rows | What one row is |
|---|---:|---|
| `games.jsonl` | 19 | One captured game page: identity, average FPS, sample count, row/chart counts |
| `gpu-observations.jsonl` | 365 | One GPU in one game's component table |
| `cpu-observations.jsonl` | 365 | One CPU in one game's component table |
| `configurations.jsonl` | 901 | One decoded filter path (`0.0.0.0.0`) seen on a page |
| `efps-comparisons.jsonl` | 519 | One A-vs-B entry from the compare widget |
| `efps.jsonl` | 81 | One direct EFPS datapoint (game + GPU + CPU -> fps) |
| `distributions.jsonl` | 57 | One chart (FPS histogram, settings, or resolution) — 3 per game |
| `rejected-records.jsonl` | 3200 | Records refused at ingest, with the reason |
| `conflicts.jsonl` | 0 | — |
| `duplicates.jsonl` | 0 | — |

### The observation rows (the cleaning target)

Every GPU and CPU row carries the same 30-odd fields. The ones that carry data:

| Field | Type | Meaning | Nulls (gpu / cpu) |
|---|---|---|---:|
| `gameId`, `gameName` | string | Which game's table this row came from | 0 / 0 |
| `componentKind` | `"gpu"` \| `"cpu"` | — | 0 / 0 |
| `componentName` | string | UserBenchmark's own name, e.g. `Nvidia GTX 1050-Ti` | 0 / 0 |
| `componentRatingId` | string | UB's numeric part id, from the row's link | 0 / 0 |
| `componentPageUrl` | string | UB part page | 0 / 0 |
| `samples` | int | User submissions behind this row | 0 / 0 |
| `benchPercent` | int 0–100 | **Composite score. Not FPS.** | 0 / 0 |
| `valuePercent` | int 0–100 | **Price/performance score. Not FPS.** | 104 / 58 |
| `priceUsd` | int | Retail price at capture time | 104 / 58 |
| `priceStore` | string | Retailer, when a live-price link was present | 136 / 92 |
| `gameFilterUrl`, `rawFilterPath`, `filterSegments` | — | The 5-position filter path this row links to |
| `observationKey` | string | Dedupe key |
| `quality` | string | `structurally-validated` on all 730 rows |
| `provenance.*` | — | Source URL, source file, **SHA-256 of the source bytes**, parser version, extraction method, row index |

**The single most important fact about this dataset: it contains no frames per
second.** `benchPercent` is UserBenchmark's composite score for a component
*within that game's sample set*. There is no published conversion to FPS and
none can be derived. The only FPS values anywhere in `dataset/` are
`games.jsonl:averageFps` (one number per game, across all hardware) and
`efps.jsonl:fps` — and the EFPS block is already quarantined by the ownership
rule, since 16 of 19 pages carry CS:GO's dataset rather than their own.

### Distinct hardware in the corpus

- **86 distinct GPU names**, of which 14 carry a mobile marker.
- **110 distinct CPU names**, of which 12 carry a U/H/HQ mobile suffix.

### The finding that determines everything downstream

**The corpus and SpecSmith's catalogs share no hardware at all.**
0 of 86 GPU names and 0 of 110 CPU names correspond to a catalog entry, before
or after normalization.

This is not a normalization failure — it is what the source is. Each game page
lists the hardware *that game's players actually run*, and the captured titles
skew old and low-spec (7 Days to Die, Arma 3, Axiom Verge). The result is a
GTX 10-series and HD-iGPU corpus. SpecSmith's catalogs are RTX 30/40/50 and
Ryzen 3000+ / Intel 12th–14th gen. The two sets simply do not overlap.

So the honest output of a matcher over this data is *zero matches*, and the
pipeline below is built to report that rather than to manufacture coverage.

### Rejections already applied upstream

All 3200 rejected records share one reason: `efps-game-token-mismatch` — the
EFPS ownership quarantine. Those are the borrowed CS:GO datapoints, refused at
ingest rather than attributed to the wrong game.

---

## Part 2 — The cleaning pipeline

### What "cleaned" means here

Not "corrected". Nothing is repaired, defaulted, or inferred. A cleaned row is
a raw row with **resolution metadata attached**: which catalog id it maps to
(if any), what form factor it is, what is wrong with it, and what its numbers
actually mean. Rows the pipeline cannot settle go to a review queue.

Raw data is opened read-only. `test/clean.test.mjs` runs the whole pipeline in
a child process and asserts the observation files are byte-identical either
side of it; `test/canonical.test.mjs` asserts `clean.mjs` is not a writer of
`dataset/`.

### Hardware resolution (`lib/hardware-normalize.mjs`)

**Form factor is a hard boundary.** A laptop RTX 3060 is a different physical
part from a desktop RTX 3060 — lower power limit, lower clocks, often 6 GB
against 12. UserBenchmark distinguishes them only by a `(Mobile)` suffix or an
Intel U/H/HQ CPU suffix. A laptop or integrated part is classified, separated,
and left unmatched **at any confidence**, even when its desktop sibling is
sitting in the catalog.

**Exact first, and fuzzy is a spelling tolerance rather than a search.** A
"fuzzy" match is only ever one of three formatting variants — a trailing VRAM
designator, `Super`/`S` either way — resolving to *exactly one* catalog entry.
If a variant reaches two entries, the row is unmatched and both candidates are
reported.

There is deliberately **no edit-distance scoring**. "RTX 4070" and "RTX 4070 Ti"
are one character apart and are different cards; distance is the wrong tool for
this domain. An unmatched component is reported as unmatched, because a wrong
hardware id is worse than no id — it silently attributes one part's numbers to
another and nothing downstream can detect it afterwards.

### Row inspection (`lib/clean-observations.mjs`)

Structural checks that flag and never repair: missing required fields;
non-finite scores; scores outside 0–100; non-integer or negative sample counts;
non-positive prices. An **absent** score is not a defect — UserBenchmark renders
`-` for rows it has no score for, which is a source gap, so it passes.

### Duplicates

- **Exact** — same `(game, kind, component)` and identical values on every
  compared field. Safe to collapse; the redundant copies are listed in the
  duplicates report and dropped from the cleaned set.
- **Suspicious** — same key, *different* values. **Never collapsed.** Two
  different answers to the same question means one is wrong, and picking either
  would be a guess. Both rows go to review with the conflicting value sets
  attached.

### Outliers

Grouped **per game**, because a composite score is only meaningful relative to
the other components measured on the same page — comparing across games would
manufacture outliers that do not exist. Uses median and median-absolute-
deviation rather than mean and standard deviation, since the mean is dragged by
the very values being looked for. Modified z-score above 3.5 is a **reporting**
trigger and never a deletion: an unusual value may simply be unusual.

### Outputs (`clean/`)

| File | Contents |
|---|---|
| `cleaned-observations.jsonl` | Every retained row, with resolution metadata, verbatim `source` values, metric definitions, and flags |
| `review-queue.jsonl` | Every row carrying at least one flag, with human-readable reasons |
| `outliers.jsonl` | Outlier findings — reported separately, never removed |
| `gpu-duplicates.jsonl`, `cpu-duplicates.jsonl` | Exact and suspicious duplicate groups |
| `summary.json`, `summary.md` | The counts below |

Every cleaned record carries `metricDefinitions` and a `notFpsWarning`, so a
later reader cannot mistake a composite score for a frame rate. A test asserts
no field anywhere in a cleaned record is named after FPS.

---

## Part 3 — Results of the current run

| Metric | Count | Share of raw |
|---|---:|---:|
| Total raw rows | 730 | 100% |
| Cleaned rows | 730 | 100.0% |
| Exact matches | 0 | 0.0% |
| Fuzzy matches (high confidence only) | 0 | 0.0% |
| Unmatched rows | 619 | 84.8% |
| Blocked on form factor (laptop / integrated) | 111 | 15.2% |
| Exact duplicates collapsed | 0 | 0.0% |
| Suspicious duplicate groups | 0 | — |
| Outliers reported | 20 | 2.7% |
| Rows needing review | 730 | 100.0% |

| Kind | Raw | Exact | Fuzzy | Unmatched | Form-factor blocked | Review |
|---|---:|---:|---:|---:|---:|---:|
| gpu | 365 | 0 | 0 | 296 | 69 | 365 |
| cpu | 365 | 0 | 0 | 323 | 42 | 365 |

**Zero matches is the correct result, not a pipeline failure.** It follows
directly from the corpus/catalog finding in Part 1. A matcher that produced
coverage here would be inventing it.

Every row lands in review for the same single reason — the hardware could not
be resolved. No row failed a structural check: the ingest-stage validation
rules have already ensured that. The 20 outliers are top-end cards on
low-sample pages, where the per-game median sits at 2 and a GTX 1080 scores 43;
they are reported, not removed.

## What this data can and cannot support

**Can:** which hardware appears in which game's player base; relative
UserBenchmark standing of parts within one game; sample-count weighting;
price snapshots at capture time.

**Cannot:** any statement about frames per second for a component in a game.
That requires measurement, which is what the separate measured-observation
pipeline exists to produce.
