# Pilot Short: "Can you reuse your old DDR4 RAM?" (draft)

One YouTube Shorts draft (revision 2, re-edited as one continuous story), 18.6 s, 1080×1920, 30 fps. It is not a framework and has not been published, scheduled or watched by real viewers. Nothing here claims retention.

- **Render:** `render-output/pilot-ram-fit/pilot-ram-fit-draft.mp4` (gitignored; the exact SHA-256 is in `report.json` next to it).
- **Re-render:** serve the built app, then run
  `SPECSMITH_RENDER_BASE_URL=http://localhost:5178 pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts`
  (set `SPECSMITH_RENDER_CHROMIUM` if Playwright's bundled shell is missing).

## The question and the one idea

**Beginner question:** "Can I reuse my old DDR4 RAM?"

**One idea:** a DDR4 stick needs a board with DDR4 slots, because DDR4 and DDR5 are keyed differently.

**Constraints:**
- No FPS, benchmark or estimate.
- Not the synthetic MASTER #6 fixture.

## Exact script (revision 2)

One continuous story. The camera never cuts to an unrelated picture: the slot in the opening is the same slot that the pull-back reveals on the DDR5 board. The warning and the CTA each appear once, at the end.

| Shot | Time (s) | Voiceover (temporary) | Captions | Other on-screen text |
|---|---|---|---|---|
| 1. Approach | 0.0–2.3 | Reusing old DDR4 RAM? | Reusing old DDR4 RAM? | DDR4 (stick) · DDR5 slot |
| 2. Stops | 2.3–4.7 | It won't fit a DDR5 slot. | It won't fit a DDR5 slot. | same |
| 3. Notch close-up | 4.7–8.5 | The notch is in a different place, so it can't line up. | The notch is in / a different place, / so it can't line up. | DDR5 key · DDR4 notch · Diagram, not to scale |
| 4. Board choices | 8.5–12.5 | Your DDR4 needs a board with DDR4 slots. | Your DDR4 needs a board / with DDR4 slots. | DDR4 slots · DDR5 slots · ✓ |
| 5. SpecSmith catches it | 12.5–16.1 | Pick the wrong board, and SpecSmith flags it. | Pick the wrong board, / and SpecSmith flags it. | SpecSmith Builder · the real warning card |
| 6. CTA | 16.1–18.6 | Check yours at SpecSmith. | Check yours at SpecSmith. | specsmithpc.com/builder |

## Storyboard

1. **Approach.**
   - The first frame already shows the attempt: the DDR4 stick lined up over the DDR5 slot, close up.
   - It lowers steadily while the camera creeps in.
2. **Stops.**
   - The stick hits the slot and stops short, with its gold contacts still showing.
   - A small jolt and a soft thud. The notch ring and the slot key glow red.
3. **Notch close-up.**
   - A calm 1.1 s push-in on the contacts.
   - Dashed guides run down from the notch (amber) and the key (cyan) to large labels: **DDR4 notch** and **DDR5 key**.
4. **Board choices.**
   - A calm 1.1 s pull-back reveals the slot is on a board labelled **DDR5 slots**, with a **DDR4 slots** board beside it.
   - The stick lifts out, crosses to the DDR4 board and seats; both latches click. A green check appears and the DDR5 board dims.
5. **SpecSmith catches it.**
   - The boards fade. The "SpecSmith Builder" header and the Builder's real warning card for DDR4 on the DDR5 board settle in.
   - The card scales slowly and its red glow breathes.
6. **CTA.** The `specsmithpc.com/builder` pill rises in under the card and holds to the end.

What changed from revision 1:
- Removed: the CPU-clone detour, the WON'T GO IN stamp, the motherboard model text, the socket and second slot in close-ups, the "lines up" DDR5 swap, the "Free · no account" line, and the duplicate URL caption.
- Labels are 64–72 px. Captions sit at one consistent position, one line each.
- Transitions are camera moves, not jumps.

## Claim sources

Every claim is re-checked at render time by `facts.ts`. If any one stops holding, the render refuses to start.

| Claim on screen | Source | How it is checked |
|---|---|---|
| A DDR4 stick won't go in a DDR5 board; "doesn't line up" | `src/lib/compatibility.ts`, `ram-type-mismatch` (type `error`, confidence `certain`): "DDR4 and DDR5 sticks are keyed differently and are not interchangeable." | `checkCompatibility(i5-12400F, MSI PRO B760M-A WIFI DDR5, Corsair Vengeance 16GB DDR4-3200)` must return that warning, with that wording |
| "The notch is in a different spot" | Same rule ("keyed differently") | Same. The drawing is schematic and is labelled "Diagram, not to scale" while it is on screen |
| (Not on screen in revision 2, still checked) i5-12400F supports DDR4 + DDR5 | `src/data/cpus.json` id `i5-12400f` | `facts.ts`. The CPU is part of the Builder build behind the warning card |
| "DDR4 slots" board | `src/data/components.json` id `b660mpro`: `supported_ram: ["DDR4"]`. The model name is no longer shown | Asserted DDR4-only |
| "DDR5 slots" board | `components.json` id `b760mawifi`: `supported_ram: ["DDR5"]`. The model name is shown only inside the Builder card | Asserted DDR5-only |
| "Your DDR4 needs a board with DDR4 slots" (the stick seats in the DDR4 board) | `checkCompatibility(i5-12400F, ASRock B660M Pro RS, DDR4 stick)` | It must pass both "CPU socket" and "RAM type", with no warnings |
| "needs" is a necessary condition only | The Builder also checks that the CPU supports the RAM generation | The script never says a DDR4 board is enough on its own |
| The Builder warning card | The running Builder at `/builder?cpu=i5-12400f&motherboard=b760mawifi&ram=cv16ddr4`, captured at phone width (390 px, 3×) and cropped to the card | The card's text is read back. Title, detail and fix must equal the checker's verdict, or the render stops |

## Voiceover script for approval (ElevenLabs not used)

**Delivery:** friendly and quick. Say "DDR-four" / "DDR-five" as words.

| Cue | Starts | Line |
|---|---|---|
| 1 | 0.0 s | Reusing old DDR4 RAM? |
| 2 | 2.3 s | It won't fit a DDR5 slot. |
| 3 | 4.7 s | The notch is in a different place, so it can't line up. |
| 4 | 8.5 s | Your DDR4 needs a board with DDR4 slots. |
| 5 | 12.5 s | Pick the wrong board, and SpecSmith flags it. |
| 6 | 16.1 s | Check yours at SpecSmith. |

The render refuses any take that runs past its shot.

## Temporary sound

- **Voice:** espeak-ng placeholder.
- **Effects** (synthesised in ffmpeg, kept calm):
  - one thud at the jam;
  - soft whooshes under the two camera moves and the ending;
  - two latch clicks plus a light chime when the stick seats.
- **Bed:** a quiet two-chord pad.
- **Mix:** peak −0.2 dB, mean −19.6 dB.

## Inspection (revision 2)

Checked at phone size (360×640 key frames) and at normal playback sampling (a 2 fps strip across the whole video). Fixes made during this pass:

| Problem | Fix |
|---|---|
| The close-ups showed a second slot and an empty socket outline (clutter) | One slot per board; the board outline and socket fade out when close |
| The notch guide line cut through the DDR4 sticker | Guides start at the contact edge |
| The DDR5 key flickered red/pink under a cyan "DDR5 key" label | The key stays cyan; red appears only while the stick is jammed, in the stop shot |
| The freeze detector found 0.5–2.1 s still holds | Slow, motivated camera creeps; the card scales and breathes |
| The board shot was slightly wider than the frame | Scale 1.06 |
| "SpecSmith's Builder flags it." orphaned "it." | Reworded: "and SpecSmith flags it." |
| The URL appeared in both the pill and the caption | The caption became "Check yours at SpecSmith."; the pill carries the URL |
| The approach barely moved | It now travels about 260 px into the jam |
| 1.4 s of dead tail after the last line | Trimmed; the video ends at 18.6 s |

**Voice against picture** (from the render's voice timings):
- the jam lands 0.03 s before "It won't fit";
- the notch labels arrive during "a different place";
- the stick seats during "with DDR4 slots";
- the card is in place before "SpecSmith flags it";
- the URL rises with "Check yours".

## Checks run on the final draft

**Facts** (`facts.ts`, run by the render and by `storyboard.test.ts`):
- the catalog specifications and both `checkCompatibility` verdicts hold;
- changing a part makes it refuse.

**Builder card read-back:** title, detail and fix all equal the checker's verdict.

**MASTER #1 storyboard review** (`reviewCreativeQuality`, on the cues actually burned in): **0 recommended fixes**. It does not assess:
- text hierarchy, narrative satisfaction, composition and visual polish;
- audio polish, voice naturalness and branding consistency.

Those are for a person watching the video.

**Visual honesty** (`reviewVisualHonesty`):
- Declared visuals: the keying diagram, labelled; the two-board choice, derived from the catalog; the background.
- **0 findings.**

**Media checks** (`verifyRenderedMedia` plus MASTER #7's `mediaInspection` on the bytes):
- h264/aac, 1080×1920, 30 fps, 18.6 s, one video and one audio stream;
- 0 decode errors, no black stretches, no frozen stretches.

**Tests:** `pilotRamFit/storyboard.test.ts` covers the wording guards (no performance words, no absolutes, no numbers beyond DDR4/DDR5) and caption limits; 9 pass.

## Not done, and limits

- **MASTER #7's `reviewCreative` claim checks were not run.** Its claim types are Compare/FPS figures and research claims; it has no compatibility-claim type. Extending it would be new general infrastructure, which this task excludes. This pilot's factual check is the catalog and checker re-run in `facts.ts`, plus the Builder card read-back.
- **The notch positions are schematic.** The real offsets are not drawn to scale, and the label says so.
- **Board model names now appear only inside the Builder card.** Manufacturers sell DDR4 and DDR5 variants of some boards under near-identical names.
- **Nobody has watched this as a viewer yet.** Whether it holds attention is unknown until real viewers see it.
