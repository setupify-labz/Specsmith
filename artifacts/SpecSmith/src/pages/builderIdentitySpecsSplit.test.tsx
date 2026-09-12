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
// Builder.tsx and both clearance tests go red.
//
// BOTH selections are covered, because the rule is not about retail. A generic
// `rtx5070` record is a chip, and its 290 mm is a typical figure for the
// model — the same figure that was wrong for the Ventus. Picking the model
// from a menu does not turn it into a measurement, so neither selection may
// produce a clearance verdict.
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

/** A canonical PSU far too small for a 5070-class build once a draw is known. */
const SMALL_PSU_ID = 'crm750';

const openWith = async (gpuId: string, extra = '') => {
  render(
    <MemoryRouter initialEntries={[`/builder?gpu=${gpuId}&cpu=r7-7800x3d&case=${TEST_CASE_ID}${extra}`]}>
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

const NO_VERDICT = { tightWarning: false, tooLongWarning: false, passedClearance: false };

describe('the case-clearance check at the Builder call site', () => {
  it('makes NO clearance claim when the GPU is an exact retailer listing', async () => {
    await openWith(RTX5070_LISTING_ID);
    // The listing is an RTX 5070 — that much was established — but nothing
    // measured the board it ships on, and the canonical record's length
    // describes a different object. No verdict is the honest answer.
    expect(clearanceVerdictOnScreen()).toEqual(NO_VERDICT);
  });

  it('makes none for the generic canonical model either', async () => {
    // A 295 mm case against a record that says 290 mm. The old page emitted a
    // visible "GPU fit will be tight" warning here, on a figure describing a
    // typical RTX 5070 rather than any board a shopper can buy. Choosing the
    // model from a menu is not evidence about a physical card.
    expect(TIGHT_CLEARANCE_MM).toBe(295);
    await openWith('rtx5070');
    expect(clearanceVerdictOnScreen()).toEqual(NO_VERDICT);
  });
});

describe('the power check at the Builder call site', () => {
  const powerVerdictOnScreen = () => {
    const text = document.body.textContent ?? '';
    return {
      passedWattage: /Checked constraints passed:[^.]*PSU wattage/i.test(text),
      warned: /Power supply is too weak|Power headroom is tight/i.test(text),
    };
  };

  it('makes no power claim when the selected GPU has no established draw', async () => {
    // A withheld draw must not be read as a zero-watt card. A PSU IS selected
    // here, so the check would run if it could — and 750 W looks ample once
    // the GPU is silently counted as drawing nothing.
    await openWith(RTX5070_LISTING_ID, `&psu=${SMALL_PSU_ID}`);
    expect(powerVerdictOnScreen()).toEqual({ passedWattage: false, warned: false });
  });

  it('and none for the generic canonical model either', async () => {
    await openWith('rtx5070', `&psu=${SMALL_PSU_ID}`);
    expect(powerVerdictOnScreen()).toEqual({ passedWattage: false, warned: false });
  });

  it('names the skipped checks on screen instead of going quiet', async () => {
    // THE POINT OF THE WHOLE ROUND. Withholding an answer is only honest if
    // the shopper is told an answer is missing — an empty panel reads as a
    // pass, which is the more expensive misreading.
    // A motherboard and memory are selected too, so real checks DO pass and
    // the panel turns green-adjacent. That is the dangerous shape: a build
    // that looks assessed. It must read as partially assessed instead.
    await openWith(RTX5070_LISTING_ID, `&psu=${SMALL_PSU_ID}&motherboard=x670ecross&ram=kf16ddr5`);
    expect(document.body.textContent).toMatch(/Checked constraints passed:/);
    const note = screen.getByTestId('compat-skipped');
    expect(note.textContent).toMatch(/GPU clearance and PSU capacity were not checked because/);
    expect(document.body.textContent).toMatch(/only partially checked/i);
  });

  it('but a build with no GPU still gets its power verdict', async () => {
    // POSITIVE CONTROL. The check is withheld for an unknown draw, not
    // disabled: a CPU-and-PSU build is still assessed as it always was.
    render(
      <MemoryRouter initialEntries={[`/builder?cpu=r7-7800x3d&psu=${SMALL_PSU_ID}`]}>
        <ToastProvider>
          <AuthProvider>
            <Builder />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    expect(powerVerdictOnScreen().passedWattage).toBe(true);
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
