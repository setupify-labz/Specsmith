# MASTER #8 dependency map: publication, ledger, provider, analytics, learning

Traced in code on `claude/master7-quality-review` @ `3622053` (PR #170), not from PR text.
Columns: **caller → required evidence → durable record → external side effect**.

## 1. Paths that mark a creative qc-passed / approved / scheduled / published (before #8)

| Transition | Writer (caller) | Evidence required | Durable record | External effect |
|---|---|---|---|---|
| `generated` | `publishingStore.createStoredPublicationLedger` ← `endToEndOfflinePipeline.ts` §6, tests | a fingerprint | `publication-ledgers/<sha(creativeId)>/000000.json` (exclusive create) | none |
| **`qc-passed`** | `advanceStoredPublicationLedger` ← **`endToEndOfflinePipeline.ts:1071`** | **only `reviewRenderedVideo(...).publishable` from a self-reported observation and a 0–10 score**; note `"Passed automated review at N/10"`. No MASTER #7 packet, no media re-hash at the transition | next ledger slot (exclusive create) | none |
| `qc-passed` (any) | `advancePublicationLedger` / `advanceStoredPublicationLedger` are exported and accept **any caller-supplied event**: the transition table is the only check | none: a test or script can write `{status:"qc-passed"}` directly (8 test files do) | ledger slot | none |
| `scheduled` | `metricoolClient.publishApprovedPackage` (REST, inert: no credentials on the current plan) | `assertPublicationGatesPassed`: the ledger *contains* `qc-passed`, request hash == approved hash == file bytes; provider returned an id | ledger slot with `providerPostId` | **Metricool POST `/v2/scheduler/posts`** (draft by default) |
| `scheduled` / `published` / `failed` | `publicationResultIngestion.ingestPublishResult` (the active route) | a **PUBLISH_RESULT JSON a human/ChatGPT types** from the connector output; matched to the handoff's media hash; provider id required for scheduled/published. **Not verified with the provider.** | ledger slot and `publish-results/*.json` | none (the human released the post in Metricool) |
| `published`, `scheduled` | `advanceStoredPublicationLedger` direct | none beyond the table (tests write `scheduled` and `published` directly to set up analytics) | ledger slot | none |
| `analytics-partial/complete` | no production writer (table only) | none | — | — |
| `rejected` / `failed` | direct, result ingestion | none | ledger slot | none |

## 2. Paths that build or send a provider request

| Function | Builds / sends | Gate | Notes |
|---|---|---|---|
| `publishing.buildMetricoolPublishingRequest` | builds (pure) | legacy `QualityReviewResult.publishable` and score + asset bundle hash | used by `endToEndOfflinePipeline.ts` §5 with a `.example` media URL; not sent |
| `readyToPublishHandoff.prepareReadyToPublishHandoff` | writes READY_TO_PUBLISH manifest for a human | `assertPublicationGatesPassed` (**ledger has `qc-passed`**) + media re-hash | the active route; the human releases through the ChatGPT/Metricool connector |
| `metricoolClient.publishApprovedPackage` | **sends** | same gate | inert without `METRICOOL_USER_TOKEN`/`USER_ID`; **no idempotency key**, no handling of an unknown response (timeout → throws, a later retry could double-post) |
| `metricoolLiveSmoke.runLiveSmoke` | **sends** (draft) | three explicit opt-ins + credentials; calls `publishApprovedPackage` | never run by CI |

## 3. Paths that record a publication id / URL
`metricoolClient` (from the REST response) and `publicationResultIngestion` (from the typed document). Both go through `advanceStoredPublicationLedger` with `providerPostId`/`providerUrl`.

## 4. Paths that import or store performance metrics

| Function | Source | Gate | Record |
|---|---|---|---|
| `connectorAnalyticsIngestion.ingestConnectorAnalytics` | ANALYTICS_RESULT document typed from the connector | ledger has `published` with the same provider id; window due; replay; absent ≠ 0 | `analytics-snapshots/*` (one per window, immutable) |
| `metricoolAnalyticsCollector.collectDueAnalytics` | Metricool REST (inert) | ledger `published` | same snapshots |
| `analyticsOrchestrator.runAnalyticsPass` / `analyticsPassCli` | the above | eligibility from ledger | — |
| `v2/experiment/observation.ts` | blessed snapshots → experiment observations | experiment assignment | in-memory `ObservationStore` |

Gaps: snapshots carry no platform-cut id, media hash, account, metric units/definition or observed/derived flag; there is no store-level refusal of synthetic numbers; and the published state they key on can be written without evidence (§1).

## 5. Paths that generate a next-video recommendation
- `performance.analyzePerformance` → `strategist.buildStrategyBatch` (`learningAdjustment`): scores per-video records into adjustments.
- `analyticsOrchestrator` → `metricoolAnalyticsCollector.runLearningFromStoredSnapshots` → `analyzePerformance`.
- `v2/experiment/learning.ts`: candidates from registered experiments (MASTER #5) → `v2/creative/memory.ts` → `briefLinesFromMemory` → `fileWorkflow.buildCreativeBrief(mission, memoryObservations)`. This is the governed route into the creative workflow.

## Bypasses #8 closes
1. **Score-based `qc-passed`** (`endToEndOfflinePipeline.ts:1071`): closed. `qc-passed` is no longer writable, and the pipeline stops at `generated` with a recorded refusal, because it has no MASTER #7 packet.
2. **Direct ledger writes**: every state past `generated` (except `rejected` and `failed`, which only ever stop a creative) needs a transition receipt issued by `v2/publication/boundary.ts`, which is the only module holding the ledger authority.
3. **"Ledger contains qc-passed" as the release gate**: replaced by `publication-authorized`, which needs a revalidated MASTER #7 packet plus a decision from a *trusted* approval verifier.
4. **Typed PUBLISH_RESULT documents advancing `scheduled`/`published`**: must now be confirmed by a provider lookup; an unverified document is refused.
5. **REST send without idempotency**: the send is keyed, recorded as `submission-started` before the network call, and an unknown response blocks blind retries until it is reconciled.

## 6. Ledger states after #8, and where each transition is enforced

Every write passes four checks, in this order:

1. **Store mode** (`publishingStore.advanceStoredPublicationLedger`):
   - A production store (no `store-mode.json`) refuses any event labelled `simulated`.
   - A simulation store refuses any protected event that is *not* labelled `simulated`.
2. **Transition table and evidence** (`publishing.advancePublicationLedger`):
   - `ALLOWED_TRANSITIONS` and `REQUIRED_EVIDENCE` are checked again on every reload by `replayPublicationLedger`.
   - A hand-edited event that skips a state or drops evidence makes the whole ledger fail to load.
3. **Transition receipt** (`publishing.advancePublicationLedger`), for every state except `generated`, `rejected` and `failed`. A receipt is:
   - issued only by the holder of `claimLedgerAuthority()`, which `v2/publication/boundary.ts` claims at import;
   - bound to one event digest (including its `simulated` flag), one ledger position and one store realpath;
   - spent on use.
4. **Exclusive slot create**: a concurrent second writer fails instead of overwriting.

| State | Written only by (boundary) | Precondition the boundary checks |
|---|---|---|
| `generated` | `createStoredPublicationLedger` (free) | a fingerprint |
| `qc-passed` | **nobody** (legacy, read-only) | an old ledger loads with `legacy` set and can only become `rejected`/`failed`. Every #8 consumer reports it as `legacy-unverified` |
| `machine-reviewed` | `recordMachineReview` | a packet issued by `reviewCreative` (unforgeable, WeakSet) for this creative, re-validated against the current submission and files (`packet-stale` otherwise). Records verdict, packet id/version, media sha, cut, bindings digest |
| `human-review-pending` | `recordMachineReview` | packet verdict not `blocked` and final approval not blocked (`review-blocked` / `final-approval-blocked`) |
| `publication-authorized` / `human-rejected` | `authorizePublication` | (a) packet re-validated again; (b) a verifier from `PRODUCTION_APPROVAL_VERIFIERS` (**empty**, so `no-trusted-approval-mechanism`) or, in a simulation store only, `createSimulatedApprovalVerifier()` (`untrusted-verifier` for any other object); (c) the verified decision names this media sha, cut, destination provider/account/platform, packet id and bindings digest (`decision-mismatch`) |
| `submission-started` | `submitAuthorizedPublication`, `recordHandoffSubmission` | an authorization; the request is unaltered (`requestSha256`), its idempotency key, media, cut, destination, title and description match the authorization; mode is draft; the file on disk re-hashes to the authorized sha (`media-changed`). Written **before** the network call |
| `submission-failed` | `recordOutcome` | the provider said `rejected`, or a lookup confirmed no post exists. This is the only state from which a resend is allowed |
| `submission-unknown` | `recordOutcome`, `recordReportedFailure` | a timeout, thrown transport error, malformed answer, success without a post id, or an answer for another request. Blocks resending (`outcome-unknown`) until `reconcileSubmission` gets a provider answer |
| `draft-submitted` / `scheduled` / `published` | `recordOutcome` via `submitAuthorizedPublication`, `reconcileSubmission`, `confirmProviderState`, `recordReportedProviderResult` | the provider's own response or lookup names the post (`confirmedBy`). A reported post id (`recordReportedProviderResult`) or a reconciliation (`reconcileSubmission`) is attributed only when the provider's lookup returns **both** this submission's idempotency key **and** the authorized media SHA-256, and the post is not already bound to another creative. A missing key or hash is not a match: the outcome is left `submission-unknown`. A typed PUBLISH_RESULT is refused without a provider able to confirm it (`provider-result-unverified`) |
| `analytics-partial` / `analytics-complete` | `recordMetricsObserved` ← `observations.importProviderObservations` / `collectProviderObservations` | the ledger is `published` (or already partial), and the batch was **issued by a registered `ObservationSource`** (frozen, digest-checked). A caller-assembled batch is refused whatever it says about itself. Production sources come only from `PRODUCTION_OBSERVATION_SOURCES` (**empty**: `no-verified-source`), and simulation stores accept only `createSimulatedObservationSource()`. Numbers supplied by hand go to `recordUnverifiedObservations`, stored apart, labelled unverified, never read by the learning report and never touching the ledger |
| `rejected` / `failed` | anyone (free) | they only stop a creative |

The provider mode must match the store mode (`provider-mode-mismatch`). A simulated provider never runs against a production store, and a real one never runs against a simulation store.

## 7. What this does not protect (unresolved)

- **Production approval.**
  - `PRODUCTION_APPROVAL_VERIFIERS` is empty, so production publication is closed. This is by design, not a bug.
  - Closing the gap needs an authenticated reviewer, a tamper-evident decision record, and a payload bound to the media sha, cut, destination, account, packet id and bindings. The candidate is a GitHub Actions environment with required reviewers, configured by the repository owner.
- **Storage protection.**
  - Receipts stop *in-process* callers. They cannot stop someone with filesystem access from writing a well-formed event file by hand: replay validates the shape and evidence, not who wrote it.
  - Tamper evidence needs signed events or an append-only store outside the writer's control.
- **Provider lookup.**
  - The Metricool REST adapter has no verified lookup endpoint (lookups report `unsupported`), and REST is not available on the current plan.
  - An unknown outcome therefore stays unknown until a person checks the dashboard. A reported result cannot be confirmed in production.
  - Even with a lookup, a post is attributed only if the provider returns the submission's idempotency key and the media hash. A post a person creates by hand is unattributable unless the key is entered somewhere the provider stores and returns it.
- **Production metrics.**
  - `PRODUCTION_OBSERVATION_SOURCES` is empty. There is no authenticated Metricool analytics fetch on the current plan, and no signed export, so production metrics cannot enter the learning report.
  - Numbers typed from a dashboard or pasted from the connector are kept only as unverified.
  - The learning report also ignores stored observation files whose source is not a registered production source, so a hand-written file is not used. Detecting hand-written files in general is part of the storage gap above.
