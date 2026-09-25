// @vitest-environment jsdom
//
// #155. The generated storyboard's evidence beat said
// "REAL SPECS • REAL PRICES • REAL RULES" over a capture of the Compare page,
// and the narration said "Verified inputs decide it." and "SpecSmith settles it
// on verified facts alone." Compare shows no prices, runs no compatibility
// check, and labels its FPS figures "SpecSmith model estimates, not measured
// benchmarks".
//
// These tests hold the storyboard to what the page actually RENDERS. Compare is
// rendered here at the exact route the capture pipeline plans for the proven
// idea, and at every state in its capture sequence. They check the page's text,
// not Compare.tsx's source, so changing either side without the other fails.

import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Compare from '../../src/pages/Compare';
import { ToastProvider } from '../../src/context/ToastContext';
import gpuData from '../../src/data/gpus.json';
import cpuData from '../../src/data/cpus.json';
import { COMPARE_IDEA } from './compareIdeaFixture.ts';
import { buildContentPackage } from './contentPackage.ts';
import {
  assertCompareCopyIsSupported,
  beatCopyFor,
  buildScriptStoryboardPackage,
  COMPARE_BEAT_COPY,
  unsupportedCompareClaims,
} from './scriptStoryboard.ts';
import { buildStrategyBatch } from './strategist.ts';
import type { ContentIdea, HardwareItem, PlatformScriptStoryboard, SiteFeature } from './types.ts';
import { deriveUiRenderState } from './uiRender/planUiRenderState.ts';
import { planSurface } from './uiRender/surfaces.ts';

beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
});

afterEach(cleanup);

const GENERATED_AT = new Date('2026-09-25T12:00:00Z');

/** Everything a viewer of this script sees or hears. */
function viewerCopy(script: PlatformScriptStoryboard): string[] {
  return [script.title, script.finalCta, ...script.beats.flatMap((beat) => [beat.onScreenText, beat.narration])];
}

/** The route the capture pipeline visits for the proven Compare idea. */
function capturedCompareRoute(): string {
  const request = deriveUiRenderState({
    feature: COMPARE_IDEA.productConnection.feature,
    subjectIds: COMPARE_IDEA.subjectIds,
    ideaId: COMPARE_IDEA.id,
  });
  if (!request) throw new Error('The proven Compare idea no longer derives a capture state.');
  return planSurface(request).route;
}

/** The page text at `route`, whitespace collapsed. */
function renderedText(route: string): string {
  const { container } = render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <Compare />
      </ToastProvider>
    </MemoryRouter>,
  );
  const text = (container.textContent ?? '').replace(/\s+/g, ' ');
  cleanup();
  return text;
}

/** The captured route re-pointed at each state the capture sequence clicks through. */
function capturedStates(): { label: string; route: string }[] {
  const base = capturedCompareRoute();
  const [path, query = ''] = base.split('?');
  const at = (res: string, preset: string) => {
    const params = new URLSearchParams(query);
    params.set('res', res);
    params.set('preset', preset);
    return `${path}?${params.toString()}`;
  };
  return [
    { label: 'as planned', route: base },
    { label: '1080p high', route: at('1080p', 'high') },
    { label: '1440p high', route: at('1440p', 'high') },
    { label: '4K high', route: at('4k', 'high') },
    { label: '4K ultra', route: at('4k', 'ultra') },
  ];
}

describe('the Compare storyboard says only what the captured Compare page shows', () => {
  it.each(capturedStates())('the page backs every Compare line at $label', ({ route }) => {
    const text = renderedText(route).toLowerCase();
    for (const copy of [COMPARE_BEAT_COPY.evidence, COMPARE_BEAT_COPY.payoff]) {
      expect(copy.backedBy.length, `"${copy.onScreenText}" names no page text`).toBeGreaterThan(0);
      for (const phrase of copy.backedBy) {
        expect(text, `"${copy.onScreenText}" relies on "${phrase}"`).toContain(phrase.toLowerCase());
      }
    }
  });

  it.each(capturedStates())('the page at $label has no price, compatibility or verification to claim', ({ route }) => {
    const text = renderedText(route);
    // If one of these ever appears, the claim guard may be too strict. That is
    // a reviewed change to the guard, not something to discover in a video.
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/compatib/i);
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).toMatch(/model estimates, not measured benchmarks/i);
  });

  it('the capture really is the proven idea\'s two GPUs', () => {
    const text = renderedText(capturedCompareRoute());
    const request = deriveUiRenderState({
      feature: 'compare', subjectIds: COMPARE_IDEA.subjectIds, ideaId: COMPARE_IDEA.id,
    });
    for (const expected of planSurface(request!).expectedText) expect(text).toContain(expected);
  });

  it('every platform script of the proven idea uses the page-backed copy and nothing unsupported', () => {
    const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, buildContentPackage(COMPARE_IDEA, GENERATED_AT));
    expect(storyboard.scripts).toHaveLength(3);
    for (const script of storyboard.scripts) {
      const evidence = script.beats.find((beat) => beat.purpose === 'evidence')!;
      const payoff = script.beats.find((beat) => beat.purpose === 'payoff')!;
      expect(evidence.onScreenText).toBe(COMPARE_BEAT_COPY.evidence.onScreenText);
      expect(evidence.narration).toBe(COMPARE_BEAT_COPY.evidence.narration);
      expect(payoff.onScreenText).toBe(COMPARE_BEAT_COPY.payoff.onScreenText);
      expect(payoff.narration).toBe(COMPARE_BEAT_COPY.payoff.narration);
      for (const line of viewerCopy(script)) {
        expect(unsupportedCompareClaims(line), `${script.platform}: "${line}"`).toEqual([]);
      }
      expect(viewerCopy(script).join(' ')).not.toMatch(/REAL PRICES/i);
    }
  });

  it('every Compare idea the strategist generates from the real catalogue passes', () => {
    const gpus = gpuData as unknown as HardwareItem[];
    const cpus = cpuData as unknown as HardwareItem[];
    const compareIdeas = buildStrategyBatch(gpus, cpus, GENERATED_AT).candidates
      .filter((idea) => idea.productConnection.feature === 'compare');
    expect(compareIdeas.length).toBeGreaterThan(0);
    // Both title and hook variants must be covered, not just the first.
    expect(new Set(compareIdeas.map((idea) => idea.format)).size).toBe(2);
    for (const idea of compareIdeas) {
      const storyboard = buildScriptStoryboardPackage(idea, buildContentPackage(idea, GENERATED_AT));
      for (const script of storyboard.scripts) {
        for (const line of viewerCopy(script)) {
          expect(unsupportedCompareClaims(line), `${idea.id} ${script.platform}: "${line}"`).toEqual([]);
        }
      }
    }
  });
});

describe('unsupported claims cannot come back', () => {
  // Every line here was generated, or would have been, before #155.
  it.each([
    ['REAL SPECS • REAL PRICES • REAL RULES', /price/],
    ['Verified inputs decide it.', /verification/],
    ['SpecSmith settles it on verified facts alone.', /verification/],
    ['RTX 4080 Super vs RTX 4080: where does the extra $200 actually go?', /dollar/],
    ['These GPUs are $200 apart. Is the expensive one actually the smarter choice?', /dollar/],
    ['Two GPUs. Names hidden. Pick one before SpecSmith reveals what your money actually buys.', /price or cost/],
    ['You only get the prices and specs. Pick one now.', /price or cost/],
    ['Can you pick the faster card before the names show?', /performance stated as fact/],
    ['REAL SPECS • PERFORMANCE ESTIMATES • COMPATIBILITY RULES', /compatibility/],
    ['Measured FPS from real benchmarks.', /measurement/],
    ['Live prices from real retailers.', /price/],
  ])('refuses "%s"', (line, reason) => {
    const found = unsupportedCompareClaims(line);
    expect(found.length, `"${line}" was accepted`).toBeGreaterThan(0);
    expect(found.join('; ')).toMatch(reason);
  });

  it.each([
    COMPARE_BEAT_COPY.evidence.onScreenText,
    COMPARE_BEAT_COPY.evidence.narration,
    COMPARE_BEAT_COPY.payoff.onScreenText,
    COMPARE_BEAT_COPY.payoff.narration,
    'FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.',
    'Which card does SpecSmith estimate higher? Pick before the names show.',
  ])('accepts the page-backed line "%s"', (line) => {
    expect(unsupportedCompareClaims(line)).toEqual([]);
  });

  it('allows the page\'s own disclaimer but not a benchmark claim beside it', () => {
    expect(unsupportedCompareClaims('Model estimates, not measured benchmarks.')).toEqual([]);
    expect(unsupportedCompareClaims('Model estimates, not benchmarks. Benchmarked on real hardware.').join(' '))
      .toMatch(/measurement/);
  });

  it('refuses to generate a Compare storyboard whose idea copy claims prices', () => {
    const idea: ContentIdea = { ...COMPARE_IDEA, hook: 'Real prices, real specs. Pick one.' };
    expect(() => buildScriptStoryboardPackage(idea, buildContentPackage(idea, GENERATED_AT)))
      .toThrow(/claims the Compare page does not support: hook narration/);
  });

  it('refuses a Compare storyboard whose title claims a dollar gap', () => {
    const idea: ContentIdea = { ...COMPARE_IDEA, title: 'RTX 4080 Super vs RTX 4080: is the extra $200 worth it?' };
    expect(() => buildScriptStoryboardPackage(idea, buildContentPackage(idea, GENERATED_AT)))
      .toThrow(/title — a dollar amount/);
  });

  it('checks the template beats too, not only the idea\'s copy', () => {
    const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, buildContentPackage(COMPARE_IDEA, GENERATED_AT));
    const script = storyboard.scripts[0];
    const reverted: PlatformScriptStoryboard = {
      ...script,
      beats: script.beats.map((beat) => beat.purpose === 'evidence'
        ? { ...beat, onScreenText: 'REAL SPECS • REAL PRICES • REAL RULES', narration: 'Verified inputs decide it.' }
        : beat),
    };
    expect(() => assertCompareCopyIsSupported(reverted)).toThrow(/evidence on-screen text/);
    expect(() => assertCompareCopyIsSupported(reverted)).toThrow(/evidence narration/);
  });
});

describe('surfaces nobody has verified get claim-free wording', () => {
  const others: SiteFeature[] = ['builder', 'upgrade', 'build-crate', 'gallery', 'price-guesser', 'parts-catalog', 'build-guides'];

  it.each(others)('%s: the template claims no price, verification or measurement', (feature) => {
    const copy = beatCopyFor(feature);
    expect(copy).not.toBe(COMPARE_BEAT_COPY);
    for (const line of [copy.evidence.onScreenText, copy.evidence.narration, copy.payoff.onScreenText, copy.payoff.narration]) {
      expect(unsupportedCompareClaims(line), `${feature}: "${line}"`).toEqual([]);
    }
  });
});
