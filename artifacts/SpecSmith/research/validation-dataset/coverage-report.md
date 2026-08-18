# Verified-Benchmark Validation Dataset — Coverage Report

Generated 2026-08-18 by `research/validation-dataset/build-dataset.mjs` (strategy: deterministic). Research-only — not wired into production. Source data: `src/data/benchmarkRecords.json` (read-only, unmodified).

## 1. Usable observations

- **23 total verified benchmark records** exist right now, all with a confirmed `averageFps` — every one of them is a usable ground-truth observation for average-FPS validation.
- **10 of 23** also carry a confirmed `onePercentLow` — the only records usable for validating a future estimator's low-percentile predictions, not just its average.
- **0 of 23** carry a confirmed `zeroPointOnePercentLow` — none currently do.
- Spans **11 games**, **3 GPUs**, **2 CPUs**, 2 resolutions, 3 presets, 2 upscaler modes.

## 2. Calibration / holdout split

Strategy: **deterministic**. Every game with 2+ records contributes to both sides (holding out `floor(n/2)`, minimum 1, sorted deterministically by record id) so no game is only visible in one half of the split.

- Calibration: **12** records
- Holdout: **11** records
- No stranded singletons — every game contributed to both sides.

Per-game split (calibration / holdout):

| Game | Calibration | Holdout |
|---|---|---|
| alanwake2 | 1 | 1 |
| avatarfop | 1 | 1 |
| cyberpunk2077 | 1 | 1 |
| forzahorizon5 | 1 | 1 |
| hogwarts | 1 | 1 |
| marvelrivals | 2 | 1 |
| msfs2020 | 1 | 1 |
| rdr2 | 1 | 1 |
| remnant2 | 1 | 1 |
| starfield | 1 | 1 |
| tlou1 | 1 | 1 |

## 3. Coverage by dimension

**Records per game:**

- marvelrivals: 3
- cyberpunk2077: 2
- alanwake2: 2
- forzahorizon5: 2
- starfield: 2
- rdr2: 2
- tlou1: 2
- msfs2020: 2
- avatarfop: 2
- hogwarts: 2
- remnant2: 2

**Records per GPU:**

- rtx4070s: 10
- rtx4070: 10
- rtx3060: 3

**Records per CPU:**

- r7-7800x3d: 20
- r5-5600: 3

**Records per resolution:**

- 1440p: 20
- 1080p: 3

**Records per preset:**

- ultra: 17
- high: 4
- extreme: 2

**Records per upscaler:**

- native: 17
- dlss: 6

**Ray tracing:** 8 on / 15 off
**Frame Generation:** 1 on / 22 off

**Estimator catalog cross-check:** the Estimator's own catalog has 20 games / 57 GPUs / 51 CPUs. Of those, only 3 GPUs and 2 CPUs have ever appeared in a verified record — 54 catalog GPUs and 49 catalog CPUs have zero verified data of any kind.

## 4. Biggest coverage gaps (most to least significant)

1. No 4K records at all — every record is 1080p or 1440p.
2. 1080p is only represented by Marvel Rivals — no other game has a 1080p record, so resolution scaling can only be cross-checked within one game/GPU/CPU combination.
3. Only 2 distinct CPUs appear in any record (r5-5600, r7-7800x3d) — no mid-range or budget CPU is represented, so CPU-bound scenarios are essentially untested.
4. Only 3 distinct GPUs appear (rtx3060, rtx4070, rtx4070s) — no high-end (4080/4090/5090 class) or budget (60-class below rtx3060, or AMD/Intel) GPU is represented.
5. No FSR records.
6. No XeSS records.
7. No Low or Medium preset records — every record is High, Ultra, or Extreme, so the bottom half of the quality-preset curve is completely unvalidated.
8. Only one Frame Generation record exists in total (Marvel Rivals), and it is DLSS/FSR-vendor-ambiguous per its own notes — Frame Generation cannot be meaningfully validated as a dimension yet.
9. No single game has both an RT-on and RT-off record — every game is only ever tested at one RT state, so RT's isolated FPS cost can't be measured from this dataset alone, only inferred by comparing across different games.
10. 54 of 57 Estimator-catalog GPUs have never appeared in a single verified record; 49 of 51 catalog CPUs likewise.

## 5. What this dataset cannot yet support

- **No cross-GPU-tier generalization test beyond one step** — the only "generalization" a holdout split can currently test is rtx4070s → rtx4070 (or vice versa) at fixed settings, since those are the only GPU pairs with matched records. It cannot test whether a future estimator generalizes across a wider GPU spread (e.g. calibrate on RTX 4070-class, predict RTX 4090 or RTX 4060).
- **No CPU-bound validation** — both CPUs used (r5-5600, r7-7800x3d) are mid-to-high tier; nothing here can validate estimator behavior for a CPU-limited scenario.
- **No resolution-scaling validation across games** — 1440p dominates every game except Marvel Rivals (1080p only), so there is no way to check whether a future estimator's resolution scaling is consistent across more than one game.
- **No isolated RT-cost measurement** — since no game has both an RT-on and RT-off record, RT's FPS cost can only be estimated by comparing *different* games, which conflates RT cost with each game's own engine characteristics.

---

_Files in this directory: `build-dataset.mjs` (this script), `dataset.json` (generated — full record list with stratification tags and split assignment), `coverage-report.md` (this file, generated). Regenerate both with `node research/validation-dataset/build-dataset.mjs`._
