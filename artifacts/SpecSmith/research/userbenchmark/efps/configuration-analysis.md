# EFPS Configuration Decoding — Evidence and Status

> **Research-only.** Every claim below is derived from page sources a human
> already saved to `research/userbenchmark/pages/`. Nothing was fetched,
> crawled, or requested. No value here is a SpecSmith verified benchmark
> record — these are crowd-sourced, self-reported third-party numbers.

**Status: partially proven.** Three of the four EFPS URL fields and three of
the five game-page filter-path positions are proven from the source's own
markup. The rest are explicitly marked unresolved and preserved raw. No
meaning has been assigned to any field that the evidence does not support.

**Evidence base:** the saved Fortnite source
(`pages/FPS-Estimates-Fortnite-3954.html`, game id 3954), containing **200
EFPS objects** and **49 distinct filter paths**. PUBG and CS:GO pages are
**not currently captured** — see [Limitations](#limitations).

---

## 1. The EFPS object

UserBenchmark game pages embed a JavaScript array of objects:

```js
results: [{
    id: 'https://www.userbenchmark.com/EFps/,,,_,,,_Fortnite,2060S,3600,',
    t: 'Fortnite 3600 2060S',
    p: '131'
}, {
    id: 'https://www.userbenchmark.com/EFps/,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,',
    t: 'Fortnite 5700-XT vs 1660-Ti - 9400F',
    p: '137 vs 108'
}]
```

- `id` — an EFPS permalink whose path encodes the configuration
- `t` — a human-readable title
- `p` — the FPS value(s), as a string

All 200 objects in the saved source parse into this shape; none deviate.

---

## 2. URL payload structure — PROVEN

The path after `/EFps/` is **three `_`-separated groups of four `,`-separated
fields**. This holds for 200/200 objects with no exceptions:

```
/EFps/  ,1660-Ti,,  _  ,5700-XT,,  _  Fortnite,,9400F,
        └─ group 1 ─┘   └─ group 2 ─┘  └──── group 3 ────┘
         variant A       variant B        base / shared
```

Measured arity across all 200 records: group count `3` (200/200), field count
per group `4` (600/600 groups).

### Field positions

| Field | Meaning | Status | Evidence |
|---|---|---|---|
| 0 | **Game** | **proven** | Non-empty in exactly one group (group 3) across all 200 records, always the literal `Fortnite`, matching the page's own `gameId`/slug. Never populated in groups 1–2. |
| 1 | **GPU** | **proven** | 15–16 distinct values, all GPU models, disjoint from field 2's value set. |
| 2 | **CPU** | **proven** | 10–11 distinct values, all CPU models, disjoint from field 1's value set. |
| 3 | *unknown* | **UNRESOLVED** | Never populated in any of the 600 groups. No page link, filter control, or script populates it. |

Observed field-1 values (all GPUs): `1050-Ti, 1060-3GB, 1060-6GB, 1070, 1650,
1660, 1660-Ti, 1660S, 2060, 2060S, 2070S, 2080, 570, 5700, 5700-XT, 580`

Observed field-2 values (all CPUs): `2600, 2600X, 2700X, 3600, 3700X, 9100F,
9350KF, 9400F, 9600K, 9700K, 9900K`

The two sets are completely disjoint and each is internally consistent as a
single component class. This is what makes the GPU/CPU assignment a
determination rather than a guess.

### Group roles

| Group | Role | Evidence |
|---|---|---|
| 3 | Base / shared configuration | Always carries the game. On a comparison, carries whichever dimension is *held constant*. |
| 1, 2 | The two compared variants | Both empty ⇒ direct record. Populated ⇒ comparison; they carry the dimension that *varies*. |

Worked examples:

```
,,,_,,,_Fortnite,2060S,3600,          → direct: game=Fortnite, GPU=2060S, CPU=3600 → 131 FPS
,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,  → GPU comparison; CPU=9400F held constant in base
,,3600,_,,9600K,_Fortnite,2060S,,       → CPU comparison; GPU=2060S held constant in base
```

Note the complementary pattern: in a GPU comparison the base group's GPU slot
is empty and its CPU slot is filled, and vice versa. The varied dimension
lives in groups 1–2; the fixed dimension lives in group 3.

---

## 3. Direct vs comparison classification — PROVEN, and why not by name

Classification uses the **URL structure**: groups 1 and 2 entirely empty ⇒
`direct`; any value present ⇒ `comparison`. This is name-independent and
correct for 200/200 records.

### Why the game-name prefix approach is wrong

An earlier approach classified by stripping a `gameName + " "` prefix from the
title. That breaks on real data:

1. **The EFPS token is not the catalog name.** The EFPS URL and title use a
   short token (`PUBG`, `CSGO`) while the catalog name is
   `PlayerUnknown's Battlegrounds` / `Counter-Strike: Global Offensive`. The
   prefix never matches, so the record is misclassified or dropped.
2. **Game names contain the delimiters.** A name containing ` vs ` or ` - `
   corrupts a title-based split.
3. **Titles are not guaranteed present.** An empty `t` would defeat the method
   entirely, while the URL still fully describes the configuration.

The structural rule depends on none of this. The title's ` vs ` marker and the
`p` field's two-sidedness are retained only as **independent cross-checks**; a
disagreement is recorded as a warning on the record rather than silently
resolved.

---

## 4. The title/URL ordering trap — MEASURED

**The order of the two sides in `t` does not reliably match the order of URL
groups 1 and 2.**

Measured across the 173 comparison records in the saved source:

| Title side A corresponds to | Count |
|---|---:|
| URL group 1 | 91 |
| URL group 2 | 82 |

**A parser assuming `title side A === URL group 1` is wrong on 82 of 173
records — 47.4%.**

Two records that demonstrate the inconsistency directly:

```
id: '...,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,'
t:  'Fortnite 5700-XT vs 1660-Ti - 9400F'      ← title REVERSED vs URL
p:  '137 vs 108'

id: '...,1060-3GB,,_,1660,,_Fortnite,,9400F,'
t:  'Fortnite 1060-3GB vs 1660 - 9400F'        ← title MATCHES URL order
p:  '76 vs 94'
```

### What is reliable

`t` and `p` are written in the **same** order. So the `(label, fps)` pairing
taken positionally from title and value is sound:

- `5700-XT → 137`, `1660-Ti → 108`
- `1060-3GB → 76`, `1660 → 94`

The extractor therefore pairs label-to-FPS by position **within `t`/`p`**, then
resolves which URL group each side came from by **matching the label token
against that group's own field values** — never by position. Where a token is
absent or ambiguous, the side is kept with its raw label and flagged
`variantResolved: false` rather than guessed.

---

## 5. Independent verification of the whole decoding

The decoding above is confirmed by a self-consistency check that the source
itself makes possible: many comparison sides describe a `(game, GPU, CPU)`
configuration that **also** appears as a standalone direct record. Those two
independently-encoded values must agree.

> **338 comparison sides were cross-checkable against a direct record.
> 338 agreed exactly. 0 mismatches.**

This simultaneously validates the field assignment (field 1 = GPU, field 2 =
CPU), the title/value pairing, and the token-based variant resolution. Any of
those being wrong would produce mismatches at this scale. Verified example
chain:

```
'Fortnite 9400F 5700-XT'                   → 137            (direct)
'Fortnite 9400F 1660-Ti'                   → 108            (direct)
'Fortnite 5700-XT vs 1660-Ti - 9400F'      → '137 vs 108'   (comparison — agrees)
```

This check runs on every ingest (`efpsCrossValidation` in `dataset/coverage.json`)
and as a test, so a future regression in any of the three mechanisms fails
loudly.

---

## 6. Game-page filter path — PARTIALLY PROVEN

Game page URLs end in five `.`-separated positions, e.g.
`/PCGame/FPS-Estimates-Fortnite/3954/153864.0.0.0.0`.

| Position | Meaning | Status | Evidence |
|---|---|---|---|
| 0 | **GPU id** | **proven** | All 20 GPU table rows link to a path where only position 0 is set, to a numeric id. `Nvidia GTX 1060-6GB` → `153864.0.0.0.0`, and its component page is `gpu.userbenchmark.com/.../Rating/3639`. |
| 1 | **CPU id** | **proven** | All 20 CPU table rows link to a path where only position 1 is set. `AMD Ryzen 5 2600` → `0.476362.0.0.0`, component page on `cpu.userbenchmark.com`. |
| 2 | *unknown* | **UNRESOLVED** | Never populated by any of the 49 distinct filter paths on the page. |
| 3 | *unknown* | **UNRESOLVED** | Never populated by any of the 49 distinct filter paths. |
| 4 | **CPU family filter** | **proven** | The quick-filter buttons produce `0.0.0.0.i9`, `0.0.0.0.Ryzen`, `0.0.0.0.FX`, `0.0.0.0.Athlon`, `0.0.0.0.i3/i5/i7`, `0.0.0.0.Pentium` — a literal family name, not an id. |

The complete set of 49 observed paths falls into exactly three shapes:
`<gpuId>.0.0.0.0` (20), `0.<cpuId>.0.0.0` (20), `0.0.0.0.<family>` (8), plus
the unfiltered canonical `0.0.0.0.0`.

**Positions 2 and 3 are deliberately NOT named `resolutionFilter` /
`settingsFilter`.** That naming appeared in an earlier version of the parser
and has been removed: it is an invented meaning with no supporting evidence.
They are now exposed as `position2` / `position3` and listed in
`unresolvedPositions`. If a future saved source ever populates them, the
validator raises a `config.unresolved-position` warning pointing straight at it.

---

## 7. Resolution and settings — NOT PRESENT as an EFPS dimension

This is the most consequential negative finding.

**Neither the EFPS URL nor the game-page filter path encodes resolution or
quality settings on any saved source.** Checks performed:

- No EFPS URL populates field 3 (0 of 600 groups).
- No filter path populates position 2 or 3 (0 of 49 paths).
- The page contains no resolution or settings filter control that emits a URL.
  Searching for `720p`/`1080p`/`1440p`/`4K` finds them **only** as labels of
  the resolution pie chart. Searching for `Low`/`Med`/`High`/`Max` finds them
  **only** as labels of the settings pie chart. (`Ultra` appears 17 times but
  every occurrence is a product name — `Intel Core Ultra 7 265K`, `SanDisk
  Ultra 3D 250GB` — not a quality preset.)

Resolution and settings exist on the page **only as page-level aggregate
distributions**:

```
settings:   Low 35,239 · Max 24,091 · High 14,531 · Med 13,876
resolution: 1080p 54,761 · 720p 29,451 · 1440p 3,447 · 4K 78
```

These are counts over the whole game's sample pool. **They cannot be joined to
any individual EFPS observation.** A record such as `Fortnite 3600 2060S → 131
FPS` carries no indication of which resolution or preset it represents; it is
an aggregate across the mix shown above.

### Why this matters

Any downstream use must treat an EFPS value as *"FPS at an unspecified,
mixed distribution of resolutions and settings"* — not as a 1080p number, and
not as a High-preset number. Attributing one would be fabrication. The
pipeline records this as `configurationStatus` and never fills the gap.

---

## 8. What is explicitly NOT decoded

| Item | Why not |
|---|---|
| EFPS field 3 | Never populated. No evidence of any kind. |
| Filter positions 2 and 3 | Never populated. No evidence of any kind. |
| Resolution per observation | Not encoded anywhere (§7). |
| Settings per observation | Not encoded anywhere (§7). |
| Bench % → FPS | **Refused by design.** Bench %/Value % are UserBenchmark's own composite scores with no published FPS relationship. Converting them would manufacture data. They are carried in the datasets as their own fields with an explicit non-convertibility note. |
| Numeric component id ↔ EFPS token | The filter path uses numeric ids (`153864`); EFPS uses short names (`2060S`). No page content maps one to the other, so no mapping is asserted. |

---

## Limitations

1. **Single-source evidence.** All conclusions rest on one saved game page.
   The structure is highly regular and internally cross-validated (§5), but a
   second and third page would confirm the decoding generalizes across
   template variants. **PUBG (id 3712) and CS:GO (id 3680) are not currently
   captured** — see `../capture-manifest.json`.
2. **One game token observed.** Field 0 has only ever held `Fortnite`, so
   "field 0 = game" is proven for one value. A second page confirms it
   immediately.
3. **Absence of evidence for fields 3 / positions 2–3.** These being unused on
   every saved source does not prove they are meaningless — only that nothing
   available exercises them. They are preserved raw so a future source that
   populates them is detected rather than silently misread.
4. **No page JavaScript was executed.** Conclusions come from reading markup
   and inline script text statically.

## Reproducing

```
node research/userbenchmark/ingest.mjs        # regenerates coverage + validation
node research/userbenchmark/test/run-tests.mjs  # asserts every claim above
```

The cross-validation in §5 is `crossValidateEfps` in `../lib/validate.mjs`;
the ordering-trap measurement in §4 is asserted in
`../test/efps.test.mjs` ("both orderings occur in the real source").
