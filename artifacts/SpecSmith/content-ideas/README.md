# Content & Growth Workstreams

Added 2026-08-05 at the user's request, expanding the daily autonomous
routine's scope beyond code/SEO/accessibility work. Tracked as ongoing
tasks (#102-#106) so every daily firing can pick from these alongside
regular site work.

## 1. Weekly content batch (content, not code)
Revised 2026-08-05: not generic AI-video scripts — SpecSmith visitors
come to pick parts and check FPS, not for faceless AI slop. The actual
format is 5 punchy hooks + 2-3 weird/funny real hardware combos every
week, built to be screen-recorded directly on the live site:
- **Build comparisons** on the Compare page (e.g. budget build vs.
  flagship build FPS side by side)
- **"Roast My Build"** on the Builder — deliberately bad combos (flagship
  GPU + ancient CPU, undersized PSU) so the site's own compatibility/
  bottleneck warnings fire on screen, no editing needed
Every part/price used has to come from the real dataset (gpus.json,
cpus.json, components.json) — the whole point is showing the actual
tool working, not a mockup. Delivered as a dated markdown file in this
directory each week — never posted anywhere, since the standing
constraint is no posting on the user's behalf. Grab them here when
checking in. First batch: `2026-08-05-batch-1.md`.

Separately, shareable engagement hooks *coded into the frontend*
(a build-critique layout, custom share mechanics) ship as normal
feature commits, not files in this directory.

## 2. Labeled gallery seeding
If the public Build Gallery is sparse, generate realistic/high-end/
meme-tier example builds to keep it feeling populated — but every
seeded build must carry a clear, visually distinct "SpecSmith Staff
Pick" (or equivalent) label, structurally separate from real user
submissions. Never presented as organic user activity. This was the
one item flagged back to the user before being added to scope, and
labeling was their explicit condition.

## 3. Dynamic SEO landing pages
Continue the existing pattern (Best GPU/CPU for Game, Parts Guides,
Tier Lists) for new search-intent gaps — e.g. `/builds/best-minecraft-pc`,
`/builds/budget-1440p-gaming` style pages.

## 4. Local-storage persistence
Client-side only — no changes to the existing Supabase auth/database.
Keep anonymous users' favorite crate pulls, in-progress builds, and
recent history across a refresh.

## 5. Interactive mini-games
Low-overhead, shareable, no-account-required modules in the spirit of
Build Crate — e.g. "Higher/Lower: PC Part Prices" using the real parts
dataset.
