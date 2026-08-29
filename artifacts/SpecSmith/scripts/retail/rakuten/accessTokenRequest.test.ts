import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AccessTokenError,
  buildAuthorizationValue,
  buildTokenRequestBody,
  CLIENT_ID_ENV_VAR,
  CLIENT_SECRET_ENV_VAR,
  extractAccessToken,
  PUBLISHER_SID_ENV_VAR,
  readTokenCredentials,
  requestAccessToken,
  TOKEN_ENDPOINT,
  TOKEN_REQUEST_AUTH_SCHEME,
  TOKEN_REQUEST_GRANT_TYPE,
} from './accessTokenRequest';
import { main, maskCommand, resolveTokenOutputPath, sanitizedFailureLine, TokenOutputPathError } from './request-access-token';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret-not-real';
const SID = '1234567';
const TOKEN = 'test-access-token-not-real';

const env = {
  [CLIENT_ID_ENV_VAR]: CLIENT_ID,
  [CLIENT_SECRET_ENV_VAR]: CLIENT_SECRET,
  [PUBLISHER_SID_ENV_VAR]: SID,
} as NodeJS.ProcessEnv;

const jsonResponse = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;

describe('the token request is shaped the way Rakuten documents', () => {
  it('posts a form body to the documented endpoint', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const capture = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ access_token: TOKEN }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await requestAccessToken({ env, fetch: capture });

    expect(seen.url).toBe(TOKEN_ENDPOINT);
    expect(seen.init!.method).toBe('POST');
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Credentials are in the header and the body, never in the URL.
    expect(seen.url).not.toContain(CLIENT_ID);
    expect(seen.url).not.toContain(CLIENT_SECRET);
    expect(seen.url).not.toContain(SID);
    expect(seen.url).not.toContain('?');
  });

  it('builds the authorization value from base64(client id:client secret)', () => {
    const value = buildAuthorizationValue(CLIENT_ID, CLIENT_SECRET);
    const [scheme, encoded] = value.split(' ');
    expect(scheme).toBe(TOKEN_REQUEST_AUTH_SCHEME);
    expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(`${CLIENT_ID}:${CLIENT_SECRET}`);
    // The raw secret never appears in the header value itself.
    expect(value).not.toContain(CLIENT_SECRET);
  });

  it('refuses a client id containing the credential separator', () => {
    // A colon in the id would shift the split and produce a 401 that looks
    // like a wrong secret.
    expect(() => buildAuthorizationValue('has:colon', CLIENT_SECRET)).toThrow(AccessTokenError);
  });

  it('sends grant_type=password with scope set to the publisher SID', () => {
    const body = buildTokenRequestBody(SID);
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe(TOKEN_REQUEST_GRANT_TYPE);
    expect(TOKEN_REQUEST_GRANT_TYPE).toBe('password');
    expect(params.get('scope')).toBe(SID);
    expect([...params.keys()].sort()).toEqual(['grant_type', 'scope']);
  });

  it('url-encodes the SID so it cannot inject a parameter', () => {
    const params = new URLSearchParams(buildTokenRequestBody('7&grant_type=evil'));
    expect(params.get('scope')).toBe('7&grant_type=evil');
    expect(params.get('grant_type')).toBe('password');
  });
});

describe('only access_token is read out of the response', () => {
  it('returns the token', async () => {
    await expect(requestAccessToken({ env, fetch: jsonResponse({ access_token: TOKEN }) })).resolves.toBe(TOKEN);
  });

  it('ignores refresh_token, expires_in and everything else', async () => {
    // A value this job does not need is a value it should not hold.
    const token = await requestAccessToken({
      env,
      fetch: jsonResponse({ access_token: TOKEN, refresh_token: 'must-not-be-used', expires_in: 14400, scope: SID }),
    });
    expect(token).toBe(TOKEN);
  });

  it('rejects a payload that is not an object', () => {
    for (const bad of [null, 42, 'a string', ['array']]) {
      expect(() => extractAccessToken(bad), String(bad)).toThrow(/not a JSON object/);
    }
  });

  it('rejects a missing, non-string or blank access_token', () => {
    expect(() => extractAccessToken({})).toThrow(/no string access_token/);
    expect(() => extractAccessToken({ access_token: 123 })).toThrow(/no string access_token/);
    expect(() => extractAccessToken({ access_token: '   ' })).toThrow(/empty access_token/);
  });

  it('never quotes the payload in the error', () => {
    // A malformed response could contain anything, and this runs in CI.
    try {
      extractAccessToken({ error_description: 'secret-ish detail', access_token: null });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-ish detail');
    }
  });
});

describe('failures are closed categories, never credentials or response bodies', () => {
  const categoryOf = async (fetchImpl: typeof globalThis.fetch): Promise<AccessTokenError> => {
    try {
      await requestAccessToken({ env, fetch: fetchImpl });
      throw new Error('expected a failure');
    } catch (e) {
      expect(e).toBeInstanceOf(AccessTokenError);
      return e as AccessTokenError;
    }
  };

  it('classifies a refusal distinctly from any other HTTP status', async () => {
    for (const status of [401, 403]) {
      const err = await categoryOf(jsonResponse({ error: 'invalid_client' }, status));
      expect(err.category).toBe('rejected');
      expect(err.httpStatus).toBe(status);
    }
    const other = await categoryOf(jsonResponse({}, 500));
    expect(other.category).toBe('http-status');
    expect(other.httpStatus).toBe(500);
  });

  it('never reads or quotes the body of a failed response', async () => {
    const leaky = (async () =>
      new Response('invalid_client: secret-ish detail https://evil.invalid/?t=abc', { status: 401 })) as unknown as typeof globalThis.fetch;
    const err = await categoryOf(leaky);
    expect(err.message).not.toContain('secret-ish detail');
    expect(err.message).not.toMatch(/https?:\/\//);
  });

  it('classifies a transport failure without quoting the cause', async () => {
    const boom = (async () => {
      throw new Error(`ECONNRESET while sending ${CLIENT_SECRET}`);
    }) as unknown as typeof globalThis.fetch;
    const err = await categoryOf(boom);
    expect(err.category).toBe('transport');
    expect(err.message).not.toContain(CLIENT_SECRET);
  });

  it('classifies a non-JSON 200 as malformed', async () => {
    const html = (async () => new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof globalThis.fetch;
    const err = await categoryOf(html);
    expect(err.category).toBe('malformed-response');
    expect(err.message).not.toContain('maintenance');
  });

  it('names missing credential VARIABLES and never a value', () => {
    const err = (() => {
      try {
        readTokenCredentials({ [CLIENT_ID_ENV_VAR]: CLIENT_ID } as NodeJS.ProcessEnv);
        throw new Error('expected a failure');
      } catch (e) {
        return e as AccessTokenError;
      }
    })();
    expect(err.category).toBe('missing-credentials');
    expect(err.message).toContain(CLIENT_SECRET_ENV_VAR);
    expect(err.message).toContain(PUBLISHER_SID_ENV_VAR);
    expect(err.message).not.toContain(CLIENT_ID);
  });

  it('treats a blank credential as absent', () => {
    expect(() => readTokenCredentials({ ...env, [CLIENT_SECRET_ENV_VAR]: '   ' } as NodeJS.ProcessEnv)).toThrow(
      new RegExp(CLIENT_SECRET_ENV_VAR),
    );
  });

  it('reduces every failure to one sanitized line naming a category', () => {
    const line = sanitizedFailureLine(new AccessTokenError('rejected', 401, 'The token endpoint refused the client credentials (HTTP 401).'));
    expect(line).toContain('[rejected]');
    expect(line).toContain('HTTP 401');
    expect(sanitizedFailureLine(new Error(`boom ${CLIENT_SECRET}`))).toBe('Access token request failed [unexpected].');
    expect(sanitizedFailureLine('a bare string')).not.toContain('bare string');
  });
});

describe('the CLI masks the token and keeps it out of the checkout', () => {
  const withTempDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rakuten-token-'));
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('prints the mask command and nothing else, then writes the token', async () => {
    await withTempDir(async (dir) => {
      const out = path.join(dir, 'token');
      const logged: string[] = [];
      const code = await main(['--out', out], {
        env,
        fetch: jsonResponse({ access_token: TOKEN }),
        log: (l) => logged.push(l),
        error: (l) => logged.push(l),
      });

      expect(code).toBe(0);
      // Exactly one line, and it is the mask. Anything else printed alongside
      // a credential is a line that could carry it.
      expect(logged).toEqual([maskCommand(TOKEN)]);
      expect(fs.readFileSync(out, 'utf-8')).toBe(TOKEN);
    });
  });

  it('writes the token file owner-readable only', async () => {
    await withTempDir(async (dir) => {
      const out = path.join(dir, 'token');
      await main(['--out', out], { env, fetch: jsonResponse({ access_token: TOKEN }), log: () => {}, error: () => {} });
      expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    });
  });

  it('prints no credential on failure, and writes no file', async () => {
    await withTempDir(async (dir) => {
      const out = path.join(dir, 'token');
      const logged: string[] = [];
      const code = await main(['--out', out], {
        env,
        fetch: jsonResponse({ error: 'invalid_client' }, 401),
        log: (l) => logged.push(l),
        error: (l) => logged.push(l),
      });

      expect(code).toBe(1);
      expect(fs.existsSync(out)).toBe(false);
      const all = logged.join('\n');
      expect(all).toContain('[rejected]');
      expect(all).toContain('HTTP 401');
      for (const secret of [CLIENT_ID, CLIENT_SECRET, SID, TOKEN]) {
        expect(all, secret).not.toContain(secret);
      }
      expect(all).not.toContain('::add-mask::');
    });
  });

  it('refuses an --out path inside the repository', () => {
    // A credential written into the checkout could be committed by a later
    // step or picked up by a build.
    const root = path.resolve('/tmp/fake-repo');
    expect(() => resolveTokenOutputPath(path.join(root, 'token'), root)).toThrow(TokenOutputPathError);
    expect(() => resolveTokenOutputPath(path.join(root, 'src', 'data', 'token.json'), root)).toThrow(/inside the repository/);
    expect(() => resolveTokenOutputPath(root, root)).toThrow(TokenOutputPathError);
    // A sibling directory whose name merely starts with the root is fine.
    expect(() => resolveTokenOutputPath(`${root}-tmp/token`, root)).not.toThrow();
  });

  it('requires an absolute --out', () => {
    expect(() => resolveTokenOutputPath('token', '/tmp/fake-repo')).toThrow(/absolute/);
    expect(() => resolveTokenOutputPath('', '/tmp/fake-repo')).toThrow(/required/);
  });
});
