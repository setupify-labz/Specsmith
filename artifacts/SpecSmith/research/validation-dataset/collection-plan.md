# Benchmark Collection Plan — Next 50 Target Observations

Generated 2026-08-18 by `research/validation-dataset/collection-plan.mjs`. Research-only. **Every row below is a target to go find a real, cited source for — not measured data.** No FPS numbers are given because none have been observed; nothing here has been or should be added to `benchmarkRecords.json` until a real source is found and verified, following the same strict anti-fabrication rules used for every prior research batch this project has done (direct-fetch preferred, reject on any contradiction, disclose every unconfirmed field via `confirmedFields`).

## Why these 50, in this order

Priority order follows the gap list as given, weighted toward the categories with literally zero existing coverage (4K, FSR, XeSS, GPU vendors besides NVIDIA, CPU vendors besides AMD) over categories that are merely thin (RT pairing, Frame Generation). Within each category, new targets are built by taking an **existing, already-verified record** and changing exactly one dimension — resolution, GPU, CPU, upscaler, or RT — so that whichever number comes back has a direct, apples-to-apples comparison already sitting in the dataset. This is deliberate: a same-settings-except-one-variable pair is far more useful for future estimator validation than an isolated new data point with nothing to compare it against.

| Priority | Gap | Count |
|---|---|---|
| P1 | 4K | 10 |
| P2 | non-Marvel 1080p | 8 |
| P3 | additional GPU tiers/vendors | 10 |
| P4 | additional CPU tiers | 6 |
| P5 | FSR/XeSS | 8 |
| P6 | RT on/off pairs | 6 |
| P7 | Frame Generation | 2 |
| **Total** | | **50** |

New catalog parts this plan pulls in (all real, verified against `gpus.json`/`cpus.json` at generation time):

- GPUs: **RTX 4060** (budgetNvidia, NVIDIA, tier 5), **RX 7600** (budgetAmd, AMD, tier 5), **Arc B580** (budgetIntel, Intel, tier 5), **RTX 4090** (flagshipNvidia, NVIDIA, tier 10), **RX 7900 XTX** (flagshipAmd, AMD, tier 9)
- CPUs: **i5-12400F** (budget, Intel, tier 5), **i9-14900K** (flagship, Intel, tier 10)

## The 50 targets

### P1 — 4K (10)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| alanwake2 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | high | on | dlss (Quality) | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (49 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| avatarfop | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | on | dlss | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-avatarfop-1440p-ultra-dlss (96 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| cyberpunk2077 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | high ("Mostly High") | on | dlss (Quality) | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| forzahorizon5 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | extreme ("Extreme") | on | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-forzahorizon5-1440p-extreme-rthigh (160 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| hogwarts | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-hogwarts-1440p-ultra-native (55 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| msfs2020 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-msfs2020-1440p-ultra (88 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| rdr2 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-rdr2-1440p-ultra-native (117 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| remnant2 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-remnant2-1440p-ultra-native (79 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| starfield | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-starfield-1440p-ultra-native (72 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |
| tlou1 | RTX 4070 Super | Ryzen 7 7800X3D | 4k | ultra | off | native | off | Pairs directly with existing 1440p record t4g-rtx4070s-r77800x3d-tlou1-1440p-ultra-native (89 FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo. |

### P2 — non-Marvel 1080p (8)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| alanwake2 | RTX 4070 | Ryzen 7 7800X3D | 1080p | high | on | dlss (Quality) | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (42 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| avatarfop | RTX 4070 | Ryzen 7 7800X3D | 1080p | ultra | on | dlss | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-avatarfop-1440p-ultra-dlss (81 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| cyberpunk2077 | RTX 4070 | Ryzen 7 7800X3D | 1080p | high ("Mostly High") | on | dlss (Quality) | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (60 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| forzahorizon5 | RTX 4070 | Ryzen 7 7800X3D | 1080p | extreme ("Extreme") | on | native | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-forzahorizon5-1440p-extreme-rthigh (135 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| hogwarts | RTX 4070 | Ryzen 7 7800X3D | 1080p | ultra | off | native | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-hogwarts-1440p-ultra-native (49 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| msfs2020 | RTX 4070 | Ryzen 7 7800X3D | 1080p | ultra | off | native | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-msfs2020-1440p-ultra (77 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| rdr2 | RTX 4070 | Ryzen 7 7800X3D | 1080p | ultra | off | native | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-rdr2-1440p-ultra-native (97 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |
| remnant2 | RTX 4070 | Ryzen 7 7800X3D | 1080p | ultra | off | native | off | Pairs with existing 1440p record t4g-rtx4070-r77800x3d-remnant2-1440p-ultra-native (69 FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game. |

### P3 — additional GPU tiers/vendors (10)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| starfield | RTX 4060 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | RTX 4060 — budget NVIDIA (tier 5) — untested tier. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-starfield-1440p-ultra-native (72 FPS) so the delta isolates GPU choice. |
| tlou1 | RTX 4060 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | RTX 4060 — budget NVIDIA (tier 5) — untested tier. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-tlou1-1440p-ultra-native (89 FPS) so the delta isolates GPU choice. |
| rdr2 | RX 7600 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | RX 7600 — budget AMD (tier 5) — zero AMD data of any kind exists yet. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-rdr2-1440p-ultra-native (117 FPS) so the delta isolates GPU choice. |
| hogwarts | RX 7600 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | RX 7600 — budget AMD (tier 5) — zero AMD data of any kind exists yet. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-hogwarts-1440p-ultra-native (55 FPS) so the delta isolates GPU choice. |
| remnant2 | Arc B580 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | Arc B580 — Intel Arc (tier 5) — zero Intel GPU data of any kind exists yet. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-remnant2-1440p-ultra-native (79 FPS) so the delta isolates GPU choice. |
| msfs2020 | Arc B580 | Ryzen 7 7800X3D | 1440p | ultra | off | native | off | Arc B580 — Intel Arc (tier 5) — zero Intel GPU data of any kind exists yet. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-msfs2020-1440p-ultra (88 FPS) so the delta isolates GPU choice. |
| cyberpunk2077 | RTX 4090 | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | on | dlss (Quality) | off | RTX 4090 — flagship NVIDIA (tier 10) — highest tier untested. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) so the delta isolates GPU choice. |
| alanwake2 | RTX 4090 | Ryzen 7 7800X3D | 1440p | high | on | dlss (Quality) | off | RTX 4090 — flagship NVIDIA (tier 10) — highest tier untested. Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (49 FPS) so the delta isolates GPU choice. |
| forzahorizon5 | RX 7900 XTX | Ryzen 7 7800X3D | 1440p | extreme ("Extreme") | on | native | off | RX 7900 XTX — flagship AMD (tier 9). Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-forzahorizon5-1440p-extreme-rthigh (160 FPS) so the delta isolates GPU choice. |
| avatarfop | RX 7900 XTX | Ryzen 7 7800X3D | 1440p | ultra | on | dlss | off | RX 7900 XTX — flagship AMD (tier 9). Same settings as existing rtx4070s record t4g-rtx4070s-r77800x3d-avatarfop-1440p-ultra-dlss (96 FPS) so the delta isolates GPU choice. |

### P4 — additional CPU tiers (6)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| msfs2020 | RTX 4070 Super | i5-12400F | 1440p | ultra | off | native | off | i5-12400F (budget, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-msfs2020-1440p-ultra (88 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |
| starfield | RTX 4070 Super | i5-12400F | 1440p | ultra | off | native | off | i5-12400F (budget, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-starfield-1440p-ultra-native (72 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |
| rdr2 | RTX 4070 Super | i5-12400F | 1440p | ultra | off | native | off | i5-12400F (budget, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-rdr2-1440p-ultra-native (117 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |
| msfs2020 | RTX 4070 Super | i9-14900K | 1440p | ultra | off | native | off | i9-14900K (flagship, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-msfs2020-1440p-ultra (88 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |
| starfield | RTX 4070 Super | i9-14900K | 1440p | ultra | off | native | off | i9-14900K (flagship, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-starfield-1440p-ultra-native (72 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |
| rdr2 | RTX 4070 Super | i9-14900K | 1440p | ultra | off | native | off | i9-14900K (flagship, Intel) vs. existing r7-7800x3d record t4g-rtx4070s-r77800x3d-rdr2-1440p-ultra-native (117 FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data. |

### P5 — FSR/XeSS (8)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| cyberpunk2077 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | on | fsr (Quality) | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) with upscaler swapped to FSR — isolates the upscaler algorithm's own FPS effect. |
| alanwake2 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high | on | fsr (Quality) | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (49 FPS) with upscaler swapped to FSR — isolates the upscaler algorithm's own FPS effect. |
| avatarfop | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | ultra | on | fsr | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-avatarfop-1440p-ultra-dlss (96 FPS) with upscaler swapped to FSR — isolates the upscaler algorithm's own FPS effect. |
| cyberpunk2077 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | on | xess (Quality) | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) with upscaler swapped to XeSS. |
| alanwake2 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high | on | xess (Quality) | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (49 FPS) with upscaler swapped to XeSS. |
| avatarfop | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | ultra | on | xess | off | Same settings as existing DLSS record t4g-rtx4070s-r77800x3d-avatarfop-1440p-ultra-dlss (96 FPS) with upscaler swapped to XeSS. |
| forzahorizon5 | RX 7900 XTX | Ryzen 7 7800X3D | 1440p | extreme ("Extreme") | on | fsr | off | FSR on its native AMD vendor GPU (RX 7900 XTX), not just cross-vendor on an NVIDIA card. |
| cyberpunk2077 | Arc B580 | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | on | xess | off | XeSS on its native Intel vendor GPU (Arc B580), not just cross-vendor on an NVIDIA card. |

### P6 — RT on/off pairs (6)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| starfield | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | ultra | on | native | off | RT-on counterpart to existing RT-off record t4g-rtx4070s-r77800x3d-starfield-1440p-ultra-native (72 FPS) — first isolated RT-cost measurement for this game. |
| rdr2 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | ultra | on | native | off | RT-on counterpart to existing RT-off record t4g-rtx4070s-r77800x3d-rdr2-1440p-ultra-native (117 FPS) — first isolated RT-cost measurement for this game. |
| tlou1 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | ultra | on | native | off | RT-on counterpart to existing RT-off record t4g-rtx4070s-r77800x3d-tlou1-1440p-ultra-native (89 FPS) — first isolated RT-cost measurement for this game. |
| cyberpunk2077 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | off | dlss (Quality) | off | RT-off counterpart to existing RT-on record t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) — first isolated RT-cost measurement for this game. |
| alanwake2 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high | off | dlss (Quality) | off | RT-off counterpart to existing RT-on record t4g-rtx4070s-r77800x3d-alanwake2-1440p-high-dlssq-rtlow (49 FPS) — first isolated RT-cost measurement for this game. |
| forzahorizon5 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | extreme ("Extreme") | off | native | off | RT-off counterpart to existing RT-on record t4g-rtx4070s-r77800x3d-forzahorizon5-1440p-extreme-rthigh (160 FPS) — first isolated RT-cost measurement for this game. |

### P7 — Frame Generation (2)

| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |
|---|---|---|---|---|---|---|---|---|
| cyberpunk2077 | RTX 4070 Super | Ryzen 7 7800X3D | 1440p | high ("Mostly High") | on | dlss (Quality) | on | DLSS 3 Frame Generation on, explicitly vendor-labeled (RTX 40-series has the required hardware) — pairs with FG-off baseline t4g-rtx4070s-r77800x3d-cyberpunk2077-1440p-high-dlssq-rtultra (73 FPS) for a clean, unambiguous FG cost/benefit measurement (unlike the existing Marvel Rivals FG record, whose vendor is not confirmed). |
| forzahorizon5 | RX 7900 XTX | Ryzen 7 7800X3D | 1440p | extreme ("Extreme") | on | native | on | FSR 3 Frame Generation on its native AMD GPU (vendor-agnostic tech, but testing on-vendor first) — pairs with the FG-off RX 7900 XTX target already in this plan (P3) for a clean FG comparison. |

## Collection rules (unchanged from every prior batch this project has run)

- Direct-fetch a real, citable article/video and read it yourself; if a domain is unreachable, say so honestly rather than substituting a search-summary silently.
- Never derive `onePercentLow`/`zeroPointOnePercentLow` from a generic "minimum" or "low" figure the source doesn't explicitly label as a percentile metric — record the raw figure in `notes` only, same as the existing Alan Wake 2 / RDR2 / Hogwarts / MSFS2020 / Avatar records already do.
- Never infer `upscalerMode`, `rayTracingState`, or `frameGenerationState` confidence from general engine knowledge — only from what the source explicitly states, and reflect any gap honestly in `confirmedFields`.
- Reject a candidate outright on any cross-source contradiction rather than averaging or guessing — this has already happened twice this project (Tom's Hardware RTX 4070 Ti Super, and a second Tech4Gamers RX 7600/RTX 4060 batch), both correctly yielding 0 accepted candidates.
- Do not add a record just to fill a matrix cell — if a real source can't be found and verified for a specific target row, leave that gap open rather than lowering the bar.

---

_Files: `collection-plan.mjs` (generator, read-only against `src/data/`), `collection-matrix.json` (machine-readable targets), `collection-plan.md` (this file). Regenerate with `node research/validation-dataset/collection-plan.mjs`. Nothing here modifies `benchmarkRecords.json` or any production file._
