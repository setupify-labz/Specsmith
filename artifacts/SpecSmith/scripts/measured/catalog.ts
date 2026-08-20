// Detected Windows hardware -> SpecSmith catalog ids.
//
// WHY THE OPERATOR CANNOT JUST SAY WHAT THE HARDWARE IS
// ----------------------------------------------------
// The collector used to take --gpu-id and --cpu-id on trust and record them
// beside whatever the machine reported, labelled `gpuMatchMethod: 'manual'`.
// Nothing checked that the two agreed. A typo, a copied command line from a
// different machine, or an optimistic operator would attribute one part's
// frame times to another, and the record would look completely normal
// afterwards — the raw detected name sat right there in the same object,
// contradicting the id, with no rule comparing them.
//
// So attribution is DERIVED from what the machine reported. The operator can
// still disambiguate (see `preferredId` below) but only among the candidates
// the detected name actually supports; they cannot name an unrelated part.
//
// FORM FACTOR IS A HARD BOUNDARY
// ------------------------------
// SpecSmith's catalogs are desktop parts. A laptop RTX 4070 shares its name
// with the desktop card but not its power limit, clocks, or memory, and an
// Intel H/HX/U chip is not its desktop namesake. Those are refused outright
// rather than matched at any confidence.
//
// NO EDIT DISTANCE
// ----------------
// "RTX 4070" and "RTX 4070 Ti" are one character apart and are different
// cards. Matching is exact after stripping vendor boilerplate, plus one narrow
// allowance for memory-size suffixes — and that allowance REJECTS when it
// reaches more than one entry rather than picking the closest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CatalogMatchMethod } from '../../src/lib/measured/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '..', 'src', 'data');

export interface CatalogEntry {
  id: string;
  name: string;
}

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

export type FormFactor = 'desktop' | 'laptop' | 'integrated';

export class HardwareAttributionError extends Error {}

// Mobile parts, by the markers the vendors' own device names use.
//   GPU: "NVIDIA GeForce RTX 4070 Laptop GPU", "... Max-Q", "... (Mobile)"
//   CPU: an Intel/AMD model number followed by a mobile class suffix —
//        8750H, 1165G7, 5800HS, 12900HX, 8250U, 1240P.
// Desktop suffixes (F, KF, KS, X, X3D, XT) are deliberately absent from the
// CPU list: i9-14900KS and Ryzen 7 5800X3D are desktop parts.
const LAPTOP_GPU = /\bLaptop\b|\bMobile\b|Max-?Q|\bMobility\b/i;
const LAPTOP_CPU = /\b\d{4,5}(HX|HS|HK|H|U|P)\b|\b\d{4}G\d\b|\bMobile\b|\bLaptop\b/i;
const INTEGRATED_GPU = /\bUHD\b|\bHD Graphics\b|\bIris\b|\bVega\b.*\bGraphics\b|\bRadeon\(?TM\)? Graphics\b|\biGPU\b|\bIntegrated\b/i;

export function classifyFormFactor(name: string, kind: 'gpu' | 'cpu'): FormFactor {
  // Laptop is tested first: a mobile iGPU is a laptop part, and the laptop
  // boundary is the one that must never be crossed.
  if ((kind === 'gpu' ? LAPTOP_GPU : LAPTOP_CPU).test(name)) return 'laptop';
  if (kind === 'gpu' && INTEGRATED_GPU.test(name)) return 'integrated';
  return 'desktop';
}

/**
 * Strips vendor boilerplate, then reduces to an equality key.
 *
 * Every removal here is text the vendor adds around the model name, never
 * part of the model identity: "NVIDIA GeForce" prefixes, "(R)"/"(TM)" marks,
 * AMD's "8-Core Processor" tail, Intel's " CPU @ 3.60GHz" tail. Model
 * qualifiers — Ti, Super, XT, X3D, KF, and memory sizes — are preserved,
 * because those are exactly what distinguishes two different products.
 */
export function normalizeHardwareName(raw: string): string {
  return String(raw ?? '')
    .replace(/\((?:R|TM|tm)\)|[®™]/g, ' ')
    // AMD: "Ryzen 5 5600X 6-Core Processor". Removed before the Core rule
    // below so its "Core" is not mistaken for Intel's brand word.
    .replace(/\b\d+-Core\s+Processor\b/gi, ' ')
    .replace(/\bProcessor\b/gi, ' ')
    // Intel: "... i7-12700K CPU @ 3.60GHz", "12th Gen Intel Core i5-13600K".
    .replace(/\bCPU\b\s*@.*$/i, ' ')
    .replace(/@\s*[\d.]+\s*GHz\b/gi, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+Gen(?:eration)?\b/gi, ' ')
    .replace(/\b(?:NVIDIA|AMD|Intel|ATI)\b/gi, ' ')
    .replace(/\b(?:GeForce|Radeon)\b/gi, ' ')
    // Intel drops "Core" before an i-series number in the catalog (i7-14700K)
    // but keeps it for Core Ultra, so only the i-series form is removed.
    .replace(/\bCore\s+(?=i[3579]\b|i[3579]-)/gi, ' ')
    .replace(/\bGraphics\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * A trailing memory-size designator, e.g. the "16GB" in "RTX 4060 Ti 16GB".
 *
 * Matched on the RAW name, where whitespace still delimits it. Applied to the
 * flattened key instead, the digit class eats part of the model number:
 * "arca7708gb" loses "08gb" and becomes "arca77", which matches nothing and
 * would have quietly made an ambiguous card resolve to a single entry.
 */
const VRAM_SUFFIX = /\s+\d{1,2}\s*GB\s*$/i;

export interface HardwareMatch {
  id: string;
  name: string;
  matchMethod: CatalogMatchMethod;
  formFactor: FormFactor;
  /** Every catalog entry the detected name could legitimately mean. */
  candidates: CatalogEntry[];
}

/**
 * Resolves a detected hardware name to exactly one catalog id, or refuses.
 *
 * The candidate set is every entry whose normalized name equals the detected
 * name, plus every entry that equals it followed by a memory-size suffix. That
 * second part is what makes "NVIDIA GeForce RTX 4060 Ti" ambiguous rather than
 * quietly resolving to the 8 GB entry: Windows reports the same name for both
 * cards, so the detected string genuinely does not say which one is installed.
 *
 * `preferredId` resolves that ambiguity, but it is CHECKED, not trusted — it
 * must be one of the candidates the detected name supports.
 */
export function resolveHardware(
  detectedName: string,
  kind: 'gpu' | 'cpu',
  catalog: readonly CatalogEntry[],
  preferredId?: string,
): HardwareMatch {
  const label = kind.toUpperCase();
  const raw = String(detectedName ?? '').trim();
  if (raw === '') {
    throw new HardwareAttributionError(`Windows reported no ${label} name, so the run cannot be attributed to a part.`);
  }

  const formFactor = classifyFormFactor(raw, kind);
  if (formFactor !== 'desktop') {
    throw new HardwareAttributionError(
      `Detected ${label} "${raw}" is ${formFactor === 'integrated' ? 'an integrated-graphics' : 'a laptop'} part. SpecSmith's catalogs hold desktop parts, and such a chip sharing a desktop part's name does not share its power limit, clocks or memory. It is never matched across that boundary.`,
    );
  }

  const key = normalizeHardwareName(raw);
  if (key === '') {
    throw new HardwareAttributionError(`Detected ${label} "${raw}" normalizes to an empty name; nothing can be matched against it.`);
  }

  const candidates = catalog.filter((e) => {
    if (normalizeHardwareName(e.name) === key) return true;
    // The entry names the same product plus its memory size.
    if (!VRAM_SUFFIX.test(e.name)) return false;
    return normalizeHardwareName(e.name.replace(VRAM_SUFFIX, '')) === key;
  });

  if (candidates.length === 0) {
    throw new HardwareAttributionError(
      `Detected ${label} "${raw}" does not correspond to any entry in the SpecSmith catalog. It is reported as unmatched rather than mapped to the nearest-looking part — a wrong hardware id attributes one part's frame times to another and nothing downstream can detect it afterwards.`,
    );
  }

  const chosen = pickCandidate(candidates, preferredId, label, raw);
  return {
    id: chosen.id,
    name: chosen.name,
    // 'exact' is reserved for the detected string BEING the catalog name.
    // Anything reached by stripping vendor boilerplate is 'normalized', which
    // is what the record should say happened.
    matchMethod: chosen.name.trim().toLowerCase() === raw.toLowerCase() ? 'exact' : 'normalized',
    formFactor,
    candidates,
  };
}

function pickCandidate(
  candidates: readonly CatalogEntry[],
  preferredId: string | undefined,
  label: string,
  raw: string,
): CatalogEntry {
  const describe = candidates.map((c) => `${c.id} ("${c.name}")`).join(', ');

  if (preferredId !== undefined) {
    const wanted = candidates.find((c) => c.id === preferredId);
    if (!wanted) {
      throw new HardwareAttributionError(
        `--${label.toLowerCase()}-id "${preferredId}" is not one of the parts the detected ${label} "${raw}" can refer to (${describe}). The id is checked against what the machine reported; it cannot override it.`,
      );
    }
    return wanted;
  }

  if (candidates.length > 1) {
    throw new HardwareAttributionError(
      `Detected ${label} "${raw}" matches ${candidates.length} catalog entries (${describe}) — Windows reports the same name for parts that differ only by memory size. Pass --${label.toLowerCase()}-id to say which one is installed; the collector will not pick for you.`,
    );
  }

  return candidates[0];
}
