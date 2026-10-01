# MASTER #7 dependency map

Traced in the code on `claude/compare-ties-animated-poc` (#169, b990f6b), not from PR descriptions.
"Exists" means it runs on the production render path today. "Disconnected" means
the code exists but nothing on the #6 → render path calls it.

| Area | Check | Where | Status before #7 |
|---|---|---|---|
| #1 | Storyboard pacing, caption CPS/lines, hook, CTA, `recommendedFixes` | `v2/creativeQualityReview.ts` | Exists. Reads storyboard text and timing only, never frames or audio. |
| #1 | Storyboard gate (picture identity, repeated views) | `v2/creative/storyboardQualityGate.ts` | Exists. Runs inside the #6 workflow. |
| #1 | Repair loop, lineage | `v2/beatRepair.ts` | Exists. Not on the #6 path. |
| #1 | Creative report; human gates; `publishReady` can't be reached | `v2/contentCreativeReport.ts` | Exists. Gates can't close: `NO_TRUSTED_APPROVAL_RECORD`. |
| #2 | Claim states, `UNSAFE_FOR_CREATIVE`, safe/unsafe claims | `v2/research/{model,creativeContract}.ts` | Exists. |
| #2 | Script vs research (`checkScriptAgainstResearchStrict`, fail-closed) | `v2/research/creativeContract.ts` | Exists. Checks storyboard text, not the render. |
| #2 | Synthetic markers (`provenance.synthetic`, `contractDeclaresSynthetic`) | `v2/research/*` | Exists. The packet must keep it; a flag can't clear it. |
| #6 | Concept assessment, disclosure validity (`disclosure-describes-absent-range`) | `v2/creative/concept.ts` | Exists (#169). |
| #6 | Workflow packet `machineChecksPassed` / `humanReviewReady` / `approved:false` | `v2/creative/fileWorkflow.ts` | Exists. The demo batch is unready, because two concepts have #1 fixes. |
| #6 | Production plan: per-beat validated views, disclosure panel, caption band | `v2/creative/proposalPass.ts` | Exists (#168). |
| #6 → #1 | Concept handoff (WeakSet-issued, identity hashes) | `v2/handoff/conceptHandoff.ts` | Exists. It refuses an unready batch, so the demo can't use it. It names `RENDER_PROVENANCE_GAP`. |
| #166 | Media bytes hashed, `recheckMedia` | `v2/mediaVerification.ts` | Exists. Proves the bytes are unchanged, not what they show. |
| #168 | Banded frame check: disclosure band, story band against its capture, caption ink, distinct cuts | `bandedFrameCheck.ts` | Exists. It's called only by the `master6OfflineRender.ts` script, not by any review. |
| #168 | Disclosure panel measured in the browser (font, contrast, overflow) | `uiRender/disclosureOverlay.ts` | Exists. The result is in the artifact metadata, and nothing re-reads it. |
| #169 | Captures refuse a stale Compare (averages + `N ties` must be on the page) | `uiRender/surfaces.ts` | Exists at capture time. Nothing checks it again at review time. |
| #169 | Ties counted separately | `src/lib/compareTally.ts` | Exists in the app and in `leadsVsAverage/facts.ts`. |
| legacy | `reviewRenderedVideo` (self-reported scores, `masterSha256`) | `qualityReviewer.ts` | Exists. Its inputs are caller-supplied observations. |
| legacy | Ledger `qc-passed` from `reviewRenderedVideo` score | `endToEndOfflinePipeline.ts` ~L1072, `publishing.ts` | **Open bypass of any #7 packet.** Publication is #8's territory. Reported, not rewired. |
| legacy | Asset rights manifest (image/video/3D only) | `assetRights.ts` | Exists for product visuals. Audio, captions, UI captures and fixtures aren't covered. |

## Gaps #7 closes (concrete, not invented)

1. Nothing reviews the rendered cut as a whole. The frame check, the disclosure measurement, the capture verification and media hashing each exist, but nothing binds them to one creative and one platform cut.
2. Nothing re-checks a capture's numbers against the current model at review time. A capture taken before the tie fix would pass review.
3. Nothing checks figures shown or spoken against the model they come from: ties as leads, swapped builds, wrong settings, ranges the page doesn't show, rounded averages called exact, one game generalised.
4. Caption text is compared to the storyboard, not to the captions file that was burned in.
5. Narration timing: the local TTS reads all beats as one continuous take, so no reliable per-beat timing exists. This is an upstream limit, and it is reported in the packet.
6. Rights for audio, captions, UI captures, fixtures and placeholder voice aren't covered.
7. There is no recheck planning: nothing says which checks a change invalidates.

## Branch strategy

`claude/master7-quality-review`, branched from #169's head (`b990f6b`). It excludes the
animation POC branches (`claude/reversal-short-poc`), which are not production formats.
All #7 code lives in `v2/review/`, plus small metadata additions to the capture, TTS and render
runners. These additions record what was already verified, so a review can re-check it.
