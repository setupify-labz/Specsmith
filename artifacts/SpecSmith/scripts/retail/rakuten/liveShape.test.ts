import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCategory, secondaryCategoryLeaf } from './admitOffer';
import { buildProductSearchUrl } from './client';
import { childText, findItems, parseProductSearchXml, readPageInfo } from './parseProductSearchXml';
import { PROVENANCE_MARKER, redactProductSearchXml, unredactedIdentifiers } from './redactFixture';
import { REQUIRED_CATEGORY_LEAF, SECONDARY_CATEGORY_DELIMITER } from './types';

// REGRESSION TESTS FOR THE RESPONSE SHAPE ITSELF.
//
// The first version of this adapter was written against an assumed shape and
// got four things wrong: it read a `<upc>` element that does not exist, it
// collapsed the two category fields into one and compared the DEPARTMENT
// against the card leaf, it never sent `cat`, and it read only page 1. Each of
// those failed silently — a null UPC, a category that never matched, a search
// that quietly saw a prefix of the results. Every one gets a test here, named
// for the mistake, so re-introducing it is loud.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '__fixtures__');
const fixtureNames = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.xml'));
const fixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf-8');

describe('response shape: categories are two fields, not one', () => {
  it('preserves primary and secondary separately', () => {
    const item = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')))[0];
    expect(readCategory(item)).toEqual({
      primary: 'Computers',
      secondary: `Components${SECONDARY_CATEGORY_DELIMITER}Video Cards & Adapters`,
      secondaryLeaf: 'Video Cards & Adapters',
    });
  });

  it('never gates on the primary department, which is far too coarse', () => {
    // "Computers" is the primary for a card, a cable, a laptop and a prebuilt
    // alike. An adapter that compared it against the card leaf would reject
    // every listing; one that accepted it would admit all four.
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')));
    expect(items.map((i) => readCategory(i).primary)).toEqual(['Computers', 'Computers', 'Computers', 'Computers']);
  });

  it('accepts only the exact final segment of the secondary path', () => {
    expect(secondaryCategoryLeaf('Components~~Video Cards & Adapters')).toBe(REQUIRED_CATEGORY_LEAF);
    // The accessories aisle sits UNDER the card leaf. A substring test would
    // admit it; segment equality does not.
    expect(secondaryCategoryLeaf('Components~~Video Cards & Adapters~~Accessories')).toBe('Accessories');
    expect(secondaryCategoryLeaf('Components~~Video Cards & Adapters~~Accessories')).not.toBe(REQUIRED_CATEGORY_LEAF);
  });

  it('handles a single-segment, empty, and absent secondary', () => {
    expect(secondaryCategoryLeaf('Video Cards & Adapters')).toBe(REQUIRED_CATEGORY_LEAF);
    expect(secondaryCategoryLeaf('~~')).toBeNull();
    expect(secondaryCategoryLeaf(null)).toBeNull();
    expect(secondaryCategoryLeaf('Components~~Video Cards & Adapters~~')).toBe(REQUIRED_CATEGORY_LEAF);
  });
});

describe('response shape: the UPC element is <upccode>', () => {
  it('reads upccode, and finds nothing under the name that does not exist', () => {
    const item = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')))[0];
    expect(childText(item, 'upccode')).toBe('889523036891');
    // The original bug: reading <upc> yields null on every listing, and a
    // legitimately-absent UPC is common enough that it never announces itself.
    expect(childText(item, 'upc')).toBeNull();
  });

  it('still reports null for a listing whose upccode is genuinely empty', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4060ti-capacity.xml')));
    expect(childText(items[2], 'upccode')).toBeNull();
  });
});

describe('response shape: the request carries the category filter', () => {
  it('sends cat=Video Cards & Adapters', () => {
    const url = new URL(buildProductSearchUrl({ keyword: 'NVIDIA GeForce RTX 4070 graphics card' }));
    expect(url.searchParams.get('cat')).toBe(REQUIRED_CATEGORY_LEAF);
    expect(url.searchParams.get('mid')).toBe('44583');
  });
});

describe('response shape: the paging header', () => {
  it('reads TotalMatches, TotalPages and PageNumber', () => {
    expect(readPageInfo(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')))).toEqual({
      totalMatches: 8,
      totalPages: 2,
      pageNumber: 1,
    });
    expect(readPageInfo(parseProductSearchXml(fixture('newegg-rtx4070-page2.xml')))).toMatchObject({ pageNumber: 2 });
  });

  it('does not mistake a product field for the paging header', () => {
    // The scan skips <item> subtrees; a listing containing its own
    // <pagenumber> must not be able to redirect paging.
    const xml = '<result><TotalPages>3</TotalPages><item><pagenumber>99</pagenumber></item><PageNumber>1</PageNumber></result>';
    expect(readPageInfo(parseProductSearchXml(xml))).toMatchObject({ totalPages: 3, pageNumber: 1 });
  });

  it('reports null rather than guessing when the header is absent', () => {
    expect(readPageInfo(parseProductSearchXml('<result><item><sku>x</sku></item></result>'))).toEqual({
      totalMatches: null,
      totalPages: null,
      pageNumber: null,
    });
  });
});

describe('every committed fixture declares its provenance and is redacted', () => {
  it.each(fixtureNames)('%s', (name) => {
    const text = fixture(name);
    expect(text.slice(0, 400)).toContain(PROVENANCE_MARKER);
    // A fixture must say which it is. "Captured" is a claim about where bytes
    // came from and cannot be made by a hand-written file.
    expect(/PROVENANCE:\s*(synthetic|captured)/i.test(text), `${name} must declare synthetic or captured`).toBe(true);
    expect(unredactedIdentifiers(text), `${name} has unredacted publisher identifiers`).toEqual([]);
    expect(/bearer|\btoken\b/i.test(text), `${name} must contain nothing token-shaped`).toBe(false);
  });

  it('the redactor is idempotent and actually removes a live identifier', () => {
    const live =
      '<item><linkid>91234567</linkid><linkurl>https://click.linksynergy.com/link?id=AbCd1234XyZ&amp;offerid=9876543.123&amp;murl=https%3A%2F%2Fwww.newegg.com%2Fp%2FX</linkurl></item>';
    const once = redactProductSearchXml(live);
    expect(unredactedIdentifiers(once)).toEqual([]);
    expect(once).not.toContain('AbCd1234XyZ');
    expect(once).not.toContain('91234567');
    expect(once).toContain('murl=https%3A%2F%2Fwww.newegg.com%2Fp%2FX');
    expect(redactProductSearchXml(once)).toBe(once);
  });

  it('flags an unredacted fixture rather than passing it', () => {
    expect(unredactedIdentifiers('<linkurl>https://click.linksynergy.com/link?id=REAL123&amp;offerid=99.1</linkurl>')).toEqual([
      'id=REAL123',
      'offerid=99.1',
    ]);
  });
});
