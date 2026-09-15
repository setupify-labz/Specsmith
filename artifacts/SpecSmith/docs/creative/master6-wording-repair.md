# MASTER #6 wording and deliverability repair

Starting checkpoint: `73480443e68e599224a45fe92118c927be23dddd`.

## Fixed

Deleting a price claim's ID no longer removes its qualifier requirement while
leaving the assertion intact. Feedback checks explicit price-identity wording
in narration, on-screen text, title and CTA; exact approved propositions are
also checked independent of bindings. Existing declared claim bindings retain
their required-wording checks. Missing research permission for a price identity
blocks the workflow rather than manufacturing permission.

Missing qualifiers identify the location and offending text, block the review
packet, and never imply approval. Title findings route to the mission owner.
The demonstration's public mission question now asks what the estimates
establish without introducing an unqualified "same price" premise. Claude's
authored attempts and their historical packets are preserved unchanged.

Visual checks now allow feature-specific absence descriptions such as "The
range around each estimate is not displayed here". Negation is scoped to the
feature and clause; a denial does not excuse a subsequent positive range or
price promise. Existing static-motion checks remain intact.

## Limits

These are bounded wording checks, not a semantic factual-completeness model.
Arbitrary paraphrases and implicit references still require human review.
Literal qualifier matching remains conservative. Surface capability records
are still hand-maintained. No new MP4 was rendered, human/audio review remains
outstanding, and the demonstrated research remains explicitly synthetic.

No provider call, paid generation, publishing or main-branch merge occurred.
Targeted regression tests include the actual attempt-3 drafts without altering
their authorship. Full exact-head CI is requested separately at submission.

Verification: 945 v2 tests across 43 files pass; typecheck passes. The new repair
file has 24 tests. Disabling unbound price detection caused seven regression
assertions to fail; disabling feature-specific absence handling caused six.
Both controls were restored and the final suite rerun.
