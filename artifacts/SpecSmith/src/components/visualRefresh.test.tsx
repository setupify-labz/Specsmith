// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import catalog from '../../public/data/retail-parts.json';
import type { AffiliatePart } from '../lib/retail/partCatalog';
import GuideProductImage, { guideGpuExample } from './GuideProductImage';
import Prebuilts from '../pages/Prebuilts';

vi.mock('../hooks/useAffiliatePartCatalog', () => ({ useAffiliatePartCatalog: () => ({ status: 'absent' }) }));
vi.mock('../hooks/useSeo', () => ({ useSeo: () => {} }));
beforeEach(() => vi.stubGlobal('IntersectionObserver', class {
  observe() {} unobserve() {} disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const part = catalog.parts.find(p => p.category === 'gpu') as AffiliatePart;

describe('guide product photography', () => {
  it('requires the verified canonical identity, never a similar name', () => {
    expect(guideGpuExample([part], part.canonicalPartId!)).toBe(part);
    expect(guideGpuExample([{ ...part, specsVerified: false }], part.canonicalPartId!)).toBeUndefined();
    expect(guideGpuExample([{ ...part, canonicalPartId: 'wrong' }], part.canonicalPartId!)).toBeUndefined();
    expect(guideGpuExample([{ ...part, category: 'cpu' }], part.canonicalPartId!)).toBeUndefined();
    expect(guideGpuExample([], 'unavailable')).toBeUndefined();
  });
  it('names the pictured variant and does not borrow its price', () => {
    const { container } = render(<GuideProductImage part={part} model="GPU" />);
    expect(screen.getByRole('img').getAttribute('src')).toBe(part.imageUrl);
    expect(screen.getByText(/Retailer GPU example/).textContent).toContain(part.name);
    expect(container.textContent).not.toContain('$');
  });
  it('retains an honest fallback on image failure', () => {
    render(<GuideProductImage part={part} model="GPU" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Product photo unavailable')).toBeTruthy();
  });
});

describe('guide overview', () => {
  it('keeps five native disclosures, full part lists and detail destinations', () => {
    const { container } = render(<MemoryRouter><Prebuilts /></MemoryRouter>);
    const disclosures = container.querySelectorAll('details');
    expect(disclosures.length).toBe(5);
    expect([...disclosures].every(d => !d.open)).toBe(true);
    expect(screen.getAllByRole('link', { name: 'View Details' }).length).toBe(5);
    expect(screen.getAllByRole('button', { name: 'Load into Builder' }).length).toBe(5);
    expect(container.textContent).toContain('Estimated FPS');
    expect(container.querySelector('a[title="Buy on Amazon"]')).toBeNull();
    expect(disclosures[0].textContent).toContain('Search Amazon');
  });
});
