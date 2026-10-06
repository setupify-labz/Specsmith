# "20 wins. Only 4 FPS apart?": standalone Short experiment

This is a one-off visual draft. It sits outside the pnpm workspace and SpecSmith's content machine, and nothing publishes it.

## Verified Compare inputs and outputs (2026-10-06, origin/main 2d9ad28)

**Inputs** (the same as the page link `/compare?gpuA=rtx4080s&cpuA=r9-9950x3d&gpuB=rtx4080&cpuB=r9-9950x3d&res=1440p&preset=high`):

| Build | GPU | CPU | Resolution | Preset |
|---|---|---|---|---|
| A | RTX 4080 Super (`rtx4080s`) | Ryzen 9 9950X3D (`r9-9950x3d`) | 1440p | High |
| B | RTX 4080 (`rtx4080`) | Ryzen 9 9950X3D (`r9-9950x3d`) | 1440p | High |

**Model** (`verify/verify.mts` → `src/verified.json`):

| Output | Value |
|---|---|
| Games | 20 |
| RTX 4080 Super leads | 20 |
| RTX 4080 leads | 0 |
| Ties | 0 |
| Estimated average FPS, as displayed (`getAverageFps`, rounded) | 164 vs 160, a gap of 4 |
| Unrounded averages | 164.30 vs 159.75, a gap of 4.55 |
| Per-game lead | 2 to 7 FPS |

**Live page:** the built `/compare` page for those inputs shows "20 Modelled Game Leads" vs "0", "Est. Avg FPS: 164" vs "160", and "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems."

**Ties:** the page counts a tie as a lead for Build A (`fpsA >= fpsB`), so ties were counted separately here. There are none, so the page's 20 is a strict 20.

**What "4 FPS apart" means:** the difference between the two averages the page displays. The video shows it as "164 vs 160" with "Averages as shown on SpecSmith Compare".

## Exact on-screen text

1. RTX 4080 SUPER · vs · RTX 4080 · Same Ryzen 9 9950X3D · 1440p High · 20 games · How big is the gap?
2. Cyberpunk 2077 / SUPER LEADS · Fortnite / SUPER LEADS · Valorant / SUPER LEADS
3. Tiles reading "SUPER" · counter "N / 20" · MODELLED GAME LEADS
4. 20 / 20 · MODELLED GAME LEADS · 0 TIES · 0 FOR THE RTX 4080 · A blowout?
5. 20 / 20 modelled leads… · 4 FPS apart · Estimated average FPS · 1440p High · Averages as shown on SpecSmith Compare
6. The full-scale ruler: SUPER 164 · 4080 160 · ticks 0–180 · Full scale, from 0 FPS
7. The zoom: 158–166, with 160 and 164 marked, "4" between them, and "Zoomed in: 158–166 FPS"
8. Each modelled lead: 2–7 FPS
9. Would you have guessed four? · SPECSMITH
10. On every frame: SpecSmith model estimates · not measured benchmarks

## Assets and sound

- **Visuals:** all graphics are drawn in code (`src/Wins.tsx`), with no screenshots, footage or game art. Game names appear only as text.
- **Font:** Inter, from `@fontsource/inter`, under the SIL Open Font License 1.1.
- **Sound:** synthesised locally with ffmpeg (`sound/build.mjs`) from sines, chirps and noise, with no samples, music or voice. It is mixed to about −18 LUFS, with a true peak around −3.6 dBFS.
- **Renderer:** Remotion 4.0.533. It is free for individuals and companies of up to 3 people; larger companies need a paid company license.

## Rebuild

```bash
pnpm --dir artifacts/SpecSmith exec tsx ../../experiments/fps-20-wins/verify/verify.mts   # refuses if the figures changed
cd experiments/fps-20-wins && npm ci && node sound/build.mjs
npx remotion render TwentyWins out/twenty-wins.mp4 --codec=h264 --crf=18
```

## Proposed voice script (not generated; for approval before any credits are spent)

| Time | Line |
|---|---|
| 0.0 | "RTX 4080 Super versus the RTX 4080. Same CPU, twenty games, 1440p High." |
| 1.4 | "In SpecSmith's model, the Super leads Cyberpunk… Fortnite… Valorant…" |
| 3.1 | "…and every game after that." |
| 6.6 | "Twenty out of twenty. So, a blowout?" |
| 8.7 | "The estimated averages: one-sixty-four… and one-sixty." |
| 10.4 | "Four FPS apart." |
| 12.1 | "Each modelled lead was just two to seven FPS." |
| 13.0 | "Would you have guessed four?" |

About 40 words, roughly 14 s at a natural pace. "Modelled" and "estimated" stay in the spoken words. The video does not need narration to be understood: every claim is on screen and readable with the sound off.
