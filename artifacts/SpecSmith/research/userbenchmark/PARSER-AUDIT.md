# Step 1 parser audit — generalization and silent-failure risk

Audit of the UserBenchmark game-page parser: how far it can be trusted beyond
the pages it was written against, and what it does when it meets markup it does
not expect. No parser or validation change was made; this records what was
measured and what remains unknown.

## The corpus is smaller than it looks

19 real captured pages, but measurement shows they are **19 samples of one
template**, captured within days of each other:

| Property | Variation across the 19 pages |
|---|---|
| Attribute quoting (canonical, `<h1>`, `og:title`) | double quotes on **all 19** |
| Class names, tag order | identical |
| `labels :` spacing in chart config | 3 occurrences per page, same style |

As parser coverage this is close to a **single structural sample**. A regex
resting on incidental formatting can look thoroughly exercised by 19 green
pages and still be one template change away from failing.

Two things genuinely vary and are exercised: identity source (4 pages have no
canonical link and fall back to inference) and table size (Axiom Verge publishes
5 rows, not 20).

## Finding 1 — a documented tolerance that no evidence supports

`lib/game-page.mjs` carries a quote-agnostic `Q` helper, justified in its own
comment by the claim that view-source saves preserve the server's
single-quoted attributes.

**No artifact in this repository is single-quoted** — including
`test/fixtures/view-source-save-Battlefield-6-4186.html`, which is a genuine
raw server response. The claim appears to be untrue for this site.

The helper is harmless and defensive, but it should not be read as tested
coverage. Identity extraction (`canonical`, `<h1>`, `og:title`) is **not**
quote-agnostic at all and would fail on a single-quoted page.

## Finding 2 — brittle to cosmetic change, but fails loudly

Measured by mutating real captures:

| Cosmetic mutation | Result |
|---|---|
| single-quoted attributes | page **rejected** (`kind=unknown`) |
| newlines inside tags | page **rejected** |
| extra attributes on `<h1>` / `<link>` | page **rejected** |
| `&nbsp;` → raw NBSP | extracts identically |

Three of four plausible template changes take the whole page out. That is
worse tolerance than the code comments imply — but the failure is **loud and
total**, never partial. A rejected page is visible and fixable; a page that
quietly loses a row is not. Brittle-and-loud is the correct trade for an
evidence-first pipeline, and it is now asserted as a property.

## Finding 3 — the parser does NOT self-detect partial extraction

Two damage mutations produce output that looks entirely healthy, with **zero
additional parser warnings**:

| Damage | Parser result | Warnings added |
|---|---|---|
| one component row's cell style altered | 19 rows instead of 20 | **none** |
| one chart's dataset emptied | labels=12, data=0 | **none** |

This is the failure mode that matters. Nothing downstream can distinguish 19
rows from 20. Both real defects previously found in this parser (a price form
parsed as `null`, a component id in an unmatched URL shape) were of exactly
this kind, and both were found by hand rather than by tests.

## What was added

`test/fixtures/detectors.mjs` — six detectors that check **extraction
completeness and self-consistency**, never whether a published number is true:

| Detector | Catches |
|---|---|
| `componentRowsMatchLinkedComponents` | short table (counts filter links, independent of the row regex) |
| `chartLabelsMatchData` | labels/data length mismatch, absent chart |
| `distributionSumsMatchTotalSamples` | drift between the header summary and the chart scripts |
| `noDuplicateComponentNames` | row-regex misalignment |
| `everyRowHasJoinableFields` | missing name / samples / bench% / component id |
| `pricedRowCountMatchesHtml` | prices the page shows but the parser did not read |

`distributionSumsMatchTotalSamples` rests on a measured invariant: the settings
and resolution distributions are **sample counts**, and each sums *exactly* to
the page's total sample count on all 19 pages, with no rounding slack. It links
two independently extracted regions, so drift in either is caught. A one-unit
skew is detected.

The FPS histogram is deliberately **not** checked this way — its totals bear no
fixed relationship to the sample count (16 distinct ratios across 19 pages), so
asserting one would be inventing an invariant rather than observing one.

`pricedRowCountMatchesHtml` exists because the other five provably cannot catch
a price regression: an unread price is indistinguishable from a price the page
never listed. Verified by re-introducing the real historical bug — caught by one
hand-written fixture and by no structural detector until this was added.

## Verification of the harness itself

- all six detectors are **silent on all 19 real captures** (a detector that
  cries wolf is worse than none)
- each is shown to **fire** on the specific defect it exists for
- both real historical regressions were re-injected into the parser and the
  suite failed: the component-id bug tripped 5 tests, the price bug tripped the
  fixture test plus the new price detector on 17/19 pages

## What remains unknown

- **Whether the parser handles any page not in this corpus.** Untestable here.
  Pages we do not have cannot be obtained: userbenchmark.com's robots.txt
  disallows this project's tooling from every `/PCGame/` path
  (`User-agent: *` → `Disallow: /`).
- Whether the template ever varies in the ways mutated here, or in others.
- Single-quoted markup is handled by the tables but not by identity extraction;
  no evidence exists that this site ever emits it.

## Recommended next step (needs review, not done here)

Promote `componentRowsMatchLinkedComponents`, `chartLabelsMatchData`,
`distributionSumsMatchTotalSamples` and `pricedRowCountMatchesHtml` from the
test layer into `lib/validate.mjs`, so every ingest enforces them rather than
only the test suite. That is a validation-policy change — it would introduce
new failure conditions for real captures — and is left as a recommendation.

Severity is a judgement call worth making deliberately: a short table is
arguably an ERROR (tooling fault), while a chart mismatch may be a WARNING
(source gap). Getting that split wrong would either mask real defects or fail
runs over legitimate source variation.
