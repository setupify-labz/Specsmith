# Auto Goal pilot: coordinator ↔ executor handoff contract (design only)

**Status: design for review. Nothing here is implemented, enabled, or authorised to run.** No workflow is installed or enabled, no credential exists, and no goal has been started.

This contract connects two existing, disabled designs for **one** pilot goal:

- **Coordinator**: the Auto Goal runner at #185 head `4715d071368045943de912f796311d63d7730593` (stacked on #184 `83789855fd18a593eaa641b4c0c444cd5dd04f2b`). It owns the goal record, decides the next step, and asks Codex for review. It never edits, pushes, or runs proposed code.
- **Executor**: `docs/auto-goal-actions/auto-goal-actions.yml` at `f68add4463b0f317a54c247d51bc5c641b541a91`. It proposes edits with the restricted Claude CLI, publishes them to the goal branch and draft PR, runs the trusted checks on the exact commit, and records the result. It never decides what happens next and never writes the goal record.

This replaces the earlier finding that the designs "cannot connect" with the exact changes that would make them connect. It does not build a second runner: every decision stays in `decide.ts`, and every record write stays in `store.ts`.

## 1. Principles

1. **One writer per artifact.**
   - **Goal record** (issue comments): written by the coordinator only, through `IssueCommentStore` with its revision check.
   - **Goal branch and draft PR:** written by the executor only. The single exception is crash recovery H6b (§5).
   - **Codex request comments:** posted by the coordinator only.
2. **Every handoff names its exact commit.** No step acts on "the latest" anything. A handoff whose commit no longer matches is refused, not adapted.
3. **Save intent before acting, verify before believing.** The coordinator records a dispatch before it dispatches. It records a result only after binding it to a specific executor run, job, and commit through the GitHub Actions API.
4. **Untrusted text has one destination.** Issue text and Codex finding text reach only the restricted implementer (#188 flags), as data. The coordinator's work orders carry IDs, SHAs, and URLs, never review text. That is already true of `runner.ts` `workOrder()`.
5. **Fail closed.** Any mismatch, missing evidence, or exhausted cap gives `blocked` with the exact reason. Nothing is guessed.

## 2. Identifiers and pinned commits

| Name | Meaning | Fixed when | Stored in |
| :- | :- | :- | :- |
| `goal.id` | Goal ID, e.g. `pilot-1` | creation | record |
| `goal.branch` | `claude/auto-goal-<goal.id>`; the only branch the executor may write | creation | record (already `readonly branch`) |
| `goal.baseBranch` | `main` | creation | record |
| `E` (`goal.executorSha`, **new**) | The `main` commit whose `.github/workflows/auto-goal-actions.yml` is the reviewed executor | creation | record |
| `R` | The runner tooling commit (existing `toolingSha()`) | each coordinator run | run entry / prompt |
| `B` | The `main` commit that the reproduce patch applies to | reproduce dispatch | `run.dispatch.baseSha` |
| `T` | Reproduce commit: `B` plus test-only changes | executor publish | branch, PR head, record `checks[].sha` |
| `F1, F2, …` | Implement and fix commits; each parent is the previous head | executor publish | same |
| `N` (dispatch nonce) | `<goal.id>.r<run n>.a<attempt>`, e.g. `pilot-1.r3.a1` | before dispatch | `run.dispatch.nonce`; the executor's `run-name` |
| `P` | Draft PR number, from `goal.branch` to `main` | first publish | `goal.pr` |

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
- **Required checks are the executor's own.** `goal.requiredChecks` names only the executor jobs below. The repository's own CI does not run on a PR created with `GITHUB_TOKEN`, because GitHub starts no workflows for that token's events, so it cannot be required.

**Before-fix rule** (proves the test detects the defect) holds only when all four hold:

- for every criterion, the executor's `check` job ran on `T` and **failed with the check executed** (`runCheck` would report `executed: true`, exit ≠ 0);
- the files changed between `B` and `T` are a subset of the criteria's check files, checked with the coordinator's own compare call (`GET /compare/B...T`);
- `T`'s parent is `B`;
- the check jobs are bound to the reproduce dispatch `N`.

**After-fix rule** (proves the fix) holds only when all three hold:

- for every criterion and guard, the executor's `check` job ran on the current head `F` and **succeeded**;
- the criteria's check files at `F` are byte-identical to those at `T`, compared as blob SHAs through `GET /compare/T...F`, which must not list them;
- the check jobs are bound to the dispatch that produced `F`, or to a check-only dispatch for `F`.

**Job names carry the evidence.** Each executor check job is a matrix leg named exactly `check <phase> <criterion-or-guard-id> <sha>`; the coordinator reads `GET /actions/runs/{id}/jobs`. `jobs.<id>.name` may use `needs` and `matrix`, so the SHA comes from `needs.publish.outputs.proposal_sha`. The coordinator stores `{runId, jobId, conclusion}` in the new `CheckRun.source` field, which makes ingestion idempotent.

## 4. State map

States are predicates on the record. `decide()` stays the only function that computes the next action from them. "→ blocked" always records the exact reason in `goal.outcome` and closes the run (existing behaviour).

| # | State | Record predicate | Next action (`decide`) | Owner of the next step |
| :- | :- | :- | :- | :- |
| S0 | Created | no runs, no checks, `pr == null`, branch absent | `reproduce` | coordinator |
| S1 | Reproduce dispatched | open dispatch `phase=reproduce`, `baseSha=B` | `wait-executor` | executor |
| S2 | Reproduce published | branch = `T`, `pr = P` (draft), dispatch run bound | `wait-executor` (checks running) | executor |
| S3 | Reproduced | before-fix rule holds on `T` | `implement` | coordinator |
| S3x | Reproduce ineffective | a criterion **passed** on `T`, or `B…T` touched other files | `reproduce` again (new attempt) while `maxDispatchAttempts` remains; otherwise blocked | coordinator |
| S4 | Implement dispatched | open dispatch `phase=implement`, `baseSha = head = T` | `wait-executor` | executor |
| S5 | Implement published | head = `F` (parent `T`), dispatch run bound | `wait-executor` (checks running) | executor |
| S6 | Verified | after-fix rule holds on `F == head` | `request-review` | coordinator |
| S6x | After-fix failed | any criterion or guard failed on `F` | `fix-ci`, i.e. dispatch `phase=fix` with `baseSha=F`, within `maxFixAttempts`; otherwise blocked | coordinator |
| S7 | Review requested | round k: `requestedSha = F = head`, request comment confirmed | `wait-review` | Codex |
| S8a | Review clean | round k clean on `F`, no open material findings | `complete` (if S6 still holds on `F`) | coordinator |
| S8b | Findings | material findings open from round k | `fix-findings`, i.e. dispatch `phase=fix` with `baseSha=F` and finding IDs, within caps → back to S5 with new head `F'` | coordinator |
| S9 | **Complete** | S6 and S8a on the same head `F`; PR still an open draft from `goal.branch` at `F` | none (`done`) | — |
| SB | **Blocked** | any condition below | none (`done`) | — |

**Blocked conditions**, each with an exact reason:

- **Caps:** `maxRuns`, `maxHours`, `maxReviewRounds` or `maxFixAttempts` reached (existing), or the new `maxDispatchAttempts` per phase (default 2).
- **Executor and binding failures:**
  - an executor run ended `failure` or `cancelled` twice for the same phase;
  - an executor run fails the binding check (§2);
  - `E` changed.
- **PR and branch changes:**
  - a head appears that no bound dispatch produced (a foreign push);
  - the PR was closed or merged outside the goal (existing `syncGoal` handling);
  - the PR stopped being a draft, or no longer goes from `goal.branch` to `main` (existing `pullMismatch`).
- **Codex:** it replied `unavailable` (existing), or did not answer within `reviewTimeoutMinutes` (existing).
- **Executor timeout:** no executor run for a dispatch appeared within `dispatchGraceMinutes` (new, default 15) after the maximum attempts.

**Order change in `decide()`.** The runner's current order is: reproduce → implement → verify locally → open PR → review → CI. The contract's order is: reproduce (via executor, which opens the PR) → implement (via executor) → verify from executor evidence → review → complete. The "open-pr" step disappears from the normal path, because the PR exists from S2. "CI" means the executor guard jobs on the head.

## 5. Handoffs

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

- **Input:** `decide()` returns `reproduce`, `implement`, `fix-ci` or `fix-findings`. The coordinator saves `run.dispatch = {nonce N, phase, baseSha, executorSha E, findingIds?, dispatchedAt, attempt}` **first** (under `fence`). Only then does it call `POST /actions/workflows/auto-goal-actions.yml/dispatches` with `ref=main` and inputs `{goal, issue, run, nonce}`.
- **Output:** a dispatched executor run (fire-and-forget).
- **Owner:** coordinator.
- **Commit:** `baseSha` is `B`, the current `main`, for reproduce; otherwise the current head (`T` or `Fk`).
- **Crash:** if the session dies after saving but before or during dispatch, the next run (abandoning this one, existing logic) lists executor runs whose name contains `N`.
  - If one is found, adopt it.
  - If none is found after `dispatchGraceMinutes`, re-dispatch **the same** `N` (attempt unchanged). Re-dispatching is safe because H6 is compare-and-swap.
- **Duplicate:** a second session is refused by the claim. Two executor runs with the same `N` both start, but only one can publish (H6); the other fails at the lease.

**H4. Executor `read-issue` → executor jobs: load the dispatch**

- **Input:** dispatch inputs; the record read from the issue with trusted `store.ts` parsing (`parseRecordComment`, trusted login only); for fix-findings, finding texts fetched by ID from GitHub.
- **Output:** a validated work packet as job outputs: phase, `baseSha`, branch, criteria check IDs, request text, and finding texts as data.
- **Owner:** executor (trusted code at `E`).
- **Commit:** it requires the record's open run `n` to carry `dispatch.nonce == N` and its `baseSha` to equal the live branch head; for reproduce, the branch must be absent and `baseSha == B`.
- **Crash:** read-only, so a re-run is safe.
- **Duplicate:** a stale or duplicate dispatch, whose nonce is not the open run's, is **refused before Claude runs**.

**H5. Executor `implement` → `publish`: proposed patch**

- **Input:** the work packet; a checkout of exactly `baseSha`; the restricted CLI (#188 flags).
- **Output:** `proposal.patch` plus its validated JSON (artifact).
- **Owner:** executor.
- **Commit:** `baseSha` checked out by SHA, with `persist-credentials: false`.
- **Phase rules** in the validator, which needs a new `--phase` argument:
  - **reproduce:** only the criteria's check files may change;
  - **implement and fix:** the criteria's check files must **not** change;
  - **all phases:** the existing scope, per-section, mode and UTF-8 rules apply.
- **Crash:** the run fails and nothing is pushed. The coordinator sees the failed bound run and re-dispatches once (`maxDispatchAttempts`), then blocks.
- **Duplicate:** each run has its own artifact (`if-no-files-found: error`); see H6.

**H6. Executor `publish` → branch and PR**

- **Input:** the artifact; a checkout of `baseSha`.
- **Output:** a commit `X` whose parent is `baseSha`, with commit trailer `Auto-Goal-Dispatch: N`; `goal.branch` updated by compare-and-swap; draft PR `P`.
- **Owner:** executor.
- **Commit:** `git push --force-with-lease=refs/heads/<branch>:<baseSha, or empty for reproduce> origin X:refs/heads/<branch>`. The PR is created only if `openPullsFor(branch)` (same rule as `runner.ts`) finds none; otherwise the existing draft is adopted. The output is `X` and `P`.
- **Crash (H6a, before the push):** nothing changed; the coordinator retries as in H5.
- **Crash (H6b, after the push, before the PR):** the coordinator's sync sees branch head `X` with no PR. It verifies that `X`'s trailer is `N` and its parent is `baseSha`, that the publish job of the bound run succeeded, and that the PR is absent. It then adopts or creates the draft with the existing `open-pr` code (`openPullsFor` / `createDraftPull`), which is the single exception to "executor owns the PR". Finally it dispatches `phase=check` for `X`.
- **Duplicate:** a second run with the same `baseSha` fails the lease and pushes nothing. A run whose `baseSha` is stale fails the lease.

**H7. Executor `publish` → `check`: exact commit**

- **Input:** `X`.
- **Output:** one matrix job per criterion and guard, named `check <phase> <id> <X>`, which:
  - checks out `X` by SHA, with no credentials;
  - verifies `HEAD == X` (existing step);
  - takes the exact argv from trusted `checks.ts` `stepsFor()`, loaded from a separate checkout of `E`, and runs it without a shell.
- **Owner:** executor.
- **Commit:** `X`.
- **Crash:** a job that dies has no conclusion, or `cancelled`. The coordinator treats it as "no evidence" and dispatches `phase=check` for the same `X` once, then blocks.
- **Duplicate:** results are keyed by `(runId, jobId)` in the record, so the same job is never counted twice. Two valid runs for the same `X` must agree, or the goal blocks with "conflicting results".

**H8. Executor `check` → `record-check`: status on the exact commit**

- **Input:** check job results; the PR re-read (the `f68add4` logic, extended per criterion).
- **Output:** `auto-goal/<phase>/<id>` commit statuses on `X`, for people reading the PR.
- **Owner:** executor.
- **Commit:** `X`, written only while the PR head is `X`. The existing refusal on a moved, closed or wrong PR stays.
- **Note:** statuses are **informational** in this contract. The coordinator's evidence is the bound Actions jobs (§3), because statuses can be written by any workflow with `statuses: write`.
- **Crash or duplicate:** commit statuses are per SHA and idempotent; a later push never inherits them.

**H9. Executor → coordinator: results**

- **Input:** a `workflow_run.completed` event for the executor workflow. The wake bridge maps it to the goal by `N` in the run name, because a dispatch run's `pull_requests` is empty.
- **Output:** a coordinator session (H2). Its `syncGoal` ingests the bound jobs as `goal.checks` entries `{criterionId, phase, sha: X, exitCode, source}` and updates `goal.head` from the PR.
- **Owner:** coordinator.
- **Commit:** `X` must equal the PR head and be a commit produced by a bound dispatch. Otherwise the goal blocks with "foreign push".
- **Crash:** ingestion is idempotent by `source`, so re-sync is safe.
- **Duplicate:** a duplicate wake is refused by the claim; a duplicate event is absorbed by ticket dedupe (existing).

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

## 6. Runner functions: keep, change, or retire

**Keep unchanged**

- `claim.ts`: `acquireRun`, `fence`, `parseClaim`, `claimRef`, `claimMessage`.
- `store.ts`: `IssueCommentStore`, `renderRecordComment`, `parseRecordComment`, `FileStore`. The executor reuses `parseRecordComment` read-only.
- `codex.ts`: `codexVerdicts`, `verdictFor`, `parseFinding`.
- `checks.ts`: `stepsFor`, `describeCheck`, `checkFile`. The executor `check` job uses them as the trusted argv source.
- `github.ts`: `pullMismatch`, and the existing `GitHub` methods `pull`, `issueComments`, `reviews`, `reviewComments`, `createComment`, `openPullsFor`, `createDraftPull`, `whoami`.
- `record.ts`: `addEvent`, `GoalError`.
- `runner.ts`:
  - `begin()`'s `screen()`, claim and abandon logic;
  - `advance()`'s request-review block and its complete, blocked and run-close tail;
  - `noteNext()`, `gitClaims()`.
- `wake.mjs`: `parseTicket`, `ticketBody`, `verifyTicket`, `retryTicket`, `decideRecovery`, `codexAnswers`, `answerFor`, the watchdog and the guard.

**Change**

- **`record.ts`:**
  - `RECORD_VERSION` 1 → 2;
  - `GoalRecord.executorSha`;
  - `RunEntry.dispatch {nonce, phase, baseSha, executorSha, findingIds?, dispatchedAt, attempt, runId|null}`;
  - `CheckRun.source {runId, jobId}`;
  - `Caps.maxDispatchAttempts`, `Caps.dispatchGraceMinutes`;
  - `createGoal` and `validateGoal`: accept and verify these; criteria limited to the `vitest:` checks in §3.
- **`decide.ts`:**
  - `decide()`: the new order (§4); `wait-executor`; before and after rules evaluated from executor-sourced checks only; S3x and S6x handling; the dispatch-attempt cap.
  - `criteriaResults()` and `ciState()`: read guard and criterion results from `goal.checks` with `source`, not from `goal.ci` check runs.
- **`sync.ts`:**
  - `syncGoal()`: the PR is expected from S2 onward. It ingests bound executor jobs and verifies that each head was produced by a bound dispatch. The `checkRuns` read becomes optional and informational.
  - New helper: `bindExecutorRun(run, goal)`, the §2 rules.
  - `localGit` stays; `fetch` is unused.
- **`github.ts`:** new `GitHub` methods, with `ghCli` implementations:
  - `dispatchWorkflow(repo, file, ref, inputs)`;
  - `workflowRuns(repo, file, createdSince)`;
  - `run(repo, id)`;
  - `runJobs(repo, id)`;
  - `compareFiles(repo, base, head)` returning `{filename, status, sha}`;
  - `branchHead(repo, branch)`;
  - `commit(repo, sha)` for the parent and trailer.
- **`runner.ts`:**
  - `advance()`: in executor mode the code-action block does no `git.push`, no `deps.check`, and runs no local `verify`. It saves `run.dispatch`, then calls `dispatchWorkflow` (H3). The `open-pr` branch is used only for crash recovery H6b.
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
- the session-commit path.

**Executor changes required** (outside the runner, for the same review):

- **Dispatch interface:** `workflow_dispatch` inputs `{goal, issue, run, nonce}`, with `run-name` containing the nonce.
- **`read-issue`:** reads and verifies the record (H4).
- **`implement`:** checks out `baseSha` instead of `github.sha`.
- **Validator:** `--phase` rules.
- **`publish`:** compare-and-swap push to `goal.branch`, the commit trailer, PR adoption, and a `phase=check` mode that skips implement and publish.
- **`check`:** a per-criterion matrix using `stepsFor` from `E`, with exact job names.
- **`record-check`:** per-criterion statuses, and failure states for the before-fix phase.

## 7. Threat model and limits

- **Repository writers are trusted.** This contract defends against crashes, duplicate wakes, stale state and untrusted text, not against a malicious maintainer, who can push or dispatch anything.
- **Proposed code runs only in executor `check` jobs.** It can still affect its own test outcome. An after-fix pass means "these trusted commands exited 0 on `F`". Codex review and human review of the draft remain necessary.
- **The routine-session finding on #185 remains open.** A routine session cannot technically stop review text from steering it. This design reduces the risk, because the coordinator session makes no code change and its work orders carry no review text. It does not remove the risk: the session still reads tool output. The pilot needs a decision from Aaron on whether that residual risk is acceptable.
- **Two credentials are needed and neither exists:**
  - a disposable Claude credential for the executor's implement job;
  - the coordinator session's GitHub access, able to dispatch workflows, comment, and read Actions.

  Creating either is a decision for Aaron (`awaiting-aaron`).
- **GitHub behaviour to verify on a disposable repository before any pilot:**
  - workflow `run-name` with inputs;
  - `jobs.<id>.name` using `needs` outputs;
  - `--force-with-lease` against a protected-branch-free `claude/` branch;
  - `workflow_run` events for dispatch runs;
  - Actions API fields (`path`, `head_sha`, run name).

  None of this has been run.
- **This is a design, not an implementation.** No code, workflow or test was changed for it, and it has not been executed even offline.

## 8. Before any implementation

1. Independent review of this contract, including whether the coordinator/executor split is worth the changes in §6 compared with dropping one design.
2. Aaron's decisions: residual routine-session risk; the disposable credentials; one pilot goal and its one to three existing `vitest:` criteria.
3. Implement the §6 changes on separate branches, with offline tests using a fake GitHub API and a mock Claude response for every handoff and crash case in §5. Then run the checks against GitHub on the disposable repository.
4. A separate explicit approval to install, enable and dispatch. Nothing in this contract grants it.
