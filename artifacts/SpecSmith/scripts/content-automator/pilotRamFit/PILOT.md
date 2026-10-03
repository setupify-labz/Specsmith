# Pilot Short: "Can you reuse your old DDR4 RAM?" (draft)

One YouTube Shorts draft (revision 4: the tight cut), 11.2 s, 1080×1920, 30 fps. It is not a framework and has not been published, scheduled or watched by real viewers. Nothing here claims retention.

- **Render:** `render-output/pilot-ram-fit/pilot-ram-fit-draft.mp4` (gitignored; the exact SHA-256 is in `report.json` next to it).
- **Re-render:** serve the built app, then run
  `SPECSMITH_RENDER_BASE_URL=http://localhost:5178 pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts`
  (set `SPECSMITH_RENDER_CHROMIUM` if Playwright's bundled shell is missing).

## Final script for the Liam take (approved wording, 2026-10-03)

The script is pinned in `liamTake.ts` (`APPROVED_RAM_FIT_LINES`); the video's narration must equal it word for word or nothing is generated. It is 167 characters and one request.

| # | Shot | Voice and captions | What proves it |
|---|---|---|---|
| 1 | The DDR4 stick jams in the DDR5 slot (the jam lands on "won't") | DDR4 RAM won't fit a DDR5 slot. | Builder `ram-type-mismatch` (error, certain): "keyed differently and are not interchangeable"; the real card says "RAM won't fit this motherboard" |
| 2 | Notch close-up | The notch doesn't line up. | Same rule; the drawing is labelled "Diagram, not to scale" |
| 3 | The DDR5 stick seats as "DDR5 RAM here" ends; the DDR4 stick seats in the DDR4 board as "DDR4 board" ends | Use DDR5 RAM here, or a DDR4 board compatible with your CPU. | The Builder's fix: "Choose DDR5 memory, or a motherboard that supports DDR4". The Builder passes DDR5 RAM on this board, and the build's CPU with the DDR4 board (socket and RAM type) |
| 4 | WON'T FIT, both fixes ("Or a DDR4 board / compatible with your CPU"), then the real Builder card | SpecSmith catches it. | The real card, captured at these parts and read back word for word |
| 5 | Logo and specsmithpc.com/builder | Check yours at SpecSmith. | `/builder` reproduces the warning |

**Generation path (no spend until the owner approves):** the guarded workflow `elevenlabs-voice-sample.yml`, option `ram-fit`, dispatched by hand with `confirm=generate`.
- **Job 1** holds the stored key. It runs `liamTake.ts`: it re-checks the Builder facts and the script, checks the voice is the pinned Liam id, reads the subscription (and refuses if the account can extend its limit or lacks the characters), makes one timestamped request, and uploads the take.
- **Job 2** holds no secret. It builds the app, captures the Builder card, times the locked cut and captions to the take (`takeTiming.ts`), mixes the jam 6 dB under Liam's line-1 peak at about -14 LUFS, renders the 1080x1920 MP4, posts its report as check notices, and uploads it.

Nothing publishes.

## The question and the one idea

**Beginner question:** "Can I reuse my old DDR4 RAM?"

**One idea:** a DDR4 stick needs a board with DDR4 slots, because DDR4 and DDR5 are keyed differently.

**Constraints:**
- No FPS, benchmark or estimate.
- Not the synthetic MASTER #6 fixture.

## Exact script (revision 4: the tight cut)

The same sequence as before, tightened:
1. The stick fails inside the first second.
2. A brief notch close-up.
3. The two choices.
4. A large payoff message carrying both fixes, with the real Builder warning flashed as proof.
5. One short CTA.

| Shot | Time (s) | Voiceover | Captions | Other on-screen text |
|---|---|---|---|---|
| 1. Fail | 0.0–2.35 | DDR4 won't fit DDR5. | DDR4 won't fit DDR5. | DDR4 (stick) · DDR5 slot |
| 2. Notch | 2.35–3.9 | The notch doesn't line up. | The notch doesn't line up. | DDR5 key · DDR4 notch · Diagram, not to scale |
| 3. Choice | 3.9–6.95 | Use DDR5 RAM, or a DDR4 board. | Use DDR5 RAM, / or a DDR4 board. | DDR5 board ✓ · DDR4 board ✓ |
| 4. Payoff + proof | 6.95–9.45 | SpecSmith flags it, with both fixes. | SpecSmith flags it, / with both fixes. | SpecSmith Builder · WON'T FIT · DDR4 RAM · DDR5 board · ✓ Use DDR5 RAM · ✓ Or a DDR4 board · Real SpecSmith Builder warning (the real card, about 1 s) |
| 5. CTA | 9.45–11.2 | Check yours at SpecSmith. | Check yours at SpecSmith. | SpecSmith · specsmithpc.com/builder |

## Storyboard

1. **Fail.**
   - The first frame shows the DDR4 stick already pushing into the DDR5 slot.
   - At **0.5 s** it slams to a stop on the key: punch-in, jolt, a red flash and a thud.
   - The contacts left outside the slot pulse red.
2. **Notch.** A 0.55 s push-in. Guides and large labels: **DDR4 notch** (amber) and **DDR5 key** (cyan).
3. **Choice.**
   - Pull back to the two boards.
   - The DDR4 stick exits right. A DDR5 stick enters from the left and seats in this board (✓, on "Use DDR5 RAM").
   - The DDR4 stick comes back in over the DDR4 board above and seats (✓, on "or a DDR4 board").
4. **Payoff + proof.**
   - "SpecSmith Builder" header. **WON'T FIT** (150 px, red) and "DDR4 RAM · DDR5 board".
   - Two large fix rows: **✓ Use DDR5 RAM** and **✓ Or a DDR4 board**.
   - Then the real Builder warning card slides up beneath, labelled "Real SpecSmith Builder warning", for about 1 s as proof. It isn't there to be read.
5. **CTA.** SpecSmith logo lockup and a breathing `specsmithpc.com/builder` pill.

The payoff message restates the Builder's own verdict and fix: "RAM won't fit this motherboard", and "Choose DDR5 memory, or a motherboard that supports DDR4". `facts.ts` refuses to render if that fix text changes. It also checks that the Builder passes DDR5 memory (Kingston Fury Beast 16GB DDR5-5200) on the DDR5 board, and the DDR4 stick on the DDR4 board.

## Claim sources

Every claim is re-checked at render time by `facts.ts`. If any one stops holding, the render refuses to start.

| Claim on screen | Source | How it is checked |
|---|---|---|
| A DDR4 stick won't go in a DDR5 board; "doesn't line up" | `src/lib/compatibility.ts`, `ram-type-mismatch` (type `error`, confidence `certain`): "DDR4 and DDR5 sticks are keyed differently and are not interchangeable." | `checkCompatibility(i5-12400F, MSI PRO B760M-A WIFI DDR5, Corsair Vengeance 16GB DDR4-3200)` must return that warning, with that wording |
| "The notch is in a different spot" | Same rule ("keyed differently") | Same. The drawing is schematic and is labelled "Diagram, not to scale" while it is on screen |
| (Not on screen in revision 2, still checked) i5-12400F supports DDR4 + DDR5 | `src/data/cpus.json` id `i5-12400f` | `facts.ts`. The CPU is part of the Builder build behind the warning card |
| "DDR4 board" tag | `src/data/components.json` id `b660mpro`: `supported_ram: ["DDR4"]`. The model name is no longer shown | Asserted DDR4-only |
| "DDR5 board" tag | `components.json` id `b760mawifi`: `supported_ram: ["DDR5"]`. The model name is shown only inside the Builder card | Asserted DDR5-only |
| "Your DDR4 needs a board with DDR4 slots" (the stick seats in the DDR4 board) | `checkCompatibility(i5-12400F, ASRock B660M Pro RS, DDR4 stick)` | It must pass both "CPU socket" and "RAM type", with no warnings |
| "needs" is a necessary condition only | The Builder also checks that the CPU supports the RAM generation | The script never says a DDR4 board is enough on its own |
| The Builder warning card | The running Builder at `/builder?cpu=i5-12400f&motherboard=b760mawifi&ram=cv16ddr4`, captured at phone width (390 px, 3×) and cropped to the card | The card's text is read back. Title, detail and fix must equal the checker's verdict, or the render stops |

## Voiceover script for approval (ElevenLabs not used)

**Delivery:** quick and plain. Say "DDR-four" / "DDR-five" as words.

| Cue | Starts | Line |
|---|---|---|
| 1 | 0.0 s | DDR4 won't fit DDR5. |
| 2 | 2.35 s | The notch doesn't line up. |
| 3 | 3.9 s | Use DDR5 RAM, or a DDR4 board. |
| 4 | 6.95 s | SpecSmith flags it, with both fixes. |
| 5 | 9.45 s | Check yours at SpecSmith. |

The temp voice runs at 200 wpm. A human read of line 1 will likely take about 1.3 s rather than 2.25 s; trim shot 1 to match.

## Temporary sound and type

- **Voice:** espeak-ng placeholder. "DDR" is respelled "dee dee ar" for pacing, then processed with a low cut, presence EQ, light compression and a short room.
  - MBROLA voices exist as Ubuntu packages, but their databases carry restrictive licences, so they were not used.
  - No paid voice.
- **Effects and bed** (all synthesised in ffmpeg):
  - a soft push at the start and a thud at the jam;
  - whooshes under the camera moves;
  - latch clicks plus a chime on the seat, and a soft chime on the CTA;
  - a pad from the start, plus a 100 bpm kick-and-hat beat from the jam, side-chain ducked under the voice.
  - Mix: peak −0.1 dB, mean −22.5 dB.
- **Font:** Inter (SIL Open Font License 1.1), the font SpecSmith's site uses. It is fetched once from Google Fonts' latin subset and cached outside git; its SHA-256 is in `report.json`.

## Inspection (revision 2; revision 3 re-checked the same way)

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

Revision 3 fixes found on inspection:
- Board parts and the second board leaked into the close-ups. They are now hidden until the pull-back.
- A dashed "seated" ghost outline overlapped the jammed stick and didn't read. It was replaced by red exposed contacts.
- The board pills touched the PCIe slots, so the PCIe slots moved.
- The final 1.4 s was still. The lockup now breathes.
- The temp voice ran 0.01 s past shot 1. Each line now starts 0.05 s after its cut.

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
- h264/aac, 1080×1920, 30 fps, 17.4 s, one video and one audio stream;
- 0 decode errors, no black stretches, no frozen stretches.

**Tests:** `pilotRamFit/storyboard.test.ts` covers the wording guards (no performance words, no absolutes, no numbers beyond DDR4/DDR5) and caption limits; 9 pass.

## Not done, and limits

- **MASTER #7's `reviewCreative` claim checks were not run.** Its claim types are Compare/FPS figures and research claims; it has no compatibility-claim type. Extending it would be new general infrastructure, which this task excludes. This pilot's factual check is the catalog and checker re-run in `facts.ts`, plus the Builder card read-back.
- **The notch positions are schematic.** The real offsets are not drawn to scale, and the label says so.
- **Board model names now appear only inside the Builder card.** Manufacturers sell DDR4 and DDR5 variants of some boards under near-identical names.
- **Nobody has watched this as a viewer yet.** Whether it holds attention is unknown until real viewers see it.
