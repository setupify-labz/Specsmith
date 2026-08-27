import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES_DIR, FixturePathError, resolveFixturePath } from './capture-fixture';

// EXECUTABLE confinement tests.
//
// The previous version of this check asserted that capture-fixture.ts's SOURCE
// contained the string `path.join(fixturesDir, out)` — a test of how the code
// is spelled, not of what it does, and worse, of a call that confines nothing:
// path.join normalizes "../../../src/overwrite.ts" straight out of the
// directory. These run the resolver instead.

describe('resolveFixturePath confines output to __fixtures__', () => {
  it('accepts a plain .xml filename and resolves it into the fixtures directory', () => {
    const resolved = resolveFixturePath('newegg-rtx4070-live.xml');
    expect(path.dirname(resolved)).toBe(path.resolve(FIXTURES_DIR));
    expect(path.basename(resolved)).toBe('newegg-rtx4070-live.xml');
  });

  it.each([
    ['../../../src/overwrite.ts', 'directory traversal to a source file'],
    ['../../../src/overwrite.xml', 'traversal that keeps the .xml extension'],
    ['../newegg.xml', 'one level up'],
    ['./newegg.xml', 'an explicit relative prefix'],
    ['sub/newegg.xml', 'a subdirectory'],
    ['sub\\newegg.xml', 'a backslash separator'],
    ['..', 'the parent directory'],
    ['.', 'the current directory'],
    ['', 'an empty name'],
    ['   ', 'whitespace only'],
    ['.hidden.xml', 'a dotfile'],
    ['newegg.ts', 'a TypeScript file'],
    ['newegg.xml.ts', 'an extension that only looks like .xml'],
    ['newegg', 'no extension'],
    ['package.json', 'a config file'],
  ])('refuses %j (%s)', (out) => {
    expect(() => resolveFixturePath(out)).toThrow(FixturePathError);
  });

  it('refuses an absolute path', () => {
    const absolute = path.join(os.tmpdir(), 'evil.xml');
    expect(() => resolveFixturePath(absolute)).toThrow(FixturePathError);
  });

  it('the traversal it refuses would otherwise have escaped — path.join does not confine', () => {
    // The point of the resolver, demonstrated: this is what the old code did.
    const escaped = path.join(FIXTURES_DIR, '../../../src/overwrite.ts');
    expect(path.resolve(escaped).startsWith(path.resolve(FIXTURES_DIR))).toBe(false);
    expect(path.resolve(escaped)).toContain(`${path.sep}src${path.sep}`);
    expect(() => resolveFixturePath('../../../src/overwrite.ts')).toThrow(/path separator/);
  });

  it('refuses a sibling directory whose name merely starts with __fixtures__', () => {
    // A prefix comparison would accept this; comparing resolved parents does not.
    const sibling = `${path.resolve(FIXTURES_DIR)}-evil`;
    expect(() => resolveFixturePath('newegg.xml', sibling)).not.toThrow();
    expect(path.dirname(resolveFixturePath('newegg.xml', sibling))).toBe(sibling);
    // ...and from the real directory, no name reaches that sibling.
    expect(() => resolveFixturePath('../__fixtures__-evil/newegg.xml')).toThrow(FixturePathError);
  });

  it('resolves against a caller-supplied directory, and still confines to it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-confine-'));
    try {
      expect(path.dirname(resolveFixturePath('a.xml', tmp))).toBe(tmp);
      expect(() => resolveFixturePath('../a.xml', tmp)).toThrow(FixturePathError);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('every refusal explains itself without echoing a path the caller cannot see', () => {
    expect(() => resolveFixturePath('sub/newegg.xml')).toThrow(/path separator/);
    expect(() => resolveFixturePath('newegg.ts')).toThrow(/must end in \.xml/);
    expect(() => resolveFixturePath('..')).toThrow(/names a directory/);
  });
});
