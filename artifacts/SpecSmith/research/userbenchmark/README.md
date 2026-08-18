# UserBenchmark Research Ingestion Pipeline

> ## ⚠️ RESEARCH-ONLY — READ THIS FIRST
>
> **There is no network code anywhere in this directory tree.** Nothing here
> fetches, crawls, or requests anything from userbenchmark.com or any other
> host. Every tool reads files a human already saved to disk.
>
> **Nothing here is a verified benchmark record.** The data extracted by this
> pipeline is *crowd-sourced, self-reported* values published by a third-party
> aggregator. Parsing cleanly proves the extraction worked — it proves nothing
> about the numbers. See [Data quality classification](#data-quality-classification).
>
> **Nothing here is wired into production.** `src/`, `package.json`, and
> `src/data/benchmarkRecords.json` are untouched and must stay that way. No
> record produced here may be added to `benchmarkRecords.json` without going
> through that schema's own provenance rules independently
> (`src/lib/benchmarks/README_evidence-quality.md`).

---

## Current state

| | |
|---|---|
| Known games in catalog | **316** |
| Pages captured | **3** — Fortnite (3954), PUBG (3944), CS:GO (3680) |
| Pages parsed | 3, with **0 warnings** |
| EFPS records extracted | 600 (81 direct, 519 comparisons), 0 rejected |
| GPU / CPU observations | 60 / 60 |
| EFPS cross-validation | **1,014 / 1,014 sides agree, 0 mismatches** |
| Validation | 0 errors, 1 warning (the capture gap) |
| Tests | 176 passing |

**The binding constraint is capture, not code.** The machine is finished; it is
waiting on saved pages. 313 of 316 games have no source. See
[Capture workflow](#capture-workflow).

The decoding is now confirmed across three games parsed by identical code — see
[Configuration decoding status](#configuration-decoding-status).

---

## Commands

```bash
# Full corpus pipeline — the main entry point.
# discover → parse → EFPS → normalize → dedupe → validate → datasets → coverage
node research/userbenchmark/ingest.mjs

# Test suite (176 tests, zero dependencies)
node research/userbenchmark/test/run-tests.mjs

# Single-page parse only (writes parsed/<slug>.json)
node research/userbenchmark/parse.mjs [filename]

# Rebuild the merged game catalog from all parsed sources
node research/userbenchmark/build-known-games.mjs
```

`ingest.mjs` exits non-zero **only** on validation *errors* (tooling faults).
Warnings — including "313 games not captured" — are ordinary data findings and
do not fail the run.

---

## Architecture

```
research/userbenchmark/
├── lib/                      shared extraction core (pure, no I/O, no network)
│   ├── version.mjs           parser/extractor version constants
│   ├── html.mjs              entity decoding, number parsing, filter-path decoder
│   ├── efps.mjs              EFPS object extraction + classification
│   ├── game-page.mjs         full game-page extraction (uses efps.mjs)
│   ├── normalize.mjs         parsed page → flat records + provenance
│   ├── dedupe.mjs            deterministic dedup + conflict detection
│   ├── validate.mjs          validation rules, error vs warning severity
│   └── capture.mjs           capture-status tracking across the catalog
├── ingest.mjs                ⇦ the one command
├── parse.mjs                 single-page entry point (thin wrapper over lib/)
├── build-known-games.mjs     catalog consolidator
├── extract-game-catalog.mjs  JS-bundle catalog scanner
├── pages/                    ⇦ SAVED PAGE SOURCES GO HERE
├── parsed/                   per-page raw extraction JSON
├── dataset/                  normalized JSONL datasets + coverage + validation
├── efps/
│   └── configuration-analysis.md   ⇦ the URL-decoding evidence report
├── homepage/                 search/hub page parser (separate page type)
├── test/                     176 tests + fixtures
├── capture-manifest.json     per-game capture status (all 316)
├── coverage-report.md        generated coverage breakdown
└── known-games.json          the 316-game catalog
```

One extraction implementation lives in `lib/`; `parse.mjs`, `ingest.mjs` and
the tests all share it, so there is exactly one place to keep correct.

---

## Capture workflow

### Why there is no fetcher

Automatic page acquisition is **deliberately not implemented**:

1. **It isn't reachable.** userbenchmark.com is blocked by this environment's
   egress proxy (`HTTP 403` on the CONNECT tunnel). Nothing here could fetch it.
2. **It wouldn't be appropriate.** Walking a 316-URL catalog on an aggregator's
   own site is bulk collection of their proprietary aggregated database,
   regardless of rate limiting or robots handling. Out of scope by the
   project's rules, and not something this tooling should be built around.

So the capture side is a **manifest**, not a crawler. It turns the missing-source
problem from manual bookkeeping into a mechanical checklist.

### Adding a saved page

1. Open the game's FPS-Estimates page in a browser. `capture-manifest.json`
   has the exact URL for every one of the 316 games.
2. Save the full page source (Ctrl+U → Ctrl+S, or "Save Page As → HTML only").
3. Drop it in `pages/`, named `FPS-Estimates-<Slug>-<gameId>.html`.
   `capture-manifest.json` states the exact expected filename per game — using
   it lets the manifest match the file to its game even if parsing later fails.
4. Run `node research/userbenchmark/ingest.mjs`.

That's the whole loop. Everything downstream is automatic and batch-capable —
adding 50 pages and re-running works exactly the same as adding one.

### Capture status tracking

`capture-manifest.json` carries one row per known game:

```json
{
  "gameId": "3954", "name": "Fortnite",
  "url": "https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0",
  "captured": true, "sourceFile": "FPS-Estimates-Fortnite-3954.html",
  "expectedFilename": "FPS-Estimates-Fortnite-3954.html",
  "parsed": true, "efpsCount": 200, "efpsDirectCount": 27,
  "gpuRowCount": 20, "cpuRowCount": 20,
  "warnings": [], "lastProcessedAt": "..."
}
```

**`captured` is true only when a real file exists.** It is never inferred. A
saved-but-unparseable file shows `captured: true, parsed: false` so a broken
save is visible rather than looking like a missing page. Filename matching is
strict (`FPS-Estimates-<slug>-<id>`) precisely so an unrelated file such as
`notes-2024.html` can never be read as evidence that game 2024 was captured.

---

## What gets extracted

### Per game page (`parsed/<slug>.json`)

- **`game`** — id, name, slug, canonical URL, raw filter path + components
- **`sampleSummary`** — average FPS, total samples
- **`fpsHistogram`** — labels, data, and the raw array text
- **`settingsDistribution`** — the source's exact labels (`Low`/`Med`/`High`/`Max`), values, raw arrays
- **`resolutionDistribution`** — exact labels (`720p`/`1080p`/`1440p`/`4K`), values, raw arrays
- **`gpuTable` / `cpuTable`** — per row: name, game-specific sample count,
  Bench %, Value %, game filter URL + parsed segments, dedicated component page
  URL, rating id, and price/store/URL when present. Rows are classified GPU vs
  CPU by which domain their bench link points at, not by table position.
- **`brandFilterUrls`** — the CPU-family quick filters
- **`ownFilterPaths`** — every distinct filter path the page links to for itself
- **`relatedGamePages`** — other games linked from the page. **Discovered, not
  fetched** — URLs recorded for a human to decide about.
- **`efps`** — stats, records, and rejected objects (below)
- **`_meta.warnings`** — anything expected but not found. Empty means clean.

### EFPS schema

A direct record:

```json
{
  "recordType": "efps-direct",
  "gameId": "3954", "gameName": "Fortnite", "efpsGameToken": "Fortnite",
  "exactTitle": "Fortnite 3600 2060S", "exactValue": "131", "fps": 131,
  "gpu": "2060S", "cpu": "3600",
  "efpsUrl": "https://www.userbenchmark.com/EFps/,,,_,,,_Fortnite,2060S,3600,",
  "rawUrlPayload": ",,,_,,,_Fortnite,2060S,3600,",
  "configurationStatus": "configuration-decoded",
  "unresolvedFields": [], "quality": "structurally-validated",
  "observationKey": "3954efps-direct2060s3600",
  "provenance": { "source": "UserBenchmark", "sourceFile": "...", "sourceContentSha256": "...", "parserVersion": "...", "extractionMethod": "efps:direct", "rawSourceIdentifier": "efps[0]" }
}
```

A comparison record keeps **both sides** and is never split into two direct
records — doing so would manufacture standalone observations the source didn't
publish:

```json
{
  "recordType": "efps-comparison",
  "exactTitle": "Fortnite 5700-XT vs 1660-Ti - 9400F", "exactValue": "137 vs 108",
  "sides": [
    { "label": "5700-XT", "fps": 137, "gpu": "5700-XT", "cpu": "9400F", "resolvedVariant": "B", "variantResolvedByTokenMatch": true },
    { "label": "1660-Ti", "fps": 108, "gpu": "1660-Ti", "cpu": "9400F", "resolvedVariant": "A", "variantResolvedByTokenMatch": true }
  ],
  "sharedConfig": { "game": "Fortnite", "gpu": null, "cpu": "9400F", "sharedLabel": "9400F" },
  "variantA": { "gpu": "1660-Ti", ... }, "variantB": { "gpu": "5700-XT", ... }
}
```

**Malformed records are never silently dropped.** Each lands in
`dataset/rejected-records.jsonl` with a reason and its raw source text.

---

## Configuration decoding status

Full evidence: [`efps/configuration-analysis.md`](efps/configuration-analysis.md).

**Partially proven.**

| Field | Status |
|---|---|
| EFPS field 0 = game | **proven** |
| EFPS field 1 = GPU | **proven** |
| EFPS field 2 = CPU | **proven** |
| EFPS field 3 | **unresolved** — never populated on any saved source |
| Filter path position 0 = GPU id | **proven** |
| Filter path position 1 = CPU id | **proven** |
| Filter path position 4 = CPU family | **proven** |
| Filter path positions 2, 3 | **unresolved** — never populated |

Two findings worth knowing before using this data:

1. **No resolution or settings dimension exists per observation.** Neither the
   EFPS URL nor the filter path encodes them. They appear only as page-level
   aggregate charts, which cannot be joined to an individual `(GPU, CPU, FPS)`
   record. An EFPS value is *FPS at an unspecified mix of resolutions and
   presets* — attributing it to 1080p or to High would be fabrication.

2. **Title order does not match URL group order** (measured: wrong on 47.4% of
   comparisons). The extractor pairs label-to-FPS positionally within
   `title`/`value` — which *is* reliable — then resolves the URL group by token
   match, never by position.

The decoding is independently confirmed: **1,014 comparison sides were
cross-checked against the standalone direct record for the same
`(game, GPU, CPU)`; 1,014 agreed exactly, 0 mismatched**, across all three
captured games. This check runs on every ingest and as a test.

Two of the three EFPS game tokens are **not** the catalog name — `PUBG` for
"PlayerUnknown's Battlegrounds" and `CSGO` for "Counter-Strike: Global
Offensive". That is direct evidence for classifying structurally: a
`gameName + " "` prefix matcher would have matched one game in three.

Undocumented fields are preserved raw as `position2`/`position3`/`field3` and
listed in `unresolvedPositions`/`unresolvedFields`. They are deliberately **not**
named `resolutionFilter`/`settingsFilter` — an earlier version of the parser did
that, and it was an invented meaning with no supporting evidence.

---

## Dataset outputs (`dataset/`)

| File | Contents |
|---|---|
| `games.jsonl` | One record per game page |
| `efps.jsonl` | Direct EFPS observations |
| `efps-comparisons.jsonl` | Comparison EFPS records, both sides preserved |
| `cpu-observations.jsonl` | CPU table rows |
| `gpu-observations.jsonl` | GPU table rows |
| `configurations.jsonl` | Every distinct filter-path configuration |
| `distributions.jsonl` | FPS histogram, settings, resolution charts |
| `conflicts.jsonl` | Same key, different values — **never collapsed** |
| `duplicates.jsonl` | Same key, same values — collapsed but recorded |
| `rejected-records.jsonl` | Everything rejected, with reason + raw text |
| `coverage.json` | Machine-readable coverage + config-decoding status |
| `validation-report.md` | Human-readable validation breakdown |

Every record carries `provenance`: source, game id, source URL, source
filename, **source content SHA-256**, parser version, extraction method, and a
raw source identifier.

Records also carry an `observationKey` — the identity used for dedup and
conflict detection. Its parts are joined with `U+0001`, a control character
that cannot occur in component names or ids, so no combination of field values
can collide with a different combination (a plain separator like `-` or `:`
would let `["ab","c"]` and `["a","bc"]` produce the same key).

**Datasets are byte-for-byte deterministic** — identical inputs produce
identical files. Per-record provenance deliberately carries *no* timestamp (that
would make every run differ and destroy diffability); the content hash serves as
the provenance anchor instead, and pins each record to the exact source bytes.
Run time is recorded once, in `coverage.json` and the reports.

---

## Deduplication and conflicts

| | Meaning | Behaviour |
|---|---|---|
| **Duplicate** | Same identity key, **same** values | Collapsed; extra copies recorded in `duplicates.jsonl` |
| **Conflict** | Same identity key, **different** values | **Never collapsed.** All variants kept and flagged `conflicting`, plus a row in `conflicts.jsonl` |

Records are never merged because values merely "look similar" — equality is
exact on declared comparison fields. Choosing a winner between conflicting
observations would be inventing data, so the pipeline refuses to.

Grouping is Map/Set-based (O(n)), not pairwise.

---

## Validation rules

Two severities, and the distinction is load-bearing:

- **error** — the pipeline produced something structurally impossible or
  self-contradictory. A **tooling fault**. Fails the run.
- **warning** — the source data is incomplete, odd, or unresolved. An
  **ordinary research finding**. Does not fail the run.

Checked: invalid/missing game ids · missing names/URLs · zero, negative or
implausible FPS · negative sample counts · GPU/CPU rows whose bench link
contradicts their classification · malformed EFPS values and comparisons ·
comparison sides resolving to the same URL variant · the same EFPS URL
reporting different FPS · comparison-vs-direct contradictions · chart
label/data length mismatches · negative chart values · filter paths that aren't
5 positions · unresolved configuration fields · duplicate source pages ·
saved files that aren't FPS-Estimates game pages · catalog URLs that aren't
canonical · games saved but absent from the catalog.

---

## Data quality classification

Applied per record as `quality` / `configurationStatus`:

| Level | Meaning |
|---|---|
| `extracted` | Pulled from the source. Structure not fully verified. |
| `structurally-validated` | Parsed cleanly and passed every structural rule. **This is the ceiling for anything here.** |
| `configuration-decoded` | Every configuration field maps to a proven meaning. |
| `configuration-unresolved` | An undocumented field is populated; preserved raw. |
| `conflicting` | Contradicts another observation with the same key. |
| `rejected` | Malformed. Kept with a reason, never silently dropped. |

### The distinction that matters

- **Source-extracted** — the value appears in a saved page. Says nothing about
  accuracy.
- **Structurally validated** — internally consistent and correctly shaped. Still
  a crowd-sourced, self-reported number from a third party.
- **Configuration-decoded** — we know *what hardware* it refers to. We still do
  **not** know the resolution or settings.
- **SpecSmith verified benchmark record** — **nothing in this directory.** Those
  live in `src/data/benchmarkRecords.json` and come from single-source,
  disclosed-gap, independently verified measurements.

`structurally-validated` is **not** "verified benchmark ground truth" and must
never be presented as such.

### Never done here

- No FPS inferred, interpolated, averaged, or filled in.
- **Bench % / Value % are never converted into FPS.** They are UserBenchmark's
  own composite scores with no published FPS relationship. They ride in the
  datasets as their own fields with an explicit non-convertibility note.
- No meaning assigned to undocumented URL fields.
- No coverage manufactured for uncaptured pages.

---

## Known limitations

1. **3 of 316 games captured.** Every extracted count is bounded by this, not
   by the parser.
2. **Decoding confirmed across three games, not yet across many.** Fortnite,
   PUBG and CS:GO were parsed by identical code with 1,014/1,014 cross-checks
   agreeing, so the decoding is no longer single-source. The template variance
   found so far was formatting only (decimal averages, optional space before a
   chart key's colon), never structure — but three pages is still a small
   sample of 316.
3. **No resolution/settings per observation** (see above). This is a property of
   the source, not a parser gap.
4. **EFPS field 3 and filter positions 2–3 unproven.** Never exercised by any
   saved source. Preserved raw so a future source that populates them is
   detected rather than misread.
5. **Component id ↔ EFPS token mapping unknown.** Filter paths use numeric ids
   (`153864`); EFPS uses short names (`2060S`). Nothing on the page maps them,
   so no mapping is asserted.
6. **Page JavaScript is never executed** — extraction is static text analysis.

---

## Other tools in this directory

- **`build-known-games.mjs`** — merges every game discovered across all parsed
  sources into `known-games.json` (316 resolved, 0 name-only, 1 non-game hit).
- **`extract-game-catalog.mjs`** — scans a saved JS asset for an embedded game
  catalog. Reports a negative finding explicitly rather than writing a silent
  empty array. (The saved `scripts/userbenchmark.js` contains none.)
- **`efps/`** — the EFPS research report
  ([`configuration-analysis.md`](efps/configuration-analysis.md)). Documentation
  only; no code.
- **`homepage/`** — parser for the search/hub page type, including the
  hand-captured AJAX pagination responses. See `homepage/README.md`.

---

## Reconciliation record

Two sessions built UserBenchmark ingestion on this branch in parallel, which
left duplicate implementations and three separate writers of derived output.
That has been collapsed to one canonical surface. What was removed, and why:

### `efps/extract-efps.mjs` and `efps/parsed/` — removed

A second EFPS extractor with its own standalone core. Running it against the
saved Fortnite page showed it reporting **27 records and `"warnings": []`**
where the page contains 200 — its `Number(p)` guard skipped every comparison
(`Number("137 vs 108")` is `NaN`), discarding 86.5% of the data while reporting
a clean run. It also classified by game-name prefix (unreliable for `PUBG` /
`CSGO`, whose EFPS token is not the catalog name) and split the URL payload
into two groups rather than three, which cannot represent a comparison's two
variants.

It was first rewritten to delegate to `lib/efps.mjs`, then removed outright: as
a delegating wrapper it was a redundant entry point whose `efps/parsed/` tree
held a byte-identical **third** copy of records already in `parsed/` and
`dataset/`. `parse.mjs` already covers single-page parsing through the same
core.

The defect it embodied is locked out by a named regression test —
`EFPS: regression — comparison records must survive numeric coercion`.

### `build-research-dataset.mjs` — removed

An earlier consolidator, superseded by `ingest.mjs`. It wrote
`dataset/coverage.json` and `dataset/validation-report.md` — the same paths
`ingest.mjs` writes, with a different schema — so whichever ran last silently
overwrote the other's output with an incompatible shape. It was briefly kept as
a loud stub to prevent that; deleting it removes the collision entirely, since
there is nothing left to run.

### What remains, and why it is not duplication

`parse.mjs` (single page) and `ingest.mjs` (corpus) both write `parsed/*.json`,
but both call the same `lib/game-page.mjs` core and produce **byte-identical**
output for the same input — verified, not assumed. They are complementary entry
points to one implementation, not competing writers. `ingest.mjs` additionally
prunes stale `parsed/` files whose source no longer exists.

Git history retains every removed file.
