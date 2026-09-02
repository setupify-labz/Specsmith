// Reads every canonical part record SpecSmith's core builder selectors can
// show — the same files `Builder.tsx`, `QuizFlow.tsx` and the matchup /
// "best X for game" / prebuilt pages read from `src/data/` — and flattens
// them into the minimal shape `coreSelectorLinkAudit.ts` needs.
//
// Deliberately reads the SAME files the app ships, not a copy: the audit's
// claim is about what today's site actually renders, so a part missing from
// this file must be missing from the audit too.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import type { CoreSelectorCatalogEntry } from './coreSelectorLinkAudit';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const dataDir = path.join(appRoot, 'src', 'data');

interface RawPart {
  id?: unknown;
  name?: unknown;
  brand?: unknown;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
}

function toEntries(raw: unknown, category: RetailPartCategory): CoreSelectorCatalogEntry[] {
  if (!Array.isArray(raw)) throw new Error(`Expected an array of ${category} parts.`);
  return raw.map((entry) => {
    const part = entry as RawPart;
    return {
      id: typeof part.id === 'string' ? part.id : '',
      name: typeof part.name === 'string' ? part.name : '',
      brand: typeof part.brand === 'string' ? part.brand : undefined,
      category,
    };
  });
}

/** Category groups nested inside one JSON file, keyed by their field name. */
function groupsFrom(raw: unknown, groups: Record<string, RetailPartCategory>): CoreSelectorCatalogEntry[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Expected an object of category groups.');
  }
  const record = raw as Record<string, unknown>;
  return Object.entries(groups).flatMap(([field, category]) => toEntries(record[field], category));
}

/**
 * Every canonical part across all 12 core-selector categories.
 *
 * `gpus.json` and `cpus.json` are flat arrays; `components.json` and
 * `peripherals.json` group several categories under one file — see
 * `src/pages/Builder.tsx` for the same shape read the same way.
 */
export function loadCoreSelectorCatalog(): CoreSelectorCatalogEntry[] {
  return [
    ...toEntries(readJson('gpus.json'), 'gpu'),
    ...toEntries(readJson('cpus.json'), 'cpu'),
    ...groupsFrom(readJson('components.json'), {
      motherboards: 'motherboard',
      ram: 'ram',
      storage: 'storage',
      psus: 'psu',
      cases: 'case',
      coolers: 'cooler',
    }),
    ...groupsFrom(readJson('peripherals.json'), {
      monitors: 'monitor',
      keyboards: 'keyboard',
      mice: 'mouse',
      headsets: 'headset',
    }),
  ];
}
