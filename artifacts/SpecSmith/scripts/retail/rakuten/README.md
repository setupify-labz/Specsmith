# Rakuten Advertising → Newegg Product Search adapter

Server-only. Reads Newegg's Rakuten product feed (MID `44583`) and returns
verified, per-SKU offers for parts that are already in `src/data/gpus.json`.

```
RAKUTEN_API_ACCESS_TOKEN=… npx tsx -e "…"   # see index.ts

# capture a live response as a redacted fixture
RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/rakuten/capture-fixture.ts \
  --gpu rtx4070 --out newegg-rtx4070-live.xml
```

## Where this sits in SpecSmith's pricing/affiliate architecture

SpecSmith already had two price-shaped things. This is a third, and the point
of the design is that it never becomes either of the other two.

| | what it is | where it lives |
|---|---|---|
| `gpus.json` `price_usd` | a hand-maintained **planning estimate** about a *part*, refreshed monthly, stamped by `src/lib/prices.ts`'s `PRICES_UPDATED` | client bundle |
| `getAffiliateUrl` / `getNeweggUrl` (`src/lib/fps.ts`) | **search links**. They name no SKU and assert no price, so they cannot be wrong about one | client bundle |
| **this adapter** | one real, dated **listing** — SKU, UPC, the merchant's own retail and sale prices, and a pre-tracked deep link | `scripts/`, server-only |

Nothing here writes back into `gpus.json`, and nothing here produces a search
link. Those boundaries are asserted structurally in `serverOnly.test.ts`, not
left to convention.

What it *does* reuse: `buildPartQuery` from `src/lib/fps.ts` (one definition of
how SpecSmith spells a part to a shop) and `src/data/gpus.json` itself (no
second parts list to drift). The catalog supplies the parts to price and their
canonical ids — never the matching rules; see "Memory size is always required"
below for why that separation matters.

## Why the matcher is not `research/userbenchmark/lib/hardware-normalize.mjs`

That module resolves a hardware name to whichever catalog entry it most
plausibly denotes, and to do it, it deliberately erases the memory-size
designator and treats `Ti`/`Super` as spelling variants. Both are correct for a
benchmark row and wrong for a price: `RTX 4060 Ti 8GB` and `RTX 4060 Ti 16GB`
are two SKUs at two prices, and the catalog carries both. `gpuModelMatch.ts` is
the opposite rule applied at a boundary where money is involved — not a second
copy. It is also research-only by its own header and lives under `research/`,
which Vitest is configured not to run.

## The token

`RAKUTEN_API_ACCESS_TOKEN`, read from `process.env` in `client.ts` and nowhere
else. Never `import.meta.env` (Vite inlines `VITE_`-prefixed variables into
shipped JavaScript), never a query parameter (query strings reach proxy logs
and `Referer` headers), never logged, never attached to a record.
`redactToken` runs over every body and error the client returns.

## The response shape

Four things about the live feed that an assumed shape gets wrong, each of which
fails **silently**:

- **Two category fields, not one.** `<primary>` is a department ("Computers");
  `<secondary>` is the `~~`-delimited path. Both are preserved on the record,
  and admission gates on the secondary path's **final segment** being exactly
  `Video Cards & Adapters`. Segment equality, not `includes` — the accessories
  aisle is `Components~~Video Cards & Adapters~~Accessories`, directly under the
  card leaf, and a substring test admits every cable in it.
- **The UPC element is `<upccode>`.** There is no `<upc>`. Reading `upc` returns
  null on every listing, and an absent UPC is common enough that it never
  announces itself.
- **`cat=Video Cards & Adapters` is sent on the request**, so the pages walked
  are pages of candidate cards rather than pages of Newegg's whole catalogue.
  The response is still checked on the way back — a request parameter is a
  request, not a guarantee.
- **`<TotalPages>` must be walked.** Reading page 1 looks exactly like "Newegg
  lists 20 of these" when the truth is "Newegg lists 340 and we saw 20". Every
  paging failure throws: no `TotalPages`, a page that reports a different
  `PageNumber` than requested, or more pages than `MAX_PAGES_PER_SEARCH`.

## Memory size is always required

A listing that states no capacity is refused (`memory-capacity-unstated`),
unconditionally, consulting nothing but the title and the one catalog entry.

An earlier rule asked the catalog instead — an explicit size was required only
when SpecSmith already held two entries sharing a family, number and suffix.
That made the safety of a price depend on the completeness of an editorial
parts list. The RTX 5060 Ti is the failure it produced: the part ships in 8GB
and 16GB, the catalog carries only the 16GB `rtx5060ti`, so no sibling existed,
so no size was required, so "ASUS Dual GeForce RTX 5060 Ti OC" was accepted as
the 16GB card — publishing an 8GB card's price. Nothing downstream could detect
it.

## The gates

A listing is refused at the first gate it fails, and the reason is returned —
never logged and dropped. A run that admits 2 of 40 listings is either a
well-behaved filter or a broken matcher, and the only way to tell is to read
the 38 reasons.

1. `merchant-mismatch` — not MID 44583
2. `category-mismatch` — secondary path's leaf is not `Video Cards & Adapters`
3. `incomplete-record` — missing SKU / name / image / tracked link, unparseable price
4. `not-a-graphics-card`, `laptop-part`, `prebuilt-system`, `condition-not-new`
5. `model-not-found`, `model-ambiguous`, `model-mismatch`, `variant-suffix-mismatch`, `memory-capacity-mismatch`, `memory-capacity-unstated`

Kind is checked before model on purpose: an "RTX 5090 power cable" names the
model perfectly, and the true statement about it is that it is a cable.

**The zero rule.** Rakuten writes `<saleprice>0.00</saleprice>` for "no sale
running", not "free". It is normalized to `null` at the parse boundary, so no
consumer downstream can compute `salePrice ?? retailPrice` and get `0`.

## Fixtures

Every fixture opens with a `<!-- PROVENANCE: … -->` line declaring itself
**synthetic** or **captured**, and a test refuses one that declares neither.
The fixtures committed today are synthetic — written to the response shape
above, not fetched. `capture-fixture.ts` produces captured ones: it walks every
reported page and redacts publisher identifiers in the same step, using the
same `redactProductSearchXml` the tests check fixtures against, so "this was
captured and cleaned" is a claim the tooling backs rather than one a committer
makes by hand.
