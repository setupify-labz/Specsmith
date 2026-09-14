# Visual review — first batch

Implements #106 for founder review, not deployment. Homepage, Build Guides overview and retailer-card presentation only. The remaining site pages and Claude's FPS/cart/loading changes are not included.

## Changes

- Shorter homepage hero, larger stationary estimate example, wrapping build-guide grid and readable FAQ copy.
- Compact two-column guide overview with native keyboard-operable part disclosures, preserved detail URLs and build query parameters.
- Guide photography requires an existing verified GPU model mapping and explicitly labels the depicted retailer variant. None of the five guide GPUs exist in the checked catalogue, so no unrelated image is shown. Prices remain separate canonical estimates.
- Original retailer photographs remain untouched in a consistent light inset frame in both themes. This does not remove baked-in white or black pixels.
- Retailer button uses orange/near-black fill pairing independently of theme-specific text colors. Cards retain existing mobile height and image-zoom limits.
- Root development command permits previewing the existing pnpm workspace without copying or changing dependency policy.

## Verification

- Integrated `main` at `9374e55` and retained its newer product-image resolver, detail drawer, loading states, and model-identity versus exact-unit-specification boundary.
- TypeScript: passed after updating the guide-photo selector to the current verified-identity contract.
- Focused tests: 38/38 across the visual refresh, Builder shopping, and product-image integration suites.
- Full suite in this sandbox: 2,657 passed and 17 failed (2,674 total). All 17 failures are the existing `scripts/measured/cancellation.test.ts` subprocess cases; `tsx` cannot create its IPC pipe here (`listen EPERM`). The remaining 150 files / 2,643 tests pass when that environment-dependent file is excluded. No test or dependency policy was weakened.
- Production Vite build and prerender: passed, 374 sitemap URLs.
- The two `.retail-photo-frame` declarations created by the main integration were reduced to one shared declaration, preserving the theme-aware photo surface everywhere.
- The screenshots below document the prior `adc2722` visual review, not the current integrated head. A fresh exact-head browser capture is still required: Playwright's Chromium download timed out repeatedly in this environment.
- Complete mobile/light-theme, horizontal-overflow, and production-hydration QA therefore remain release gates. The previously observed 4px narrow-frame discrepancy is not certified as resolved.

## Prior-head screenshots (`adc2722`)

![Homepage dark](specsmith-home-final.jpg)
![Homepage light](specsmith-home-light-final.jpg)
![Build Guides dark](specsmith-guides-final.jpg)
![Retail builder dark](specsmith-builder-dark.jpg)
![Mobile homepage review](specsmith-home-mobile.jpg)
![Mobile builder review](specsmith-builder-mobile.jpg)

## Release gates

This is a draft visual review, not a finished site-wide overhaul. Aaron reviews the design first; independent technical review, fresh exact-head screenshots, and the remaining viewport/production checks must pass before merge. Rollback is a normal revert of this UI change; no data or schema migration.
