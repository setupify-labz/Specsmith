# Recording checklist: refresh-rate Short

Record one continuous take; I cut it into the 12–15 s edit. Everything on screen comes from this recording.

## Before you record (2 minutes)

- [ ] **Make the text bigger.** Set Display › **Scale** to 150% or more. At 100% the "240 Hz" text is too small to read on a phone, and the edit refuses any value under 18 px at phone size. Set it back afterwards.
- [ ] **Open Settings at the right page.** Go to System › Display › **Advanced display**, then maximize the window.
- [ ] **Clear the screen.** Turn on Do Not Disturb. Close or hide anything personal, such as names, emails, other windows and notifications.
- [ ] **Set up OBS.** In OBS Studio (free), add a **Display Capture** of this monitor. Use native resolution, 30 or 60 fps, with the cursor shown. Start recording.

## The take (about 40 s)

1. [ ] **Hold** on Advanced display, untouched, at **240 Hz**, for **4 s**. This is the opening shot.
2. [ ] **Only if you have more than one display:** open the display selector, pick the 240 Hz monitor, and hold for **2 s**.
3. [ ] Open **Choose a refresh rate**. Hold for **3 s** with the whole list visible (60 to 240 Hz), then press **Esc**.
4. [ ] **Demo:** choose **60 Hz**, click **Keep changes**, then hold for **3 s**. The screen may go black for a moment; keep recording. The edit labels every frame of this part "DEMO · set to 60 Hz for this video".
5. [ ] Open the list, choose **240 Hz**, click **Keep changes**, then hold for **5 s**.
6. [ ] **Proof it stayed:** close Settings, reopen it at Advanced display, and hold on **240 Hz** for **3 s**. Stop recording.

If you'd rather not dip to 60 Hz, skip step 4. The payoff then becomes "your setting, confirmed" rather than a change, which is weaker but still honest.

## Send me

- [ ] **The recording file.** Trim it if you need to so it stays under 100 MB. Push it to a branch such as `footage/refresh-rate` in this repo, or attach it to a draft GitHub release. Only GitHub is reachable from here.
- [ ] **The dropdown screenshot** you described, sent the same way. It hasn't reached this session yet.
- [ ] **The monitor's model,** and the Windows version from `winver`.
- [ ] Confirmation that the PC is back at **240 Hz** and that Scale is restored.
