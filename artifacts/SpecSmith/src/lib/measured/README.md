# Measured observations — SpecSmith's own benchmark measurements

V1 status: **schema, statistics and validation only.** The store ships empty.
Community submission is defined in the schema but deliberately not implemented.

## Why this is a separate system

`../benchmarks/` describes *someone else's* measurement that we read about —
it carries `publisher`, `publishedAt`, `evidenceQuality: A|B|C|D` and
`verificationMethod`. None of that means anything for a run we execute
ourselves. Rather than overload a type that already holds 23 real
source-derived records, this is a sibling system sharing only the catalog id
namespaces and the `Resolution`/`Preset`/`Upscaler` unions.

## The four tiers never merge

| Tier | Origin | Store | V1 |
|---|---|---|---|
| `measured` | SpecSmith-controlled hardware, raw frame times retained | `data/measuredObservations.json` | **implemented** |
| `community` | Our collector on a machine we don't control | *(not created)* | schema only |
| `source-derived` | Third-party publication | `data/benchmarkRecords.json` | unchanged |
| `estimated` | `games.json` `base_fps` formula | `data/games.json` | unchanged |

A community observation can **never** be promoted to `measured` by accumulating
agreement. Ten people agreeing is ten unverifiable claims. There is no code
path that upgrades a tier, and `separation.test.ts` enforces the boundaries
structurally.

## The pinned 1% low: mean of the slowest 1% of frames

"1% low" is genuinely ambiguous, and the two common readings give **different
numbers for the same run**:

| Method | Definition |
|---|---|
| `mean-slowest-1pct` | mean FPS of the slowest 1% of frames — **ours** |
| `p99-frametime` | the single frame time at the 99th percentile |

Comparing a figure computed one way against one computed the other is a silent
error, so the method is pinned, recorded on every observation, and recomputed
at validation. A record claiming `p99-frametime` is **rejected**, never
silently recomputed under our definition.

**The calculation**, in `frameTimes.ts`:

1. Sort frame times descending (a total order, so everything downstream is
   deterministic regardless of capture order).
2. Take `k = max(1, floor(n × 0.01))` frames.
3. Average those frame **times**.
4. Convert once: `1000 / meanFrameTimeMs`.
5. Round to two decimals through the shared `roundFps` helper.

Step 3–4 order matters. Converting each frame to an FPS value and averaging
*those* is a different (higher) number — an arithmetic-vs-harmonic mix-up.
`frameTimes.test.ts` pins this against a hand-worked example.

0.1% low uses the same calculation with `fraction = 0.001`.

## Determinism

Validation recomputes every published figure and compares it to what the record
claims, so identical input must produce identical output anywhere. Two things
are pinned to make that true:

- **Summation order.** Floating-point addition is order-dependent. Every sum
  runs over a deterministically ordered array — either capture order or after a
  total-order sort — never an iteration order that could vary.
- **Rounding.** All published figures go through one `roundFps` helper, so a
  value written to a record and a value recomputed from the same frames round
  identically.

## Raw frame times live outside git

A 60-second run at 120fps is ~7,200 floats; a corpus is millions, rewritten
wholesale on every capture. Committing them would make the repository unusable
while adding nothing a reviewer can read.

Records keep only a `FrameTimeRef` — a SHA-256 over the **canonical
uncompressed** bytes (`JSON.stringify(number[])`, so the hash is independent of
the compression used on disk), plus frame count and storage path. Blobs are
written gzipped and content-addressed by `scripts/measured/frameTimeStore.mjs`
into `.frametimes/` (gitignored; override with `SPECSMITH_FRAMETIME_ROOT`).

The measurement stays auditable: anyone holding the blob can prove it is the
one a record was computed from, and `readFrameTimes` **refuses** to return
frames whose hash disagrees with the record.

`scripts/measured/` is node-only and deliberately outside `src/`, which is
bundled for the browser and cannot import `node:crypto`. The canonical
serializer therefore exists in both halves, and a test asserts the two produce
byte-identical output so they cannot drift.

## Validation severity

Inherited from the rest of the repo: **ERROR = tooling fault** (rejected),
**WARNING = disclosed condition** (recorded, shown, kept).

Errors include: figures that don't recompute from the frames, absent frame
times, a non-pinned 1%-low method, runs under 60s or 3,000 frames, missing
driver / OS / game build / settings hash, unresolved hardware, frame generation
without a factor, a feature contradicting the game's confirmed support, and
duplicate run nonces or ids.

Warnings include: a detected cap, operator-attested settings, non-100% render
scale, single-channel memory, and a detected GPU overclock.

Two deliberate non-rejections:

- **Cap detection is a heuristic** and only ever warns. A genuinely stable run
  on over-powered hardware can look tightly clustered, and discarding a real
  measurement would be the worse error.
- **`unknown` feature support is not `unsupported`.** An unverified feature is
  never presumed broken — the same rule the source-derived engine already uses.

## What is not verified

Nothing has been measured yet. The store is empty by design: the schema and its
validation ship first so that the first real run has something to be checked
against. Cap-detection thresholds, the 60s/3,000-frame minimums, and the
hardware-resolution rules are all reasoned defaults that have not yet met a
real capture.
