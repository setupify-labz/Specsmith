// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider } from '../context/AuthContext';
import { encodeBuild } from '../lib/sharing';
import SharedBuild from './SharedBuild';

afterEach(cleanup);

// A shared build is someone else's build, so its retailer links are purchase
// recommendations: only parts the catalog audit lists as eligible get them.
describe('shared build page', () => {
  it('links eligible parts to retailers, and shows an ineligible part without a link', () => {
    const b = encodeURIComponent(encodeBuild({ gpu: 'rtx5070', cooler: 'cmh212' }, 'Fixture build'));
    render(
      <MemoryRouter initialEntries={[`/build?b=${b}`]}>
        <AuthProvider>
          <SharedBuild />
        </AuthProvider>
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(links.some((href) => /5070/i.test(decodeURIComponent(href)))).toBe(true);
    expect(links.some((href) => /hyper\s*212/i.test(decodeURIComponent(href)))).toBe(false);
    expect(screen.getByText('Exact variant unconfirmed')).toBeTruthy();
    expect(screen.getByText(/Hyper 212/)).toBeTruthy(); // still shown, just not linked
  });
});
