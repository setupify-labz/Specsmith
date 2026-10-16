import { describe, it, expect } from 'vitest';
import cpus from '../data/cpus.json';
import { cpuPeakPower, formatCpuPower } from './cpuPower';
import { checkCompatibility } from './compatibility';

const byId = (id: string) => {
  const cpu = cpus.find((c) => c.id === id);
  if (!cpu) throw new Error(`missing ${id}`);
  return cpu;
};

describe('CPU power data', () => {
  it('every CPU publishes a base power, and only Intel publishes a maximum turbo power', () => {
    for (const cpu of cpus) {
      expect(cpu.base_power_watts, cpu.id).toBeGreaterThan(0);
      expect('tdp_watts' in cpu, `${cpu.id} still carries the ambiguous tdp_watts`).toBe(false);
      if (cpu.brand === 'Intel') {
        expect(cpu.max_turbo_power_watts, cpu.id).toBeGreaterThanOrEqual(cpu.base_power_watts);
      } else {
        // AMD publishes no per-model maximum; never invent one.
        expect(cpu.max_turbo_power_watts, cpu.id).toBeNull();
      }
    }
  });

  it('records the published Intel figures for the parts that were stored inconsistently', () => {
    // Previously stored as base power while other Intel parts stored max turbo.
    expect([byId('i5-12400f').base_power_watts, byId('i5-12400f').max_turbo_power_watts]).toEqual([65, 117]);
    expect([byId('i3-14100f').base_power_watts, byId('i3-14100f').max_turbo_power_watts]).toEqual([58, 110]);
    expect([byId('cu9-285k').base_power_watts, byId('cu9-285k').max_turbo_power_watts]).toEqual([125, 250]);
    expect([byId('cu5-245k').base_power_watts, byId('cu5-245k').max_turbo_power_watts]).toEqual([125, 159]);
  });

  it('F-series Intel and Ryzen 5000/3000 parts have no integrated graphics', () => {
    for (const cpu of cpus) {
      const noGraphics = (cpu.brand === 'Intel' && /F$/i.test(cpu.name)) || /^Ryzen \d (5|3)\d{3}/.test(cpu.name);
      if (noGraphics) expect(cpu.integrated_graphics, cpu.id).toBeNull();
      else expect(typeof cpu.integrated_graphics, cpu.id).toBe('string');
    }
  });
});

describe('cpuPeakPower', () => {
  it('uses maximum turbo power when published, rated base power otherwise', () => {
    expect(cpuPeakPower({ base_power_watts: 125, max_turbo_power_watts: 253 })).toEqual({ watts: 253, basis: 'max-turbo' });
    expect(cpuPeakPower({ base_power_watts: 120, max_turbo_power_watts: null })).toEqual({ watts: 120, basis: 'rated-base' });
    expect(cpuPeakPower({})).toBeNull();
  });

  it('formats both figures, or the single rated TDP', () => {
    expect(formatCpuPower({ base_power_watts: 65, max_turbo_power_watts: 117 })).toBe('65W base / 117W max turbo');
    expect(formatCpuPower({ base_power_watts: 120, max_turbo_power_watts: null })).toBe('120W TDP');
  });
});

describe('PSU and cooler checks use peak CPU power', () => {
  const psu = (wattage: number) => ({ name: `PSU ${wattage}`, wattage });
  const gpu = { name: 'GPU', tdp_watts: 300 };

  it('sizes the PSU on the i5-12400F maximum turbo power (117 W), not its 65 W base', () => {
    // 300 + 117 + 100 = 517 W required. A 500 W unit used to pass on 300 + 65 + 100 = 465 W.
    const result = checkCompatibility({ gpu, cpu: byId('i5-12400f'), psu: psu(500) });
    const warning = result.warnings.find((w) => w.id === 'psu-insufficient');
    expect(warning?.detail).toContain('CPU max turbo (117W)');
  });

  it('labels an AMD figure as its rated TDP', () => {
    const result = checkCompatibility({ gpu, cpu: byId('r7-9800x3d'), psu: psu(500) });
    const warning = result.warnings.find((w) => w.id === 'psu-insufficient' || w.id === 'psu-tight');
    expect(warning?.detail).toContain('CPU rated TDP (120W)');
  });

  it('flags a 150 W air cooler on a Core Ultra 9 285K (250 W max turbo)', () => {
    const result = checkCompatibility({
      cpu: byId('cu9-285k'),
      cooler: { name: 'Small air', type: 'Air', max_tdp_watts: 150 },
    });
    const warning = result.warnings.find((w) => w.id === 'cooler-undersized');
    expect(warning?.detail).toContain('250W (maximum turbo power)');
  });

  it('gives no power verdict when a selected CPU publishes no figure at all', () => {
    const result = checkCompatibility({ gpu, cpu: { name: 'Unknown', socket: 'AM5', supported_ram: ['DDR5'] }, psu: psu(1000) });
    expect(result.passed).not.toContain('PSU wattage');
    expect(result.skipped.map((s) => s.id)).toContain('psu-capacity');
  });
});
