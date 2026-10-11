# Daily Short proposal

Proposes **one** beginner PC troubleshooting Short a day and renders its finished animated cut, for a person to review.

From one snapshot, the job writes the proposal, renders the proposal's animated cut (silent, plus a version with synced sound effects), and checks the exported files. It calls no paid provider, generates no voice (no ElevenLabs), schedules nothing and publishes nothing.

**It proposes only topics it can render.** A topic needs a registered animation template (`animations.ts`). Today only `ram-seat` exists (the RAM-seating cut, `nextVideoRamSeat/`); the other topics are recorded as "no animation template yet". Once the RAM Short is published, the coverage check drops it and the job refuses with `no-topic` until a new template is built. It never falls back to text cards.

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

You can also run it with the **Daily Short proposal (manual)** workflow, by dispatch only, once it is on the default branch.

**Exit codes:**
- `0`: ready for human review.
- `2`: written, but an automated gate blocked it.
- `2` also covers a render check that failed (see `verification.json`). When a gate blocks, nothing is rendered.
- `1`: refused, with the reason printed. Causes are:
  - a missing, invalid or stale (older than 36 h) snapshot;
  - a needed source marked unavailable;
  - Chromium, ffmpeg, ffprobe or the fonts missing;
  - no producible topic left (`no-topic`).

A run takes about 35 s here: about 22 s to render, about 11 s to verify.

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
  - Every beat's middle frame is distinct.
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

One new check: on-screen text at no more than 20 characters per second. For an animated topic, it is measured per label, over the time that label is actually visible.

The RAM topic's claims come from Crucial's "How to Install Memory in Your Desktop" guide. The other topics' claims are editorial knowledge. Either way, the **factual-takeaway** human gate must re-check them.

## What still needs a person each day
1. **Collect the snapshot** in an assistant session with the Metricool and vidIQ connectors (about 5–10 vidIQ credits).
2. **Review the proposal and fact-check it.** The factual-takeaway gate and every other human gate stay unresolved.
3. **Watch both MP4s on a phone**, with sound, for the hook, pacing and readability. The checks prove the files are well formed and the cues land; they do not prove the Short is good.
4. **Build an animation template for each new topic.** This is hand work, and it is the bottleneck.
5. **Approve any voice script and its spend**, then **publish by hand**. The job does neither.
