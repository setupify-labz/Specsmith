# Verified metrics access — YouTube, TikTok, Instagram

**Status: no platform can be read today. No metric has entered the learning report.**

This is the boundary report for the metrics ingestion path. It records what was
tested, what the result was, and exactly what is missing per platform. Every
observation below was produced from this environment on **2026-10-03**; the
commands are given so each can be re-run rather than trusted.

Nothing in this document is a measurement of a video. No number here describes
any SpecSmith content's performance.

## Update 2026-10-06: the already-published Shorts

Re-probed at 17:14Z with the same commands: nothing has changed. The YouTube
APIs still answer 403/401 without a credential. `www.youtube.com`, `app.metricool.com`,
TikTok and Instagram are still refused by the network policy, and no `METRICOOL_*`
or platform credential exists. This session also has no Metricool connector.

Posts published outside the authorization boundary are recorded by
`v2/publication/externalPosts.ts`, from the facts in
`v2/publication/publishedPosts.ts`. They stay apart from the ledger: no ledger,
authorization or provider-post index is written, so `buildLearningReport` does
not count them.

- **Provenance.** Every fact is `user-provided` (with who supplied it),
  `connector-reported` (an authenticated connector returned it to someone else
  who relayed it; this environment did not fetch it), `file-measured` (with the
  file's SHA-256) or `provider-reported`. Unknown facts are null with a reason.
- **Provider-reported means a real observation.** A provider-reported fact must
  cite an `observationId` that exists in this store, is trusted for the store's
  mode (simulated only in a simulation store; a registered production source
  otherwise), and is bound to the same platform, post and account. An id-shaped
  string is refused, on write and on every read.
- **Corrections.** `correctExternalPost` appends a numbered correction; the
  original record and every earlier step are kept. A post's platform and id are
  its identity and cannot be corrected. Replay checks each step: its `previous`
  must equal the fact as it stands at that point (value, source, basis and
  observation), and its replacement must be a valid fact, including the
  observation check above. A tampered history refuses the read.
- **Authenticated numbers.** `importExternalPostObservations` uses the same
  trusted-source check as any import. It accepts only that platform's own API
  reporting on that platform's post id, for the recorded account, after the
  publication time is known. It writes observations only, never a ledger event.
- **Dashboard numbers.** `recordDashboardEvidence` keeps a screenshot or pasted
  table as EXPLORATORY, unverified context, with the dashboard, read time and
  source reference. It is never stored as an observation and never compared.

`publishedPostsCli.ts` walks post → report (values, collection times, sources)
→ creative memory → next brief, whose evidence carries the creative ids and the
known media hashes. Example output: `v2/publication/examples/published-posts-*`.

Posts recorded: six. They came from the authenticated Metricool connector for
brand 6769542, which returned them to Codex with every provider status
`PUBLISHED`; Codex relayed them here. They are `connector-reported`, not fetched
by this environment.

| Video | Platform | Post | Metricool post | Scheduled for |
| --- | --- | --- | --- | --- |
| RAM | YouTube | `cSDhjFC-CI8` | 387469692 | 2026-10-03T16:00-04:00 |
| RAM | TikTok | `7693352089078058271` | 389042813 | 2026-10-05T20:55-04:00 |
| RAM | Instagram | `DeIi5pZDWew` | 389042813 | 2026-10-05T20:55-04:00 |
| FPS | YouTube | `648FsZLefnc` | 389611858 | 2026-10-06T12:10-04:00 |
| FPS | TikTok | `7693587971584429343` | 389611858 | 2026-10-06T12:10-04:00 |
| FPS | Instagram | `DeKLo_0kw7C` | 389611858 | 2026-10-06T12:10-04:00 |

The times are Metricool's **scheduled** times, kept as `scheduledAt`. With the
`PUBLISHED` status they show the posts went out, not exactly when, so
`publishedAt` stays unknown and the authenticated import stays closed until a
confirmed time is added with a correction.

Accounts: YouTube channel `UC1DBOCQ4F0y-BP9he39b3Kg` is recorded. For TikTok
and Instagram only the handle `@specsmithpc` was supplied. The adapters bind to
the TikTok `open_id` and the Instagram business account id, so the handle is
stored as `handle` and `accountId` stays unknown until those ids are supplied.

Still not available: any metric. No Metricool metric has been relayed, and the
platform APIs remain blocked as above.

---

## 1. The three blockers, in the order they bite

A credential alone fixes none of them completely. They are independent, and
closing one leaves the others standing.

| # | Blocker | Platforms | Fixed by |
|---|---|---|---|
| 1 | No credential configured | YouTube | A channel-owner OAuth credential |
| 2 | Network policy refuses the API host | TikTok, Instagram | Allowing the host in the environment's egress policy |
| 3 | No platform-native post id is recorded at publication | all three | A schema change on the publication event |

Blocker 3 is the one worth the most attention, because it is invisible until the
first two are solved and it is **not** an access problem. It is asserted by a
test (`platformMetrics.test.ts` → "records the schema gap") so it cannot be
forgotten once OAuth arrives.

---

## 2. What was tested, and what came back

### YouTube Data API v3 — reachable, no credential

```
curl -sS "https://www.googleapis.com/youtube/v3/videos?part=id&id=cSDhjFC-CI8"
```

```json
{ "error": { "code": 403, "status": "PERMISSION_DENIED",
  "message": "Method doesn't allow unregistered callers (callers without established identity).
              Please use API Key or other form of API consumer identity to call this API." } }
```

The host is reachable and the 403 comes from **Google**, not from the proxy. What
is missing is a credential, not egress.

### YouTube Analytics API v2 — reachable, no credential

```
curl -sS "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&metrics=views&startDate=2026-01-01&endDate=2026-10-01"
```

```json
{ "error": { "code": 401, "status": "UNAUTHENTICATED",
  "message": "Request is missing required authentication credential.
              Expected OAuth 2 access token, login cookie or other valid authentication credential.",
  "details": [ { "reason": "CREDENTIALS_MISSING" } ] } }
```

**This is the API that matters, and an API key cannot reach it.** Average view
duration, average percentage viewed and the audience-retention curve exist only
here, behind channel-owner OAuth. A project that provisions only an API key gets
`viewCount` and nothing else — a row that looks like a video nobody watched.

### TikTok — egress refused

```
curl -sS "https://open.tiktokapis.com/v2/video/query/"
curl: (56) CONNECT tunnel failed, response 403
```

### Instagram — egress refused

```
curl -sS "https://graph.facebook.com/v21.0/me"
curl: (56) CONNECT tunnel failed, response 403
```

Both denials are recorded independently by the agent proxy
(`$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`):

```
connect_rejected  gateway answered 403 to CONNECT  open.tiktokapis.com:443
connect_rejected  gateway answered 403 to CONNECT  graph.facebook.com:443
```

A credential would not help either platform until the host is allowed.

### The video id could not be confirmed to exist

```
curl -sS "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=cSDhjFC-CI8&format=json"
curl: (56) CONNECT tunnel failed, response 403
```

`www.youtube.com` is also blocked, so even the public oEmbed check is
unavailable. **This report therefore makes no claim that `cSDhjFC-CI8` exists, is
a Short, or belongs to a SpecSmith channel.** It is an id supplied to this
session and not independently verified from here.

### No credential of any kind is present

No `YOUTUBE_*`, `TIKTOK_*`, `INSTAGRAM_*`, `META_*` or `METRICOOL_*` variable
exists in the environment, and the content-automator reads none. The only Google
credential present is `CLOUDSDK_AUTH_ACCESS_TOKEN`, which belongs to the
container's cloud tooling. It was **not** used and must not be: it is not a
credential this project configured for YouTube, YouTube Analytics requires the
consent of the channel owner, and borrowing an unrelated token to read a user's
channel would be wrong even if it happened to work.

---

## 3. Blocker 3: the attribution gap

An observation is stored only when it can be traced to one of our own confirmed
publications. The store binds a creative by **publishing provider + that
provider's post id**:

```
creativeForProviderPost(storeRoot, provider, providerPostId)
```

Metricool publishes, so the recorded id is Metricool's. **YouTube Analytics knows
the video only as `cSDhjFC-CI8`.** No platform-native id is recorded anywhere on
the publication event, so there is no key that joins the two.

Consequently a genuine, fully-authenticated YouTube batch is refused as
`unknown-post` — correctly, because the alternative is attributing numbers to a
creative by guesswork. Additionally, no `published` ledger event exists anywhere
in this repository, so there is currently no publication for any observation to
attach to at all.

**To close it:** record the platform-native id (and the permalink) on the
publication event when a provider confirms a post, and let
`creativeForProviderPost` resolve a native id as well as the publishing
provider's. That is a reviewed schema change, not a secret.

---

## 4. Which metrics each platform can serve

From `v2/publication/platformAccess.ts`. Every entry is **documented by the
provider** — taken from its published API reference — and none has been observed
returning for a SpecSmith account. The code labels this distinction
(`capabilityBasis`) and a test asserts no entry claims otherwise.

| Metric | YouTube Shorts | TikTok | Instagram Reels |
|---|---|---|---|
| views | `views` | `view_count` | `views` |
| likes | `likes` | `like_count` | `likes` |
| comments | `comments` | `comment_count` | `comments` |
| shares | `shares` | `share_count` | `shares` |
| saves | — no equivalent action | — | `saved` |
| average view duration | `averageViewDuration` | — | `ig_reels_avg_watch_time` (ms) |
| average % viewed | `averageViewPercentage` | — | — |
| retention curve | `audienceWatchRatio` × `elapsedVideoTimeRatio` | — | — |
| **viewed vs swiped away** | **not claimed** | — | — |
| follows gained | `subscribersGained` | — | — |
| profile visits | — not attributed per video | — | — |

### Three absences worth stating plainly

**Viewed-versus-swiped is not claimed for any platform.** YouTube Studio
displays "Viewed vs. Swiped away" for Shorts, which makes it tempting to assert
the reporting API serves it. No authenticated call has been seen to return it for
this channel, so it is recorded `unavailable` with that reason, and the adapter
will not derive it from views or impressions. It can be promoted the moment a
real call returns it.

**Retention is YouTube-only.** TikTok's authorized video query returns no
watch-time field at all, and Instagram returns an average, not a curve. Neither
is approximated: `view_count` × duration is an estimate, and an estimate stored
beside measurements is the exact failure this layer exists to prevent.

**Comparison stays within one platform.** `views` on YouTube and `view_count` on
TikTok count different events. Metric keys are platform-scoped and
cross-platform comparison is refused rather than normalized.

---

## 5. What is built, and why it still cannot ingest

| Component | State |
|---|---|
| `platformAccess.ts` — requirements and gaps per platform | built |
| `platformObservationSources.ts` — YouTube/TikTok/Instagram adapters | built, unregistered |
| Per-platform metric definitions | built |
| `platformMetrics.test.ts` — 35 tests | passing, mutation-checked |
| `PRODUCTION_OBSERVATION_SOURCES` | **empty** |

The adapters perform real authenticated fetches and work when credentials
arrive. They are **not** registered as trusted sources, so nothing they return
can reach the learning report. Registration is a reviewed change in
`observations.ts`, deliberately not something an adapter can do for itself — a
module that could enrol its own output would make the registry decorative.

`platformAccessStatus()` reports `canIngestToday: false` even when handed a fully
populated credential set, and a test asserts exactly that. Having the token is
not the same as the number being trusted.

---

## 6. What a fabricated or typed number does

Tests in `platformMetrics.test.ts` and `observations.test.ts`:

- A hand-assembled batch claiming `provider: "youtube"` is refused
  (`no-verified-source`) in a production store, **and** refused in a simulation
  store, so there is no store where a typed number lands as an observation.
- It is still refused when it copies a real adapter's `sourceId` and
  `mechanism` verbatim. Self-description is not provenance: the module remembers
  which batches it issued, and a caller-built object is not among them.
- An issued batch is frozen; editing it, spreading it or round-tripping it
  through JSON invalidates it.
- Numbers a person supplies are accepted only by
  `recordUnverifiedObservations`, stored labelled `unverified`, excluded from the
  learning report, and named in the report's `unknowns`.

Mutation-checked — each of these turns a specific test red when reverted:
coercing unreadable values to `0`; seeding the metrics skeleton with `0`;
dropping Instagram's millisecond conversion; collapsing `nativeField` onto the
aggregator name; claiming every platform serves every metric; handing back a
source with no credential; ceasing to distinguish a blocked host from a missing
credential.

---

## 7. To make YouTube metrics real — smallest honest path

1. **Schema:** record the platform-native post id and permalink on the
   publication event; teach `creativeForProviderPost` to resolve a native id.
   *Required regardless of credentials.*
2. **Credential:** create an OAuth client for the channel that owns the Short,
   consent as the channel owner with scope
   `https://www.googleapis.com/auth/yt-analytics.readonly`, and supply
   `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`,
   `YOUTUBE_OAUTH_REFRESH_TOKEN`.
3. **One real read**, recording what actually came back — in particular whether
   anything returns viewed-versus-swiped, which is currently unclaimed.
4. **Register** the YouTube source in `PRODUCTION_OBSERVATION_SOURCES`, under
   review, with the observed response as the evidence.
5. **Then** TikTok and Instagram: first egress for `open.tiktokapis.com` and
   `graph.facebook.com`, then tokens. Retention will remain unavailable on both.

Until step 4, production metrics ingestion stays closed and
`MISSING_METRICS_CAPABILITY` is what any caller gets.
