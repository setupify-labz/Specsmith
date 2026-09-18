# MASTER #6 — Local file-based creative workflow

Starting checkpoint: `4165da2baa7032ad1068511c030edd1c06357dcf` (the independent
repair's follow-up, inspected before any change).

## What this closes

The repair left one honest blocker: `runCreativeGenerationPass` requires a
caller-supplied generator, no text backend is configured, and templates are
never substituted for one. Choosing and wiring a backend was correctly left
open rather than inferred as complete.

This change supplies a generator that costs nothing and calls nothing. The
generator is a person or a model at a keyboard, and the transport is the
filesystem:

1. **Export** — the mission, the approved claims, the refused claims, the
   disclosure requirements, the one validated capture state and the concept
   schema are written to a directory as data (`brief.json`,
   `concept.schema.json`, `AUTHORING.md`).
2. **Author** — three concepts are written as JSON files into
   `batches/attempt-N/`.
3. **Import** — they are read back and parsed strictly.
4. **Check** — they go through `runCreativeProposalPass`, which is the same
   evidence gate, divergence check, visual-honesty classification, per-beat
   disclosure rule and exact capture-state binding the provider-driven path
   uses. Not a friendlier copy.
5. **Feed back** — actionable revision feedback is written to
   `feedback/attempt-N.{json,md}`, and a review packet to `review-packet.json`.

Commands: `pnpm run content:creative:brief`, `pnpm run content:creative:review`.

No network call, credential, subscription-token proxy, paid service, rendering,
scheduling or publishing occurs anywhere in this path.

## Readiness is not approval

The review packet reports three separate things, because collapsing them is how
a machine check gets read as a sign-off:

- `machineChecksPassed` — every gate passed for every concept in the batch.
- `humanReviewReady` — a human may now spend time on it.
- `approved` — **always `false`**. Nothing in this repository can set it true.
  It is written explicitly so nobody has to infer the absence of approval from
  silence.

`outstandingApprovals` names what a human still owes: creative review,
readability at real output size, rendered-media review (nothing has been
rendered), audio review (PR #92's human audio gate is untouched and unsatisfied
by this workflow), rights and disclosure sign-off, and publishing
authorization.

## The demonstrated batch

One real Claude-authored batch was run through the workflow. It is committed
under `scripts/content-automator/fixtures/creative-file-workflow/`, including
the feedback the workflow produced.

**Attempt 1 — blocked.** The evidence gate rejected it. Two treatments carried
narration the gate matched against the refused purchase-recommendation claim;
one passed. Feedback named the file, the beat, the finding code and the exact
offending text.

**Attempt 2 — passed the machine checks.** All three treatments became contract
eligible, the set was divergent, and the packet reports
`humanReviewReady: true`, `approved: false`.

The three treatments differ in what the viewer does and in the order the
argument arrives, not in wording: commit-to-an-answer-then-reveal
(participant), a repeatable question/evidence/boundary check (investigator),
and watch-the-gap-vanish-inside-its-own-range (spectator). All three land on the
same honest answer, which is correct — the core truth may not change per
treatment.

The research behind this mission is the repository's **synthetic engineering
fixture**. This repository has no production research evidence, and inventing
some to make the demonstration look better is precisely what must not happen.
The brief, the packet and the authoring guide all carry that label, and nothing
here may be quoted as production creative evidence.

## A false-positive class in MASTER #2's strict gate

Found while running real authored copy through the gate. **Not fixed here, and
the gate was not weakened.** Reported for the reviewer to judge.

The strict evidence gate matches a line against refused claims by subject
overlap and fails closed. Two consequences showed up:

1. **A shared subject phrase makes an approved claim unstatable.** When the
   approved claim and a refused claim both contain "these two builds", the
   approved claim's own proposition hard-fails when spoken verbatim. Removing
   the shared phrase clears it.

2. **Bare number words are treated as subject tokens.** With a refused claim
   reading "One of these two builds is the better buy", ordinary English
   hard-fails:

   | line | result |
   | --- | --- |
   | `Step one: write down what would answer your question.` | hard-fail |
   | `Step two: write down what would answer your question.` | hard-fail |
   | `First, write down what would answer your question.` | pass |
   | `Pick one.` | hard-fail |
   | `Pick a side.` | pass |

This is the behaviour the audit repair warned about from the other direction:
"do not make the system so broad that honest unrelated script text gets falsely
blocked." Changing the matcher is MASTER #2's scope and needs its own review, so
the fixture and the authored copy work within the gate's conservatism instead.
No claim was weakened to do so — the copy makes no purchase recommendation
either way, and the approved claim's meaning is unchanged.

A third, related point is now surfaced rather than hidden: when the rejected
text is the storyboard **title**, it is the mission's own viewer question and
the author cannot edit it. The workflow reports those as `missionBlockers`,
separate from author-actionable findings, and says the mission must be
re-specified.

## Verification

- Typecheck clean.
- `fileWorkflow.test.ts`: 31 tests covering malformed input, evidence
  rejection, set-level divergence, the authoring loop, and readiness-vs-approval.
- Full suite: 3712 tests across 201 files passing.
- Production build and prerender clean.
- Five negative controls, each disabling one guard individually: dropping the
  exactly-three-files rule, accepting an unrenderable visual kind, decoupling
  readiness from the checks, collapsing mission blockers into author findings,
  and dropping set-level findings. Each broke tests; all were restored.

## Limits

- The workflow proves evidence binding, structure, disclosure placement and
  capture-state binding. It establishes nothing about originality, entertainment
  value, factual completeness or readability.
- One batch by one author is not evidence that the loop produces good creative
  work at volume.
- Compare missions only, inherited from the proposal pass.
- The annotated vertical spec-card capability remains absent and explicitly
  blocked.
- Nothing was rendered, reviewed by a human, approved, merged or published.
