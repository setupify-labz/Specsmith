# SpecSmith Master Roadmap

Last evidence review: 2026-09-02

## North star

Make SpecSmith the easiest trustworthy place for a beginner to choose a compatible gaming PC for their budget, understand expected performance and uncertainty, and purchase the correct parts.

## Status legend

- **Now** — approved and eligible for scoped implementation.
- **Next** — approved after current dependencies.
- **Later** — preserved vision; do not start without promotion.
- **Blocked** — requires external access or founder authority.
- **Done** — merged, deployed where applicable, and verified.

## Now

### 1. Finish one end-to-end content-machine path

- Tracking issue: #82.
- Implementation PR: #83.
- Current status: independent review requested changes.
- Required before approval:
  - Never delete durable publication ledgers in test/demo runs.
  - Bind quality and rights evidence to the exact media hash.
  - Do not record `scheduled` without an actual scheduling action.
  - Reject non-resolving placeholder media from publishable gates.
  - Add reproducible credential-free CI/artifact evidence.
  - Label estimated FPS whenever visible.
  - Render the generated storyboard rather than a disconnected hand-authored smoke plan, or narrow the claim and track the missing handoff.
- No public publishing or paid calls are approved.

### 2. Stabilize the core buying journey

Create separate evidence-backed issues, not one broad rewrite:

- Investigate inconsistent/zero FPS rendering.
- Ensure prices are labeled live, observed, or estimated accurately.
- Verify exact Amazon/Newegg product variants, images, availability, and links.
- Test desktop/mobile build completion, saved builds, sharing, and failure states.
- Instrument builder start, part selection, completion, share, and retailer click without fabricating conversions.

### 3. Establish autonomous operating controls

- Root `CLAUDE.md` with stable engineering and integrity rules.
- This roadmap as the shared product source of truth.
- Small queue of 2–3 non-overlapping `ready-for-claude` issues.
- Claude implementation → Codex independent review → authorized merge.
- Waiting on Aaron must block only dependent work.

## Next

### Trustworthy benchmark platform

- Strengthen estimator validation against withheld measured evidence.
- Explicitly model resolution, preset, ray tracing, DLSS/FSR/XeSS, and frame generation.
- Preserve source/game/hardware/settings/version provenance.
- Quantify accuracy and coverage; never fill gaps with invented measurements.

### Reliable retail engine

- Complete server-side Newegg/Rakuten coverage with exact product matching.
- Maintain Amazon exact-variant safety.
- Add timestamps, availability, alternatives, suspicious-price rejection, and link monitoring.
- Keep secrets server-side.

### Distribution and learning

- Move from one verified MP4 to a sustainable, rights-safe publishing workflow.
- Attach creative IDs and tracked site URLs.
- Collect actual platform analytics only after real publication.
- Use results to stop weak formats and repeat strong ones.

### Real-user validation

- Observe at least 10 beginners completing a defined build task.
- Record confusion and abandonment without coaching.
- Fix the most repeated blocker.
- Track completed builds and retailer clicks as separate events.

## Later — do not start automatically

### SpecSmith benchmarking application

Quick Test, Guided Test, and narrowly supported AutoBench; hardware/game detection; settings backup/restore; frame-time capture; diagnostics; consented validated uploads.

### Normal-builder visual system

Multiple authorized product images, white/black build discovery, persistent build panel, clearer assembled-build visualization, and share cards.

### 3D builder

Begin with one case and limited components. Real dimensions, fan direction, RGB, airflow visualization, performance budgets, and mobile fallback. Never claim engineering-grade airflow simulation without validation.

### Community and creator economy

Build publishing, moderation, attribution, retailer-policy review, fraud controls, and creator payouts only after real demand and legal/affiliate feasibility are established.

### AI Coach and professional tools

Evidence-based explanations, safe uncertainty, upgrade guidance, and optional repair-shop reports after measurement quality is strong.

## Decision log

- Core builder, compatibility tools, and core performance guidance remain free.
- Estimated and verified data must remain visibly distinct.
- Content-machine public publishing and paid generation require explicit approval until the full path is proven.
- Full 3D, payouts, and large community expansion are deferred behind core usefulness, trust, purchasing, and distribution.
- Autonomous agents may make ordinary reversible engineering decisions but may not spend, publish, merge risky changes, or invent evidence.

## Definition of business proof

The first meaningful proof is not page count. It is:

1. Strangers discover SpecSmith.
2. Beginners complete sensible builds.
3. They understand what is estimated versus verified.
4. They reach correct in-stock retailer products.
5. Some return, share, or purchase.
6. The site learns from measured behavior without misrepresenting it.
