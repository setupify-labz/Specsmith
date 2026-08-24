import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EFPS_CPU_TOKEN_VOCABULARY,
  EFPS_GPU_TOKEN_VOCABULARY,
  EFPS_HARDWARE_MAP_VERSION,
  declaredCanonicalIds,
  isSafelyResolved,
  resolveEfpsToken,
} from './efpsHardwareMap';
import { getAllEfpsRecords } from './efpsStore';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '..', 'data');
const catalog = (f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')) as { id: string; name: string; brand: string }[];

// The expected outcome for EVERY token in the corpus, written out rather than
// computed. If a rule changes, this table must change with it — which is the
// point: a mapping should never move without someone editing the expectation.
const EXPECTED_GPU: Record<string, string | null> = {
  '1050-Ti': null,
  '1060-3GB': null,
  '1060-6GB': null,
  '1070': null,
  '1650': null,
  '1660': null,
  '1660-Ti': null,
  '1660S': null,
  '2060': null,
  '2060S': null,
  '2070S': null,
  '2080': null,
  '570': null,
  '580': null,
  '5700': null,
  '5700-XT': null,
};

const EXPECTED_CPU: Record<string, string | null> = {
  '2600': null,
  '2600X': null,
  '2700X': null,
  '3600': 'r5-3600',
  '3700X': 'r7-3700x',
  '9100F': null,
  '9350KF': null,
  '9400F': null,
  '9600K': null,
  '9700K': null,
  '9900K': null,
};

describe('the token vocabulary matches the corpus exactly', () => {
  const corpusTokens = (kind: 'gpu' | 'cpu') => {
    const s = new Set<string>();
    for (const r of getAllEfpsRecords()) for (const d of r.datapoints) s.add(kind === 'gpu' ? d.gpuToken : d.cpuToken);
    return [...s].sort();
  };

  it('every GPU token in the 1,000 accepted records has a reviewed rule', () => {
    // No token may reach production without someone having decided about it.
    expect(corpusTokens('gpu')).toEqual([...EFPS_GPU_TOKEN_VOCABULARY].sort());
  });

  it('every CPU token in the 1,000 accepted records has a reviewed rule', () => {
    expect(corpusTokens('cpu')).toEqual([...EFPS_CPU_TOKEN_VOCABULARY].sort());
  });

  it('the vocabulary carries no rule for a token the corpus does not contain', () => {
    // Guards the other direction: a stale rule for a token that no longer
    // appears is dead weight that could silently start applying again.
    expect([...EFPS_GPU_TOKEN_VOCABULARY].sort()).toEqual(corpusTokens('gpu'));
    expect([...EFPS_CPU_TOKEN_VOCABULARY].sort()).toEqual(corpusTokens('cpu'));
  });

  it('the two vocabularies are counted as expected: 16 GPU, 11 CPU', () => {
    expect(EFPS_GPU_TOKEN_VOCABULARY).toHaveLength(16);
    expect(EFPS_CPU_TOKEN_VOCABULARY).toHaveLength(11);
  });
});

describe('every known EFPS GPU token resolves to its expected outcome', () => {
  for (const [token, expected] of Object.entries(EXPECTED_GPU)) {
    it(`"${token}" -> ${expected ?? 'blocked'}`, () => {
      const r = resolveEfpsToken(token, 'gpu');
      expect(r.canonicalId).toBe(expected);
      expect(r.token).toBe(token);
      expect(r.kind).toBe('gpu');
      expect(r.mapVersion).toBe(EFPS_HARDWARE_MAP_VERSION);
      if (expected === null) {
        expect(r.status).toBe('blocked');
        expect(r.formFactor).toBe('unknown');
        if (r.status === 'blocked') expect(r.detail.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('every known EFPS CPU token resolves to its expected outcome', () => {
  for (const [token, expected] of Object.entries(EXPECTED_CPU)) {
    it(`"${token}" -> ${expected ?? 'blocked'}`, () => {
      const r = resolveEfpsToken(token, 'cpu');
      expect(r.canonicalId).toBe(expected);
      expect(r.token).toBe(token);
      expect(r.kind).toBe('cpu');
      expect(r.mapVersion).toBe(EFPS_HARDWARE_MAP_VERSION);
      if (expected === null) {
        expect(r.status).toBe('blocked');
        expect(r.formFactor).toBe('unknown');
      } else {
        expect(r.status).toBe('resolved');
        expect(r.formFactor).toBe('desktop');
      }
    });
  }
});

describe('resolved mappings point at real desktop catalog parts', () => {
  it('every declared canonical id exists in the catalog and is the part the map names', () => {
    for (const kind of ['gpu', 'cpu'] as const) {
      const entries = catalog(kind === 'gpu' ? 'gpus.json' : 'cpus.json');
      for (const { token, canonicalId, denotes } of declaredCanonicalIds(kind)) {
        const entry = entries.find((e) => e.id === canonicalId);
        expect(entry, `${kind} token "${token}" maps to "${canonicalId}", which is not in the catalog`).toBeDefined();
        expect(`${entry!.brand} ${entry!.name}`).toBe(denotes);
      }
    }
  });

  it('the only resolved tokens are the two reviewed CPU aliases', () => {
    expect(declaredCanonicalIds('gpu')).toEqual([]);
    expect(declaredCanonicalIds('cpu').map((d) => `${d.token}=${d.canonicalId}`)).toEqual(['3600=r5-3600', '3700X=r7-3700x']);
  });
});

describe('laptop, integrated, and ambiguous lookalikes cannot cross-map to desktop', () => {
  // UserBenchmark publishes these as DISTINCT components on the same captured
  // pages, so they are not hypothetical strings — they are the real names a
  // careless normalizer would collapse into the desktop part.
  const laptopLookalikes = [
    'GTX 1050-Ti (Mobile)',
    '1050-Ti (Mobile)',
    'GTX 1060 (Mobile)',
    '1060 (Mobile)',
    'GTX 1070 (Mobile)',
    '1070 (Mobile)',
    '1070M',
    '960M',
    '950M',
  ];
  const integratedLookalikes = [
    'RX Vega 11 (Ryzen iGPU)',
    'RX Vega 8 (Ryzen iGPU)',
    'UHD Graphics 630',
    'Intel HD 530 (Desktop Skylake)',
    'Graphics Media Accelerator 3600',
  ];

  it('a mobile variant of a resolvable-looking GPU never resolves', () => {
    for (const token of laptopLookalikes) {
      const r = resolveEfpsToken(token, 'gpu');
      expect(r.status, `${token} must not resolve`).toBe('blocked');
      expect(r.canonicalId).toBeNull();
      expect(r.formFactor).toBe('unknown');
      expect(isSafelyResolved(r)).toBe(false);
    }
  });

  it('an integrated GPU name never resolves to a discrete desktop card', () => {
    for (const token of integratedLookalikes) {
      const r = resolveEfpsToken(token, 'gpu');
      expect(r.status, `${token} must not resolve`).toBe('blocked');
      expect(r.canonicalId).toBeNull();
    }
  });

  it('"Graphics Media Accelerator 3600" cannot borrow the CPU token "3600"\'s mapping', () => {
    // The same digits, a real UserBenchmark GPU, and the one CPU mapping that
    // does resolve. Namespaces are separate tables, so it cannot happen.
    expect(resolveEfpsToken('Graphics Media Accelerator 3600', 'gpu').canonicalId).toBeNull();
    expect(resolveEfpsToken('3600', 'gpu').canonicalId).toBeNull();
    expect(resolveEfpsToken('3600', 'cpu').canonicalId).toBe('r5-3600');
  });

  it('a CPU token is never answered with a GPU id, or the reverse', () => {
    for (const token of [...EFPS_GPU_TOKEN_VOCABULARY]) {
      expect(resolveEfpsToken(token, 'cpu').canonicalId).toBeNull();
    }
    for (const token of [...EFPS_CPU_TOKEN_VOCABULARY]) {
      expect(resolveEfpsToken(token, 'gpu').canonicalId).toBeNull();
    }
  });
});

describe('digit collisions against the real catalog are refused, not resolved', () => {
  // Each of these is a genuine collision: matching on digits alone against the
  // shipping catalog reaches the listed ids, and every one is the wrong part.
  const collisions: [string, 'gpu' | 'cpu', string, string[]][] = [
    ['580', 'gpu', 'AMD RX 580', ['arca580', 'arcb580']],
    ['570', 'gpu', 'AMD RX 570', ['arcb570']],
    ['2600', 'cpu', 'AMD Ryzen 5 2600', ['i5-12600k']],
    ['9600K', 'cpu', 'Intel i5-9600K', ['r5-9600x']],
    ['9700K', 'cpu', 'Intel i7-9700K', ['r7-9700x']],
    ['9900K', 'cpu', 'Intel i9-9900K', ['r9-9900x', 'r9-9900x3d']],
  ];

  for (const [token, kind, realPart, wrongIds] of collisions) {
    it(`"${token}" (${realPart}) does not become ${wrongIds.join(' or ')}`, () => {
      const r = resolveEfpsToken(token, kind);
      expect(r.status).toBe('blocked');
      expect(r.canonicalId).toBeNull();
      for (const wrong of wrongIds) expect(r.canonicalId).not.toBe(wrong);
      // The near-miss is recorded rather than forgotten, so a future reviewer
      // sees what was rejected and why.
      if (r.status === 'blocked') expect(r.candidates).toEqual(wrongIds);
    });
  }

  it('the collision ids named above are real catalog entries, so these tests are not vacuous', () => {
    const gpuIds = new Set(catalog('gpus.json').map((e) => e.id));
    const cpuIds = new Set(catalog('cpus.json').map((e) => e.id));
    for (const [, kind, , wrongIds] of collisions) {
      for (const id of wrongIds) {
        expect((kind === 'gpu' ? gpuIds : cpuIds).has(id), `${id} should exist in the catalog`).toBe(true);
      }
    }
  });

  it('"3600" resolves to the AMD part and never to the Intel i5-13600K it shares digits with', () => {
    const r = resolveEfpsToken('3600', 'cpu');
    expect(r.canonicalId).toBe('r5-3600');
    expect(r.canonicalId).not.toBe('i5-13600k');
  });
});

describe('lookup is exact — no trimming, folding, or normalization', () => {
  // Every "helpful" normalization step is a place two distinct parts could
  // collapse into one, so there are none. These near-misses all miss.
  const nearMisses = ['3600X', '3600XT', ' 3600', '3600 ', '3600x', 'r5-3600', 'Ryzen 5 3600', '36000', '360'];

  for (const token of nearMisses) {
    it(`"${token}" does not inherit "3600"'s mapping`, () => {
      const r = resolveEfpsToken(token, 'cpu');
      expect(r.status).toBe('blocked');
      expect(r.canonicalId).toBeNull();
    });
  }

  it('an unknown token is blocked as out-of-vocabulary, with the reason recorded', () => {
    const r = resolveEfpsToken('totally-new-part', 'cpu');
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') {
      expect(r.blockReason).toBe('token-not-in-vocabulary');
      expect(r.detail).toMatch(/blocked, never guessed/i);
    }
  });

  it('the empty string resolves to nothing', () => {
    expect(resolveEfpsToken('', 'cpu').canonicalId).toBeNull();
    expect(resolveEfpsToken('', 'gpu').canonicalId).toBeNull();
  });
});

describe('the mapping is deterministic and versioned', () => {
  it('the same token always produces a deep-equal result', () => {
    for (const token of [...EFPS_CPU_TOKEN_VOCABULARY]) {
      expect(resolveEfpsToken(token, 'cpu')).toEqual(resolveEfpsToken(token, 'cpu'));
    }
    for (const token of [...EFPS_GPU_TOKEN_VOCABULARY]) {
      expect(resolveEfpsToken(token, 'gpu')).toEqual(resolveEfpsToken(token, 'gpu'));
    }
  });

  it('every result carries the map version that produced it', () => {
    expect(EFPS_HARDWARE_MAP_VERSION).toBe(1);
    for (const token of ['3600', '9400F', 'totally-unknown']) {
      expect(resolveEfpsToken(token, 'cpu').mapVersion).toBe(EFPS_HARDWARE_MAP_VERSION);
    }
  });

  it('isSafelyResolved requires a resolved status, an id, AND desktop', () => {
    expect(isSafelyResolved(resolveEfpsToken('3600', 'cpu'))).toBe(true);
    expect(isSafelyResolved(resolveEfpsToken('9400F', 'cpu'))).toBe(false);
    expect(isSafelyResolved(resolveEfpsToken('2060S', 'gpu'))).toBe(false);
  });

  it('resolutions state their evidence, and only the corroborated one claims corroboration', () => {
    const a = resolveEfpsToken('3600', 'cpu');
    const b = resolveEfpsToken('3700X', 'cpu');
    expect(a.status === 'resolved' && a.evidence).toBe('exact-sku-alias-corroborated-by-cleaning-pipeline');
    // 3700X has no component-table row in this corpus, so it claims the weaker
    // evidence rather than borrowing the stronger label.
    expect(b.status === 'resolved' && b.evidence).toBe('exact-sku-alias');
  });
});
