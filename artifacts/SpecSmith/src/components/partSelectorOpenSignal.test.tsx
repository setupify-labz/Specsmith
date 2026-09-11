// @vitest-environment jsdom
//
// openSignal has to work on EVERY token, not just the first.
//
// THE DEFECT. This was two effects — one calling `setOpen(true)`, one keyed on
// `open` doing the scrolling. That works exactly once, from closed.
// `setOpen(true)` on an already-open selector changes no state, so React does
// not re-render, so the effect watching `open` never runs again and the
// request silently does nothing. Two cases hit it in ordinary use: the GPU
// selector, which is `defaultOpen`, and any category asked for twice running.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

import PartSelector from './PartSelector';

const parts = [
  { id: 'p1', name: 'First part', price_usd: 100, benchmark_score: 10 },
  { id: 'p2', name: 'Second part', price_usd: 200, benchmark_score: 20 },
] as never[];

let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function spy(this: Element) {
    scrolled.push(this);
  };
});
afterEach(cleanup);

const renderSelector = (props: Record<string, unknown> = {}) =>
  render(
    <PartSelector
      category="cpu"
      label="CPU — Processor"
      parts={parts}
      selectedId={null}
      onSelect={vi.fn()}
      getSpecs={() => []}
      {...props}
    />,
  );

const section = () => document.querySelector('[data-part-section="cpu"]')!;
/** An open selector renders its parts list; a closed one renders only its header. */
const isOpen = (root: Element) => root.querySelectorAll('button').length > 1;

describe('a selector that is already open', () => {
  it('still scrolls when it is requested', async () => {
    // The GPU selector on the real page is `defaultOpen`, so "choose a
    // graphics card" always lands on this path. Under the old code it opened
    // nothing, changed no state, and scrolled nowhere.
    const view = renderSelector({ defaultOpen: true, openSignal: undefined });
    expect(isOpen(section())).toBe(true);

    view.rerender(
      <PartSelector
        category="cpu"
        label="CPU — Processor"
        parts={parts}
        selectedId={null}
        onSelect={vi.fn()}
        getSpecs={() => []}
        defaultOpen
        openSignal={1}
      />,
    );

    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(scrolled[0]).toBe(section());
    expect(isOpen(section())).toBe(true);
  });
});

describe('the same category requested twice', () => {
  it('scrolls on each new token', async () => {
    const rerenderWith = (view: ReturnType<typeof renderSelector>, openSignal: number) =>
      view.rerender(
        <PartSelector
          category="cpu"
          label="CPU — Processor"
          parts={parts}
          selectedId={null}
          onSelect={vi.fn()}
          getSpecs={() => []}
          openSignal={openSignal}
        />,
      );

    const view = renderSelector();
    expect(isOpen(section())).toBe(false);

    rerenderWith(view, 1);
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(isOpen(section())).toBe(true);

    // Second click on the same action. The selector is open by now, which is
    // exactly the state the old code could not scroll from.
    rerenderWith(view, 2);
    await waitFor(() => expect(scrolled).toHaveLength(2));
    expect(scrolled[1]).toBe(section());
  });

  it('does not scroll again when nothing was requested', async () => {
    // An unrelated re-render — a price refresh, a parent state change — must
    // not move the page under the shopper.
    //
    // FRAMES ARE DRIVEN BY HAND HERE, and that is not fussiness. The request
    // re-asserts itself until the selector is on screen, and in jsdom every
    // element reports a zero-size box, so it never is: left to the real clock
    // the loop keeps firing and the count grows with however long the machine
    // takes. Asserting a fixed number against that is a test that passes alone
    // and fails in a full suite — which is exactly what it did.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as unknown as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', (() => {}) as unknown as typeof cancelAnimationFrame);

    const drain = () => {
      let ran = 0;
      while (frames.length > 0 && ran < 200) {
        frames.shift()!(0);
        ran += 1;
      }
    };

    const view = renderSelector({ openSignal: 1 });
    drain();
    const afterRequest = scrolled.length;
    expect(afterRequest).toBeGreaterThan(0);

    view.rerender(
      <PartSelector
        category="cpu"
        label="CPU — Processor"
        parts={[...parts]}
        selectedId="p1"
        onSelect={vi.fn()}
        getSpecs={() => []}
        openSignal={1}
      />,
    );
    drain();

    // The token did not change, so the effect did not re-run and nothing new
    // was scheduled or scrolled.
    expect(scrolled).toHaveLength(afterRequest);

    vi.unstubAllGlobals();
  });

  it('never scrolls when no request is made at all', async () => {
    renderSelector({ defaultOpen: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).toHaveLength(0);
  });
});

describe('cleanup', () => {
  it('leaves no animation frame able to scroll after unmount', async () => {
    // THE PROPERTY, not a count of frames. The request re-asserts itself over
    // several frames until the selector is on screen, so what matters is that
    // nothing survives teardown: a callback still pending after unmount scrolls
    // against a node that is gone, or fights a newer request for the viewport.
    const pending: Array<{ id: number; cb: FrameRequestCallback }> = [];
    const cancelled = new Set<number>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      const id = nextId++;
      pending.push({ id, cb });
      return id;
    }) as unknown as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      cancelled.add(id);
    }) as unknown as typeof cancelAnimationFrame);

    const view = renderSelector({ openSignal: 1 });

    // Run a couple of frames so the effect is mid-flight, with one scheduled.
    for (let i = 0; i < 2; i += 1) {
      const next = pending.find((f) => !cancelled.has(f.id));
      if (!next) break;
      pending.splice(pending.indexOf(next), 1);
      next.cb(0);
    }
    const stillScheduled = pending.filter((f) => !cancelled.has(f.id));
    expect(stillScheduled.length, 'nothing was in flight to test').toBeGreaterThan(0);

    const scrollsBefore = scrolled.length;
    view.unmount();

    // Every frame that was still scheduled is now cancelled...
    expect(pending.filter((f) => !cancelled.has(f.id))).toHaveLength(0);
    // ...and running them anyway, as a browser that had already queued them
    // would, scrolls nothing.
    for (const frame of pending) frame.cb(0);
    expect(scrolled).toHaveLength(scrollsBefore);

    vi.unstubAllGlobals();
  });

  it('stops re-asserting instead of spinning forever', async () => {
    // jsdom gives every element a zero-size box, so the selector never counts
    // as on screen — the worst case, and the one that must terminate.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as unknown as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', (() => {}) as unknown as typeof cancelAnimationFrame);

    renderSelector({ openSignal: 1 });
    let ran = 0;
    while (frames.length > 0 && ran < 200) {
      frames.shift()!(0);
      ran += 1;
    }
    expect(frames, 'the retry loop never stopped').toHaveLength(0);
    expect(ran).toBeLessThan(200);

    vi.unstubAllGlobals();
  });
});
