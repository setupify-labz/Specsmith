# HowManyFPS research sample

This folder contains a small, manually captured research sample of 35 public HowManyFPS benchmark records for evaluating whether third-party community gameplay measurements can improve SpecSmith coverage.

## Evidence boundary

These records are **not SpecSmith-controlled measurements**. Keep them isolated from SpecSmith measured data and label them as `third_party_community_measured` unless a later review establishes a different evidence tier.

The public benchmark-page JavaScript inspected during research declares benchmark `Dataset` metadata with a CC BY 4.0 license and identifies Average FPS, 1% Low FPS, Maximum FPS, GPU, CPU, and RAM as measured variables. HowManyFPS Terms may separately restrict automated extraction, so this sample must not be treated as authorization for bulk crawling.

## Publication status

The original 35-row capture remains research material. Eleven source-verified rows have now been normalized into the separate `src/data/communityBenchmarkRecords.json` store so the Builder can show them as **Community Measured** results for exact CPU + GPU matches.

That promotion does **not** make them SpecSmith-controlled or strict `BenchmarkRecord` measurements. The community store intentionally preserves exact width × height, partial per-setting metadata, quality flags, and source provenance without inventing a normalized Low/High/Ultra preset or missing ray-tracing/upscaler/frame-generation state.

The remaining rows stay research-only until they pass the same source verification, hardware normalization, and quality review.

## Known limitations

- Exact graphics settings are incomplete for most rows, so they are not safe for strict like-for-like preset comparisons.
- Community sessions are uncontrolled: drivers, thermals, RAM configuration, background load, power state, scene choice, and laptop/desktop differences can affect results.
- Row 8 is flagged as a suspicious FPS outlier.
- Row 12 is flagged because the source listing reported 0% GPU usage.
- Row 27 is missing resolution in the public listing.
- Usernames and sensitive machine/network identifiers are intentionally excluded.

## Files

- `howmanyfps-35.csv` — original 35-record research sample.
- `howmanyfps-11-source-verified.json` — machine-readable source verification for the 11 strongest rows.
- `SOURCE-VERIFICATION.md` — source-review notes and architecture decision.

Production-facing community records live separately in `src/data/communityBenchmarkRecords.json`; the strict verified-benchmark store remains unchanged.
