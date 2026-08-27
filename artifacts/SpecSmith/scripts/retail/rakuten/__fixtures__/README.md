# Rakuten Product Search fixtures

Every file here opens with a `<!-- PROVENANCE: … -->` comment saying exactly
where it came from. `serverOnly.test.ts` asserts the marker is present and that
it says either **captured** or **synthetic** — a fixture cannot sit here
without declaring which it is.

## synthetic

Hand-written to the documented live Product Search response shape:

- a paging header (`<TotalMatches>`, `<TotalPages>`, `<PageNumber>`)
- `<category>` with **both** `<primary>` (a department, e.g. "Computers") and
  `<secondary>` (the `~~`-delimited path whose last segment is the leaf)
- `<upccode>` — the real element name; there is no `<upc>` element
- `<saleprice currency="USD">0.00</saleprice>` for "not on sale"

They are **not** captures and must not be described as such. They exist to pin
parser and admission behaviour to that shape.

## captured

Produced by `capture-fixture.ts`, which fetches every reported page and redacts
in one step:

```
RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/rakuten/capture-fixture.ts \
  --gpu rtx4070 --out newegg-rtx4070-live.xml
```

Redaction replaces the publisher/site id, offer id and link id with
`REDACTED_*` placeholders, via the same `redactProductSearchXml` the tests
check against. The `murl` destination, SKU, UPC, prices and product names are
kept — they are public listing data, and a fixture with the prices scrubbed
cannot test price parsing.

No access token appears in a response body (it is a request header), and
`serverOnly.test.ts` asserts no fixture contains anything token-shaped.
