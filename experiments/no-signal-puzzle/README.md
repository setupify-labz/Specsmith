# NO SIGNAL port puzzle: a standalone Short experiment

A one-off creative test, not part of SpecSmith's content machine or publishing system. Nothing in the app, the workspace or CI depends on it, and it lives outside the pnpm workspace globs. Read `FACT_SHEET.md` before using any of it.

```bash
cd experiments/no-signal-puzzle
npm ci
node sound/build.mjs            # writes public/puzzle-sound.wav (local ffmpeg synthesis)
npx remotion render NoSignalPuzzle out/no-signal-puzzle.mp4 --codec=h264 --crf=18
```

Every timing lives in `src/timeline.json`, and both the picture and the sound read it. Not published, not scheduled, no voice.
