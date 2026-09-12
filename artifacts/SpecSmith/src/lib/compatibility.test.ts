import { describe, expect, it } from 'vitest';

import { checkCompatibility } from './compatibility';

describe('compatibility checks with retailer-only catalog entries', () => {
  it('does not invent passed checks or warnings when specifications are unverified', () => {
    const unknown = { name: 'Retailer listing' };
    const result = checkCompatibility({
      gpu: unknown as never,
      cpu: unknown as never,
      motherboard: unknown as never,
      ram: unknown as never,
      psu: unknown as never,
      case: unknown as never,
      cooler: unknown as never,
    });

    // `skipped` is empty too, and deliberately: a skip is recorded when a
    // check APPLIES and cannot be answered. Here the case carries no clearance
    // figure and the PSU no wattage, so there is no question to leave open —
    // nothing about this build has been asserted at all.

    expect(result).toEqual({ warnings: [], passed: [], skipped: [] });
  });

  it('runs a check only when both facts needed for that check are present', () => {
    const result = checkCompatibility({
      cpu: { name: 'Verified CPU', socket: 'AM5', supported_ram: ['DDR5'], tdp_watts: 65 },
      motherboard: { name: 'Retailer board' } as never,
      ram: { name: 'Retailer memory' } as never,
    });

    expect(result).toEqual({ warnings: [], passed: [], skipped: [] });
  });
});
