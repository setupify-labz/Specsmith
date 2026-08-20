import { describe, it, expect } from 'vitest';
import {
  HardwareAttributionError,
  classifyFormFactor,
  loadCatalogs,
  normalizeHardwareName,
  resolveHardware,
} from './catalog';

// The REAL catalogs, not a stand-in. The point of these rules is that they
// hold against the parts SpecSmith actually ships, including the several
// entries that differ only by memory size.
const catalogs = loadCatalogs();
const gpu = (name: string, preferred?: string) => resolveHardware(name, 'gpu', catalogs.gpus, preferred);
const cpu = (name: string, preferred?: string) => resolveHardware(name, 'cpu', catalogs.cpus, preferred);

// Verbatim Win32_VideoController.Name / Win32_Processor.Name shapes. The first
// two are the strings the real Windows probe returned on the operator's
// machine; the rest are the standard vendor formats.
describe('resolving what Windows actually reports', () => {
  it('resolves the GPU name from the real probe', () => {
    expect(gpu('NVIDIA GeForce RTX 5070').id).toBe('rtx5070');
  });

  it('resolves the CPU name from the real probe, including AMD\'s core-count tail', () => {
    expect(cpu('AMD Ryzen 5 5600X 6-Core Processor').id).toBe('r5-5600x');
  });

  it("strips Intel's (R)/(TM) marks and clock-speed tail", () => {
    expect(cpu('Intel(R) Core(TM) i7-12700K CPU @ 3.60GHz').id).toBe('i7-12700k');
  });

  it('strips a generation prefix', () => {
    expect(cpu('12th Gen Intel(R) Core(TM) i5-12600K').id).toBe('i5-12600k');
  });

  it('keeps "Core" for Core Ultra, where the catalog keeps it too', () => {
    expect(cpu('Intel(R) Core(TM) Ultra 9 285K').id).toBe('cu9-285k');
  });

  it('resolves AMD Radeon cards', () => {
    expect(gpu('AMD Radeon RX 7800 XT').id).toBe('rx7800xt');
  });

  it('records that boilerplate had to be stripped', () => {
    expect(gpu('NVIDIA GeForce RTX 5070').matchMethod).toBe('normalized');
    expect(gpu('RTX 5070').matchMethod).toBe('exact');
  });
});

describe('the operator cannot assert hardware the machine contradicts', () => {
  it('refuses an id that is not what the machine reported', () => {
    // The whole merge blocker in one test: an RTX 5070 machine cannot file its
    // frame times under an RTX 4090.
    expect(() => gpu('NVIDIA GeForce RTX 5070', 'rtx4090')).toThrow(HardwareAttributionError);
    expect(() => gpu('NVIDIA GeForce RTX 5070', 'rtx4090')).toThrow(/cannot override/);
  });

  it('refuses an id that is not in the catalog at all', () => {
    expect(() => gpu('NVIDIA GeForce RTX 5070', 'rtx9999')).toThrow(HardwareAttributionError);
  });

  it('accepts an id that agrees with the machine', () => {
    expect(gpu('NVIDIA GeForce RTX 5070', 'rtx5070').id).toBe('rtx5070');
  });
});

// Windows reports one name for cards that differ only by memory size, so the
// detected string genuinely does not say which is installed. Picking the first
// would be a coin flip recorded as a fact.
describe('memory-size ambiguity', () => {
  it('refuses to choose between an 8GB and a 16GB card', () => {
    expect(() => gpu('NVIDIA GeForce RTX 4060 Ti')).toThrow(/matches 2 catalog entries/);
    expect(() => gpu('Intel(R) Arc(TM) A770 Graphics')).toThrow(/matches 2 catalog entries/);
  });

  it('lets the operator disambiguate among exactly those candidates', () => {
    expect(gpu('NVIDIA GeForce RTX 4060 Ti', 'rtx4060ti16').id).toBe('rtx4060ti16');
    expect(gpu('NVIDIA GeForce RTX 4060 Ti', 'rtx4060ti').id).toBe('rtx4060ti');
  });

  it('does not let the memory allowance eat the model number', () => {
    // "arca7708gb" flattened, then stripped by a naive /\d{1,2}gb$/, becomes
    // "arca77" — which matches nothing, and would have made an ambiguous card
    // resolve to a single entry.
    expect(normalizeHardwareName('Arc A770 8GB')).toBe('arca7708gb');
    expect(gpu('Intel(R) Arc(TM) A770 Graphics', 'arca770-8').id).toBe('arca770-8');
  });
});

describe('form factor is a hard boundary', () => {
  it('classifies laptop GPUs and CPUs', () => {
    expect(classifyFormFactor('NVIDIA GeForce RTX 4070 Laptop GPU', 'gpu')).toBe('laptop');
    expect(classifyFormFactor('NVIDIA GeForce GTX 1060 Max-Q', 'gpu')).toBe('laptop');
    expect(classifyFormFactor('Intel(R) Core(TM) i7-8750H CPU @ 2.20GHz', 'cpu')).toBe('laptop');
    expect(classifyFormFactor('Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz', 'cpu')).toBe('laptop');
    expect(classifyFormFactor('AMD Ryzen 9 7945HX with Radeon Graphics', 'cpu')).toBe('laptop');
    expect(classifyFormFactor('Intel(R) Core(TM) i7-1165G7', 'cpu')).toBe('laptop');
  });

  it('does not mistake a desktop suffix for a mobile one', () => {
    // KS, KF, F, X and X3D are desktop parts and share the digit-then-letter
    // shape the mobile classes use.
    for (const name of ['Intel(R) Core(TM) i9-14900KS', 'Intel(R) Core(TM) i5-14400F', 'AMD Ryzen 7 5800X3D 8-Core Processor']) {
      expect(classifyFormFactor(name, 'cpu')).toBe('desktop');
    }
  });

  it('classifies integrated graphics', () => {
    expect(classifyFormFactor('Intel(R) UHD Graphics 630', 'gpu')).toBe('integrated');
    expect(classifyFormFactor('AMD Radeon(TM) Graphics', 'gpu')).toBe('integrated');
  });

  it('never matches a laptop part to its desktop namesake', () => {
    // The desktop RTX 4070 IS in the catalog — the refusal is the boundary,
    // not the part being absent.
    expect(gpu('NVIDIA GeForce RTX 4070').id).toBe('rtx4070');
    expect(() => gpu('NVIDIA GeForce RTX 4070 Laptop GPU')).toThrow(/laptop part/);
  });

  it('never matches integrated graphics into the discrete catalog', () => {
    expect(() => gpu('Intel(R) UHD Graphics 630')).toThrow(/integrated-graphics part/);
  });
});

describe('unmatched hardware is refused, not approximated', () => {
  it('refuses a real card SpecSmith does not carry', () => {
    expect(() => gpu('NVIDIA GeForce GTX 1080 Ti')).toThrow(/does not correspond to any entry/);
  });

  it('does not conflate a card with its Ti or Super sibling', () => {
    expect(gpu('NVIDIA GeForce RTX 4070').id).toBe('rtx4070');
    expect(gpu('NVIDIA GeForce RTX 4070 Ti').id).toBe('rtx4070ti');
    expect(gpu('NVIDIA GeForce RTX 4070 Super').id).toBe('rtx4070s');
    expect(gpu('NVIDIA GeForce RTX 4070 Ti Super').id).toBe('rtx4070tis');
  });

  it('refuses an empty detected name rather than matching nothing to something', () => {
    expect(() => gpu('')).toThrow(/reported no GPU name/);
  });
});

describe('the catalogs themselves', () => {
  it('loads the real files the app ships', () => {
    expect(catalogs.gpus.length).toBeGreaterThan(0);
    expect(catalogs.cpus.length).toBeGreaterThan(0);
    expect(catalogs.gameIds.length).toBeGreaterThan(0);
  });

  it('has no two entries sharing a normalized name, which would make every lookup ambiguous', () => {
    for (const list of [catalogs.gpus, catalogs.cpus]) {
      const seen = new Map<string, string>();
      for (const e of list) {
        const key = normalizeHardwareName(e.name);
        expect(seen.has(key)).toBe(false);
        seen.set(key, e.id);
      }
    }
  });
});
