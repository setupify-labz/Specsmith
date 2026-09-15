# MASTER #6 independent matcher repair

Inspected checkpoint: `8729e40990950e2edc40251c827f3564bf594237`.

## Corrected failure

The matcher converted every spoken count to a price-like figure and treated
`builds` as a distinctive identifier. With the refused proposition "One of
these two builds is the better buy", `Step one`, `Step two`, `Pick one`, and
an approved statement about overlapping model estimates all matched without
making a purchase judgment. This was not useful fail-closed behaviour: it was
a false positive, and authoring around it was unnecessary.

Small unqualified counts no longer emit figure tokens. Number words and plural
generic build vocabulary no longer count as product identity. Percentages,
explicit money, qualified numeric facts, full spoken prices, price shorthand,
Unicode-normalized identifiers and distinctive nonnumeric assertions retain
their guards. An explicit generic purchase judgment remains detectable even
when its incidental count/subject tokens are discarded. The strict gate still
rejects unsupported judgment wording in questions, hedges and denials.

Regression tests recheck both committed, Claude-authored attempts. The
historical attempt-1 feedback is preserved, not rewritten as if the repaired
matcher had generated it. Its rejection must not be presented as proof that
Claude made unsupported purchase claims: the relevant matches were incidental
count false positives. Both batches now clear the existing machine checks;
neither gains human approval.

## Independent creative review remains outstanding

The real batch is more concrete than fixed generic scaffolds, but no machine
pass proves creativity, factual completeness or renderer feasibility of the
words it contains. In particular:

- "Same price" concerns editorial CPU-plus-GPU totals, not complete builds or
  fresh purchase quotes. The scripts must not imply otherwise.
- The vanishing-gap treatment promises a range being drawn while declaring
  only a static Compare capture. That promised visual has not been rendered
  or demonstrated by this workflow.
- "Most comparisons ... hide the range" is a market-wide factual assertion
  with no evidence binding in the supplied research contract.

Those are review concerns, not silently approved assertions. Original Claude
drafts and their provenance remain intact for independent revision/review. No
API call, paid generation, publishing, rendering or main-branch merge occurred.

## Verification

The v2 suite passes 888 tests across 40 files; typecheck passes. The new
regression file contains 23 tests, including rechecks of both actual authored
batches. Temporarily restoring incidental-count figure emission caused nine
regressions; disabling explicit purchase-judgment matching caused six. Both
controls were restored before the final suite. Full exact-head CI is pending
at submission.
