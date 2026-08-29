import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The snapshot tier has two halves on opposite sides of a boundary: a
// server-only writer that holds a credential, and a browser reader that must
// never be able to. These assertions keep that structural — imports and string
// literals actually present in code, never prose — the same approach
// serverOnly.test.ts takes to the adapter.

import { TRACKED_LINK_HOSTS } from '../../../src/lib/retail/offerSnapshot';

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..', '..');
const srcRoot = path.join(specsmithRoot, 'src');
const readerDir = path.join(srcRoot, 'lib', 'retail');
const read = (p: string) => fs.readFileSync(p, 'utf-8');

const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsOf = (text: string) => [...codeOnly(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
const stringLiteralsOf = (text: string) => [...codeOnly(text).matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]);

const sourcesIn = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, text: read(path.join(dir, f)) }));

const writerFiles = sourcesIn(here);
const readerFiles = sourcesIn(readerDir);

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

describe('the writer is server-only and the reader cannot reach it', () => {
  it('the writer lives outside src/, so Vite never resolves it into a bundle', () => {
    expect(path.relative(specsmithRoot, here).startsWith('scripts')).toBe(true);
  });

  it('nothing under src/ imports the writer or the sweep', () => {
    for (const file of walk(srcRoot)) {
      const offending = importsOf(read(file)).filter((s) => /retail\/snapshot|sweepOffers|write-gpu-offer-snapshot/.test(s));
      expect(offending, `${path.relative(specsmithRoot, file)} must not import the server-only writer`).toEqual([]);
    }
  });

  it('the writer names no credential variable — it borrows the adapter\'s own reader', () => {
    // One place knows the variable's name, and it is the adapter. readAccessToken
    // throws without echoing a value.
    for (const { file, text } of writerFiles) {
      const code = codeOnly(text);
      for (const forbidden of ['RAKUTEN_API_ACCESS_TOKEN', 'RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_PUBLISHER_SID']) {
        expect(code.includes(forbidden), `${file} must not name ${forbidden}`).toBe(false);
      }
      expect(code.includes('import.meta.env'), `${file} must not read import.meta.env`).toBe(false);
    }
    expect(codeOnly(read(path.join(here, 'write-gpu-offer-snapshot.ts')))).toContain('readAccessToken()');
  });

  it('the writer reads no environment variable of its own', () => {
    for (const { file, text } of writerFiles) {
      expect(codeOnly(text).includes('process.env'), `${file} must not read the environment directly`).toBe(false);
    }
  });
});

describe('the reader is browser-safe', () => {
  it('imports nothing from scripts/ and no Node built-in', () => {
    for (const { file, text } of readerFiles) {
      for (const spec of importsOf(text)) {
        expect(spec.includes('scripts/'), `${file} must not import server code`).toBe(false);
        expect(spec.startsWith('node:'), `${file} must not import ${spec}`).toBe(false);
        expect(['fs', 'path', 'os', 'crypto'].includes(spec), `${file} must not import ${spec}`).toBe(false);
      }
    }
  });

  it('touches no environment, no filesystem and no credential', () => {
    for (const { file, text } of readerFiles) {
      const code = codeOnly(text);
      for (const forbidden of ['process.env', 'import.meta.env', 'readFileSync', 'writeFileSync', 'RAKUTEN']) {
        expect(code.includes(forbidden), `${file} must not contain ${forbidden}`).toBe(false);
      }
    }
  });

  it('the schema module is pure — the loader is the only half that fetches', () => {
    const schema = codeOnly(read(path.join(readerDir, 'offerSnapshot.ts')));
    expect(schema.includes('fetch('), 'offerSnapshot.ts must do no I/O').toBe(false);
    expect(schema.includes('Date.now()'), 'offerSnapshot.ts must take the clock from its caller').toBe(false);
  });

  it('both halves validate through the SAME parser', () => {
    // One definition of the shape, run on both sides. A file that would be
    // refused at read time therefore cannot be written.
    const writer = codeOnly(read(path.join(here, 'writeSnapshot.ts')));
    const builder = codeOnly(read(path.join(here, 'buildSnapshot.ts')));
    for (const [name, code] of [['writeSnapshot.ts', writer], ['buildSnapshot.ts', builder]] as const) {
      expect(code, name).toContain('parseOfferSnapshot');
      expect(importsOf(code).some((s) => s.endsWith('src/lib/retail/offerSnapshot')), name).toBe(true);
    }
  });
});

describe('nothing in this tier can claim stock', () => {
  it('no string literal on either side says anything about availability but "unknown"', () => {
    // Comments discuss stock at length — explaining why it is unknown is the
    // point — so this reads the CODE: the values that could reach a page.
    const stockish = /\b(in[- ]?stock|out[- ]?of[- ]?stock|available|availability:\s*true|sold[- ]?out|backorder|ships)\b/i;
    for (const { file, text } of [...writerFiles, ...readerFiles]) {
      for (const literal of stringLiteralsOf(text)) {
        if (literal === 'unknown') continue;
        expect(stockish.test(literal), `${file}: ${JSON.stringify(literal)}`).toBe(false);
      }
    }
  });

  it('the stored offer type has an availability field and it is the unknown literal', () => {
    const schema = read(path.join(readerDir, 'offerSnapshot.ts'));
    expect(schema).toContain("export const AVAILABILITY_UNKNOWN = 'unknown';");
    expect(schema).toContain('availability: typeof AVAILABILITY_UNKNOWN;');
    // Nothing constructs an availability from a listing field.
    const builder = codeOnly(read(path.join(here, 'buildSnapshot.ts')));
    // Every assignment in the builder is the constant. Nothing derives an
    // availability from a listing field, because no listing field says.
    const assigned = [...builder.matchAll(/availability:\s*([A-Za-z_$][\w$.]*)/g)].map((m) => m[1]);
    expect(assigned.length).toBeGreaterThan(0);
    expect([...new Set(assigned)]).toEqual(['AVAILABILITY_UNKNOWN']);
  });
});

describe('the writer writes one file, once, and only that', () => {
  it('only writeSnapshot.ts writes at all', () => {
    for (const { file, text } of writerFiles) {
      if (file === 'writeSnapshot.ts') continue;
      const code = codeOnly(text);
      for (const forbidden of ['writeFileSync', 'appendFileSync', 'renameSync', 'mkdirSync', 'rmSync', 'createWriteStream']) {
        expect(code.includes(forbidden), `${file} must not write — publishing is one module's job`).toBe(false);
      }
    }
  });

  it('its write is a temporary file followed by a rename', () => {
    const code = codeOnly(read(path.join(here, 'writeSnapshot.ts')));
    const writes = [...code.matchAll(/writeFileSync\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    // The target itself is never written directly; only the temp is, and the
    // rename is what makes the swap atomic for a reader mid-fetch.
    expect(writes).toEqual(['temp']);
    expect(code).toContain('fs.renameSync(temp, target)');
    expect(code).toContain('path.dirname(target)');
  });

  it('does not touch the catalogue or any other production data file', () => {
    for (const { file, text } of writerFiles) {
      const code = codeOnly(text);
      expect(code.includes('price_usd'), `${file} must not touch the editorial price field`).toBe(false);
      expect(code.includes('gpus.json'), `${file} must not name the catalogue file`).toBe(false);
      const jsonImports = importsOf(text).filter((s) => s.endsWith('.json'));
      expect(jsonImports, `${file} must not import a data file`).toEqual([]);
    }
  });

  it('publishes outside src/, under the asset directory the loader reads', () => {
    const cli = codeOnly(read(path.join(here, 'write-gpu-offer-snapshot.ts')));
    expect(cli).toContain("path.join(appRoot, 'public', 'data', 'gpu-offers.json')");
    expect(cli.includes("'src'"), 'must not publish into src/, which Vite bundles').toBe(false);
  });

  it('is not wired into any page, component or workflow yet', () => {
    for (const dir of ['pages', 'components']) {
      const full = path.join(srcRoot, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of walk(full)) {
        expect(importsOf(read(file)).filter((s) => /retail\//.test(s)), file).toEqual([]);
      }
    }
    const workflows = path.join(specsmithRoot, '..', '..', '.github', 'workflows');
    for (const wf of fs.readdirSync(workflows)) {
      expect(read(path.join(workflows, wf)).includes('write-gpu-offer-snapshot'), `${wf} must not run the writer yet`).toBe(false);
    }
  });
});

describe('the storage rules do not drift from the admission rules', () => {
  it('the parser allows exactly the hosts the adapter admits a listing under', () => {
    // admitOffer.ts refuses a listing whose <linkurl> is not one of these, and
    // offerSnapshot.ts refuses to store one that is not. Two copies of one
    // rule is a drift risk, so the copies are checked against each other: if
    // the adapter ever learns a third host, this fails until the parser does
    // too, rather than silently discarding every offer from it.
    const admission = read(path.join(specsmithRoot, 'scripts', 'retail', 'rakuten', 'admitOffer.ts'));
    const admitted = /\^https:\\\/\\\/\(click\|www\)\\\.linksynergy\\\.com\\\//;
    expect(admitted.test(admission), 'admitOffer.ts no longer pins the linksynergy hosts as expected').toBe(true);
    expect([...TRACKED_LINK_HOSTS].sort()).toEqual(['click.linksynergy.com', 'www.linksynergy.com']);
  });

  it('both sides refuse a zero retail price', () => {
    const admission = codeOnly(read(path.join(specsmithRoot, 'scripts', 'retail', 'rakuten', 'admitOffer.ts')));
    expect(admission).toContain('price.amount <= 0');
    const schema = codeOnly(read(path.join(readerDir, 'offerSnapshot.ts')));
    expect(schema).toContain('Number.isFinite(v) && v > 0');
  });
});

describe('the writer decides whether to sweep before it sweeps', () => {
  const cli = codeOnly(read(path.join(here, 'write-gpu-offer-snapshot.ts')));

  it('reads the published snapshot before calling the sweep', () => {
    // Order is the point: an unreadable baseline must cost nothing, not a
    // minute of API calls followed by a refusal.
    expect(cli.indexOf('readPublishedSnapshot(')).toBeLessThan(cli.indexOf('await sweepOffers('));
  });

  it('continues on ok and absent only', () => {
    expect(cli).toContain("existing.status !== 'ok' && existing.status !== 'absent'");
    // The baseline is passed on only when it was actually validated.
    expect(cli).toContain("previous: existing.status === 'ok' ? existing.snapshot : null");
  });

  it('hands buildSnapshot the catalogue it read, not the ids the sweep returned', () => {
    // Deriving the expected list from the sweep's own output would make the
    // coverage check compare a list against itself.
    expect(cli).toContain('expectedGpuIds: catalog.map((g) => g.id)');
    expect(/expectedGpuIds:\s*sweep\./.test(cli), 'expected ids must not come from the sweep').toBe(false);
  });
});
