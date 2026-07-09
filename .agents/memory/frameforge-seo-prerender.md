---
name: FrameForge SEO prerendering approach
description: How route-level metadata and crawlable HTML were added to a static-hosted Vite SPA without a server.
---

FrameForge (artifacts/frameforge) is deployed as `serve = "static"` with no Node server in production — only build-time output is servable. This ruled out real SSR/edge middleware.

**Approach chosen:** build-time prerendering via a Vite SSR bundle (`vite build --ssr src/entry-server.tsx`) run as a post-build script (`scripts/prerender.mjs`), invoked from `package.json`'s `build` script after the normal client `vite build`. It renders each public route (`/`, `/builder`, `/prebuilts`, `/compare`, `/about`) to a string and writes `dist/public/<route>/index.html` (and root `index.html` for `/`), injecting per-route `<title>`/meta/OG/canonical tags into the client-built `index.html` template via string replacement (marker `<!--app-html-->` in the `#root` div).

**Why this works for static hosting:** most static file servers/CDNs resolve `/builder` to `dist/public/builder/index.html` automatically, so no server-side routing logic is needed — each route gets its own real HTML file with correct head tags and body content, while the client bundle still hydrates normally via React Router `BrowserRouter`.

**Constraint:** dynamic/unbounded routes (e.g. `/build?b=<base64>` shared-build links) can't be prerendered per-build-payload. Instead prerender the bare route shell (`/build` with no query) with generic `noindex` metadata + canonical pointing at `/builder`, so social unfurl bots (which often ignore robots.txt disallow rules, unlike search crawlers) still get a real title/description/OG image instead of the app shell; per-build titles still update client-side after hydration once the payload decodes.

**Gotcha:** page components using `localStorage`/`window` at render time (e.g. context init) must guard with try/catch, since SSR (`renderToString`) runs in Node with no DOM — this repo's `ThemeContext`/`AuthContext` already did, which made SSR feasible without refactoring them.
