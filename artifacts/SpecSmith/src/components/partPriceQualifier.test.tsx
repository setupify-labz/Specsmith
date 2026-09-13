// @vitest-environment jsdom
//
// Every catalogue price the picker shows is SpecSmith's own editorial
// price_usd, not a retailer observation. Both of these rendered it bare —
// "$669" — which is the app asserting something it cannot support. Found by
// rendering PR #92's CTA beat, whose crop put the Compare part row on screen
// with an unqualified dollar figure in the middle of the video.
//
// Asserted on the rendered DOM rather than the source text, so the rule holds
// however the components are refactored.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import PartCard from './PartCard';

const renderCard = (price?: number) =>
  render(
    <MemoryRouter>
      <PartCard
        id="cpu-1"
        name="Ryzen 9 9950X3D"
        price_usd={price}
        selected={false}
        specs={[{ label: 'Cores', value: '16' }]}
        showShopping
        onSelect={() => undefined}
      />
    </MemoryRouter>,
  );

// This suite renders the same component three ways, so each case must start
// from an empty DOM — without this the third assertion reads the first case's
// card and 'no bare price' passes or fails for the wrong reason.
afterEach(cleanup);

describe('a catalogue price is shown as an estimate', () => {
  it('qualifies the visible figure', () => {
    renderCard(669);
    expect(screen.getByText(/Est\. \$669/)).toBeTruthy();
    // The bare form must not appear anywhere in the rendered output.
    expect(screen.queryByText(/^\$669$/)).toBeNull();
  });

  it('qualifies the accessible name too, so a screen reader hears the caveat', () => {
    renderCard(669);
    const labelled = document.querySelector('[aria-label]');
    expect(labelled?.getAttribute('aria-label') ?? '').toMatch(/estimated \$669/i);
  });

  it('says where to look instead when the catalogue has no price, rather than inventing one', () => {
    const { container } = renderCard(undefined);
    expect(screen.getByText(/Price at retailer/)).toBeTruthy();
    // No invented figure anywhere in this card.
    expect(container.textContent ?? '').not.toMatch(/\$\s*\d/);
  });
});
