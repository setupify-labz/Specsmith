# UserBenchmark Homepage/Search Page Parser

> **Research-only. No network code anywhere in this directory.** Reads
> only page sources already saved to `pages/`. Never fetches, crawls, or
> requests anything from userbenchmark.com or any other domain. Not wired
> into production; output is raw extracted data, not a `BenchmarkRecord`.

## What this is (and an important naming note)

The saved page here is `userbenchmark.com/Search?searchTerm=FPS` — the
"FPS" hub reached from the top nav's **FPS** tab, not the bare site root
`/`. Its own `<title>` is *"FPS - UserBenchmark Search"*, its search box
holds `searchTerm=FPS`, and its `<meta name="robots">` is
`noindex, noarchive, nosnippet` (the site doesn't want this page indexed —
worth knowing, since it means Google-cached copies won't help find a
replacement source). It's saved as `pages/Search-FPS.html`, and this
README calls it "the homepage/search page" throughout to match how it was
supplied, but be aware it is a **search results page for the term "FPS"**,
not the literal UserBenchmark root page — that distinction matters because
it's exactly why only 9 of 317 total game hits are embedded (see the gap
report below), and it's why there's a facet sidebar and a "308 MORE »"
control that a true static homepage wouldn't have.

## How to add another saved page

Same workflow as `../parse.mjs`: save a page's full HTML source into
`pages/` (any `.html`/`.htm`/`.xhtml`/`.txt`/`.xml` extension), then run:
```
node research/userbenchmark/homepage/parse.mjs
```
Output goes to `parsed/<filename>.json`, plus an `index.json` summarizing
every parsed page.

### AJAX pagination pages (`.xml`)

The "308 MORE »" control on the initial search page is a JSF/Mojarra AJAX
form postback, not a link — see `paginationGap` below. It **can** still be
captured without any fetch/crawl code here: open the search page in a
browser, open devtools' Network tab, click "308 MORE »" (and then "Next »"
for further pages), and save each response body — a
`<partial-response>...<update id="searchForm"><![CDATA[...]]></update>...`
XML document — as a `.xml` file in `pages/`. That's exactly how
`Search-FPS-page1-ajax.xml` through `Search-FPS-page4-ajax.xml` were
captured (all 4 pages of the 317-hit result set, saved by hand from the
browser, then parsed the same way as any other saved page). The parser
detects the `mh-ajaxpager`/"Page N of M" markup these captures carry and
records `paginationGap.source: "ajax-page"` with the page's `PGMP` value
instead of the initial page's "N MORE »" gap notice.

## What gets extracted

- **`pageContext`** — `<title>`, the `robots` meta value, the search
  form's POST action, and the current search term.
- **`hitsSummary`** — total hit count and how many are actually shown
  (`317` / `9` on the saved page).
- **`searchResultGames`** — the `tl-tag` result cards that are actual
  FPS-Estimates games: name, caption (e.g. `"FPS Estimates (CSGO)"` — note
  some games get a parenthetical abbreviation, most don't; retro games
  sometimes carry a price instead, e.g. `"FPS Estimates - $29"`),
  **sample count**, gameId, slug, canonical game URL, icon URL. This is the
  richest per-game data captured here — the only place that pairs a sample
  count with a resolvable id/URL. (9 on the original `Search-FPS.html`
  page; up to 100 per AJAX pagination page — see below.)
- **`nonGameSearchHits`** — `tl-tag` cards whose URL does **not** match
  `/PCGame/FPS-Estimates-.../` — the search term "FPS" also turns up
  unrelated product hits (found one: a "Blade" RAM kit's SpeedTest page,
  on AJAX page 4). Kept separate rather than folded into
  `searchResultGames` with a null gameId.
- **`facets`** — the sidebar breakdown (Subdomain / Type / Category /
  Brand), each entry a `{label, count, filterUrl}`.
- **`paginationGap`** — the "308 MORE »" control, recorded as **not**
  reachable via a plain URL: it's a JSF/Mojarra AJAX form postback
  (`mojarra.ab(this,event,'action','@form','@form',...)`), which needs a
  running page and a form submission, not a fetchable link.
- **`bestTable`** — the "The Best" CPU/GPU/SSD picks: 3 columns × 3 rows,
  each cell a part name + its `/Rating/<id>` URL + live/hot price + price
  URL + store. **No bench/value score or sample count appears in this
  table** — see the gap report.
- **`carouselGames`** — the 12-game "Can You Run It?" strip: name, id,
  slug, url. No sample counts here (contrast with `searchResultGames`).
- **`autocompleteCatalog`** — the full site-wide autocomplete array
  (`mhasearchcomp(...)`, 1,347 items on the saved page): every searchable
  label on the whole site (CPUs, GPUs, RAM kits, SSDs, HDDs, USB drives,
  software, peripherals — everything, not just games), **labels only, no
  ids/URLs/scores attached to any entry**. Also derives
  `fpsEstimatesGameNames`: every label with an `"FPS Estimates "` prefix,
  stripped down to the bare game name (316 on the saved page — this is
  where most of the 317-hit total actually resolves to a *name*, just
  never to an id or URL). Also flags `duplicateLabels`: exact-duplicate
  strings within the array (found one on the saved page: `"FPS Estimates
  Resident Evil HD Remaster"` appears twice).
- **`affiliateLinks`** — the `Go/HotXXXAmazon/...` outbound ad-tracking
  links, recorded separately since they're monetization/navigation, not
  benchmark data.
- **`gapReport`** — see below; also embedded in every parsed JSON file.

## Cross-checks that held up

Three independent parts of the page agree with each other: **317** total
hits (header) = **316** `"FPS Estimates"` Brand-facet count + the **1**
`"ram"`-subdomain/`"Memory Kits"`-category hit (a non-game product that
happens to also match the search term "FPS") = **316** `"FPS Estimates
<Game>"` names found in the separate autocomplete array + the **1** bare
`"FPS Estimates"` brand label itself. That agreement across three
differently-structured parts of the same page is a good sign none of them
were truncated or mis-scraped.

## What's missing — would require a separate page/request

| Data | Present here? | What it would take |
|---|---|---|
| RAM products/scores/rankings | No — nav link + 1 facet count only | Fetch `ram.userbenchmark.com` directly |
| HDD products/scores | No — nav link only | Fetch `hdd.userbenchmark.com` directly |
| SSD bench/value score or samples | Name + price only, no score | Fetch the SSD's own `/Rating/<id>` page |
| USB products/scores | No — nav link only | Fetch `usb.userbenchmark.com` directly |
| CPU/GPU numeric bench/value % | Not present anywhere on this page | Fetch the part's `/Rating/<id>` page, or a specific game's FPS-Estimates page (which does carry per-part bench/value %) |
| IDs/URLs for the other 308 game hits | ~~Only 9 of 317 have a resolvable id/URL~~ **Resolved** — all 4 AJAX pagination pages were captured by hand and saved (`Search-FPS-page1-ajax.xml` .. `page4-ajax.xml`); 316 of the 317 hits are now id/url-resolvable games (the 317th is the non-game "Blade" RAM hit — see `nonGameSearchHits`). See `../known-games.json` for the merged, deduplicated result: 316 resolved, 0 name-only. | Done — no further action needed for this gap. |
| Explicit rank numbers | "The Best" table's order is positional only, no rank/tier label | Not available from any page seen so far |

Nothing in this list was worked around — each is reported as a genuine gap
in what this specific saved page exposes, consistent with the "do not
fetch" constraint.
