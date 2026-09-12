import { describe, expect, it } from 'vitest';
import { getPrerenderMeta, render } from './entry-server';

describe('Builder search landing page', () => {
  it('targets the calculator and FPS-estimator intent on the existing canonical route', () => {
    const meta = getPrerenderMeta('/builder');

    expect(meta.path).toBe('/builder');
    expect(meta.title).toMatch(/PC Build Calculator/i);
    expect(meta.title).toMatch(/FPS Estimator/i);
    expect(meta.description).toMatch(/compatibility/i);
    expect(meta.description).toMatch(/estimate FPS/i);
    expect(meta.canonicalOverride).toBeUndefined();
  });

  it('prerenders useful calculator guidance instead of relying on client JavaScript', () => {
    const html = render('/builder');

    expect(html).toMatch(/PC Build.*Calculator/s);
    expect(html).toContain('What this PC build calculator checks');
    expect(html).toContain('Can I test a PC build before buying it?');
    expect(html).toContain('How does the PC build FPS calculator work?');
    expect(html).toContain('not results measured from your computer');
  });

  it('does not turn estimates or partial compatibility coverage into guarantees', () => {
    const html = render('/builder');

    expect(html).toContain('Compatibility coverage is not exhaustive');
    expect(html).toContain('planning estimate, not a measurement');
    expect(html).not.toMatch(/guaranteed compatibility/i);
    expect(html).not.toMatch(/accurate FPS for your exact build/i);
    expect(html).not.toMatch(/real[- ]time prices/i);
  });
});
