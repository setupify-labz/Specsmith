# UserBenchmark FPS-Estimates Parser & Catalog Extractor

> **Research-only. No network code anywhere in this directory.** This tool
> parses page sources that a human has already saved to disk. It never
> fetches, crawls, or requests anything from userbenchmark.com or any other
> domain. Nothing here is wired into production, and nothing here has been
> or should be added to `src/data/benchmarkRecords.json` without
> independently re-verifying every field against that schema's strict
> provenance rules (see `src/lib/benchmarks/README_evidence-quality.md`) —
> this tool's output is raw extracted data, not a `BenchmarkRecord`.

## What this is

UserBenchmark's "FPS Estimates" pages (`/PCGame/FPS-Estimates-<Game>/<id>/...`)
publish crowd-sourced, self-reported FPS data per game: an average FPS and
sample count, a histogram of FPS values, a breakdown of which quality
preset and resolution respondents used, and two ranked tables (GPU, CPU)
of which specific parts respondents ran the game on, each with its own
sample count and a link that re-filters the page to just that part.

`parse.mjs` extracts all of that into structured JSON — from a page source
you already saved yourself.

## How to add a saved page

1. In a browser, open the UserBenchmark FPS-Estimates page for a game.
2. Save the full page source — View Source → Save As, or Ctrl+U then
   Ctrl+S, or Ctrl+S "Webpage, HTML only." Right-click → "Save As" also
   works. Copy/pasting the page's HTML into a `.txt` file works too (that's
   exactly how the first sample page in `pages/` was captured).
3. Drop the file into `research/userbenchmark/pages/`. Any `.html`,
   `.htm`, `.xhtml`, or `.txt` extension is picked up. Name it however you
   like — a `<GameSlug>-<gameId>.html` pattern (matching the URL) is a
   reasonable convention, but the parser doesn't depend on the filename;
   everything is read from the page content itself.
4. Run:
   ```
   node research/userbenchmark/parse.mjs
   ```
   (or `node research/userbenchmark/parse.mjs <exact-filename>` to parse
   just one file). This reads every source in `pages/` and writes one JSON
   file per game into `research/userbenchmark/parsed/`, named after the
   game's URL slug, plus an `index.json` summarizing all parsed pages.

That's the entire workflow. There is no fetch step — adding a new source
is purely "save it yourself, then run the parser."

## Game catalog extractor (`extract-game-catalog.mjs`)

A second, separate tool for a different kind of source: a saved
UserBenchmark **JavaScript asset** (not an HTML page), scanned for an
embedded `/PCGame/FPS-Estimates-<slug>/<id>/` catalog of game name/ID
pairs. Same rules as `parse.mjs` — reads only local files, no network code.

1. Save the `.js` file to `research/userbenchmark/scripts/`.
2. Run:
   ```
   node research/userbenchmark/extract-game-catalog.mjs
   ```
3. Output goes to `research/userbenchmark/game-catalog.json`: every
   `/PCGame/FPS-Estimates-.../` entry found (id, slug, derived name,
   occurrence count), plus duplicate-id and duplicate-name detection, plus
   an explicit per-file **conclusion** — including "this file contains no
   game-catalog data" when that's the honest answer. It reports a negative
   finding openly rather than silently writing an empty array with no
   explanation.

The first file run through it (`scripts/userbenchmark.js`, UserBenchmark's
generic site bundle — jQuery UI internals, Select2, the star-rating
plugin, and UserBenchmark's own ad/nav/autocomplete-wiring helpers)
contains **zero** game entries: no `/PCGame/` URLs, no literal "FPS
Estimates" string, not even the substring "game" anywhere in the 402KB
file (checked case-insensitively). That's expected once you look at what
the file actually is — it's the *code* that wires up UserBenchmark's
search box (`mcCoreSelect2Options`, a Select2 remote-data matcher/
formatter), not a data file. The actual searchable catalog is loaded
dynamically from a search endpoint at request time, or embedded per-page
the way it is on the FPS-Estimates game pages themselves (see `parse.mjs`
above) — it isn't shipped inside this shared JS bundle.

## Known-games consolidator (`build-known-games.mjs`)

A third tool that doesn't parse a new source — it merges what every other
parser in this directory has *already* extracted into one deduplicated
catalog, so "how many games do we actually know about, and how completely"
has a single answer instead of being scattered across `parsed/*.json` and
`homepage/parsed/*.json`. Run it any time after (re-)running the other
parsers:
```
node research/userbenchmark/build-known-games.mjs
```
Output: `known-games.json`, with every game split into:
- **`resolved`** — has a `gameId` + URL (+ sample count and caption, where
  known) and is directly reachable. Pulled from the single-game pages' own
  identity and `relatedGamePages`, and the search page's
  `searchResultGames` and `carouselGames`.
- **`nameOnly`** — only a name is known, from the search page's site-wide
  autocomplete list. **Not reachable** without either saving that specific
  game's own page, or capturing the "308 MORE »" AJAX response by hand.
- **`nonGameHits`** — search hits that matched the term "FPS" but aren't
  FPS-Estimates games at all (found one: a "Blade" RAM kit's SpeedTest
  page). Kept separate so it's never miscounted as a game.

As of all sources saved so far — including the 4 hand-captured AJAX
pagination pages that cover the full 317-hit result set (see
`homepage/README.md`'s "AJAX pagination pages" section) — **316
resolved**, **0 name-only**, **316 total distinct games known**, plus
**1 non-game hit** set aside. This count only grows when a new source is
saved and parsed — this tool performs no lookups of its own, it only
re-aggregates existing parsed output.

## What gets extracted (parse.mjs)

Per saved page, `parsed/<slug>.json` contains:

- **`game`** — `gameId`, URL `slug`, display `name`, canonical URL, and the
  parsed 5-segment filter path from that URL (`[gpuId, cpuId,
  resolutionFilter, settingsFilter, cpuFamilyFilter]` — positions 2/3's
  exact encoding isn't labeled anywhere on the page itself, so they're
  preserved as raw values, not reinterpreted).
- **`sampleSummary`** — `averageFps`, `totalSamples`.
- **`fpsHistogram`** — the `labels`/`data` arrays backing the FPS bar
  chart (FPS-value buckets → sample counts).
- **`settingsDistribution`** — the quality-preset pie chart (`Low` /
  `Med` / `High` / `Max` → sample counts).
- **`resolutionDistribution`** — the resolution pie chart (`720p` /
  `1080p` / `1440p` / `4K` → sample counts).
- **`gpuTable`** / **`cpuTable`** — every row from the "Choose GPU" /
  "Choose CPU" tables: part name, samples, bench %, value %, live price
  (amount + store + URL, when shown), the page's own re-filtered URL for
  that part, and the link to that part's dedicated UserBenchmark page.
  Rows are classified GPU vs. CPU by which domain their "Bench" link
  points at (`gpu.userbenchmark.com` vs `cpu.userbenchmark.com`), not by
  which literal table they're in, so it stays correct even if heading text
  changes.
- **`brandFilterUrls`** — the quick-filter buttons on the page (e.g. the
  i9/i7/i5/i3/Pentium/Ryzen/FX/Athlon CPU-family buttons in the sample
  page).
- **`relatedGamePages`** — the strip of other FPS-Estimates games linked
  from the page. **Discovered, not fetched** — these are just URLs sitting
  in the JSON for a human to decide whether to go save. This tool never
  follows them.
- **`_meta.warnings`** — anything the parser expected to find but
  couldn't (e.g. a chart or table that didn't match the known markup
  shape). An empty `warnings` array means every section extracted cleanly;
  a non-empty one means check that section by hand before trusting it.

## Extending the parser for a differently-shaped page

Every extractor in `parse.mjs` is a small, independent function
(`extractGameIdentity`, `extractSampleSummary`, `extractChart`,
`extractComponentTables`, `extractBrandFilters`, `extractRelatedGamePages`)
built against the exact markup in `pages/FPS-Estimates-Fortnite-3954.html`.
If a future saved page's markup differs (a template change, a different
page type, a locale variant), that section's regex won't match, its output
comes back empty, and a `warnings` entry says so — it fails loud, not
silent. Fix the relevant extractor's regex against the new sample rather
than loosening it broadly, and re-run.

## Explicitly out of scope

- No fetching, crawling, pagination, or link-following of any kind.
- No CAPTCHA/auth/rate-limit/robots handling of any kind — moot, since
  nothing here ever makes a network request.
- No production file touched — `src/`, `package.json`, and everything the
  app ships are unaffected by this directory.
- No FPS numbers are treated as verified — this is raw crowd-sourced data
  extraction for research reference, not a substitute for the strict
  single-source, disclosed-gap provenance process the rest of this
  project's `benchmarkRecords.json` entries go through.
