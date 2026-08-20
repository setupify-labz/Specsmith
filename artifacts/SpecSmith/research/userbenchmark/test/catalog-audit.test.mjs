import { describe, it, assert } from './harness.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCatalog } from '../catalog-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readJson = (p) => fs.readFile(path.join(root, p), 'utf-8').then(JSON.parse);

const knownGames = await readJson('known-games.json');
const manifest = await readJson('capture-manifest.json');
const homepagePages = await Promise.all(
  [1, 2, 3, 4].map((n) => readJson(`homepage/parsed/Search-FPS-page${n}-ajax.json`)),
);

describe('Catalog audit: 316-game search corpus', () => {
  it('cross-checks the consolidated catalog, saved pagination, and capture manifest', () => {
    const result = auditCatalog({ knownGames, homepagePages, manifest });
    assert.ok(result.ok, result.issues.join('\n'));
    assert.equal(result.summary.knownGames, 316);
    assert.equal(result.summary.searchResultUniqueGames, 316);
    assert.equal(result.summary.manifestRows, 316);
  });

  it('rejects a catalog with a URL/id mismatch', () => {
    const mutated = structuredClone(knownGames);
    mutated.resolved[0].url = mutated.resolved[0].url.replace(`/${mutated.resolved[0].gameId}/`, '/999999/');
    const result = auditCatalog({ knownGames: mutated, homepagePages, manifest });
    assert.ok(!result.ok);
    assert.includes(result.issues.join('\n'), 'URL contains id 999999');
  });

  it('rejects a catalog that loses a game from the search corpus', () => {
    const mutated = structuredClone(knownGames);
    mutated.resolved = mutated.resolved.slice(1);
    const result = auditCatalog({ knownGames: mutated, homepagePages, manifest });
    assert.ok(!result.ok);
    assert.includes(result.issues.join('\n'), 'summary resolvedCount');
  });
});
