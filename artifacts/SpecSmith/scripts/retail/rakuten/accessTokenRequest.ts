// Mints a short-lived Rakuten access token from long-lived client credentials.
//
// SERVER-ONLY, and the second module in this adapter allowed to touch a
// credential. client.ts reads the access token; this one reads the client id,
// client secret and publisher SID used to obtain it. Nothing else may read
// either set, and serverOnly.test.ts asserts that.
//
// WHY THIS EXISTS
// ---------------
// The bearer token copied from the API explorer is short-lived: a live CI run
// on 2026-08-29 sent one and every request came back 401. A validation job that
// depends on a human pasting a fresh token hours before it runs is not
// automation. Client credentials are long-lived, so the job mints its own token
// at the start of every run and the token never outlives the job.
//
// WHAT LEAVES THIS MODULE
// -----------------------
// An access token, and nothing else. Not the client id, not the secret, not the
// SID, not the response body, not a refresh token — `extractAccessToken` reads
// exactly one field and ignores the rest of the payload. Every error carries a
// closed category and an HTTP status number; no error message quotes a
// credential or anything the far end sent, because a CI log is the one place
// that text would end up.

/** Rakuten's token endpoint. Version-pinned by hostname; a new one gets a new module. */
export const TOKEN_ENDPOINT = 'https://api.linksynergy.com/token';

export const CLIENT_ID_ENV_VAR = 'RAKUTEN_CLIENT_ID';
export const CLIENT_SECRET_ENV_VAR = 'RAKUTEN_CLIENT_SECRET';
export const PUBLISHER_SID_ENV_VAR = 'RAKUTEN_PUBLISHER_SID';

/**
 * The scheme Rakuten documents on the TOKEN request itself.
 *
 * `Bearer` here is deliberate and is Rakuten's documented quirk: conventional
 * OAuth would use `Basic` for a base64 `id:secret`, and Rakuten does not. It is
 * a named constant rather than an inline string precisely because it is the one
 * detail in this file that could not be read from the official page — the
 * documentation host is unreachable from the environment this was written in —
 * so it is the first line to check if the endpoint answers 401 while the
 * credentials are known good.
 */
export const TOKEN_REQUEST_AUTH_SCHEME = 'Bearer';

/** Rakuten's documented grant type for this exchange. */
export const TOKEN_REQUEST_GRANT_TYPE = 'password';

/** Why a token could not be obtained. A closed set, never free text. */
export type TokenFailureCategory =
  /** One of the three credential variables is absent or blank. */
  | 'missing-credentials'
  /** The request never got an HTTP response — DNS, TLS, connection reset. */
  | 'transport'
  /** 401 or 403: the endpoint answered and refused the credentials. */
  | 'rejected'
  /** Any other non-2xx. */
  | 'http-status'
  /** 2xx whose body is not JSON, or carries no usable access_token. */
  | 'malformed-response'
  /** Anything else. A defect in this module rather than a condition. */
  | 'unexpected';

export class AccessTokenError extends Error {
  constructor(
    readonly category: TokenFailureCategory,
    readonly httpStatus: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface TokenCredentials {
  clientId: string;
  clientSecret: string;
  publisherSid: string;
}

/**
 * Reads the three credentials, or throws.
 *
 * The error names the VARIABLES that are missing and never a value — the same
 * rule client.ts follows for the access token. A blank value is treated as
 * absent: an empty credential produces a confusing 401 rather than an obvious
 * misconfiguration.
 */
export function readTokenCredentials(env: NodeJS.ProcessEnv = process.env): TokenCredentials {
  const read = (name: string): string => {
    const raw = env[name];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const clientId = read(CLIENT_ID_ENV_VAR);
  const clientSecret = read(CLIENT_SECRET_ENV_VAR);
  const publisherSid = read(PUBLISHER_SID_ENV_VAR);

  const missing = [
    [CLIENT_ID_ENV_VAR, clientId],
    [CLIENT_SECRET_ENV_VAR, clientSecret],
    [PUBLISHER_SID_ENV_VAR, publisherSid],
  ]
    .filter(([, value]) => value === '')
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new AccessTokenError(
      'missing-credentials',
      null,
      `Missing or blank: ${missing.join(', ')}. These are read from the process environment and must never be supplied through a VITE_-prefixed variable, which Vite would inline into the browser bundle.`,
    );
  }
  return { clientId, clientSecret, publisherSid };
}

/**
 * The Authorization value for the token request.
 *
 * base64("<client id>:<client secret>") behind TOKEN_REQUEST_AUTH_SCHEME. The
 * colon is the separator, so neither half may contain one; that is a property
 * of the credentials Rakuten issues, checked here rather than assumed, because
 * a stray colon would silently shift the split and produce a 401 that looks
 * like a wrong secret.
 */
export function buildAuthorizationValue(clientId: string, clientSecret: string): string {
  if (clientId.includes(':')) {
    throw new AccessTokenError('missing-credentials', null, `${CLIENT_ID_ENV_VAR} contains a colon, which is the credential separator.`);
  }
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf-8').toString('base64');
  return `${TOKEN_REQUEST_AUTH_SCHEME} ${encoded}`;
}

/**
 * The form body. `scope` is the publisher SID.
 *
 * URL-encoded rather than interpolated raw: a SID containing an `&` would
 * otherwise inject a parameter into the request.
 */
export function buildTokenRequestBody(publisherSid: string): string {
  const params = new URLSearchParams();
  params.set('grant_type', TOKEN_REQUEST_GRANT_TYPE);
  params.set('scope', publisherSid);
  return params.toString();
}

/**
 * Pulls the access token out of a token response, structurally.
 *
 * Reads ONE field. `refresh_token`, `expires_in` and anything else the payload
 * carries are ignored rather than stored — a value this job does not need is a
 * value it should not hold. The error never quotes the payload: a malformed
 * response could contain anything, and this runs in CI.
 */
export function extractAccessToken(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AccessTokenError('malformed-response', null, 'Token response is not a JSON object.');
  }
  const token = (payload as Record<string, unknown>).access_token;
  if (typeof token !== 'string') {
    throw new AccessTokenError('malformed-response', null, 'Token response has no string access_token field.');
  }
  if (token.trim() === '') {
    throw new AccessTokenError('malformed-response', null, 'Token response carries an empty access_token.');
  }
  return token.trim();
}

export interface TokenRequestDeps {
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}

/**
 * Requests a fresh access token.
 *
 * The credentials appear in exactly two places: an Authorization header and a
 * form body, both built here and neither ever logged. The return value is the
 * token and nothing else.
 */
export async function requestAccessToken(deps: TokenRequestDeps = {}): Promise<string> {
  const { clientId, clientSecret, publisherSid } = readTokenCredentials(deps.env);
  const doFetch = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationValue(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: buildTokenRequestBody(publisherSid),
    });
  } catch {
    // The cause is deliberately not interpolated: a fetch rejection can carry
    // request details, and this message goes into a CI log.
    throw new AccessTokenError('transport', null, 'The token request never reached an HTTP response.');
  }

  if (!response.ok) {
    // Status only. The body is never read on a failure — an error page is the
    // most likely place for the endpoint to echo something back.
    const category: TokenFailureCategory =
      response.status === 401 || response.status === 403 ? 'rejected' : 'http-status';
    throw new AccessTokenError(
      category,
      response.status,
      category === 'rejected'
        ? `The token endpoint refused the client credentials (HTTP ${response.status}).`
        : `The token endpoint returned HTTP ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccessTokenError('malformed-response', response.status, 'Token response body is not valid JSON.');
  }
  return extractAccessToken(payload);
}
