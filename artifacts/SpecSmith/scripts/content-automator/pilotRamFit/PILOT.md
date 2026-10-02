# Pilot Short: "Can you reuse your old DDR4 RAM?" (draft)

One YouTube Shorts draft (revision 3, polish pass on revision 2's story), 17.4 s, 1080×1920, 30 fps. It is not a framework and has not been published, scheduled or watched by real viewers. Nothing here claims retention.

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

## Exact script (revision 3)

One continuous story. The camera never cuts to an unrelated picture: the slot in the opening is the same slot that the pull-back reveals on the DDR5 board. The warning and the CTA each appear once, at the end.

| Shot | Time (s) | Voiceover | Captions | Other on-screen text |
|---|---|---|---|---|
| 1. Approach | 0.0–1.9 | Reusing old DDR4? | Reusing old DDR4? | DDR4 (stick) · DDR5 slot |
| 2. Stops | 1.9–4.3 | It won't fit a DDR5 slot. | It won't fit a DDR5 slot. | same |
| 3. Notch close-up | 4.3–7.8 | The notch is in a different place, so it can't line up. | The notch is in / a different place, / so it can't line up. | DDR5 key · DDR4 notch · Diagram, not to scale |
| 4. Board choices | 7.8–11.8 | Your DDR4 needs a board with DDR4 slots. | Your DDR4 needs a board / with DDR4 slots. | DDR4 board · DDR5 board · ✓ |
| 5. SpecSmith catches it | 11.8–15.0 | Pick the wrong board, and SpecSmith flags it. | Pick the wrong board, / and SpecSmith flags it. | SpecSmith Builder · the real warning card, with its own words "is DDR4" and "only takes DDR5" highlighted |
| 6. CTA | 15.0–17.4 | Check yours at SpecSmith. | Check yours at SpecSmith. | SpecSmith · specsmithpc.com/builder |

## Storyboard

1. **Approach.**
   - The first frame already shows the attempt: a DDR4 stick lined up over a DDR5 slot, close up.
   - It pushes down while the camera creeps in.
2. **Stops.**
   - On "It won't fit" the stick hits the key and stops. A jolt and a thud.
   - The notch ring and the slot key glow red.
   - The gold contacts left outside the slot pulse red: the part that should have gone in.
3. **Notch close-up.**
   - A 1.0 s push-in on the contacts.
   - Dashed guides run down from the notch (amber) and the key (cyan) to large labels: **DDR4 notch** and **DDR5 key**.
4. **Board choices.**
   - A 1.1 s pull-back reveals the slot sits on a motherboard (socket, VRM heatsinks, PCIe slot) tagged **DDR5 board**, with a **DDR4 board** above it.
   - The stick lifts, rises and seats in the DDR4 board's slot. Latches click and a green check pops. The DDR5 board dims.
5. **SpecSmith catches it.**
   - The boards fade. The Builder's real warning card for DDR4 on the DDR5 board settles in under a "SpecSmith Builder" header.
   - Highlighter sweeps mark the card's own words "is DDR4" (amber) and "only takes DDR5" (cyan) as the voice reaches them. Their positions are read from the live card, not drawn over a guess.
6. **CTA.** The card settles higher, and a SpecSmith logo lockup and a breathing `specsmithpc.com/builder` pill rise in beneath it.

What changed in revision 3:
- **Story and timing:** the jam lands on "It won't fit". The exposed contacts turn red so "it stops" reads at a glance. The ending moved from static cards to a highlighted card and a logo lockup, and the video is 1.2 s shorter.
- **Visuals:** the boards are recognisable motherboards, stacked full-width so the stick is large. Board detail and the off-stage board are hidden in the close-ups.
- **Type:** Inter, SpecSmith's own UI font, instead of DejaVu.
- **Sound:** a soft pad, a light beat that drops in on the jam, and music ducking under the voice. The temp voice is respelled ("dee dee ar") and lightly EQ'd and compressed.

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

**Delivery:** friendly and quick. Say "DDR-four" / "DDR-five" as words.

| Cue | Starts | Line |
|---|---|---|
| 1 | 0.0 s | Reusing old DDR4? |
| 2 | 1.9 s | It won't fit a DDR5 slot. |
| 3 | 4.3 s | The notch is in a different place, so it can't line up. |
| 4 | 7.8 s | Your DDR4 needs a board with DDR4 slots. |
| 5 | 11.8 s | Pick the wrong board, and SpecSmith flags it. |
| 6 | 15.0 s | Check yours at SpecSmith. |

The render refuses any take that runs past its shot.

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
