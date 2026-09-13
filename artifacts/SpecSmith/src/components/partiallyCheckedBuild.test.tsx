// @vitest-environment jsdom
//
// A PARTIALLY CHECKED BUILD MUST NOT LOOK LIKE A CLEARED ONE.
//
// Withholding unsourced per-unit figures is the right call — a clearance
// verdict from a typical-model length is a confident wrong answer. But a check
// that does not run leaves nothing on screen, and nothing on screen is
// indistinguishable from a pass. The failure mode it creates is worse than the
// one it fixed: the shopper reads a green tick and buys a card that does not
// fit, or a power supply that cannot carry the build.
//
// So the skipped checks are NAMED, on every surface that shows a compatibility
// panel, and the all-clear is reserved for builds that actually earned it.

import { describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import CompatibilityBanner from './CompatibilityBanner';
import { checkCompatibility, describeSkippedChecks, type SkippedCheck } from '../lib/compatibility';
import { compatibilityView } from '../lib/retail/partIdentity';
import { CANONICAL_RTX5070, CASE_295MM } from '../lib/retail/__fixtures__/catalogFixture';

const CPU = { id: 'c', name: 'Fixture CPU', socket: 'AM5', supported_ram: ['DDR5'], tdp_watts: 105 };
const PSU = { id: 'p', name: 'Fixture 750W', wattage: 750 };
const MOBO = { id: 'm', name: 'Fixture Board', socket: 'AM5', supported_ram: ['DDR5'], form_factor: 'ATX' };

/** A real build as the Builder assembles it: a GPU with no sourced figures. */
const partialResult = () =>
  checkCompatibility({
    gpu: compatibilityView(CANONICAL_RTX5070 as never, 'canonical'),
    cpu: CPU as never,
    motherboard: MOBO as never,
    psu: PSU as never,
    case: CASE_295MM as never,
  });

const renderBanner = (result: ReturnType<typeof checkCompatibility>) =>
  render(
    <CompatibilityBanner warnings={result.warnings} passed={result.passed} skipped={result.skipped} />,
  );

describe('the checker reports what it could not answer', () => {
  it('names GPU clearance and PSU capacity, with the facts each one lacked', () => {
    const result = partialResult();
    const ids = result.skipped.map((check) => check.id);
    expect(ids).toContain('gpu-clearance');
    expect(ids).toContain('psu-capacity');
    // Some checks DID run — that is what makes this dangerous. A build with
    // nothing checked reads as unchecked; this one reads as cleared.
    expect(result.passed.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('does not record a skip for a check that simply does not apply', () => {
    // No case selected: "will the card fit" is not a question with a missing
    // answer, it is not a question yet. Recording it would train people to
    // ignore the notice.
    const noCase = checkCompatibility({
      gpu: compatibilityView(CANONICAL_RTX5070 as never, 'canonical'),
      cpu: CPU as never,
      motherboard: MOBO as never,
    });
    expect(noCase.skipped.map((check) => check.id)).not.toContain('gpu-clearance');
  });

  it('writes one sentence naming every skipped check and why', () => {
    const sentence = describeSkippedChecks(partialResult().skipped);
    expect(sentence).toMatch(/GPU clearance/);
    expect(sentence).toMatch(/PSU capacity/);
    expect(sentence).toMatch(/not checked because/);
    expect(sentence).toMatch(/exact card dimensions/);
    expect(sentence).toMatch(/exact power draw/);
  });

  it('says nothing when nothing was skipped', () => {
    expect(describeSkippedChecks([])).toBeNull();
  });

  it('does not repeat a reason shared by two checks', () => {
    const shared: SkippedCheck[] = [
      { id: 'a', label: 'A', because: 'exact card dimensions' },
      { id: 'b', label: 'B', because: 'exact card dimensions' },
    ];
    const sentence = describeSkippedChecks(shared) ?? '';
    expect(sentence.match(/exact card dimensions/g)).toHaveLength(1);
  });
});

describe('the banner cannot present a partially checked build as cleared', () => {
  it('states the skipped checks on screen', () => {
    const { container } = renderBanner(partialResult());
    const note = within(container).getByTestId('compat-skipped');
    expect(note.textContent).toMatch(/GPU clearance and PSU capacity were not checked because/);
    expect(note.textContent).toMatch(/Check these yourself against the exact products/);
    cleanup();
  });

  it('withholds the green all-clear and says the build is only partially checked', () => {
    const { container } = renderBanner(partialResult());
    const text = container.textContent ?? '';
    expect(text).toMatch(/only partially checked/i);
    // The tick is a claim about the whole build. Colour is the fastest thing
    // read on this banner and the last thing anyone re-reads.
    expect(container.querySelector('[style*="var(--ff-green)"]')).toBeNull();
    cleanup();
  });

  it('but still gives the all-clear to a build with nothing outstanding', () => {
    // POSITIVE CONTROL. The notice must not become permanent furniture: a
    // build whose applicable checks all ran still reads as cleared.
    const clear = checkCompatibility({ cpu: CPU as never, motherboard: MOBO as never });
    expect(clear.skipped).toEqual([]);
    const { container } = renderBanner(clear);
    expect(container.textContent).not.toMatch(/only partially checked/i);
    expect(within(container).queryByTestId('compat-skipped')).toBeNull();
    expect(container.querySelector('[style*="var(--ff-green)"]')).not.toBeNull();
    cleanup();
  });

  it('names them alongside warnings too, not only on an otherwise clean build', () => {
    // A build can have a real failure AND an unanswered question. Showing the
    // failure and swallowing the question would let someone fix the first and
    // believe they were done.
    const withWarning = checkCompatibility({
      gpu: compatibilityView(CANONICAL_RTX5070 as never, 'canonical'),
      cpu: CPU as never,
      motherboard: { ...MOBO, socket: 'LGA1700' } as never,
      psu: PSU as never,
      case: CASE_295MM as never,
    });
    expect(withWarning.warnings.length).toBeGreaterThan(0);
    const { container } = renderBanner(withWarning);
    expect(within(container).getByTestId('compat-skipped').textContent).toMatch(/GPU clearance/);
    cleanup();
  });
});
