// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from '../../lib/retail/partCatalog';
import ProductDetailDrawer from './ProductDetailDrawer';

// BEHAVIOUR, NOT MARKUP.
//
// `aria-modal="true"` is an announcement to a screen reader, not a mechanism:
// it makes no promise about the tab ring, the page behind, or where focus goes
// on close. So none of these assert an attribute. Each one drives the dialog
// the way a keyboard does and checks what actually happened.

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const part = parsed.catalog.parts.find((candidate) => candidate.category === 'gpu')!;
const NOW = Date.parse(part.fetchedAt) + 60_000;

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

/** Renders a trigger outside the dialog, focuses it, then opens — the real sequence. */
function openFromTrigger(onClose = vi.fn()) {
  const trigger = document.createElement('button');
  trigger.textContent = 'Open details';
  trigger.setAttribute('data-testid', 'outside-trigger');
  document.body.appendChild(trigger);
  trigger.focus();

  const view = render(
    <ProductDetailDrawer part={part} now={NOW} selected={false} onClose={onClose} onToggle={vi.fn()} />,
  );
  return { trigger, view, onClose };
}

const dialog = () => screen.getByTestId('product-detail');

const focusables = (): HTMLElement[] =>
  Array.from(
    dialog().querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');

describe('Tab and Shift+Tab stay inside the open dialog', () => {
  it('sends the first Tab to the first control in the dialog, not out to the page', () => {
    openFromTrigger();
    const items = focusables();
    expect(items.length).toBeGreaterThan(1);

    // Focus starts on the dialog container itself, which counts as the edge.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('wraps from the last control back to the first', () => {
    openFromTrigger();
    const items = focusables();
    items[items.length - 1].focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('wraps backwards from the first control to the last', () => {
    openFromTrigger();
    const items = focusables();
    items[0].focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('pulls focus back in when it has escaped to the page behind', () => {
    const { trigger } = openFromTrigger();
    // Whatever put focus outside — a stray programmatic focus, a browser
    // quirk — the next Tab returns to the dialog rather than continuing
    // through the grid.
    trigger.focus();
    expect(dialog().contains(document.activeElement)).toBe(false);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusables()[0]);
  });

  it('leaves an unmodified Tab alone in the middle of the ring, so the browser moves normally', () => {
    openFromTrigger();
    const items = focusables();
    items[0].focus();

    // Not at either edge: the trap must not hijack this, or every Tab would
    // land on the first control and the ring would never advance.
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
  });
});

describe('the page behind the dialog cannot scroll', () => {
  it('locks body scrolling while open', () => {
    expect(document.body.style.overflow).toBe('');
    openFromTrigger();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores scrolling when the dialog closes', () => {
    const { view } = openFromTrigger();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the PREVIOUS value rather than clearing it', () => {
    // Composes with anything else that had already locked scrolling, instead
    // of unlocking the page on someone else's behalf.
    document.body.style.overflow = 'clip';
    const { view } = openFromTrigger();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('clip');
  });
});

describe('Escape and the backdrop still close it', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    openFromTrigger(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    openFromTrigger(onClose);
    fireEvent.click(screen.getByLabelText('Close product details', { selector: 'button.absolute' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('focus goes back where it came from', () => {
  it('returns focus to the element that opened the dialog', () => {
    const { trigger, view } = openFromTrigger();
    // Focus moved into the dialog on open.
    expect(document.activeElement).toBe(dialog());

    view.unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus even after the reader tabbed around inside first', () => {
    const { trigger, view } = openFromTrigger();
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog().contains(document.activeElement)).toBe(true);

    view.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
