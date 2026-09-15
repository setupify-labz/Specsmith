# MASTER #6 — Section 1: Proving the creative target before expanding the architecture

> Historical reference draft, not approved production copy. The $654 figures below
> cover CPU + GPU editorial reference prices only, not complete builds. Platform
> costs may differ. The original longevity, core-ageing and game-category buying
> claims are unsupported and have been removed from `sectionOnePackages.ts`.
> The ±8% range is a model convention, not calibrated uncertainty or evidence of
> real-system equivalence. Hand-written reference packages do not prove generation.

Status: creative target proof. No modules built yet. This document exists so that
implementation is driven by what three real creative packages actually needed, not
by an architecture diagram.

---

## Part A — Seam map: what already exists, what is reusable, what is missing

Read at checkpoint `100d7235f77b86eaecf218cca5b649c10c245ef1` (HEAD of
`chatgpt/master2-research-audit`, which carries MASTER #1–#5 and PR #92's human
audio gate).

### A.1 Creative and production seams (MASTER #1, reusable as-is)

| Seam | Module | What it gives MASTER #6 |
| --- | --- | --- |
| Beat model | `scripts/content-automator/types.ts` — `StoryboardBeat`, `PlatformScriptStoryboard` | The unit of creative work: `startSecond`/`endSecond`, `purpose` (`hook`/`commitment`/`evidence`/`reversal`/`payoff`/`cta`), `narration`, `visualDirection`, `onScreenText`, `factDependencies`. Concept generation must emit **this** shape or it is not wired into anything. |
| Slop detection | `v2/antiSlop.ts` — `scanForSlop`, `SlopCode`, `SlopSeverity` | Already rejects generic filler. A critique loop should call it rather than re-implement taste. |
| Quality review | `v2/creativeQualityReview.ts` — `reviewCreativeQuality`, `DimensionScore`, `ScoreProvenance`, `HUMAN_ONLY_DIMENSIONS`, `PACING_ENVELOPES`, `CPS_COMFORTABLE`/`CPS_MAX`, caption limits | Machine-checkable craft: pacing envelopes, caption density, dead time. Crucially it already distinguishes machine-scored from `HUMAN_ONLY_DIMENSIONS`, so MASTER #6 must not invent a machine "originality score" that overrides a human. |
| Beat repair | `v2/beatRepair.ts` — `repairCreative`, `RevisionLineage`, `BeatChange`, `assertUntouchedBeatsPreserved` | A revision loop **already exists** and already tracks lineage and proves untouched beats are untouched. MASTER #6's revision loop should extend this, not replace it. |
| Report | `v2/contentCreativeReport.ts` — `buildContentCreativeReport`, `HumanGate` | The single structured artifact, including what was *not* established. |
| Visual mechanism | `uiRender/uiRenderState.ts` — `UiRenderSurface` (`compare`/`builder`/`upgrade-gpu`/`upgrade-cpu`/`build-crate`), `CompareState`, `VERTICAL_1080x1920`, `parseUiRenderRequest`, `stateIdentifier` | **The most important creative asset in the repo.** SpecSmith can deterministically capture its own real product UI at vertical video size. Any visual that is a real SpecSmith page is automatically non-fabricated. |
| Fingerprint | `creativeFingerprint.ts` — `buildCreativeFingerprint(s)`, `CreativeRuntimeMetadata` | Creative identity that survives into publication and analytics. |
| Storage | `publishingStore.ts` — `createStoredPublicationLedger`, `loadStoredPublicationLedger`, `advanceStoredPublicationLedger`, `recordStoredAnalyticsSnapshot`, `loadStoredAnalyticsSnapshots`, `loadStoredCreativeFingerprint`; `STORE_VERSION`, `storageKey()`, per-`creativeId` directories, append-only indexed event files | The durable-store convention MASTER #6 memory must follow: versioned, append-only, keyed by sanitised id, parsed defensively on read. |
| Pipeline | `endToEndOfflinePipeline.ts` — stages 1, 1b, 1c, 1d, 1e, 1f, 2–9 | The real offline path. MASTER #6 wires in as a new stage adjacent to 1b (creative), consuming 1c–1f. |

### A.2 Evidence seams (MASTER #2–#5, reusable, must not be weakened)

- **Research / evidence gate** (`v2/research/`): decides whether a beat's factual assertion is allowed to be as strong as it is worded. Any generated concept must pass *through* this, not around it.
- **Strategy** (`v2/strategy/`): whether SpecSmith should make this at all.
- **Audience + platform** (`v2/audience/`, `v2/platform/`, `v2/delivery/`): `TruthInvariant`, `assertTruthPreserved`, `assertRequiredWordingPresent`, `reproducesForbiddenWording`, `buildCrossPlatformPlan`. The core truth cannot change because a platform prefers a different story.
- **Experiment** (`v2/experiment/`): `EvidenceStrength`, `MetricReading`, design hashing, `lineageId`-based independent-unit counting, `GENERALIZATION_REQUIREMENTS`. This is how a result is allowed to become a belief.

### A.3 What is genuinely missing (hypothesis, to be confirmed by Part C's critique)

1. There is no **concept generation** step at all. Storyboards are hand-authored or fixture-supplied. `repairCreative` can improve a candidate; nothing proposes candidates.
2. There is no **divergence** requirement. Nothing can state or check that three concepts are materially different rather than three rewordings.
3. There is no **memory of creative decisions**. `publishingStore` remembers publications and analytics, not "we tried this explanatory structure and this is what it cost or earned."
4. There is no **retrieval** from past results into a new creative decision, and therefore no safe way to say "this is grounded in what we learned."
5. There is no **visual-honesty classifier**. `uiRender` captures real product state honestly; nothing distinguishes an explanatory illustration from a claim of measurement.
6. There is no **uncertainty-aware comparison primitive**, which — see Part B — is the single capability all three packages turned out to need.

---

## Part B — Three creative packages for one real audience problem

### B.0 The audience problem

> **"These two builds cost exactly the same. Which one should I buy?"**

This is the canonical beginner deadlock and SpecSmith's `/compare` surface exists for it.

### B.1 The factual ground truth (verified, not asserted)

Two builds from the repository catalog (`src/data/gpus.json`, `src/data/cpus.json`):

- **Build A — RTX 5060 Ti + Core i3-13100F.** `$564 + $90 = $654`. gpu_multiplier `0.58`, cpu_multiplier `0.87`. 16 GB VRAM, 4 cores / 8 threads, LGA1700, DDR4 **or** DDR5, 238 W combined TDP.
- **Build B — RTX 4060 Ti + Ryzen 5 9600X.** `$469 + $185 = $654`. gpu_multiplier `0.53`, cpu_multiplier `0.99`. 8 GB VRAM, 6 cores / 12 threads, AM5, DDR5 only, 225 W combined TDP.

The price identity is exact — and it is an identity of **SpecSmith editorial reference prices**, not of live retail prices. `src/pages/Compare.tsx:213` states the page "does not use editorial part prices to declare a better-value build." The premise of all three packages therefore carries its own disclosure obligation.

Estimated FPS at 1440p / High, computed with the shipped model in `src/lib/fps.ts`
(`weighted = cpuMult + gpu_bound * (gpuMult - cpuMult)`), all 20 catalog games,
sorted by GPU-dependence, with the model's own declared variance band
(`min = round(est * 0.92)`, `max = round(est * 1.08)`):

| gpu_bound | Game | A | B | point gap | bands |
| --- | --- | --- | --- | --- | --- |
| 0.40 | Minecraft (Java, Optifine) | 258 | 276 | B +18 | overlap |
| 0.45 | Valorant | 266 | 282 | B +16 | overlap |
| 0.48 | CS2 | 263 | 277 | B +14 | overlap |
| 0.50 | Rainbow Six Siege | 261 | 274 | B +13 | overlap |
| 0.58 | GTA V (Enhanced) | 105 | 108 | B +3 | overlap |
| 0.62 | Apex Legends | 174 | 178 | B +4 | overlap |
| 0.65 | Fortnite | 123 | 124 | B +1 | overlap |
| 0.72 | Call of Duty: Warzone | 119 | 119 | tie | overlap |
| 0.72 | Baldur's Gate 3 | 83 | 83 | tie | overlap |
| 0.74 | Assassin's Creed Mirage | 88 | 88 | tie | overlap |
| 0.75 | Starfield | 65 | 64 | A +1 | overlap |
| 0.78 | Dying Light 2 | 73 | 71 | A +2 | overlap |
| 0.80 | Elden Ring | 73 | 72 | A +1 | overlap |
| 0.82 | Red Dead Redemption 2 | 80 | 77 | A +3 | overlap |
| 0.82 | The Witcher 3 (Next Gen) | 91 | 88 | A +3 | overlap |
| 0.85 | Spider-Man 2 (PC) | 67 | 65 | A +2 | overlap |
| 0.87 | Hogwarts Legacy | 64 | 61 | A +3 | overlap |
| 0.88 | Cyberpunk 2077 | 69 | 66 | A +3 | overlap |
| 0.92 | Microsoft Flight Simulator 2024 | 41 | 39 | A +2 | overlap |
| 0.92 | Alan Wake 2 | 54 | 51 | A +3 | overlap |

Verified against the live page at
`/compare?gpuA=rtx5060ti&cpuA=i3-13100f&gpuB=rtx4060ti&cpuB=r5-9600x&res=1440p&preset=high`
— the rendered values match the computed model exactly.

**The finding that makes this worth filming.** There is a real crossover: the
builds swap places at gpu_bound ≈ **0.706**, and the direction of the swap is
mechanically meaningful (the CPU-led build wins where frame rate leans on the
CPU; the GPU-led build wins where it leans on the GPU). But **every single one
of those twenty gaps lies inside the model's own ±8 % band.** By SpecSmith's own
stated uncertainty, the FPS estimate cannot name a winner for any game in the
catalog.

So the chart the beginner is staring at is the one thing that cannot answer their
question — while the spec lines they skip past differ decisively and are not
estimates at all: **16 GB vs 8 GB of VRAM**, **DDR4-or-DDR5 vs DDR5-only**,
**4c/8t vs 6c/12t**.

### B.2 Required disclosures (binding on all three packages)

- D1 (verbatim, from the product surface): *"FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems."*
- D2: the price identity is an identity of SpecSmith editorial reference prices, not a live retail quote.
- D3: any on-screen variance band must be identified as the model's own declared estimate range, not measured run-to-run variance.
- D4: no package may state or imply that either build was tested, benchmarked, or played.

---

### PACKAGE 1 — "The Crossover That Isn't"

**Audience experience:** spectator. The viewer watches a single continuous
argument resolve, is handed a satisfying mechanical rule, and then watches that
rule get taken away by its own error bars.

**Explanatory structure:** continuum → pattern → falsification. One axis
(GPU-dependence), twenty points on it, a crossover, then the uncertainty band
drawn over the same axis.

**Visual mechanism:** the real `/compare` surface, captured deterministically via
`uiRender` at `VERTICAL_1080x1920`, stepped through the twenty games **in
gpu_bound order** so the winner flip happens on the actual product page. Then a
single overlay: the ±8 % band drawn on both bars. The bands visibly never
separate.

**The viewer's concrete question:** "One of these has to be better. Which?"

**The useful answer they leave with:** "For frame rate, SpecSmith's estimate can't
tell these apart on any game it models — so stop deciding on the FPS bar."

**Opening words + first visual:** *"Same price. Same category. And I can show you
the exact game where they swap places."* — first frame is the real `/compare`
page already on screen, Minecraft selected, B ahead.

**Beats:**
1. `hook` (0–3 s) — the claim above, over the live page.
2. `commitment` (3–7 s) — "Watch the bars as I walk up one number: how much this game leans on the GPU."
3. `evidence` (7–22 s) — the twenty captures in gpu_bound order. B leads, gaps shrink, three ties at 0.72–0.74, A takes over.
4. `payoff` (22–30 s) — the rule named: "The crossover is around 0.71. Below it, the CPU build. Above it, the GPU build."
5. `reversal` (30–40 s) — the band appears. "Here's the range SpecSmith puts on its own estimate. It's ±8 %. Every one of those gaps is inside it — including the eighteen-frame one."
6. `cta` (40–45 s) — "The chart isn't the tiebreaker. Open the compare page with your own game and look at what's underneath it."

**Captions and audio direction:** burned-in captions throughout (audio-independent
comprehension is a product requirement). Narration flat and unhurried; no
music sting on the reversal — the reversal should feel like a correction, not a
gotcha. Caption density held under `CPS_COMFORTABLE`; the evidence beat carries
only the game name and the two numbers.

**Evidence and disclosure requirements:** D1 on screen for the whole evidence
beat, not only at the end. D3 required at beat 5. D2 at beat 1, because beat 1
asserts the price identity. Every number is derivable from `src/data/*.json` plus
`src/lib/fps.ts`; nothing is measured, so the word "benchmark" never appears.

**Product destination:** `/compare` deep-linked to the exact state shown.

**Assets and feasibility:** fully buildable today. 20 deterministic UI captures,
existing renderer, existing caption pipeline, existing narration path. The one
new asset is the band overlay.

**Why it deserves consideration:** it is the only treatment that lets the viewer
*see* the honest conclusion rather than be told it, and it converts SpecSmith's
uncertainty from a legal-sounding footnote into the punchline.

---

### PACKAGE 2 — "Two Numbers That Aren't Estimates"

**Audience experience:** investigator. The viewer is handed a method for
eliminating undecidable evidence and is then shown where the decidable evidence
actually lives.

**Explanatory structure:** elimination → substitution. Discard the estimate,
then decide on exact catalog facts. This is the inverse of Package 1: Package 1
spends its length *in* the chart and exits it at the end; Package 2 exits the
chart in the first eight seconds and never returns.

**Visual mechanism:** no chart at all. An annotated two-column spec card — the
identical `$654` struck across the top, the identical-tier lines greyed out one
by one, and the three genuinely differing lines left standing and highlighted:
VRAM 16 GB / 8 GB, memory support DDR4-or-DDR5 / DDR5-only, cores 4c8t / 6c12t.
A deliberately different visual register from Package 1: typographic and
subtractive, not animated and comparative.

**The viewer's concrete question:** "If the frame rates are basically the same,
what am I even choosing between?"

**The useful answer they leave with:** "You're not buying frames. At this price
you're choosing between VRAM headroom and a socket with an upgrade path — and
those two facts are exact, not estimated."

**Opening words + first visual:** *"I'm going to throw away the frame-rate chart
in eight seconds. Here's what's left."* — first frame is the spec card, already
populated, chart absent.

**Beats:**
1. `hook` (0–4 s) — the line above.
2. `commitment` (4–10 s) — why the chart goes: "Every gap it shows is smaller than the error bar it ships with." One still of the widest gap with its band.
3. `evidence` (10–24 s) — the elimination. Price: identical, greyed. Tier: identical, greyed. TDP: 238 W vs 225 W, greyed as immaterial. Then the three survivors, highlighted in sequence.
4. `commitment` (24–33 s) — what each survivor actually costs you: 8 GB is the line that gets crossed by texture settings; AM5 is the socket that still has chips coming; 4c/8t is the part that ages first in simulation and open-world titles.
5. `payoff` (33–40 s) — "Same money, two different bets: headroom now, or a platform later."
6. `cta` (40–45 s) — "Both spec sheets are on the compare page. Read the three lines that differ."

**Captions and audio direction:** the spec card *is* the caption layer; narration
is sparse and the card carries the text. Audio direction: quieter than Package 1,
with real silence during the elimination beat so each grey-out lands. This is the
package that works best with sound off.

**Evidence and disclosure requirements:** D1 and D3 at beat 2 (the only beat that
shows an estimate). D2 at beat 3 the moment the identical price is asserted — and
this package leans on that price harder than the others, so the editorial-price
caveat must be on the card itself, not in a trailing frame. Critically: beat 4's
statements about 8 GB VRAM and AM5 longevity are **forward-looking claims not
backed by any measurement in this repository.** They must be worded as the
mechanical consequence of a catalog fact ("8 GB is the number that texture
settings run into") and must never assert a measured or future outcome. This is
precisely the case MASTER #2's evidence gate exists for, and beat 4 must be
expected to come back hedged or rejected.

**Product destination:** `/compare`, spec-sheet region.

**Assets and feasibility:** the spec card does **not** exist. `uiRender` has no
surface that renders a two-column annotated spec comparison at vertical size, and
inventing one as a bespoke motion graphic would break the property that makes
Package 1 trustworthy — that the visual is the real product. Either a real
product surface gains this view, or the package is honestly weaker. This is the
package's main feasibility cost.

**Why it deserves consideration:** it is the only treatment that gives the viewer
something to *do* with a shopping page they can already open, and it is the only
one whose central facts carry no estimate at all.

---

### PACKAGE 3 — "One Question, Then Stop Watching"

**Audience experience:** participant. The viewer is asked one question about
themselves in the first six seconds, and the rest of the video is explicitly only
half-relevant to them — by design.

**Explanatory structure:** branch. No ranking, no winner, no crossover. Two
leaves, each fully self-contained, each ending on a different live product state.

**Visual mechanism:** a hard split-screen fork. The frame divides at beat 2 and
never rejoins; each half runs its own short argument and terminates on its own
deep-linked `/compare` state (left: a CPU-leaning game selected; right: a
GPU-leaning game selected). The mechanism is *navigational* rather than
comparative or subtractive.

**The viewer's concrete question:** "I don't know enough to judge this. Just tell
me what applies to me."

**The useful answer they leave with:** "My answer depended on one thing about me
that I already knew, and I can check it myself in ten seconds."

**Opening words + first visual:** *"Don't pick the build. Answer this: in the last
month, did you spend more hours in a shooter, or in something with a map screen?"*
— first frame is the question, full-bleed, no product UI yet.

**Beats:**
1. `hook` (0–6 s) — the question.
2. `commitment` (6–11 s) — "That's the whole decision. Here's why it's the whole decision." The frame splits.
3. `evidence` (11–26 s) — left branch: competitive titles sit at the low end of GPU-dependence, so the CPU-led build's point estimates lead there. Right branch: heavy single-player titles sit at the high end, so the GPU-led build's lead there. Each branch shows its own two or three real `/compare` captures.
4. `reversal` (26–34 s) — both halves show the same band overlay simultaneously. "In both branches the gap is inside SpecSmith's own ±8 %. So the frame rate didn't decide it — your library decided which risk you'd rather carry: 8 GB of VRAM on the right, four cores on the left."
5. `cta` (34–42 s) — each half ends on its own deep link. "Take the half that's yours."

**Captions and audio direction:** the split demands that neither half rely on
narration, because narration cannot be in two places at once. Both halves must be
readable with sound off — so this package is the most caption-dependent and the
most likely to violate `CAPTION_MAX_LINES` / `CPS_MAX` in the split region. Audio
carries only the shared beats (1, 2, 4), with the branch beats silent or under
ambience.

**Evidence and disclosure requirements:** D1 in both halves independently, since
a viewer may only ever look at one. D3 at beat 4. D4 matters most here, because
the branch framing ("this one is for you") is the framing most likely to be heard
as a tested recommendation. The claim "competitive shooters are less
GPU-dependent" is supported by the catalog's own `gpu_bound` values and must be
stated as *how SpecSmith models these games*, not as a general truth about games.

**Product destination:** two different `/compare` deep links.

**Assets and feasibility:** buildable with existing capture, but the split-screen
composite is new work in `motionCompositor.ts`, and the accessibility cost is
real and may be disqualifying at 1080×1920 — two columns of legible caption text
at 540 px logical width is close to the limit.

**Why it deserves consideration:** it is the only treatment that refuses to rank,
and refusing to rank is the most honest possible response to a comparison whose
own error bars overlap everywhere. It also produces the shortest path from
"beginner with a question" to "beginner on the right product page."

---

## Part C — Critique

### C.1 Usefulness

- **P1** is useful but ends on a negation. "Stop deciding on the FPS bar" is true and valuable, yet a viewer who came for a purchase decision leaves without one. It is the most *honest* and the least *actionable*.
- **P2** is the most useful: it replaces the discarded evidence with exact evidence and names the real trade. But its most useful beat (4) is its least defensible.
- **P3** is useful in a narrow way — it routes correctly — but it hands the viewer the same undecidable answer P1 does, just later and per-branch.

**Finding:** all three converge on one hard truth, and usefulness is decided
entirely by *what is offered in place of the answer the viewer wanted*. Only P2
offers a substitute, and the substitute is the weakest-evidenced part of the set.

### C.2 Clarity

- **P1** is clearest: one axis, one rule, one reversal.
- **P2** is clear for the first three beats and muddies at beat 4, where three independent forward-looking arguments arrive in nine seconds.
- **P3** is the least clear. The split forces the viewer to read while choosing, and the reversal at beat 4 has to land in two halves at once.

### C.3 Originality

Genuinely different along all three required dimensions:

| | audience experience | explanatory structure | visual mechanism |
| --- | --- | --- | --- |
| P1 | spectator | continuum → falsification | animated real product UI + band overlay |
| P2 | investigator | elimination → substitution | static annotated spec card, subtractive |
| P3 | participant | branch, no ranking | split-screen fork to two live states |

The shared reversal (the bands overlap) is the same *fact* in all three, which is
correct — the core truth must not change per treatment — but it arrives via three
different mechanisms and produces three different viewer takeaways. The weakest
originality claim is P3, whose evidence beats are P1's evidence beat cut in half.

### C.4 Coherence

- **P1** coherent: beat 5 is set up by beat 3.
- **P2** has a coherence flaw. It discards the chart at beat 2 on the grounds that estimates are undecidable, then at beat 4 makes forward-looking claims that are *less* evidenced than the estimates it discarded. The method it teaches indicts its own payoff.
- **P3** coherent within each branch; the union is coherent only if the viewer watches both halves, which the design tells them not to do.

### C.5 Accessibility

- **P1** passes: single column, sequential, sound-off legible.
- **P2** is the strongest — the card *is* the content.
- **P3** is at genuine risk: two caption columns at 540 px logical width, simultaneous, likely over `CAPTION_MAX_CHARS_PER_LINE` or `CPS_MAX` in the split region. This needs to be measured by `reviewCreativeQuality`, not assumed.

### C.6 Feasibility

- **P1**: buildable now. New work: band overlay. Low risk.
- **P2**: blocked on an asset that does not exist — a vertical annotated spec-comparison surface. Faking it as a motion graphic forfeits the "the visual is the real product" property.
- **P3**: buildable, but new compositor work plus a real accessibility risk.

### C.7 The critique's actual conclusion

Writing these three by hand surfaced things a module inventory would not have:

1. **The reversal is the content.** All three packages' best moment is the same: the model's own uncertainty invalidating the model's own comparison. Nothing in the repo can *find* that moment — `estimateFps` returns `min`/`max`, and nothing anywhere asks whether two estimates are separable given their bands. I computed it with a throwaway script. This is the single highest-value missing capability, and it is a *creative* capability, not an analytics one.
2. **Honesty degrades treatments unevenly, and that is a design signal.** P2 is the most useful and the most exposed; P1 is the safest and the least actionable. A concept generator that does not know this will keep proposing P2-shaped ideas and keep watching the evidence gate hollow them out at beat 4.
3. **Divergence is checkable, but not on wording.** The table in C.3 is the real definition: audience experience, explanatory structure, visual mechanism. Three concepts that differ only in opening line would produce an identical row.
4. **Visual honesty is a real, currently unguarded risk.** P1's band overlay and P3's split are both *illustrative*. Neither is a measurement, and nothing in the repo would stop a future concept from rendering an "airflow simulation" that looks measured. MASTER #6's brief names this explicitly; the packages confirm it is not hypothetical.
5. **Feasibility must be a first-class creative input, not a post-hoc rejection.** P2's blocker is that `UiRenderSurface` has five members and none of them is a spec card. A concept generator that cannot see the capability surface will keep producing unbuildable best ideas.
6. **What we would want to remember is not what `publishingStore` stores.** The useful memory here is "elimination-then-substitution structures get hollowed out by the evidence gate at their payoff beat" — a claim about a *structure*, attached to an outcome. There is nowhere to put that.

### C.8 Capabilities that would materially improve these packages

Ranked by how much each would have changed the three packages above. Implementation
should follow this list and stop where the list stops.

| # | Capability | Which package needed it | Why it is not cosmetic |
| --- | --- | --- | --- |
| 1 | **Separability analysis** — given two `FpsResult`s, report whether their declared bands overlap, and never report a winner when they do | all three | Produces the reversal beat. Without it the repo can generate a confident, wrong video. |
| 2 | **Visual-honesty classification** — every visual declared `real-product-capture` / `derived-illustration` / `decorative`, with illustrations required to be visibly explanatory and forbidden from implying measurement | P1 band, P3 split | Directly required by the brief; currently unguarded. |
| 3 | **Concept generation into `StoryboardBeat[]`** with explicit audience-experience / explanatory-structure / visual-mechanism axes | all three | Nothing proposes candidates today. |
| 4 | **Divergence checking** on those three axes | the set, not any one package | Otherwise "three concepts" is unverifiable. |
| 5 | **Capability-aware feasibility** — concepts declare required surfaces/assets; unavailable ones are surfaced as a *known gap*, not a silent failure | P2 | Turns P2's blocker into information instead of a dead end. |
| 6 | **Critique/revision loop** extending `repairCreative` + `scanForSlop` + `reviewCreativeQuality`, with lineage | P2 beat 4, P3 captions | The loop exists for beats; it does not exist for concepts. |
| 7 | **Creative memory** — append-only, `publishingStore`-shaped, recording structure/mechanism decisions against outcomes, with `unknown` outcomes first-class | future packages | The lesson in C.7.2 has nowhere to live. |
| 8 | **Grounded retrieval** — past decisions surfaced into a new brief *only* with their evidence strength attached, reusing MASTER #5's `EvidenceStrength` so a single anecdote can never be retrieved as a rule | future packages | Without the evidence binding, memory becomes superstition. |

Capabilities deliberately **not** proposed, because nothing in these three packages
needed them: audience persona generation, trend chasing, engagement prediction,
automated scoring of originality or taste (`HUMAN_ONLY_DIMENSIONS` stays human),
and any generic "creative asset library."
