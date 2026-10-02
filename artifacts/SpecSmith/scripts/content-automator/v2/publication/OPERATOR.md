# MASTER #8 operator procedure and pilot requirements

This is the closed loop from a reviewed video to the next brief:

> reviewed creative → trusted human authorization → provider publication → real metrics → learning report → next brief.

**Production publication is closed today.** `PRODUCTION_APPROVAL_VERIFIERS` is empty, so `authorizePublication` refuses every production request with `no-trusted-approval-mechanism`. The steps below run end to end only in a **simulation store** (`npm run content:publish:demo`). In production they stop at step 3 until the pilot requirements are met.

Worked examples, all from that demo, are in `examples/`:

- `success-demo-log.txt`
- `success-learning-report.txt`
- `success-next-brief.json`
- `refusal-report.txt`

## Procedure (one video)

1. **Review the exact file.**
   - Run MASTER #7 `reviewCreative` on the final MP4 and its submission. Use the real cut, title, description, CTA destination, production plan and render manifest.
   - Read the packet. `eligible` means "no machine-found defect", not "approved".
2. **Record the review.**
   - Call `recordMachineReview({ storeRoot, packet, submission })`.
   - It re-checks the packet against the current files, then records `machine-reviewed` → `human-review-pending`.
   - A blocked packet stops here with `review-blocked` or `final-approval-blocked`. Fix the creative and review it again; never edit the packet.
3. **Authorize (person).**
   - A reviewer approves the exact media SHA-256, the cut, the destination provider, account and platform, and the packet id and bindings. They approve through a mechanism listed in `PRODUCTION_APPROVAL_VERIFIERS`.
   - `authorizePublication` verifies the decision and records `publication-authorized` with an idempotency key.
   - A name typed into JSON is not an approval. *Today: refused, see Pilot requirement 1.*
4. **Build the request.**
   - Call `buildProviderRequest({ authorization, submission, mediaUrl })`. It is pure and sends nothing.
   - Drafts only.
5. **Send it once.**
   - Call `submitAuthorizedPublication`. It records `submission-started` before contacting the provider, then records what the provider actually said:
     - `draft-submitted`, `scheduled` or `published`, each with a post id;
     - `submission-failed` for a definite refusal;
     - `submission-unknown` for a timeout, a malformed answer, a success with no post id, or an answer for another request.
   - The human-handoff route is `readyToPublishHandoff`. It records `submission-started` with channel `human-handoff` and writes a manifest for a person to release.
6. **Never resend after an unknown answer.**
   - Call `reconcileSubmission`. It asks the provider by idempotency key and records only what the provider confirms.
   - If the provider cannot say (Metricool today), check the provider dashboard by hand.
   - Record a definite result through `ingestPublishResult` / `recordReportedProviderResult`. The provider's lookup must return this submission's idempotency key (it is in the handoff manifest, so enter it where the provider keeps it) and the authorized media hash.
   - Without both, the post is not attributed and the outcome stays `submission-unknown`. This covers an unrelated real post, another authorization's post, and a provider that omits the fields. In production this also needs a provider able to look posts up (`provider-unconfirmed` otherwise).
   - Only `submission-failed` permits another send.
7. **Confirm publication.**
   - Call `confirmProviderState`. It moves `draft-submitted`/`scheduled` → `published` only when the provider's lookup confirms it.
8. **Import metrics.**
   - Call `collectProviderObservations` with a registered `ObservationSource`: an authenticated provider fetch or a verified (signed) export.
   - Only batches such a source issues are accepted, with full identity: creative, post id, platform, cut, account, and when it was observed.
   - *Today there is none for production (`no-verified-source`).* A batch you assemble yourself is refused whatever it claims.
   - Numbers you have only by hand (dashboard, connector text, an unsigned CSV) go to `recordUnverifiedObservations`. They are kept and labelled unverified, and never used for learning.
   - Each metric is stored as one of:
     - `observed`, with the provider field;
     - `unavailable`, with a reason (never zero);
     - `derived`, with its inputs.
   - Re-imports of the same batch are idempotent. Conflicting values are refused. A late, older batch is kept as history but never displaces a newer value. Simulated or synthetic values in a production store are refused.
   - Site clicks count only with attribution: `utm_content` equal to the creative id, plus the measuring source.
9. **Learn.**
   - Call `buildLearningReport({ storeRoot, ... })`. It compares only videos:
     - on the same platform;
     - at the same checkpoint (24/72/168 h ± 6 h);
     - on metrics MASTER #5 marks as primary-eligible;
     - with at least two videos per side.
   - It lists invalid comparisons and unknowns, keeps observations apart from hypotheses, and claims no causation.
10. **Next brief.**
    - Call `nextBriefForWorkflow(report.nextBrief, mission)`. It feeds the report's evidence lines into `fileWorkflow.buildCreativeBrief`, the normal creative door.
    - The new concepts then go through creative checks, rendering, MASTER #7 review and step 3 again.
    - A simulated report is refused for a production mission.

Every store used by a test or demo is a temporary directory created with `initPublicationStore(root, "simulation", purpose)`. A store without that marker is production: it refuses simulated events, simulated providers and simulated verifiers.

## Pilot requirements (before any real post)

1. **A trusted approval mechanism** *(needs Aaron)*
   - The candidate is a GitHub Actions environment with required reviewers. GitHub authenticates the reviewer and keeps the audit record.
   - It needs:
     - (a) a protected environment configured by the repository owner;
     - (b) a workflow whose approved run carries the media SHA-256, the cut, the destination provider, account and platform, and the packet id and bindings digest;
     - (c) a `TrustedApprovalVerifier` that confirms that run through the GitHub API;
     - (d) its addition to `PRODUCTION_APPROVAL_VERIFIERS` in a reviewed PR.
2. **Tamper-evident ledger storage**
   - Transition receipts stop in-process callers. They cannot stop someone with write access to the store directory from writing a well-formed event file by hand.
   - The pilot store needs signed events, or append-only storage the publisher cannot rewrite, before its states are treated as audit evidence.
3. **A provider that can answer "did this post happen, and is it ours?"**
   - Metricool REST is not on the current plan, and the adapter has no verified lookup (`unsupported`).
   - Until there is one, every unknown outcome is resolved by hand, and reported results cannot be confirmed in production.
   - Either a plan with REST and a verified lookup endpoint, or a different provider with idempotent submission and lookup.
   - Either way, the lookup must return the idempotency key and the media hash.
4. **A verified metrics source**
   - Either an authenticated analytics fetch (a plan with Metricool REST, or the platform's own analytics API with the account's credentials), or a provider export carrying a signature SpecSmith can check.
   - It must be implemented as an `ObservationSource` and added to `PRODUCTION_OBSERVATION_SOURCES` in a reviewed PR. Its fields are mapped through the MASTER #5 metric definitions.
   - No connector or person may type numbers in; hand-supplied numbers stay unverified.
5. **A comparable set**
   - At least two published videos per platform with observations inside the same checkpoint window before a report can compare anything.
   - A single pilot video yields a report that says so; this is the expected result, not a failure.
6. **No autonomous posting.** Each video is authorized by a person through requirement 1. Nothing schedules or publishes on a timer.
