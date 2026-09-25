// @vitest-environment jsdom
//
// #156. The downloadable and copied Build Card took a bare number per row and
// printed "$X", or "Retailer price" when a catalogue part had no price. So an
// exported card dropped the distinction the Build Summary beside it makes, and
// called a missing catalogue price a retailer price.
//
// jsdom has no canvas, so these tests install a 2D context that records every
// string drawn into the image and hand it to the real card code. What is
// asserted is exactly the text that ends up in the exported PNG.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCardPriceSummary,
  buildCardPriceText,
  copyBuildCardToClipboard,
  downloadBuildCard,
  generateBuildCardCanvas,
  type BuildCardPart,
} from './buildCard';
import { catalogueEstimatePrice, UNKNOWN_PART_PRICE } from './partPrice';
import { PRICES_UPDATED } from './prices';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from '../pages/Builder';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';

/** Every string the card draws, in order, for each canvas created. */
let drawn: string[][] = [];

function installRecordingCanvas() {
  const gradient = { addColorStop: () => undefined };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    const texts: string[] = [];
    drawn.push(texts);
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop === 'fillText') return (text: string) => { texts.push(text); };
        // A fixed-width measure is enough for wrapping to be exercised.
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => undefined;
      },
      set(target, prop: string, value) { target[prop] = value; return true; },
    });
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(cb: BlobCallback) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
  vi.stubGlobal('Path2D', class { constructor() { /* recorded nowhere */ } });
}

const ESTIMATE: BuildCardPart = { label: 'GPU', name: 'RTX 5090', price: { kind: 'catalogue', price: catalogueEstimatePrice('gpu', 3979) } };
const COMPONENT: BuildCardPart = { label: 'Motherboard', name: 'ASUS ROG Maximus Z890 Hero', price: { kind: 'catalogue', price: catalogueEstimatePrice('motherboard', 629) } };
const ENTERED: BuildCardPart = { label: 'Custom', name: 'Fan kit', price: { kind: 'user-entered', amount: 40 } };
const MISSING: BuildCardPart = { label: 'Case', name: 'Fixture case', price: { kind: 'catalogue', price: UNKNOWN_PART_PRICE } };

const card = (parts: BuildCardPart[]) => ({ buildName: 'Test build', parts, gpu: null, cpu: null });
const lastDrawn = () => drawn[drawn.length - 1];

beforeEach(() => {
  drawn = [];
  installRecordingCanvas();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('each row says what its figure is', () => {
  it('a catalogue estimate is "Est.", an entered price is "your price", a missing one is "No catalogue price"', () => {
    expect(buildCardPriceText(ESTIMATE.price)).toBe('Est. $3,979');
    expect(buildCardPriceText(ENTERED.price)).toBe('$40 (your price)');
    expect(buildCardPriceText(MISSING.price)).toBe('No catalogue price');
  });

  it('never calls a missing catalogue price a retailer price', () => {
    for (const part of [ESTIMATE, ENTERED, MISSING]) {
      expect(buildCardPriceText(part.price)).not.toMatch(/retail/i);
    }
  });
});

describe('the exported image carries all three, and a total that says what it contains', () => {
  it('draws every row with its provenance and names what the total leaves out', () => {
    generateBuildCardCanvas(card([ESTIMATE, COMPONENT, ENTERED, MISSING]));
    const texts = lastDrawn();

    expect(texts).toContain('Est. $3,979');
    expect(texts).toContain('Est. $629');
    expect(texts).toContain('$40 (your price)');
    expect(texts).toContain('No catalogue price');
    expect(texts.join(' | ')).not.toMatch(/Retailer price|retailer/i);
    // No bare catalogue figure anywhere in the image.
    expect(texts.filter((t) => /^\$[\d,]+$/.test(t))).toEqual([]);

    // Header figure and total row: an estimate, and a subtotal because the
    // case has no price.
    expect(texts.filter((t) => t === 'Est. $4,648')).toHaveLength(2);
    expect(texts).toContain('KNOWN-PRICE SUBTOTAL');
    const note = texts.slice(texts.indexOf('KNOWN-PRICE SUBTOTAL')).join(' ');
    expect(note).toContain('SpecSmith estimates');
    expect(note).toContain('1 price you entered');
    expect(note).toContain('excludes Case (no catalogue price)');
    // A component is in the sum, so the universal date is not claimed.
    expect(texts.join(' ')).not.toContain(PRICES_UPDATED);
  });

  it('estimates only, all from a dated source: an estimated total with the date in its note', () => {
    generateBuildCardCanvas(card([ESTIMATE]));
    const texts = lastDrawn();
    expect(texts).toContain('ESTIMATED TOTAL');
    expect(texts.filter((t) => t === 'Est. $3,979').length).toBe(3); // header, row, total
    expect(texts).toContain(`SpecSmith estimate · updated ${PRICES_UPDATED}`);
  });

  it('entered prices only: not an estimate, and says whose prices they are', () => {
    generateBuildCardCanvas(card([ENTERED]));
    const texts = lastDrawn();
    expect(texts).toContain('TOTAL OF YOUR PRICES');
    expect(texts.filter((t) => t === '$40')).toHaveLength(2); // header and total
    expect(texts).toContain('1 price you entered');
    expect(texts.join(' ')).not.toMatch(/Est\./);
  });

  it('only a missing price: no figure is invented', () => {
    generateBuildCardCanvas(card([MISSING]));
    const texts = lastDrawn();
    expect(texts).toContain('Budget TBD');
    expect(texts).toContain('No catalogue price');
    expect(texts).toContain('KNOWN-PRICE SUBTOTAL');
    expect(texts.join(' ')).not.toMatch(/Est\.|retailer/i);
  });

  it('the card and the Build Summary describe the total identically', () => {
    const { total, headline, totalLabel } = buildCardPriceSummary([ESTIMATE, ENTERED, MISSING]);
    expect(headline).toBe(total.amountText);
    expect(totalLabel).toBe(total.label.toUpperCase());
  });
});

describe('both export paths draw the same provenance', () => {
  it('Download PNG', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    await downloadBuildCard(card([ESTIMATE, ENTERED, MISSING]));
    expect(lastDrawn()).toEqual(expect.arrayContaining(['Est. $3,979', '$40 (your price)', 'No catalogue price', 'KNOWN-PRICE SUBTOTAL']));
  });

  it('Copy to clipboard', async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    await copyBuildCardToClipboard(card([ESTIMATE, ENTERED, MISSING]));
    expect(write).toHaveBeenCalledTimes(1);
    expect(lastDrawn()).toEqual(expect.arrayContaining(['Est. $3,979', '$40 (your price)', 'No catalogue price', 'KNOWN-PRICE SUBTOTAL']));
  });
});

describe('the card exported from the real Build Summary', () => {
  it('carries the panel\'s estimate and entered-price wording into the image', async () => {
    window.localStorage.clear();
    vi.stubGlobal('scrollTo', vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const gpu = (gpuData as { id: string; price_usd: number }[])[0];
    const cpu = (cpuData as { id: string; price_usd: number }[])[0];

    render(
      <MemoryRouter initialEntries={[`/builder?gpu=${gpu.id}&cpu=${cpu.id}`]}>
        <ToastProvider>
          <AuthProvider>
            <Builder />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const fallback = await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
    fireEvent.click(within(fallback).getByRole('button', { name: /Add custom part/ }));
    fireEvent.change(within(fallback).getByPlaceholderText(/Part name/), { target: { value: 'Fan kit' } });
    fireEvent.change(within(fallback).getByPlaceholderText('Price ($)'), { target: { value: '40' } });
    fireEvent.click(within(fallback).getByRole('button', { name: 'Add' }));
    await within(fallback).findByText('Fan kit');

    drawn = [];
    fireEvent.click(within(fallback).getByTitle('Download as PNG'));
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    const texts = lastDrawn();
    const gpuFigure = `Est. $${gpu.price_usd.toLocaleString('en-US')}`;
    const cpuFigure = `Est. $${cpu.price_usd.toLocaleString('en-US')}`;
    const totalFigure = `Est. $${(gpu.price_usd + cpu.price_usd + 40).toLocaleString('en-US')}`;
    expect(texts).toContain(gpuFigure);
    expect(texts).toContain(cpuFigure);
    expect(texts).toContain('$40 (your price)');
    expect(texts).toContain('ESTIMATED TOTAL');
    expect(texts.filter((t) => t === totalFigure)).toHaveLength(2);
    expect(texts.join(' ')).toContain(`SpecSmith estimates · updated ${PRICES_UPDATED} + 1 price you entered`);
    expect(texts.join(' ')).not.toMatch(/Retailer price/);
    // The panel and the image agree.
    expect(within(fallback).getByTestId('summary-total-amount').textContent).toBe(totalFigure);
  }, 30000);
});
