import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This boundary is a promise: UserBenchmark data can exist in production code
// as third-party, crowd-sourced data, and nothing else — never as a
// BenchmarkRecord, never a VerifiedFpsResult, never tier 'measured'. A promise
// nothing checks is a promise that erodes, so these tests check it structurally
// (imports, literal values actually present in code) rather than by reading
// prose — see measured/separation.test.ts's codeOnly() for why that matters:
// a naive text scan for "measured" previously flagged a sentence that merely
// discussed the word.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', '..');
const read = (p: string) => fs.readFileSync(p, 'utf-8');
const listFiles = (dir: string) =>
  fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ file: f, text: read(path.join(dir, f)) }));

const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const importsOf = (text: string) =>
  [...codeOnly(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

/** String literals actually assigned/compared in code, not mentioned in prose. */
const stringLiteralsOf = (text: string) =>
  [...codeOnly(text).matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]);

describe('third-party boundary: cannot be confused with measured or verified data', () => {
  const thirdPartyFiles = listFiles(here).filter((f) => !f.file.endsWith('.test.ts'));
  const benchmarkFiles = listFiles(path.join(srcRoot, 'lib', 'benchmarks')).filter((f) => !f.file.endsWith('.test.ts'));
  const measuredFiles = listFiles(path.join(srcRoot, 'lib', 'measured')).filter((f) => !f.file.endsWith('.test.ts'));

  it('the source-derived (benchmarks) system does not import from thirdParty', () => {
    for (const { file, text } of benchmarkFiles) {
      const offending = importsOf(text).filter((spec) => spec.includes('thirdParty'));
      expect(offending, `${file} must not import from the third-party namespace`).toEqual([]);
    }
  });

  it('the measured system does not import from thirdParty', () => {
    for (const { file, text } of measuredFiles) {
      const offending = importsOf(text).filter((spec) => spec.includes('thirdParty'));
      expect(offending, `${file} must not import from the third-party namespace`).toEqual([]);
    }
  });

  it('thirdParty does not import from the source-derived lookup engine or the measured system', () => {
    // One-way isolation in BOTH directions: this module cannot even read the
    // other tiers' code, let alone merge results with them.
    for (const { file, text } of thirdPartyFiles) {
      const offending = importsOf(text).filter((spec) => /benchmarks\/(lookup|types)$/.test(spec) || spec.includes('/measured/'));
      expect(offending, `${file} must not import from ../benchmarks or ../measured`).toEqual([]);
    }
  });

  it('thirdParty does not import any production data store', () => {
    // No auto-loading of benchmarkRecords.json, measuredObservations.json, or
    // the Estimator's games.json/gpus.json/cpus.json — this module converts
    // rows a caller hands it; it does not go looking for data on its own.
    for (const { file, text } of thirdPartyFiles) {
      const dataImports = importsOf(text).filter((spec) => spec.endsWith('.json'));
      expect(dataImports, `${file} must not import a data store`).toEqual([]);
    }
  });

  it('no production page or component imports thirdParty yet', () => {
    // The explicit "not wired in yet" requirement, checked rather than trusted.
    for (const dir of ['pages', 'components']) {
      const full = path.join(srcRoot, dir);
      if (!fs.existsSync(full)) continue;
      const walk = (d: string): string[] =>
        fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const p = path.join(d, e.name);
          if (e.isDirectory()) return walk(p);
          return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
        });
      for (const file of walk(full)) {
        const offending = importsOf(read(file)).filter((spec) => spec.includes('thirdParty'));
        expect(offending, `${path.relative(srcRoot, file)} must not import thirdParty — not wired into production UI yet`).toEqual([]);
      }
    }
  });

  it('never assigns the literal tier value "measured" or the ResultState "MEASURED"', () => {
    for (const { file, text } of thirdPartyFiles) {
      const literals = stringLiteralsOf(text);
      expect(literals, `${file} must never carry the literal "measured"`).not.toContain('measured');
      expect(literals, `${file} must never carry the literal "MEASURED"`).not.toContain('MEASURED');
    }
  });

  it('the tier is fixed to the one distinct literal, defined in exactly one place', () => {
    const definers = thirdPartyFiles.filter(({ text }) => stringLiteralsOf(text).includes('third-party-crowd-sourced'));
    expect(definers.map((d) => d.file).sort()).toEqual(['types.ts']);
  });

  it('no thirdParty CODE (not doc comments) references BenchmarkRecord, VerifiedFpsResult, or MeasuredObservation', () => {
    // Scoped to codeOnly() deliberately: types.ts's own doc comment explains
    // the architecture by NAME ("NOT a BenchmarkRecord...") — that is exactly
    // the legitimate documentation this boundary depends on a reader seeing,
    // not a structural violation. Checking raw text here would repeat the
    // "vocabulary vs structure" mistake documented at the top of this file.
    for (const { file, text } of thirdPartyFiles) {
      const code = codeOnly(text);
      for (const forbidden of ['BenchmarkRecord', 'VerifiedFpsResult', 'MeasuredObservation']) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden} in actual code`).toBe(false);
      }
    }
  });

  it('stays browser-safe: no node-only imports', () => {
    for (const { file, text } of thirdPartyFiles) {
      const nodeImports = importsOf(text).filter((spec) => spec.startsWith('node:'));
      expect(nodeImports, `${file} must stay browser-safe`).toEqual([]);
    }
  });
});
