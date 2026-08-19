# Sequential browser capture worker

Renders each page in the machine's own Chrome and saves the resulting DOM —
the headless equivalent of the manual Ctrl+S captures this corpus is built
from. **It must run on an internet-connected machine; it cannot run in the
research container, which has no outbound network access at all.**

## STATUS: closed for live use against UserBenchmark

The real robots.txt has been read (a human retrieved it and pasted its
content back; this tool still cannot reach the network to fetch it itself):

```
User-agent: *
Disallow: /

User-agent: Googlebot
User-agent: bingbot
User-agent: DuckDuckBot
User-agent: YandexBot
User-agent: proximic
Disallow: /Go/
Disallow: /Search
...(narrow, specific disallows — most paths, including /PCGame/, are open)...

User-agent: Google-Extended
Disallow:
```

**`/PCGame/...` — every FPS-Estimates page this project needs — is disallowed
for the wildcard user-agent.** Only five NAMED crawlers (the search engines
listed) get the permissive list. This worker identifies as itself, not as one
of those five, so it falls under `User-agent: *`: `Disallow: /`, everything,
no exceptions.

There is no legitimate reading of this file under which the worker may run
against the live site. The only way around it would be sending a User-Agent
string claiming to be Googlebot or one of the other four while not being
them — which is exactly the anti-bot bypass this project was built to refuse,
not a loophole in it.

**Consequence:** the worker's own `--compare`/live-capture path is disabled
below and will refuse to run against the real origin. Manual, human-driven
Ctrl+S capture is unaffected — a person using their own browser to view and
save a page they can see is not what robots.txt governs, and remains the
capture method for this project going forward.

Pinned in `test/fixtures/userbenchmark-robots.txt` and
`test/browser-worker.test.mjs`, so this conclusion is tested, not just
written down.

## Requirements

Chrome or Chromium, and Node 18+. No npm install — `--dump-dom` is a stock
Chrome flag, so there is no Playwright/Puppeteer dependency.

Chrome is auto-detected in the usual Windows/macOS/Linux locations. Override
with `CHROME=/path/to/chrome` if it lives somewhere else.

## Step 1 — prove it matches your manual captures (required first)

```
node research/userbenchmark/capture/browser-worker.mjs --compare 2
```

Re-captures two games that are ALREADY in `pages/` from manual Ctrl+S saves
and diffs the result field by field: game identity, average FPS, sample count,
low-sample flag, every GPU and CPU row (name, samples, bench %, value %,
price, component id), all three chart label/data arrays, and EFPS accept/reject
counts.

It must report `2 match, 0 differ`. Nothing is written to `pages/` in this
mode — worker output goes to a temp file so you can inspect it.

## Step 2 — capture new pages

Only after step 1 passes:

```
node research/userbenchmark/capture/browser-worker.mjs --limit 10
node research/userbenchmark/capture/verify-capture.mjs --ingest
```

Flags: `--limit N` (how many uncaptured games), `--delay MS` (floor is 5s),
`--out DIR` (default `pages/`).

## How it behaves

- **robots.txt is fetched once and enforced before any page is touched.** If
  the worklist path is disallowed, the run aborts having fetched nothing.
  `Crawl-delay` is honoured when published; a 5s floor applies regardless.
- **Sequential only.** One page at a time, never concurrent.
- **A refusal stops the whole run.** If a response is a challenge page, an
  error page, or simply not the game that was requested, the worker stops
  rather than moving to the next URL. It does not retry. A site that just
  declined one request is not inviting fifty more.
- **No evasion of any kind.** No CAPTCHA handling, no stealth patches, no
  fingerprint or user-agent spoofing. It is Chrome, identifying as Chrome.

## Why it renders instead of fetching HTML

§5c of `../efps/configuration-analysis.md`: the raw server response for
Battlefield 6 carried no canonical URL and no `Average Fps` block. The page
fills itself in client-side, so rendering is not a convenience — it is the only
state in which the data exists.

## Containment

This is the only file in the research tree permitted to reach the network or
drive a browser, and it is exempted **by name** in `test/canonical.test.mjs`.
Every other script still fails those guards if it grows a `fetch()`. Nothing in
the pipeline imports the worker, and the worker never writes dataset output or
touches production data — both are asserted by tests.

## Validation status

Verified in the research container against a local mirror serving known-good
captures over HTTP (no request to the real site):

- headless render → parse produces data **identical** to the manual Ctrl+S
  capture: every core field, every GPU/CPU row, every chart array
- `--compare 2` reports `2 match, 0 differ`
- robots.txt `Disallow` aborts the run before any page fetch
- block detection: 0 false positives across all 19 known-good captures, while
  still catching challenge and error pages

**Untested:** the live site's actual response. That is what your `--compare 2`
run settles.

## If robots.txt cannot be read

The run stops before fetching anything and says so. A 403 there is ambiguous —
it is either the site declining or a proxy/filter on your network intercepting
the request, and those call for opposite responses. The worker names both
rather than guessing.

To tell them apart: open `https://www.userbenchmark.com/robots.txt` in a normal
browser on the same machine. If it loads, the block is local to that
environment. If it does not, the site is declining and you should stop.

Running `--compare 2` inside the research container produces exactly this,
because the container's proxy refuses the CONNECT. It is not evidence about
UserBenchmark either way.
