import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The header's compact/full switch, asserted against the source.
//
// WHAT WENT WRONG. The full navigation appeared from `md` (768px). At 834px
// the seven links, the theme toggle, "Sign In" and "Start Building" did not
// fit: "Sign In" wrapped onto two lines and "Start Building" was cut off by
// the right edge of the window. Every one of those controls was rendered, and
// two of them were unusable.
//
// Nothing about that is visible to a component test — jsdom has no layout, so
// it cannot tell a wrapped button from a fitting one, and it applies no media
// query. What CAN be pinned here is the rule: the full row and the hamburger
// are exact complements at one named breakpoint, and that breakpoint is wide
// enough for the row. Whether it actually fits is measured in a real browser
// by the screenshot audit, which walks 768px to 1440px and fails on overflow.

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'Navbar.tsx'), 'utf-8');
/** With comment lines dropped, so the prose above cannot satisfy a check. */
const body = source
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

describe('the header shows its full navigation only where it fits', () => {
  it('switches at xl, not at md', () => {
    expect(body).toContain('hidden xl:flex items-center gap-1');
    // The old breakpoint must be gone, not merely joined by a new one.
    expect(body).not.toContain('hidden md:flex items-center gap-1');
  });

  it('hides the hamburger exactly where the full row appears', () => {
    // Complementary, so no width can show both or neither. Two links appearing
    // to the same page from one header is a smaller problem than a width with
    // no navigation at all, and this rules out both.
    const full = [...body.matchAll(/hidden (\w+):flex items-center gap-1/g)].map((match) => match[1]);
    const compact = [...body.matchAll(/(\w+):hidden/g)].map((match) => match[1]);
    expect(full).toEqual(['xl']);
    expect(new Set(compact)).toEqual(new Set(['xl']));
  });

  it('keeps every link reachable from the compact menu', () => {
    // The links are not dropped below xl, they move. Both auth controls come
    // with them, so nothing in the header becomes unreachable on a tablet.
    const menu = body.slice(body.indexOf('{/* Mobile Menu */}'));
    expect(menu).toContain('navLinks.map');
    expect(menu).toContain('Sign In');
    expect(menu).toContain('Start Building');
  });
});
