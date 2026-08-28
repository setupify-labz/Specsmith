import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This tool MEASURES. The value of running it before building anything is that
// its answer decides whether a storage layer is worth having — so a version of
// it that also wrote one would have prejudged the question it was run to
// settle. These assertions keep that true structurally.

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..', '..');
const read = (p: string) => fs.readFileSync(p, 'utf-8');
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsOf = (text: string) => [...codeOnly(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const sourceFiles = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: read(path.join(here, f)) }));

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

describe('the coverage tool measures and nothing else', () => {
  it('writes nothing, anywhere', () => {
    for (const { file, text } of sourceFiles) {
      const code = codeOnly(text);
      for (const forbidden of ['writeFileSync', 'writeFile', 'appendFile', 'mkdirSync', 'rmSync', 'unlinkSync', 'createWriteStream']) {
        expect(code.includes(forbidden), `${file} must not write — this command is measurement only`).toBe(false);
      }
    }
  });

  it('reads no production data store, only the GPU catalog through the adapter', () => {
    for (const { file, text } of sourceFiles) {
      const jsonImports = importsOf(text).filter((s) => s.endsWith('.json'));
      expect(jsonImports, `${file} must not import a data file directly`).toEqual([]);
      expect(codeOnly(text).includes('readFileSync'), `${file} must not read files itself`).toBe(false);
    }
  });

  it('stays server-only: nothing under src/ can reach it', () => {
    for (const file of walk(path.join(specsmithRoot, 'src'))) {
      const offending = importsOf(read(file)).filter((s) => /retail\/coverage|measure-coverage/.test(s));
      expect(offending, `${path.relative(specsmithRoot, file)} must not import the coverage tool`).toEqual([]);
    }
  });

  it('reads the environment only through the adapter\'s own token reader', () => {
    // No second place that knows the variable's name, and no place that could
    // print it: readAccessToken throws without echoing a value.
    for (const { file, text } of sourceFiles) {
      expect(codeOnly(text).includes('RAKUTEN_API_ACCESS_TOKEN'), `${file} must not name the token variable`).toBe(false);
      expect(codeOnly(text).includes('import.meta.env'), `${file} must not read import.meta.env`).toBe(false);
    }
    expect(codeOnly(read(path.join(here, 'measure-coverage.ts')))).toContain('readAccessToken()');
  });

  it('carries no field able to hold a URL or an identifier', () => {
    // The redaction guarantee is a shape, not a filter: GpuCoverage holds ids,
    // names and counts, and there is nowhere for a tracked link to live.
    const report = codeOnly(read(path.join(here, 'coverageReport.ts')));
    for (const forbidden of ['trackedAffiliateUrl', 'imageUrl', 'linkurl', 'sku', 'upc']) {
      expect(report.includes(forbidden), `coverageReport.ts must not carry ${forbidden}`).toBe(false);
    }
  });

  it('does not modify the adapter it measures', () => {
    // Instrumentation goes through deps.fetch, which the adapter already
    // accepts, so the thing being measured stays exactly as merged.
    for (const { file, text } of sourceFiles) {
      const reachesIntoAdapter = importsOf(text).filter((s) => s.includes('../rakuten/') && !s.endsWith('/types'));
      expect(reachesIntoAdapter, `${file} should use the adapter's public entry point`).toEqual([]);
    }
  });
});
