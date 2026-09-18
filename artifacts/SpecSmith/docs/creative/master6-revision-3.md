# MASTER #6 — Attempt 3: making the promised visuals deliverable

Inspected checkpoint: `2b587a8fd243c36360d721daab98835813ba3b43` (the
independent matcher repair), merged before any change.

## What the matcher repair changed for this work

The repair fixed the incidental-count false positives I reported, and correctly
preserved the historical attempt-1 feedback rather than rewriting it as if the
repaired matcher had produced it. Its note is worth restating: attempt-1's
rejection is **not** evidence that Claude made unsupported purchase claims. The
matches were incidental-count false positives.

It then named three review concerns. All three are fixed here, in a new
attempt-3. **Attempts 1 and 2 are untouched.**

## 1. Every promised visual is now deliverable

The review said the vanishing-gap treatment "promises a range being drawn while
declaring only a static Compare capture". Checking the source made it worse than
that:

- `src/pages/Compare.tsx` renders one value per build per game as a bar. It
  never renders the model's min/max range. `FpsGauge` — which does render
  `Range: min — max FPS estimated` — is used only by `FpsEstimator`, a different
  surface.
- `PartSelector` is mounted on Compare with `showShopping={false}`, so **no
  price appears on the page at all**.

So the original copy was wrong three times: the capture does not move, the range
is not on that page, and neither is a price. An evidence gate cannot catch any
of it, because none of it is a factual claim about hardware — it is a promise
about the screen.

`renderDeliverability.ts` checks that promise. It knows what a named surface
renders and what it notably does not, each entry citing where it was verified in
the source, and it knows a static capture does not animate. It is silent about
surfaces it has no record of rather than inventing constraints.

The brief and authoring guide now publish the same facts up front, under "What
this capture will show" and "What it will NOT show", so an author is told before
writing rather than after.

The vanishing-gap treatment was re-conceived rather than patched. It keeps its
point — a visible gap is not a supported difference — using only what the still
actually shows:

> This page prints one number per build per game. The model that produced each
> number also declares how wide it could be, and that width is not printed here.

## 2. The unsupported market-wide claim is gone

"Most comparisons show you the value and hide the range" was an assertion about
every competing product, with nothing behind it. It is replaced by a statement
about SpecSmith's own page, which is verifiable in the source and which I did
verify. A regression test forbids "most comparisons", "most sites", "other
sites", "everyone else" and "the industry" across the revised batch.

## 3. Editorial subtotal, not a build and not a live price

The price identity is real and checkable: `rtx5060ti` $564 + `i3-13100f` $90 and
`rtx4060ti` $469 + `r5-9600x` $185 both come to $654 in the shipped catalog. It
is a CPU-and-GPU parts subtotal at editorial catalog prices — not a complete
build, not a live retail quote, and not visible on the page.

It is now a first-class approved claim carrying its qualifier as
`requiredWording`, and beats that state it must carry that wording verbatim.

**A correction to my own earlier reasoning.** I first assumed adding
`requiredWording` would make MASTER #2's gate enforce it. It does not:
`creativeContract.ts` enforces `requiredWording` only for two hard-coded
requirement shapes — one containing `"Estimated FPS"` and one containing
`"never imply this is a live price"`. Any other required wording is carried and
never checked. The general rule is therefore enforced in the file workflow,
which I own, rather than by modifying the audited gate. A test records the
gate's actual behaviour so nobody later assumes it is covering this.

## A readiness defect found while doing this

The new checks live in the workflow, not in the proposal pass, so the proposal
pass kept reporting `awaiting-human-review` while the workflow had blocking
findings — and the packet inherited that and reported `machineChecksPassed:
true`. A batch with required findings was being called ready.

Readiness is now derived from the findings themselves, and the workflow reports
its own `workflowStatus` instead of echoing an upstream status that does not
know about these checks.

## Result

| attempt | outcome |
| --- | --- |
| 1 | blocked (largely incidental-count false positives, per the matcher repair) |
| 2 | passed the checks that existed then; fails the deliverability checks added here |
| 3 | passes every machine check in this workflow |

Attempt 3: `machineChecksPassed: true`, `humanReviewReady: true`,
**`approved: false`**.

## Remaining blockers — machine readiness is not approval

Nothing below is satisfied by anything in this change:

- **No human creative review.** No machine pass here establishes originality,
  entertainment value, factual completeness or whether this is worth a viewer's
  time.
- **Nothing has been rendered.** No frame, no caption, no audio exists. The
  deliverability check reasons about what the renderer *would* produce from the
  component source; it has not watched it produce anything.
- **Readability is unverified.** Caption density and legibility at 540×960 have
  not been measured for this copy.
- **PR #92's human audio gate is untouched and unsatisfied.**
- **The research is the synthetic engineering fixture.** This repository has no
  production research evidence. Nothing here may be quoted as production
  creative evidence.
- **The surface-content record is hand-maintained.** `SURFACE_CONTENT` was
  verified against the component source by reading it; nothing keeps it in sync
  if Compare changes. A drift test would need the renderer to report its own
  content.
- **Compare missions only**, inherited from the proposal pass.
- **The annotated vertical spec-card capability remains absent** and explicitly
  blocked.

## Verification

- Typecheck clean.
- Creative suite: 172 tests. Full suite: 3768 tests across 204 files.
- Production build and prerender clean.
- Four negative controls, each disabling one guard individually: dropping the
  motion check, dropping the absent-element check, decoupling readiness from
  outstanding findings, and dropping required-wording enforcement. Each broke
  tests; all were restored.
- No API call, paid service, rendering, publishing, scheduling or merge.
