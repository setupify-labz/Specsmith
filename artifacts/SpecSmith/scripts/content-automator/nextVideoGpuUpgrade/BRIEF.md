# Next Short brief (revised): "Which game gets the bigger percentage boost?"

**Status:** the existing workflow says this is ready for human review. It is **not approved**. A 3-second silent visual prototype of the opening exists. Nothing else has been rendered, no voice of any kind was generated, nothing was spent, and nothing was published.

The first brief ("Will a new GPU make every game faster by the same amount?") and its five attempts stay in `workflow/` as history. This revision lives in `workflow-percent/`.

## What changed, and why

- **The question is now precise:** "Which game gets the bigger percentage boost?"
- **1440p High throughout.** The first brief only passed MASTER #1's shot-variety check by cutting to other settings (1080p, 4K, Ultra). No claim covers those numbers, so they are gone. The mission now has a single view.
- **Shot variety comes from one new, reusable capability,** described below. It shows different data at the same state, not different settings.
- **The percentages are new approved claims,** computed from clearly identified model values and labelled as estimates.

## The new capability: data motion graphics

It adds one declared visual kind, `data-motion-graphic`. It is not a new framework. It runs through the existing concept model, file workflow, proposal pass, MASTER #1 storyboard review, production plan and render-adapter registry.

**Code:**
- `v2/creative/dataMotionGraphic.ts`: the model, the value resolver and the checks.
- `v2/creative/dataMotionGraphicRender.ts`: the render adapter.
- Small edits to the existing modules.

**How an author uses it:**
- The author chooses a `template` (`game-labels`, `fps-change` or `percent-change`), catalog `games`, and a `baseline`.
- The author never types a number or a game name.

**What the system guarantees:**
- **Values are computed** at the mission's primary Compare state, using the same functions Compare uses.
- **Full catalog game names** are always used.
- **Numbers must be backed by research.** Every figure a graphic shows must appear in an approved claim bound on that beat, or the beat is refused.
- **Other settings are refused.** A graphic sourced from any state other than the primary view is refused.
- **The disclosure is required.** The estimate disclosure is mandatory on every beat that shows a graphic, as it is for the Compare capture.
- **Variety means different data.** Each template-and-game set is its own picture for shot variety. The same graphic under another id is the same picture.
- **Text must stay readable.** Every string is fitted at ≥ 64 px (names and figures) or ≥ 34 px (labels) in the 1080-px frame. Text that doesn't fit fails the render; it is never shrunk further or cut.
- **SpecSmith colours** come from `src/index.css` (`--ff-*`): background `#0A0A0F`, card `#1C1C26`, text `#F0F0FF`, accent `#6C63FF`/`#9B94FF`, cyan `#00D4FF`.
  - **Font:** SpecSmith's Inter is not installed or bundled here, so the renderer uses DejaVu Sans. Swapping the font is a one-line change once Inter is available.

**Tests:** `dataMotionGraphic.test.ts`, 10 tests. Each guard below was disabled in turn, and every time a test failed: figure binding, primary-view-only, disclosure, picture identity.

**One existing test changed on purpose.** With graphics available, a single-view mission's shot repetition is now something the author can fix, so it is reported as `required` rather than "blocked outside the author". It still blocks the batch, and the test still proves it.

## What may be said

Every figure comes from the shipped model at **1440p High, same Ryzen 5 7600, RTX 4060 → RTX 5070** (`compare_rtx5070_r5-7600_vs_rtx4060_r5-7600_1440p_high_static_540x960-2`).

Research snapshot `specsmith-model-f434ab70dde4e6fa`, run 2026-10-06T20:51Z. All claims are strongly supported, and each carries the on-screen label **Estimated FPS**.

| Claim | Value | Computed from |
|---|---|---|
| Alan Wake 2 | 43 → 65 Estimated FPS | Compare's displayed estimates |
| Valorant | 263 → 305 Estimated FPS | Compare's displayed estimates |
| Alan Wake 2 estimated boost | **51%** | (65 − 43) ÷ 43, from the two displayed estimates |
| Valorant estimated boost | **16%** | (305 − 263) ÷ 263, from the two displayed estimates |
| Bigger percentage boost | Alan Wake 2, 51% against 16% | One observation carrying both percentages |
| Why | The model gives Alan Wake 2 far more GPU weight (0.92 vs 0.45) | `games.json` |

**Precision note.** The percentages are computed from the whole-FPS estimates Compare displays, so a viewer can redo them from the screen. The model's unrounded ratio for Alan Wake 2 is 1.496, about 50%, because Compare rounds the model's 43.42 and 64.94 to 43 and 65. Valorant's unrounded values are 263.34 and 305.46, a ratio of 1.16, the same 16%. The brief uses the on-screen values and names the formula wherever a percentage appears.

**Refused, unchanged from the first brief:**
- "The CPU matters less at 4K": false of the model.
- "The better purchase": no prices or buyer profile.
- "Measured on real hardware": these are estimates only.

## How it went through the workflow

- **#174's learning:** report `external-fb62299dbff66267` enters as 13 labelled memory lines. The TikTok snapshots are exploratory context only, not evidence that a format won.
- **Brief** `853c7176…`, attempt 1, batch `1b8bcb8d…`. Every machine check passed and the status is `awaiting-human-review`, `approved: false`.

To reproduce:

```
cd artifacts/SpecSmith
pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/workflowCli.ts review
SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/prototype.ts
```

## Three concepts

All three stay at 1440p High, and all are under 30 s.

| | Concept | Structure | Length | Distinct pictures |
|---|---|---|---|---|
| A | **Guess the game** (`boost-guess-the-game`) | participant · prediction → reveal | 28.5 s | 6 of 7 beats |
| B | **Read the percentage** (`boost-read-the-percentage`) | investigator · question → evidence → boundary | 22 s | 5 of 5 |
| C | **More frames ≠ bigger boost** (`boost-more-frames-smaller-boost`) | spectator · continuum → falsification | 26 s | 6 of 6 |

### A: Guess the game

1. **Hook:** game-label graphic. "Which game gets the bigger percentage boost?"
2. **Pick:** the real Compare capture. "Alan Wake 2, or Valorant? Pick one."
3. **Alan Wake 2:** FPS graphic counts 43 → 65.
4. **Valorant:** FPS graphic counts 263 → 305.
5. **Reveal:** percentage graphic, +51% vs +16%, each with its formula.
6. **Why:** Compare capture. The model gives Alan Wake 2 far more GPU weight.
7. **Close:** "Check the games you actually play." The route appears on screen only.

### B: Read the percentage

1. **Hook:** Compare capture. "A new GPU won't boost every game equally."
2. **Both games' FPS:** 43 → 65 and 263 → 305.
3. **Percentage graphic:** 51% vs 16%.
4. **Boundary:** "Model estimates, not benchmarks. They can't tell you if it's worth it."
5. **Close:** "Look up the games you play first."

### C: More frames ≠ bigger boost

1. **Hook:** "More frames doesn't mean a bigger boost."
2. **Valorant:** 263 → 305.
3. **Alan Wake 2:** 43 → 65, fewer frames added.
4. **Reversal:** percentage graphic, 51% against 16%.
5. **Why:** the GPU weighting.
6. **Close:** "Judge the boost in the games you play."

The first brief's version of C rested on an unapproved derived line. It now uses only approved percentage claims.

## Ranking

### 1. A (recommended)

- **The hook is the exact question,** as a frame-one caption over the two full game names. It's the cleanest test of the opening-caption hypothesis.
- **The viewer commits to a guess,** and the percentage reveal is the payoff. The FPS beats before it set up the trap: Valorant adds more frames but the smaller percentage.
- **Risk:** at 28.5 s it is the longest, near the 30 s limit. If timing slips in voicing, cut the "why" beat to 3 s.

### 2. C

- **It teaches the frames-vs-percentage trap most directly,** and it is now fully claim-backed.
- **Its hook is a statement, not a question,** so the viewer has less reason to stay for the answer.

### 3. B

- **It is the shortest (22 s) and the most explicit about limits.**
- **There's no participation,** and its second caption ("Same upgrade, two games") is the weakest line in the set.

## Creative improvement to test, and how it is measured

The test is unchanged from the first brief: the spoken hook appears as a full-size caption from **frame 0**, with no fade.

**Pre-publish check (pass/fail, from the file):**
- Frame 0 shows the hook caption in caption-coloured text rows covering at least 3.1% of the frame height.
- **The prototype measures 6.9%:** rows 118–249 of the 320-px caption band, in a 1920-px frame. It passes.

**Post-publish outcome (YouTube):**
- **What to read:** the share still watching at 3 s on the audience-retention curve, plus average percentage viewed.
- **How:** both are read by a trusted YouTube source 48 h after a confirmed publication time.
- **Comparison:** against `fps-20-wins@ce47598` at the same age.
- **Decision rule:** if the new Short matches or beats it, keep frame-one captions for the next two Shorts. Otherwise treat the hypothesis as not supported.
- **Limits:** this is one directional observation, not a causal result. It is blocked today: there is no YouTube credential, and the FPS Short has no confirmed publication time.

## Branding

- **On screen only, never spoken:**
  - SpecSmith's own Compare page and SpecSmith-coloured graphics.
  - The "SpecSmith model estimates · 1440p High" header.
  - The `specsmithpc.com/compare` route in the last caption.
- **The spoken close is advice:** no spoken promotional outro.

## The 3-second visual prototype (Concept A, 0–3 s)

**File:** `render-output/next-video-gpu-upgrade-prototype/gpu-upgrade-opening-prototype.mp4`. It is gitignored.
- SHA-256: `bb2be00cafe9d50f8c1a5194c9f9fce3e0fc28d811b0cc0f97d9fa4899860d87`.
- 1080×1920 at 30 fps, silent.
- It re-renders byte-identical.

**How it was built.** It uses the production banded layout and production renderers:
- **Disclosure band, 0–300 px:** the disclosure-overlay adapter, verbatim. 36 px type, contrast 19.5:1.
- **Story band, 300–1600 px:** the new adapter, rendering the beat's `game-labels` graphic from values the proposal pass resolved. The smallest type drawn is 36 px.
- **Caption band, 1600–1920 px:** the production caption style.

**What happens in the 3 seconds:**

| Time | Picture | Caption | Overlay |
|---|---|---|---|
| 0.00 s (frame 0) | "SpecSmith model estimates · 1440p High" and "RTX 4060 + Ryzen 5 7600 → RTX 5070". Two cards, **Alan Wake 2** (accent purple) and **Valorant** (cyan), already readable 48 px from their places. Each has an empty boost track, a pulsing **+?%** and "estimated boost" | "Which game gets the bigger / percentage boost?", fully visible | Estimate disclosure, verbatim |
| 0.00–0.6 s | The cards slide 48 px into place, staggered by 0.12 s | Holds | Holds |
| 0.6–3.0 s | Hold, with the **+?%** markers pulsing on a 1.2 s cycle. No figure appears before it is backed by a claim | Holds | Holds |

**Later scenes, checked, not part of the 3 s.** These are single frames rendered with the same adapter:
- **FPS:** "Alan Wake 2, 43 → 65, Estimated FPS".
- **Percentage:** "+51%, estimated boost · (65 − 43) ÷ 43" and "+16% · (305 − 263) ÷ 263".

They are readable in full names. The number-to-bar spacing in the percentage card was widened after inspection.

## Open before production

- **Full-pipeline render:** run the whole Concept A video through the production plan, including the graphic beats with the compositor and the banded frame check. Not run yet.
- **Voice:** none generated. Any voice, especially a paid one, needs its own approval.
- **Human review:** creative, readability at phone size, rights and disclosure, and publishing authorization. These are listed in `workflow-percent/review-packet.json`.
- **Font:** Inter instead of DejaVu Sans, if it can be bundled.
