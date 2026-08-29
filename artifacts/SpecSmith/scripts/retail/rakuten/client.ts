// The only module that touches the Rakuten access token.
//
// SERVER-ONLY, AND STRUCTURALLY SO
// --------------------------------
// The token is read from process.env, which does not exist in the browser, and
// this directory is outside `src/` so Vite never resolves it into a bundle.
// Deliberately NOT `import.meta.env`: Vite inlines VITE_-prefixed variables
// into shipped JavaScript at build time, so a token read that way is published
// to every visitor. serverOnly.test.ts asserts that no file here reads
// import.meta.env and that no file under src/ mentions the token at all.
//
// The token is never returned, never logged, never put in a URL query string
// (query strings land in proxy logs and Referer headers) and never attached to
// a record. It exists only as an Authorization header value inside this file.

import { ACCESS_TOKEN_ENV_VAR, NEWEGG_MID, PRODUCT_SEARCH_ENDPOINT, REQUIRED_CATEGORY_LEAF } from './types';
import { findItems, parseProductSearchXml, readPageInfo, type PageField, type PageInfo, type XmlElement } from './parseProductSearchXml';

export class RakutenAuthError extends Error {}
export class RakutenRequestError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
  }
}

/**
 * Reads the access token, or throws.
 *
 * The error names the variable but never its value, and refuses a blank or
 * whitespace-only value rather than sending an empty Bearer header — an empty
 * credential produces a confusing 401 instead of an obvious misconfiguration.
 */
export function readAccessToken(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[ACCESS_TOKEN_ENV_VAR];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new RakutenAuthError(
      `${ACCESS_TOKEN_ENV_VAR} is not set. The Rakuten Product Search adapter is server-only and reads its token from the process environment; it must never be supplied through a VITE_-prefixed variable, which Vite would inline into the browser bundle.`,
    );
  }
  return raw.trim();
}

/**
 * Removes a token from text before it is logged or thrown.
 *
 * Belt-and-braces: nothing in this module puts the token into a message in the
 * first place, but an upstream error (a fetch implementation echoing request
 * headers, say) can carry one, and a redactor that runs unconditionally on the
 * way out is cheaper than auditing every error source.
 */
export function redactToken(text: string, token: string): string {
  if (!token) return text;
  return String(text).split(token).join('[REDACTED]');
}

export interface ProductSearchQuery {
  /** Search terms. Sent as the `keyword` parameter. */
  keyword: string;
  /**
   * Exact Rakuten/merchant category leaf. Omit for the GPU adapter default;
   * pass null only while discovering the leaf for a new product tier.
   */
  categoryLeaf?: string | null;
  /** Max results per page. Rakuten's own cap is 100. */
  max?: number;
  pageNumber?: number;
}

/** Everything the request needs except the token, so tests can supply a fake fetch and clock. */
export interface ProductSearchDeps {
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  /** Returns the ISO timestamp stamped onto every offer from this response. */
  now?: () => Date;
}

export interface ProductSearchResponse {
  xml: string;
  /** ISO 8601 UTC, captured when the response was read. */
  fetchedAt: string;
  requestUrl: string;
}

/**
 * The request URL, with the merchant pinned to Newegg and the category pinned
 * to the graphics-card leaf. Contains no credentials.
 *
 * `cat` is sent as well as being checked on the way back in. That is not
 * redundant: asking the API to filter means the pages walked below are pages
 * of candidate graphics cards rather than pages of Newegg's entire catalogue,
 * so a card that would have been on result page 40 of an unfiltered search is
 * actually reachable. The `admitOffer` check stays because a request parameter
 * is a request, not a guarantee — the response is what has to be verified.
 */
export function buildProductSearchUrl(query: ProductSearchQuery): string {
  const url = new URL(PRODUCT_SEARCH_ENDPOINT);
  url.searchParams.set('keyword', query.keyword);
  url.searchParams.set('mid', NEWEGG_MID);
  const categoryLeaf = query.categoryLeaf === undefined ? REQUIRED_CATEGORY_LEAF : query.categoryLeaf;
  if (categoryLeaf !== null) url.searchParams.set('cat', categoryLeaf);
  if (query.max !== undefined) url.searchParams.set('max', String(query.max));
  if (query.pageNumber !== undefined) url.searchParams.set('pagenumber', String(query.pageNumber));
  return url.toString();
}

/**
 * Fetches one page of Product Search results as raw XML.
 *
 * Returns the body untouched. Parsing is a separate, pure function so a
 * captured response can be replayed through the exact same code path in tests
 * as a live one — the fixtures under __fixtures__ are real responses with the
 * publisher identifiers redacted.
 */
export async function fetchProductSearchXml(
  query: ProductSearchQuery,
  deps: ProductSearchDeps = {},
): Promise<ProductSearchResponse> {
  const token = readAccessToken(deps.env);
  const doFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const requestUrl = buildProductSearchUrl(query);

  let response: Response;
  try {
    response = await doFetch(requestUrl, {
      method: 'GET',
      headers: {
        // The ONLY place the token appears. Header, not query string.
        Authorization: `Bearer ${token}`,
        Accept: 'application/xml',
      },
    });
  } catch (cause) {
    throw new RakutenRequestError(redactToken(`Product Search request failed: ${String(cause)}`, token), 0);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new RakutenRequestError(
      redactToken(`Product Search returned HTTP ${response.status}: ${body.slice(0, 500)}`, token),
      response.status,
    );
  }

  const xml = redactToken(await response.text(), token);
  return { xml, fetchedAt: now().toISOString(), requestUrl };
}

/**
 * Refuses to walk more pages than this in one search.
 *
 * A guard against a feed that reports an absurd TotalPages, not a result cap:
 * exceeding it THROWS. That distinction is the whole point — a cap that
 * silently stopped would be the truncation this function exists to prevent,
 * wearing a different name.
 */
export const MAX_PAGES_PER_SEARCH = 40;

export interface ProductSearchPages {
  /** Every page's raw XML, in page order. */
  pages: string[];
  /** ISO 8601 UTC, captured once when the first page was read. */
  fetchedAt: string;
  totalMatches: number | null;
  /**
   * The feed's OWN reported page count. 0 for an admitted empty result.
   *
   * Distinct from `pages.length`, which is how many documents were actually
   * fetched: an empty result is one document reporting zero pages, and
   * collapsing the two would report a request that happened as if it had not.
   */
  totalPages: number;
  /**
   * True when the feed returned no matching listing — see `classifyEmptyResult`.
   *
   * `pages` still holds the one document received, so a caller can inspect it;
   * it contains no <item>, which is what makes counting it harmless.
   */
  emptyResult: boolean;
}

/**
 * Why a paging header was refused — a CLOSED set of codes, never free text.
 *
 * The message stays for a human reading a stack; the code is what a caller may
 * branch on and what a report may print. Two reasons for splitting them: a
 * message is the one part that could quote something the far end sent, and a
 * histogram of codes is what turns "39 GPUs failed on paging" into a
 * diagnosis, which is exactly the question that produced this type.
 */
export type PagingErrorCode =
  | 'total-pages-missing'
  | 'total-pages-not-integer'
  | 'total-pages-zero'
  | 'total-pages-changed'
  | 'page-number-missing'
  | 'page-number-not-integer'
  | 'page-number-mismatch'
  | 'total-matches-not-integer'
  | 'total-matches-changed'
  | 'total-matches-disappeared'
  | 'page-limit-exceeded'
  /** Matches the no-match shape, but that variant has not been observed live yet. */
  | 'empty-shape-not-yet-observed';

export const ALL_PAGING_ERROR_CODES: readonly PagingErrorCode[] = [
  'total-pages-missing',
  'total-pages-not-integer',
  'total-pages-zero',
  'total-pages-changed',
  'page-number-missing',
  'page-number-not-integer',
  'page-number-mismatch',
  'total-matches-not-integer',
  'total-matches-changed',
  'total-matches-disappeared',
  'page-limit-exceeded',
  'empty-shape-not-yet-observed',
];

/** A paging header that is absent, unreadable, or contradicts a previous page. */
export class RakutenPagingError extends Error {
  constructor(
    readonly code: PagingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function describe(field: PageField): string {
  return field.raw === null ? 'absent' : `${JSON.stringify(field.raw)}`;
}

/**
 * Checks one page's header, and its agreement with page 1.
 *
 * FAIL-CLOSED, FIELD BY FIELD. Every rule here exists because its absence
 * produces a plausible wrong answer rather than an error:
 *
 *   - TotalPages required ON EVERY PAGE, not just the first. A later page that
 *     stops reporting it is a shape change, and continuing past one means the
 *     walk is being driven by a number no longer being confirmed.
 *   - PageNumber required on every page, and equal to the page requested. A
 *     feed that answers every request with page 1 would otherwise produce N
 *     copies of the first page, silently, looking like a full result set.
 *   - TotalPages must be IDENTICAL to page 1's. Growth means listings appeared
 *     that this walk will never reach; shrinkage means the plan is stale. Both
 *     are truncation.
 *   - TotalMatches must be identical to page 1's WHEN BOTH REPORT IT, and a
 *     page may not drop it once page 1 has supplied it. Inventory drift is not
 *     tolerated: TotalPages is already pinned, so a TotalMatches that moves
 *     inside a fixed page count is not drift but a contradiction — the same
 *     pages claiming to hold a different number of items. The one case allowed
 *     is a feed that reports TotalMatches on NO page, which is a feed that
 *     simply does not publish the field, and is recorded as null rather than
 *     invented.
 */
export function assertPagingConsistent(info: PageInfo, requestedPage: number, firstPage: PageInfo | null): void {
  const where = `page ${requestedPage}`;

  if (info.totalPages.value === null) {
    throw new RakutenPagingError(
      info.totalPages.raw === null ? 'total-pages-missing' : 'total-pages-not-integer',
      `${where}: <TotalPages> is ${describe(info.totalPages)}. Refusing to keep walking on a page count that is missing or not a whole number — the difference between "one page of results" and "an unknown number of pages" is exactly the truncation this must not do silently.`,
    );
  }
  if (info.pageNumber.value === null) {
    throw new RakutenPagingError(
      info.pageNumber.raw === null ? 'page-number-missing' : 'page-number-not-integer',
      `${where}: <PageNumber> is ${describe(info.pageNumber)}. Without it the response cannot be confirmed to be the page that was asked for.`,
    );
  }
  if (info.pageNumber.value !== requestedPage) {
    throw new RakutenPagingError('page-number-mismatch', `Requested ${where} but the response reports page ${info.pageNumber.value}.`);
  }
  if (info.totalMatches.raw !== null && info.totalMatches.value === null) {
    throw new RakutenPagingError('total-matches-not-integer', `${where}: <TotalMatches> is ${describe(info.totalMatches)}, which is not a whole number.`);
  }

  if (firstPage === null) return;

  if (info.totalPages.value !== firstPage.totalPages.value) {
    throw new RakutenPagingError(
      'total-pages-changed',
      `${where}: <TotalPages> is ${info.totalPages.value} but page 1 reported ${firstPage.totalPages.value}. A page count that changes mid-walk means the result set moved underneath it; refusing rather than returning part of one search and part of another.`,
    );
  }
  if (firstPage.totalMatches.value !== null && info.totalMatches.value === null) {
    throw new RakutenPagingError(
      'total-matches-disappeared',
      `${where}: <TotalMatches> is ${describe(info.totalMatches)} but page 1 reported ${firstPage.totalMatches.value}. A field cannot stop being published part-way through one search.`,
    );
  }
  if (
    firstPage.totalMatches.value !== null &&
    info.totalMatches.value !== null &&
    info.totalMatches.value !== firstPage.totalMatches.value
  ) {
    throw new RakutenPagingError(
      'total-matches-changed',
      `${where}: <TotalMatches> is ${info.totalMatches.value} but page 1 reported ${firstPage.totalMatches.value}. With TotalPages pinned, the same pages cannot hold a different number of items.`,
    );
  }
}

/**
 * Whether a response is Rakuten's "no matches" answer rather than a broken page.
 *
 * WHY THIS EXCEPTION EXISTS
 * -------------------------
 * A keyword that matches nothing gets a 200 OK whose body carries no <item>
 * and no meaningful paging header. The strict walker read that as a missing
 * page count and refused — correct for a page that should have had listings,
 * wrong for a page that legitimately has none. In a live 57-GPU sweep it
 * turned every no-match keyword into a `paging` failure, which is worse than a
 * false negative: it reported "we could not ask" for 39 GPUs whose real answer
 * was "the feed returned no matching listing".
 *
 * WHAT IS ADMITTED, AND WHY ONLY THAT
 * -----------------------------------
 * Exactly one variant: `all-paging-fields-zero`, the fingerprint the probe
 * observed on 2026-08-28 for rtx4090 — all three paging fields present exactly
 * once and all exactly 0. `paging-omitted` and every partial or mixed
 * arrangement remain DEFINED but UNADMITTED.
 *
 * The narrowness is the point. "The feed sometimes omits paging fields" was a
 * guess; "the feed answered a no-match query with 0/0/0" is an observation,
 * and only the observation is admitted. Anything else that looks roughly right
 * still fails closed with the code `empty-shape-not-yet-observed`, which names
 * the situation precisely: not a broken feed, a shape awaiting a probe run.
 *
 * WHAT THE SHAPE REQUIRES
 * -----------------------
 * Every clause is load-bearing, and the first is what makes the rest safe:
 * truncation is only possible where there is something to truncate, so a page
 * carrying listings never gets the exception.
 *
 *   - exactly one top-level <result>, and no other top-level element
 *   - no non-whitespace text inside <result>
 *   - zero <item> elements
 *   - ONLY the three permitted paging children; anything else — <Errors>, a
 *     <message>, an unrecognised tag — disqualifies the shape rather than
 *     being ignored
 *   - TotalMatches 0 or absent, TotalPages 0 or absent, PageNumber absent/0/1
 *   - a field present but unreadable disqualifies it. "2garbage" is not
 *     "omitted", and letting it buy the same amnesty as a clean absence would
 *     make a malformed header the easiest way past the walker.
 */
export type EmptyResultVariant =
  /**
   * OBSERVED. Exactly one TotalMatches, one TotalPages and one PageNumber,
   * every one of them exactly 0, and nothing else.
   */
  | 'all-paging-fields-zero'
  /** Candidate: no paging fields at all. Never seen live; not admitted. */
  | 'paging-omitted'
  /**
   * Candidate: any other zero-ish arrangement — a missing field, a PageNumber
   * of 1, some present and some absent. Never seen live; not admitted.
   *
   * One label for the whole family on purpose: these are the shapes that look
   * roughly right, and lumping them together means none of them can be
   * admitted by accident while admitting the exact one.
   */
  | 'partial-paging-zero';

export const ALL_EMPTY_RESULT_VARIANTS: readonly EmptyResultVariant[] = [
  'all-paging-fields-zero',
  'paging-omitted',
  'partial-paging-zero',
];

/**
 * Variants actually seen coming back from the live feed, with the observation
 * that admitted each.
 *
 * A variant may be added here ONLY with a probe run behind it. The provenance
 * is not documentation: a test asserts that every admitted variant has one and
 * every unadmitted variant has none, so admitting a shape means recording
 * where it was seen in the same edit.
 */
export const EMPTY_RESULT_OBSERVATIONS: Readonly<Record<EmptyResultVariant, string | null>> = {
  'all-paging-fields-zero':
    'Observed 2026-08-28 for catalog GPU rtx4090 via probe-response-shape.ts: HTTP 200, 99-byte body, exactly one <result> containing exactly one <TotalMatches>, one <TotalPages> and one <PageNumber>, all three equal to 0, and zero <item> elements.',
  'paging-omitted': null,
  'partial-paging-zero': null,
};

export const OBSERVED_EMPTY_RESULT_VARIANTS: readonly EmptyResultVariant[] = ['all-paging-fields-zero'];

/** Why a response is not an admissible empty result. A closed set, never text. */
export type NotEmptyReason =
  | 'has-items'
  | 'not-single-result-root'
  | 'result-has-text'
  | 'unexpected-result-child'
  | 'duplicate-paging-field'
  | 'total-matches-not-zero-or-absent'
  | 'total-pages-not-zero-or-absent'
  | 'page-number-not-permitted'
  | 'variant-not-yet-observed';

export type EmptyResultVerdict =
  | { empty: true; variant: EmptyResultVariant }
  | { empty: false; reason: NotEmptyReason; variant?: EmptyResultVariant };

/** The only children an empty <result> may contain. Lower-cased for comparison. */
const PERMITTED_EMPTY_RESULT_CHILDREN: readonly string[] = ['totalmatches', 'totalpages', 'pagenumber'];

export function classifyEmptyResult(
  root: XmlElement,
  info: PageInfo,
  admitted: readonly EmptyResultVariant[] = OBSERVED_EMPTY_RESULT_VARIANTS,
): EmptyResultVerdict {
  if (findItems(root).length > 0) return { empty: false, reason: 'has-items' };

  // Exactly one top-level element, and it is <result>. A document that is
  // <error>…</error>, or <result/> alongside anything else, is not this shape.
  // (The parser drops the XML declaration and comments, so root.children holds
  // elements only.)
  if (root.children.length !== 1 || root.children[0].name.toLowerCase() !== 'result' || root.text.trim() !== '') {
    return { empty: false, reason: 'not-single-result-root' };
  }
  const result = root.children[0];

  // Text directly inside <result> means the body is saying something this
  // reader does not understand — an error string, most likely.
  if (result.text.trim() !== '') return { empty: false, reason: 'result-has-text' };

  // Allow-list, not deny-list: an unrecognised child disqualifies the shape
  // rather than being skipped, so <Errors> needs no special case and neither
  // does whatever the feed invents next.
  const occurrences = new Map<string, number>();
  for (const child of result.children) {
    const name = child.name.toLowerCase();
    if (!PERMITTED_EMPTY_RESULT_CHILDREN.includes(name)) {
      return { empty: false, reason: 'unexpected-result-child' };
    }
    occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  }

  // Counted rather than assumed: readPageInfo returns the FIRST match, so a
  // second <TotalPages> saying something different would be invisible to it.
  // A response cannot state its page count twice and be understood once.
  for (const name of PERMITTED_EMPTY_RESULT_CHILDREN) {
    if ((occurrences.get(name) ?? 0) > 1) return { empty: false, reason: 'duplicate-paging-field' };
  }

  const zeroOrAbsent = (f: PageField): boolean => f.raw === null || f.value === 0;
  if (!zeroOrAbsent(info.totalMatches)) return { empty: false, reason: 'total-matches-not-zero-or-absent' };
  if (!zeroOrAbsent(info.totalPages)) return { empty: false, reason: 'total-pages-not-zero-or-absent' };
  // 0 and 1 are both coherent spellings for "the only page"; which one the
  // feed actually sends is decided by the variant below, not here.
  if (!(info.pageNumber.raw === null || info.pageNumber.value === 0 || info.pageNumber.value === 1)) {
    return { empty: false, reason: 'page-number-not-permitted' };
  }

  const present = (name: string): boolean => (occurrences.get(name) ?? 0) === 1;
  const allThreePresent = PERMITTED_EMPTY_RESULT_CHILDREN.every(present);
  const nonePresent = PERMITTED_EMPTY_RESULT_CHILDREN.every((n) => !present(n));
  const allExactlyZero =
    info.totalMatches.value === 0 && info.totalPages.value === 0 && info.pageNumber.value === 0;

  const variant: EmptyResultVariant = allThreePresent && allExactlyZero
    ? 'all-paging-fields-zero'
    : nonePresent
      ? 'paging-omitted'
      : 'partial-paging-zero';

  // The shape matches — but only an OBSERVED variant is admitted.
  if (!admitted.includes(variant)) return { empty: false, reason: 'variant-not-yet-observed', variant };
  return { empty: true, variant };
}

/**
 * Fetches EVERY page Rakuten reports, not just the first.
 *
 * Silent truncation of a price search is worse than an error, because the
 * answer it produces is plausible. So every page is validated by
 * `assertPagingConsistent` before its contents count, and anything the feed
 * will not confirm throws.
 *
 * `fetchedAt` is stamped once, from the first page, so every offer in one
 * search shares a timestamp. Stamping per page would give the same search
 * several different "as of" times and make two offers incomparable.
 */
export async function fetchAllProductSearchPages(
  query: ProductSearchQuery,
  deps: ProductSearchDeps = {},
): Promise<ProductSearchPages> {
  const first = await fetchProductSearchXml({ ...query, pageNumber: 1 }, deps);
  const firstRoot = parseProductSearchXml(first.xml);
  const head = readPageInfo(firstRoot);

  // Checked BEFORE the strict rules, and only ever on a page with no items.
  const emptyVerdict = classifyEmptyResult(firstRoot, head);
  if (emptyVerdict.empty) {
    // Normalized to zeroes rather than passing through nulls: "the feed has no
    // matching listing" is a definite answer, and reporting it as an unknown
    // would put it back in the bucket this exception exists to empty.
    return { pages: [first.xml], fetchedAt: first.fetchedAt, totalMatches: 0, totalPages: 0, emptyResult: true };
  }
  if (emptyVerdict.reason === 'variant-not-yet-observed') {
    // Still fails closed — but with a code that names the actual situation, so
    // a sweep reports "this shape is waiting to be confirmed" rather than a
    // generic missing field, and the operator knows to run the probe.
    throw new RakutenPagingError(
      'empty-shape-not-yet-observed',
      `Response matches the no-match shape (${emptyVerdict.variant}) but that variant has not been observed from the live feed yet. Run probe-response-shape.ts and add it to OBSERVED_EMPTY_RESULT_VARIANTS.`,
    );
  }

  assertPagingConsistent(head, 1, null);

  const totalPages = head.totalPages.value!;
  if (totalPages < 1) {
    throw new RakutenPagingError(
      'total-pages-zero',
      `Response reports ${totalPages} pages alongside listings; a result-bearing response has at least one page.`,
    );
  }
  if (totalPages > MAX_PAGES_PER_SEARCH) {
    throw new RakutenPagingError(
      'page-limit-exceeded',
      `Response reports ${totalPages} pages, above the ${MAX_PAGES_PER_SEARCH}-page guard. Refusing rather than reading a prefix and reporting it as the whole result; narrow the keyword or raise the guard deliberately.`,
    );
  }

  const pages = [first.xml];
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchProductSearchXml({ ...query, pageNumber: page }, deps);
    assertPagingConsistent(readPageInfo(parseProductSearchXml(next.xml)), page, head);
    pages.push(next.xml);
  }

  return { pages, fetchedAt: first.fetchedAt, totalMatches: head.totalMatches.value, totalPages, emptyResult: false };
}
