// Keyboard focus helpers shared by the Builder's modal dialogs: the product
// detail drawer and the mobile build sheet. Moved here unchanged from
// ProductDetailDrawer so both trap Tab by one rule.

/**
 * Everything inside the dialog a keyboard can land on, in document order.
 *
 * Disabled and aria-hidden elements are excluded because they are not
 * reachable; visibility is deliberately NOT tested by geometry, since a
 * layout-free test environment reports every element as unrendered and would
 * empty this list.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Keeps Tab and Shift+Tab inside the dialog.
 *
 * `aria-modal` tells a screen reader the rest of the page is inert; it does
 * nothing to the tab ring, so without this a keyboard user tabs straight out
 * of an open modal and into the grid behind it — still able to reach controls
 * the dialog is covering, with no way back except Escape.
 *
 * Focus sitting on the dialog container itself counts as "at the edge": that
 * is where focus starts, so the first Tab has to land on the first control
 * and the first Shift+Tab on the last.
 */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const items = focusableWithin(root);
  if (items.length === 0) {
    // Nothing to move to, so the only correct behaviour is to stay put.
    event.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !root.contains(active) || active === root;

  if (event.shiftKey) {
    if (outside || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (outside || active === last) {
    event.preventDefault();
    first.focus();
  }
}
