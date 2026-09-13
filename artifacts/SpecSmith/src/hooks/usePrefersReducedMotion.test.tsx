// @vitest-environment jsdom
// Regression cover for a real defect found while rendering PR #92's video:
// Compare's FPS bar chart animated for ~420ms regardless of the viewer's
// "reduce motion" setting, because Recharts drives that animation from
// JavaScript where index.css's prefers-reduced-motion rules cannot reach it.
//
// Two halves, because either alone would pass while the bug was live:
//   1. the hook reports the setting, and keeps reporting it when it changes;
//   2. every <Bar> in Compare actually consults the hook.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePrefersReducedMotion } from './usePrefersReducedMotion';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A matchMedia stand-in whose answer can be changed the way a real OS setting can. */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initial;
  const list = {
    get matches() { return matches; },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => { listeners.delete(fn); },
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    listenerCount: () => listeners.size,
    set(next: boolean) {
      matches = next;
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePrefersReducedMotion', () => {
  it('reports a stated preference for reduced motion', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reports no preference when none is stated', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('follows the setting when the viewer changes it mid-session', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount rather than leaking a listener', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('does not throw where matchMedia does not exist, as during prerender', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe('the Compare chart consults that preference', () => {
  // Comment lines are stripped first: prose describing the rule must never be
  // what satisfies it.
  const source = fs
    .readFileSync(path.join(here, '..', 'pages', 'Compare.tsx'), 'utf-8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

  it('calls the hook', () => {
    expect(source).toMatch(/const\s+prefersReducedMotion\s*=\s*usePrefersReducedMotion\(\)/);
  });

  it('turns off the Recharts animation for every bar, not just the first', () => {
    const bars = source.match(/<Bar\b[^>]*>/g) ?? [];
    expect(bars.length, 'expected the comparison chart to still draw bars').toBeGreaterThanOrEqual(2);
    for (const bar of bars) {
      expect(bar, `a <Bar> animates regardless of the reduced-motion setting: ${bar}`)
        .toMatch(/isAnimationActive=\{!prefersReducedMotion\}/);
    }
  });
});
