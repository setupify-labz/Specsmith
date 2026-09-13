// Reads the viewer's "reduce motion" operating-system setting, reactively.
//
// WHY THIS EXISTS WHEN src/index.css ALREADY HANDLES REDUCED MOTION
// -----------------------------------------------------------------
// index.css zeroes animation-duration and transition-duration under
// `@media (prefers-reduced-motion: reduce)`, which covers every animation the
// app expresses in CSS. It cannot cover an animation a library drives from
// JavaScript: Recharts grows its bars by re-rendering their geometry on a
// timer of its own and mounts its numeric value labels only once that finishes,
// so a viewer who asked for no motion still got a 1.5-second animated chart.
// A media query cannot switch that off; only the component can, which is what
// this hook is for.
//
// It is a real subscription, not a one-time read: a viewer can change the
// setting while the page is open, and the chart should respect the new answer
// without a reload.

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readPreference(): boolean {
  // Guarded for the prerender pass (scripts/prerender.mjs), which runs this
  // component tree in an environment with no matchMedia. "No stated
  // preference" is the correct default there — the real browser re-evaluates
  // on hydration.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(readPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    // Re-read on mount as well: the value captured by useState's initializer
    // came from the first render, which for a prerendered page was the
    // no-matchMedia default above.
    setPrefersReducedMotion(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return prefersReducedMotion;
}
