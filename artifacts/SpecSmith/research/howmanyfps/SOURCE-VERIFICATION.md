# HowManyFPS — 11-record source verification

Verified on 2026-08-24 against the public HowManyFPS benchmark pages for the 11 strongest rows from `howmanyfps-35.csv`.

## Result

- **11/11 public source pages were verified.**
- **11/11 remain useful community-measured candidates.**
- **0/11 should be inserted into the current strict `BenchmarkRecord` store yet.**

This is not because the FPS numbers are unusable. The blocker is the current SpecSmith verified-benchmark contract: it requires a normalized global preset plus explicit feature-state fields. These HowManyFPS pages usually expose a *subset of exact in-game settings* instead (for example CS2 Reflex/MSAA/Shadows, Dota 2 Textures/Shadows/Reflex, Valorant Material/Detail/AA). Forcing those partial settings into `low/medium/high/ultra/extreme` would be an inference and would violate SpecSmith's existing no-guessing rule.

## Verified settings

| Sample | Game | Hardware | Resolution | Avg / 1% | Public settings recovered | Review notes |
|---|---|---|---|---:|---|---|
| 3 | Dota 2 | RTX 3070 + Ryzen 7 9800X3D | 1920x1080 | 250 / 232 | Textures High; Shadows High; Nvidia Reflex Enabled + Boost | Strong repeatable candidate; no global preset exposed |
| 14 | Dota 2 | RTX 3070 + Ryzen 7 9800X3D | 1920x1080 | 247 / 220 | Textures High; Shadows High; Nvidia Reflex Enabled + Boost | Same rig/settings subset as #3; no global preset exposed |
| 11 | Fortnite | RTX 3070 + Ryzen 5 5500 | 1920x1080 | 146 / 58 | Rendering Mode Unknown; NVIDIA DLSS; 3D Resolution 66% (DLSS Quality) | DLSS Quality is explicit, but rendering mode and global preset are not |
| 17 | Valorant | RX 7600 + Ryzen 5 5500 | 2560x1440 | 205 / 86 | Multithreaded Yes; Material Low; Detail Low; Anti-Aliasing None | Looks low-oriented, but do not force-map to `low` because the full setting set is not exposed |
| 19 | Counter-Strike 2 | RTX 3080 + Ryzen 9 5900X | 2560x1440 | 359 / 291 | Reflex Enabled; 8x MSAA; Shadows Very High | Strong real-world sample; no global preset exposed |
| 22 | Counter-Strike 2 | RX 9070 XT + Ryzen 7 7800X3D | 2560x1440 | 262 / 195 | Reflex Enabled; 4x MSAA; Shadows High | Source reports 248 FPS limit but 273 max; flag inconsistency; single-channel RAM |
| 31 | Counter-Strike 2 | RX 9070 XT + Ryzen 7 7800X3D | 2560x1440 | 260 / 241 | Reflex Enabled; 4x MSAA; Shadows High | Same 248-cap inconsistency; single-channel RAM; average closely repeats #22 |
| 26 | Counter-Strike 2 | RTX 5060 + Ryzen 5 5500 | 1920x1080 | 162 / 123 | Reflex Enabled; 2x MSAA; Shadows Very High | CPU-limited session |
| 28 | Counter-Strike 2 | RTX 4070 Ti + i5-14600KF | 2560x1440 | 265 / 145 | Reflex Enabled; 4x MSAA; Shadows High | Good candidate; large avg-to-1% gap |
| 29 | Counter-Strike 2 | RTX 4080 + i5-12400F | 2560x1440 | 238 / 178 | Reflex Enabled; 4x MSAA; Shadows Very High | CPU-limited session |
| 33 | Counter-Strike 2 | RTX 4080 SUPER + Ryzen 7 9800X3D | 2560x1440 | 410 / 246 | Reflex Enabled; 2x MSAA; Shadows High | GPU-heavy, but source reports old driver and XMP disabled |

## Important quality findings

The two Dota 2 sessions are especially encouraging: same CPU/GPU and same exposed settings subset, with 250 vs 247 average FPS. The two RX 9070 XT + 7800X3D CS2 sessions also repeat closely at 262 vs 260 average FPS. That supports keeping these as real-world distribution data, but it does **not** prove controlled-lab equivalence.

The 248 FPS limit reported on samples 22 and 31 conflicts with their recorded maximums (273 and 272). Preserve the measurements and flag the source inconsistency rather than silently “fixing” either value.

## Recommended architecture

Do **not** weaken `BenchmarkRecord` just to make these rows fit.

If SpecSmith decides to publish community telemetry, use a separate evidence type/store that can preserve:

- exact width × height
- raw per-setting key/value pairs
- avg / 1% / 0.1% / max FPS
- session-level quality flags
- source/session provenance
- uncontrolled-system context

That keeps SpecSmith-controlled or strictly normalized verified benchmarks clean while still letting the site benefit from real-world community measurements.

`howmanyfps-11-source-verified.json` contains the machine-readable verification results.
