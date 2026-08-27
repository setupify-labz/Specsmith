# Rakuten Product Search fixtures

Captured Product Search responses for Newegg (MID 44583), **redacted**.

Every one of these is a real response shape with the following replaced by
obvious placeholders:

- the publisher/site id and offer id inside `linkurl` -> `id=REDACTED_SITE_ID`,
  `offerid=REDACTED_OFFER_ID`
- `linkid` values -> `REDACTED_LINK_ID`
- the `murl` destination is kept, because it is a public Newegg product URL and
  it is what makes the link verifiable

No access token appears in a response body, and none appears here. The token is
sent in an `Authorization` header and never in a URL; `client.ts` additionally
runs `redactToken` over every body and error it returns, and
`serverOnly.test.ts` asserts no fixture contains a bearer-token-shaped string.

Prices, SKUs, UPCs and product names are left as captured — they are public
listing data and the whole point of the fixture is to exercise the real
formatting (including `<saleprice>0.00</saleprice>`, which means "not on sale").
