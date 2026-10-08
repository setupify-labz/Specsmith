# Music alternative: how the background bed was made

**What it is.** An original background bed, composed and synthesized in this repository for the GPU-upgrade Short's music alternative. It is not a third-party track.

## How it was made

**Code:**
- `scripts/content-automator/musicBed.ts` makes the bed with sample arithmetic.
- `soundEffects.ts` mixes it with the existing effects.
- The effects layer is unchanged: the effects file's SHA-256 matches the music-free cut's.

**Sound sources.** No external samples, loops or recordings of any kind:
- **Pad:** chords from detuned sine partials, with a slow 0.1 Hz swell.
- **Pulse:** a soft eighth-note pulse of 12 ms-attack, 90 ms-decay sine plucks, low-passed at 1.8 kHz, on two tones of the current chord.
- **Air:** filtered noise from a seeded generator, so the bed is the same samples every time.
- **High-pass:** the whole bed is high-passed at 110 Hz, so there is no heavy bass.

**Harmony:** `Am(add9) → Fmaj7 → C(add9) → G(sus2)` at 96 BPM, two bars per chord. This is a generic four-chord minor progression; there is no melody, and no existing melody was used or imitated.

**In the mix:**
- **Level:** -44 LUFS once mixed, before mastering, about 20 LU under the take.
- **Ducking:** down a further 6.0 dB, with 0.4 s ramps, during fps-aw figures on screen, fps-val figures on screen, percent figures on screen.
- **Fades:** in over 1.5 s and out over 2 s, silent from 24.1 s.

**Asset:** the music-and-effects track's SHA-256 is `9cd356c6dcdc2d80b266eaf152f0a46d1a40879f1e6dd87f9e249dee6be9b893`; the bed alone is `2f63ef560da8f487e94ad7067afb0207982c951bf326d70bfe888dc64234225c`.

## What this does not establish

Making the audio in this repository records how it was made. It does **not** by itself establish exclusive ownership or copyright clearance:
- a simple chord progression and pulse can resemble existing music by coincidence;
- whether this bed may be published, and under what terms, is a person's decision.

The MASTER #7 rights record therefore marks its licence **unknown** (`rights-unknown`, which blocks final approval) until someone decides.

## Measured in the music alternative (after mastering)

**Loudness and peak:**
- **Final mix:** -16.2 LUFS integrated, true peak -1.9 dBTP; the target was met.
- **Bed vs voice:** the bed sits 22.9 LU under the voice overall, at -34.7 LUFS in an open stretch and -41.8 LUFS under the figures (7.1 dB deeper).
- **Effects vs voice:** effects peak 4.4 dB against the voice's loudness, the same as the music-free cut.

**Unchanged from the music-free cut:** the saved Liam take, its placement and timing, the pictures (every decoded frame is identical), the captions and the effects.

**MASTER #7 verdict:** `awaiting-human-review`. It adds one question for a person (`narration-timing-under-music`): the bed fills the pauses, so line placement must be checked by ear rather than measured as silence.
