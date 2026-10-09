# Short brief: "Is your monitor plugged into your graphics card?"

## Status

This is an ILLUSTRATIVE silent draft for review only.

- **No real PC is verified yet.** No CPU, motherboard or GPU is recorded, and neither connection has been observed.
- **No footage exists.** The ports are a flat diagram, labelled "ILLUSTRATIVE DIAGRAM · Not real hardware" on every frame. Nothing is generated to look like real hardware.
- **Nothing was spent.** No voice was generated, and nothing was published or scheduled.

## Script (proposed; not voiced)

> You bought a graphics card. Is your monitor plugged into it? These are motherboard ports. Move it to the graphics card. If you have a dedicated GPU, check its display ports.

**Length: 173 characters,** about 12.6 s at the saved GPU take's pace.

**The result line comes later.** It is added only after the PC is checked, and it says what that PC's screen actually showed. An example: "On this PC, that gives the Windows desktop at 165 Hz." Adding it would push the cut toward 15 s.

## Edit (13.0 s, 1080×1920, silent)

| Time | Picture | Caption |
|---|---|---|
| 0–2.6 s | **Frame one:** both rows labelled, large: **MOTHERBOARD** (purple) and **GRAPHICS CARD** (cyan). The cable sits in the motherboard's video port, tagged **MONITOR CABLE**, with one amber pulse on that port. | You bought a graphics card. / Is your monitor plugged into it? |
| 2.6–4.6 s | Punch-in on the motherboard row, which lights up. | Motherboard ports use the CPU's graphics |
| 4.6–6.6 s | Punch-in on the graphics-card row, which lights up. | Graphics card ports use the card you bought |
| 6.6–8.6 s | **The one cable move:** pull out, arc across, seat in the graphics card's port, with a cyan ring as it lands. Fully moved by 7.8 s. | Move the cable to the graphics card |
| 8.6–10.4 s | **Result shot:** a placeholder until it is filmed. | Result on screen: filmed on the real PC |
| 10.4–13 s | The graphics-card row lit, with a small `specsmithpc.com` in the scene. | **If you have a dedicated GPU, check its display ports.** |

There is no end card and no spoken promotion.

**Fixed after viewing it at 360×640:**
- The cable crossed the "GRAPHICS CARD" label, the explanation text and the result placeholder. It now leaves the frame to the right, between the rows.
- The explanations under each row were hard to read and repeated the captions, so they now live only in the captions.
- The final shot clipped the motherboard label.
- The hook caption broke mid-sentence. This was an escaping bug in the sentence split, now fixed.
- The opening was static for 2.6 s. It now starts tighter, with one pulse on the plugged port.

**Readability:** the smallest type in any frame is 42 px, which is 14 px at 360×640.

## Verify the PC before filming (fill in `PC_RECORD` in `storyboard.ts`)

- [ ] **CPU model.** Find it in Task Manager › Performance › CPU, or in Settings › System › About.
- [ ] **Whether that exact CPU has integrated graphics,** from the maker's spec page. Intel "F" models and many AMD desktop chips have none.
- [ ] **Motherboard model,** from System Information › BaseBoard Manufacturer/Product.
- [ ] **GPU model,** from Task Manager › Performance › GPU, or Device Manager › Display adapters.
- [ ] **The firmware's integrated-graphics setting** as found (for example Auto, Enabled or Disabled). Don't change it for the video.
- [ ] **Motherboard port test.** With the cable in the motherboard's video port, what does the monitor show: picture, black screen or a NO SIGNAL message? Film the screen, and note the adapter shown in Settings › System › Display › Advanced display › Display information.
- [ ] **Graphics card port test.** Repeat with the cable in the graphics card's port.
- [ ] **Performance (optional).** Only if we want a performance line: one game, identical settings, both connections, with the same capture method. Otherwise there is no performance claim at all.

## Exact shot list (real footage)

**Setup:** film vertical 9:16 at 4K or 1080p, 30 or 60 fps, on a tripod. Light the rear panel evenly with no glare on the ports. Use the same framing for shots 1, 4 and 5.

1. **Wide rear panel (3 s).** Both the motherboard I/O and the graphics-card bracket in one frame, with the cable in the motherboard video port. This is the hook frame, and labels are added in the edit.
2. **Motherboard port close-up (2 s).** The plugged motherboard video port, plus the neighbouring USB ports for context.
3. **Graphics card ports close-up (2 s).** The card's display outputs, plus the bracket's vent slots for context.
4. **The move (2–3 s, one continuous take).** A hand unplugs from the motherboard and plugs into the graphics card, in one decisive motion. Do it with the PC on, and touch only the cable.
5. **Seated (1 s).** The cable firmly in the graphics card port.
6. **Result screen, graphics card (2 s).** The monitor, filmed or captured, showing exactly what appeared.
7. **Result screen, motherboard (2 s; used only if it is truthful and useful).** What the motherboard connection actually showed, whether a picture or NO SIGNAL.
8. **Evidence stills (not in the edit).** Display information, Task Manager GPU, and the CPU spec page, kept in the record.

## Factual checks

| Claim in the Short | Basis | Status |
|---|---|---|
| Motherboard video ports use the CPU's graphics | [Intel: Blank Screen When Using Intel HD Graphics 620](https://www.intel.com/content/www/us/en/support/articles/000087454/graphics.html). The motherboard's video port works through integrated graphics, which may be disabled with discrete graphics, and Intel advises connecting to the discrete card. | Checked through search excerpts only; this environment can't open intel.com. A person should read the page once. |
| Graphics card ports use the card | The card's own outputs. | General; confirmed on the PC by the "Display information" adapter. |
| (Not claimed) The motherboard port means NO SIGNAL | A motherboard port can show a picture when integrated graphics are present and enabled. | Refused unless this PC showed it, and then only as "On this PC: …". |
| (Not claimed) The game runs slower on the motherboard port | Windows can assign each app to a GPU: [Intel: How To Set the Default GPU for Applications and Games](https://www.intel.com/content/www/us/en/support/articles/000090168/graphics.html). | Refused without a same-game, same-settings measurement on this PC. |

**What the guards enforce** (`FORBIDDEN_CLAIMS`, 18 tests):
- NO SIGNAL only as this PC's observation;
- no FPS figures or percentages;
- no gain, loss, bottleneck or "wasted GPU" claims;
- no always, never or every;
- nothing suggesting SpecSmith inspects your PC.

`finalCutProblems` also refuses a final cut without the full PC record and footage of both results, and flags a CPU without integrated graphics that is recorded as showing a picture. The illustrative renderer refuses to run once a PC record exists.

## Provenance

| Asset | Origin | Licence |
|---|---|---|
| Port diagram, cable, monitor placeholder | `illustrativeDraft.ts`, drawn with canvas outlines; not any real product | Repo's own |
| Inter 400/600/700 | `nextVideoRefreshRate/fonts/` (npm `@fontsource/inter@5.3.0`) | SIL OFL 1.1 |
| Colours | `src/index.css` `--ff-*` | SpecSmith's own |

## Reproduce

```
cd artifacts/SpecSmith
pnpm exec vitest run scripts/content-automator/nextVideoMonitorPort
SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
  pnpm exec tsx scripts/content-automator/nextVideoMonitorPort/illustrativeDraft.ts
```

**Output:** `render-output/monitor-port-illustrative-draft/`, which is gitignored. It contains the MP4, `phone-*.png`, `phone-sheet.png` and `draft-report.json`.
