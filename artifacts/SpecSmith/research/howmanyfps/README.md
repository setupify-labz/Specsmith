# HowManyFPS research sample

This folder contains a small, manually captured research sample of 35 public HowManyFPS benchmark records for evaluating whether third-party community gameplay measurements can improve SpecSmith coverage.

## Evidence boundary

These records are **not SpecSmith-controlled measurements**. Keep them isolated from SpecSmith measured data and label them as `third_party_community_measured` unless a later review establishes a different evidence tier.

The public benchmark-page JavaScript inspected during research declares benchmark `Dataset` metadata with a CC BY 4.0 license and identifies Average FPS, 1% Low FPS, Maximum FPS, GPU, CPU, and RAM as measured variables. HowManyFPS Terms may separately restrict automated extraction, so this sample must not be treated as authorization for bulk crawling.

## Publication status

All rows are `research_sample_only`. Do not publish them into the production benchmark store until hardware/game normalization, source-page verification, settings completeness, duplicate handling, and quality review are complete.

## Known limitations

- Exact graphics settings are incomplete for most rows, so they are not yet safe for like-for-like comparisons.
- Community sessions are uncontrolled: drivers, thermals, RAM configuration, background load, power state, scene choice, and laptop/desktop differences can affect results.
- Row 8 is flagged as a suspicious FPS outlier.
- Row 12 is flagged because the source listing reported 0% GPU usage.
- Row 27 is missing resolution in the public listing.
- Usernames and sensitive machine/network identifiers are intentionally excluded.

## File

`howmanyfps-35.csv` contains the 35-record sample with source session IDs and source benchmark URLs retained for provenance.
