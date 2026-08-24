# Content Automator Analytics Contract

The automator is not allowed to learn from raw views alone. Views mix creative quality with distribution, account size, timing, topic demand, and platform decisions. The learner should optimize normalized viewer behavior first, then business conversion.

## Primary question

For every video, answer four separate questions:

1. **Did people stop?** — hook quality.
2. **Did they stay?** — retention quality.
3. **Did they care enough to act?** — shares, saves, comments, follows.
4. **Did it help SpecSmith?** — attributed site clicks, Builder starts, affiliate clicks.

A high-view video can fail questions 2-4. A lower-view video can be a much stronger creative pattern and deserve another test.

## Required record for every upload

Every rendered video gets a stable `videoId`, `ideaId`, and campaign id before publishing. Store these creative labels with it:

- platform
- publish timestamp
- duration
- format
- visual world
- narrative engine
- hook family
- subject hardware ids
- video-generation model(s)
- voice model
- render version
- generation cost and latency when available

Without these labels the learner can tell us **what** won but not **why**.

## Viewer metrics

### Hook / distribution opportunity

Collect when available:

- views
- shown-in-feed / impressions / reach
- engaged views
- stayed-to-watch or viewed-vs-swiped rate

Use exposure counts for confidence, not as the quality score itself.

### Retention

Collect when available:

- average view duration
- average percentage viewed
- retention curve by elapsed-video ratio
- near-completion retention
- rewatch spikes / audience ratios above 1 when the platform exposes them

The first seconds and the final payoff are especially important, but do not hard-code one universal "viral" threshold. Compare against SpecSmith's own history and similar-duration videos.

### Engagement

Collect:

- likes
- comments
- shares
- saves/favorites
- follows/subscribers gained

Normalize these per view. Shares and saves are weighted more heavily than passive likes in the current learner because they represent stronger intent to distribute or keep the content.

### SpecSmith conversion

Every video should use a unique campaign id in its destination link. Capture:

- profile visits when the platform exposes them
- site clicks
- landing-page sessions
- Builder starts
- comparison-page opens
- affiliate outbound clicks
- purchases/revenue later if attributable and permitted

Do not mix unattributed site traffic into a video's score.

## Platform notes

### YouTube Shorts

YouTube currently exposes useful Shorts signals including views, shown in feed, how many chose to view / stayed to watch, average view duration, average percentage viewed, likes, comments, shares, and subscriber changes. The YouTube Analytics API also supports per-video audience-retention reports using `elapsedVideoTimeRatio` with `audienceWatchRatio` and relative-retention metrics.

This makes YouTube the cleanest first platform for automated retention learning.

### TikTok

TikTok's standard authorized video query/list APIs expose public-style fields such as view count, like count, comment count, and share count. Research APIs can expose additional fields such as favorites count and duration, but research access has separate eligibility/scopes and should not be assumed for the production creator account.

Do not pretend TikTok provides granular retention through an endpoint unless the specific approved API/account actually exposes it. Store unavailable metrics as absent rather than estimating them.

### Instagram Reels

Use a platform adapter that maps only metrics actually exposed to the authenticated business/creator account. Keep the normalized internal schema stable and leave unsupported fields absent. Never fabricate a cross-platform metric just so every row looks complete.

## Learning rules

1. **Never declare a winner from one upload.** The current learner requires at least 3 videos using a factor before it can be promoted or retired.
2. **Shrink small samples toward the global baseline.** This limits lucky viral outliers.
3. **Compare normalized behavior, not raw views.** Hook, retention, engagement rate, and conversion rate drive quality.
4. **Keep exploration alive.** Historical winners receive only a bounded ranking adjustment; they cannot take all five slots forever.
5. **Change one major creative variable at a time when testing a hypothesis.** Otherwise the learner cannot identify the cause.
6. **Segment by platform and duration when the dataset becomes large enough.** A 17-second YouTube Short and a 42-second TikTok should not become one false baseline.
7. **Preserve failures.** Losing concepts are training data for the strategist and should not be deleted from history.

## Daily operating loop

`Generate many ideas -> quality gate -> choose 5 distinct experiments -> render -> publish -> collect metrics -> normalize -> learn factors -> adjust tomorrow's ranking`

The goal is not to automate five uploads. The goal is to automate a measurable creative-learning system that gets harder to copy as its evidence base grows.
