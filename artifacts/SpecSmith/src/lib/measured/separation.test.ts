import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The four tiers — measured, community, source-derived, estimated — are kept
// strictly separate. That separation is an architectural promise, and a promise
// nothing checks is a promise that erodes. These tests are the check.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', '..');
const read = (p: string) => fs.readFileSync(p, 'utf-8');
const listFiles = (dir: string) =>
  fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ file: f, text: read(path.join(dir, f)) }));

/**
 * Strips comments before checking dependencies.
 *
 * These tests must inspect what the code DOES, not what it talks about. The
 * first version matched the bare word "measured" and flagged lookup.ts for the
 * sentence "that game's measured data is reachable only from…" — prose, not a
 * dependency. Scanning vocabulary instead of structure produces exactly that
 * kind of false positive, and a guard that cries wolf gets switched off.
 */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Module specifiers actually imported by a file. */
const importsOf = (text: string) =>
  [...codeOnly(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('tier separation', () => {
  const measuredFiles = listFiles(here).filter((f) => !f.file.endsWith('.test.ts'));
  const benchmarkFiles = listFiles(path.join(srcRoot, 'lib', 'benchmarks')).filter((f) => !f.file.endsWith('.test.ts'));

  it('the measured system does not import the source-derived lookup engine', () => {
    // Importing lookup.ts would be the first step toward returning a mixed
    // result set. Types are shared deliberately; the engine is not.
    for (const { file, text } of measuredFiles) {
      const offending = importsOf(text).filter((spec) => /benchmarks\/lookup$/.test(spec));
      expect(offending, `${file} must not import the source-derived lookup engine`).toEqual([]);
    }
  });

  it('the source-derived system does not know the measured system exists', () => {
    // One-way dependency. The existing engine must keep behaving exactly as it
    // did before this system was added.
    for (const { file, text } of benchmarkFiles) {
      const offending = importsOf(text).filter((spec) => spec.includes('measured'));
      expect(offending, `${file} must not import from the measured system`).toEqual([]);
    }
  });

  it('the measured system does not read the source-derived or estimated data files', () => {
    for (const { file, text } of measuredFiles) {
      const dataImports = importsOf(text).filter((spec) => spec.endsWith('.json'));
      expect(dataImports, `${file} must not import any data store — the tiers are loaded separately`).toEqual([]);
    }
  });

  it('measured observations live in their own store file', () => {
    const store = JSON.parse(read(path.join(srcRoot, 'data', 'measuredObservations.json')));
    expect(Array.isArray(store.observations)).toBe(true);
    expect(store.schemaVersion).toBe(1);
    // Separate file from benchmarkRecords.json, which stays untouched.
    expect(fs.existsSync(path.join(srcRoot, 'data', 'benchmarkRecords.json'))).toBe(true);
  });

  it('the measured store ships empty in V1 — schema and validation first', () => {
    const store = JSON.parse(read(path.join(srcRoot, 'data', 'measuredObservations.json')));
    expect(store.observations).toEqual([]);
  });

  it('no measured code imports node-only modules, which would break the browser bundle', () => {
    // The fs/zlib/crypto half deliberately lives in scripts/measured, outside
    // anything Vite bundles.
    for (const { file, text } of measuredFiles) {
      const nodeImports = importsOf(text).filter((spec) => spec.startsWith('node:'));
      expect(nodeImports, `${file} must stay browser-safe`).toEqual([]);
    }
  });
});
