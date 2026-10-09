# Short brief: "Check your monitor's refresh rate"

## Status (revision 2)

This is an honest Windows tutorial, cut **only** from the owner's screen recording. **That recording has not arrived, so no edit has been rendered.**

The first draft is withdrawn: its recreated Settings UI, its "Still set to 60?" hook and its unnamed "Higher rate" payoff are all gone. The recreated-UI renderer has been deleted, and the git history keeps it.

Nothing has been voiced, spent, published or scheduled.

## Evidence

**The owner's screenshot** of the Choose a refresh rate dropdown:
- **240 Hz** selected;
- 60, 75, 100, 120, 144, 165 and 200 Hz also listed.

**Limit:** these values are as the owner described them on 2026-10-09. The image has not reached this session, so `SCREENSHOT.sha256` is null until it is added and checked against that description.

**How it is used:**
- **What the Short may name.** Only these rates may appear in any caption, label or narration. Anything else is refused.
- **What it shows.** The screenshot is evidence of the available settings, not footage. It never stands in for the recording.

**The PC was never accidentally at 60 Hz,** and the copy guards refuse any line implying it was ("still set to 60", "stuck at sixty", "was set to 60"…).

**The Windows path** is Settings › System › Display › Advanced display › Choose a refresh rate. This is from Microsoft's [support article](https://support.microsoft.com/en-us/windows/change-the-refresh-rate-on-your-monitor-in-windows-c8ea729e-0678-015c-c415-f806f04aae5a), checked through search excerpts; this environment blocks the page itself. The recording shows exactly what this PC displays.

## The edit (planned from the checklist shots; times are targets)

| Time | Shot from the recording | Caption band |
|---|---|---|
| 0–2.5 s | **Advanced display at 240 Hz.** The page title and the "Choose a refresh rate" label stay in frame, and the value is readable in frame one. | Check your monitor's refresh rate |
| (≈1.5 s, only with 2+ displays) | The display selector, with the 240 Hz monitor picked. | Pick the right display first |
| 2.5–5 s | The list open, 60 to 240 Hz. | The list shows what your setup supports |
| 5–7 s | 60 Hz kept. | **DEMO · set to 60 Hz for this video** (amber pill) + "Changing it: a demo" |
| 7–10 s | List › **240 Hz** › **Keep changes**. | "Refresh rate isn't game FPS" (amber) + "Pick the rate, then Keep changes" |
| 10–13 s | Settings reopened: **240 Hz kept**, with the one highlight. | "Refresh rate isn't game FPS" + **What's yours set to?** + small `specsmithpc.com` |

- **The Settings home detour is cut.**
- **No end card,** no spoken promotion, no smoothness demonstration.

## What the code enforces

`editProblems` and `cutProblems` refuse an edit before a frame is cut if any of these fail:

- **Opening and ending.** It must open on the real Advanced display setting at 240 Hz and end on 240 Hz kept, with exactly one highlight there.
- **Demo shots.** Only a `demo-low` shot may show another rate, and it must. It is labelled "DEMO · set to 60 Hz for this video" and must be followed by choosing 240 Hz again.
- **Context.** Every crop keeps its declared surrounding UI and the value in frame. A crop with no declared context is refused as a bare close-up.
- **Readability.** The value's line box must be at least 54 px in the 1080-px frame (18 px at 360×640). Crops keep the story band's shape, are enlarged no more than 4×, and stay inside the recording.
- **Copy.** Only listed rates may be named. FPS-boost, fix-everything, every-monitor, SpecSmith-detects, smoothness and "found at 60" claims are refused.
- **Length.** The edit runs 12–15 s.
- **Recording bytes.** The recording's SHA-256 and size must match what the edit was written for.

**The output is silent,** with a silent track. There is no illustrative banner. SpecSmith adds only the caption band and the one highlight.

## Narration (working draft; NOT the approval script)

> Check your monitor's refresh rate. In Advanced display, pick the right display and open the list. For this demo we dropped to sixty. Choose the rate you want, then keep changes. What's yours set to?

The exact script is written after I've watched the recording, so it says only what the footage proves. For example:
- if there's no second display, the "pick the right display" clause goes;
- if step 4 is skipped, the demo line goes.

I'll send it with the silent edit for approval before any take.

## "Refresh rate isn't game FPS"

This is accurate as worded. Refresh rate is how many times a second the display redraws. FPS is how many frames the game renders. The note claims nothing further.

It sits in the caption band from the change onwards at 52 px, which is 17 px at 360×640.

## Next steps

1. The owner records with `RECORDING_CHECKLIST.md` and sends the recording and the screenshot.
2. I check the screenshot against its description, then fill `SCREENSHOT.path`/`sha256`.
3. I watch the recording and write `edit.json`: the shots, crops, declared context and value boxes.
4. Then I render:

   ```
   cd artifacts/SpecSmith
   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
     pnpm exec tsx scripts/content-automator/nextVideoRefreshRate/recordingEdit.ts <edit.json>
   ```

5. I inspect the phone-size frames, then write the exact narration from the cut. You get both before any paid take.

## Provenance

| Asset | Origin | Licence and status |
|---|---|---|
| Windows footage | The owner's screen recording (pending). | Owner's own capture; to be recorded with its SHA-256 on arrival. |
| Inter 400/600/700 (`fonts/`) | npm `@fontsource/inter@5.3.0`. | SIL OFL 1.1 (`fonts/OFL-1.1.txt`). |
| Colours | `src/index.css` `--ff-*`. | SpecSmith's own. |
| Sound | None in the silent edit. Later options: the composed bed (`musicBed.ts`) under the approved voice. | The bed's licence is unknown: making it here does not establish ownership or clearance. |

## Tests

- **`storyboard.test.ts`:** 23 tests on the evidence, copy and edit guards.
- **`recordingEdit.test.ts`:** 6 tests on a synthetic 2560×1440 **test fixture**, never presented as footage. They check that:
  - crops land where they map;
  - there is no banner;
  - the DEMO pill appears only on the demo, and the highlight only on the kept value;
  - mismatched recording bytes and stretched, out-of-bounds or unreadable crops are refused.
- **Deliberate breaks:** dropping the demo-labelling rule fails a storyboard test, and removing the DEMO pill fails a render test.
