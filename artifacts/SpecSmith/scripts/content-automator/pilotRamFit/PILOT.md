# Pilot Short: "Can you reuse your old DDR4 RAM?" (draft)

One YouTube Shorts draft, 17.5 s, 1080×1920, 30 fps. It is not a framework and has not been published, scheduled or watched by real viewers. Nothing here claims retention.

- **Render:** `render-output/pilot-ram-fit/pilot-ram-fit-draft.mp4` (gitignored; the exact SHA-256 is in `report.json` next to it).
- **Re-render:** serve the built app, then run
  `SPECSMITH_RENDER_BASE_URL=http://localhost:5178 pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts`
  (set `SPECSMITH_RENDER_CHROMIUM` if Playwright's bundled shell is missing).

## The question and the one idea

**Beginner question:** "I'm building a new PC. Can I reuse my old DDR4 RAM?"

**One idea:** the motherboard decides which RAM fits.
- DDR4 and DDR5 sticks are keyed differently, so a DDR4 stick physically won't seat in a DDR5 slot.
- Even a CPU that supports both still sits on a board that takes one.

**Why this question:**
- SpecSmith answers it with **verified catalog specifications and its own Builder checker**, not model estimates.
- The video therefore contains **no FPS, benchmark or performance figure at all**.
- It is not the synthetic MASTER #6 fixture.

## Exact script

The captions are burned in one line at a time, in step with the voice. DDR4 is shown in amber and DDR5 in cyan.

| Time (s) | Voiceover (temporary) | Captions | Other on-screen text |
|---|---|---|---|
| 0.0–2.5 | Reusing your old DDR4 RAM? | Reusing your old DDR4 RAM? | DDR4 (stick label) · DDR5 slot · WON'T GO IN |
| 2.5–7.0 | On a DDR5 board, it can't go in. The notch is in a different spot. | On a DDR5 board, / it can't go in. / The notch is in / a different spot. | DDR5 key · DDR4 notch · doesn't line up · DDR5 stick: lines up · Diagram, not to scale |
| 7.0–10.7 | This Intel chip works with both. The board decides which. | This Intel chip / works with both. / The board decides which. | i5-12400F · works with DDR4 + DDR5 · DDR4 board (ASRock B660M Pro RS) · DDR5 board (MSI PRO B760M-A WIFI DDR5) · THE BOARD DECIDES |
| 10.7–13.7 | On a DDR4 board, it clicks right in. | On a DDR4 board, / it clicks right in. | DDR4 board · DDR5 board (dimmed, crossed) |
| 13.7–17.5 | SpecSmith's Builder catches this before you buy. | SpecSmith's Builder catches / this before you buy. | SpecSmith · the Builder's real warning card · Real Builder warning for this exact build · specsmithpc.com/builder · Free · no account needed |

A small "DRAFT · temp voice" tag sits top-left for internal review. It comes off for a final.

## Claim sources

Every claim is re-checked at render time by `facts.ts`. If any one stops holding, the render refuses to start.

| Claim on screen | Source | How it is checked |
|---|---|---|
| A DDR4 stick won't go in a DDR5 board; "doesn't line up" | `src/lib/compatibility.ts`, `ram-type-mismatch` (type `error`, confidence `certain`): "DDR4 and DDR5 sticks are keyed differently and are not interchangeable." | `checkCompatibility(i5-12400F, MSI PRO B760M-A WIFI DDR5, Corsair Vengeance 16GB DDR4-3200)` must return that warning, with that wording |
| "The notch is in a different spot" | Same rule ("keyed differently") | Same. The drawing is schematic and is labelled "Diagram, not to scale" while it is on screen |
| "This Intel chip works with both" (i5-12400F, LGA1700, DDR4 + DDR5) | `src/data/cpus.json` id `i5-12400f`: `supported_ram: ["DDR4","DDR5"]`. About page: "Some platforms support both (Intel 12th/13th/14th Gen)" | `facts.ts` asserts both generations and the shared socket |
| DDR4 board: ASRock B660M Pro RS | `src/data/components.json` id `b660mpro`: LGA1700, `supported_ram: ["DDR4"]` | Asserted DDR4-only and the same socket |
| DDR5 board: MSI PRO B760M-A WIFI DDR5 | `components.json` id `b760mawifi`: LGA1700, `supported_ram: ["DDR5"]` | Asserted DDR5-only and the same socket |
| "On a DDR4 board, it clicks right in" | `checkCompatibility(i5-12400F, ASRock B660M Pro RS, DDR4 stick)` | It must pass both "CPU socket" and "RAM type", with no warnings |
| "The board decides which" | The two boards above, plus the catalog: 3 LGA1700 boards take DDR4 only, 4 take DDR5 only, 0 take both | Counted in `facts.ts` and recorded in `report.json`. The line is about these boards and the Builder's rule; it is not stated as an absolute about every board ever made |
| The Builder warning card | The running Builder at `/builder?cpu=i5-12400f&motherboard=b760mawifi&ram=cv16ddr4`, captured at phone width (390 px, 3×) and cropped to the card | The card's text is read back. Title, detail and fix must equal the checker's verdict, or the render stops |
| "Free · no account needed" | `src/pages/About.tsx`: "SpecSmith is completely free with no account required" | Wording only, not computed |

## Storyboard

1. **Hook (0–2.5 s).**
   - First frame: a big DDR4 stick with speed streaks over an open DDR5 slot, and the caption already on screen.
   - The stick drops and slams to a stop short of seating. The frame shakes and the notch and the slot key pulse red.
   - A tilted **WON'T GO IN** stamp lands.
2. **Why (2.5–7.0 s).**
   - The camera pushes in on the contacts. Dashed guides drop from the DDR5 key and the DDR4 notch, and a red arrow reads "doesn't line up".
   - The DDR4 stick lifts out, a DDR5 stick drops in and seats, and the key glows green: "DDR5 stick: lines up".
   - "Diagram, not to scale" stays visible throughout.
3. **Twist (7.0–10.7 s).**
   - An i5-12400F pops in: "works with DDR4 + DDR5".
   - A DDR4 board and a DDR5 board slide in from either side. Their slot keys are colour-coded and their catalog names are under them.
   - The chip copies itself into both sockets, which light green. **THE BOARD DECIDES** lands.
4. **Payoff (10.7–13.7 s).**
   - The old DDR4 stick drops into the DDR4 board, both latches snap shut, and a big green check pops.
   - The DDR5 board dims behind a red cross.
5. **SpecSmith (13.7–17.5 s).**
   - The SpecSmith mark appears, and the Builder's real warning card for this exact build slides up with a pulsing red glow.
   - The pill `specsmithpc.com/builder` and the line "Free · no account needed" settle beneath it.

Rejected styles avoided: no cartoon GPU characters, no static number cards, no full-page screenshots. The only screenshot is one cropped UI card.

## Voiceover script for approval (ElevenLabs not used)

**Delivery:** friendly, quick, like a friend who has built a few PCs. No hype and no "guys". Say "DDR-four" / "DDR-five" as words, not spelled-out letters (the temp voice spells them, which is why it sounds slow).

**Target:** about 14 s of speech inside 17.5 s, each line starting on its scene cut.

| Cue | Starts at | Line |
|---|---|---|
| 1 | 0.0 s | Reusing your old DDR4 RAM? |
| 2 | 2.5 s | On a DDR5 board, it can't go in. The notch is in a different spot. |
| 3 | 7.0 s | This Intel chip works with both. The board decides which. |
| 4 | 10.7 s | On a DDR4 board, it clicks right in. |
| 5 | 13.7 s | SpecSmith's Builder catches this before you buy. |

Each approved take must fit its scene. The render checks this and refuses a line that runs over.

## Temporary sound

- **Voice:** espeak-ng, a robotic offline placeholder.
- **Effects:** synthesised in ffmpeg:
  - a whoosh on the drop;
  - a clunk plus a short buzz on the jam;
  - whooshes on the zoom, the boards and the end card;
  - chimes when the DDR5 stick lines up and when both sockets light;
  - two latch clicks plus a success chime on the payoff.
- **Bed:** a quiet two-chord pad.
- **Mix:** a limiter peaks it at −0.4 dB; mean −18.6 dB.
- No licensed or third-party audio. It is labelled temporary in the file's metadata.

## Phone-size inspection log

Frames were checked at 360×640, about phone size.

| Pass | Problem found | Fix |
|---|---|---|
| 1 | The first frame had no caption: it faded in from zero at t=0 | The first cue is fully visible at t=0 |
| 1 | The zoom labels sat on the stick's DDR4 sticker | The focus moved up and the labels went below the slot, larger, with outlines |
| 1 | The chip name was clipped ("5-12400F") | Smaller type on the chip |
| 1 | "DDR4+DDR5" ran together | Spaced out |
| 1 | The storyboard review flagged lines over 28 characters, and no route in the CTA | The renderer wraps by the review's own rule and the review measures the burned-in cues. The CTA beat names `specsmithpc.com/builder` |
| 2 | Captions ran off the frame (28 characters is too wide in this bold font at 68 px) | Each line auto-fits to 920 px |
| 2 | The payoff camera push pushed the board names into the caption | The push was removed and the names fade out during the payoff |
| 2 | The opening frame read as static | Speed streaks behind the falling stick |
| 3 | The stamp lingered into the zoom; the chip text overlapped the flying chips; the crossfade was muddy; THE BOARD DECIDES overlapped the SpecSmith logo | Faster fades, the text clears before the chips move, a tighter crossfade, and the logo comes in after the boards have gone |
| 4 | Greedy wrapping left orphans ("it can't go / in.") | Single-line caption chunks at natural phrase breaks |

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
- Declared visuals: the keying diagram, labelled; the CPU-and-two-boards drawing, derived from the catalog; the decorative grid.
- **0 findings.**

**Media checks** (`verifyRenderedMedia` plus MASTER #7's `mediaInspection` on the bytes):
- h264/aac, 1080×1920, 30 fps, 17.5 s, one video and one audio stream;
- 0 decode errors, no black stretches, no frozen stretches.

**Tests:** `pilotRamFit/storyboard.test.ts` covers the wording guards (no performance words, no absolutes, no numbers beyond DDR4/DDR5) and caption limits; 9 pass.

## Not done, and limits

- **MASTER #7's `reviewCreative` claim checks were not run.** Its claim types are Compare/FPS figures and research claims; it has no compatibility-claim type. Extending it would be new general infrastructure, which this task excludes. This pilot's factual check is the catalog and checker re-run in `facts.ts`, plus the Builder card read-back.
- **The notch positions are schematic.** The real offsets are not drawn to scale, and the label says so.
- **Board names come from SpecSmith's catalog.** Manufacturers sell DDR4 and DDR5 variants of some boards under near-identical names. That is part of why the video points to the Builder rather than to a board name.
- **Nobody has watched this as a viewer yet.** Whether it holds attention is unknown until real viewers see it.
