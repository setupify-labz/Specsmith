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

## v3 cut (11.6 s), 2026-10-06

Rebuilt from the editable source with a new rhythm, not a speed change. Rechecked on origin/main 2d9ad28: the model still gives 20 leads, 0 ties and 164 vs 160, the rendered /compare page shows the same, and the roster matches the 20 entries in `src/data/games.json`.

| Time (s) | Beat |
|---|---|
| 0.00 | Frame one already moving: both GPUs, "Same Ryzen 9 9950X3D · 1440p High", counter 1/20, **Cyberpunk 2077** sliding in |
| 0.80 | **Counter-Strike 2** (counter rolls to 6) |
| 1.60 | **Call of Duty: Warzone** (8) |
| 2.40 | **Baldur's Gate 3** (16) |
| 3.20–3.75 | Counter rolls to 20 under a swell; one tick per counted game |
| 3.90 | **20 / 20 MODELLED GAME LEADS** lands, with "0 TIES · 0 FOR THE RTX 4080" |
| 4.55 | "A blowout?" |
| 5.60 | Hard cut to black and silence |
| 6.00 | 164 vs 160 count up as large numerals over zero-based bars |
| 7.00 | **4 FPS apart** lands (thud and bell), holding about 2 s with 164 vs 160 |
| 9.10 | "Each modelled lead: 2–7 FPS" |
| 10.15–11.60 | "Would you have guessed four?" · SPECSMITH |

The spotlighted titles are full names, checked against the catalogue by `verify.mts`: Cyberpunk 2077, Counter-Strike 2 (catalogue entry "CS2 (Counter-Strike 2)"), Call of Duty: Warzone and Baldur's Gate 3. They appear in roster order, so the counter's jumps honestly cover the games in between.

### The 20-game roster (catalogue order, SpecSmith model estimates at 1440p High)

| # | Catalogue name | 4080 Super | 4080 | Lead |
|---|---|---|---|---|
| 1 | Cyberpunk 2077 | 101 | 97 | +4 |
| 2 | Microsoft Flight Simulator 2024 | 60 | 58 | +2 |
| 3 | Red Dead Redemption 2 | 113 | 109 | +4 |
| 4 | Fortnite | 167 | 163 | +4 |
| 5 | Valorant | 347 | 340 | +7 |
| 6 | CS2 (Counter-Strike 2) | 345 | 338 | +7 |
| 7 | Apex Legends | 236 | 229 | +7 |
| 8 | Call of Duty: Warzone | 165 | 160 | +5 |
| 9 | Elden Ring | 104 | 100 | +4 |
| 10 | Hogwarts Legacy | 93 | 89 | +4 |
| 11 | GTA V (Enhanced) | 140 | 137 | +3 |
| 12 | The Witcher 3 (Next Gen) | 130 | 125 | +5 |
| 13 | Starfield | 90 | 87 | +3 |
| 14 | Alan Wake 2 | 80 | 76 | +4 |
| 15 | Spider-Man 2 (PC) | 97 | 93 | +4 |
| 16 | Baldur's Gate 3 | 116 | 112 | +4 |
| 17 | Rainbow Six Siege | 344 | 337 | +7 |
| 18 | Minecraft (Java, Optifine) | 332 | 327 | +5 |
| 19 | Dying Light 2 | 103 | 99 | +4 |
| 20 | Assassin's Creed Mirage | 123 | 119 | +4 |

### Suggested video description

RTX 4080 Super vs RTX 4080, both with a Ryzen 9 9950X3D, at 1440p High. In SpecSmith's model, the Super leads all 20 games we track (0 ties), yet the estimated averages are 164 vs 160 FPS, 4 apart as shown on SpecSmith Compare. Each modelled lead is 2–7 FPS. These are SpecSmith model estimates, not measured benchmarks, and they cover only this setting and these games:

1. Cyberpunk 2077
2. Microsoft Flight Simulator 2024
3. Red Dead Redemption 2
4. Fortnite
5. Valorant
6. Counter-Strike 2
7. Apex Legends
8. Call of Duty: Warzone
9. Elden Ring
10. Hogwarts Legacy
11. GTA V (Enhanced)
12. The Witcher 3 (Next Gen)
13. Starfield
14. Alan Wake 2
15. Spider-Man 2 (PC)
16. Baldur's Gate 3
17. Rainbow Six Siege
18. Minecraft (Java, Optifine)
19. Dying Light 2
20. Assassin's Creed Mirage

## v4 cut (15.8 s), 2026-10-06

Recut from the editable source to a slower rhythm. Rechecked first: origin/main 2d9ad28, 20/20 leads, 0 ties, 164 vs 160. Three full titles are spotlighted, each verified against the catalogue and its result. The 2–7 FPS line is removed, and the end card is trimmed.

| Time (s) | Beat |
|---|---|
| 0.0–1.3 | Both GPUs and the setting; counter 1/20; **Cyberpunk 2077** |
| 1.3–1.6 | Counter rolls to 8 |
| 1.6–2.9 | **Call of Duty: Warzone** |
| 2.9–3.2 | Counter rolls to 16 |
| 3.2–4.5 | **Baldur's Gate 3** |
| 4.55–5.25 | Counter rolls to 20, one tick per counted game, under a swell |
| 5.4–8.0 | **20 / 20 MODELLED GAME LEADS** · "0 TIES · 0 FOR THE RTX 4080" · "A blowout?" from 6.6 |
| 8.0–8.5 | Hard cut to black and silence |
| 8.5–9.4 | 164 and 160 count up over zero-based bars |
| 10.0–14.3 | **4 FPS apart** lands (thud and bell) and holds with 164 vs 160 |
| 14.3–15.8 | "Would you have guessed four?" · SPECSMITH |

The phone viewing copy is 540×960 H.264/AAC; the master is 1080×1920.
