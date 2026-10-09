# Short brief: "Is your monitor plugged into your graphics card?" (animated, 8 s)

## Status

This is an 8-second **stylized animation**, silent and for review only.

- **Labelled as illustration:** every frame carries "ILLUSTRATION · Stylized hardware · not a real PC".
- **Stylized, not realistic:** the tower back is flat outlines (port panel, exhaust fan, expansion slots, power supply), never a realistic rendering.
- **No result shown:** there is no monitor result, no NO SIGNAL and no FPS figure.
- **Nothing spent or published:** no voice, publishing or scheduling.

## Edit (8.0 s, 1080×1920, silent)

| Time | Picture | Caption |
|---|---|---|
| 0–0.6 s | **Frame one:** the whole PC back. The cable is in the lit motherboard port panel, tagged **MONITOR CABLE**. **MOTHERBOARD PORTS** sits above and **GRAPHICS CARD PORTS** below. The fan turns slowly. | Bought a graphics card. / Is your monitor plugged into it? |
| 0.6–2.75 s | **One move:** the plug lifts out, arcs down and seats in the graphics card's port. A cyan ring marks it. | (same) |
| 2.85–4.35 s | Close-up on the motherboard port panel, which lights purple. The cable is gone from it. | Motherboard ports: up here |
| 4.35–5.85 s | Pan down to the graphics card, which lights cyan with the cable seated. | Graphics card ports: down here |
| 5.85–8.0 s | Back out to the whole PC, with a small `specsmithpc.com`. | **Check where your monitor cable goes.** |

## Proposed voice script (not voiced)

> Bought a graphics card? Is your monitor plugged into it? Use the ports down here, on the card. Check where yours goes.

**Length: 118 characters,** about 8.7 s at the saved GPU take's pace. That is slightly over 8 s: the final hold would stretch to fit the take.

## Checks

- **Phone-size review.** I checked the full video at phone size, one frame every 0.5 s, plus 360×640 key frames. I fixed three things: a clipped label in the motherboard close-up, a clipped "MONITOR CABLE" tag, and the wide-shot framing. The smallest type is 42 px.
- **18 storyboard tests:** the beats are hook, motherboard, graphics card and close, with no result, NO SIGNAL, FPS or "on this PC" copy, and the length is within 8–10 s.

## Provenance

| Asset | Origin | Licence |
|---|---|---|
| Port diagram, cable | `illustrativeDraft.ts`, drawn with canvas outlines; not any real product | Repo's own |
| Inter 400/600/700 | `nextVideoRefreshRate/fonts/` (npm `@fontsource/inter@5.3.0`) | SIL OFL 1.1 |
| Colours | `src/index.css` `--ff-*` | SpecSmith's own |

## Reproduce

```
cd artifacts/SpecSmith
SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
  pnpm exec tsx scripts/content-automator/nextVideoMonitorPort/illustrativeDraft.ts
```
