# Short brief: "Your gaming monitor might still be set to 60 Hz"

**Status:** this is an ILLUSTRATIVE visual draft only. It is not approved, and nothing was voiced, spent, published or scheduled.

There is no genuine recording of a display offering 60 Hz and a higher rate. Every frame therefore carries "ILLUSTRATIVE UI DRAFT · Recreated settings · not a screen recording" in its own band. The draft names no specific higher rate.

## Why this video (a hypothesis, not proof)

The YouTube analytics you supplied suggest that the RAM troubleshooting Short's clear opening performed better than our GPU comparisons. I have not re-read those analytics here.

The test for this Short is whether a frame-0 opening that shows the problem state itself holds viewers as well. That opening is the 60 Hz setting with the question as a large caption.

One video cannot show cause. Read the 3-second retention and the average percentage viewed against the RAM Short at the same age, then decide whether to repeat the pattern.

## Verified Windows path, and how it was verified

**Source:** Microsoft Support, [Change the refresh rate on your monitor in Windows](https://support.microsoft.com/en-us/windows/change-the-refresh-rate-on-your-monitor-in-windows-c8ea729e-0678-015c-c415-f806f04aae5a). It is also served at [the display-graphics path](https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows).

**Limit:** I checked it on 2026-10-09 through web-search excerpts of that page. This environment's network policy blocks support.microsoft.com, so the page itself was not read here. Someone should open it once before the final edit.

According to those excerpts:

1. **Start › Settings › System › Display › Advanced display.**
2. With more than one display, choose the one to change first.
3. Next to **Choose a refresh rate**, select the rate.
4. "The refresh rates that appear depend on your display and what it supports."
5. Rates marked with an asterisk don't support the current resolution. Choosing one changes the resolution.

**Drawn in the draft, but not confirmed from Microsoft's text.** The recording settles these:
- the exact label of the display selector;
- the confirmation prompt's wording and buttons, and the revert timeout (third-party guides say 15 s);
- the path on Windows 10 builds before 20H2 (third-party guides use Display adapter properties › Monitor instead).

These live in `MICROSOFT_SOURCE` in `storyboard.ts`.

## Missing real footage (needed before a final)

- [ ] **The screen recording.** Record it on Windows 11 with OBS display capture at native resolution, 60 fps, with the cursor visible. Take this path at a normal pace: Settings › System › Display › Advanced display › select the display › open **Choose a refresh rate** with 60 Hz selected › pick the higher rate › confirm › show the new value retained.
- [ ] **A clean, steady 3–5 s hold** on the refresh-rate row at 60 Hz, before any change, for frame 0.
- [ ] **The display's own refresh-rate list on screen,** showing 60 Hz and the higher rates offered. That list, not a spec sheet, decides the rate the Short names.
- [ ] **The monitor's model,** plus the GPU and the connection used (cable and port), recorded in the footage record. The rates offered depend on all of them.
- [ ] **The confirmation prompt, captured as it appears.** The screen may blank during the switch, so record the prompt and the settled page, even if the switch itself drops frames.
- [ ] **A second display, if one is connected,** so "select your monitor first" shows a real choice.
- [ ] **A clean desktop:** no notifications, account names or serial numbers on screen.

**Wiring in the recording.** Set `FOOTAGE` in `storyboard.ts`: path, SHA-256, date, Windows version, monitor model, and the rates the list showed. Then:
- the higher rate's placeholder becomes that real number;
- the hook reads "144 Hz monitor. Still set to 60?" only if the list's highest rate is exactly 144 Hz (tested);
- the illustrative render refuses to run.

Cutting the recording into the story band is the next piece of work. Its crop points are the same as this draft's.

## The edit (14.0 s, 1080×1920, 30 fps)

| Time | Story band | Caption |
|---|---|---|
| 0–2 s | Frame 0 opens tight (1.8×) on **Choose a refresh rate: 60 Hz**. No intro, no desk, no zoom-in. | **High-refresh monitor. Still set to 60 Hz?** (80 px, at full size from frame 0) |
| 2–4.6 s | Settings home › **System**, then System › **Display**. The cursor moves and clicks; the page title is Windows' breadcrumb. | Open Settings › System › Display |
| 4.6–6 s | System › Display › **Advanced display**. | Then Advanced display |
| 6–7.3 s | **Select a display** opens, and Display 1 (the gaming monitor) is chosen. | Select your monitor first |
| 7.3–9.1 s | Pan to the refresh rate. The list opens on 60 Hz and **Higher rate** is picked. | Choose a refresh rate |
| 9.1–11 s | Confirmation, then **Keep changes**. The value stays and gets the one accent highlight. | Keep the change |
| 8.9 s on | **"Refresh rate isn't game FPS"**, an amber note under the setting, readable through the payoff. | |
| 11–14 s | The corrected setting holds, the cursor fades, and a small `specsmithpc.com` sits inside the scene. | **What was yours set to?** |

**What the edit leaves out:**
- no end card and no spoken site plug;
- no 60-versus-144 smoothness demonstration;
- no claim of more rendered FPS, a fix for every display problem, or 144 Hz on every monitor;
- nothing suggesting SpecSmith reads Windows settings.

`FORBIDDEN_CLAIMS` checks every caption, the note, the site line and the narration, and the render refuses on any match.

## Proposed narration (for approval; not voiced)

> Your high-refresh monitor might still be set to sixty hertz. Open Advanced display, select your monitor, then choose the higher rate it supports. What was yours set to?

**Length: 168 characters,** under the 360-character spending cap.

**Changes from your draft:**
- "its supported refresh rate" is now "the higher rate it supports". 60 Hz is also supported, so the old wording didn't say which one to pick.
- I avoided "highest": an asterisked top rate can change the resolution.

**Timing:** at the saved GPU take's pace (314 characters in 23.25 s), this runs about 12.5 s, inside 14 s. The edit is retimed to the approved take's actual delivery, as for the GPU Short.

**Before any spend:** approval of this exact text and of one Liam take (voice `TX3LPaxmHKxFdv7VOQHJ`), through the existing guarded workflow.

## Asset provenance

| Asset | Origin | Licence and status |
|---|---|---|
| Recreated settings pages, cursor and crops | Drawn by `illustrativeDraft.ts` from the steps above. The layout and greys are approximations, not Microsoft's UI. | Illustrative only; to be replaced by the real recording. |
| Inter 400/600/700 (`fonts/`) | npm `@fontsource/inter@5.3.0`, tarball integrity `sha512-RofMylZm…91A3g==`. File SHA-256s are in `draft-report.json`. | SIL OFL 1.1 (`fonts/OFL-1.1.txt`). SpecSmith's CSS names Inter (`--app-font-sans`) but the site does not ship the files; these are the upstream files. |
| Colours | `src/index.css` `--ff-*`, via `SPECSMITH_MOTION_COLOURS`. | SpecSmith's own. |
| Background bed | `musicBed.ts`: sine pad, a soft eighth-note pulse at 96 BPM, seeded noise; no samples, no melody. | Licence unknown. Making it here records how it was made; it does not establish exclusive ownership or copyright clearance. |

**The draft's audio is the bed alone,** at −38.3 LUFS integrated and −27.4 dBTP. It is deliberately quiet, a preview of texture only. The final mix puts the approved voice near −16 LUFS with the bed beneath it.

## Candid assessment

### Opening

**What works:**
- Frame 0 is the problem itself: a settings row reading 60 Hz.
- It asks one plain question, at 80 px, on screen from the first frame.
- It matches the clear-opening pattern from the RAM Short.

**What's weaker:**
- **The generic hook.** Without a verified display, it can't say "144 Hz monitor", and "High-refresh monitor" is vaguer.
- **The label band.** The illustrative band takes the top 300 px, which costs attention, though it goes away with real footage.
- **Credibility.** A recreated Settings page is less credible than a real one, and gamers know what Windows looks like. I would not publish this opening as drawn.

### Payoff

**What works:**
- The change is visible and confirmed: the list opens, the higher rate is picked, the change is kept, and the value stays highlighted.
- "Refresh rate isn't game FPS" stays readable through it.

**What's weaker:**
- **The placeholder rate.** "Higher rate" makes the payoff abstract. The real number from the real list is most of its punch.
- **No visceral payoff.** It is informational: a correct setting, not something you can see. That is honest, but it may not hold viewers as well as the RAM Short's reveal.
- **The question at the end.** "What was yours set to?" invites comments, but it is a question, not a result.

### Paths

**What works:** the five-step path reads without narration, through the breadcrumb titles plus one caption per step.

**What's weaker:** it is quick, about 1.3 s a step. With real footage, the Settings home step could be cut to give Advanced display more time.

## Checks run

- **Copy guards:** `storyboard.test.ts`, 16 tests. They cover:
  - no rate but 60 Hz without a recording;
  - "144 Hz monitor" only for an exact 144 Hz recording;
  - refusal of a recording missing 60 Hz or a higher rate;
  - refusal of copy naming an unrecorded rate;
  - eight forbidden-claim sentences refused;
  - hook at frame 0, captions continuous, 12–15 s.

  Two hand mutations each failed a test: allowing 144 Hz when the recording merely lists it, and treating 144 Hz as recorded.
- **Readability:** the render measures every string as drawn, after the crop zoom. The smallest is 44 px, or 14.7 px at 360×640; the render refuses under 42 px. It also refuses to draw in a fallback font if Inter does not load.
- **Phone-size frames:** 360×640 key frames, inspected.

## Reproduce

```
cd artifacts/SpecSmith
pnpm exec vitest run scripts/content-automator/nextVideoRefreshRate
SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
  pnpm exec tsx scripts/content-automator/nextVideoRefreshRate/illustrativeDraft.ts
```

**Output:** `render-output/refresh-rate-illustrative-draft/`. It is gitignored and contains the MP4, `phone-*.png`, `phone-sheet.png` and `draft-report.json`.

## What was reused, and what wasn't

**Reused:**
- the production banded layout;
- SpecSmith's colours;
- the pinned Chromium launcher;
- the canvas frame-drawing approach of the data motion graphics;
- the loudness measurement;
- the composed bed.

**Not used: the MASTER #6 workflow and MASTER #7 review.** Both are built around SpecSmith's catalog claims and Compare captures, and this Short has neither. A Windows UI recording would need a new declared visual kind there, so I left that to be decided rather than building it. No existing check was changed.
