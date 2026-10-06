# Next Short brief: "Will a new GPU make every game faster by the same amount?"

**Status:** the existing workflow says this is ready for human review. It is **not approved**. Nothing has been rendered, voiced, scheduled or published, and no paid service was used.

## How this brief was made

It went through the existing pipeline. No new framework was built.

1. **Research (MASTER #2).** `research.ts` runs `runResearchPass` on production evidence: SpecSmith's own FPS model and catalog, computed at run time.
   - It uses the same functions Compare uses (`leadsVsAverage/facts.ts`).
   - The snapshot is `specsmith-model-f434ab70dde4e6fa`, the SHA-256 of `fps.ts`, `compareValue.ts`, `compareTally.ts`, `gpus.json`, `cpus.json` and `games.json`.
   - `workflowCli.ts` refuses to run if those files change.
2. **Learning (#174).** The published-post report `external-fb62299dbff66267` enters through `nextBriefForWorkflow`. That call refuses simulated data for a production brief. All 13 of its memory lines are carried into the brief.
3. **Creative workflow (MASTER #6 file workflow).** `runCreativeFileWorkflow` exported the brief and imported three authored concepts. It ran them through the evidence gate, the divergence and capture-state checks, and MASTER #1's storyboard review.
   - It took five attempts (`workflow/batches/attempt-1…5`, feedback in `workflow/feedback/`).
   - Attempt 5 passes every machine check: brief `278a7916…`, batch `d3b42e25…`, status `awaiting-human-review`, `approved: false`.

Re-run:

```
cd artifacts/SpecSmith
pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/workflowCli.ts review
pnpm exec vitest run scripts/content-automator/nextVideoGpuUpgrade
```

## What #174 contributes, and what it does not

- **Observations.** Six posts were published outside the MASTER #8 authorization boundary. None of them has a trusted metric. Their opening frames were measured from the files:
  - **RAM-fit:** frame one shows the claim as a caption, about 40 px of 1280 (3.1% of the height).
  - **FPS-20-wins:** frame one has no caption. Its claim text is 9–23 px, readable only after the 1.3 s push-in.
- **The hypothesis carried forward.** A claim that is readable on frame one may keep more viewers through the first seconds. It is untested.
- **The TikTok snapshots are exploratory context only.**
  - RAM: 1,045 views and 17 likes.
  - FPS: 82 views and 0 likes.

  They are relayed Metricool snapshots and may be delayed. Their sync time is unknown, and the two posts went out at different times. **They are not evidence that one format won.** They were not used to choose or rank anything below.

## The question, and what may be said

**Viewer question:** "Will a new GPU make every game faster by the same amount?"

**Primary Compare state:** RTX 5070 + Ryzen 5 7600 vs RTX 4060 + Ryzen 5 7600, 1440p High (`compare_rtx5070_r5-7600_vs_rtx4060_r5-7600_1440p_high_static_540x960-2`).

**Extra real views of the same pair:** 1080p High, 4K High, 1440p Ultra and 1080p Ultra. These are for beats that state nothing; no beat quotes their numbers.

**Approved claims.** Each must be labelled **Estimated FPS** on screen. The persistent overlay reads: *"FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems."*

| Claim | Estimated FPS (1440p High, same Ryzen 5 7600) |
|---|---|
| RTX 4060 → RTX 5070 in Alan Wake 2 | 43 → 65 |
| RTX 4060 → RTX 5070 in Valorant | 263 → 305 |
| RTX 5070 build ahead | in all 20 games |
| The model weights each game by how much it leans on the GPU | Alan Wake 2 0.92, Valorant 0.45 |

**Refused angles. Do not use them.**

- **"The CPU matters less at 4K, so the upgrade helps more there."** This is false of the model. Each game's GPU weight does not change with resolution, so the after/before ratio is identical at 1080p, 1440p and 4K (1.16 for Valorant at all three).
- **"The RTX 5070 is the better purchase."** There are no prices or buyer profile, and Compare shows no prices.
- **"These were measured on real hardware."** They are model estimates only.

## The three concepts

All three are real Compare captures, and all three are under 30 s.

| | Concept | Structure | Length | Key beats |
|---|---|---|---|---|
| A | **Guess the game** (`gpu-gains-guess-the-game`) | participant · prediction → reveal | 26 s | **Question hook:** "Which game gains more?" **Pick:** Alan Wake 2 or Valorant. **Reveal:** 43 → 65, then 263 → 305, with the model's GPU weighting as the reason. **Close:** "Check the games you actually play." |
| B | **Read your games** (`gpu-gains-read-your-games`) | investigator · question → evidence → boundary | 27 s | **Hook:** "Same boost in every game?" **Evidence:** ahead in 20 of 20, then the two games. **Boundary:** "Estimates, not a verdict." **Close:** "Look up the games you play first." |
| C | **More frames ≠ bigger upgrade** (`gpu-gains-more-frames-smaller-boost`) | spectator · continuum → falsification | 28 s | **Hook:** the myth. **Evidence:** Valorant +42 frames vs Alan Wake 2 +22. **Reversal:** "Smaller number, bigger jump." **Then:** "Judge the jump," pick a game, check it. |

## Ranking

### 1. A: Guess the game (recommended)

- **The hook is a question the viewer can answer in a second.** Its frame-one caption is the question itself, so the opening-caption test is as clean as a single video allows.
- **The load is small.** It needs only two numbers and one reason, and the reason (the model weights each game by how GPU-bound it is) gives a beginner a rule they can reuse.
- **It doesn't repeat the published FPS Short.** That video's hook was "leads all 20 games"; A's story is per-game difference, not a tally.
- **It is the shortest:** 26 s.
- **Risk:** "Pick one" can feel like a gimmick if the pause is long. Keep the commitment beat at 2.5 s.

### 2. B: Read your games

- **Strength:** the most complete and the most explicit about limits. It is the only concept that says on screen that this is not a buying verdict.
- **Busiest:** seven beats.
- **Weaker frame one:** "Same boost in every game?" is a question about a claim the viewer hasn't seen yet.
- **Too close to the FPS Short:** its middle beat ("ahead in 20 of 20") echoes that Short's framing.

### 3. C: More frames ≠ bigger upgrade

- **Strength:** the most counter-intuitive.
- **Its key line is derived, not approved:** "Fewer frames added, yet from 43, that's the bigger jump" is arithmetic on approved numbers (+22 is 51% of 43; +42 is 16% of 263). The evidence gate does not check that line, so it needs the heaviest human fact-check.
- **It asks the viewer to compare ratios in 4.5 s.**
- **Weak close:** at 28 s it is the longest, and it ends on two thin beats.

## The creative improvement to test

**Change:** the spoken hook appears as a full-size caption from **frame 0**, with no fade-in. It uses the pipeline's own caption style: Arial Bold 72 on a 1920-high frame, white with a black outline, two lines of at most 28 characters. This is #174's hypothesis, applied as one variable.

**Measurable outcome.** It has two parts.

1. **Pre-publish check (pass/fail, from the render file):**
   - Frame 0 shows the hook caption.
   - Its text rows measure at least **3.1% of the frame height**, measured the same way as the RAM-fit copy (rows of caption-coloured pixels). That is ≥ 60 px at 1920 and ≥ 40 px on a 1280-high platform copy.
2. **Post-publish outcome (YouTube only):**
   - **What to read:** the share of viewers still watching at **3 s** (`audience-retention-curve`) and `average-percentage-viewed`.
   - **How:** both are read by a registered, trusted YouTube source **48 h after a confirmed publication time**.
   - **Comparison:** against `fps-20-wins@ce47598` at the same 48 h age, read the same way.
   - **Decision rule:** if the new Short's 3 s share is at least the FPS Short's, keep frame-one captions as the default for the next two Shorts and re-test. If it is lower, treat the hypothesis as not supported.
   - **Limit:** the two videos also differ in topic, length and posting time. Either way this is one directional observation, not a causal result.
   - **Blocked today:** there is no trusted YouTube credential, and the FPS Short has no confirmed publication time. Until both exist, the outcome cannot be measured and the hypothesis stays untested. TikTok counts can't be used: they come only as exploratory snapshots, and the API exposes no retention.

## Branding without a spoken promotional outro

- **The picture is SpecSmith's own product:** every shot is a real capture of the Compare page.
- **Attribution, not promotion:** the narration names "SpecSmith's model estimates" because the claims require that attribution.
- **On screen only:** the route `specsmithpc.com/compare` appears in the last caption.
- **The last spoken line is advice to the viewer:** "Check the games you actually play." No "visit", "follow" or site name is spoken. A test enforces this for all three concepts.

## First-three-second storyboard (Concept A)

The video is 1080×1920 at 30 fps, so 0–3.0 s is frames 0–89. One shot, shown as a static hold:

- **Picture:** the real Compare capture at **1080p High** (`compare_rtx5070_r5-7600_vs_rtx4060_r5-7600_1080p_high_static_540x960-2`), full frame.
  - It shows both builds' part names: RTX 5070 + Ryzen 5 7600 and RTX 4060 + Ryzen 5 7600. The viewer can see "same CPU" for themselves.
  - It also shows the per-game estimated-FPS bars and the tally.
  - The capture is a single frame and the brief lists no camera-move capability, so nothing moves. No caption or line refers to these 1080p numbers.

| Time | Frames | Picture | Caption (frame-accurate) | Overlay | Voice (script only, not recorded) | Sound |
|---|---|---|---|---|---|---|
| 0.00 s | 0 | Compare capture, 1080p High | **"Same CPU. New GPU. Which / game gains more?"**: two lines, Arial Bold 72, white, 5 px black outline, bottom overlay margin 290 px, **fully visible on frame 0** | "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems." from frame 0 | Starts on frame 0: "Same CPU, new GPU. Which game gains more?" (8 words, about 2.4 s at a natural pace) | Voice only. No music decision is made here. |
| 0.00–3.00 s | 0–89 | Same hold | Caption holds unchanged, 3.0 s on screen | Holds | Line ends by about 2.4 s, then a short beat of silence before the cut | — |
| 3.00 s | 90 | **Cut** to the 4K High view | "Alan Wake 2 or Valorant?" | Holds | "Alan Wake 2, or Valorant? Pick one." | — |

**Checks for the first three seconds:**

- The caption is the full claim of the hook, so nothing depends on the viewer hearing the audio.
- The caption speed is 41 characters in 3.0 s, or 13.7 characters/s, against the review's comfortable limit of 20.
- Narration density is 2.7 words/s.
- The hook lasts 3.0 s, within the YouTube Shorts envelope of 3.0 s.

## Open human checks before anything is rendered

- **Factual review of the derived line in C, if C is ever chosen.**
- **First frame at 1080p:** confirm the viewer isn't confused by seeing 1080p numbers before the 1440p numbers are quoted. The view switches at the 5.5 s reveal, and the captions always name the setting they quote.
- **Voice:** none was generated. If this goes to production, the voice is a separate approval, and any paid take needs explicit sign-off.
- **The remaining sign-offs** in `workflow/review-packet.json`: creative, readability, rendered media, audio, rights and disclosure, and publishing authorization.

## Defects found in existing modules (not fixed here)

1. **MASTER #2, `confidence.ts` step 4.** A claim whose only evidence contradicts it is rated `strongly-supported`, meaning its negation. `buildResearchCreativeContract` then lists the claim's own **false** proposition under `safeClaims` with no supporting snapshot.
   - The brief filter drops it, so it can't reach an author.
   - The contract still says it, so I kept the 4K claim out of this pass.
2. **Research → creative wording mismatch.** `requiredWordingFor` writes an instruction (`Label the figure "Estimated FPS" wherever it is visible…`), while the creative gate checks `requiredWording` as verbatim text. `research.ts` maps that one instruction to the label it names; nothing else changes.
3. **File workflow message.** An empty latest batch directory reports "Research approved no claim…", which is misleading when research approved four.
