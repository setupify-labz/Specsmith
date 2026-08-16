import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SSR/client route drift (Priority 5): App.tsx (client BrowserRouter routes)
// and entry-server.tsx (SSR StaticRouter routes used for prerendering) each
// hand-maintain their own <Routes> JSX block — entry-server.tsx needs its
// own copy so useParams works correctly during prerendering (see its
// comment). That duplication is a real, accepted maintenance risk: nothing
// stops someone from adding a route to one file and forgetting the other.
//
// prerender.mjs's build-time <h1> guard catches the case where a route IS
// listed in PRERENDER_ROUTES but entry-server.tsx's <Routes> can't actually
// render it (silently blank output). It does NOT catch the case this test
// covers: a route added to App.tsx (so it "works" for client-side SPA
// navigation) that was never added to entry-server.tsx / PRERENDER_ROUTES at
// all — such a route has no prerendered HTML, so a direct request or search
// engine crawl 404s even though the feature "exists." This is a pure static
// text comparison (no app runtime involved), so it's safe to run in CI
// without touching routing behavior itself.

const SRC_DIR = path.resolve(import.meta.dirname);

// Account/session pages are intentionally client-only — there is nothing
// meaningful to prerender (they require a logged-in user, which SSR never
// has) and they're deliberately excluded from entry-server.tsx.
const INTENTIONALLY_CLIENT_ONLY = new Set(['/login', '/signup', '/dashboard', '/settings']);

function extractRoutePaths(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const matches = [...source.matchAll(/<Route\s+path="([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

describe('SSR / client route consistency (Priority 5)', () => {
  const clientRoutes = extractRoutePaths(path.join(SRC_DIR, 'App.tsx'));
  const ssrRoutes = extractRoutePaths(path.join(SRC_DIR, 'entry-server.tsx'));

  it('found a realistic number of routes in both files (sanity check the regex itself still matches)', () => {
    expect(clientRoutes.length).toBeGreaterThan(40);
    expect(ssrRoutes.length).toBeGreaterThan(40);
  });

  it('every client route is either intentionally client-only or present in the SSR route list', () => {
    const missingFromSsr = clientRoutes.filter(
      (p) => p !== '*' && !INTENTIONALLY_CLIENT_ONLY.has(p) && !ssrRoutes.includes(p),
    );
    expect(missingFromSsr).toEqual([]);
  });

  it('every SSR route is a real client route too (no orphaned SSR-only routes)', () => {
    const clientSet = new Set(clientRoutes);
    const ssrOnly = ssrRoutes.filter((p) => p !== '*' && !clientSet.has(p));
    expect(ssrOnly).toEqual([]);
  });

  it('no duplicate route paths within either file', () => {
    const dupes = (routes: string[]) => routes.filter((p, i) => routes.indexOf(p) !== i);
    expect(dupes(clientRoutes)).toEqual([]);
    expect(dupes(ssrRoutes)).toEqual([]);
  });
});
