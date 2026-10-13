// @vitest-environment jsdom
//
// Each part selector's search box must say what it searches.
//
// THE DEFECT. The search input had only a "Search..." placeholder and no
// label. Screen readers announced every selector's box the same way, so on
// /compare (GPU and CPU) and both Upgrade Calculators a screen-reader user
// could not tell which box filtered which part type. (The Builder's catalogue
// view has its own search box, already named "Search <category>".)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import PartSelector from './PartSelector';

const parts = [{ id: 'p1', name: 'First part', price_usd: 100, benchmark_score: 10 }] as never[];

afterEach(() => cleanup());

const selector = (category: string, label: string, searchLabel?: string) => (
  <PartSelector category={category} label={label} searchLabel={searchLabel} parts={parts} selectedId={null} onSelect={vi.fn()} getSpecs={() => []} defaultOpen showShopping={false} />
);

describe('the part search box', () => {
  it('is named after the part type it searches', () => {
    render(selector('gpu', 'GPU'));
    expect(screen.getByRole('textbox', { name: 'Search GPU' })).toBeTruthy();
  });

  it('has a different name in each selector on the same page (the /compare case)', () => {
    render(<>{selector('gpu', 'GPU')}{selector('cpu', 'CPU')}</>);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Search GPU' })).not.toBe(screen.getByRole('textbox', { name: 'Search CPU' }));
  });

  it('tells apart two selectors with the same label when the page names them (Compare\'s Build A and Build B)', () => {
    render(<>{selector('gpu', 'GPU', 'Search Build A GPU')}{selector('gpu', 'GPU', 'Search Build B GPU')}</>);
    expect(screen.getByRole('textbox', { name: 'Search Build A GPU' })).not.toBe(screen.getByRole('textbox', { name: 'Search Build B GPU' }));
  });
});
