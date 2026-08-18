// Deduplication and conflict-detection tests.
//
// The property that matters: duplicates collapse, conflicts NEVER do.

import { describe, it, assert } from './harness.mjs';
import { dedupe, findDuplicateSourcePages } from '../lib/dedupe.mjs';

const rec = (key, fps, sourceFile, rawId = 'x') => ({
  observationKey: key,
  fps,
  provenance: { sourceFile, rawSourceIdentifier: rawId },
});

describe('Dedupe: identical records', () => {
  it('collapses an exact duplicate and records it', () => {
    const r = dedupe([rec('a', 100, 'f1.html'), rec('a', 100, 'f2.html')], ['fps']);
    assert.equal(r.unique.length, 1, 'one survivor');
    assert.equal(r.duplicates.length, 1, 'the extra copy is recorded, not silently dropped');
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.duplicates[0].observationKey, 'a');
    assert.equal(r.duplicates[0].duplicateOf.sourceFile, 'f1.html', 'points at the survivor');
  });

  it('leaves distinct keys untouched', () => {
    const r = dedupe([rec('a', 100, 'f'), rec('b', 200, 'f'), rec('c', 300, 'f')], ['fps']);
    assert.equal(r.unique.length, 3);
    assert.equal(r.duplicates.length, 0);
    assert.equal(r.conflicts.length, 0);
  });

  it('collapses three identical copies into one plus two duplicates', () => {
    const r = dedupe([rec('a', 5, 'f1'), rec('a', 5, 'f2'), rec('a', 5, 'f3')], ['fps']);
    assert.equal(r.unique.length, 1);
    assert.equal(r.duplicates.length, 2);
  });
});

describe('Dedupe: conflicts are never collapsed', () => {
  it('keeps both variants when the same key carries different values', () => {
    const r = dedupe([rec('a', 100, 'f1.html'), rec('a', 117, 'f2.html')], ['fps']);
    assert.equal(r.conflicts.length, 1, 'a conflict is raised');
    assert.equal(r.duplicates.length, 0, 'a conflict is not a duplicate');
    assert.equal(r.unique.length, 2, 'BOTH variants survive — no winner is chosen');
    for (const u of r.unique) assert.equal(u.quality, 'conflicting', 'survivors are flagged');
  });

  it('records every variant with its own sources', () => {
    const r = dedupe([rec('a', 100, 'f1'), rec('a', 117, 'f2'), rec('a', 100, 'f3')], ['fps']);
    const c = r.conflicts[0];
    assert.equal(c.variantCount, 2, 'two distinct values');
    const byOcc = c.variants.map((v) => v.occurrences).sort();
    assert.deepEqual(byOcc, [1, 2], 'the 100-value variant occurred twice');
  });

  it('does not merge records merely because values look similar', () => {
    const r = dedupe([rec('a', 100, 'f1'), rec('a', 100.0001, 'f2')], ['fps']);
    assert.equal(r.conflicts.length, 1, 'near-equal is still a conflict, not a merge');
    assert.equal(r.unique.length, 2);
  });

  it('compares only the declared value fields', () => {
    const a = { observationKey: 'k', fps: 60, note: 'first', provenance: {} };
    const b = { observationKey: 'k', fps: 60, note: 'second', provenance: {} };
    const r = dedupe([a, b], ['fps']);
    assert.equal(r.duplicates.length, 1, 'differing non-compared fields do not create a conflict');
    assert.equal(r.conflicts.length, 0);
  });

  it('is insensitive to key ordering within a compared object field', () => {
    const a = { observationKey: 'k', cfg: { gpu: 'x', cpu: 'y' }, provenance: {} };
    const b = { observationKey: 'k', cfg: { cpu: 'y', gpu: 'x' }, provenance: {} };
    const r = dedupe([a, b], ['cfg']);
    assert.equal(r.conflicts.length, 0, 'same object, different key order, must not read as a conflict');
    assert.equal(r.duplicates.length, 1);
  });
});

describe('Dedupe: determinism', () => {
  it('produces identical output across repeated runs', () => {
    const input = [rec('a', 1, 'f1'), rec('b', 2, 'f2'), rec('a', 1, 'f3'), rec('c', 3, 'f4')];
    const a = JSON.stringify(dedupe(input, ['fps']));
    const b = JSON.stringify(dedupe(input, ['fps']));
    assert.equal(a, b);
  });

  it('reports consistent stats', () => {
    const r = dedupe([rec('a', 1, 'f'), rec('a', 1, 'f'), rec('b', 2, 'f')], ['fps']);
    assert.equal(r.stats.input, 3);
    assert.equal(r.stats.unique, 2);
    assert.equal(r.stats.duplicatesRemoved, 1);
    assert.equal(r.stats.conflictKeys, 0);
  });
});

describe('Dedupe: duplicate source pages', () => {
  const page = (gameId, sourceFile) => ({ game: { gameId }, _meta: { sourceFile } });

  it('detects two saved files covering the same game', () => {
    const d = findDuplicateSourcePages([page('1', 'a.html'), page('1', 'b.html'), page('2', 'c.html')]);
    assert.equal(d.length, 1);
    assert.equal(d[0].gameId, '1');
    assert.deepEqual(d[0].files, ['a.html', 'b.html']);
  });

  it('reports nothing when every game has one source', () => {
    assert.equal(findDuplicateSourcePages([page('1', 'a.html'), page('2', 'b.html')]).length, 0);
  });

  it('ignores pages with no game id', () => {
    assert.equal(findDuplicateSourcePages([{ game: null, _meta: { sourceFile: 'x' } }]).length, 0);
  });
});

describe('Dedupe: observation key collision resistance', () => {
  it('cannot produce the same key from different field splits', async () => {
    const { observationKey } = await import('../lib/normalize.mjs');
    // A plain separator ("-", ":") would make these two collide.
    assert.ok(observationKey(['ab', 'c']) !== observationKey(['a', 'bc']), 'field-split ambiguity must be impossible');
    assert.ok(observationKey(['3954', 'gpu', 'RTX-3080']) !== observationKey(['3954', 'gpu-RTX', '3080']));
  });

  it('normalizes case and whitespace so trivial variants share a key', async () => {
    const { observationKey } = await import('../lib/normalize.mjs');
    assert.equal(observationKey(['3954', 'GPU', ' 2060S ']), observationKey(['3954', 'gpu', '2060s']));
  });

  it('distinguishes a null field from an empty string field position', async () => {
    const { observationKey } = await import('../lib/normalize.mjs');
    assert.equal(observationKey(['a', null, 'b']), observationKey(['a', '', 'b']), 'null and empty are the same absent value');
    assert.ok(observationKey(['a', 'b']) !== observationKey(['a', null, 'b']), 'arity still matters');
  });
});
