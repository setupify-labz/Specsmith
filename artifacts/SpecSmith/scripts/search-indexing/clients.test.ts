import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { bingRead, googleAccessToken, googlePageMetrics, inspectGoogleUrl } from './clients';

describe('search platform clients', () => {
  it('mints a Google token without exposing the private key in the request URL', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://oauth2.googleapis.com/token');
      expect(String(input)).not.toContain('PRIVATE');
      expect(String(init?.body)).toContain('assertion=');
      return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(googleAccessToken({
      client_email: 'bot@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, fetchImpl)).resolves.toBe('token');
  });

  it('normalizes Google page metrics and inspection status', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ keys: ['https://specsmithpc.com/'], clicks: 2, impressions: 10, ctr: 0.2, position: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ inspectionResult: { inspectionResultLink: 'https://search.google.com/test', indexStatusResult: { verdict: 'PASS', coverageState: 'Indexed', indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL', robotsTxtState: 'ALLOWED' } } }), { status: 200 })) as unknown as typeof fetch;
    const metrics = await googlePageMetrics('sc-domain:specsmithpc.com', 'token', '2026-08-01', '2026-08-28', fetchImpl);
    expect(metrics.get('https://specsmithpc.com/')?.impressions).toBe(10);
    await expect(inspectGoogleUrl('sc-domain:specsmithpc.com', 'https://specsmithpc.com/', 'token', fetchImpl)).resolves.toMatchObject({ verdict: 'PASS' });
  });

  it('does not include the Bing API key in thrown errors', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    await expect(bingRead('GetCrawlStats', 'https://specsmithpc.com', 'super-secret', fetchImpl))
      .rejects.not.toThrow('super-secret');
  });
});
