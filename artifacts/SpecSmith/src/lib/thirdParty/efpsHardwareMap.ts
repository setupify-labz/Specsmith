// Resolves UserBenchmark EFPS shorthand hardware tokens to SpecSmith canonical
// catalog ids — by explicit alias only, never by similarity.
//
// WHY A TABLE AND NOT A MATCHER
// -----------------------------
// The accepted corpus uses a CLOSED vocabulary: 16 GPU tokens and 11 CPU
// tokens, listed in full below. A finite vocabulary can be decided one entry at
// a time by a human, so there is no reason to run a similarity function over
// the catalog and hope. Every token here carries either a resolution with its
// evidence, or a block with its reason — nothing falls through, and a token
// that is not in the table is blocked rather than guessed at.
//
// The danger this design exists to avoid is concrete, not theoretical. Matching
// on digits alone against the real catalog produces:
//
//   "580"   -> arca580 (Intel Arc A580), arcb580 (Intel Arc B580)
//              ...while the actual part is an AMD RX 580. Cross-vendor.
//   "570"   -> arcb570 (Intel Arc B570), actual part an AMD RX 570.
//   "2600"  -> i5-12600k, actual part an AMD Ryzen 5 2600. Cross-vendor.
//   "3600"  -> i5-13600k AND r5-3600. Two candidates; only one is right.
//   "9600K" -> would land near r5-9600x (Ryzen 5 9600X) on digits alone.
//
// Every one of those is a real collision against the shipping catalog, and
// every one is wrong. An exact alias table cannot make them.
//
// WHAT IS ACTUALLY RESOLVABLE
// ---------------------------
// Very little, and that is the honest answer rather than a failure. The EFPS
// corpus is 2016-2019 hardware (GTX 10-series, RTX 20-series, RX 500/5700);
// the SpecSmith catalog starts at RTX 3050 / RX 6400. So ZERO of the 16 GPU
// tokens have a canonical counterpart to resolve TO, and 9 of the 11 CPU
// tokens do not either. Only "3600" and "3700X" exist in the catalog.
//
// Because a record is joinable only when BOTH sides resolve, and no GPU token
// resolves, no record is joinable today. The CPU resolutions are still worth
// making: they are correct, they are proven by tests, and they mean the layer
// is real rather than a stub that would need writing from scratch the day a
// GTX 1060 is added to the catalog.
//
// FORM FACTOR
// -----------
// Resolution requires positive evidence of desktop. AMD desktop Ryzen SKUs are
// a bare number with an optional X/XT suffix; the mobile parts of the same
// generation carry U/H/HS/HX ("3700U", "3550H"). So "3600" and "3700X" are
// desktop-only SKU numbers — the token itself is the evidence. No token is
// resolved on the assumption that EFPS means desktop.
//
// This module deliberately does NOT import gpus.json / cpus.json. The
// third-party boundary forbids reading the estimator's base data (see
// separation.test.ts), so canonical ids are written literally here and their
// existence is verified where reading the catalog is legitimate: the ingestion
// script refuses to write a store containing an id the catalog does not have,
// and a test asserts the same against every entry.

import type { ThirdPartyFormFactor } from './types';

/**
 * Version of the mapping rules. Bump on ANY change to the table below.
 *
 * Persisted into the store so a file built by older rules is detectable rather
 * than silently trusted; ingestion --check compares it.
 */
export const EFPS_HARDWARE_MAP_VERSION = 1;

export type EfpsTokenKind = 'gpu' | 'cpu';

/** Why a token was not resolved. Every block is one of these, with detail. */
export type EfpsTokenBlockReason =
  /** The part is identifiable and unambiguous, but SpecSmith has no entry for it. */
  | 'not-in-catalog'
  /** More than one catalog entry is a plausible reading of the token. */
  | 'ambiguous-multiple-candidates'
  /** Cannot establish desktop from the token or the source evidence. */
  | 'form-factor-not-established'
  /** Token is outside the reviewed vocabulary — never resolved by default. */
  | 'token-not-in-vocabulary';

/**
 * What justifies a resolution. Recorded per token so a reviewer can see which
 * mappings have independent corroboration and which rest on the token alone.
 */
export type EfpsResolutionEvidence =
  /** Token is the manufacturer's full desktop SKU number; exactly one catalog entry matches. */
  | 'exact-sku-alias'
  /**
   * As above, AND research/userbenchmark's cleaning pipeline independently
   * resolved the fully-qualified component name to the same canonical id, at
   * desktop form factor, from these same captured pages.
   */
  | 'exact-sku-alias-corroborated-by-cleaning-pipeline';

export interface EfpsTokenResolved {
  status: 'resolved';
  token: string;
  kind: EfpsTokenKind;
  canonicalId: string;
  /** Only ever 'desktop'; a token without desktop evidence is blocked, not resolved. */
  formFactor: 'desktop';
  evidence: EfpsResolutionEvidence;
  /** The manufacturer's full name for the part this token denotes. */
  denotes: string;
  mapVersion: number;
}

export interface EfpsTokenBlocked {
  status: 'blocked';
  token: string;
  kind: EfpsTokenKind;
  canonicalId: null;
  formFactor: 'unknown';
  blockReason: EfpsTokenBlockReason;
  detail: string;
  /** Catalog ids a naive matcher might have reached for. Empty when none exist. */
  candidates: readonly string[];
  mapVersion: number;
}

export type EfpsTokenResolution = EfpsTokenResolved | EfpsTokenBlocked;

/** A table entry before the token/kind/version fields are attached. */
type Rule =
  | { resolve: string; denotes: string; formFactor: 'desktop'; evidence: EfpsResolutionEvidence }
  | { block: EfpsTokenBlockReason; detail: string; candidates?: readonly string[] };

// ---------------------------------------------------------------------------
// GPU tokens — all 16 present in the accepted corpus.
// ---------------------------------------------------------------------------
//
// None resolve: the catalog's oldest NVIDIA part is the RTX 3050 and its oldest
// AMD part is the RX 6400, so every one of these predates it. `candidates`
// lists the ids a digit-based matcher would have wrongly reached for, which is
// the whole reason those tokens are called out rather than left implicit.

const GPU_RULES: Readonly<Record<string, Rule>> = {
  '1050-Ti': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1050 Ti (2016). Catalog has no GTX parts. UserBenchmark also publishes a distinct "GTX 1050-Ti (Mobile)" component, so this token alone would not establish desktop even if the part existed.' },
  '1060-3GB': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1060 3GB (2016). Catalog has no GTX parts.' },
  '1060-6GB': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1060 6GB (2016). Catalog has no GTX parts.' },
  '1070': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1070 (2016). Catalog has no GTX parts. UserBenchmark also publishes "GTX 1070 (Mobile)", so the bare token does not establish desktop.' },
  '1650': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1650 (2019). Catalog has no GTX parts.' },
  '1660': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1660 (2019). Catalog has no GTX parts.' },
  '1660-Ti': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1660 Ti (2019). Catalog has no GTX parts.' },
  '1660S': { block: 'not-in-catalog', detail: 'NVIDIA GTX 1660 Super (2019). Catalog has no GTX parts.' },
  '2060': { block: 'not-in-catalog', detail: 'NVIDIA RTX 2060 (2019). Catalog RTX series starts at the 30-series.' },
  '2060S': { block: 'not-in-catalog', detail: 'NVIDIA RTX 2060 Super (2019). Catalog RTX series starts at the 30-series.' },
  '2070S': { block: 'not-in-catalog', detail: 'NVIDIA RTX 2070 Super (2019). Catalog RTX series starts at the 30-series.' },
  '2080': { block: 'not-in-catalog', detail: 'NVIDIA RTX 2080 (2018). Catalog RTX series starts at the 30-series.' },
  '570': {
    block: 'not-in-catalog',
    detail: 'AMD RX 570 (2017). Catalog Radeon series starts at RX 6400. Note the trap: matching on digits alone reaches Intel Arc B570, a different vendor and a 2024 part.',
    candidates: ['arcb570'],
  },
  '580': {
    block: 'not-in-catalog',
    detail: 'AMD RX 580 (2017). Catalog Radeon series starts at RX 6400. Matching on digits alone reaches Intel Arc A580 and Arc B580 — wrong vendor, wrong decade. UserBenchmark separately publishes an "Nvidia GTX 580", so the bare number is not even vendor-unique within the source.',
    candidates: ['arca580', 'arcb580'],
  },
  '5700': { block: 'not-in-catalog', detail: 'AMD RX 5700 (2019). Catalog Radeon series starts at RX 6400.' },
  '5700-XT': { block: 'not-in-catalog', detail: 'AMD RX 5700 XT (2019). Catalog Radeon series starts at RX 6400.' },
};

// ---------------------------------------------------------------------------
// CPU tokens — all 11 present in the accepted corpus.
// ---------------------------------------------------------------------------

const CPU_RULES: Readonly<Record<string, Rule>> = {
  '2600': {
    block: 'not-in-catalog',
    detail: 'AMD Ryzen 5 2600 (2018). Catalog AMD line starts at the 3000 series. Digit matching reaches Intel i5-12600K — wrong vendor.',
    candidates: ['i5-12600k'],
  },
  '2600X': { block: 'not-in-catalog', detail: 'AMD Ryzen 5 2600X (2018). Catalog AMD line starts at the 3000 series.' },
  '2700X': { block: 'not-in-catalog', detail: 'AMD Ryzen 7 2700X (2018). Catalog AMD line starts at the 3000 series.' },
  '3600': {
    resolve: 'r5-3600',
    denotes: 'AMD Ryzen 5 3600',
    formFactor: 'desktop',
    // The corroboration is what makes this the strongest entry in the table:
    // the cleaning pipeline independently resolved the component-table row
    // "AMD Ryzen 5 3600" to r5-3600 at desktop form factor, from these same
    // captured pages, by exact normalized-name equality. Two independent paths,
    // one answer.
    evidence: 'exact-sku-alias-corroborated-by-cleaning-pipeline',
  },
  '3700X': {
    resolve: 'r7-3700x',
    denotes: 'AMD Ryzen 7 3700X',
    formFactor: 'desktop',
    // Exactly one catalog entry; no corroborating component row in this corpus,
    // so the evidence is the token alone — recorded as such rather than
    // overstated. The X suffix is an AMD desktop marker (the mobile part of
    // this generation is the 3700U).
    evidence: 'exact-sku-alias',
  },
  '9100F': { block: 'not-in-catalog', detail: 'Intel Core i3-9100F (2019). Catalog Intel line starts at the 12th generation.' },
  '9350KF': { block: 'not-in-catalog', detail: 'Intel Core i3-9350KF (2019). Catalog Intel line starts at the 12th generation.' },
  '9400F': { block: 'not-in-catalog', detail: 'Intel Core i5-9400F (2019). Catalog Intel line starts at the 12th generation. This is the corpus\'s most common CPU token (1,265 datapoints), so a wrong mapping here would contaminate the most data.' },
  '9600K': {
    block: 'not-in-catalog',
    detail: 'Intel Core i5-9600K (2018). Catalog Intel line starts at the 12th generation. Digit matching drifts to AMD Ryzen 5 9600X — wrong vendor, and a 2024 part.',
    candidates: ['r5-9600x'],
  },
  '9700K': {
    block: 'not-in-catalog',
    detail: 'Intel Core i7-9700K (2018). Catalog Intel line starts at the 12th generation. Digit matching drifts to AMD Ryzen 7 9700X — wrong vendor.',
    candidates: ['r7-9700x'],
  },
  '9900K': {
    block: 'not-in-catalog',
    detail: 'Intel Core i9-9900K (2018). Catalog Intel line starts at the 12th generation. Digit matching drifts to AMD Ryzen 9 9900X / 9900X3D — wrong vendor.',
    candidates: ['r9-9900x', 'r9-9900x3d'],
  },
};

/** The reviewed vocabulary, per kind. Exported so tests can assert completeness. */
export const EFPS_GPU_TOKEN_VOCABULARY: readonly string[] = Object.keys(GPU_RULES).sort();
export const EFPS_CPU_TOKEN_VOCABULARY: readonly string[] = Object.keys(CPU_RULES).sort();

/**
 * Resolves one token within its own namespace.
 *
 * `kind` is not a hint — it selects the table. A CPU token is looked up only
 * against CPU rules and a GPU token only against GPU rules, so a cpuToken can
 * never be answered with a GPU id no matter what it spells. (UserBenchmark
 * really does publish a GPU called "Graphics Media Accelerator 3600", which is
 * exactly the collision this separation prevents.)
 *
 * Lookup is by exact string equality on the token as published. No trimming,
 * no case folding, no punctuation normalization: the corpus tokens are already
 * exact, and every "helpful" normalization step is a place where two distinct
 * parts could collapse into one.
 */
export function resolveEfpsToken(token: string, kind: EfpsTokenKind): EfpsTokenResolution {
  const rule = (kind === 'gpu' ? GPU_RULES : CPU_RULES)[token];

  if (rule === undefined) {
    return {
      status: 'blocked',
      token,
      kind,
      canonicalId: null,
      formFactor: 'unknown',
      blockReason: 'token-not-in-vocabulary',
      detail: `"${token}" is not in the reviewed EFPS ${kind} vocabulary (map v${EFPS_HARDWARE_MAP_VERSION}). Unknown tokens are blocked, never guessed — a new token means the corpus changed and needs review.`,
      candidates: [],
      mapVersion: EFPS_HARDWARE_MAP_VERSION,
    };
  }

  if ('block' in rule) {
    return {
      status: 'blocked',
      token,
      kind,
      canonicalId: null,
      formFactor: 'unknown',
      blockReason: rule.block,
      detail: rule.detail,
      candidates: rule.candidates ?? [],
      mapVersion: EFPS_HARDWARE_MAP_VERSION,
    };
  }

  return {
    status: 'resolved',
    token,
    kind,
    canonicalId: rule.resolve,
    formFactor: rule.formFactor,
    evidence: rule.evidence,
    denotes: rule.denotes,
    mapVersion: EFPS_HARDWARE_MAP_VERSION,
  };
}

/** Every canonical id the table claims, for catalog verification. */
export function declaredCanonicalIds(kind: EfpsTokenKind): { token: string; canonicalId: string; denotes: string }[] {
  const rules = kind === 'gpu' ? GPU_RULES : CPU_RULES;
  return Object.entries(rules)
    .filter((e): e is [string, Extract<Rule, { resolve: string }>] => 'resolve' in e[1])
    .map(([token, r]) => ({ token, canonicalId: r.resolve, denotes: r.denotes }))
    .sort((a, b) => (a.token < b.token ? -1 : 1));
}

/** True only for a resolution safe to join: resolved, has an id, and is desktop. */
export function isSafelyResolved(r: EfpsTokenResolution): r is EfpsTokenResolved {
  return r.status === 'resolved' && r.canonicalId !== null && r.formFactor === 'desktop';
}

export type { ThirdPartyFormFactor };
