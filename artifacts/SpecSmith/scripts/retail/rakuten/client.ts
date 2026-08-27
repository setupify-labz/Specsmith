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
import { parseProductSearchXml, readPageInfo, type PageField, type PageInfo } from './parseProductSearchXml';

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
  url.searchParams.set('cat', REQUIRED_CATEGORY_LEAF);
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
  totalPages: number;
}

/** A paging header that is absent, unreadable, or contradicts a previous page. */
export class RakutenPagingError extends Error {}

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
      `${where}: <TotalPages> is ${describe(info.totalPages)}. Refusing to keep walking on a page count that is missing or not a whole number — the difference between "one page of results" and "an unknown number of pages" is exactly the truncation this must not do silently.`,
    );
  }
  if (info.pageNumber.value === null) {
    throw new RakutenPagingError(
      `${where}: <PageNumber> is ${describe(info.pageNumber)}. Without it the response cannot be confirmed to be the page that was asked for.`,
    );
  }
  if (info.pageNumber.value !== requestedPage) {
    throw new RakutenPagingError(`Requested ${where} but the response reports page ${info.pageNumber.value}.`);
  }
  if (info.totalMatches.raw !== null && info.totalMatches.value === null) {
    throw new RakutenPagingError(`${where}: <TotalMatches> is ${describe(info.totalMatches)}, which is not a whole number.`);
  }

  if (firstPage === null) return;

  if (info.totalPages.value !== firstPage.totalPages.value) {
    throw new RakutenPagingError(
      `${where}: <TotalPages> is ${info.totalPages.value} but page 1 reported ${firstPage.totalPages.value}. A page count that changes mid-walk means the result set moved underneath it; refusing rather than returning part of one search and part of another.`,
    );
  }
  if (firstPage.totalMatches.value !== null && info.totalMatches.value === null) {
    throw new RakutenPagingError(
      `${where}: <TotalMatches> is ${describe(info.totalMatches)} but page 1 reported ${firstPage.totalMatches.value}. A field cannot stop being published part-way through one search.`,
    );
  }
  if (
    firstPage.totalMatches.value !== null &&
    info.totalMatches.value !== null &&
    info.totalMatches.value !== firstPage.totalMatches.value
  ) {
    throw new RakutenPagingError(
      `${where}: <TotalMatches> is ${info.totalMatches.value} but page 1 reported ${firstPage.totalMatches.value}. With TotalPages pinned, the same pages cannot hold a different number of items.`,
    );
  }
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
  const head = readPageInfo(parseProductSearchXml(first.xml));
  assertPagingConsistent(head, 1, null);

  const totalPages = head.totalPages.value!;
  if (totalPages < 1) {
    throw new RakutenPagingError(`Response reports ${totalPages} pages; a response that exists has at least one page.`);
  }
  if (totalPages > MAX_PAGES_PER_SEARCH) {
    throw new RakutenPagingError(
      `Response reports ${totalPages} pages, above the ${MAX_PAGES_PER_SEARCH}-page guard. Refusing rather than reading a prefix and reporting it as the whole result; narrow the keyword or raise the guard deliberately.`,
    );
  }

  const pages = [first.xml];
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchProductSearchXml({ ...query, pageNumber: page }, deps);
    assertPagingConsistent(readPageInfo(parseProductSearchXml(next.xml)), page, head);
    pages.push(next.xml);
  }

  return { pages, fetchedAt: first.fetchedAt, totalMatches: head.totalMatches.value, totalPages };
}
