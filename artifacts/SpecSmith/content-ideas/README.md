# Content & Growth Workstreams

Added 2026-08-05 at the user's request, expanding the daily autonomous
routine's scope beyond code/SEO/accessibility work. Tracked as ongoing
tasks (#102-#106) so every daily firing can pick from these alongside
regular site work.

## 1. Video scripts & hooks (content, not code)
Short, high-retention TikTok/Reels scripts + on-screen text hooks, plus
modular multi-part series concepts (e.g. "Opening 50 Crates until a
$5,000 build", "Roasting bad gallery builds"). Delivered as markdown
files in this directory — never posted anywhere, since the standing
constraint is no posting on the user's behalf. Grab them here when
checking in.

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
