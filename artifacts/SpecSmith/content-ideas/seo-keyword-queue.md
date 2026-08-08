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
  Commit: 0145bbd.
- [x] 2026-08-07 — Use-case build guide: Local AI / LLM Inference
  (`/best-pc-for/ai-local-llm`) — VRAM-first GPU pick (same strategy as
  video-editing), 3 budget tiers. Commit: daf20d5.
- [x] 2026-08-08 — Use-case build guide: Small Form Factor (Mini-ITX)
  (`/best-pc-for/small-form-factor`) — resolved the cooler-height data
  gap (added two real 37mm low-profile coolers, see below) plus
  discovered and fixed a second gap: zero Mini-ITX motherboards existed
  in `components.json` at all. Added one real, verified board (ASUS ROG
  Strix B650E-I Gaming WiFi, AM5, DDR5, $229). Both tiers' full 5-part
  builds (case/motherboard/CPU/cooler/GPU) load into the Builder with
  zero compatibility warnings — verified live, not just asserted.
  Commit: pending (this session).

## Queued — use-case build guides (same `/best-pc-for/:slug` pattern)
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
