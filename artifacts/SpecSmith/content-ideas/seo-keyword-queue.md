# SEO Keyword Queue

Working backlog for the dynamic-landing-page pipeline (see README.md
section 3). Each routine run that picks this up should take 2-3 items
from the top, ship them as prerendered pages following the site's
established conventions, and move them to "Shipped" with the date and
commit.

Every page built from this queue must use real fields already in
`gpus.json`/`cpus.json`/`components.json` — no invented benchmark
numbers, no new games without sourcing real per-GPU FPS data first
(that's a separate, slower workstream — see README.md's hard rule).

## Shipped
- [x] 2026-08-06 — Use-case build guides: Streaming, Video Editing
  (`/best-pc-for/streaming`, `/best-pc-for/video-editing`) — GPU/CPU
  picks by NVENC-first / VRAM-first + core count, 3 budget tiers each.
  Commit: pending (this session).

## Queued — use-case build guides (same `/best-pc-for/:slug` pattern)
- [ ] **AI / Local LLM inference** — VRAM is the binding constraint for
  running local models; pick GPU by highest VRAM in budget (same
  strategy as video-editing), note this is consumer VRAM for small/
  quantized models, not a training rig. High-relevance keyword in 2026.
- [ ] **Small Form Factor (Mini-ITX)** — different selection axis: filter
  `components.json` cases by `form_factor` support for `ITX`, then pick
  GPU by `length_mm` / `gpu_clearance_mm` fit rather than raw
  benchmark. Needs a case-clearance-aware picker, not just a price
  ceiling — slightly bigger lift than the price/VRAM/core-count picks
  already shipped.
- [ ] **Home Office / Productivity (non-gaming)** — lower priority, weaker
  distinct search intent than the above three; only pick this up if
  the others are exhausted.

## Queued — budget/combo micro-pages
- [ ] Per-generation "which motherboard for [popular CPU]" cross-links —
  largely already covered by `/best-motherboard/:socket`; only worth a
  dedicated page if it earns genuinely distinct search volume, not
  just to pad the count. Low priority, needs a real keyword-research
  pass before building, not just assumed.

## Explicitly NOT queued here (needs its own workstream first)
- New games for the FPS estimator (e.g. Black Ops 6) — requires
  sourcing and verifying real per-GPU FPS multipliers, same rigor as
  the monthly price refresh. Flag to the user as a separate task if
  wanted; don't fabricate placeholder numbers to unblock a landing
  page.
