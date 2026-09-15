# MASTER #6 — Rendering the authored concept

Checkpoint: `7ea733de18bf96d178b1aacdfd946d2ede7a650e`, CI green
([run 35026411136](https://github.com/setupify-labz/Specsmith/actions/runs/35026411136))
before any of this work started.

## What was rendered

Attempt 3's `claude-batch-commit-first`, from its own storyboard. Not the
pre-existing offline smoke video — that is a different hand-authored 8-second
timeline about two other GPUs, and nothing here reuses it.

| | |
| --- | --- |
| source | `fixtures/creative-file-workflow/batches/attempt-3/01-commit-first.json` |
| capture | the exact state the concept names, checked against `stateIdentifier()` before rendering |
| narration | the five authored beat narrations, local espeak-ng fixture, no paid provider |
| captions | the authored `onScreenText`, on the authored beat boundaries |
| output | 1080×1920, H.264/AAC, 44.5s, 1.3 MB |
| sha256 | `deaa48badabaa07593a9329d0964752b0a0da3606490bd2f43a679a18171aff2` |

The renderer refuses to proceed if the capture it would produce is not the state
the concept declares, so it cannot quietly render a different page.

## Renderer blockers found, and what was done

### 1. The disclosures could not be rendered at all (fixed)

The concept requires both disclosures on every beat. Neither could be a caption
cue:

- Cues may not overlap, so a disclosure would have to take its turn and be
  absent for most of the piece.
- The caption style fits 28 characters a line over two lines. The disclosures
  are 88 and 78 characters. The renderer does not truncate — it joins the
  overflow onto line two, which runs off the frame.

The first render proved this concretely: **no disclosure appeared anywhere**,
while two "Est. Avg FPS" figures and roughly forty per-game estimates were on
screen. That is exactly what the repository's data-integrity rule forbids —
estimated data labelled whenever visible, not later in a flow.

Fixed by adding an opt-in persistent disclosure band to the caption renderer: a
separate smaller style on its own layer, held for the full duration. Both
disclosures now render verbatim for all 44.5s, confirmed by reading the frames.

The band is opt-in, and that matters: the existing smoke render's committed
human-inspection evidence is bound to exact bytes. A state without disclosures
produces byte-identical output, verified by re-running the smoke render and
confirming its sha256 is still
`411871e67befce21abcff874dd2db8d67b0d4d8cff2c0cbfb8505a83818805db`.

### 2. The authored 42s does not fit the narration (worked around, reported)

The compositor hard-cuts at `durationSeconds`. Local espeak-ng speaks the five
beats in 44.41s, so rendering the declared 42s would have clipped the narration
mid-sentence — including the beat that carries the price qualifier.

The renderer measures the narration first and holds the piece open to 44.5s,
scaling the caption cues proportionally. Nothing is clipped.

This is a real mismatch, not a fix: the authored beat timings and the local
voice's pacing disagree by about 6%. A human read, or a different voice, would
land somewhere else again. Beat timing in this repository is currently a
statement of intent, not something any renderer honours exactly.

## Remaining blockers — not fixed, reported

These are visible in the delivered frames and are design calls I did not make
unilaterally:

1. **The disclosure band overlaps the page header.** It is anchored top-centre
   and collides with the SpecSmith logo and the resolution selector row. Both
   disclosures are legible, but the brand mark behind them is not. Moving the
   band is a layout decision that belongs with the human readability review.
2. **Beat captions sit over the chart.** "Editorial parts subtotal only" and
   "Undecided is a result" land mid-frame across the bars. They have an outline
   and are readable, but the composition is not designed.
3. **Three chart rows are clipped by the page itself.** Valorant, CS2 and Apex
   Legends run past the right edge at this viewport — the chart has a 640px
   minimum width and relies on horizontal scrolling that a static capture cannot
   perform. Their values are simply not visible. That is a Compare page layout
   limitation at vertical video width, not a compositor bug.
4. **Nothing is staged.** One static capture is held for the whole 44.5s. That
   is what the concept declares (`single-surface-hold`), and it is honest, but
   44 seconds on one still is a real viewer-attention problem that no machine
   check here measures.

## What this render does NOT establish

- **No human has reviewed it.** The quality gate binds approval to a committed
  record of a genuine inspection of exact bytes. No such record exists for these
  bytes, and I did not create one.
- **PR #92's human audio gate is untouched and unsatisfied.**
- **The narration is a fixture voice**, labelled `isFixture: true` /
  `isPaidProvider: false` in its own artifact metadata.
- **The research behind the script is the synthetic engineering fixture.**
- **Readability is unmeasured.** I read two frames; that is not a readability
  review at real playback speed.
- Nothing was published, scheduled, merged, or paid for.

## Verification

- CI green on the checkpoint before starting.
- Typecheck clean; full suite 3802 tests across 206 files.
- Smoke render re-run and confirmed byte-identical.
- Narration 44.41s fully contained in the 44.5s audio stream — nothing clipped.
- Three negative controls on the disclosure band: breaking the style definition,
  shortening the band to one second, and allowing an empty disclosure each broke
  tests. The first control initially passed, which exposed a missing assertion;
  a test that every referenced style is actually defined was added, and the
  control then failed as it should.
