# Short brief: "Is your monitor plugged into your graphics card?" (animated)

## Status

This is a 9-second **stylized animation**, silent and for review only. It was made without filming, as requested.

- **Labelled as illustration:** every frame carries "ILLUSTRATION · Stylized hardware · not a real PC".
- **Flat diagram, not hardware:** the ports are outlines, never a realistic rendering.
- **No result shown:** there is no monitor result, no NO SIGNAL and no FPS figure.
- **Nothing spent or published:** no voice, publishing or scheduling.

## Edit (9.0 s, 1080×1920, silent)

| Time | Picture | Caption |
|---|---|---|
| 0–2.8 s | **Frame one:** the cable is plugged into the lit **MOTHERBOARD PORTS** row, tagged **MONITOR CABLE**, with one amber pulse on that port. **GRAPHICS CARD PORTS** sits below. | Bought a graphics card. / Is your monitor plugged into it? |
| 2.8–5.0 s | **One move:** the plug pulls out at 2.8 s, arcs down and seats in the graphics card at **4.0 s**. That row lights, with one cyan ring. | Move it to the graphics card |
| 5.0–9.0 s | The connected graphics card, with a small `specsmithpc.com` in the scene. | **Check where your monitor cable goes.** |

**Cut from the 13 s draft:**
- the two explanation punch-ins;
- the result placeholder;
- the closing GPU instruction.

## Proposed voice script (not voiced)

> Bought a graphics card? Is your monitor plugged into it? Move it to the graphics card. Check where your monitor cable goes.

**Length: 123 characters,** about 9 s at the saved GPU take's pace. It makes no outcome, FPS or detection claim.

## Checks

- **Phone-size review.** I checked the full video at phone size, one frame every 0.5 s, plus 360×640 key frames. The smallest type is 42 px, which is 14 px on a 360-px screen.
- **18 storyboard tests:**
  - the beats are hook, move and close only;
  - no copy mentions a result, NO SIGNAL, FPS or "on this PC";
  - the length stays within 8–10 s;
  - the forbidden-claim guards hold.

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
