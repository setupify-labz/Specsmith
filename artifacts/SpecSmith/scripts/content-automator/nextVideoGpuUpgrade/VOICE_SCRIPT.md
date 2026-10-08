# Voice script: "Which game gets the bigger percentage boost?" (Concept A, attempt 5)

**Status:**
- **Text:** the trimmed 314-character script below is approved for the take (2026-10-06).
- **Spend:** not yet approved. No voice has been generated, paid or otherwise.

**Why it was trimmed.** The proposed 392-character script was checked against Liam's real pace, measured from the character timestamps of his saved FPS-Short take (about 18 characters a second for plain lines, 13.7 for lines with numbers). It had three problems:
- **Character cap:** it was over the shared 360-character cap, which stays unchanged.
- **Length:** it would have run about 29–30 s, at the 30 s ceiling.
- **Hook:** its opening line would have run about 4.1 s. MASTER #1 blocks a hook over about 3.67 s, so the paid take would likely have been refused at render.

The trimmed text keeps every figure, every label and every line's role:
- **Opening:** the setup ("Same CPU. New GPU.") stays on screen as the opening caption and upgrade row; the voice asks the question.
- **Attribution:** SpecSmith is named on screen ("SpecSmith model estimates") and in the disclosure.
- **Predicted:** about 23.6 s in total, with a 2.7 s hook.

## Text for the one Liam take

The six lines joined by single spaces. Numbers are spelled the way they should be spoken; captions and graphics keep the verified digits.

```text
Which game gets the bigger percentage boost? Alan Wake Two: forty-three to sixty-five estimated FPS. Valorant: two-sixty-three to three-oh-five. That's an estimated fifty-one percent boost for Alan Wake Two, and sixteen percent for Valorant. Same upgrade, different gains by game. Which game would you upgrade for?
```

- **Characters:** 314, all ASCII. Counted on the exact string above, no trailing newline.
- **SHA-256 (UTF-8):** `fd154a03bcda906e7901b6a97be7d879c9ae4d1e0098ec1777364e692a82d19e`
- **Voice:** Liam, pinned ID `TX3LPaxmHKxFdv7VOQHJ`. Never George.
- **Request:** one `with-timestamps` request, from the manual workflow (`script: gpu-upgrade`, `confirm: generate`, `review_pr: 176`).

## Lines

Starts are predicted from Liam's measured pace. The final cut is timed to his actual delivery from the take's timestamps.

| # | Starts | Beat narration (captions and checks) | Spoken | Claims |
|---|---|---|---|---|
| 1 | 0.0 s | Which game gets the bigger percentage boost? | Which game gets the bigger percentage boost? | none |
| 2 | ~2.9 s | Alan Wake 2: 43 to 65 estimated FPS. | Alan Wake Two: forty-three to sixty-five estimated FPS. | gpu-upgrade-gpu-heavy-game |
| 3 | ~7.2 s | Valorant: 263 to 305. | Valorant: two-sixty-three to three-oh-five. | gpu-upgrade-cpu-heavy-game |
| 4 | ~10.6 s | That's an estimated 51% boost for Alan Wake 2, and 16% for Valorant. | That's an estimated fifty-one percent boost for Alan Wake Two, and sixteen percent for Valorant. | gpu-upgrade-percent-gpu-heavy-game, gpu-upgrade-percent-cpu-heavy-game, bigger-percentage-boost |
| 5 | ~18.0 s | Same upgrade, different gains by game. | Same upgrade, different gains by game. | the percentage claims (the comparison stays on screen) |
| 6 | ~20.5 s | Which game would you upgrade for? | Which game would you upgrade for? | none spoken; the comparison stays on screen |

**Delivery:**
- **Tone:** calm and quick, like a friend explaining a result.
- **Emphasis:** "fifty-one" and "sixteen" are the only stressed words.
- **Ending:** no sign-off and no promotion. The last line is a question to the viewer; the site address is on screen only.

**Guards before the one paid request** (`liamTake.ts` and the shared `voiceSpendGuards.ts`):
- **Figures:** every spoken figure is recomputed from the model.
- **Lines:** each spoken line must be its beat's approved narration, with only the figures spelled out.
- **Cap:** the text must be within the unchanged 360-character cap.
- **Allowance:** the subscription must report no overage billing and enough included characters.
- **Voice:** the provider's Liam must have the pinned id.
