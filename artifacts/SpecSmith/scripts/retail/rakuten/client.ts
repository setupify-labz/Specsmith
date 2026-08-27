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
import { parseProductSearchXml, readPageInfo } from './parseProductSearchXml';

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

/**
 * Fetches EVERY page Rakuten reports, not just the first.
 *
 * The response header carries TotalPages; reading page 1 and reporting its
 * items looks exactly like "Newegg lists 20 of these" when the truth is
 * "Newegg lists 340 and we looked at 20". Silent truncation of a price search
 * is worse than an error, because the answer it produces is plausible.
 *
 * So every failure mode here is loud:
 *   - a page that does not report its own TotalPages -> throw
 *   - a page whose PageNumber is not the one requested -> throw
 *   - more pages than MAX_PAGES_PER_SEARCH -> throw
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

  if (head.totalPages === null) {
    throw new RakutenRequestError(
      'Response reports no <TotalPages>. Refusing to assume one page: the difference between "one page of results" and "an unknown number of pages" is exactly the truncation this must not do silently.',
      0,
    );
  }
  if (head.pageNumber !== null && head.pageNumber !== 1) {
    throw new RakutenRequestError(`Requested page 1 but the response reports page ${head.pageNumber}.`, 0);
  }
  if (head.totalPages > MAX_PAGES_PER_SEARCH) {
    throw new RakutenRequestError(
      `Response reports ${head.totalPages} pages, above the ${MAX_PAGES_PER_SEARCH}-page guard. Refusing rather than reading a prefix and reporting it as the whole result; narrow the keyword or raise the guard deliberately.`,
      0,
    );
  }

  const pages = [first.xml];
  for (let page = 2; page <= head.totalPages; page += 1) {
    const next = await fetchProductSearchXml({ ...query, pageNumber: page }, deps);
    const info = readPageInfo(parseProductSearchXml(next.xml));
    if (info.pageNumber !== null && info.pageNumber !== page) {
      throw new RakutenRequestError(`Requested page ${page} but the response reports page ${info.pageNumber}.`, 0);
    }
    pages.push(next.xml);
  }

  return { pages, fetchedAt: first.fetchedAt, totalMatches: head.totalMatches, totalPages: head.totalPages };
}
