// CPU power figures, kept as the two numbers manufacturers actually publish.
//
// - base_power_watts: Intel "Processor Base Power" / AMD "Default TDP".
// - max_turbo_power_watts: Intel "Maximum Turbo Power". AMD publishes no
//   per-model equivalent (its socket power limit is set by the motherboard),
//   so it is null for AMD rather than an invented number.
//
// Sizing a power supply or a cooler needs the PEAK sustained draw, so checks
// use the maximum turbo power where it is published and the rated base power
// otherwise — and say which one they used.

export interface CpuPowerSpec {
  base_power_watts?: number | null;
  max_turbo_power_watts?: number | null;
}

export type CpuPowerBasis = 'max-turbo' | 'rated-base';

export interface CpuPowerDraw {
  watts: number;
  basis: CpuPowerBasis;
}

const isWatts = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Peak sustained draw for sizing, or null when no published figure exists. */
export function cpuPeakPower(cpu: CpuPowerSpec): CpuPowerDraw | null {
  if (isWatts(cpu.max_turbo_power_watts)) return { watts: cpu.max_turbo_power_watts, basis: 'max-turbo' };
  if (isWatts(cpu.base_power_watts)) return { watts: cpu.base_power_watts, basis: 'rated-base' };
  return null;
}

/** "125W base / 253W max turbo", or "120W TDP" when only one figure is published. */
export function formatCpuPower(cpu: CpuPowerSpec): string {
  const base = isWatts(cpu.base_power_watts) ? cpu.base_power_watts : null;
  const max = isWatts(cpu.max_turbo_power_watts) ? cpu.max_turbo_power_watts : null;
  if (base !== null && max !== null) return `${base}W base / ${max}W max turbo`;
  if (base !== null) return `${base}W TDP`;
  return 'Not published';
}
