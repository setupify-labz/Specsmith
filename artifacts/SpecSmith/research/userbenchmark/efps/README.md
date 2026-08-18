# UserBenchmark EFPS extraction

Research-only. This directory parses the machine-readable EFPS dataset embedded in **locally saved** UserBenchmark FPS-Estimates game pages. It does not fetch, crawl, follow links, or contact UserBenchmark.

The extractor preserves the exact embedded `id`, title (`t`) and FPS (`p`) values and also exposes the raw EFPS URL payload. It classifies results as `single` or `comparison` from the title, but deliberately does **not** infer CPU/GPU names or resolution/settings from the URL until that encoding is independently validated.

Example source shape:

```text
{id: 'https://www.userbenchmark.com/EFps/,,,_,,,_PUBG,2060S,3600,', t: 'PUBG 3600 2060S', p: '119'}
```

The same game page also contains separate aggregate FPS, settings/resolution distributions, and CPU/GPU population tables; the existing `research/userbenchmark/parse.mjs` extracts those sections. This extractor adds the missing EFPS records without changing production data.

## Workflow

1. Save a UserBenchmark FPS-Estimates game page locally.
2. Run:

```bash
node artifacts/SpecSmith/research/userbenchmark/efps/extract-efps.mjs path/to/page.html
```

3. Inspect the generated `parsed/<game-slug>.json` and its warnings.
4. Only after the EFPS URL/configuration encoding has been independently decoded should those records be considered for estimator validation.

### Important distinction

`p` is an explicit FPS value embedded in the page. It should **not** be reconstructed from UserBenchmark Bench %, Value %, the histogram, or sample counts. Likewise, the EFPS URL's comma/underscore fields are retained as raw data until their exact configuration semantics are proven.

Nothing in this directory creates or updates `src/data/benchmarkRecords.json`.
