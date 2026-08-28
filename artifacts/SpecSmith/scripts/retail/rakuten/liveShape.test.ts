import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCategory, secondaryCategoryLeaf } from './admitOffer';
import { buildProductSearchUrl } from './client';
import { childText, findItems, parsePagingInteger, parseProductSearchXml, readPageInfo } from './parseProductSearchXml';
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
  const values = (xml: string) => {
    const info = readPageInfo(parseProductSearchXml(xml));
    return { totalMatches: info.totalMatches.value, totalPages: info.totalPages.value, pageNumber: info.pageNumber.value };
  };

  it('reads TotalMatches, TotalPages and PageNumber', () => {
    expect(values(fixture('newegg-rtx4070-page1.xml'))).toEqual({ totalMatches: 8, totalPages: 2, pageNumber: 1 });
    expect(values(fixture('newegg-rtx4070-page2.xml'))).toMatchObject({ pageNumber: 2 });
  });

  it('keeps the raw text so an error can quote what the feed actually said', () => {
    const info = readPageInfo(parseProductSearchXml('<result><TotalPages>2garbage</TotalPages></result>'));
    expect(info.totalPages).toEqual({ raw: '2garbage', value: null });
    // "TotalPages was \"2garbage\"" is diagnosable; "TotalPages was missing"
    // would be a wrong message about a present field.
    expect(info.pageNumber).toEqual({ raw: null, value: null });
  });

  it('does not mistake a product field for the paging header', () => {
    // The scan skips <item> subtrees; a listing containing its own
    // <pagenumber> must not be able to redirect paging.
    const xml = '<result><TotalPages>3</TotalPages><item><pagenumber>99</pagenumber></item><PageNumber>1</PageNumber></result>';
    expect(values(xml)).toMatchObject({ totalPages: 3, pageNumber: 1 });
  });

  it('reports null rather than guessing when the header is absent', () => {
    expect(values('<result><item><sku>x</sku></item></result>')).toEqual({
      totalMatches: null,
      totalPages: null,
      pageNumber: null,
    });
  });
});

describe('paging values are complete integers or nothing', () => {
  it('accepts whole non-negative integers, with surrounding whitespace', () => {
    expect(parsePagingInteger('0')).toBe(0);
    expect(parsePagingInteger('42')).toBe(42);
    expect(parsePagingInteger('  7\n')).toBe(7);
  });

  it.each(['2garbage', '2.0', '2.9', '-1', '+2', '2e1', '0x2', 'two', '', '   ', '1 2'])('refuses %j', (raw) => {
    // Number.parseInt reads a prefix and discards the rest, so "2garbage" and
    // "2.9" would both become 2 — a page count the feed never stated.
    expect(parsePagingInteger(raw)).toBeNull();
  });

  it('refuses a value too large to be an exact integer', () => {
    expect(parsePagingInteger('9007199254740993')).toBeNull();
  });

  it('reports an absent field as null', () => {
    expect(parsePagingInteger(null)).toBeNull();
  });
});

describe('every committed fixture declares its provenance and is redacted', () => {
  it.each(fixtureNames)('%s', (name) => {
    const text = fixture(name);
    expect(text.slice(0, 400)).toContain(PROVENANCE_MARKER);
    // A fixture must say which it is, and each word is a different claim:
    //   synthetic — written by hand to a documented shape
    //   captured  — these bytes came off the wire, via capture-fixture.ts
    //   observed  — the STRUCTURE was seen live via probe-response-shape.ts
    //               and reproduced here; the probe reports shape, not bodies,
    //               so this is weaker than "captured" and must not claim to be
    //               byte-identical unless it says so and proves it.
    expect(
      /PROVENANCE:\s*(synthetic|captured|observed)/i.test(text),
      `${name} must declare synthetic, captured or observed`,
    ).toBe(true);
    // An "observed" fixture has to say WHEN and for WHICH GPU, so the claim is
    // checkable against a probe run rather than being a bare assertion.
    if (/PROVENANCE:\s*observed/i.test(text)) {
      expect(text, `${name} must record the observation date`).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(text, `${name} must record the catalog GPU it was observed for`).toMatch(/\b(rtx|rx|arc)[a-z0-9-]+\b/i);
      expect(text, `${name} must name the tool that observed it`).toContain('probe-response-shape.ts');
    }
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
