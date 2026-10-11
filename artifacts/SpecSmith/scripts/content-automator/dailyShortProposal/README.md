# Daily Short proposal

Proposes **one** beginner PC troubleshooting Short a day, for a person to review.

The job writes the proposal and a silent storyboard preview. It calls no paid provider, generates no voice (no ElevenLabs), schedules nothing and publishes nothing.

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
- `1`: refused, with the reason printed. Causes are a missing, invalid or stale (older than 36 h) snapshot, a needed source marked unavailable, or Chromium, ffmpeg or the fonts missing.

## 3. Review the folder (`render-output/daily-proposals/<time>-<topic>/`)
- `PROPOSAL.md` (and `proposal.json`):
  - the frame-one hook, script and storyboard;
  - the evidence;
  - **the metrics that influenced the choice** (source, value and use for each);
  - **unknowns**;
  - automated gate findings;
  - every human gate, unresolved.
- `preview-silent.mp4` and `preview-phone-sheet.png`: a storyboard animatic labelled "STORYBOARD PREVIEW · NOT FINAL ART" on every frame.
- `run-report.json`: stage timings and spend.

## How the topic is chosen (`select.ts`)
1. The fastest troubleshooting Short (public views per day) sets the symptom family.
2. The best-retained Short sets the length, using only analytics samples of at least 300 views (clamped to 10–15 s).
3. Topics an existing title already covers are dropped.
4. Ties are broken by an editorial prior, which is recorded as editorial judgement, not data.
5. TikTok and Instagram rows are recorded as context only. Metricool's rows are per publish day, not per video.

## Gates reused
- `v2/antiSlop.ts`
- `v2/research/strictEvidenceGate.ts`, against a research contract built from the topic's claims and risky claims
- `nextVideoMonitorPort/storyboard.ts` `FORBIDDEN_CLAIMS`
- `v2/review/humanGates.ts`: all gates unresolved; no gate can close without a trusted approval record

One new check: on-screen text at no more than 20 characters per second.

The topics' factual claims are editorial knowledge. The **factual-takeaway** human gate must check them against a manual.
