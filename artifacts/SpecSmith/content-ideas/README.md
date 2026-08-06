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
- **Build Crate pulls** — legendary/high-tier rarity pulls landing on
  screen, or deliberately re-rolling for a meme-tier pull
- **Higher or Lower streaks** (added 2026-08-06, once the game shipped) —
  a good/bad streak run, or a genuinely surprising price call (e.g. an
  old flagship still costing more than a new mid-range card)
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

## 3. Dynamic SEO landing pages / keyword pipeline
Added 2026-08-06 at the user's request: work off a maintained keyword
queue (`seo-keyword-queue.md` in this directory) instead of picking
targets ad hoc. Each routine run that touches this workstream should
generate 2-3 pages from the top of the queue, using the established
template conventions (schema/JSON-LD, WCAG AA, prerendered + sitemap,
cross-linked from Parts Guides/Footer/llms.txt), then check them off.

Hard rule carried over from every other page on this site: every number
shown has to come from real, verifiable data already in the repo
(gpus.json/cpus.json/components.json field values) or a defensible,
disclosed selection rule built on those fields (e.g. "NVIDIA-first for
NVENC, then benchmark score" — a real hardware fact, not an invented
number). **Adding a genuinely new game to the FPS estimator is NOT part
of this pipeline** — that requires sourcing and verifying real per-GPU
benchmark ratios for that game first (the same rigor as the monthly
price refresh), which is slower and riskier than a template fill.
Queue those separately and flag them, never fabricate the numbers.

First run (2026-08-06): shipped `/best-pc-for` (Streaming, Video
Editing) — see `seo-keyword-queue.md` for what's queued next.

## 4. Local-storage persistence
Client-side only — no changes to the existing Supabase auth/database.
Keep anonymous users' favorite crate pulls, in-progress builds, and
recent history across a refresh.

## 5. Interactive mini-games
Low-overhead, shareable, no-account-required modules in the spirit of
Build Crate — e.g. "Higher/Lower: PC Part Prices" using the real parts
dataset.
