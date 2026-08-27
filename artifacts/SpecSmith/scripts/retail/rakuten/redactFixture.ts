// Turns a live Product Search response into a fixture that is safe to commit.
//
// Shared by capture-fixture.ts (which writes them) and serverOnly.test.ts
// (which asserts every committed fixture is redacted), so "redacted" means one
// thing checked in one place rather than a habit applied by hand.
//
// WHAT IS REMOVED, AND WHAT IS NOT
// --------------------------------
// Removed: the publisher/site id, the offer id and the link id — the
// identifiers that tie a tracked URL to SpecSmith's Rakuten account. Kept: the
// `murl` destination, the SKU, the UPC, the prices and the product name. Those
// are public Newegg listing data, and they are the entire reason a fixture is
// worth having — a fixture with the prices scrubbed cannot test price parsing.
//
// The access token never appears in a response body (it is a request header),
// so there is nothing to strip for it here; the token guard is `redactToken`
// in client.ts and the assertion in serverOnly.test.ts.

/** Query parameters inside `<linkurl>` whose values identify the publisher. */
const REDACTED_URL_PARAMS: Record<string, string> = {
  id: 'REDACTED_SITE_ID',
  offerid: 'REDACTED_OFFER_ID',
};

/** Marker every committed fixture carries, stating where it came from. */
export const PROVENANCE_MARKER = 'PROVENANCE:';

export function provenanceComment(text: string): string {
  return `<!-- ${PROVENANCE_MARKER} ${text} -->`;
}

/** Replaces every publisher identifier with an obvious placeholder. */
export function redactProductSearchXml(xml: string): string {
  return String(xml)
    .replace(/([?&](?:amp;)?)(id|offerid)=([^&<"'\s]*)/gi, (_m, sep: string, key: string, _v: string) =>
      `${sep}${key}=${REDACTED_URL_PARAMS[key.toLowerCase()]}`,
    )
    .replace(/<linkid>[^<]*<\/linkid>/gi, '<linkid>REDACTED_LINK_ID</linkid>');
}

/** Every publisher identifier still present in a fixture. Empty means fully redacted. */
export function unredactedIdentifiers(xml: string): string[] {
  const found: string[] = [];
  for (const m of String(xml).matchAll(/[?&](?:amp;)?(id|offerid)=([^&<"'\s]*)/gi)) {
    if (!m[2].startsWith('REDACTED_')) found.push(`${m[1]}=${m[2]}`);
  }
  for (const m of String(xml).matchAll(/<linkid>([^<]*)<\/linkid>/gi)) {
    if (!m[1].startsWith('REDACTED_')) found.push(`linkid=${m[1]}`);
  }
  return found;
}
