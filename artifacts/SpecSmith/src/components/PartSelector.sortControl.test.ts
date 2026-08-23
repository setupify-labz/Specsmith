import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The sort control ("Performance" / "Price" / "Value") used to render with the
// browser's native select appearance. The UA draws the dropdown arrow inside
// the element's right padding, so the label ran straight into it with no
// breathing room, and the arrow's weight and colour came from the operating
// system rather than the design system — different on macOS, Windows and
// Linux, and different again from the lucide icon in the search field beside
// it.
//
// There is no component-render tooling in this project (no jsdom, no
// testing-library), and pulling those in for one control would be a large
// dependency for a small fix. So this asserts the structure in the source,
// which is cheap and still catches a regression. The visual result is verified
// separately by a real Playwright capture of /compare.

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'PartSelector.tsx'), 'utf-8');

/** The JSX for the sort <select>, including the wrapper that positions its icon. */
const sortControl = (() => {
  const start = source.indexOf('aria-label="Sort by"');
  expect(start, 'the sort control should exist').toBeGreaterThan(-1);
  // Widen back to the wrapping element and forward past the chevron.
  return source.slice(Math.max(0, start - 400), start + 900);
})();

describe('the part sort control is styled by the design system, not the OS', () => {
  it('suppresses the native select appearance', () => {
    expect(sortControl).toContain('appearance-none');
  });

  it('reserves room on the right for its own icon', () => {
    // Without this the label collides with the chevron.
    expect(sortControl).toMatch(/pr-9|pr-10|pr-8/);
  });

  it('renders a lucide chevron, matching the search field beside it', () => {
    expect(sortControl).toContain('<ChevronDown');
    expect(source).toMatch(/import[\s\S]*ChevronDown[\s\S]*from 'lucide-react'/);
  });

  it('keeps the icon out of the control\'s hit area', () => {
    // A chevron that swallows clicks would stop the select from opening.
    expect(sortControl).toContain('pointer-events-none');
  });

  it('hides the decorative icon from assistive tech, keeping the select labelled', () => {
    expect(sortControl).toContain('aria-hidden="true"');
    expect(sortControl).toContain('aria-label="Sort by"');
  });

  it('still offers exactly the three sort modes', () => {
    for (const value of ['performance', 'price', 'value']) {
      expect(sortControl).toContain(`value="${value}"`);
    }
  });
});
