// @vitest-environment jsdom
//
// REVIEW BLOCKER: every hook in GuidePartRow must run on every render.
//
// `useState` for the image fallback sat below the unavailable-slot return, so
// the component ran a different number of hooks depending on the slot's
// status — and a slot changes status the moment the catalogue arrives.
//
// A NOTE ON HOW THIS IS TESTED, because the obvious way does not work. I first
// wrote this as a crash test: mount the row unchecked, flip it to available,
// assert it does not throw. It passed against the BROKEN code. React 19 does
// not throw or even warn when a render adds a hook to a previously empty hook
// list, so there is no runtime symptom to catch here — the rule is violated,
// a future edit makes it fatal, and nothing observable happens today.
//
// So the rule is checked where it is actually expressible: in the source. The
// behavioural tests below cover what the statuses render; the structural test
// covers the thing the behavioural tests cannot see.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from '../../lib/retail/partCatalog';
import { GUIDE_SLOT_BINDINGS } from '../../lib/guides/guideBindings';
import type { GuideSlotState } from '../../lib/guides/guideSlots';
import GuidePartRow from './GuidePartRow';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error('published catalogue invalid');
const binding = GUIDE_SLOT_BINDINGS[0];
const part = parsed.catalog.parts.find((p) => p.id === binding.neweggPartId)!;
const NOW = Date.parse(part.fetchedAt) + 60_000;

const unchecked: GuideSlotState = { status: 'unchecked', category: binding.category, binding, reason: 'loading' };
const uncheckable: GuideSlotState = { status: 'unchecked', category: binding.category, binding, reason: 'failed' };
const available: GuideSlotState = { status: 'available', category: binding.category, binding, part };
const delisted: GuideSlotState = { status: 'delisted', category: binding.category, binding };
const mismatched: GuideSlotState = {
  status: 'mismatched',
  category: binding.category,
  binding,
  expectedCanonicalId: 'something-else',
};
const unbound: GuideSlotState = { status: 'unbound', category: binding.category, unbound: null };

/**
 * A harness that keeps ONE mounted GuidePartRow and swaps its slot status.
 *
 * Re-rendering through `rerender` with a fresh <MemoryRouter> wrapper remounts
 * the subtree, which resets the hook list and makes a hooks-order test pass
 * against code that violates the rule — this test was written that way first
 * and proved nothing. Driving the change through state on a stable parent
 * keeps the same component instance, which is the only way React compares hook
 * counts between renders.
 */
function Harness({ states }: { states: readonly GuideSlotState[] }) {
  const [index, setIndex] = useState(0);
  return (
    <MemoryRouter>
      <button type="button" data-testid="advance" onClick={() => setIndex((i) => Math.min(i + 1, states.length - 1))}>
        advance
      </button>
      <GuidePartRow state={states[index]} replacementHref="/builder?open=cpu" now={NOW} />
    </MemoryRouter>
  );
}

/** Walks the component through each status without ever remounting it. */
function walk(states: readonly GuideSlotState[]) {
  render(<Harness states={states} />);
  for (let step = 1; step < states.length; step += 1) {
    fireEvent.click(screen.getByTestId('advance'));
  }
}

const renderRow = (state: GuideSlotState) => render(<Harness states={[state]} />);

afterEach(cleanup);

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'GuidePartRow.tsx'),
  'utf-8',
);

describe('every hook runs on every render', () => {
  it('calls no hook after the component can return early', () => {
    // The first early return in the component body. Any hook below it runs
    // conditionally, which is the defect this blocker names.
    const firstEarlyReturn = SOURCE.indexOf('  if (state.status');
    expect(firstEarlyReturn, 'no early return found — has the component changed shape?')
      .toBeGreaterThan(0);

    const after = SOURCE.slice(firstEarlyReturn);
    const hooksAfter = [...after.matchAll(/\buse[A-Z]\w*\s*\(/g)].map((m) => m[0]);
    expect(hooksAfter, `hooks called after an early return: ${hooksAfter.join(', ')}`)
      .toHaveLength(0);
  });

  it('calls its hooks before any branching', () => {
    const firstHook = SOURCE.search(/\buse[A-Z]\w*\s*\(/);
    const firstEarlyReturn = SOURCE.indexOf('  if (state.status');
    expect(firstHook).toBeGreaterThan(0);
    expect(firstHook).toBeLessThan(firstEarlyReturn);
  });
});

describe('a row whose slot changes status', () => {
  it('survives unchecked -> available, the transition the catalogue causes', () => {
    walk([unchecked, available]);
    expect(screen.getByTestId(`guide-name-${binding.category}`).textContent).toBe(part.name);
  });

  it('survives available -> delisted, which a refresh causes', () => {
    walk([available, delisted]);
    expect(screen.getByTestId(`guide-unavailable-${binding.category}`)).toBeTruthy();
  });

  it('survives every status in turn, in one mounted component', () => {
    // Walked rather than sampled: a hook added below any one of these returns
    // breaks on the step that crosses it.
    walk([unchecked, uncheckable, available, delisted, mismatched, unbound, available]);
    expect(screen.getByTestId(`guide-name-${binding.category}`).textContent).toBe(part.name);
  });
});

describe('each status renders its own answer', () => {
  it('says it is checking, not that anything is missing', () => {
    renderRow(unchecked);
    expect(screen.getByTestId(`guide-unchecked-${binding.category}`).textContent).toMatch(/checking/i);
    expect(screen.queryByTestId(`guide-unavailable-${binding.category}`)).toBeNull();
    expect(screen.queryByTestId(`guide-price-${binding.category}`)).toBeNull();
  });

  it('shows no price for a mismatched binding', () => {
    // The guide moved under the binding: show nothing rather than the wrong
    // product under the guide's own heading.
    renderRow(mismatched);
    expect(screen.getByTestId(`guide-unavailable-${binding.category}`)).toBeTruthy();
    expect(screen.queryByTestId(`guide-name-${binding.category}`)).toBeNull();
    expect(screen.queryByTestId(`guide-price-${binding.category}`)).toBeNull();
  });

  it('offers a replacement link for every unbuyable status', () => {
    for (const state of [delisted, mismatched, unbound]) {
      cleanup();
      renderRow(state);
      const link = screen.getByTestId(`guide-replacement-${binding.category}`);
      expect(link.tagName, state.status).toBe('A');
    }
  });
});
