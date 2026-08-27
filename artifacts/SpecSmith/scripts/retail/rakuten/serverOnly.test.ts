import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The server-only boundary is a promise, and a promise nothing checks is a
// promise that erodes — the same reasoning as
// src/lib/thirdParty/separation.test.ts, applied to a credential instead of a
// data tier. Everything here is structural: imports and string literals
// actually present in code, never prose.

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..', '..');
const srcRoot = path.join(specsmithRoot, 'src');
const read = (p: string) => fs.readFileSync(p, 'utf-8');

import { unredactedIdentifiers } from './redactFixture';

const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsOf = (text: string) => [...codeOnly(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const adapterFiles = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: read(path.join(here, f)) }));
const adapterSource = adapterFiles.filter((f) => !f.file.endsWith('.test.ts'));

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

describe('the Rakuten adapter is server-only', () => {
  it('lives outside src/, so Vite never resolves it into a browser bundle', () => {
    expect(path.relative(specsmithRoot, here).startsWith('scripts')).toBe(true);
  });

  it('no file under src/ imports the adapter', () => {
    for (const file of walk(srcRoot)) {
      const offending = importsOf(read(file)).filter((s) => /retail\/rakuten|scripts\/retail/.test(s));
      expect(offending, `${path.relative(specsmithRoot, file)} must not import the server-only Rakuten adapter`).toEqual([]);
    }
  });

  it('no file under src/ mentions the access token variable at all', () => {
    for (const file of walk(srcRoot)) {
      expect(read(file).includes('RAKUTEN'), `${path.relative(specsmithRoot, file)} must not reference RAKUTEN_*`).toBe(false);
    }
  });

  it('the adapter never reads import.meta.env, which Vite inlines into shipped JavaScript', () => {
    // Source only: this test file necessarily names the string it forbids.
    for (const { file, text } of adapterSource) {
      expect(codeOnly(text).includes('import.meta.env'), `${file} must read process.env, not import.meta.env`).toBe(false);
    }
  });

  it('a VITE_-prefixed token name appears nowhere except the tests that prove it is refused', () => {
    for (const { file, text } of adapterSource) {
      expect(codeOnly(text).includes('VITE_RAKUTEN'), `${file} must not name a VITE_ token variable`).toBe(false);
    }
  });

  it('only client.ts reads the environment', () => {
    const readers = adapterSource.filter(({ text }) => /\bprocess\.env\b/.test(codeOnly(text))).map((f) => f.file);
    expect(readers).toEqual(['client.ts']);
  });

  it('the token never reaches a URL — only an Authorization header', () => {
    const client = codeOnly(read(path.join(here, 'client.ts')));
    expect(client).toContain('Authorization: `Bearer ${token}`');
    expect(/searchParams\.set\([^)]*token/i.test(client), 'token must never be a query parameter').toBe(false);
  });

  it('no library module writes to disk — only the capture CLI does', () => {
    // capture-fixture.ts is a developer command whose entire job is to write a
    // fixture, so it is exempt. Nothing that can be imported into a pipeline
    // is: the adapter reads a feed and returns records, and a module that can
    // also write is a module that can write somewhere unexpected.
    for (const { file, text } of adapterSource) {
      if (file === 'capture-fixture.ts') continue;
      expect(codeOnly(text).includes('writeFileSync'), `${file} must not write`).toBe(false);
    }
  });

  it('the capture CLI writes only to a path the resolver approved', () => {
    // Structural only in the narrow sense that matters: the single write must
    // take the resolver's output. WHERE that output can point is settled by
    // running the resolver — see capturePath.test.ts — not by reading source.
    const capture = codeOnly(read(path.join(here, 'capture-fixture.ts')));
    const writes = [...capture.matchAll(/writeFileSync\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(writes).toEqual(['file']);
    expect(capture).toMatch(/file = resolveFixturePath\(out\)/);
  });

  it('no fixture contains anything token-shaped or an unredacted publisher id', () => {
    // The identifier check itself lives in redactFixture.ts and is exercised
    // against a live-shaped string in liveShape.test.ts, so "redacted" means
    // the same thing to the capture script and to this assertion.
    const dir = path.join(here, '__fixtures__');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.xml'))) {
      const text = read(path.join(dir, f));
      expect(/bearer/i.test(text), `${f} must contain no bearer token`).toBe(false);
      expect(/\btoken\b/i.test(text), `${f} must contain no token`).toBe(false);
      expect(unredactedIdentifiers(text), `${f} has unredacted publisher identifiers`).toEqual([]);
    }
  });
});

describe('the Rakuten adapter does not duplicate an existing SpecSmith system', () => {
  it('does not write catalog prices — gpus.json stays the editorial estimate', () => {
    for (const { file, text } of adapterSource) {
      expect(codeOnly(text).includes('price_usd'), `${file} must not touch the catalog's editorial price field`).toBe(false);
    }
  });

  it('reuses buildPartQuery from src/lib/fps rather than re-deriving retailer search terms', () => {
    const index = read(path.join(here, 'index.ts'));
    expect(importsOf(index)).toContain('../../../src/lib/fps');
    expect(codeOnly(index)).toContain('buildPartQuery');
  });

  it('does not import the research-only UserBenchmark normalizer, whose rules are the opposite of these', () => {
    // hardware-normalize.mjs deliberately erases VRAM size and treats
    // Ti/Super as spelling variants. Correct for a benchmark row, wrong for a
    // price. The two must not be merged; see gpuModelMatch.ts's header.
    for (const { file, text } of adapterFiles) {
      const offending = importsOf(text).filter((s) => s.includes('hardware-normalize') || s.includes('research/'));
      expect(offending, `${file} must not import the research normalizer`).toEqual([]);
    }
  });

  it('does not reach into the benchmark, measured, or third-party namespaces', () => {
    for (const { file, text } of adapterFiles) {
      const offending = importsOf(text).filter((s) => /\/(benchmarks|measured|thirdParty)\//.test(s));
      expect(offending, `${file} must not import another data tier`).toEqual([]);
    }
  });

  it('keeps affiliate tracking in the URL Rakuten supplies — it defines no affiliate id of its own', () => {
    for (const { file, text } of adapterSource) {
      const code = codeOnly(text);
      expect(code.includes('AMAZON_AFFILIATE_TAG'), `${file}`).toBe(false);
      expect(code.includes('NEWEGG_AFFILIATE_ID'), `${file}`).toBe(false);
      expect(code.includes('getNeweggUrl'), `${file} must not rebuild the on-site search link`).toBe(false);
    }
  });

  it('is not wired into any production page or component yet', () => {
    for (const dir of ['pages', 'components']) {
      const full = path.join(srcRoot, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of walk(full)) {
        expect(importsOf(read(file)).filter((s) => s.includes('rakuten'))).toEqual([]);
      }
    }
  });
});
