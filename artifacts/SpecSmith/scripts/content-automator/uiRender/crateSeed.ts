// Predicts the exact crate a seed will produce, using the real crate logic.
//
// The Build Crate reveals eight parts in a fixed order, and each roll depends
// on earlier ones (the CPU needs the motherboard's socket, the case needs the
// GPU's length, the PSU needs both TDPs). To verify a capture actually shows
// the requested crate, the renderer needs to know those eight part names before
// the browser is even launched.
//
// This mirrors BuildCrate.tsx's openNext() chain against the same seeded RNG.
// It is deliberately a mirror rather than a mock: every part comes from
// src/lib/buildCrate's real roll functions over the real pools, so a prediction
// that drifts from the page is a bug this file will surface rather than hide.
// A test asserts the prediction matches what the live page actually renders,
// which is what keeps the mirror honest.
//
// Pity is always OFF here, matching the seeded path in BuildCrate.tsx: pity
// lives in localStorage, so honouring it would make the result depend on how
// many crates the browser profile had already opened.

import {
  rollCase,
  rollCooler,
  rollCpu,
  rollGpu,
  rollMotherboard,
  rollPsu,
  rollRam,
  rollStorage,
  seededRng,
  setCrateRng,
} from "../../../src/lib/buildCrate.ts";

export interface PredictedCrate {
  seed: number;
  /** Part names in reveal order: motherboard, cpu, ram, gpu, storage, case, cooler, psu. */
  partNames: string[];
  /** Keyed by slot, for targeted assertions. */
  bySlot: Record<string, string>;
}

export function predictCrate(seed: number): PredictedCrate {
  setCrateRng(seededRng(seed));
  try {
    const motherboard = rollMotherboard();
    const cpu = rollCpu(motherboard.socket, false);
    const ram = rollRam(motherboard.part.supported_ram[0]);
    const gpu = rollGpu(false);
    const storage = rollStorage();
    const kase = rollCase(motherboard.part.form_factor, gpu.part.length_mm);
    const cooler = rollCooler(kase.part.cooler_clearance_mm, cpu.part.tdp_watts, cpu.part.socket);
    const psu = rollPsu(gpu.part.tdp_watts, cpu.part.tdp_watts);

    const bySlot: Record<string, string> = {
      motherboard: motherboard.part.name,
      cpu: cpu.part.name,
      ram: ram.part.name,
      gpu: gpu.part.name,
      storage: storage.part.name,
      case: kase.part.name,
      cooler: cooler.part.name,
      psu: psu.part.name,
    };
    return {
      seed,
      partNames: ["motherboard", "cpu", "ram", "gpu", "storage", "case", "cooler", "psu"].map((k) => bySlot[k]),
      bySlot,
    };
  } finally {
    // Always restore real randomness, even if a roll throws. The RNG override
    // is module-scoped, so leaking it would make an unrelated later caller
    // deterministic without asking.
    setCrateRng(null);
  }
}
