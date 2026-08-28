import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_EMPTY_RESULT_VARIANTS,
  classifyEmptyResult,
  EMPTY_RESULT_OBSERVATIONS,
  fetchAllProductSearchPages,
  fetchNeweggOffersForGpu,
  loadGpuCatalog,
  OBSERVED_EMPTY_RESULT_VARIANTS,
  parseProductSearchXml,
  RakutenPagingError,
  readPageInfo,
  type EmptyResultVariant,
} from './index';
import { ACCESS_TOKEN_ENV_VAR, type CatalogGpu } from './types';

// THE LIVE FAILURE THIS FIXES
// ---------------------------
// A 57-GPU sweep measured 18 GPUs and failed 39, every one of them category
// `paging`, with no HTTP, auth, 429 or transport errors anywhere. A no-match
// keyword returns 200 OK with no <item> and no meaningful paging header; the
// strict walker read that as a missing page count and refused. So 39 GPUs
// whose real answer was "Newegg lists nothing for this" were reported as
// "we could not ask" — the one confusion the coverage report exists to avoid.
//
// The exception admitted here is narrow, and these tests are mostly about what
// it still refuses.

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;
const env = { [ACCESS_TOKEN_ENV_VAR]: 'test-token-not-a-real-credential' } as NodeJS.ProcessEnv;
const serve = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch;

/** Shape check with every variant admitted — "does this LOOK like a no-match body". */
const shape = (xml: string, admitted: readonly EmptyResultVariant[] = ALL_EMPTY_RESULT_VARIANTS) => {
  const root = parseProductSearchXml(xml);
  return classifyEmptyResult(root, readPageInfo(root), admitted);
};

/** Admission check against the real registry — "is this variant allowed through yet". */
const verdict = (xml: string) => {
  const root = parseProductSearchXml(xml);
  return classifyEmptyResult(root, readPageInfo(root));
};

/** The exact fingerprint observed on 2026-08-28: three fields, each once, each 0. */
const OBSERVED = '<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>';

describe('only the exact observed fingerprint is admitted', () => {
  it('admits all-paging-fields-zero and nothing else', () => {
    expect(OBSERVED_EMPTY_RESULT_VARIANTS).toEqual(['all-paging-fields-zero']);
  });

  it('every admitted variant records where it was observed; every other records none', () => {
    // Provenance is not documentation here: admitting a shape and recording
    // the run that justified it have to happen in the same edit.
    for (const variant of ALL_EMPTY_RESULT_VARIANTS) {
      const observation = EMPTY_RESULT_OBSERVATIONS[variant];
      if (OBSERVED_EMPTY_RESULT_VARIANTS.includes(variant)) {
        expect(observation, variant).toBeTruthy();
        expect(observation, variant).toContain('rtx4090');
        expect(observation, variant).toContain('2026-08-28');
      } else {
        expect(observation, variant).toBeNull();
      }
    }
  });

  it('admits the observed response and the fixture reproducing it', () => {
    expect(verdict(OBSERVED)).toEqual({ empty: true, variant: 'all-paging-fields-zero' });
    expect(verdict(fixture('newegg-empty-result-all-zero.xml'))).toEqual({
      empty: true,
      variant: 'all-paging-fields-zero',
    });
  });

  it('the fixture body is byte-identical to the observed 99-byte response', () => {
    // Corroborates the probe's reported length, and pins that the live body
    // carries no XML declaration and no inter-element whitespace.
    const body = fixture('newegg-empty-result-all-zero.xml')
      .split('\n')
      .filter((l) => !l.startsWith('<!--'))
      .join('')
      .trim();
    expect(Buffer.byteLength(body, 'utf-8')).toBe(99);
    expect(body).toBe(OBSERVED);
  });

  it('keeps paging-omitted unadmitted — it was never seen live', () => {
    expect(verdict(fixture('newegg-empty-result-no-paging.xml'))).toEqual({
      empty: false,
      reason: 'variant-not-yet-observed',
      variant: 'paging-omitted',
    });
  });
});

describe('every partial or mixed arrangement stays unadmitted', () => {
  const refusedAs = (xml: string, variant: string) =>
    expect(verdict(xml)).toEqual({ empty: false, reason: 'variant-not-yet-observed', variant });

  it('refuses a missing field, in each position', () => {
    refusedAs('<result><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>', 'partial-paging-zero');
    refusedAs('<result><TotalMatches>0</TotalMatches><PageNumber>0</PageNumber></result>', 'partial-paging-zero');
    refusedAs('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages></result>', 'partial-paging-zero');
  });

  it('refuses a single field alone', () => {
    for (const only of ['TotalMatches', 'TotalPages', 'PageNumber']) {
      refusedAs(`<result><${only}>0</${only}></result>`, 'partial-paging-zero');
    }
  });

  it('refuses PageNumber 1 — the observed feed sends 0', () => {
    // Coherent, plausible, and NOT what was seen. That is enough to refuse.
    refusedAs(
      '<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>1</PageNumber></result>',
      'partial-paging-zero',
    );
  });

  it('refuses a duplicated field', () => {
    // readPageInfo returns the FIRST match, so a second <TotalPages> saying
    // something else would be invisible to it. A response cannot state its
    // page count twice and be understood once.
    expect(
      verdict('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>'),
    ).toEqual({ empty: false, reason: 'duplicate-paging-field' });
    expect(
      verdict('<result><TotalMatches>0</TotalMatches><TotalMatches>7</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>'),
    ).toEqual({ empty: false, reason: 'duplicate-paging-field' });
  });

  it('refuses a malformed value in any of the three fields', () => {
    expect(verdict('<result><TotalMatches>0</TotalMatches><TotalPages>0garbage</TotalPages><PageNumber>0</PageNumber></result>')).toEqual({
      empty: false,
      reason: 'total-pages-not-zero-or-absent',
    });
    expect(verdict('<result><TotalMatches>zero</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>')).toEqual({
      empty: false,
      reason: 'total-matches-not-zero-or-absent',
    });
    expect(verdict('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>-0</PageNumber></result>')).toEqual({
      empty: false,
      reason: 'page-number-not-permitted',
    });
  });

  it('refuses an extra child alongside the exact three', () => {
    expect(
      verdict('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber><Errors><e>x</e></Errors></result>'),
    ).toEqual({ empty: false, reason: 'unexpected-result-child' });
    expect(
      verdict('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber><item><sku>N82E1</sku></item></result>'),
    ).toEqual({ empty: false, reason: 'has-items' });
  });

  it('refuses text or an extra top-level element around the exact three', () => {
    expect(verdict(`${OBSERVED}<error>oops</error>`)).toEqual({ empty: false, reason: 'not-single-result-root' });
    expect(
      verdict('<result>No matches.<TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>'),
    ).toEqual({ empty: false, reason: 'result-has-text' });
  });

  it('admits exactly the variant it is told to, and no other', () => {
    expect(shape(fixture('newegg-empty-result-no-paging.xml'), ['paging-omitted'])).toEqual({
      empty: true,
      variant: 'paging-omitted',
    });
    expect(shape(OBSERVED, ['paging-omitted'])).toMatchObject({ empty: false, reason: 'variant-not-yet-observed' });
  });
});

describe('variant labelling, with every variant admitted', () => {
  it('labels the exact fingerprint, the omitted shape, and the rest', () => {
    expect(shape(OBSERVED)).toEqual({ empty: true, variant: 'all-paging-fields-zero' });
    expect(shape(fixture('newegg-empty-result-no-paging.xml'))).toEqual({ empty: true, variant: 'paging-omitted' });
    expect(shape('<result><TotalMatches>0</TotalMatches></result>')).toEqual({ empty: true, variant: 'partial-paging-zero' });
    expect(
      shape('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>1</PageNumber></result>'),
    ).toEqual({ empty: true, variant: 'partial-paging-zero' });
  });
});

describe('the shape refuses everything else, even with all variants admitted', () => {
  const refuses = (xml: string, reason: string) => expect(shape(xml)).toEqual({ empty: false, reason });

  it('refuses a page that carries listings, whatever its header says', () => {
    // The load-bearing clause: truncation is only possible where there is
    // something to truncate, so a page with items never gets the exception.
    refuses('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><item><sku>N82E1</sku></item></result>', 'has-items');
  });

  it('refuses a top-level <error> document', () => {
    refuses('<error>quota exceeded</error>', 'not-single-result-root');
    refuses('<Error><code>17</code></Error>', 'not-single-result-root');
  });

  it('refuses an additional top-level element beside <result>', () => {
    refuses('<result><TotalMatches>0</TotalMatches></result><error>oops</error>', 'not-single-result-root');
    refuses('<meta/><result><TotalMatches>0</TotalMatches></result>', 'not-single-result-root');
  });

  it('refuses non-whitespace text inside <result>', () => {
    refuses('<result>No matches found.</result>', 'result-has-text');
    // Whitespace and newlines are formatting, not a message.
    expect(shape('<result>\n  <TotalMatches>0</TotalMatches>\n</result>')).toMatchObject({ empty: true });
  });

  it('refuses <Errors> inside <result> instead of ignoring it', () => {
    refuses('<result><Errors><ErrorMessage>bad token</ErrorMessage></Errors></result>', 'unexpected-result-child');
    refuses('<result><TotalMatches>0</TotalMatches><Errors><e>x</e></Errors></result>', 'unexpected-result-child');
  });

  it('refuses any unrecognised child — an allow-list, not a deny-list', () => {
    // No special case was needed for <Errors>, and none will be needed for
    // whatever the feed invents next.
    refuses('<result><TotalMatches>0</TotalMatches><message>none</message></result>', 'unexpected-result-child');
    refuses('<result><somethingNew/></result>', 'unexpected-result-child');
  });

  it('refuses a nonzero TotalMatches with no items — a contradiction, not an empty result', () => {
    refuses('<result><TotalMatches>42</TotalMatches><TotalPages>0</TotalPages></result>', 'total-matches-not-zero-or-absent');
  });

  it('refuses a nonzero TotalPages — it is claiming there is more to fetch', () => {
    refuses('<result><TotalMatches>0</TotalMatches><TotalPages>3</TotalPages></result>', 'total-pages-not-zero-or-absent');
  });

  it('refuses a malformed integer rather than treating it as omitted', () => {
    // "2garbage" is not "absent". Letting it buy the same amnesty as a clean
    // absence would make a malformed header the easiest way past the walker.
    for (const raw of ['2garbage', '-1', '0.0', 'none', ' ']) {
      expect(shape(`<result><TotalMatches>0</TotalMatches><TotalPages>${raw}</TotalPages></result>`), raw).toEqual({
        empty: false,
        reason: 'total-pages-not-zero-or-absent',
      });
      expect(shape(`<result><TotalMatches>${raw}</TotalMatches></result>`), raw).toEqual({
        empty: false,
        reason: 'total-matches-not-zero-or-absent',
      });
    }
  });

  it('refuses an incoherent page number', () => {
    refuses('<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>7</PageNumber></result>', 'page-number-not-permitted');
    refuses('<result><TotalMatches>0</TotalMatches><PageNumber>x</PageNumber></result>', 'page-number-not-permitted');
  });
});

describe('the walker', () => {
  it('reports the observed shape as a successful empty result', async () => {
    const result = await fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: serve(OBSERVED) });
    expect(result).toMatchObject({ emptyResult: true, totalMatches: 0, totalPages: 0 });
    // One document was fetched, and the feed reported zero pages. Both true.
    expect(result.pages).toHaveLength(1);
  });

  it('produces a successful zero-offer search, not a paging failure', async () => {
    const result = await fetchNeweggOffersForGpu(gpu('rtx4090'), {
      env,
      fetch: serve(OBSERVED),
      now: () => new Date('2026-08-28T09:00:00Z'),
    });
    expect(result).toMatchObject({ gpuId: 'rtx4090', emptyResult: true, itemsSeen: 0, pagesRead: 1, feedTotalPages: 0 });
    expect(result.offers).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('still fails closed on the unobserved shapes, with a code naming the situation', async () => {
    // Not a generic "missing field": the operator needs to know the shape is
    // waiting on a probe run, not that the feed is broken.
    for (const body of [
      fixture('newegg-empty-result-no-paging.xml'),
      '<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>1</PageNumber></result>',
      '<result><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>',
    ]) {
      await expect(fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: serve(body) })).rejects.toMatchObject({
        code: 'empty-shape-not-yet-observed',
      });
    }
  });

  it('a result-bearing page with no paging header still fails closed', async () => {
    // The exact regression the exception must not cause — and it reports the
    // ordinary missing-field code, not the awaiting-observation one.
    const truncatable = '<result><item><sku>N82E1</sku></item></result>';
    await expect(fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: serve(truncatable) })).rejects.toMatchObject({
      code: 'total-pages-missing',
    });
  });
});

describe('paging failures carry a closed code', () => {
  const codeOf = async (body: string): Promise<string> => {
    try {
      await fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: serve(body) });
      throw new Error('expected a paging failure');
    } catch (e) {
      expect(e).toBeInstanceOf(RakutenPagingError);
      return (e as RakutenPagingError).code;
    }
  };
  const item = '<item><sku>N82E1</sku></item>';

  it('distinguishes the reasons a page can be refused', async () => {
    expect(await codeOf(`<result>${item}</result>`)).toBe('total-pages-missing');
    expect(await codeOf(`<result><TotalPages>2garbage</TotalPages>${item}</result>`)).toBe('total-pages-not-integer');
    expect(await codeOf(`<result><TotalPages>1</TotalPages>${item}</result>`)).toBe('page-number-missing');
    expect(await codeOf(`<result><TotalPages>1</TotalPages><PageNumber>x</PageNumber>${item}</result>`)).toBe(
      'page-number-not-integer',
    );
    expect(await codeOf(`<result><TotalPages>1</TotalPages><PageNumber>4</PageNumber>${item}</result>`)).toBe(
      'page-number-mismatch',
    );
    expect(await codeOf(`<result><TotalMatches>x</TotalMatches><TotalPages>1</TotalPages><PageNumber>1</PageNumber>${item}</result>`)).toBe(
      'total-matches-not-integer',
    );
    expect(await codeOf(`<result><TotalMatches>5</TotalMatches><TotalPages>0</TotalPages><PageNumber>1</PageNumber>${item}</result>`)).toBe(
      'total-pages-zero',
    );
    expect(await codeOf(`<result><TotalPages>99</TotalPages><PageNumber>1</PageNumber>${item}</result>`)).toBe(
      'page-limit-exceeded',
    );
  });

  it('carries a code for a contradiction found on a later page', async () => {
    const fetch = (async (url: string | URL) => {
      const page = Number(new URL(String(url)).searchParams.get('pagenumber') ?? '1');
      return new Response(
        `<result><TotalMatches>9</TotalMatches><TotalPages>${page === 1 ? 2 : 3}</TotalPages><PageNumber>${page}</PageNumber>${item}</result>`,
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch })).rejects.toMatchObject({
      code: 'total-pages-changed',
    });
  });
});
