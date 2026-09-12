// @vitest-environment jsdom
//
// THE CALL SITE, not the helper.
//
// `compatibilityView` withholding per-unit fields is unit-tested in
// src/lib/retail/partIdentity.test.ts. That proves the helper. It does not
// prove that Builder.tsx CALLS it — and the defect lived in the wiring: the
// page resolved a retailer listing to the canonical `rtx5070` record and
// handed the record's 290 mm straight to the clearance check.
//
// So these tests drive the real page through a real entry point and read what
// a shopper would see. Delete the `compatibilityView(...)` call from
// Builder.tsx and the first test goes red.
//
// The listing is a FIXTURE. `public/data/retail-parts.json` is regenerated
// from a live feed, so any particular SKU in it may be gone next week, and the
// refresh that lands this split writes `specsVerified: false` on every row.
// The canonical record IS the real one, because the whole question is what the
// page does with real editorial figures.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import gpusJson from '../data/gpus.json';
import realComponents from '../data/components.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { catalogueContaining, rtx5070Listing, RTX5070_LISTING_ID } from '../lib/retail/__fixtures__/catalogFixture';

const canonicalGpu = (gpusJson as unknown as Array<Record<string, unknown> & { id: string }>).find(
  (gpu) => gpu.id === 'rtx5070',
)!;
const CANONICAL_LENGTH_MM = canonicalGpu.length_mm as number;

/**
 * A clearance five millimetres above the canonical length.
 *
 * That is inside the fifteen-millimetre margin the checker treats as tight, so
 * the canonical selection produces a VISIBLE warning rather than a silent
 * pass — the strongest form of the claim that must not be made about a
 * listing. Derived rather than hard-coded so a revision of the editorial
 * figure moves the case with it instead of quietly making this test vacuous.
 */
const TIGHT_CLEARANCE_MM = CANONICAL_LENGTH_MM + 5;
const TEST_CASE_ID = 'fixture-tight-case';

vi.mock('../data/components.json', async () => {
  const actual = (await vi.importActual('../data/components.json')) as { default: Record<string, unknown[]> };
  const base = actual.default.cases[0] as Record<string, unknown>;
  return {
    default: {
      ...actual.default,
      cases: [
        { ...base, id: TEST_CASE_ID, name: 'Fixture Tight Case', gpu_clearance_mm: TIGHT_CLEARANCE_MM },
        ...actual.default.cases,
      ],
    },
  };
});

const catalogue = catalogueContaining(rtx5070Listing(false));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => catalogue } as unknown as Response),
    ) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const openWith = async (gpuId: string) => {
  render(
    <MemoryRouter initialEntries={[`/builder?gpu=${gpuId}&cpu=r7-7800x3d&case=${TEST_CASE_ID}`]}>
      <ToastProvider>
        <AuthProvider>
          <Builder />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
};

// Imported after the mock factory above is registered.
const { default: Builder } = await import('./Builder');

/** Every way the page can state a clearance verdict: the warnings and the passed list. */
const clearanceVerdictOnScreen = () => {
  const text = document.body.textContent ?? '';
  return {
    tightWarning: /GPU fit will be tight/i.test(text),
    tooLongWarning: /GPU is likely too long for this case/i.test(text),
    passedClearance: /Checked constraints passed:[^.]*GPU clearance/i.test(text),
  };
};

describe('the case-clearance check at the Builder call site', () => {
  it('makes NO clearance claim when the GPU is an exact retailer listing', async () => {
    await openWith(RTX5070_LISTING_ID);
    // The listing is an RTX 5070 — that much was established — but nothing
    // measured the board it ships on, and the canonical record's length
    // describes a different object. No verdict is the honest answer.
    expect(clearanceVerdictOnScreen()).toEqual({
      tightWarning: false,
      tooLongWarning: false,
      passedClearance: false,
    });
  });

  it('still makes one when the shopper picks the canonical model', async () => {
    await openWith('rtx5070');
    // Same case, same page, different origin. The figure describes the model
    // that was chosen, so the check runs — and on this case it warns. That
    // warning is exactly what the listing above must not inherit.
    expect(TIGHT_CLEARANCE_MM).toBe(295);
    expect(clearanceVerdictOnScreen().tightWarning).toBe(true);
  });
});

describe('the frame-rate estimate for that same retailer listing', () => {
  it('is offered, and labelled an estimate for the model rather than a measurement', async () => {
    await openWith(RTX5070_LISTING_ID);

    // The invitation names the mapping, which is what is actually known.
    expect(screen.getByText(/estimator supports/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^estimate fps$/i }));

    const text = document.body.textContent ?? '';
    // Resolved through the canonical identity, so the panel names the model...
    expect(text).toMatch(/RTX 5070/);
    // ...and says plainly that the number is not a measurement.
    expect(text).toMatch(/Estimated\s*—\s*not measured/i);
  });
});
