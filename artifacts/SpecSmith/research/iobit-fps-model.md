# IObit FPS Calculator — Extracted Estimation Model

> **⚠️ THIRD-PARTY ESTIMATED-MODEL DATA — NOT SPECSMITH DATA**
>
> Everything in this document was reverse-engineered from IObit's publicly
> shipped client-side JavaScript for their FPS Calculator tool
> (`iobit.com/en/fps-calculator.php`), specifically the deobfuscated bundle
> containing `GAME_WEIGHTS`, `CPU_OBJECT`, `GPU_OBJECT`, and `calculateFps()`.
>
> This is **a competitor's proprietary regression/heuristic model**, not a
> measured benchmark, not independently verified against real hardware, and
> not sourced from SpecSmith's own research. IObit's own UI attributes it
> only to a generic "real benchmark data · Tom's Hardware · TechPowerUp ·
> NotebookCheck" disclosure with no per-number citation — i.e. it fails
> every evidence-quality bar SpecSmith's Verified Benchmarks system applies
> (see `src/lib/benchmarks/README_evidence-quality.md`).
>
> **Do not add any of this to `benchmarkRecords.json`,
> `gameFeatureProfiles.json`, or any Verified-FPS-facing data.** It has zero
> provenance, zero `confirmedFields`, and zero source URL/date per number —
> it would fail `validateBenchmarkRecord` outright and, more importantly,
> would violate the "every displayed number traces to a real, cited source"
> rule that engine exists to enforce.
>
> This document is for **competitive/model-design reference only** — e.g.
> understanding how a rival estimator shapes its curves, what
> weight/multiplier structure it uses, or what its tier-comparison UX looks
> like. It does not modify, and must not be wired into, any production
> code path in this repository.

---

## 1. Formula overview

IObit's estimator is a **weighted linear blend of a normalized CPU score
and a normalized GPU score**, scaled by five independent multipliers, then
multiplied against a per-game base FPS constant.

```
cpuRatio = cpuPerf / 4000          // cpuPerf = selected CPU's "perf" score
gpuRatio = gpuPerf / 15000         // gpuPerf = selected GPU's "perf" score

resMult     = RES_OBJECT[resolution].res
qualityMult = QUALITY_MUL[quality].mult
ramMult     = RAM_LIST[ram].mult
upMult      = UP_MUL[upscaling].mult

rtMult = RT_MUL[rtLevel].mult
if (rtLevel !== "off" && game.rtPenalty > 0) {
  rtMult *= 1 - game.rtPenalty * (
    rtLevel === "ultra"  ? 1.0 :
    rtLevel === "medium" ? 0.7 :
    /* "low" */            0.4
  )
}

performanceFactor =
  ( cpuRatio * game.cpuWeight
  + gpuRatio * game.gpuWeight * resMult * qualityMult * rtMult * upMult
  ) * ramMult

fps = round( game.baseFps * performanceFactor )

if (frameCap !== "none") fps = min(fps, frameCap)
```

**Derived low-percentile figures** (not independently modeled — flat ratios
of the single `fps` result):
```
onePercentLow      = round(fps * 0.72)
zeroPointOnePercentLow = round(fps * 0.55)
```
These are **not** distinct simulated values — every game/config produces the
exact same 0.72 / 0.55 ratio off the average. This is a materially weaker
claim than SpecSmith's Verified Benchmarks system, where `onePercentLow`
and `zeroPointOnePercentLow` are only ever populated from a source that
explicitly reported them.

### CPU/GPU bottleneck-bar calculation (Overview tab)
```
cpuContribution = cpuRatio * game.cpuWeight
gpuContribution = gpuRatio * game.gpuWeight * resMult
cpuPct = round(cpuContribution / (cpuContribution + gpuContribution) * 100)
gpuPct = 100 - cpuPct

balanceRatio = cpuContribution / gpuContribution
```
| `balanceRatio` | Label |
|---|---|
| < 0.55 | GPU Bottleneck |
| 0.55 – 0.8 | Slight GPU Bottleneck |
| 0.8 – 1.4 | Balanced |
| 1.4 – 2.0 | Slight CPU Bottleneck |
| > 2.0 | CPU Bottleneck |

### CPU / GPU "tier" labels (for the Analysis tab's prose, driven by raw `perf` score)
| CPU `perf` | Tier |
|---|---|
| ≥ 4800 | flagship |
| ≥ 4300 | high-end |
| ≥ 3800 | mid-high |
| ≥ 3200 | mid-range |
| < 3200 | budget |

| GPU `perf` | Tier |
|---|---|
| ≥ 30000 | flagship |
| ≥ 22000 | high-end |
| ≥ 15000 | mid-range |
| ≥ 9000 | entry-mid |
| < 9000 | budget |

### VRAM-demand table (by resolution, for the VRAM-analysis tier)
| Resolution | VRAM "demand" (GB) |
|---|---|
| 8K | 16 |
| 4K | 12 |
| 1440p | 8 |
| 1080p / 720p | 6 |

VRAM tier: `vram < demand` → Insufficient; `vram <= demand+1` → Tight; else → Comfortable.

### Upgrade-recommendation trigger thresholds
| Condition | Suggestion |
|---|---|
| `cpuContribution/(cpuContribution+gpuContribution)`-derived ratio < 0.7 | CPU upgrade (Critical) |
| GPU ratio (`gpuPerf/15000`) < 0.55 **and** resolution is 4K or 1440p | GPU upgrade (Critical) |
| RAM ≤ 8 GB | RAM upgrade (Critical) |
| Storage = HDD | NVMe upgrade (Critical) |
| VRAM < resolution's demand | More-VRAM GPU (High) |
| GPU ratio > 1.7 **and** resolution = 1080p | Higher-res monitor (High) |
| Storage = SATA SSD | NVMe upgrade (Low) |

---

## 2. Per-game weights (29 games)

`gpuWeight` + `cpuWeight` do not always sum to 1 in their raw form because
`gpuWeight` is further multiplied by `resMult × qualityMult × rtMult ×
upMult` before blending — only `cpuWeight` is applied "bare." `rtPenalty`
is the fraction of GPU performance lost when RT is enabled at Ultra (scaled
down for Medium ×0.7 and Low ×0.4), applied on top of `RT_MUL`.

| id | Display name | cpuWeight | gpuWeight | baseFps | rtPenalty |
|---|---|---|---|---|---|
| valorant | Valorant | .65 | .35 | 450 | 0 |
| cs2 | Counter-Strike 2 | .55 | .45 | 350 | 0 |
| apex | Apex Legends | .45 | .55 | 200 | 0 |
| r6 | Rainbow Six Siege | .60 | .40 | 380 | 0 |
| fortnite | Fortnite | .50 | .50 | 280 | 0 |
| overwatch2 | Overwatch 2 | .55 | .45 | 320 | 0 |
| pubg | PUBG: Battlegrounds | .40 | .60 | 180 | 0 |
| cp2077 | Cyberpunk 2077 | .25 | .75 | 85 | .45 |
| cp2077rt | Cyberpunk 2077 (RT Ultra) | .15 | .85 | 55 | 0 |
| cp2077pt | Cyberpunk 2077 (Path Tracing) | .10 | .90 | 35 | 0 |
| blackmyth | Black Myth: Wukong | .20 | .80 | 75 | .50 |
| rdr2 | Red Dead Redemption 2 | .30 | .70 | 95 | .35 |
| hogwarts | Hogwarts Legacy | .25 | .75 | 80 | .40 |
| starfield | Starfield | .30 | .70 | 85 | .30 |
| elden | Elden Ring | .40 | .60 | 100 | 0 |
| alan2 | Alan Wake 2 | .15 | .85 | 55 | .55 |
| bg3 | Baldur's Gate 3 | .40 | .60 | 110 | .25 |
| witcher3 | The Witcher 3 (Next Gen) | .35 | .65 | 120 | .35 |
| diablo4 | Diablo IV | .45 | .55 | 180 | .20 |
| helldivers | Helldivers 2 | .35 | .65 | 130 | .30 |
| warzone | Call of Duty: Warzone | .40 | .60 | 150 | .15 |
| bf2042 | Battlefield 2042 | .30 | .70 | 120 | .25 |
| doom2016 | DOOM Eternal *(internal id says "doom2016" — their own naming inconsistency)* | .50 | .50 | 280 | .20 |
| f124 | F1 24 | .45 | .55 | 200 | .15 |
| fh5 | Forza Horizon 5 | .40 | .60 | 150 | .20 |
| msfs2024 | MS Flight Simulator 2024 | .30 | .70 | 65 | .30 |
| cities2 | Cities: Skylines II | .50 | .50 | 55 | .20 |
| totalwar | Total War: Warhammer III | .45 | .55 | 95 | .20 |
| minecraft | Minecraft (Shaders) | .70 | .30 | 350 | .10 |
| stardew | Stardew Valley | .80 | .20 | 500 | 0 |

Note: `cp2077`, `cp2077rt`, and `cp2077pt` are three **separate catalog
entries** for the same game rather than one entry with RT/path-tracing as
settings toggles — a modeling choice worth noting since SpecSmith treats RT
as a boolean dimension on one game record instead.

---

## 3. Multiplier tables

### Resolution (`RES_OBJECT[key].res`)
| Resolution | Multiplier |
|---|---|
| 720p | 1.85 |
| 1080p | 1.00 |
| 1440p | 0.68 |
| 4K | 0.38 |
| 8K | 0.18 |

### Graphics quality preset (`QUALITY_MUL[key].mult`)
| Preset | Multiplier |
|---|---|
| Low | 1.55 |
| Medium | 1.25 |
| High | 1.00 |
| Ultra | 0.78 |
| Max/Insane | 0.60 |

### Ray tracing level (`RT_MUL[key].mult`, base multiplier before the per-game `rtPenalty` scaling above)
| RT Level | Multiplier |
|---|---|
| Off | 1.00 |
| Low | 0.82 |
| Medium | 0.65 |
| Ultra | 0.50 |

### Upscaling mode (`UP_MUL[key].mult`)
| Mode | Multiplier |
|---|---|
| None / Native | 1.00 |
| FSR Quality | 1.32 |
| DLSS Quality | 1.48 |
| DLSS Performance | 1.78 |
| DLSS Ultra Performance | 2.05 |

*(No XeSS option in this model.)*

### RAM (`RAM_LIST[key].mult`)
| RAM | Multiplier |
|---|---|
| 8 GB | 0.92 |
| 16 GB | 1.00 |
| 32 GB | 1.03 |
| 64 GB | 1.03 |

### Storage
No numeric multiplier — storage only feeds the templated "Analysis" copy
(HDD/SATA/NVMe tiers) and the upgrade-suggestion list, not the FPS formula
itself.

### Frame cap
Post-hoc `min(fps, cap)` clamp only, applied after every other multiplier.
Options: 60 / 90 / 120 / 144 / 165 / 240 / 360 / Unlimited.

---

## 4. CPU performance scores (`perf`, normalized against 4000 as the divisor)

### Intel Core Ultra 200
| CPU | perf |
|---|---|
| Ultra 9 285K | 4850 |
| Ultra 7 265K | 4700 |
| Ultra 7 265KF | 4680 |
| Ultra 5 245K | 4400 |
| Ultra 5 245KF | 4380 |

### Intel 14th Gen
| CPU | perf |
|---|---|
| i9-14900KS | 4950 |
| i9-14900K | 4850 |
| i9-14900KF | 4830 |
| i9-14900 | 4650 |
| i7-14700K | 4600 |
| i7-14700KF | 4580 |
| i7-14700 | 4450 |
| i5-14600K | 4350 |
| i5-14600KF | 4330 |
| i5-14600 | 4200 |
| i5-14500 | 4050 |
| i5-14400 | 3900 |
| i5-14400F | 3880 |
| i3-14100 | 3500 |
| i3-14100F | 3480 |

### Intel 13th Gen
| CPU | perf |
|---|---|
| i9-13900KS | 4800 |
| i9-13900K | 4700 |
| i9-13900KF | 4680 |
| i9-13900 | 4500 |
| i7-13700K | 4550 |
| i7-13700KF | 4530 |
| i7-13700 | 4400 |
| i5-13600K | 4300 |
| i5-13600KF | 4280 |
| i5-13500 | 4000 |
| i5-13400 | 3850 |
| i5-13400F | 3830 |
| i3-13100 | 3450 |
| i3-13100F | 3430 |

### Intel 12th Gen
| CPU | perf |
|---|---|
| i9-12900K | 4300 |
| i9-12900KF | 4280 |
| i7-12700K | 4150 |
| i7-12700KF | 4130 |
| i7-12700 | 4000 |
| i5-12600K | 4000 |
| i5-12600KF | 3980 |
| i5-12600 | 3750 |
| i5-12400 | 3600 |
| i5-12400F | 3580 |
| i3-12100 | 3200 |
| i3-12100F | 3180 |

### Intel 11th Gen
| CPU | perf |
|---|---|
| i9-11900K | 3700 |
| i9-11900KF | 3680 |
| i7-11700K | 3550 |
| i7-11700KF | 3530 |
| i5-11600K | 3400 |
| i5-11400 | 3150 |
| i5-11400F | 3130 |

### Intel 10th Gen
| CPU | perf |
|---|---|
| i9-10900K | 3450 |
| i9-10900KF | 3430 |
| i7-10700K | 3300 |
| i7-10700KF | 3280 |
| i5-10600K | 3100 |
| i5-10400 | 2850 |
| i5-10400F | 2830 |
| i3-10100 | 2550 |
| i3-10100F | 2530 |

### AMD Ryzen 9000 (Zen 5)
| CPU | perf |
|---|---|
| Ryzen 9 9950X | 4900 |
| Ryzen 9 9900X | 4750 |
| Ryzen 7 9800X3D | 5100 |
| Ryzen 7 9700X | 4600 |
| Ryzen 5 9600X | 4350 |
| Ryzen 5 9600 | 4200 |

### AMD Ryzen 7000 (Zen 4)
| CPU | perf |
|---|---|
| Ryzen 9 7950X3D | 5050 |
| Ryzen 9 7950X | 4550 |
| Ryzen 9 7900X3D | 4900 |
| Ryzen 9 7900X | 4400 |
| Ryzen 9 7900 | 4250 |
| Ryzen 7 7800X3D | 5000 |
| Ryzen 7 7700X | 4300 |
| Ryzen 7 7700 | 4150 |
| Ryzen 5 7600X | 4100 |
| Ryzen 5 7600 | 3950 |
| Ryzen 5 7500F | 3850 |

### AMD Ryzen 5000 (Zen 3)
| CPU | perf |
|---|---|
| Ryzen 9 5950X | 3800 |
| Ryzen 9 5900X | 3700 |
| Ryzen 9 5900 | 3550 |
| Ryzen 7 5800X3D | 4200 |
| Ryzen 7 5800X | 3500 |
| Ryzen 7 5800 | 3350 |
| Ryzen 7 5700X | 3250 |
| Ryzen 7 5700G | 3050 |
| Ryzen 5 5600X | 3150 |
| Ryzen 5 5600 | 3000 |
| Ryzen 5 5600G | 2800 |
| Ryzen 5 5500 | 2700 |
| Ryzen 3 5300G | 2400 |

### AMD Ryzen 3000 (Zen 2)
| CPU | perf |
|---|---|
| Ryzen 9 3900X | 3050 |
| Ryzen 9 3900 | 2900 |
| Ryzen 7 3800X | 2950 |
| Ryzen 7 3800XT | 3000 |
| Ryzen 7 3700X | 2850 |
| Ryzen 5 3600X | 2700 |
| Ryzen 5 3600XT | 2750 |
| Ryzen 5 3600 | 2600 |
| Ryzen 5 3500X | 2450 |
| Ryzen 3 3300X | 2550 |
| Ryzen 3 3100 | 2300 |

### AMD Ryzen 2000 (Zen+)
| CPU | perf |
|---|---|
| Ryzen 7 2700X | 2450 |
| Ryzen 7 2700 | 2300 |
| Ryzen 5 2600X | 2350 |
| Ryzen 5 2600 | 2200 |
| Ryzen 3 2300X | 2100 |

---

## 5. GPU performance scores (`perf`, normalized against 15000 as the divisor) + VRAM

### Nvidia RTX 50 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RTX 5090 | 32 | 38500 |
| RTX 5080 | 16 | 32000 |
| RTX 5070 Ti | 16 | 27500 |
| RTX 5070 | 12 | 23500 |
| RTX 5060 Ti 16GB | 16 | 18500 |
| RTX 5060 Ti 8GB | 8 | 18000 |
| RTX 5060 8GB | 8 | 15500 |

### Nvidia RTX 40 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RTX 4090 | 24 | 36500 |
| RTX 4080 Super | 16 | 31000 |
| RTX 4080 | 16 | 29500 |
| RTX 4070 Ti Super | 16 | 27500 |
| RTX 4070 Ti | 12 | 25500 |
| RTX 4070 Super | 12 | 23500 |
| RTX 4070 | 12 | 21500 |
| RTX 4060 Ti 16GB | 16 | 17500 |
| RTX 4060 Ti 8GB | 8 | 17000 |
| RTX 4060 | 8 | 14500 |

### Nvidia RTX 30 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RTX 3090 Ti | 24 | 28500 |
| RTX 3090 | 24 | 26500 |
| RTX 3080 Ti | 12 | 25500 |
| RTX 3080 12GB | 12 | 24500 |
| RTX 3080 10GB | 10 | 23500 |
| RTX 3070 Ti | 8 | 21000 |
| RTX 3070 | 8 | 19500 |
| RTX 3060 Ti | 16 *(source data anomaly — real RTX 3060 Ti ships with 8GB, not 16GB; reproduced verbatim from their code, flagged not corrected)* | 17500 |
| RTX 3060 12GB | 12 | 14500 |
| RTX 3060 8GB | 8 | 14000 |
| RTX 3050 8GB | 8 | 10500 |

### Nvidia GTX 16 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| GTX 1660 Super | 6 | 8500 |
| GTX 1660 Ti | 6 | 8200 |
| GTX 1660 | 6 | 7500 |
| GTX 1650 Super | 4 | 6800 |
| GTX 1650 | 4 | 5200 |

### Nvidia GTX 10 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| GTX 1080 Ti | 11 | 16500 |
| GTX 1080 | 8 | 13500 |
| GTX 1070 Ti | 8 | 12500 |
| GTX 1070 | 8 | 11500 |
| GTX 1060 6GB | 6 | 8500 |
| GTX 1060 3GB | 3 | 7500 |
| GTX 1050 Ti | 4 | 5500 |
| GTX 1050 | 2 | 4200 |

### AMD RX 9000 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RX 9070 XT | 16 | 26500 |
| RX 9070 | 16 | 23500 |
| RX 9060 XT | 16 | 16500 |

### AMD RX 7000 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RX 7900 XTX | 24 | 34000 |
| RX 7900 XT | 20 | 29500 |
| RX 7900 GRE | 16 | 25500 |
| RX 7800 XT | 16 | 24000 |
| RX 7700 XT | 12 | 19000 |
| RX 7600 XT | 16 | 15500 |
| RX 7600 | 8 | 13500 |

### AMD RX 6000 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RX 6950 XT | 16 | 24500 |
| RX 6900 XT | 16 | 23000 |
| RX 6800 XT | 16 | 21500 |
| RX 6800 | 16 | 19500 |
| RX 6750 XT | 12 | 17000 |
| RX 6700 XT | 12 | 16000 |
| RX 6650 XT | 8 | 13500 |
| RX 6600 XT | 8 | 12500 |
| RX 6600 | 8 | 11000 |

### AMD RX 5000 Series
| GPU | VRAM (GB) | perf |
|---|---|---|
| RX 5700 XT | 8 | 14000 |
| RX 5700 | 8 | 12500 |
| RX 5600 XT | 6 | 11000 |

### AMD RX Vega / RX 500
| GPU | VRAM (GB) | perf |
|---|---|---|
| RX Vega 64 | 8 | 10500 |
| RX Vega 56 | 8 | 9000 |
| RX 590 | 8 | 7000 |
| RX 580 8GB | 8 | 6500 |
| RX 570 4GB | 4 | 5500 |

### Intel Arc (Battlemage / Alchemist)
| GPU | VRAM (GB) | perf |
|---|---|---|
| Arc B580 12GB | 12 | 15500 |
| Arc B570 10GB | 10 | 13500 |
| Arc A770 16GB | 16 | 11500 |
| Arc A770 8GB | 8 | 11000 |
| Arc A750 8GB | 8 | 10000 |
| Arc A580 8GB | 8 | 8500 |
| Arc A380 6GB | 6 | 5000 |

---

## 6. Fixed comparison-chart reference sets

The "Compare CPU & GPU" tab always benchmarks the *current* config against
a **hardcoded** set of reference parts (not the full catalog):

- **GPU tier chart**: RTX 5090, RTX 4090, RX 7900 XTX, RTX 4070 Ti, RTX
  4070, RX 7800 XT, RTX 3070, RTX 4060, GTX 1660 Super, GTX 1050
- **CPU tier chart**: Ryzen 7 9800X3D, i9-14900K, Ryzen 9 9950X, i7-14700K,
  Ryzen 7 7800X3D, Ryzen 5 7600X, i5-13600K, Ryzen 5 5600X, i5-12400F,
  Ryzen 5 3600

---

## 7. FPS smoothness brackets (unchanged from earlier extraction, included for completeness)
| Range | Label |
|---|---|
| < 30 FPS | Unplayable |
| 30–60 FPS | Playable, not smooth |
| 60–144 FPS | Smooth gaming |
| 144–240 FPS | High-refresh excellent |
| 240+ FPS | Elite / Competitive |
