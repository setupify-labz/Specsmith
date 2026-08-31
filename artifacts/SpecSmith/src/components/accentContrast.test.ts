import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WCAG contrast for text on the solid-accent fill, in both themes.
//
// WHAT WENT WRONG. Filled accent controls — the mobile "View build" button,
// a selected "In build", an active category chip, an active brand filter —
// drew their text with `--ff-accent-text` on `--ff-accent-solid`. That token
// is the accent colour made readable against a dark NEUTRAL surface: a pale
// lilac in dark theme, a deep indigo in light. Put either on the purple fill
// and it lands near 1.5:1, which reads as a disabled control rather than a
// chosen one.
//
// `--ff-on-accent` now names the foreground that belongs on that fill, and
// this file holds the pairing to the AA floor by computing the contrast
// rather than by trusting a comment. It also scans the components, because
// a passing token pair proves nothing if a control does not use it.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..');
const css = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf-8');

/** WCAG AA for normal text. Large text may use 3:1; none of these are large. */
const AA_NORMAL = 4.5;

function blockFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

function tokenIn(block: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`no ${name} in block`);
  return match[1].trim();
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance: sRGB channels linearized, then weighted. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const THEMES = [
  { name: 'dark', block: blockFor(':root') },
  { name: 'light', block: blockFor('[data-theme="light"]') },
];

describe('the contrast formula is the real one', () => {
  it('agrees with the two anchors every WCAG implementation shares', () => {
    // Black on white is 21:1 exactly, and any colour against itself is 1:1.
    // If these drift, every number below is meaningless.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrast('#6259FF', '#6259FF')).toBeCloseTo(1, 6);
  });
});

describe('text on the solid accent fill clears WCAG AA in both themes', () => {
  for (const { name, block } of THEMES) {
    it(`${name}: --ff-on-accent on --ff-accent-solid`, () => {
      const fill = tokenIn(block, '--ff-accent-solid');
      const foreground = tokenIn(block, '--ff-on-accent');
      expect(contrast(foreground, fill)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it(`${name}: the old pairing did not, which is why this exists`, () => {
      // Kept as a live number rather than a story: if someone re-pairs these
      // two tokens, the failure above will not be a surprise.
      const fill = tokenIn(block, '--ff-accent-solid');
      const accentText = tokenIn(block, '--ff-accent-text');
      expect(contrast(accentText, fill)).toBeLessThan(2);
    });
  }
});

describe('--ff-accent-text is left alone for the job it does do', () => {
  it('still clears AA against the neutral surfaces links and accent text sit on', () => {
    // The fix must not be "darken the accent text until it works on purple",
    // which would break it everywhere it is correctly used today.
    for (const { name, block } of THEMES) {
      const accentText = tokenIn(block, '--ff-accent-text');
      for (const surface of ['--ff-bg', '--ff-surface', '--ff-card']) {
        expect(contrast(accentText, tokenIn(block, surface)), `${name} ${surface}`).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });
});

/** Every .tsx under src, so a new control cannot quietly reintroduce the pairing. */
function componentSources(): { file: string; body: string }[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
    });
  return walk(srcRoot).map((file) => ({ file: path.relative(srcRoot, file), body: fs.readFileSync(file, 'utf-8') }));
}

describe('no control pairs the accent fill with accent text', () => {
  it('never names --ff-accent-text in the same style object as --ff-accent-solid', () => {
    // The defect was local to one style object per control, so that is the
    // unit scanned: a `{ ... }` literal mentioning both tokens.
    for (const { file, body } of componentSources()) {
      for (const literal of body.match(/\{[^{}]*\}/g) ?? []) {
        const pairsThem = literal.includes('--ff-accent-solid') && literal.includes('--ff-accent-text');
        expect(pairsThem, `${file} pairs the accent fill with --ff-accent-text`).toBe(false);
      }
    }
  });

  it('uses the token rather than a Tailwind text-white utility on the fill', () => {
    // Same white by a different route. Routed through the token so that one
    // scan covers every control, whatever styling mechanism it uses.
    for (const { file, body } of componentSources()) {
      expect(/text-white[^']*bg-\[var\(--ff-accent-solid\)\]/.test(body), `${file} uses text-white on the accent fill`).toBe(false);
      expect(/bg-\[var\(--ff-accent-solid\)\][^']*text-white/.test(body), `${file} uses text-white on the accent fill`).toBe(false);
    }
  });

  it('uses the token rather than a hardcoded white next to the fill', () => {
    // Hardcoded white happens to pass today. It also silently ignores a
    // future theme where the fill is pale, and it hides these controls from
    // the scan above.
    for (const { file, body } of componentSources()) {
      for (const literal of body.match(/\{[^{}]*\}/g) ?? []) {
        if (!literal.includes('--ff-accent-solid')) continue;
        if (!/color:/.test(literal)) continue;
        expect(/#fff\b|#ffffff|'white'/i.test(literal), `${file} hardcodes white on the accent fill`).toBe(false);
      }
    }
  });
});

describe('the builder controls the review named all use the token', () => {
  const CONTROLS = [
    ['builder/RetailBuilder.tsx', 'the mobile "View build" button'],
    ['builder/RetailProductCard.tsx', 'the selected "In build" button'],
    ['builder/CategoryNav.tsx', 'the active category chip'],
    ['builder/RetailCatalog.tsx', 'the active brand filter'],
  ] as const;

  for (const [file, description] of CONTROLS) {
    it(`${description} draws its text with --ff-on-accent`, () => {
      const body = fs.readFileSync(path.join(srcRoot, 'components', file), 'utf-8');
      expect(body).toContain('--ff-on-accent');
      expect(body).toContain('--ff-accent-solid');
    });

    it(`${description} keeps a visible keyboard focus ring`, () => {
      // These are styled inline, so there is no class carrying a ring by
      // default and the UA outline sits badly on a filled pill.
      const body = fs.readFileSync(path.join(srcRoot, 'components', file), 'utf-8');
      expect(body).toContain('ff-accent-control');
    });

    it(`${description} is not dimmed when it is the chosen one`, () => {
      // The complaint was that a selected control LOOKED disabled. Contrast
      // was the cause; opacity would be a second way to cause it, so the
      // selected branch must not reach for one.
      const body = fs.readFileSync(path.join(srcRoot, 'components', file), 'utf-8');
      for (const literal of body.match(/\{[^{}]*\}/g) ?? []) {
        if (!literal.includes('--ff-on-accent')) continue;
        expect(/opacity/.test(literal), `${file} dims its own selected state`).toBe(false);
      }
    });
  }

  it('defines that focus ring once, in the stylesheet', () => {
    expect(css).toContain('.ff-accent-control:focus-visible');
    expect(css).toMatch(/\.ff-accent-control:focus-visible\s*\{[^}]*outline:/);
  });
});
