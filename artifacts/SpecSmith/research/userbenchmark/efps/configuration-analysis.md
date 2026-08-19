# EFPS Configuration Decoding — Evidence and Status

> **Research-only.** Every claim below is derived from page sources a human
> already saved to `research/userbenchmark/pages/`. Nothing was fetched,
> crawled, or requested. No value here is a SpecSmith verified benchmark
> record — these are crowd-sourced, self-reported third-party numbers.

**Status: partially proven.** Three of the four EFPS URL fields and three of
the five game-page filter-path positions are proven from the source's own
markup. The rest are explicitly marked unresolved and preserved raw. No
meaning has been assigned to any field that the evidence does not support.

**Evidence base:** three saved sources — Fortnite (3954), PlayerUnknown's
Battlegrounds (3944) and Counter-Strike: Global Offensive (3680) — containing
**600 EFPS objects** and **147 distinct filter paths** in total. Every
structural claim below holds identically on all three.

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

All 600 objects across the three saved sources parse into this shape; none
deviate.

---

## 2. URL payload structure — PROVEN

The path after `/EFps/` is **three `_`-separated groups of four `,`-separated
fields**. This holds for 600/600 objects with no exceptions:

```
/EFps/  ,1660-Ti,,  _  ,5700-XT,,  _  Fortnite,,9400F,
        └─ group 1 ─┘   └─ group 2 ─┘  └──── group 3 ────┘
         variant A       variant B        base / shared
```

Measured arity across all 600 records: group count `3` (600/600), field count
per group `4` (1,800/1,800 groups).

### Field positions

| Field | Meaning | Status | Evidence |
|---|---|---|---|
| 0 | **Game** | **proven as the record's own game — NOT as the host page's game** | Non-empty in exactly one group (group 3) across all 800 records seen. Holds three distinct values — `Fortnite`, `PUBG`, `CSGO`. **Correction:** an earlier version of this report said each value matches "its own page's identity." That was true of the first three captures and is false in general — see §5a. The token identifies the record; it does not certify the page. |
| 1 | **GPU** | **proven** | 15 distinct values, all GPU models, disjoint from field 2's value set. |
| 2 | **CPU** | **proven** | 11 distinct values, all CPU models, disjoint from field 1's value set. |
| 3 | *unknown* | **UNRESOLVED** | Never populated in any of the 1,800 groups. No page link, filter control, or script populates it. |

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
correct for 600/600 records.

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

Measured across all 519 comparison records in the three saved sources:

| Title side A corresponds to | Count |
|---|---:|
| URL group 1 | 273 |
| URL group 2 | 246 |

**A parser assuming `title side A === URL group 1` is wrong on 246 of 519
records — 47.4%.** (The Fortnite page alone gives 91 / 82 — the same ratio,
independently reproduced on each source.)

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

> **1,014 comparison sides were cross-checkable against a direct record.
> 1,014 agreed exactly. 0 mismatches.** (338 of these come from Fortnite; the
> remainder from PUBG and CS:GO, captured later and parsed with no code change
> to the decoding itself.)

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

## 5a. The EFPS block does not always belong to its host page — CORRECTION

**This supersedes a claim made in the first version of this report.**

The EFPS array is rendered inside a select2 "compare" widget
(`$(".select_choose_yt").select2({... data:{ results: [...] }})`). Capturing a
fourth page showed that this widget is **not guaranteed to describe the page it
sits on**:

| Page | gameId | Page samples | EFPS tokens in its widget |
|---|---:|---:|---|
| Fortnite | 3954 | 87,737 | `Fortnite` × 200 |
| Counter-Strike: Global Offensive | 3680 | 151,690 | `CSGO` × 200 |
| PlayerUnknown's Battlegrounds | 3944 | 75,383 | `PUBG` × 200 |
| **7 Days to Die** | **3959** | **525** | **`CSGO` × 200** |

7 Days to Die publishes 200 EFPS records that are entirely Counter-Strike's —
apparently a fallback dataset for a low-sample title (525 samples against
151,690 for CS:GO). The first three captures all happened to own their blocks,
which is what made the original "matches its own page's identity" reading look
proven. Three agreeing samples were not enough.

**Why the §5 cross-check could not catch this.** The borrowed records are
internally consistent *with each other* — CS:GO's comparison sides agree
perfectly with CS:GO's direct records regardless of which page they are printed
on. The cross-check therefore reported 1352/1352 agreement while an entire
block belonged to another game. Self-consistency validates the decoding; it
says nothing about ownership. The two checks are independent and both are
required.

**The rule now enforced.** A page may publish EFPS only for tokens it can be
shown to own, derived from the page itself:

1. the parenthetical abbreviation in `<title>` — `(CSGO)`, `(PUBG)`;
2. the game name with non-alphanumerics stripped — `Fortnite`, `7DaystoDie`.

Records whose token matches neither are **quarantined**, not attributed: they
go to `dataset/rejected-records.jsonl` with reason
`efps-game-token-mismatch`, keeping their raw source text. They are never
re-filed under the token's game either — we hold no evidence that this page's
copy is a faithful capture of that game's page, and we already have the real
CS:GO page.

The affected page keeps everything it genuinely owns: 7 Days to Die still
contributes its average FPS (47.8), sample count (525), 20 GPU rows, 20 CPU
rows and all three charts. Only the borrowed block is withheld.

---

## 5b. The cause is the CAPTURE ROUTE, not the game — CORRECTION TO §5a

**This supersedes the explanation given in §5a.** The quarantine rule itself was
right and is unchanged; the *reason* stated for it was wrong.

§5a attributed 7 Days to Die's borrowed CS:GO block to it being a low-sample
title (525 samples). A corpus of 18 pages disproves that. Battlefield 1 has
thousands of samples and carries CS:GO's block too. Sample count does not
predict it. Capture route does — perfectly, across all 18 pages:

| Pages | How saved | Widget state in the file | EFPS tokens |
|---|---|---|---|
| Fortnite, PUBG, CS:GO | raw page source | `select_choose_yt` un-enhanced | **the page's own game** |
| the other 15 | live DOM ("Save Page As") | select2 applied (`s2id_autogen…`) | **`CSGO` × 200, every time** |

The tell is in the markup. A raw-source save preserves `<div
class="select_choose_yt" style="width:100%">` exactly as the server sent it. A
live-DOM save shows select2 has already run and rewritten that subtree
(`id="s2id_autogen1"`, `select2-choice`, `select2-chosen`). Every file with the
un-enhanced widget carries its own game's EFPS data; every file with the
enhanced widget carries Counter-Strike's.

CS:GO's own page is the ambiguous case — its own data *is* CS:GO's, so it
agrees with both readings and proves nothing either way. Fortnite and PUBG are
what make the correlation decisive.

**Consequence for capture.** A plain Ctrl+S "Save Page As" yields **zero usable
EFPS records** for the target game, whatever the game's popularity. Everything
else on the page survives that route intact — average FPS, sample count, 20 GPU
and 20 CPU rows, all three charts — so such a save is still a valid capture,
just an EFPS-less one. Saving the raw page source instead (Ctrl+U, then save)
is what preserves the EFPS block.

**What did not change.** The ownership quarantine in `lib/efps.mjs` is
load-bearing exactly as before, and more so than §5a implied: on this corpus it
rejected 3,000 records across 15 pages that would otherwise have been published
under 15 different game names. It rejected none of the three pages that own
their blocks. The rule keys on the game token, not on sample count, so it was
never relying on the mistaken explanation.

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

## Cross-game confirmation

The two limitations the first version of this report listed have since been
resolved by capturing PUBG and CS:GO. Both were parsed by the **same code**,
with no change to any decoding rule:

| | Fortnite (3954) | PUBG (3944) | CS:GO (3680) |
|---|---:|---:|---:|
| EFPS objects | 200 | 200 | 200 |
| Direct / comparison | 27 / 173 | 27 / 173 | 27 / 173 |
| Rejected | 0 | 0 | 0 |
| Cross-checked sides | 338 | 338 | 338 |
| Mismatches | 0 | 0 | 0 |
| Field 3 populated | never | never | never |
| Filter positions 2–3 populated | never | never | never |

**Field 0 now holds three distinct values** — `Fortnite`, `PUBG`, `CSGO` — each
matching its own page's identity, so "field 0 = game" is confirmed across
games rather than for a single value.

Two of the three tokens are **not** the catalog name:

| Catalog name | EFPS token |
|---|---|
| Fortnite | `Fortnite` |
| PlayerUnknown's Battlegrounds | `PUBG` |
| Counter-Strike: Global Offensive | `CSGO` |

This is direct evidence for §3's argument: a classifier that strips a
`gameName + " "` prefix from the title matches on **one** of these three. The
structural rule matched all 600 records.

## Limitations

1. **Absence of evidence for field 3 / positions 2–3.** These being unused on
   all three saved sources does not prove they are meaningless — only that
   nothing available exercises them. They are preserved raw so a future source
   that populates them is detected rather than silently misread.
2. **Three of 316 games captured.** The decoding is now confirmed across
   template variants, but the corpus is still small. Nothing in the analysis
   depends on the missing pages; only the volume of extracted records does.
3. **No page JavaScript was executed.** Conclusions come from reading markup
   and inline script text statically.

## Reproducing

```
node research/userbenchmark/ingest.mjs        # regenerates coverage + validation
node research/userbenchmark/test/run-tests.mjs  # asserts every claim above
```

The cross-validation in §5 is `crossValidateEfps` in `../lib/validate.mjs`;
the ordering-trap measurement in §4 is asserted in
`../test/efps.test.mjs` ("both orderings occur in the real source").
