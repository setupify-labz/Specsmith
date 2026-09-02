# SpecSmith Content Automator — Creative + Logical V1

This isolated subsystem turns SpecSmith product surfaces and trusted hardware data into a daily batch of **five high-tier content plans**, then carries those ideas through platform packaging, script/storyboard planning, production planning, multi-platform audio-trend discovery, rendering orchestration, and automated quality-review contracts. The renderer can execute end-to-end in dry-run mode now; real external media providers are still plugged in later through adapters. It does **not** post videos yet.

## Run one real end-to-end render right now (no paid credentials required)

```bash
# 1. ffmpeg/ffprobe and a Chromium build must be on PATH (or pointed to via env,
#    see below). Playwright's own `playwright install chromium` works in a
#    normal CI/dev box; see the note at the end of this section for sandboxes
#    where that download host is blocked.
pnpm --dir artifacts/SpecSmith exec playwright install --with-deps chromium

# 2. Build once and serve it locally — the deterministic UI-render adapter
#    captures real product UI from a running SpecSmith instance.
pnpm --dir artifacts/SpecSmith build
npx --yes serve artifacts/SpecSmith/dist/public -l 5178 --no-clipboard &

# 3. Run the full offline pipeline: real idea -> real content package/script
#    /storyboard/production-plan contract -> one real 1080x1920 MP4 (real
#    Playwright capture of the live Compare page, offline espeak-ng
#    narration, real burned-in .ass captions, real ffmpeg compose) -> a
#    quality-review verdict -> a rights-approved asset bundle -> a tracked,
#    draft-only Metricool-ready publishing request -> a durable ledger that
#    fails closed on a duplicate publish. Nothing is posted anywhere.
SPECSMITH_RENDER_BASE_URL=http://localhost:5178 \
  pnpm --dir artifacts/SpecSmith exec tsx scripts/content-automator/endToEndOfflinePipeline.ts
```

Just the render, without the rights/publishing wiring:

```bash
SPECSMITH_RENDER_BASE_URL=http://localhost:5178 \
  pnpm --dir artifacts/SpecSmith content:render:mp4-smoke:offline
```

**Why "offline"**: this pipeline's real narration/video providers (`elevenLabsTts.ts`, `elevenLabsVideo.ts`, `geminiVeoVideo.ts`) all need a paid API key, and posting/paid generation is deliberately out of scope without explicit approval. `localFixtureAdapters.ts` supplies three offline stand-ins instead — local `espeak-ng` narration, an abstract ffmpeg placeholder card for `image-generation`, and true digital silence for `music-sfx` — each clearly labeled `isFixture: true` / `isPaidProvider: false` in its own artifact metadata so nothing downstream can mistake it for a production render. Swap in the real adapters (see the sections below) once ElevenLabs/Gemini Veo credentials and approval to spend them are available; nothing else in the pipeline has to change to do that, because the fixtures implement the exact same `RenderAdapter` contract.

**Remaining external steps before this can post anything for real:**
- ElevenLabs (or another approved TTS/voice provider) credentials + explicit approval to spend them, to replace the offline narration fixture with production-quality voice.
- A real video-generation provider (Gemini Veo is wired in `geminiVeoVideo.ts`) if a beat's hook needs generated motion rather than a real SpecSmith UI capture or the abstract placeholder card.
- TikTok/YouTube/Instagram trend-source credentials (see the "Multi-platform audio trend sources" section below) if trending-audio selection is wanted; a missing source safely falls back to original/licensed SpecSmith audio.
- A real Metricool account/connection and somewhere to actually host a finished master at an `https://` URL Metricool can fetch — `buildMetricoolPublishingRequest` only ever builds a `draft: true` request object locally; nothing in this repository calls Metricool's API.
- A human decision on whether/how to wire any of this into CI. The stack this was ported from included three GitHub Actions workflows referencing those paid-provider secrets; they were deliberately **not** ported here because two of them auto-trigger on `pull_request: branches: [main]` and this repo has a dedicated tripwire test (`scripts/retail/coverage/workflowSafety.test.ts`) that locks the exact roster of workflow files specifically to force a human to review any new credential-bearing one before it's added.

**Sandbox note**: in a network-sandboxed environment where `cdn.playwright.dev` (Playwright's browser-download CDN) is blocked, download a matching Chrome for Testing build directly (e.g. from `https://storage.googleapis.com/chrome-for-testing-public/<version>/linux64/chrome-linux64.zip` — find `<version>` in `node_modules/playwright-core/browsers.json`) and point `SPECSMITH_RENDER_CHROMIUM` at its `chrome` executable. Running as root needs `--no-sandbox`; wrap the binary in a one-line script that adds it and point `SPECSMITH_RENDER_CHROMIUM` at the wrapper instead.

## Product-first rule

The content engine starts with **what SpecSmith helps a user do**, not with a random PC-video idea.

Every concept must define the real SpecSmith feature powering it, the user problem, why SpecSmith is necessary, the exact continuation route, and the on-site payoff. If SpecSmith can be removed without changing the idea, the concept fails the product-fit gate.

Current product map:

- Builder (`/builder`)
- Compare (`/compare`)
- Build Crate (`/crate`)
- Build Guides (`/best-pc-for`)
- Gallery (`/gallery`)
- Upgrade (`/upgrade-calculator`)
- Parts Catalog / Guides (`/parts-guides`)
- Price Guesser (`/price-guesser`)

## Pipeline

`SpecSmith idea -> platform package -> script/storyboard -> production plan -> multi-platform audio decision -> renderer -> AI reviewer -> later publishing + analytics`

## Multi-platform audio trend sources

The automator now refreshes TikTok, YouTube, and Instagram trend inputs into one atomic cache:

`content-ideas/generated/audio-trends.json`

`multiTrendSource.ts` runs the sources sequentially so one platform cannot overwrite another platform's freshly written candidates. Every source keeps the previous cache on an upstream failure. A missing or untrusted source never causes the automator to invent music rights.

### TikTok

`trendSource.ts` connects to TikTok's Business API Commercial Music Library discovery endpoint. It preserves the platform song-clip/audio id for later native attachment and marks returned CML tracks `platform-cleared`.

Required environment variables:

```bash
TIKTOK_BUSINESS_ACCESS_TOKEN=...
TIKTOK_BUSINESS_ID=...
```

Optional configuration:

```bash
TIKTOK_TREND_COUNTRY=US
TIKTOK_TREND_GENRE=ALL
TIKTOK_TREND_DATE_RANGE=7DAY
TIKTOK_TREND_TIMEOUT_MS=12000
```

### YouTube Shorts

`youtubeTrendSource.ts` uses the YouTube Data API `videos.list` most-popular Music chart as a **discovery signal**.

Required environment variable:

```bash
YOUTUBE_DATA_API_KEY=...
```

Optional configuration:

```bash
YOUTUBE_TREND_REGION=US
YOUTUBE_TREND_MAX_RESULTS=50
YOUTUBE_TREND_TIMEOUT_MS=12000
```

A YouTube chart appearance does **not** prove SpecSmith has permission to reuse the underlying song. For that reason, YouTube discovery candidates are deliberately stored with `rightsStatus: "unknown"`, no publishable platform-audio id is invented, and the audio selector cannot auto-use them. They are useful for trend awareness until a rights-cleared/native-audio source is available.

### Instagram Reels

`instagramTrendSource.ts` does not pretend there is a public Meta trending-audio catalog when one is not configured. Instead it accepts an explicit approved/partner trend feed:

```bash
INSTAGRAM_AUDIO_TREND_FEED_URL=https://...
```

Optional configuration:

```bash
INSTAGRAM_AUDIO_TREND_FEED_TOKEN=...
INSTAGRAM_TREND_TIMEOUT_MS=12000
INSTAGRAM_TREND_FEED_RIGHTS_TRUSTED=false
```

By default, every Instagram feed item is downgraded to `rightsStatus: "unknown"` even if the upstream feed claims it is cleared. Only when the feed itself has been explicitly approved as a trusted rights source should `INSTAGRAM_TREND_FEED_RIGHTS_TRUSTED=true` be enabled. A trusted feed may then provide `platform-cleared` or `commercial-cleared` candidates and platform audio ids.

Bearer credentials are sent in the Authorization header rather than placed in the feed URL.

### Shared refresh behavior

The default trend refresh window is six hours and can be changed with:

```bash
AUDIO_TREND_REFRESH_HOURS=6
```

Normal `content:strategist` runs refresh all configured sources automatically. Manual refresh uses the same multi-source path:

```bash
npm run content:trends:refresh
```

If a configured source fails, its previous cache is retained. If no usable cleared track exists for a platform/video, the selector falls back to original/licensed SpecSmith audio instead of guessing.

No secrets are stored in the repository.

## Trending audio scanner + selector

`audioTrend.ts` makes a platform-specific audio decision for every selected idea. It can choose between a current platform-native sound, a commercially cleared render-time track, or a safe original/licensed SpecSmith music bed and SFX fallback.

The selector scores eligible candidates using trend velocity, popularity, freshness, a conservative saturation proxy, and creative fit to the actual video concept. Trending audio is rejected when it is stale, uncleared, unknown-rights, or a weak creative match. A huge sound is not allowed to win just because it is popular.

Platform-cleared sounds are marked `platform-publish`, which means they should be attached through the platform's own publishing/audio system instead of being baked into the video file. Commercial-cleared sounds may be used during rendering when their license permits it.

## Rendering orchestration

`rendering.ts` provides the executable rendering layer. It includes an adapter registry keyed by production capability, strict render-order/dependency validation, artifact passing, retry support, video-to-image fallback where allowed, fail-closed behavior for missing required renderers, final composed-artifact tracking, and a full dry-run registry.

Run the logical renderer validation after generating a batch:

```bash
npm run content:strategist
npm run content:render:dry-run
```

The dry run validates all five packages across YouTube Shorts, TikTok, and Instagram Reels: **15 platform renders per daily batch**.

## Daily five rules

- Exactly **5** publishable concepts.
- Internal quality floor: **7.5/10**.
- At least **3 of 5** use experimental/interactive formats.
- `productFit` must be at least **9/10**.
- `siteContinuation` must be at least **9/10**.
- Repeated formats, product surfaces, visual worlds, and hardware subjects are penalized.
- Weak batches regenerate stronger presentations instead of lowering the standard.
- Historical performance can move a candidate by at most **±0.8 points**.

## Creative rule

Creativity sits **on top of the product problem**. Every idea carries creative DNA: visual world, narrative engine, first frame, pattern interrupt, timed retention beats, payoff, audio direction, originality constraint, and anti-slop rules.

## Cross-platform content packages

Every selected idea becomes one coordinated package instead of three copy-pasted social posts. The package includes YouTube Shorts, TikTok, Instagram Reels, the exact SpecSmith continuation, platform CTA, campaign attribution, and required factual inputs.

## Script + storyboard layer

Each platform version becomes a timed storyboard with a hook, viewer commitment, evidence, reversal/tradeoff, payoff, and exact SpecSmith CTA. Facts are attached to the beats that depend on them so later stages can verify claims instead of inventing them.

## Production plan

The production planner routes real product states/evidence to deterministic SpecSmith rendering and creative presentation to generative visual capabilities. It also plans TTS, music/SFX, captions, and motion composition. Generated visuals are not allowed to impersonate real SpecSmith UI.

## Automated quality reviewer

`qualityReviewer.ts` creates one review contract for every platform render and evaluates the finished output before publication. It checks factual claims/evidence, fake SpecSmith UI, FPS labeling, hook clarity, captions, audio, visual coherence, pacing, SpecSmith relevance, CTA accuracy, generic AI-B-roll ratio, and duration drift.

Hard blockers cannot be averaged away by a good overall score. Reviewer decisions are `pass`, `regenerate-targeted`, `regenerate-full`, or `hold-for-human-review`.

## Data integrity

- Uses canonical local hardware data where available.
- Build Crate concepts require an **actual recorded pull** before publishing.
- Gallery concepts require a real published Gallery build.
- Builder/upgrade concepts require an actual supported result before making compatibility or outcome claims.
- Fresh prices must be re-verified before publication.
- `benchmark_score` is not measured game FPS.
- Estimated FPS must remain explicitly labeled `Estimated FPS`.
- Measured FPS requires real benchmark evidence before publication.
- Unknown/uncleared popular audio is never auto-selected for commercial SpecSmith content.
- Discovery popularity never upgrades an audio-rights status.
- A failed trend refresh never erases the last known-good cache.

## Learning loop

`performance.ts` evaluates hook, retention, engagement, and conversion. Raw views do not decide creative quality. Small samples are treated cautiously, and one lucky upload cannot teach the selector to clone one style forever.

## Current boundary

Built now:

- SpecSmith product map + SpecSmith-first concept generation
- creative DNA + five-video quality gate
- cross-platform content packages
- script/storyboard generation
- production capability routing
- TikTok Commercial Music Library trend ingestion
- YouTube Music-chart trend discovery with rights-safe gating
- Instagram approved-feed adapter with explicit rights trust gating
- unified multi-platform trend cache, refresh, and failure handling
- trending-audio scoring, rights gating, and platform-specific selection
- executable rendering orchestrator
- retries, dependencies, fallback handling, artifact propagation
- full rendering dry run across all platform variants
- automated AI-review contracts and repair decisions
- performance learner
- tests, typecheck/build checks, and CI workflow

Still later:

- real provider adapters that produce media bytes for video/image/TTS/audio/composition
- deterministic browser/UI screenshot renderer for live SpecSmith product states
- multimodal observation extraction from finished media
- automatic regeneration execution after reviewer feedback
- publishing adapters/autopost, including platform-native trending-audio attachment
- live analytics collectors
