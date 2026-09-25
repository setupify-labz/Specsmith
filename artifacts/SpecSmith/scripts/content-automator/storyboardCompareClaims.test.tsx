// @vitest-environment jsdom
//
// #155. The generated storyboard's evidence beat said
// "REAL SPECS • REAL PRICES • REAL RULES" over a capture of the Compare page,
// and the narration said "Verified inputs decide it." and "SpecSmith settles it
// on verified facts alone." Compare shows no prices, runs no compatibility
// check, and labels its FPS figures "SpecSmith model estimates, not measured
// benchmarks of these exact systems". Its estimates belong to complete GPU +
// CPU builds, never to a card on its own.
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
import { buildAssDocument } from './captionRender.ts';
import {
  assertCompareCopyIsSupported,
  beatCopyFor,
  buildScriptStoryboardPackage,
  COMPARE_BEAT_COPY,
  estimatesNotAttributedToBuilds,
  hasExactSystemDisclosure,
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

  it.each(capturedStates())('the page at $label backs the proven idea\'s spoken "catch"', ({ route }) => {
    // Read aloud as "The catch: resolution and quality change both builds'
    // estimates." The page's own FAQ says it, and both controls are on screen.
    const text = renderedText(route);
    expect(text).toMatch(/Resolution and preset change the estimated FPS numbers shown/);
    expect(text).toContain('Resolution');
    expect(text).toContain('Quality');
  });

  it.each(capturedStates())('the page at $label has no price, compatibility or verification to claim', ({ route }) => {
    const text = renderedText(route);
    // If one of these ever appears, the claim guard may be too strict. That is
    // a reviewed change to the guard, not something to discover in a video.
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/compatib/i);
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).toMatch(/model estimates, not measured benchmarks of these exact systems/i);
    // The page attributes every estimate to a build.
    expect(text).toContain('Build A Est. FPS');
    expect(text).toContain('Build B Est. FPS');
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
        expect(estimatesNotAttributedToBuilds(line), `${script.platform}: "${line}"`).toEqual([]);
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
      for (const fact of idea.requiredFacts) {
        expect(estimatesNotAttributedToBuilds(fact), `${idea.id} required fact "${fact}"`).toEqual([]);
      }
      const storyboard = buildScriptStoryboardPackage(idea, buildContentPackage(idea, GENERATED_AT));
      for (const script of storyboard.scripts) {
        for (const line of viewerCopy(script)) {
          expect(unsupportedCompareClaims(line), `${idea.id} ${script.platform}: "${line}"`).toEqual([]);
          expect(estimatesNotAttributedToBuilds(line), `${idea.id} ${script.platform}: "${line}"`).toEqual([]);
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
    'Which build does SpecSmith estimate higher? Pick before the names show.',
  ])('accepts the page-backed line "%s"', (line) => {
    expect(unsupportedCompareClaims(line)).toEqual([]);
    expect(estimatesNotAttributedToBuilds(line)).toEqual([]);
  });
});

describe('estimates belong to builds, never to a bare card or GPU', () => {
  // The first revision of #159 and the strategist output it produced.
  it.each([
    'Which card does SpecSmith estimate higher? Pick before the names show.',
    'Neighbouring GPUs. Which one does SpecSmith estimate higher, and by how much?',
    'Two GPUs. Names hidden. Pick one before SpecSmith shows its FPS estimates.',
    "RTX 4080 Super vs RTX 4080: how far apart are SpecSmith's estimates?",
    'SpecSmith estimates the RTX 4080 Super higher.',
    'Which GPU does SpecSmith estimate higher in this build?',
    'RTX 4080 Super modelled FPS estimate',
  ])('refuses "%s"', (line) => {
    expect(estimatesNotAttributedToBuilds(line).length, `"${line}" was accepted`).toBeGreaterThan(0);
  });

  it.each([
    'Which build does SpecSmith estimate higher? Pick before the names show.',
    'Two builds. Names hidden. Pick one before SpecSmith estimates both builds.',
    'Two builds, different GPUs. Which build does SpecSmith estimate higher?',
    "RTX 4080 Super vs RTX 4080 builds: how far apart are SpecSmith's estimates?",
    "The catch: resolution and quality change both builds' estimates.",
    'modelled FPS estimate for the RTX 4080 Super build',
    'Model estimates, not measured benchmarks of these exact systems.',
    // No estimate mentioned, so nothing to attribute.
    'Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080',
  ])('accepts "%s"', (line) => {
    expect(estimatesNotAttributedToBuilds(line)).toEqual([]);
  });

  it('checks each spoken sentence on its own, so a build elsewhere cannot excuse a card', () => {
    expect(estimatesNotAttributedToBuilds('Two builds. Which card does SpecSmith estimate higher?'))
      .toEqual(['Which card does SpecSmith estimate higher']);
  });

  it('refuses to generate a Compare storyboard whose hook credits the estimate to a card', () => {
    const idea: ContentIdea = { ...COMPARE_IDEA, hook: 'Which card does SpecSmith estimate higher? Pick before the names show.' };
    expect(() => buildScriptStoryboardPackage(idea, buildContentPackage(idea, GENERATED_AT)))
      .toThrow(/hook narration — estimate not attributed to a build/);
  });
});

describe('the disclosure keeps "measured" and "these exact systems"', () => {
  it('both evidence lines carry the full qualifier', () => {
    expect(hasExactSystemDisclosure(COMPARE_BEAT_COPY.evidence.onScreenText)).toBe(true);
    expect(hasExactSystemDisclosure(COMPARE_BEAT_COPY.evidence.narration)).toBe(true);
  });

  it.each([
    // The first revision of #159.
    ['MODEL ESTIMATES, NOT BENCHMARKS'],
    ['These are model estimates, not benchmarks.'],
    // Keeps "measured" but loses the exact systems.
    ['Model estimates, not measured benchmarks.'],
    // Keeps the systems but loses "measured".
    ['Model estimates, not benchmarks of these exact systems.'],
    ['Model estimates for these systems.'],
  ])('refuses the shortened "%s"', (line) => {
    expect(hasExactSystemDisclosure(line)).toBe(false);
  });

  it.each([
    ['MODEL ESTIMATES, NOT BENCHMARKS'],
    ['These are model estimates, not benchmarks.'],
    ['Model estimates, not measured benchmarks.'],
    ['Model estimates, not benchmarks of these exact systems.'],
  ])('treats the shortened "%s" as a benchmark claim, not a disclosure', (line) => {
    expect(unsupportedCompareClaims(line).join('; ')).toMatch(/measurement or benchmark/);
  });

  it('refuses to generate a Compare storyboard whose evidence beat drops the qualifier', () => {
    const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, buildContentPackage(COMPARE_IDEA, GENERATED_AT));
    const script = storyboard.scripts[0];
    const shortened: PlatformScriptStoryboard = {
      ...script,
      beats: script.beats.map((beat) => beat.purpose === 'evidence'
        ? { ...beat, onScreenText: 'MODEL ESTIMATES', narration: 'These are model estimates.' }
        : beat),
    };
    expect(() => assertCompareCopyIsSupported(shortened)).toThrow(/evidence on-screen text — missing the "not measured … these exact systems" disclosure/);
    expect(() => assertCompareCopyIsSupported(shortened)).toThrow(/evidence narration — missing/);
  });

  it('the on-screen disclosure fits the caption\'s two lines with both halves intact', () => {
    const ass = buildAssDocument({
      durationSeconds: 2,
      cues: [{ startSecond: 0, endSecond: 2, text: COMPARE_BEAT_COPY.evidence.onScreenText }],
    });
    const dialogue = ass.split('\n').find((line) => line.startsWith('Dialogue:'))!;
    const lines = dialogue.slice(dialogue.lastIndexOf(',,') + 2).split('\\N');
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28);
    expect(lines.join(' ')).toBe(COMPARE_BEAT_COPY.evidence.onScreenText);
  });
});

describe('the proven idea, as a viewer hears it', () => {
  it('reads these exact lines on YouTube Shorts', () => {
    const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, buildContentPackage(COMPARE_IDEA, GENERATED_AT));
    const youtube = storyboard.scripts.find((script) => script.platform === 'youtube-shorts')!;
    expect(youtube.beats.map((beat) => [beat.purpose, beat.narration])).toEqual([
      ['hook', 'Which build does SpecSmith estimate higher? Pick before the names show.'],
      ['commitment', 'Decide before the reveal.'],
      ['evidence', 'Model estimates, not measured benchmarks of these exact systems.'],
      ['reversal', "The catch: resolution and quality change both builds' estimates."],
      ['payoff', "Count each build's modelled game leads."],
      ['cta', 'Continue this exact decision in SpecSmithPC at /compare.'],
    ]);
  });

  it('no longer says "The catch: Use Compare as the evidence and reveal."', () => {
    const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, buildContentPackage(COMPARE_IDEA, GENERATED_AT));
    for (const script of storyboard.scripts) {
      const reversal = script.beats.find((beat) => beat.purpose === 'reversal')!;
      expect(reversal.narration).not.toMatch(/Use Compare as the evidence/);
    }
  });
});

describe('the guard still catches what it caught before', () => {
  it('allows the page\'s own disclaimer but not a benchmark claim beside it', () => {
    expect(unsupportedCompareClaims('Model estimates, not measured benchmarks of these exact systems.')).toEqual([]);
    expect(unsupportedCompareClaims('MODELLED FPS, NOT MEASURED ON THESE EXACT SYSTEMS')).toEqual([]);
    expect(unsupportedCompareClaims(
      'Model estimates, not measured benchmarks of these exact systems. Benchmarked on real hardware.',
    ).join(' ')).toMatch(/measurement/);
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
