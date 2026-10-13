# Daily Short proposal

Proposes **one** beginner PC troubleshooting Short and renders its animated cut as a draft, for a person to fact-check and review.

**What it can and cannot do today.**
- It holds a **review queue of seven topics**. Each is a distinct beginner PC problem with sourced claims and a data-only animation spec on the shared scene library.
- Each run proposes the next eligible topic **without `--topic`**: topics a person has taken for review (the used-topic ledger) or that a published title already covers are skipped. When none is left, the run refuses with `no-topic`; it never falls back to text cards.
- Every proposal stops at **human fact-check and video review** (status `awaiting-fact-check`). The sources were read through search excerpts only, and a person must read each page once.
- Every new topic still needs a written spec and claims a person approves. This is a queue of reviewed-to-be drafts, not an endless daily video maker.

From one snapshot, the job writes the proposal, renders the proposal's animated cut (silent, plus a version with synced sound effects), and checks the exported files. It calls no paid provider, generates no voice (no ElevenLabs), schedules nothing and publishes nothing.

**The review queue** (`reviewQueue/` and `nextVideoCpuPower/`), in the order the 2026-10-11 snapshot ranks it:

| # | Topic | Family | Spec |
|---|---|---|---|
| 1 | New build won't turn on? Check the CPU power cable | won't turn on | `nextVideoCpuPower/cut.ts` |
| 2 | Power button does nothing? Check the front-panel pins | won't turn on | `reviewQueue/frontPanelPins.ts` |
| 3 | New build won't turn on? Check the 24-pin cable | won't turn on | `reviewQueue/atx24Pin.ts` |
| 4 | PC on, no picture? Check the graphics card's power cable | on, no picture | `reviewQueue/gpuPowerCable.ts` |
| 5 | PC on, monitor blank? Check the input setting | on, no picture | `reviewQueue/monitorInputSource.ts` |
| 6 | "CPU Fan Error" at startup? Check the CPU_FAN header | boot message | `reviewQueue/cpuFanHeader.ts` |
| 7 | Using two RAM sticks? Check which slots | setup | `reviewQueue/ramSlots.ts` |

The won't-turn-on family comes first because the channel's fastest troubleshooting Short is in it; within a family, the editorial prior (not data) orders the topics.

**Left out on purpose:** the power-supply switch and moving the monitor cable from the motherboard to the graphics card. The published Short "PC Won't Turn On? Check These 2 Spots First" (`46uG78uXmHg`, 2026-10-10) covers both, and its title names neither, so no coverage pattern could catch it.

**The hand-built RAM cut** (`ram-seat`, "Added RAM, now it won't boot?") stays producible, but only on an operator's `--topic ram-not-seated`: it predates the scene library and is not a data-only spec.

### Marking a topic used
```
pnpm exec tsx scripts/content-automator/dailyShortProposal/markUsed.ts --topic <topic id> --by <your name> [--note "<why>"]
```
This appends one entry to `used-topics.json`: who took the topic for review, and when. It records nothing else. It does not say the Short was fact-checked, approved, voiced, scheduled or published. The committed ledger starts empty. The run reads it (or `--used <path>`), skips the marked topics even on `--topic`, and records the ledger's path, hash and entries in `proposal.json` and `PROPOSAL.md`. The ledger refuses unknown topics, duplicates, a missing name and future dates, and is written atomically.

**Demonstration** (`runs/2026-10-13-review-queue/`):
- **Runs:** the job ran eight times with no `--topic`, marking each pick in a temporary copy of the ledger (`demo-ledger.json`, never the committed file).
- **Results:** days 1–7 proposed the seven topics in the order above, each with a rendered silent cut passing 17/17 render checks. Day 8 refused with `no-topic`. `queue-demo.log` is the transcript.
- **Snapshot age:** the snapshot was 45 h old, so those runs pass `--max-age-hours 72` explicitly.

### Adding a topic: a spec, not a renderer
`animationScenes/` is the shared scene library, in the style of the recent PC Shorts:

| Scene | What it shows |
|---|---|
| `powerButton` | The PC, its button and the monitor |
| `psuRear` | The back of the power supply: switch, cord out or in |
| `caseOpen` | The side panel off or on, a camera move, an outlined part |
| `connectorCompare` | A right and a wrong cable end, face-on |
| `connectorInsert` | A plug pressed home, its latch catching |
| `frontPanelHeader` | A front-panel pin header (an example layout); the button's plug moved to PWR SW |
| `rearIo` | The back of the PC: motherboard ports up top, the graphics card's lower down; a display cable |
| `monitorMenu` | A monitor's input menu; the selection moves; the screen stays dark |

`caseOpen` can also draw a 24-pin socket, a graphics card power socket, memory sticks in labelled slots, and the CPU_FAN / CHA_FAN headers with a fan plug. `powerButton` can show a stylized start-up message and take a camera move. Each extra is drawn only when a spec asks for it: the CPU cut renders byte-identical to before.

A new Short is a `CutSpec`:
- captions, beats, a timeline of those scenes, labels and sound cues;
- the sources its claims rest on, each with a quote.

`templateFromSpec()` turns it into a template. `specProblems()` refuses a spec before anything renders: a caption gap, a frame without a scene, a label too brief to read or overlapping another, a cue outside the cut, or a forbidden claim. A topic that needs a part the library cannot draw needs a new scene added to `library.ts`.

## 1. Collect today's snapshot (in an assistant session with the connectors)
The owner's Metricool plan has no REST API, and vidIQ has no API in this repository. The numbers therefore come from the **Metricool** and **vidIQ connectors**, through read-only calls, saved as `snapshots/<YYYY-MM-DD>.json` (format: `channel-metrics-snapshot-v1`; see `snapshot.ts`).

| Source | Connector call | Fields |
|---|---|---|
| YouTube, per video | `vidiq_user_videos` | Title, published time, length, public views, likes and comments |
| YouTube, per video | `vidiq_channel_analytics` with `report=top_videos` | Views, engaged views, average view percentage and duration, shares, subscribers gained |
| TikTok, by publish day | Metricool `getAnalyticsDataByMetrics` (TKEV01–07) | Videos, views, likes, comments, shares, followers |
| Instagram, by publish day | Metricool `getAnalyticsDataByMetrics` (IGEV01, 22–29) | Reels, views, reach, interactions, followers |

Any metric a provider does not return is written as `"unknown"`, never filled in.

**Cost:** about 5–10 vidIQ credits per snapshot (5 measured on 2026-10-11). Metricool reports no per-call cost.

The current vidIQ plan has 150 credits a month. That covers a snapshot roughly every day only at 5 credits; at 10, it covers about 15 days a month.

## 2. Run the job
```sh
cd artifacts/SpecSmith
SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
pnpm exec tsx scripts/content-automator/dailyShortProposal/run.ts \
  --snapshot scripts/content-automator/dailyShortProposal/snapshots/2026-10-11.json
```

`--out` must name a new or empty folder; the job refuses anything else and never deletes files.

Add `--topic <topic id>` to propose a specific topic instead of the data's pick. It must still be producible and uncovered. The proposal records it as the operator's choice, with the data's own pick beside it. The 2026-10-11 demo used this to run both templates from one snapshot:
- `runs/2026-10-11-cpu-power`: the data's pick;
- `runs/2026-10-11-ram-seat`: `--topic ram-not-seated`.

You can also run it with the **Daily Short proposal (manual)** workflow, by dispatch only, once it is on the default branch. The workflow takes an optional `topic` input.

**Exit codes:**
- `0`: the draft is rendered and its status is `awaiting-fact-check`.
  - The job never reports "ready": nothing in it can verify a source.
  - The proposal lists every line that rests on an unverified claim, with the page to read.
- `2`: written, but an automated gate blocked it.
- `2` also covers a render check that failed (see `verification.json`). When a gate blocks, nothing is rendered.
- `1`: refused, with the reason printed. Causes are:
  - a missing, invalid or stale (older than 36 h) snapshot;
  - a needed source marked unavailable;
  - Chromium, ffmpeg, ffprobe or the fonts missing;
  - no producible topic left (`no-topic`).

A run takes about 30 s here: about 20 s to render, about 10 s to verify.

## 3. Review the folder (`render-output/daily-proposals/<time>-<topic>/`)
- `PROPOSAL.md` (and `proposal.json`):
  - the frame-one hook, script and storyboard;
  - the evidence;
  - **the metrics that influenced the choice** (source, value and use for each);
  - **unknowns**;
  - automated gate findings;
  - every human gate, unresolved.
- `<template>-silent.mp4`: the finished animated cut, silent. This is the deliverable.
- `<template>-sfx.mp4`: the same picture with synced sound effects. No voice, no music.
- `beats-phone.png` (the middle frame of every beat) and `phone-every-0.25s.png`: exported frames at phone size.
- `verification.json`: checks on the exported files.
  - Both MP4s: 1080×1920, the template's length, and the exact frame count.
  - Every beat's artwork is drawn, and differs from every other beat's.
  - The ILLUSTRATION band is on every sampled frame, and caption text is present.
  - Every short cue has its own onset, so two clicks 35 ms apart each need their own sound.
  - Every sound cue sounds, each measured clear of overlapping cues.
  - Silence between cues, so there is no stray or boot sound.
  - The template's clearest cue (the clip snap) is at least 6 dB above the rest.
  - The silent MP4 is silent.
  - The effects stay well below a −16 LUFS narration.
- `run-report.json`: stage timings and spend.

## How the topic is chosen (`select.ts`)
0. Topics without an animation template are dropped, as are topics marked used in the ledger and (unless an operator names it) the hand-built RAM cut.
1. The fastest troubleshooting Short (public views per day) sets the symptom family.
2. The best-retained Short's length is recorded, using only analytics samples of at least 300 views (clamped to 10–15 s). The cut keeps its template's length; its timing is never stretched.
3. Topics an existing title already covers are dropped.
4. Ties are broken by an editorial prior, which is recorded as editorial judgement, not data.
5. TikTok and Instagram rows are recorded as context only. Metricool's rows are per publish day, not per video.

## Gates reused
- `v2/antiSlop.ts`
- `v2/research/strictEvidenceGate.ts`, against a research contract built from the topic's claims and risky claims
- `animationScenes/forbiddenClaims.ts` `FORBIDDEN_CLAIMS`
- `dailyShortProposal/humanGates.ts`: all gates unresolved; no gate can close without a trusted approval record

The strict research gate runs twice:
- **Blocking:** risky claims. Any mention stops the run.
- **Fact check:** the topic's own claims, recorded as `requires-human-judgment`. The run lists the lines that rest on them, and no claim is ever filed as safe.

Two new checks:
- **Reading speed:** on-screen text at no more than 20 characters per second. For an animated topic, it is measured per label, over the time that label is actually visible.
- **Outcome promise (an early warning, not proof).** It blocks lines claiming the PC boots, loads, works or is fixed afterwards.
  - It is a finite pattern list and has missed six rewordings, so passing it never means a video is safe to publish. The factual-takeaway human gate stays required.
  - Instructions such as "Then try booting again." are allowed.
  - Claims that the PC boots or works afterwards are not allowed unless a real result is shown and verified.
  - No more one-off phrase patches: the structured replacement is proposed below.

### Proposed: structured line types instead of phrase patterns
Every caption and label in a `CutSpec` declares what kind of line it is, and the checks act on that declaration, not on wording:

| `kind` | Meaning | Rule |
|---|---|---|
| `symptom` | The problem before any check ("New build won't turn on?") | Must come before the first `instruction`; may not appear after it |
| `instruction` | Something for the viewer to do ("Push it all the way in.", "Then try booting again.") | Must be imperative: no grammatical subject, and it opens with a verb (or "Then" plus a verb) from the spec's allowed verbs |
| `result` | An outcome ("It boots now.") | Must cite a `verifiedResult`: a recorded real outcome (capture file SHA-256, hardware, date) that a person has signed off. Today none exist, so any `result` line blocks the run |

This turns the open question, "does this sentence claim a result?", into two checkable ones:
- **Is the declared kind consistent with the line's grammar?** Imperative mood can be checked with a small parser, or a fixed verb list per spec.
- **Does every `result` line point at verified evidence?**

A line mislabelled as an `instruction` to dodge the rule fails the imperative check. The human reviewer sees each line's declared kind in `PROPOSAL.md`. The current pattern list would stay only as a cross-check: it flags an `instruction` or `symptom` line whose wording looks like a result, for the human to look at.

Each producible topic's claims cite named pages:
- **RAM topic:** Crucial's desktop memory install guide.
- **CPU power topic:** an ASUS no-boot FAQ, an ASUS manual warning (quoted on a forum), Corsair's PCIe-versus-CPU page and connector guide, Seasonic's cable-compatibility article, and Crucial's unplug step. Following the owner's review on 2026-10-12:
  - The cut says to use the power supply's own CPU/EPS cable.
  - It says to check the manual for the socket.
  - It no longer turns Corsair's "closest to the CPU" advice into a positioning rule. That advice is about a board with two CPU sockets and only one cable.

These pages were checked from web-search excerpts. This environment cannot open asus.com, corsair.com or seasonic.com, so a person must read them. The other topics' claims are editorial knowledge. Either way, the **factual-takeaway** human gate must re-check them.

## What still needs a person each day
1. **Collect the snapshot** in an assistant session with the Metricool and vidIQ connectors (about 5–10 vidIQ credits).
2. **Review the proposal and fact-check it.** The factual-takeaway gate and every other human gate stay unresolved.
3. **Watch both MP4s on a phone**, with sound, for the hook, pacing and readability. The checks prove the files are well formed and the cues land; they do not prove the Short is good.
4. **Write a spec for each new topic** (about 60 lines of data), and fact-check it. Add a scene to the library only when the topic shows a part it cannot draw yet. This is still the bottleneck: the job has two producible topics.
5. **Approve any voice script and its spend**, then **publish by hand**. The job does neither.
