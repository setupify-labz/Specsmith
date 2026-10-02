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
