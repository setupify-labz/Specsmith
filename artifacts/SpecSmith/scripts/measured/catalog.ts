// Loads the real SpecSmith catalogs from disk for the collector CLI.
//
// The actual resolution logic — normalization, form-factor boundary, memory-
// size ambiguity, candidate selection — lives in
// ../../src/lib/measured/hardwareMatch.ts, which is pure and browser-safe so
// that validateMeasuredObservation can re-run the SAME resolver at the store
// boundary. This file adds only the node:fs half: reading gpus.json,
// cpus.json and games.json off disk. Re-exported here so existing callers
// (collect.ts, this module's own tests) do not need to know the split exists.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  HardwareAttributionError,
  classifyFormFactor,
  normalizeHardwareName,
  resolveHardware,
  type CatalogEntry,
  type FormFactor,
  type HardwareMatch,
} from '../../src/lib/measured/hardwareMatch';
import type { CatalogEntry } from '../../src/lib/measured/hardwareMatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '..', 'src', 'data');

export interface Catalogs {
  gpus: CatalogEntry[];
  cpus: CatalogEntry[];
  gameIds: string[];
  gpuIds: string[];
  cpuIds: string[];
}

/** Reads the real catalogs the shipped app uses. No separate copy is kept. */
export function loadCatalogs(dir: string = dataDir): Catalogs {
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Array<Record<string, unknown>>;
  const entries = (rows: Array<Record<string, unknown>>): CatalogEntry[] =>
    rows.map((r) => ({ id: String(r.id), name: String(r.name) }));

  const gpus = entries(read('gpus.json'));
  const cpus = entries(read('cpus.json'));
  const games = read('games.json');
  return {
    gpus,
    cpus,
    gameIds: games.map((g) => String(g.id)),
    gpuIds: gpus.map((g) => g.id),
    cpuIds: cpus.map((c) => c.id),
  };
}
