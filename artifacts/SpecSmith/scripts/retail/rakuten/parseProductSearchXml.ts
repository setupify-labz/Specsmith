// A deliberately small XML reader for the Rakuten Product Search response.
//
// WHY NOT A LIBRARY
// -----------------
// The workspace has no XML dependency, and pnpm-workspace.yaml's
// minimumReleaseAge policy makes adding one a considered act rather than a
// convenience. The response shape here is fixed, shallow and known: a <result>
// of <item>s, each a flat bag of leaf elements plus a two-field <category> and
// a <description>. ~120 lines of reader covers it exactly, with no parsing
// surface beyond what the feed actually uses.
//
// WHAT IT REFUSES TO PARSE
// ------------------------
// Doctype and entity declarations are rejected outright rather than ignored.
// This response is fetched over the network from a third party, and the two
// classic XML attacks — external entity expansion (XXE) and recursive entity
// expansion (billion laughs) — both require a DTD. A parser that supports no
// custom entities at all cannot be made to expand one, so the safest handling
// is to have no code path that reads a DTD. Only the five predefined XML
// entities and numeric character references are decoded.
//
// It is a READER, not a validator: it returns whatever elements are present.
// Deciding which are required, and what they must contain, is admitOffer's
// job — kept separate so a malformed feed produces a specific rejection
// reason rather than a parse exception.

/** Thrown when the payload is not XML this reader will process. */
export class RakutenXmlError extends Error {}

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlElement[];
}

const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decodes the five predefined entities and numeric character references.
 *
 * An unrecognized entity is left as written rather than dropped or guessed at:
 * "&nbsp;" surviving verbatim into a product name is visible and harmless,
 * whereas silently deleting it edits the merchant's text.
 */
export function decodeXmlText(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return PREDEFINED_ENTITIES[body] ?? match;
  });
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]] = decodeXmlText(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Parses a Product Search response into an element tree.
 *
 * Throws RakutenXmlError for a doctype, an entity declaration, or structurally
 * broken markup (an unclosed or mismatched tag). Refusing is the right
 * behaviour for all three: a truncated response is not a response with fewer
 * products in it, and treating it as one would quietly under-report offers.
 */
export function parseProductSearchXml(xml: string): XmlElement {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new RakutenXmlError('Empty response body — refusing to report zero offers for a request that produced no XML at all.');
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new RakutenXmlError('Response declares a DTD or entity. This reader supports no custom entities by design (XXE / entity-expansion defence); refusing the payload.');
  }

  const root: XmlElement = { name: '#document', attributes: {}, text: '', children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;

    if (lt > i) {
      stack[stack.length - 1].text += decodeXmlText(xml.slice(i, lt));
    }

    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end === -1) throw new RakutenXmlError('Unterminated CDATA section.');
      // CDATA is literal by definition — no entity decoding.
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      if (end === -1) throw new RakutenXmlError('Unterminated comment.');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt);
      if (end === -1) throw new RakutenXmlError('Unterminated processing instruction.');
      i = end + 2;
      continue;
    }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) throw new RakutenXmlError('Unterminated tag — the response is truncated.');
    const inner = xml.slice(lt + 1, gt);

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const open = stack.pop();
      if (!open || stack.length === 0 || open.name !== name) {
        throw new RakutenXmlError(`Mismatched closing tag </${name}>${open ? ` (expected </${open.name}>)` : ''}.`);
      }
    } else {
      const selfClosing = inner.endsWith('/');
      const body = selfClosing ? inner.slice(0, -1) : inner;
      const space = body.search(/\s/);
      const name = (space === -1 ? body : body.slice(0, space)).trim();
      if (name === '') throw new RakutenXmlError('Encountered a tag with no name.');
      const el: XmlElement = {
        name,
        attributes: space === -1 ? {} : parseAttributes(body.slice(space)),
        text: '',
        children: [],
      };
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
    }
    i = gt + 1;
  }

  if (stack.length !== 1) {
    throw new RakutenXmlError(`Unclosed element <${stack[stack.length - 1].name}> — the response is truncated.`);
  }
  return root;
}

/** First direct child with this name, or null. Case-insensitive: the feed is inconsistent. */
export function child(el: XmlElement, name: string): XmlElement | null {
  return el.children.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Trimmed text of a named child, or null when the child is absent or blank. */
export function childText(el: XmlElement, name: string): string | null {
  const c = child(el, name);
  if (!c) return null;
  const t = c.text.trim();
  return t === '' ? null : t;
}

/** Every <item> anywhere in the tree, in document order. */
export function findItems(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (c.name.toLowerCase() === 'item') out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/**
 * A price element's value and currency.
 *
 * Returns null for an absent element and `{ amount: null }` for one present but
 * unparseable — the caller needs to tell "no sale price published" apart from
 * "a sale price we could not read", and only the second is a broken record.
 */
export function readPrice(el: XmlElement, name: string): { amount: number | null; currency: string | null } | null {
  const c = child(el, name);
  if (!c) return null;
  const raw = c.text.trim();
  const currency = c.attributes.currency?.trim() || null;
  if (raw === '') return { amount: null, currency };
  // Strict: a bare decimal number only. "$1,099.99" or "1099.99 USD" is not a
  // number this adapter will guess at — thousands separators are locale-
  // dependent and stripping them is how 1.099,99 becomes 109999.
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return { amount: null, currency };
  const amount = Number.parseFloat(raw);
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

/**
 * A paging header field as published, and as parsed.
 *
 * `raw` is kept so an error can quote what the feed actually said. "TotalPages
 * was \"2garbage\"" is a diagnosable message; "TotalPages was missing" is a
 * wrong one, and that difference is the whole reason the raw text survives.
 */
export interface PageField {
  raw: string | null;
  value: number | null;
}

export interface PageInfo {
  totalMatches: PageField;
  totalPages: PageField;
  pageNumber: PageField;
}

/**
 * Parses a paging value, or reports it unparseable.
 *
 * COMPLETE non-negative integers only. `Number.parseInt` is exactly wrong for
 * this: it reads a leading prefix and discards the rest, so "2garbage" becomes
 * 2, "2.9" becomes 2, and a feed emitting either would be trusted as if it had
 * said something sensible. A paging count that cannot be read in full is a
 * paging count this adapter does not know, and it says so.
 */
export function parsePagingInteger(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * The paging header Rakuten puts at the top of every Product Search response.
 *
 * `TotalPages` is the number this adapter must actually walk. Reading page 1
 * and reporting its items is the silent-truncation failure this exists to
 * prevent: it looks exactly like "Newegg has 20 listings for this card" when
 * the truth is "Newegg has 340 and we looked at the first 20".
 *
 * This function only READS. Which fields are required, and what they must
 * agree on, is `assertPagingConsistent`'s job in client.ts — separated so an
 * absent header and a contradictory one produce different, specific errors
 * rather than one generic parse failure.
 */
export function readPageInfo(root: XmlElement): PageInfo {
  const rawOf = (name: string): string | null => {
    const stack = [root];
    while (stack.length) {
      const el = stack.pop()!;
      for (const c of el.children) {
        if (c.name.toLowerCase() === name) return c.text.trim();
        // <item> subtrees cannot hold the paging header, and descending into
        // hundreds of them to look would be both slow and a chance to pick up
        // a same-named product field.
        if (c.name.toLowerCase() !== 'item') stack.push(c);
      }
    }
    return null;
  };
  const field = (name: string): PageField => {
    const raw = rawOf(name);
    return { raw, value: parsePagingInteger(raw) };
  };
  return { totalMatches: field('totalmatches'), totalPages: field('totalpages'), pageNumber: field('pagenumber') };
}
