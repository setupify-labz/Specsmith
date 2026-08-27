import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  childText,
  decodeXmlText,
  findItems,
  parseProductSearchXml,
  RakutenXmlError,
  readPrice,
} from './parseProductSearchXml';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

describe('parseProductSearchXml', () => {
  it('reads every <item> from a captured Newegg response', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')));
    expect(items).toHaveLength(4);
    expect(childText(items[0], 'sku')).toBe('N82E16814932663');
    expect(childText(items[0], 'mid')).toBe('44583');
  });

  it('decodes the ampersand in the category name and in tracked URLs', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')));
    const cat = items[0].children.find((c) => c.name === 'category')!;
    expect(childText(cat, 'primary')).toBe('Computers');
    expect(childText(cat, 'secondary')).toBe('Components~~Video Cards & Adapters');
    // A tracked link that still reads "&amp;offerid" is a broken link.
    expect(childText(items[0], 'linkurl')).toContain('&offerid=');
    expect(childText(items[0], 'linkurl')).not.toContain('&amp;');
  });

  it('reads a price with its currency attribute', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4070-page1.xml')));
    expect(readPrice(items[0], 'price')).toEqual({ amount: 579.99, currency: 'USD' });
    expect(readPrice(items[0], 'saleprice')).toEqual({ amount: 0, currency: 'USD' });
  });

  it('reports a present-but-unparseable price as amount null, distinct from an absent element', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-malformed.xml')));
    // "1,299.99" — a thousands separator is locale-dependent; never guessed at.
    expect(readPrice(items[0], 'price')).toEqual({ amount: null, currency: 'USD' });
    expect(readPrice(items[0], 'nosuchelement')).toBeNull();
  });

  it('treats a self-closing element as present and empty', () => {
    const items = findItems(parseProductSearchXml(fixture('newegg-rtx4060ti-capacity.xml')));
    expect(childText(items[2], 'upccode')).toBeNull();
  });

  it('decodes CDATA literally and does not re-decode entities inside it', () => {
    const root = parseProductSearchXml('<r><a><![CDATA[Cards & Adapters &amp; more]]></a></r>');
    expect(childText(root.children[0], 'a')).toBe('Cards & Adapters &amp; more');
  });

  it('decodes numeric character references', () => {
    expect(decodeXmlText('caf&#233; &#x26; bar')).toBe('café & bar');
  });

  it('leaves an unrecognized entity verbatim rather than dropping it', () => {
    expect(decodeXmlText('a&nbsp;b')).toBe('a&nbsp;b');
  });

  it('refuses a payload declaring a DOCTYPE (XXE / entity-expansion defence)', () => {
    const evil = '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>';
    expect(() => parseProductSearchXml(evil)).toThrow(RakutenXmlError);
  });

  it('refuses a payload declaring an entity even without a DOCTYPE line', () => {
    expect(() => parseProductSearchXml('<r><!ENTITY a "b">x</r>')).toThrow(/entity/i);
  });

  it('refuses a truncated response rather than reporting fewer products', () => {
    const truncated = fixture('newegg-rtx4070-page1.xml').slice(0, 700);
    expect(() => parseProductSearchXml(truncated)).toThrow(RakutenXmlError);
  });

  it('refuses mismatched tags', () => {
    expect(() => parseProductSearchXml('<r><a></b></r>')).toThrow(/Mismatched/);
  });

  it('refuses an empty body', () => {
    expect(() => parseProductSearchXml('   ')).toThrow(RakutenXmlError);
  });
});
