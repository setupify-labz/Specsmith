# Daily Short proposal

Proposes **one** beginner PC troubleshooting Short and renders its animated cut as a draft, for a person to fact-check and review.

**What it can and cannot do today.**
- It renders **two known topics**, each from a hand-written description with sourced facts. It picks between them from the channel data.
- In the 2026-10-11 demo, the data picked the RAM Short. The CPU-power Short was rendered by an operator's `--topic` choice.
- Every new topic still needs a written description and facts a person has approved.
- This is progress toward automation, not an endless daily video maker.

From one snapshot, the job writes the proposal, renders the proposal's animated cut (silent, plus a version with synced sound effects), and checks the exported files. It calls no paid provider, generates no voice (no ElevenLabs), schedules nothing and publishes nothing.

**It proposes only topics it can render.** A topic needs a registered animation template (`animations.ts`). Two exist:

| Template | Topic | How it is built |
|---|---|---|
| `cpu-power` | "New build won't boot? Check the CPU power cable" (12.6 s) | A **spec** (`nextVideoCpuPower/cut.ts`): data only, rendered by the shared scene library |
| `ram-seat` | "Added RAM, now it won't boot?" (12.4 s) | Hand-built (`nextVideoRamSeat/`), kept exactly as reviewed |

The other topics are recorded as "no animation template yet". When every producible topic is covered by a published title, the job refuses with `no-topic`. It never falls back to text cards.

### Adding a topic: a spec, not a renderer
`animationScenes/` is the shared scene library, in the style of the recent PC Shorts:

| Scene | What it shows |
|---|---|
| `powerButton` | The PC, its button and the monitor |
| `psuRear` | The back of the power supply: switch, cord out or in |
| `caseOpen` | The side panel off or on, a camera move, an outlined part |
| `connectorCompare` | A right and a wrong cable end, face-on |
| `connectorInsert` | A plug pressed home, its latch catching |

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
- `runs/2026-10-11-ram-seat`: the data's pick;
- `runs/2026-10-11-cpu-power`: `--topic cpu-power-cable`.

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
0. Topics without an animation template are dropped.
1. The fastest troubleshooting Short (public views per day) sets the symptom family.
2. The best-retained Short's length is recorded, using only analytics samples of at least 300 views (clamped to 10–15 s). The cut keeps its template's length; its timing is never stretched.
3. Topics an existing title already covers are dropped.
4. Ties are broken by an editorial prior, which is recorded as editorial judgement, not data.
5. TikTok and Instagram rows are recorded as context only. Metricool's rows are per publish day, not per video.

## Gates reused
- `v2/antiSlop.ts`
- `v2/research/strictEvidenceGate.ts`, against a research contract built from the topic's claims and risky claims
- `nextVideoMonitorPort/storyboard.ts` `FORBIDDEN_CLAIMS`
- `v2/review/humanGates.ts`: all gates unresolved; no gate can close without a trusted approval record

The strict research gate runs twice:
- **Blocking:** risky claims. Any mention stops the run.
- **Fact check:** the topic's own claims, recorded as `requires-human-judgment`. The run lists the lines that rest on them, and no claim is ever filed as safe.

One new check: on-screen text at no more than 20 characters per second. For an animated topic, it is measured per label, over the time that label is actually visible.

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
