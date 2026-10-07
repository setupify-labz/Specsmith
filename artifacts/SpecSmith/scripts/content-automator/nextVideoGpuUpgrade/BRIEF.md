# Next Short brief (revised): "Which game gets the bigger percentage boost?"

**Status:** the existing workflow says this is ready for human review. It is **not approved**. A 3-second silent visual prototype of the revised opening exists. Nothing else has been rendered, no voice of any kind was generated, nothing was spent, and nothing was published.

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
- The author chooses a `template` (`upgrade-intro`, `game-labels`, `fps-change` or `percent-change`), catalog `games`, and a `baseline`.
- The author never types a number or a game name.

**What the system guarantees:**
- **Values are computed** at the mission's primary Compare state, using the same functions Compare uses.
- **Full catalog game names** are always used.
- **Numbers must be backed by research, as a whole.** Approved claims now carry their structured evidence: each supporting observation's configuration and values. Each game's values a graphic shows must match one of those observations on all of these at once:
  - the game;
  - the resolution and preset;
  - the CPU;
  - the before and after GPU, which fixes the direction;
  - the before and after FPS;
  - the percentage, for `percent-change`.

  Matching digits in a sentence is no longer enough. A flipped baseline that would show 65 → 43 uses digits that appear in the Alan Wake 2 claim, and it is refused.
- **Other settings are refused.** A graphic sourced from any state other than the primary view is refused.
- **The disclosure is required.** The estimate disclosure is mandatory on every beat that shows a graphic, as it is for the Compare capture.
- **Variety means different data.** Each template-and-game set is its own picture for shot variety. The same graphic under another id is the same picture.
- **Text must stay readable.** Every string is fitted at ≥ 64 px (names and figures) or ≥ 34 px (labels) in the 1080-px frame. Text that doesn't fit fails the render; it is never shrunk further or cut.
- **SpecSmith colours** come from `src/index.css` (`--ff-*`): background `#0A0A0F`, card `#1C1C26`, text `#F0F0FF`, accent `#6C63FF`/`#9B94FF`, cyan `#00D4FF`.
  - **Font:** SpecSmith's Inter is not installed or bundled here, so the renderer uses DejaVu Sans. Swapping the font is a one-line change once Inter is available.

**Tests:** `dataMotionGraphic.test.ts`, 12 tests.
- One test changes exactly one field of the evidence at a time, and each change is refused.
- I then removed each part of the tuple match in turn (game, resolution, preset, CPU, direction, FPS values, percentage). Every removal made a test fail.
- The earlier guard checks still hold: primary view only, disclosure, picture identity.

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
- **Brief** `2b6947b5…` (it now carries each approved claim's structured evidence), attempt 2, batch `4a46239b…`. Every machine check passed under the stricter binding, and the status is `awaiting-human-review`, `approved: false`.
- Attempt 2 changes only Concept A's opening beat. B and C are unchanged.

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

1. **Hook:** the new `upgrade-intro` graphic. The question as a headline, the RTX 4060 → RTX 5070 upgrade once, then the two game panels. Caption: "Same CPU. New GPU."
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

- **The hook is the exact question,** as a frame-one headline above the two full game names, with the upgrade happening from frame 0. It's the cleanest test of the opening-caption hypothesis.
- **The viewer commits to a guess,** and the percentage reveal is the payoff. The FPS beats before it set up the trap: Valorant adds more frames but the smaller percentage.
- **Risk:** at 28.5 s it is the longest, near the 30 s limit. If timing slips in voicing, cut the "why" beat to 3 s.

### 2. C

- **It teaches the frames-vs-percentage trap most directly,** and it is now fully claim-backed.
- **Its hook is a statement, not a question,** so the viewer has less reason to stay for the answer.

### 3. B

- **It is the shortest (22 s) and the most explicit about limits.**
- **There's no participation,** and its second caption ("Same upgrade, two games") is the weakest line in the set.

## Creative improvement to test, and how it is measured

The test: the spoken hook's question is readable as full-size text from **frame 0**, with no fade. In this opening it is the headline at the top of the story band, and the caption band carries the first spoken line.

**Pre-publish check (pass/fail, from the file):**
- Frame 0 shows the question as text rows covering at least 3.1% of the frame height.
- **The prototype measures 14.3%:** the three-line headline spans rows 60–334 of the story band, in a 1920-px frame. It passes. The caption "Same CPU. New GPU." measures 2.3% on its own, one line.

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

## The 3-second opening (Concept A, 0–3 s), revised

**File:** `render-output/next-video-gpu-upgrade-prototype/gpu-upgrade-opening-prototype.mp4`. It is gitignored.
- SHA-256: `b8f32cabe78b0c04da8e2c4a4e3ff59a6555015e871f4230720f30681aeda87f`.
- 1080×1920 at 30 fps, silent.
- Phone-size frames are in the same folder (`phone-*.png`, 390 px wide, an iPhone's CSS width), with a contact sheet in `phone-sheet.png`.

**How it was built.** It uses the production banded layout:
- **Disclosure band:** the disclosure-overlay adapter, verbatim. 36 px type, contrast 19.5:1.
- **Story band:** the new `upgrade-intro` template. The smallest type drawn is 42 px.
- **Caption band:** the production caption style.

**What the template draws.** All of it is computed:
- the question from the mission;
- the GPU and CPU names from the catalog;
- the setting from the Compare state;
- the games' full names from the catalog.

It shows no values, so it binds no claim.

| Time | What happens (muted, it reads as the question being set up) |
|---|---|
| 0.00 s (frame 0) | The question, **"Which game gets the bigger percentage boost?"**, is a 3-line headline at the top. Below it, **RTX 4060** is on screen and **RTX 5070** is already rising into place under it. "Same Ryzen 5 7600 · 1440p High" sits underneath. Caption: "Same CPU. New GPU." |
| 0.00–0.70 s | The upgrade happens once. The downward arrow draws by 0.4 s, RTX 4060 dims, and RTX 5070 lands with an accent border. |
| 0.70–1.05 s | The finished upgrade holds, briefly. |
| 1.05–1.45 s | The upgrade rises and clears. The same facts settle as a compact header under the question: "RTX 4060 → RTX 5070" and "Same Ryzen 5 7600 · 1440p High". |
| 1.20–2.05 s | Two large panels arrive, one after the other: **Alan Wake 2** (accent purple) and **Valorant** (cyan), in full names at up to 124 px. |
| 2.25–2.75 s | Each panel gains its label, in turn: "estimated % boost · 1440p High". |
| 2.55–2.90 s | The question's key words, "bigger percentage boost?", take the accent colour, tying the panels back to the question. |

**What this revision removed:**
- the empty tracks;
- the "+?%" markers and their hold;
- the idle pulsing;
- the question in the bottom caption, where it sat below the games.

Every movement is a step in the question arriving.

**Found and fixed during phone-size inspection:**
- Side-by-side GPU chips can't fit at the 64 px minimum, and the renderer refused them rather than shrinking the text. The upgrade is now stacked vertically.
- On frame 0, the rising RTX 5070 chip touched the CPU line. The line now sits below the chip's lowest position.
- A nearly empty hand-off frame around 1.4 s. The panels now arrive from 1.2 s.

**Later scenes, unchanged, not part of these 3 s:**
- **FPS:** "Alan Wake 2, 43 → 65, Estimated FPS".
- **Percentage:** "+51%, estimated boost · (65 − 43) ÷ 43" and "+16% · (305 − 263) ÷ 263".

## Full visual draft (Concept A, attempt 3)

**What changed in Concept A (attempt 3):**
- It is tightened to **21.5 s**, six beats: question, Alan Wake 2 FPS, Valorant FPS, the percentage reveal, why, close.
- The separate "Pick one" beat is gone. The opening already asks the question with both games on screen.

**What changed in the opening:**
- Both games are large panels from frame 0.
- The RTX 4060 → RTX 5070 upgrade is a compact row above them, finished within 0.8 s.

**How it was rendered.** It went through the production pipeline (`master6OfflineRender.renderProposalOffline`, now able to take a mission and silent narration):
- the workflow checks;
- the production plan;
- the production adapters: Compare capture, data motion graphics, disclosure panel, captions, compositor;
- the banded frame check and its broken controls.

**Result:**
- **File:** `render-output/next-video-gpu-upgrade-draft/master6-boost-guess-the-game-youtube-shorts-youtube-shorts-compose.mp4`.
- **Format:** 1080×1920 at 30 fps, 21.57 s.
- **SHA-256:** `0fea74c5f95d0cf8e0e6876f2087dfbf9485dca49a0942efc4227b38472964ef`.
- **Frame check:** passed, 14 samples.
- **Controls:** all three broken renders were refused: disclosure blanked, disclosure drawn over the story, a repeated picture.
- **Audio:** silence of the planned length. No voice and no robotic placeholder. The planned lines and timings are recorded beside it. See `VOICE_SCRIPT.md`.

**Found and fixed while rendering:**
- **Unapproved numbers on screen.** The graphics counted up through numbers no claim states ("43 → 43", "263 → 304", "+48%", "+12%"). The renderer now shows a figure only at its final value; only the bar length grows.
- **Looping clip.** The compositor looped a motion clip when the final beat was held for the narration tail, so the closing scene restarted. Motion clips now hold their last frame. The frame check caught this.
- **Colours swapping.** The colours changed when a scene listed Valorant first. Each game now keeps one colour for the whole video, by first appearance: Alan Wake 2 purple, Valorant cyan.
- **Leftover placeholders.** The closing `game-labels` scene still drew empty tracks and "+?%". It now shows full names and labels only.

## Revised visual draft (Concept A, attempt 4): the final third

**What changed:**
- **Length:** 21.5 s → **19.0 s**. The game beats keep 3.6 s and 3.2 s, so the names are not rushed.
- **The percentages arrive beside the results.** Each percentage card keeps that game's estimated FPS result ("43 → 65", "263 → 305"). It also shows the calculation from the rounded estimates: "(65 − 43) ÷ 43 · rounded estimates".
- **The Compare screenshot (15.5–19 s) is gone.** The same comparison stays on screen as a settled `explain` stage that adds "Same upgrade. Different gains by game."
- **No spoken GPU-weighting explanation.** The `model-weights-games` claim is no longer used.
- **New ending.** The comparison stays visible as an `ask` stage: "Which game would you upgrade for?", with `specsmithpc.com/compare` as a small line inside the graphic.
- **Label fix.** The caption is now "Estimated percentage boost: 51% vs 16%". It was "51% vs 16% · Estimated FPS", which labelled percentages as FPS.
  - **Cause:** every percentage claim inherited only the FPS label rule.
  - **Fix:** percentage claims (`derivedPercentage`) now also require "Estimated percentage boost". The evidence gate refuses a percentage labelled only as FPS.
  - **Concepts B and C** had the same caption and are fixed the same way.
- **Trimmed narration.** "SpecSmith's model estimates" is said once instead of three times, the second "estimated FPS" is dropped, and the model-weights line is gone.

**Beats:**

| Time | Picture | Narration (planned, not spoken) | Caption |
|---|---|---|---|
| 0–3.0 | upgrade-intro | Same CPU, new GPU. Which game gets the bigger percentage boost? | Same CPU. New GPU. |
| 3.0–6.6 | fps-change Alan Wake 2 | At 1440p High, SpecSmith estimates Alan Wake 2 goes from 43 to 65 FPS. | Alan Wake 2: 43 → 65 Estimated FPS |
| 6.6–9.8 | fps-change Valorant | Valorant goes from 263 to 305. | Valorant: 263 → 305 Estimated FPS |
| 9.8–13.8 | percent-change, reveal | That's an estimated 51% boost for Alan Wake 2, and just 16% for Valorant. | Estimated percentage boost: 51% vs 16% |
| 13.8–16.4 | percent-change, explain | Same upgrade, different gains by game. | (inside the graphic) |
| 16.4–19.0 | percent-change, ask | Which game would you upgrade for? | (inside the graphic, with the link line) |

**How the stage text stays honest:**
- **Fixed text.** Stage lines are never author text, and each one is drawn only when the graphic's own values make it true:
  - "Same upgrade" holds because every game in the graphic shares one pairing and one direction;
  - "Different gains by game" needs at least two games whose percentages differ;
  - the ask stage links the concept's product destination, and is refused without one.
- **Picture identity.** A later stage counts as a new picture because it adds a new statement. The same stage under a different visual id still counts as the same picture.
- **Caption shown once.** A caption that is exactly the graphic's line is shown once, inside the graphic. Any other caption stays in the caption band.
- **Same checks.** The frame check uses the captions the plan actually renders. The required-wording check reads the labels the graphic draws, as well as the narration and the caption.

**Vertical fit.** The cards and a stage's line are laid out from fixed sizes that are never below the readable minimum (`percentChangeLayout`). With three games, the explain or ask line would need 1,564 px against the 1,276 px the story band allows. That configuration is refused in two places:
- the workflow (`motionGraphicProblems`);
- the renderer, before drawing.

As a further check, the renderer records anything drawn past the band's bottom edge. Two games in any stage and three games in the reveal fit. Re-rendering the two-game edit after this change produced the same SHA-256.

**Result:**
- **File:** `render-output/next-video-gpu-upgrade-draft-2/master6-boost-guess-the-game-youtube-shorts-youtube-shorts-compose.mp4`.
- **Format:** 1080×1920 at 30 fps, 19.07 s.
- **SHA-256:** `53fdb7a7b873779ef038fa05c08f8292aa2359076d39f14f0cbafd058de2b99a`.
- **Frame check:** passed, 14 samples.
- **Controls:** all three broken renders were refused.
- **Audio:** silence of the planned length. No voice was generated.

## Final cut: prepared, waiting for spend approval (Concept A, attempt 5)

**Script:** the trimmed 314-character narration is approved for the take; see `VOICE_SCRIPT.md`. The 392-character version was set aside:
- it was over the unchanged 360-character spending cap;
- at Liam's measured pace it would have run about 29–30 s;
- its opening would have run about 4.1 s, over MASTER #1's hook limit.

The trimmed version is predicted at about 23.6 s, with a 2.7 s hook.

**The one paid step (not run):**
- **How it runs:** manual dispatch of `elevenlabs-voice-sample.yml` with `script: gpu-upgrade`, `confirm: generate` and `review_pr: 176`.
- **Guards before the request:** the shared spending guards are unchanged (360 cap, no overage, enough included characters, the pinned Liam id), plus a recomputation of every spoken figure and a line-by-line check against the concept.
- **Hand-over:** a job with no secret posts the take to #176.

**After the take** (`finalRender.ts`, which never calls a provider):
1. **Load:** the saved take is loaded only if it is the approved text in pinned Liam, with the audio its manifest hashes and the provider's timestamps.
2. **Retime:** beats and captions follow the actual delivery on a 0.1 s grid. The take itself is never edited.
3. **Check:** the retimed batch goes back through every workflow check.
4. **Render:** the production pipeline renders it, with restrained synthesized sound effects under the voice. The effects are cut whooshes, ticks as figures land and pops as percentages appear, about 17–21 dB under speech peaks.
5. **Review:** MASTER #7 reviews the exact MP4 and writes its review packet.
6. **Retries:** a failed render is re-run from the same saved bytes.

**Dry run (fixture voice, labelled DRY RUN, never delivered):**
- **Pipeline:** passed end to end.
- **Frame check:** passed, and its three broken controls were refused.
- **Effects:** 17.4 dB under the voice peak.
- **MASTER #7:** `awaiting-human-review`. Still open: three person checks (safe area, reading the on-screen text at phone size, listening), the fixture placeholder, and the voice's licence.

## Final cut (rendered from the saved take, 2026-10-07)

**The take:** one Liam generation (run 37624439839), 314 characters sent, provider-reported charge 126. Saved in `take/`; see `take/PROVENANCE.md`.

**The final MP4:** `render-output/gpu-upgrade-final/gpu-upgrade-final.mp4`, not checked in.
- **Format:** 1080×1920 at 30 fps, 24.5 s.
- **SHA-256:** `75e5a4380516af910016eb3011edfa5049c4394d5ca5f5b120f96a075898d5b1`.
- **Same bytes twice:** re-rendering from the saved take produced identical bytes.

**Beats, timed to Liam's delivery:**

| Beat | Picture | Liam speaks |
|---|---|---|
| Opening | 0–2.8 s | 0–2.14 s |
| Alan Wake 2 | 2.8–8.4 s | 2.95–7.81 s |
| Valorant | 8.4–12.4 s | 8.51–11.90 s |
| Percentages | 12.4–18.6 s | 12.60–18.10 s |
| Explanation | 18.6–21.4 s | 18.80–20.81 s |
| Question | 21.4–24.5 s | 21.50–23.22 s |

**Checks:**
- **Frame check:** passed on 14 samples; all three broken controls were refused.
- **Sound effects:** peak at −20.2 dBFS, 15.8 dB under the voice's −4.4 dBFS peak.
- **Loudness:** the whole cut is −24.2 LUFS integrated.

**MASTER #7 review packet** (`final/review-packet.txt`): `awaiting-human-review`, with no machine-found defect. Still open:
- three checks only a person can do: the safe area on a real phone, reading the text at real size, and listening to the take;
- `rights-unknown` for the voice: the ElevenLabs account's commercial-use terms are not recorded in this repository;
- eight human gates.

**Review fix found by the real take.** Liam pauses about 0.7 s between lines, so each cut whoosh plays in a pause. MASTER #7's narration-timing check measured all audio and reported the whooshes as sound outside the narration. The check now accepts sound inside the render's declared sound-effect windows, only when that asset's bytes verified, and binds the inputs it reads. The video did not change.

## Mastered final mix (2026-10-07)

**What changed:**
- **Audio only.** The video stream is byte-identical to the unmastered cut, and every decoded frame matches.
- **Same take, timing and picture.** No new voice was generated.
- **New file:** `gpu-upgrade-final.mp4`, SHA-256 `d78538cbc5e06673b593c6a70ddab21df90aafebb3a4f38096d3ee837a07d2eb`, 24.5 s, AAC at 48 kHz.
- **Re-bound:** the render manifest and the MASTER #7 review packet were regenerated for these bytes.

**Loudness, measured on the encode:**

| Meter | Integrated | True peak | Range |
|---|---|---|---|
| EBU R128 (`ebur128 peak=true`) | −16.1 LUFS | −2.0 dBTP | |
| `loudnorm` analyzer (cross-check) | −16.12 LUFS | −1.96 dBTP | 4.6 LU |

The sample peak is −1.96 dBFS and there is no clipping (flat factor 0).

**Method** (the compositor's `loudness` option, `masterToLoudness`):
- **Gain:** one constant +8.6 dB for the whole mix, so voice and effects move together.
- **Limiter:** a 4×-oversampled lookahead limiter at −2.0 dBFS, with no auto-level and its delay compensated.
- **Verification:** the encode itself is measured, iterating until both targets hold (two passes here).
- **Not used:** dynamic normalization (`loudnorm`), because it would ride the gain up in Liam's pauses, where the effects sit.

**Balance and timing:**
- **Effects vs voice loudness:** effects peak 3.9 dB above the voice's integrated loudness before mastering, 4.4 dB after.
- **Limiter activity:** it acts only on the voice's transients — more than 1 dB in 8.8% of speech, more than 3 dB in 1.0%, at most 6.2 dB. The effects never reach it.
- **Timing:** speech onsets inside lines match the take to within about 10 ms.

**Checks:** the frame check passed and its three controls were refused. MASTER #7 is `awaiting-human-review`, with the same open items as before.

## Open before production

- **Voice:** none generated. Any voice, especially a paid one, needs its own approval.
- **Human review:** creative, readability at phone size, rights and disclosure, and publishing authorization. These are listed in `workflow-percent/review-packet.json`.
- **Font:** Inter instead of DejaVu Sans, if it can be bundled.
