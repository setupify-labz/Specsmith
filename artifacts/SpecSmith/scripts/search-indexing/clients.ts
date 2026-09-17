import { createSign } from 'node:crypto';
import type { InspectionSummary, SearchMetric } from './core';

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export async function googleAccessToken(
  credentials: GoogleServiceAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!credentials.client_email || !credentials.private_key) throw new Error('Invalid Google service-account JSON.');
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${base64url(signer.sign(credentials.private_key))}`;
  const response = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth failed with HTTP ${response.status}.`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('Google OAuth returned no access token.');
  return body.access_token;
}

async function googleJson<T>(url: string, token: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Google Search Console request failed with HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function googlePageMetrics(
  siteUrl: string,
  token: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, SearchMetric>> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const result = await googleJson<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> }>(
    endpoint,
    token,
    { startDate, endDate, dimensions: ['page'], rowLimit: 25_000, dataState: 'final' },
    fetchImpl,
  );
  return new Map((result.rows ?? []).map((row) => [row.keys[0], {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  }]));
}

export async function inspectGoogleUrl(
  siteUrl: string,
  inspectionUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InspectionSummary> {
  const result = await googleJson<{
    inspectionResult?: {
      inspectionResultLink?: string;
      indexStatusResult?: Record<string, string>;
    };
  }>('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', token, {
    inspectionUrl,
    siteUrl,
    languageCode: 'en-US',
  }, fetchImpl);
  const status = result.inspectionResult?.indexStatusResult ?? {};
  return {
    url: inspectionUrl,
    verdict: status.verdict ?? 'UNKNOWN',
    coverageState: status.coverageState ?? 'Unknown',
    indexingState: status.indexingState ?? 'UNKNOWN',
    pageFetchState: status.pageFetchState ?? 'UNKNOWN',
    robotsTxtState: status.robotsTxtState ?? 'UNKNOWN',
    userCanonical: status.userCanonical,
    googleCanonical: status.googleCanonical,
    lastCrawlTime: status.lastCrawlTime,
    inspectionLink: result.inspectionResult?.inspectionResultLink,
  };
}

export async function bingRead(
  method: 'GetCrawlStats' | 'GetQueryStats' | 'GetPageStats' | 'GetFeeds' | 'GetUrlSubmissionQuota',
  siteUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const endpoint = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
  endpoint.searchParams.set('siteUrl', siteUrl);
  endpoint.searchParams.set('apikey', apiKey);
  let response: Response;
  try {
    response = await fetchImpl(endpoint);
  } catch {
    throw new Error(`Bing Webmaster ${method} request could not be completed.`);
  }
  if (!response.ok) throw new Error(`Bing Webmaster ${method} failed with HTTP ${response.status}.`);
  return response.json();
}
