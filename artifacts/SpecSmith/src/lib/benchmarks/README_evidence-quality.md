# Verified Benchmarks — evidence quality & ingestion workflow

This is the doc `types.ts` refers to for the `EvidenceQuality` grades and the
provenance-field checklist. It didn't exist as a committed file before —
this is the first version, written from what the code (`types.ts`,
`lookup.ts`, `validate.ts`) actually implements today. If a more detailed
original spec exists outside this repo, reconcile it against this file
rather than treating this as a from-scratch redefinition.

## The rule this whole system exists to enforce

Every FPS number `lookupVerifiedFps` can return must trace to a real, cited
source. There is no formula fallback, no interpolation between nearby
records, no "close enough" match. If no record satisfies the query exactly,
callers get `NOT_AVAILABLE` and the UI says so — never a guess presented as
measured data. See `lookup.ts`'s doc comment on `lookupVerifiedFps` for the
exact-match rules this produces (resolution, preset, ray tracing, upscaler
*and mode*, frame generation must all match precisely).

This is a different, stricter contract than the FPS **Estimator**
(`lib/fps.ts` + `gpus.json`/`cpus.json`/`games.json`), which is a
tier-based heuristic the team maintains itself — see `About.tsx` for how
that's disclosed to users. The two systems must never be conflated: a
verified record is measured; an Estimator number is a maintained guess.
Nothing in this doc applies to the Estimator's data.

## `gameFeatureProfiles.json` is intentionally independent of `games.json`

A game does **not** need to exist in `games.json` (the Estimator's own
catalog) to have a `GameFeatureProfile` and verified benchmark records —
and a game in `games.json` does not automatically have either. These are
two separate namespaces on purpose: `games.json` entries carry
Estimator-specific shape (a `base_fps` grid per resolution×preset,
`gpu_bound` weighting) that a verified-only game has no use for. Marvel
Rivals proves this works today — it has a profile and 3 verified records
with zero presence in `games.json`.

The namespace that actually matters for a `BenchmarkRecord.gameId` is
`gameFeatureProfiles.json` — that's what `VerifiedBenchmarkPanel`'s game
dropdown is built from (`getVerifiedGames()` in `lookup.ts`), and what
`validateBenchmarkRecord` checks against. A record for a game with no
profile would compile and pass every other check, but be permanently
unreachable from the UI. Whether that gameId is *also* in `games.json` is
a separate, softer question, surfaced honestly (not as an error) via
`getCoverageSummary().gamesNotInEstimatorCatalog`.

Do not add a "must also exist in `games.json`" requirement anywhere in
this system — that coupling was considered and deliberately rejected.

## `EvidenceQuality`: A / B / C / D

**Status: no rubric for what separates these grades is written down
anywhere else in the codebase.** All 3 records seeded so far are graded
`B`, and there is currently no code or doc that defines what would make a
source `A`, `C`, or `D` instead. The starting point below is a proposal,
not a ratified standard — revise it the first time a real record doesn't
fit cleanly, and update this file when you do (don't let the rubric drift
out of sync with practice the way the missing doc itself did).

Proposed:

- **A** — First-party lab methodology with disclosed test conditions
  (published benchmark suite, reproducible steps, hardware/driver versions
  stated), from an outlet whose benchmarking is their primary output
  (e.g. a dedicated hardware-review publication's own charts).
- **B** — A real, attributed number from a publication or retailer that
  ran the test, but with an incompletely disclosed methodology (settings
  partially stated, driver/game version not given, etc.) — this is where
  all current records sit.
- **C** — Community/enthusiast-sourced (forum post, video comment,
  user-submitted benchmark) with enough detail to be plausible but no
  editorial or institutional accountability behind it.
- **D** — Anecdotal or thinly-specified ("I get like 90fps") — probably
  shouldn't clear the bar for inclusion at all; kept as a grade rather than
  a rejection so a borderline case can be recorded and revisited rather
  than silently dropped.

`evidenceQuality` grades the *source's own rigor*. It is a separate axis
from `verificationMethod` (below), which grades *how SpecSmith obtained*
the claim from that source — a top-tier outlet's number that was only ever
seen via a search-engine summary is still `verificationMethod:
'search-summary'`, regardless of how good the source itself is.

## `verificationMethod`: `search-summary` vs `direct-fetch`

- `direct-fetch` — the source page itself was retrieved and read directly.
- `search-summary` — a web search returned a citation and a paraphrased
  claim about the page's content; the page itself was never directly read
  by a human or model that produced this record.

All 3 records currently in `benchmarkRecords.json` are `search-summary` —
the source domain (evetech.co.za) is blocked by this environment's own
egress proxy, so it has never actually been re-read to confirm the exact
wording of the claims it's recording. This is disclosed in each record's
`notes` field. Upgrading an existing `search-summary` record to
`direct-fetch` (by actually reading the source and confirming the numbers)
is real, valuable ingestion work that adds zero new benchmark data — it
only strengthens the confidence behind data already in the system.

## `confirmedFields`: only claim what you actually checked

`REQUIRED_PROVENANCE_FIELDS` (`types.ts`) lists every field the checklist
covers: `cpu, gpu, resolution, preset, rayTracingState, upscaler,
upscalerMode, frameGenerationState, averageFps, onePercentLow,
zeroPointOnePercentLow, nativeVsDisplayed, methodology,
sourcePublicationDate, evidenceGrade, sourceUrl`.

`confirmedFields` is the subset you can actually stand behind after
reading the source. Anything not in that list is a **disclosed gap**, not
an assumed default:

- If the source didn't state ray tracing status, don't put
  `rayTracingState` in `confirmedFields` and don't guess `rayTracing:
  true/false` based on what "seems likely" — record what the source
  actually says, and if it says nothing, that's a gap to note in `notes`,
  not fill in.
- If `frameGeneration: true`, `nativeVsDisplayed` **must** be in
  `confirmedFields` — `validate.ts` enforces this as a hard error. A
  frame-generation-boosted number can never be presented as if it were
  independently rendered FPS without the record explicitly confirming
  that distinction was made.

## Adding a new record — the actual steps

1. Find a real, attributable source: an article, video, or published chart
   with a specific GPU + CPU + game + settings + FPS number. Prefer
   sources you can access directly over search-summaries.
2. Fill out every `BenchmarkRecord` field (`types.ts`) using **only** what
   the source states. Leave optional fields (`upscalerMode`,
   `driverVersion`, `onePercentLow`, etc.) unset rather than inferring
   them.
3. Set `confirmedFields` to exactly what you verified — see above.
4. Write `notes` explaining anything non-obvious: rounding decisions,
   inferences you made and why (e.g. inferring FSR vs DLSS from hardware
   capability when the source didn't name it — see the seeded frame-gen
   record for a real example), and what's still unconfirmed.
5. `gpuId`/`cpuId` must match an id already in `gpus.json`/`cpus.json`.
   `gameId` must match (or be added as) an entry in
   `gameFeatureProfiles.json` — that file, not `games.json`, is what makes
   a game selectable in the Verified Benchmarks panel. If the game has no
   profile yet, add a minimal one with all five features set to
   `{ status: 'unknown' }` rather than guessing their support — each gets
   upgraded to a real status later, independently, as it's actually
   confirmed. Never set a status other than `'unknown'` without a source
   for that specific feature.
6. `preset` must be one of the five normalized tiers (`low/medium/high/
   ultra/extreme`). If the source's actual setting name is more specific
   (e.g. "Extreme" in a game whose own menu also has a separate "Ultra"),
   set `presetLabel` to that verbatim name and explain the mapping in
   `notes`. If the setting doesn't cleanly fit any of the five tiers,
   don't force it — reject the record instead.
7. Run `pnpm run validate:benchmarks` before committing. It checks schema
   validity, catalog references, evidence-field consistency, and the
   frame-generation rule above — see `validate.ts`. A record that fails
   this should not be merged.
8. Never add a record for a number you couldn't find a real source for,
   even to "fill a gap" in coverage. An empty cell that honestly says "no
   verified benchmark available" is the entire point of this system — see
   `lookup.ts`'s doc comment on why there's no formula fallback.

## Checking the current state

- `pnpm run validate:benchmarks` — runs the same checks CI would, against
  whatever is currently in the JSON files.
- `/admin/benchmarks` (not linked from the site, `noindex`) — live
  coverage numbers, cross-catalog gaps, and any current validation issues,
  rendered from the same `lookup.ts`/`validate.ts` functions.
