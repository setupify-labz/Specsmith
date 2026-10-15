# Auto Goal pilot: coordinator ↔ executor handoff contract (design only)

**Status: design for review. Nothing here is implemented, enabled, or authorised to run.** No workflow is installed or enabled, no credential exists, and no goal has been started.

This contract connects two existing, disabled designs for **one** pilot goal:

- **Coordinator**: the Auto Goal runner at #185 head `4715d071368045943de912f796311d63d7730593` (stacked on #184 `83789855fd18a593eaa641b4c0c444cd5dd04f2b`). It owns the goal record, decides the next step, dispatches the executor, and asks Codex for review. It never edits, pushes, opens PRs, or runs proposed code.
- **Executor**: `docs/auto-goal-actions/auto-goal-actions.yml` at `f68add4463b0f317a54c247d51bc5c641b541a91`. It proposes edits with the restricted Claude CLI, publishes them to the goal branch, owns the draft PR, runs the trusted checks on the exact commit, and records the result. It never decides what happens next and never writes the goal record.

It does not build a second runner: every decision stays in `decide.ts`, and every record write stays in `store.ts`.

**Revision 2** fixes three things in revision 1 (`e44ee21`):

- **H3/H4:** a dispatch is no longer tied to a coordinator run, so a delayed executor run stays valid. Replacement is defined (§5.1).
- **H6b:** the coordinator no longer recovers the PR. A publish that crashed after pushing is completed by the executor (`finish-publish`), or the goal blocks (§5, H6).
- **CI:** the over-broad statement about CI on PRs created with `GITHUB_TOKEN` is corrected (§3.1).

§9 traces one crash for every recovery path.

**Revision 3:**

- **§3.1 corrected again:** `pull_request` events caused by `GITHUB_TOKEN` can create workflow runs that wait for approval. The official documentation is linked.
- **New §1A:** a minimal **first-pilot path (version 1)**. Every failure becomes a visible blocker, with no automatic recovery, and §1A lists the exact code changes it needs.
- **Phase 2:** the full recovery design (§5.1 lifecycle, `finish-publish`, check-only dispatches, fix loops, §9 traces) is kept unchanged as the later phase.

## 1. Principles

1. **One writer per artifact.**
   - **Goal record** (issue comments): written by the coordinator only, through `IssueCommentStore` with its revision check.
   - **Goal branch and draft PR:** written by the executor only. There are **no exceptions**.
   - **Codex request comments:** posted by the coordinator only.
2. **Every handoff names its exact commit.** No step acts on "the latest" anything. A handoff whose commit no longer matches is refused, not adapted.
3. **Save intent before acting, verify before believing.** The coordinator records a dispatch before it dispatches. It records a result only after binding it to a specific executor run, job, and commit through the GitHub Actions API.
4. **Exactly one commit per base.** Every branch update is a compare-and-swap from a recorded base. However many executor runs race, at most one commit can follow a given base.
5. **Untrusted text has one destination.** Issue text and Codex finding text reach only the restricted implementer (#188 flags), as data. The coordinator's work orders carry IDs, SHAs, and URLs, never review text. That is already true of `runner.ts` `workOrder()`.
6. **Fail closed.** Any mismatch, missing evidence, or exhausted cap gives `blocked` with the exact reason. Nothing is guessed.

## 1A. First pilot path (version 1): straight line, every failure a visible blocker

Version 1 is the smallest path that can complete one goal:

> one goal → a test reproduces the bug → Claude fixes it → the checks pass → Codex reviews → the goal completes.

It uses the identifiers, binding rules and trusted check IDs of §2–§3. It has **no automatic recovery**:

- no resend, no cancel, no supersede;
- no `finish-publish` or check-only dispatch;
- no fix loop for red checks or Codex findings.

Every failure records `goal.outcome = blocked` with an exact reason and links, and stops. The existing `renderRecordComment` shows that outcome as the "Outcome" line of the current record comment on the goal issue, which is the visible blocker. `advance()` already schedules no next run after a blocked outcome. A person reads the blocker and decides what happens next. Everything in §5.1, the recovery parts of §5.2 and §9 is **Phase 2**.

### 1A.1 Scope

- **One goal**, created by Aaron with `cli.ts start`. One acceptance criterion, a `vitest:` check on an **existing** test file at `B`, plus the `typecheck` guard after the fix. No `suite`, no `browser`.
- **Two dispatches only:** `pilot-1.d1` (`reproduce`, base `B`) and `pilot-1.d2` (`implement`, base `T`). Each is sent **once**.
- **Codex rounds:** one review round. Findings are not fixed automatically; they block.
- **Draft PR:** created by the executor in d1, updated by d2, never marked ready and never merged.
- **Repository CI** is not part of the decision (§3.1).

### 1A.2 States

| # | State | Entered when | Next (`decide`) |
| :- | :- | :- | :- |
| V0 | Created | record revision 1, no dispatches | `reproduce`: save d1, then send it |
| V1 | Reproducing | d1 live | `wait-executor` |
| V2 | Reproduced | d1's run succeeded: branch = `T` (parent `B`, trailer `pilot-1.d1`), PR `P` open draft from `goal.branch`, before-fix rule (§3) holds on `T` | `implement`: save d2, then send it |
| V3 | Fixing | d2 live | `wait-executor` |
| V4 | Verified | d2's run succeeded: head = `F` (parent `T`, trailer `pilot-1.d2`), after-fix rule holds on `F` for the criterion and `typecheck` | `request-review` on `F` (existing code) |
| V5 | Reviewing | round 1 requested on `F`, confirmed posted | `wait-review` (existing) |
| V6 | **Complete** | round 1 clean on `F`, no open material findings, PR head still `F`, still an open draft | `complete` (existing outcome code) |
| VB | **Blocked** | any row of §1A.3 | none |

### 1A.3 Visible blockers

Every blocker writes `outcome.reason` exactly as below, filling in the placeholders, with `outcome.evidence` holding the links named.

| Situation | Detected by | Blocker reason (evidence) |
| :- | :- | :- |
| **Missing executor run**: no run named `N` within `dispatchGraceMinutes` (15) after `sentAt`, or the dispatch was saved but `sentAt` never recorded (the session died mid-send) | `syncGoal` | "Executor run for `N` was not seen; no automatic resend in version 1." (dispatch record) |
| Executor run still queued or in progress after `executorTimeoutMinutes` (60) | `syncGoal` | "Executor run `<id>` for `N` did not finish within 60 min." (run URL) |
| More than one bound run named `N` | `syncGoal` | "Duplicate executor runs for `N`." (run URLs) |
| Run fails binding (§2), or `E` changed | `syncGoal` | "Executor run `<id>` is not the reviewed executor at `E`." (run URL) |
| **Failed publish**: the run's `implement` or `publish` job concluded anything but `success`. This covers a crash before the push and a crash after the push, before the PR. | `syncGoal` | "Publish failed for `N` (job `<name>`: `<conclusion>`); branch head `<sha or absent>`, PR `<#n or none>`." (job URL, branch head) |
| Publish succeeded but the branch head, parent, trailer or PR doesn't match | `syncGoal` | "Published commit for `N` does not match the dispatch." (commit, PR) |
| **Incomplete check**: an expected `check <phase> <id> <sha>` job is missing, or concluded `cancelled`, `skipped` or without a conclusion | `syncGoal` | "Check `<id>` did not complete on `<sha>` (`<conclusion>`)." (run URL) |
| Before-fix rule fails: the check passed on `T`, or `B…T` touched files other than the criterion file | `syncGoal` | "Reproduce did not prove the defect on `T`: `<which rule>`." (job URL, compare URL) |
| After-fix rule fails: a check failed on `F`, or `T…F` changed the criterion file | `syncGoal` | "Fix did not pass on `F`: `<id>` `<conclusion>`." (job URL) |
| Codex returned material findings on `F` | `decide` | "Codex found `<n>` material finding(s) on `F`; version 1 does not fix findings." (round URL) |
| Codex unavailable, or no answer within `reviewTimeoutMinutes` | `decide` (existing) | existing reasons |
| PR closed, merged, not a draft, wrong base, or a foreign head | `syncGoal` (existing `pullMismatch`, plus the trailer check) | existing reasons, plus "Foreign head `<sha>` on `goal.branch`." |
| Caps: runs, hours | `decide` / `begin` (existing) | existing reasons |

**A late executor run after a blocker is refused.** The executor's dispatch check (H4) requires `goal.outcome == null` as well as the current live dispatch. A run that starts after the goal blocked therefore stops before Claude runs.

### 1A.4 Exact code changes for version 1

These are the changes **this version needs**. The fuller list in §6 is for Phase 2.

**Runner (coordinator), against #185 `4715d07`:**

1. **`record.ts`**
   - `RECORD_VERSION` becomes 2.
   - `GoalRecord` gets `executorSha?: string`. Its presence turns on executor mode, and goals without it behave exactly as now.
   - `GoalRecord` gets `dispatches?: Dispatch[]`, with `Dispatch = {k, nonce, phase: "reproduce" | "implement", baseSha, createdAt, sentAt: string | null, runId: number | null, state: "pending" | "bound" | "succeeded" | "failed", result: string | null}`.
   - `CheckRun` gets an optional `source: {runId, jobId}`, and `exitCode` becomes optional only when `source` is present. The executor reports "expectation met or not", not a raw exit code (see change 13).
   - `Caps` gets `dispatchGraceMinutes` (default 15) and `executorTimeoutMinutes` (default 60).
   - `createGoal()` accepts `executorSha`.
   - `validateGoal()` enforces, in executor mode:
     - exactly one criterion, of kind `vitest`;
     - at most one live dispatch;
     - nonce format `<id>.d<k>`;
     - phases in order;
     - `branch == claude/auto-goal-<id>`.
2. **`decide.ts`**
   - New `Action` member `wait-executor`.
   - In `decide()`, executor mode: the V0–V6 order of §1A.2, and the `decide`-detected rows of §1A.3. Material findings give **blocked**, not `fix-findings`. A failed check gives **blocked**, not `fix-ci` or `implement`. `open-pr` and `verify` are never returned.
   - Steps 7 (review) and the `complete` return stay as they are.
   - Step 8 (CI) treats the executor's `typecheck` job as the only required check (see change 3).
3. **`sync.ts`**
   - In `syncGoal()`, executor mode:
     - if `goal.pr` is null, read it from `openPullsFor(goal.branch)` (read only; it never creates one);
     - run new `syncDispatch()` before the existing PR, head and Codex sync;
     - set `goal.ci` from the bound executor guard job instead of `checkRuns`, as `{sha, runs: [{name: "typecheck", status, conclusion, url}]}`, so the unchanged `ciState()` works with `requiredChecks = ["typecheck"]`.
   - New `syncDispatch(goal, github, now)` applies the `syncGoal` rows of §1A.3:
     - binds the run (§2);
     - sets the dispatch state;
     - on success, ingests `check <phase> <id> <sha>` jobs as `goal.checks` entries with `source`;
     - verifies the head commit's parent, trailer and compare file list;
     - writes `goal.outcome` for any blocker row.
   - New pure helper `bindExecutorRun(run, goal)`.
4. **`github.ts`**: add to the `GitHub` interface and `ghCli`:
   - `dispatchWorkflow(repo, file, ref, inputs)`, using `POST /actions/workflows/{file}/dispatches`;
   - `workflowRuns(repo, file, createdSince)`;
   - `run(repo, id)`;
   - `runJobs(repo, id)`;
   - `compareFiles(repo, base, head)`;
   - `commit(repo, sha)`.

   It adds no cancel and no branch write.
5. **`runner.ts`**
   - In `advance()`, executor mode, for the `reproduce` and `implement` actions:
     - instead of the code-action block (no `git.isClean`, `git.push` or `deps.check`), save the dispatch (`fence`, then `store.save`);
     - call `dispatchWorkflow` with `{goal, issue, nonce}`;
     - save `sentAt`.

     `wait-executor` re-arms with `NEXT_RUN_MINUTES.wait`.
   - In `begin()`, executor mode, skip `ensureBranch`.
   - In `workOrder()`, executor mode, every action's `todo` is "No code is due. Run `advance`."
   - `runnerPrompt()`: drop step 3 for executor-mode goals.
6. **`wake.mjs`**
   - `normalizeEvent("workflow_run")`: when the run name matches `Auto Goal <goal> <goal>.d<k>`, return `{kind: "checks", goal, sha: null, prs: []}`.
   - `decideWake()`: accept a `checks` wake identified by goal rather than PR.
   - `auto-goal-wake.yml`: add the executor workflow's name to `workflow_run.workflows`. That is a workflow file change and stays disabled.
7. **`cli.ts`**: `start` takes `--executor-sha <sha>`, derives `--branch` as `claude/auto-goal-<id>`, and refuses non-`vitest` criteria in executor mode.

**Executor, against `f68add4`:**

8. **`on.workflow_dispatch.inputs`**: `goal`, `issue` and `nonce`, replacing `issue_number`. Add top-level `run-name: Auto Goal ${{ inputs.goal }} ${{ inputs.nonce }}`.
9. **`read-issue` becomes `read-dispatch`**
   - Permissions: `issues: read` and `contents: read`.
   - Check out `github.sha`, which must equal `E` because `E` is pinned in the record, sparsely, for `artifacts/SpecSmith/scripts/auto-goal/`.
   - Read the record with `parseRecordComment` from the trusted login. Refuse unless:
     - `outcome == null`;
     - `nonce` is the live dispatch;
     - `github.sha == executorSha`;
     - for `reproduce`, `goal.branch` is absent; for `implement`, its head is `baseSha` (checked with `git ls-remote`).
   - Output phase, `baseSha`, criterion file, request text (as data) and branch.
10. **`implement`**
    - Check out `baseSha` instead of `github.sha`.
    - Use a phase-specific fixed prompt: reproduce is "edit only `<criterion file>` so its test fails on the current code"; implement is "make `<criterion file>` pass without editing it".
    - The #188 CLI flags are unchanged.
11. **`validate-proposal.mjs`**: new `--phase reproduce|implement --criterion <file>`. For reproduce, the changed paths must be exactly `{criterion}`; for implement, the criterion must not be among them. The existing rules are unchanged.
12. **`publish`**
    - Check out `baseSha`, apply the patch, and commit with the `Auto-Goal-Dispatch` and `Auto-Goal-Run` trailers.
    - Push `X:refs/heads/claude/auto-goal-<goal>` with `--force-with-lease=refs/heads/<branch>:<baseSha, or empty for reproduce>`.
    - Reproduce: create the draft PR. Implement: require that the existing draft PR from the branch is open.
    - Output `sha` and `pr_number`. The run-id branch name is removed.
13. **`check`**
    - A matrix over `[criterion, "typecheck" (implement only)]`, named `check ${{ needs.read-dispatch.outputs.phase }} ${{ matrix.id }} ${{ needs.publish.outputs.proposal_sha }}`.
    - Check out `X`, and separately `E`, to run a new trusted script, `docs/auto-goal-actions/run-check.mjs`. It maps a check ID through `checks.ts` `stepsFor()` and runs the argv without a shell.
    - The job **succeeds only when the expectation is met**: for `before`, the check executed and exited non-zero; for `after`, it exited 0.
14. **`record-check`**
    - The status context depends on the phase: `auto-goal/before` or `auto-goal/check`.
    - The branch pattern becomes `^claude/auto-goal-[a-z0-9-]+$`.
    - The other refusals are unchanged.

**Tests for version 1** (offline, fake GitHub API plus mock Claude, no credential):

- the full V0 → V6 path;
- one test per row of §1A.3, checking the exact blocker reason and that no further dispatch, push or comment happens;
- a late executor run refused after a blocker;
- a stale or unknown nonce refused before Claude runs;
- token and untrusted-text markers absent from all logs.

## 2. Identifiers and pinned commits

| Name | Meaning | Fixed when | Stored in |
| :- | :- | :- | :- |
| `goal.id` | Goal ID, e.g. `pilot-1` | creation | record |
| `goal.branch` | `claude/auto-goal-<goal.id>`; the only branch the executor may write | creation | record (already `readonly branch`) |
| `goal.baseBranch` | `main` | creation | record |
| `E` (`goal.executorSha`, **new**) | The `main` commit whose `.github/workflows/auto-goal-actions.yml` is the reviewed executor | creation | record |
| `R` | The runner tooling commit (existing `toolingSha()`) | each coordinator run | run entry / prompt |
| `B` | The `main` commit that the reproduce patch applies to | reproduce dispatch | `dispatch.baseSha` |
| `T` | Reproduce commit: `B` plus test-only changes | executor publish | branch, PR head, record `checks[].sha` |
| `F1, F2, …` | Implement and fix commits; each parent is the previous head | executor publish | same |
| `N` (dispatch nonce) | `<goal.id>.d<k>`, where `k` counts dispatches for the goal, e.g. `pilot-1.d3`. It is **not** tied to a coordinator run number. | before dispatch | `goal.dispatches[k-1].nonce`; the executor's `run-name` |
| `P` | Draft PR number, from `goal.branch` to `main` | first publish | `goal.pr` |

**Commit trailers.** Every commit the executor publishes carries two trailers:

```
Auto-Goal-Dispatch: <N>
Auto-Goal-Run: <Actions run id>
```

**Executor run binding.** The coordinator accepts an executor run as evidence only if `GET /repos/{repo}/actions/runs/{id}` reports all of the following:

- `path == ".github/workflows/auto-goal-actions.yml"`;
- `event == "workflow_dispatch"`;
- `head_branch == "main"` and `head_sha == E`;
- the run name contains `N` exactly, and `N` is a dispatch recorded in the goal.

If `main` moves past `E`, later dispatches would run a different executor. The pilot then **blocks** with "executor commit changed" and does not adapt.

## 3. Trusted check IDs

Acceptance and guard checks are named only by IDs that map one-to-one onto the existing `checks.ts` registry. `stepsFor()` validates each one, and `describeCheck()` gives the recorded command text, which `validateGoal()` already requires to match.

| Check ID | `CheckSpec` | Role in the pilot |
| :- | :- | :- |
| `vitest:src/<path>.test.ts[x]` | `{kind:"vitest", file}` | **Acceptance criterion.** The file must already exist at `B`. |
| `typecheck` | `{kind:"typecheck"}` | Guard: after-fix only |
| `suite` | `{kind:"suite"}` | Guard: after-fix only |
| `browser:…` | `{kind:"browser", …}` | **Not allowed in the pilot.** Its script is outside the executor's edit allowlist. |

**Pilot restrictions:**

- **One goal and one to three acceptance criteria, all `vitest:` checks on existing files** under `artifacts/SpecSmith/src`. The patch validator refuses new files (`validate-proposal.mjs`), so a reproduce step can only edit an existing test file.
- **Guards don't count as acceptance criteria.** A `typecheck` or `suite` check can't be made to fail by a test-only change, so neither can serve as one.

**Before-fix rule** (proves the test detects the defect) holds only when all four hold:

- for every criterion, the executor's `check` job ran on `T` and **failed with the check executed** (`runCheck` would report `executed: true`, exit ≠ 0);
- the files changed between `B` and `T` are a subset of the criteria's check files, checked with the coordinator's own compare call (`GET /compare/B...T`);
- `T`'s parent is `B`;
- the check jobs are bound to a dispatch of this goal (§2).

**After-fix rule** (proves the fix) holds only when all three hold:

- for every criterion and guard, the executor's `check` job ran on the current head `F` and **succeeded**;
- the criteria's check files at `F` are byte-identical to those at `T`, compared as blob SHAs through `GET /compare/T...F`, which must not list them;
- the check jobs are bound to a dispatch of this goal.

**Job names carry the evidence.** Each executor check job is a matrix leg named exactly `check <phase> <criterion-or-guard-id> <sha>`; the coordinator reads `GET /actions/runs/{id}/jobs`. `jobs.<id>.name` may use `needs` and `matrix`, so the SHA comes from `needs.publish.outputs.proposal_sha`. The coordinator stores `{runId, jobId, conclusion}` in the new `CheckRun.source` field, which makes ingestion idempotent.

### 3.1 Repository CI on the executor's PR (corrected in revision 3)

Revisions 1 and 2 said, or implied, that a PR opened or updated with `GITHUB_TOKEN` gets no repository CI. **That is wrong.**

**What GitHub documents.** Events caused by `GITHUB_TOKEN` generally don't start new workflow runs, to prevent accidental recursion. The documented exceptions are:

- `workflow_dispatch` and `repository_dispatch`;
- `pull_request` events of type `opened`, `synchronize` and `reopened` caused by `GITHUB_TOKEN`. These **do create workflow runs, held for approval**: someone with write access must approve them on the PR before they run.

Runs started by a GitHub App installation token or a personal access token don't need that approval. GitHub's June 2026 changelog describes the same approval flow for PRs created by `github-actions[bot]`.

Sources:

- [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow);
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows);
- [`GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token);
- [Changelog, 2026-06-11: bot-created pull requests can run workflows if approved](https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/).

docs.github.com could not be fetched from the session that wrote this revision. These statements come from search results that quote those pages, so a reviewer should confirm the wording against the pages themselves.

**What that means here:**

- **Approval-held CI runs:** the executor opens the PR (`opened`) and pushes later commits (`synchronize`) with `GITHUB_TOKEN`. Each of these can create a `Verify pull request` run that **waits for approval**; on `main`, `verify-pr.yml` runs on `pull_request` to `main` and on `workflow_dispatch`.
- **Approving one runs proposed code:** a person who approves such a run lets that workflow run the PR's proposed code with `verify-pr.yml`'s permissions. That is a decision for a person; the coordinator never approves runs.
- **Already visible to the coordinator:** the existing wake bridge listens for `workflow_run` completions of "Verify pull request", and `syncGoal` already reads check runs on the head.

**Pilot rule:**

- **Required:** the executor's own check jobs (§3) on the exact head.
- **Repository CI is left out of the decision.** In executor mode the coordinator does not feed repository check runs into `ciState`.

  The reason: a run waiting for approval reports either as not completed, which the existing `ciState` reads as "pending" and would wait on until the CI timeout blocks the goal, or as `action_required`, which `ciState` would read as red. Either would turn an unapproved run into a false failure or a stall.
- **The coordinator never approves a run.** If a person approves one, its result is visible on the PR for the human reviewer, but it does not change the goal's outcome in the pilot.
- **Pushes by others:** a push by anyone else is a foreign head and blocks the goal (H9).

Making repository CI part of completion would need three things:

- a person, or a separately approved App token, to start `verify-pr.yml` on the exact head;
- binding that run the way the executor's runs are bound;
- treating "waiting for approval" as its own state rather than red or pending.

That is out of scope for the pilot.

## 4. State map

States are predicates on the record. `decide()` stays the only function that computes the next action from them. "→ blocked" always records the exact reason in `goal.outcome` and closes the run (existing behaviour). "Dispatch" always means the §5.1 lifecycle.

| # | State | Record predicate | Next action (`decide`) | Owner of the next step |
| :- | :- | :- | :- | :- |
| S0 | Created | no dispatches, no checks, `pr == null`, branch absent | `reproduce` | coordinator |
| S1 | Reproduce dispatched | current dispatch `phase=reproduce`, `baseSha=B` | `wait-executor` | executor |
| S2 | Reproduce published | branch = `T` with trailer of a reproduce dispatch, `pr = P` (draft), check jobs pending | `wait-executor` | executor |
| S3 | Reproduced | before-fix rule holds on `T` | `implement` | coordinator |
| S3x | Reproduce ineffective | a criterion **passed** on `T`, or `B…T` touched other files | blocked for the pilot (no second test-writing attempt) | — |
| S4 | Implement dispatched | current dispatch `phase=implement`, `baseSha = head = T` | `wait-executor` | executor |
| S5 | Implement published | head = `F` (parent `T`), trailer of an implement or fix dispatch | `wait-executor` | executor |
| S6 | Verified | after-fix rule holds on `F == head` | `request-review` | coordinator |
| S6x | After-fix failed | any criterion or guard failed on `F` | dispatch `phase=fix` with `baseSha=F`, within `maxFixAttempts`; otherwise blocked | coordinator |
| S7 | Review requested | round k: `requestedSha = F = head`, request comment confirmed | `wait-review` | Codex |
| S8a | Review clean | round k clean on `F`, no open material findings | `complete` (if S6 still holds on `F`) | coordinator |
| S8b | Findings | material findings open from round k | dispatch `phase=fix` with `baseSha=F` and finding IDs, within caps → S5 with new head `F'` | coordinator |
| S9 | **Complete** | S6 and S8a on the same head `F`; PR still an open draft from `goal.branch` at `F` | none (`done`) | — |
| SB | **Blocked** | any condition below | none (`done`) | — |

**Blocked conditions**, each with an exact reason:

- **Caps:** `maxRuns`, `maxHours`, `maxReviewRounds` or `maxFixAttempts` reached (existing), or the new `maxDispatchAttempts` per phase (default 2) exhausted.
- **Executor and binding failures:**
  - a `finish-publish` dispatch failed (§5, H6);
  - an executor run fails the binding check (§2);
  - `E` changed;
  - two bound check jobs disagree on the same commit.
- **PR and branch changes:**
  - a head appears that no dispatch of this goal produced (a foreign push);
  - the PR was closed or merged outside the goal (existing `syncGoal` handling);
  - the PR stopped being a draft, or no longer goes from `goal.branch` to `main` (existing `pullMismatch`).
- **Codex:** it replied `unavailable` (existing), or did not answer within `reviewTimeoutMinutes` (existing).
- **Executor not seen:** no executor run appeared for a dispatch after its resend (§5.1).

**Order change in `decide()`.** The runner's current order is: reproduce → implement → verify locally → open PR → review → CI. The contract's order is: reproduce (via executor, which opens the PR) → implement (via executor) → verify from executor evidence → review → complete. The coordinator never runs an "open-pr" step, because the PR exists from S2 and only the executor writes it.

## 5. Handoffs

**Phase 2.** The resend, cancel, supersede, `finish-publish` and check-only parts of this section are **not** in the first pilot. Version 1 (§1A) uses H1–H12 as the straight-line path and replaces every recovery step with the visible blockers of §1A.3.

### 5.1 Dispatch lifecycle, Phase 2 (fixes the revision-1 H3/H4 gap)

In revision 1 the nonce named a coordinator run (`r<n>`), and H4 required that run to still be open. A coordinator session that crashed after dispatching was closed as abandoned by the next session, which made a merely *delayed* executor run invalid and invited a duplicate. Now dispatches live on the goal, independent of coordinator runs.

**Record.** `goal.dispatches[]` entries hold:

- `{k, nonce, phase, baseSha, targetSha?, findingIds?, createdAt, sends, runIds[], state, result?}`;
- `phase` is one of `reproduce`, `implement`, `fix`, `check` or `finish-publish`;
- `state` is one of `pending`, `bound`, `published`, `succeeded`, `failed`, `cancelled` or `superseded`;
- `pending` and `bound` are live; the other states are final.

**Invariant:** at most one dispatch is live at a time. That dispatch is the **current dispatch**.

**Executor validity** (checked at H4, and again by `publish` immediately before it pushes). A run carrying nonce `N` may proceed only if all four hold:

1. `N` names the current dispatch, which is live;
2. for `reproduce`, `implement` and `fix`: that dispatch's `baseSha` equals the live head of `goal.branch`, or the branch is absent for `reproduce`;
3. for `check` and `finish-publish`: the branch head equals `targetSha`. For `finish-publish`, `targetSha`'s parent must also equal `baseSha`, and its trailer must name an earlier dispatch of this goal that is recorded as `published`.
4. the run itself binds (§2).

A delayed run therefore **stays valid** for as long as its dispatch is current and the branch has not moved, however late it starts. Abandoning a coordinator run has no effect on it.

**Coordinator handling of the current dispatch**, on every sync. Here "runs" means `GET /actions/workflows/auto-goal-actions.yml/runs?created>=<createdAt>`, filtered to run names containing `N` and to runs that bind:

| Observation | Coordinator action |
| :- | :- |
| no run yet, and less than `dispatchGraceMinutes` (default 15) since the last send | wait |
| no run, grace passed, `sends < 2` | **resend the same `N`** (`sends += 1`). Safe because of principle 4: if the first send arrives late after all, both runs pass H4, only one can push, and the other fails its lease. |
| no run, grace passed, `sends == 2` | mark `cancelled`. Next action: a new dispatch `k+1` within `maxDispatchAttempts`, or blocked "executor not seen". |
| at least one run queued or in progress, less than `executorTimeoutMinutes` (default 60) | `state = bound`; wait |
| a run still unfinished after `executorTimeoutMinutes` | cancel each such run (`POST /actions/runs/{id}/cancel`), wait until all are `completed`, then treat as below |
| all runs `completed` | Re-read the branch head first. If the branch **moved** to a commit whose parent is `baseSha` and whose trailer is `N`, the dispatch is `published`: accept that commit (whichever run produced it) and note any losing runs. Otherwise apply the latest bound run's conclusion: `succeeded` (check-only), or `failed` / `cancelled` → new dispatch `k+1` within `maxDispatchAttempts`. |

**Superseding** (`state = superseded`) only ever happens when every run of the old dispatch is `completed` and the branch has been re-read. After a new dispatch is saved, a late run of the old nonce fails rule 1 at H4 and again at publish. Because of principle 4, even a run that passed both checks just before the supersede can only publish if the branch is still at the same base, so the base still gets at most one commit. Such a commit carries a recorded nonce of this goal with the matching parent, and is accepted under the "branch moved" rule. The replacement then fails its lease and is recorded as `failed`, with no effect.

### 5.2 Handoff table

Each row gives the input, output, owner and exact commit, and what happens after a crash or a duplicate wake.

**H1. Person → coordinator: create the goal**

- **Input:** request text, one to three `vitest:` criteria, `E`, and the issue number. The issue must carry the `auto-goal` label, applied by the trusted login.
- **Output:** record revision 1 on the issue, through `cli.ts start`.
- **Owner:** Aaron (person).
- **Commit:** `E` recorded. `B` is not chosen yet.
- **Crash:** if the issue was created but no record was saved, rerun `start --issue <n>`.
- **Duplicate:** a second `start` finds an existing record and refuses, because `IssueCommentStore` checks revisions.

**H2. Wake → coordinator session**

- **Input:** a wake ticket from `wake.mjs` (`goal-submitted`, `checks` or `codex`), plus the guard.
- **Output:** one runner session holding run `n`.
- **Owner:** wake bridge.
- **Commit:** the ticket records the head SHA it saw.
- **Crash:** the existing watchdog retries a stale pending ticket (bounded).
- **Duplicate:** the existing ticket check and `acquireRun` claim branches allow exactly one session to own run `n`; others stop having written nothing.

**H3. Coordinator → executor: dispatch**

- **Input:** `decide()` returns `reproduce`, `implement`, `fix-ci`, `fix-findings`, or a recovery dispatch from §5.1.
- **Output:** the coordinator saves the dispatch, `state = pending`, `sends = 0`, **first** (under `fence`). Only then does it call `POST /actions/workflows/auto-goal-actions.yml/dispatches` with `ref=main` and inputs `{goal, issue, nonce}`, and save `sends = 1`.
- **Owner:** coordinator.
- **Commit:** `baseSha` is `B`, the current `main`, for reproduce; otherwise the current head (`T` or `Fk`).
- **Crash:** the dispatch is on the goal, not on the session's run, so it survives the session being abandoned. The next session handles it by §5.1: wait, resend the same `N`, or replace.
- **Duplicate:** a second session is refused by the claim. Two executor runs with the same `N` (a resend, or a send whose response was lost) both pass H4, but only one can push (H6).

**H4. Executor `read-issue` → executor jobs: load and validate the dispatch**

- **Input:** dispatch inputs; the record read from the issue with trusted `store.ts` parsing (`parseRecordComment`, trusted login only); for `fix`, finding texts fetched by ID from GitHub.
- **Output:** a validated work packet as job outputs: phase, `baseSha`, `targetSha`, branch, criteria check IDs, request text, and finding texts as data.
- **Owner:** executor (trusted code at `E`).
- **Commit:** it applies the executor-validity rules 1–4 of §5.1.
- **Crash:** read-only, so a re-run is safe.
- **Duplicate:** a superseded, cancelled, failed or unknown nonce is **refused before Claude runs**. A delayed run of the current nonce proceeds.

**H5. Executor `implement` → `publish`: proposed patch**

- **Input:** the work packet; a checkout of exactly `baseSha`; the restricted CLI (#188 flags).
- **Output:** `proposal.patch` plus its validated JSON (artifact).
- **Owner:** executor.
- **Commit:** `baseSha` checked out by SHA, with `persist-credentials: false`.
- **Phase rules** in the validator, which needs a new `--phase` argument:
  - **reproduce:** only the criteria's check files may change;
  - **implement and fix:** the criteria's check files must **not** change;
  - **all phases:** the existing scope, per-section, mode and UTF-8 rules apply.
- **Crash:** the run fails and nothing is pushed. The coordinator follows §5.1: all runs completed, branch unchanged, so the run's conclusion `failed` leads to a new dispatch within `maxDispatchAttempts`, then blocked.
- **Duplicate:** each run has its own artifact (`if-no-files-found: error`); see H6.

**H6. Executor `publish` → branch, then PR (one job)**

- **Input:** the artifact; a checkout of `baseSha`.
- **Order inside the job:**
  1. Re-check executor validity (§5.1 rules 1–3).
  2. Commit `X`: parent `baseSha`, with both trailers.
  3. `git push --force-with-lease=refs/heads/<branch>:<baseSha, or empty for reproduce> origin X:refs/heads/<branch>`.
  4. Adopt the open draft PR from `goal.branch` (same rule as `runner.ts` `openPullsFor`), or create one.
  5. Output `X` and `P`.

  The job concludes `success` **only** after step 4, so a successful publish always means a PR exists.
- **Owner:** executor. The coordinator never creates or edits a PR.
- **Commit:** `X`, which follows `baseSha` and nothing else.
- **H6a, crash before step 3:** nothing changed. Handled as H5's crash.
- **H6b, crash after step 3, before step 4 completes:** the run concludes `failure` or `cancelled`, and the branch head is `X`, parent `baseSha`, trailer `N`. By §5.1 the coordinator records the dispatch as `published` with result `X`, then saves **one** recovery dispatch: `phase=finish-publish`, `baseSha` = the original base, `targetSha=X`.

  The executor's `finish-publish` run is trusted code only; it starts no Claude step. It:
  1. passes H4 (the branch head must be `X`);
  2. recomputes `git diff baseSha X` and re-runs the validator with the original phase's rules;
  3. confirms `X`'s parent and trailers;
  4. adopts or creates the draft PR;
  5. runs the H7 checks on `X`.

  **If `finish-publish` fails, the pilot blocks** with "publish could not be completed for X". There is no second recovery attempt.
- **Duplicate:** a second run with the same `N` fails the lease at step 3 and pushes nothing. A run whose base is stale fails rule 2 or the lease.

**H7. Executor `publish` → `check`: exact commit**

- **Input:** `X`.
- **Output:** one matrix job per criterion and guard, named `check <phase> <id> <X>`, which:
  - checks out `X` by SHA, with no credentials;
  - verifies `HEAD == X` (existing step);
  - takes the exact argv from trusted `checks.ts` `stepsFor()`, loaded from a separate checkout of `E`, and runs it without a shell.

  A `check`-phase dispatch runs only this step, for `targetSha`.
- **Owner:** executor.
- **Commit:** `X`.
- **Crash:** a check job that dies has no conclusion, or `cancelled`. The coordinator saves a `phase=check` dispatch for `targetSha=X` (§5.1), at most once per commit, then blocks.
- **Duplicate:** results are keyed by `(runId, jobId)` in the record, so the same job is never counted twice. Two bound results for the same check and commit must agree, or the goal blocks with "conflicting results".

**H8. Executor `check` → `record-check`: status on the exact commit**

- **Input:** check job results; the PR re-read (the `f68add4` logic, extended per criterion).
- **Output:** `auto-goal/<phase>/<id>` commit statuses on `X`, for people reading the PR.
- **Owner:** executor.
- **Commit:** `X`, written only while the PR head is `X`. The existing refusal on a moved, closed or wrong PR stays.
- **Note:** statuses are **informational** in this contract. The coordinator's evidence is the bound Actions jobs (§3), because statuses can be written by any workflow with `statuses: write`.
- **Crash or duplicate:** commit statuses are per SHA and idempotent; a later push never inherits them.

**H9. Executor → coordinator: results**

- **Input:** a `workflow_run.completed` event for the executor workflow. The wake bridge maps it to the goal by `N` in the run name, because a dispatch run's `pull_requests` is empty. The run was dispatched with the coordinator's own credential, not `GITHUB_TOKEN`, so its completion should emit the event; verifying this is listed in §7.
- **Output:** a coordinator session (H2). Its `syncGoal` applies §5.1 to the current dispatch, ingests bound jobs as `goal.checks` entries `{criterionId, phase, sha: X, exitCode, source}`, and updates `goal.head` from the PR.
- **Owner:** coordinator.
- **Commit:** `X` must equal the PR head and carry a trailer naming a dispatch of this goal whose `baseSha` is `X`'s parent. Otherwise the goal blocks with "foreign push".
- **Crash:** ingestion is idempotent by `source`, and §5.1 is a pure function of the record plus live Actions and branch state, so re-sync is safe.
- **Duplicate:** a duplicate wake is refused by the claim; a duplicate event is absorbed by ticket dedupe (existing). The watchdog covers a missed event.

**H10. Coordinator → Codex: request review**

- **Input:** S6 on head `F`.
- **Output:** round k saved, then an `@codex review` comment tagged `round k … for <F>`.
- **Owner:** coordinator.
- **Commit:** `F`, the PR head re-read immediately before posting.
- **Crash:** the existing round-saved-before-post logic, plus adopting an already-posted tagged comment.
- **Duplicate:** the existing tag dedupe and the `outstanding` count of unanswered requests.

**H11. Codex → coordinator: verdict**

- **Input:** Codex comments and reviews.
- **Output:** a round verdict and findings, through the existing `codexVerdicts` and `verdictFor`.
- **Owner:** coordinator.
- **Commit:** the verdict counts only if its "Reviewed commit" prefix matches `F` (existing).
- **Crash and duplicate:** existing.

**H12. Coordinator → record: complete or blocked**

- **Input:** `decide()` returns `complete` (S9) or `blocked`.
- **Output:** `goal.outcome` with evidence: head `F`, PR `P`, bound run and job IDs for every after-fix result on `F`, the Codex round URL.
- **Owner:** coordinator.
- **Commit:** `F`, re-read from the PR in the same sync.
- **Crash:** if the outcome was not saved, the next run recomputes the same decision.
- **Duplicate:** `outcome` is final; `begin` returns `done` (existing).

**The draft PR is never marked ready and never merged by either side.**

## 6. Runner functions: keep, change, or retire (Phase 2, full design)

The exact changes for the first pilot are listed in §1A.4. This section covers the full design.

**Keep unchanged**

- `claim.ts`: `acquireRun`, `fence`, `parseClaim`, `claimRef`, `claimMessage`.
- `store.ts`: `IssueCommentStore`, `renderRecordComment`, `parseRecordComment`, `FileStore`. The executor reuses `parseRecordComment` read-only.
- `codex.ts`: `codexVerdicts`, `verdictFor`, `parseFinding`.
- `checks.ts`: `stepsFor`, `describeCheck`, `checkFile`. The executor `check` job uses them as the trusted argv source.
- `github.ts`: `pullMismatch`, and the existing `GitHub` methods `pull`, `checkRuns`, `issueComments`, `reviews`, `reviewComments`, `createComment`, `whoami`. `openPullsFor` and `createDraftPull` are no longer called by the coordinator.
- `decide.ts`: `ciState()`, fed from the executor's guard jobs only; repository check runs are excluded (§3.1).
- `record.ts`: `addEvent`, `GoalError`.
- `runner.ts`:
  - `begin()`'s `screen()`, claim and abandon logic. Abandoning a run no longer affects dispatches.
  - `advance()`'s request-review block and its complete, blocked and run-close tail;
  - `noteNext()`, `gitClaims()`.
- `wake.mjs`: `parseTicket`, `ticketBody`, `verifyTicket`, `retryTicket`, `decideRecovery`, `codexAnswers`, `answerFor`, the watchdog and the guard.

**Change**

- **`record.ts`:**
  - `RECORD_VERSION` 1 → 2;
  - `GoalRecord.executorSha`;
  - `GoalRecord.dispatches[]` (§5.1), at goal level, not on `RunEntry`;
  - `CheckRun.source {runId, jobId}`;
  - `Caps.maxDispatchAttempts`, `dispatchGraceMinutes`, `executorTimeoutMinutes`;
  - `createGoal` and `validateGoal`: accept and verify these, including "at most one live dispatch"; criteria limited to the `vitest:` checks in §3.
- **`decide.ts`:**
  - `decide()`: the new order (§4); `wait-executor`; the §5.1 table as a pure function of the record plus observed runs and branch head; before and after rules evaluated from executor-sourced checks; S3x, S6x and recovery dispatches; the dispatch-attempt cap.
  - `criteriaResults()`: read executor-sourced checks only.
- **`sync.ts`:**
  - `syncGoal()`: the PR is expected from S2 onward. It observes the current dispatch's runs and the branch head, ingests bound jobs, and verifies that each head carries a trailer of a recorded dispatch with the matching parent.
  - New helper: `bindExecutorRun(run, goal)`, the §2 rules.
  - `localGit` stays; `fetch` is unused.
- **`github.ts`:** new `GitHub` methods, with `ghCli` implementations:
  - `dispatchWorkflow(repo, file, ref, inputs)`;
  - `workflowRuns(repo, file, createdSince)`;
  - `run(repo, id)`;
  - `runJobs(repo, id)`;
  - `cancelRun(repo, id)`;
  - `compareFiles(repo, base, head)` returning `{filename, status, sha}`;
  - `branchHead(repo, branch)`;
  - `commit(repo, sha)` for the parent and trailers.
- **`runner.ts`:**
  - `advance()`: in executor mode the code-action block does no `git.push`, no `deps.check`, and runs no local `verify`. It saves a dispatch, then calls `dispatchWorkflow` (H3). It also performs §5.1 resends and cancels. The `open-pr` branch is not used in executor mode.
  - `begin()`: drop `ensureBranch`, because the executor creates the branch.
  - `workOrder()`: no `todo` asks the session to edit or commit anything.
  - `RunnerDeps`: `git.push`, `git.ensureBranch` and `check` are no longer used in executor mode.
  - `runnerPrompt()`: remove step 3 (the session makes no code change).
- **`wake.mjs`:**
  - `normalizeEvent()`: accept `workflow_run` for the executor workflow and map it by nonce.
  - `decideWake()`: handle a `checks` wake with no PR number.
  - `auto-goal-wake.yml`: add the executor workflow to `workflow_run.workflows`.
- **`cli.ts`:** `start` takes `--executor-sha` and check IDs, and derives the branch as `claude/auto-goal-<id>`.

**Retire in executor mode** (kept for interactive goals):

- `checks.ts` `runCheck`, as called by the coordinator;
- `runner.ts` local reproduce and verify loops;
- the session-commit path;
- the coordinator's `open-pr` step.

**Executor changes required** (outside the runner, for the same review):

- **Dispatch interface:** `workflow_dispatch` inputs `{goal, issue, nonce}`, with `run-name` containing the nonce.
- **`read-issue`:** validates the dispatch against the record (H4).
- **`implement`:** checks out `baseSha` instead of `github.sha`.
- **Validator:** `--phase` rules.
- **`publish`:**
  - re-checks validity, then pushes to `goal.branch` with compare-and-swap and both trailers;
  - adopts or creates the PR inside the same job (H6);
  - `phase=check` mode, which skips implement and publish;
  - `phase=finish-publish` mode: trusted code only, re-validates the diff, then adopts or creates the PR and runs checks.
- **`check`:** a per-criterion matrix using `stepsFor` from `E`, with exact job names.
- **`record-check`:** per-criterion statuses, and failure states for the before-fix phase.

## 7. Threat model and limits

- **Repository writers are trusted.** This contract defends against crashes, duplicate wakes, delayed or duplicated dispatches, stale state and untrusted text, not against a malicious maintainer, who can push or dispatch anything.
- **Proposed code runs only in executor `check` jobs.** It can still affect its own test outcome. An after-fix pass means "these trusted commands exited 0 on `F`". Codex review and human review of the draft remain necessary.
- **The routine-session finding on #185 remains open.** A routine session cannot technically stop review text from steering it. This design reduces the risk, because the coordinator session makes no code change and its work orders carry no review text. It does not remove the risk: the session still reads tool output. The pilot needs a decision from Aaron on whether that residual risk is acceptable.
- **Two credentials are needed and neither exists:**
  - a disposable Claude credential for the executor's implement job;
  - the coordinator session's GitHub access, able to dispatch and cancel workflows, comment, and read Actions.

  Creating either is a decision for Aaron (`awaiting-aaron`).
- **GitHub behaviour to verify on a disposable repository before any pilot:**
  - workflow `run-name` with inputs;
  - `jobs.<id>.name` using `needs` outputs;
  - `--force-with-lease` to a `claude/` branch with an empty expected value (branch must not exist);
  - `workflow_run` events for runs dispatched by a user credential;
  - the `GITHUB_TOKEN` event rule in §3.1;
  - how quickly a dispatched run appears in the runs list (this sets `dispatchGraceMinutes`);
  - run cancellation reaching `completed`;
  - Actions API fields (`path`, `head_sha`, run name).

  None of this has been run.
- **This is a design, not an implementation.** No code, workflow or test was changed for it, and it has not been executed even offline.

## 8. Before any implementation

1. Independent review of this contract, starting with the version 1 path (§1A), including whether the coordinator/executor split is worth the changes in §6 compared with dropping one design.
2. Aaron's decisions: residual routine-session risk; the disposable credentials; one pilot goal and its one to three existing `vitest:` criteria.
3. Implement the §1A.4 changes on separate branches, with the version 1 offline tests listed there. Then run the GitHub checks of §7 on the disposable repository. Phase 2 (§5.1, §6, §9) follows only after version 1 has completed a goal.
4. A separate explicit approval to install, enable and dispatch. Nothing in this contract grants it.

## 9. Crash traces: one per recovery path (Phase 2)

In version 1, each trace below ends at the blocker of §1A.3 for its first failure, instead of recovering:

- **C1, C2 (variant) and C3:** "missing executor run", "duplicate executor runs" or "did not finish";
- **C4, C5 and C6:** "publish failed";
- **C7:** "incomplete check";
- **C8, C9 and C10:** unchanged, because those are existing runner behaviour;
- **C11:** "foreign head".

The traces use placeholder commits: `B = b0…`, `T = 7a…`, `F1 = f1…`, `F2 = f2…`. Times are minutes after the dispatch is saved. Unless a trace says so, the coordinator sessions are separate wakes, each owning its run through the claim.

**C1. Coordinator crashes between saving a dispatch and sending it** (§5.1 resend)

1. Run 4 saves `d2 = {nonce pilot-1.d2, phase implement, baseSha T, pending, sends 0}`, then the session dies before calling the dispatch API.
2. At 16 min, the watchdog wakes run 5. `begin` closes run 4 as abandoned; `d2` is unaffected. Sync finds no run named `pilot-1.d2`, the grace has passed and `sends == 0 < 2`, so run 5 sends `pilot-1.d2` and saves `sends = 1`.
3. The executor run passes H4: `d2` is current, and the branch head equals `T`. It publishes `F1` (parent `T`, trailer `pilot-1.d2`).
4. The next sync marks `d2` as `published`.

**C2. A delayed executor run starts late and remains valid** (§5.1 wait)

1. Run 4 sends `d2` (`sends = 1`). GitHub queues the run but it does not start for 25 min.
2. At 16 min, run 5 lists the runs, sees `pilot-1.d2` queued, sets `d2` to `bound`, and waits. It does not resend and does not replace.
3. At 25 min the run starts. H4 accepts it: `d2` is still current and the branch is still at `T`. It publishes `F1`.

Variant, if the queued run was not yet listed at 16 min:

1. Run 5 resends (`sends = 2`), so two runs named `pilot-1.d2` now exist.
2. Both pass H4. The first to push wins the lease and publishes `F1`. The second fails `--force-with-lease`, because the branch is no longer at `T`.
3. Sync sees all runs completed and the branch at `F1` (parent `T`, trailer `pilot-1.d2`). It accepts `F1`, marks `d2` as `published`, and records the losing run.

**C3. An executor run hangs and is replaced** (§5.1 cancel, then supersede)

1. `d2`'s only run is still `in_progress` at 61 min.
2. The coordinator cancels it and waits for `completed`, then re-reads the branch.
3. **Branch still at `T`:** mark `d2` as `cancelled`, save `d3 = {pilot-1.d3, implement, baseSha T}`, and send it. If a stray `pilot-1.d2` run appears later, H4 refuses it (`d2` is no longer current).
4. **Branch at `F1` with trailer `pilot-1.d2`** (the push landed just before cancellation): mark `d2` as `published` and continue from `F1` with no new dispatch. `F1`'s PR step did not finish, so continue with C5 below.

**C4. The implement job fails, or publish crashes before pushing** (H5 crash, H6a)

1. `d2`'s run concludes `failure`; the branch is still at `T`.
2. Sync marks `d2` as `failed`, and `decide` gives a new `implement` dispatch `d3` (attempt 2 of `maxDispatchAttempts = 2`).
3. If `d3` also fails, the goal blocks: "implement failed twice on T".

**C5. Publish crashes after pushing, before the PR exists** (H6b → `finish-publish`)

1. `d1` (reproduce from `B`) pushes `T`, then the job dies before creating the PR. The run concludes `failure`.
2. Sync sees the branch at `T`, parent `B`, trailer `pilot-1.d1`, and no PR. It marks `d1` as `published` with result `T`, then saves `d2 = {pilot-1.d2, finish-publish, baseSha B, targetSha T}` and sends it.
3. The executor's `finish-publish` run passes H4 (branch head `T` equals `targetSha`). It re-validates `git diff B T` under reproduce rules, confirms the parent and trailers, creates draft PR `P`, and runs the before-fix checks on `T`.
4. Sync ingests the results, and the goal reaches S3.

At no point does the coordinator create the PR.

**C6. The publish recovery itself fails** (H6b → blocked)

1. As C5, but the `finish-publish` run fails, for example because the diff no longer validates or GitHub refuses the PR.
2. Sync marks `d2` as `failed`. `decide` gives blocked: "publish could not be completed for `T`".
3. The branch keeps `T` with no PR, for a person to inspect. There is no second attempt in the pilot.

**C7. A check job dies** (H7 check-only dispatch)

1. `d3` published `F1` and the PR exists, but one matrix leg concluded `cancelled` (runner lost).
2. Sync marks `d3` as `published`, with no complete result set for `F1`. It saves `d4 = {pilot-1.d4, check, baseSha F1, targetSha F1}` and sends it.
3. The check-only run passes H4 (head `F1`), runs every check on `F1`, and sync ingests them.
4. If `d4`'s checks also fail to conclude, the goal blocks: "checks did not complete on `F1`".

**C8. A coordinator session crashes after a result arrives** (H9 re-sync)

1. Run 6 ingests `d3`'s after-fix results for `F1` and dies before saving.
2. Run 7 re-reads the record, which has no results for `F1`. It re-lists the same bound jobs, ingests them (the keys are `runId`/`jobId`, so there are no duplicates), saves, and proceeds to `request-review`.

**C9. Two wakes for the same event** (H2 duplicate)

1. A `workflow_run` event and the watchdog both wake sessions for `pilot-1`.
2. Only one creates claim run `n` through `acquireRun`. The other stops before writing (existing `claim.ts` behaviour).

**C10. Coordinator crashes between saving a review round and posting it** (H10, existing)

1. Run 8 saves round 1 for `F1` with `requestUrl = null`, then dies.
2. Run 9's `decide` returns `request-review` for the unconfirmed round. `advance` finds no tagged comment, posts it, and saves the URL.
3. If the comment had been posted, run 9 adopts it instead (existing tag dedupe).

**C11. A Codex fix publishes, then someone else pushes** (H9 foreign head)

1. `d5` (fix, base `F1`) publishes `F2`. A maintainer then pushes `F3` to `goal.branch`.
2. Sync sees PR head `F3`, whose trailer names no dispatch of `pilot-1` with parent `F2`. The goal blocks: "foreign push F3 on claude/auto-goal-pilot-1".
3. Any `auto-goal/check` status on `F2` stays on `F2`; `F3` has none.
