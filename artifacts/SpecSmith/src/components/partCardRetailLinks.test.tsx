// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import PartCard from './PartCard';

afterEach(cleanup);

const base = { id: 'x', name: 'Fixture part', selected: false, specs: [], onSelect: () => {} };

describe('PartCard retailer links', () => {
  it('shows retailer links by default', () => {
    render(<PartCard {...base} />);
    expect(screen.queryAllByRole('link').length).toBeGreaterThan(0);
  });

  it('shows none when retailLinks is false (an ineligible catalogue part)', () => {
    render(<PartCard {...base} retailLinks={false} catalogNotice="Exact variant unconfirmed" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Exact variant unconfirmed')).toBeTruthy();
  });
});
