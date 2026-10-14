# Auto Goal

One instruction in ("fix this site bug"), then one of two outcomes: a verified fix, or a recorded blocker with the exact reason.

## What it reuses

Nothing here is a second review system. The loop is built from pieces that already run on this repository:

| Role | Existing piece |
| --- | --- |
| Implementer | The Claude Code session that was given the instruction |
| Reviewer | The Codex GitHub connector (`@codex review`, posts reviews as `chatgpt-codex-connector[bot]`) |
| CI | `verify-pr.yml` ("Tests, typecheck and production build") and the Cloudflare Workers build check |
| Wake-ups | The session's PR subscription (Codex reviews, CI results and comments wake it) plus a one-hour check-in |

This directory adds only what was missing:
- a durable record of the goal;
- a deterministic decision about the next step;
- a reader that turns Codex's posted findings into open items in that record.

## The record

It lives on GitHub as an append-only log of comments on the goal's issue.
- Each save posts the next revision; no comment is ever edited.
- It survives the container.
- It needs no branch, so saving it triggers no CI or preview build.

A copy of the latest revision is mirrored to `.auto-goal/<id>.json`, which is git-ignored.

The record holds:
- the original request, verbatim;
- the acceptance criteria, each with the command that checks it;
- the current step;
- the commits;
- every check result, tied to the commit it ran on;
- every Codex review round and its findings;
- the fix count, caps and final outcome.

Every save carries the revision it was based on. A stale save is refused, never merged over.

GitHub offers no compare-and-swap for comments, and this session cannot write git refs, so two sessions saving from the same revision at the same moment cannot be prevented. Append-only makes that visible instead of lossy:
- both copies stay on the issue;
- the writer that finds a rival comment fails;
- every later load refuses the fork until `resolve-fork --keep <comment id>` records which copy to continue from.

Only comments posted by the orchestrator's own GitHub login count as records. Anyone else who can comment on the issue cannot inject a revision. The request, acceptance criteria, repo and branch are pinned to revision 1: a later revision that changes them is refused, so the commands `check` runs cannot be altered after the goal starts.

A review request is saved as an in-flight round before Codex is asked. A session that stops in between adopts the request it already posted instead of asking twice.

## The decision

`decide.ts` derives the next action from the record alone, so a restarted session resumes from facts. The actions run in this order:

1. **reproduce.** Each acceptance check must have failed once, on a commit.
2. **implement.**
3. **fix-findings** or **fix-ci.** Open material Codex findings (P0–P2 or unbadged), or red CI on the head, go back to implementation.
4. **verify.** Every check passes on the exact head.
5. **open-pr.**
6. **request-review**, then **wait-review.** Codex must review the exact head. A new commit means a new round.
7. **wait-ci**, then **complete.**

The goal is complete only when all of the following hold:
- every acceptance check passes on the final commit;
- the required CI checks are green on that commit;
- Codex's latest review of that commit found no major issues;
- every material finding is fixed (by a later commit) or dismissed with a recorded reason.

The goal is **blocked**, with the exact reason, when any of these happens:
- the review cap is reached (3 rounds);
- the fix cap is reached (3 commits);
- Codex does not answer within 90 minutes;
- Codex replies without reviewing (its words are quoted);
- the PR is closed;
- 24 hours pass.

No path merges, schedules, publishes or calls a paid API, and a test enforces that.

## Running a goal

From the goal branch's checkout:

```sh
CLI="pnpm --dir artifacts/SpecSmith exec tsx scripts/auto-goal/cli.ts"
$CLI start --goal <id> --request-file request.txt --criteria-file criteria.json \
  --branch <branch> --required-check "Tests, typecheck and production build" --create-issue --title "<bug>"
$CLI check --goal <id> --criterion <cid> --phase before   # on the commit that adds the failing check
$CLI check --goal <id> --criterion <cid> --phase after    # on the fix
$CLI pr --goal <id> --number <n>
$CLI request-review --goal <id>
$CLI resume --goal <id> --issue <n>                       # after every PR event or check-in: sync, then the next action
$CLI fixed --goal <id> --finding <id> --commit <sha>      # after pushing a fix for a finding
$CLI finalize --goal <id>                                 # refuses unless decide() says complete
```

`criteria.json` is a list of `{ "id", "text", "command", "kind": "unit" | "browser" | "build" }`.

## Limits

- **The implementer is a Claude Code session.** If no session is subscribed to the PR, nothing advances. The record still says exactly where the goal stands, and `resume` picks it up.
- **Codex's formats come from what it posted on #180 and #182.** Any connector comment that is not a recognised verdict is treated as "unavailable" and quoted, never guessed.

## The unattended runner (`runner.ts`, `checks.ts`)

The runner is the half of a run that needs no judgement. A fresh Claude Code session uses it for one turn on a goal:

1. **`begin`** loads the record from the goal issue and syncs it with the PR, CI and Codex. It opens a run entry recording the session id and what started it, then prints a work order:
   - **reproduce:** write the failing checks;
   - **implement:** make them pass;
   - **fix-findings:** the open Codex findings, quoted as data;
   - **fix-ci:** the failing check runs.
2. The session makes and commits that change, and nothing else.
3. **`advance`** then:
   - pushes the commit;
   - runs the goal's trusted checks;
   - marks the findings that commit answers as fixed;
   - performs every mechanical step that follows (verify, open the draft PR, ask Codex);
   - stops when code is due again, Codex or CI must be waited for, or the goal completes or is blocked;
   - prints when the next run should start, with the exact prompt for it, rendered from fixed text.
4. **`note-next`** records which routine will start that next run.

### Trusted checks

The runner executes only checks from `checks.ts`:
- one Vitest file under `src/`;
- a production build followed by one script under `scripts/ui/`;
- `typecheck`;
- the full suite.

Each check is an argument vector run without a shell. Paths are validated against fixed patterns. A goal whose criteria carry free-form command text is refused. Nothing from an issue comment, PR comment or review finding is ever executed.

### Review text

A work order carries only finding identifiers, priorities, file locations and URLs, never the finding's text. The session reads each finding at its URL, as untrusted data.

That narrows prompt injection but cannot remove it: whatever applies a review finding has to read it. The enforcement boundary therefore has to be the executor:
- an allow-list of tools: git, pnpm and the runner, with no arbitrary shell or network access;
- no secrets beyond the push credential.

Whichever executor is enabled must be configured that way. The runner itself only ever executes registry checks.

### Limits

Every limit is recorded in the goal:

| Limit | Default |
| --- | --- |
| Runner sessions (`caps.maxRuns`) | 10 |
| Minutes per check (`caps.maxRunMinutes`) | 25 |
| Codex review rounds | 3 |
| Fix commits | 3 |
| Total time | 24 hours |
| Paid API spend | $0 |

A run that a session started but never finished is closed as abandoned by the next `begin`.

### What can start a run (audited 2026-10-13)

| Mechanism | Fresh session? | Can push, comment and re-arm without a person? |
| --- | --- | --- |
| `send_later` and self-bound routines | No: they wake the existing chat (a reminder) | n/a |
| Routine with `create_new_session_on_fire` | Yes (origin `scheduled_trigger`) | No. Created through the tool, it carries no repository (`config:no-git-repo`), and the three probe runs took no outward action. |
| `create_session` with the repository attached | Yes, but started by an active session | No. The session ran the read-only checks, then held its GitHub comment and routine creation for a person's confirmation (`need_input`). |
| Claude Code GitHub Action (headless, allow-listed tools) | Yes, on a GitHub event | Not installed: it needs a `CLAUDE_CODE_OAUTH_TOKEN` (or a paid `ANTHROPIC_API_KEY`) repository secret |

Until one of those last two paths is enabled, the runner can be exercised only by tests (`runner.test.ts`). It has not been demonstrated unattended.

## The event-driven wake (`wake.mjs`, `auto-goal-wake.yml`) — experimental, not yet proven

Handoffs are event-driven: nothing waits for a schedule between steps. The workflow `.github/workflows/auto-goal-wake.yml` runs when:
- Codex posts or completes a review on a PR (an issue comment by `chatgpt-codex-connector[bot]`);
- "Verify pull request" or a check suite completes;
- the trusted login labels a goal issue `auto-goal`.

`wake.mjs event` then fires the routine's API trigger only when all of these hold:
- the PR is an open, unmerged draft from a same-repo `claude/` branch;
- its title is `Auto Goal <id>: …` and its body says `Goal record: #<issue>.`;
- the goal's latest trusted record names this PR and this exact head commit, and has no outcome;
- the event is about that head commit (older commits are ignored);
- no run is open (younger than 40 minutes);
- for check events, every required check on that commit has finished;
- no wake ticket for this goal and commit is pending or fired since the last run started (within 45 minutes).

**Wake tickets.** Before calling the routine, the job posts a ticket comment on the goal's issue:
`<!-- specsmith-auto-goal-wake goal=… issue=… pr=… sha=… reason=… state=pending attempts=0 -->`. The routine is sent only `wake ticket=<comment id>`. After the call, the ticket is updated to `fired` or `failed`.

**Binding a run to its goal.** The routine's first step is `wake.mjs guard --ticket <id>`. It reads that comment back from GitHub and proceeds only if all of these hold:
- the comment was written by `github-actions[bot]`, in the ticket format, on the issue it names;
- the issue is open and labelled `auto-goal`;
- the trusted record for the ticket's goal is on that issue;
- no run has started since the ticket was written;
- the record still names the ticket's PR and commit;
- no run is open and the goal has no outcome.

It then prints that goal. Without a valid ticket it refuses, so a wake for one goal can never start another. The guard never chooses between active goals.

**Duplicates and retries.**
- A `pending` or `fired` ticket makes redelivered or duplicate events skip.
- A `failed` ticket does not, so a redelivered event tries again.
- The event step makes up to 2 calls. If they all fail, the job fails, and the workflow's `retry` job (`needs: wake`, only on failure) waits 2 minutes, then calls again for the newest unconsumed `failed` or `pending` ticket of each goal.
- Each ticket gets at most 4 calls. After that it stays `failed` with "giving up", and the failed workflow run is visible.
- One concurrency group serialises every wake and retry.

**Duplicate sessions: delivery is at-least-once, not exactly-once.** The routine's `/fire` endpoint takes no idempotency key. A call whose response is lost (a timeout or a 5xx after Anthropic accepted it) may still have started a session, and the retry starts another, both holding the same ticket. Nothing here can prevent that, so the design makes duplicates harmless instead.

**Run ownership is an atomic claim, taken before anything is saved** (`claim.ts`). Before it opens run *n*, `begin` must create the branch `claude/auto-goal-claims/<goal>/<n>-<attempt>` with a plain, never-forced push.
- GitHub's ref update is a compare-and-swap. Of two sessions creating the same ref, exactly one succeeds.
- This was checked against GitHub through the session proxy: five pairs of simultaneous pushes, one winner each, and the ref always held the winner's commit.
- The commit message names the owning session and the time. The commit points at the default branch's commit (no code) and carries `[skip ci]`; Cloudflare Workers Builds reported the probe as skipped.
- Every other session stops before writing. Only the owner of the open run writes the record, so duplicate sessions no longer fork it, and nobody needs `resolve-fork` for them.
- A claim push whose answer was lost still counts for the session that made it: it re-lists the claims and finds its own name.

| How the duplicates interleave | What happens |
| --- | --- |
| One session opens its run before the others reach the guard | The guard refuses the others: the ticket was already taken by run 1. |
| Every guard passes, then the `begin`s run one after another | The first claims and opens the run. The rest stop at "Run 1 by session … may still be working", having written nothing. |
| Two `begin`s read the same revision and push the same claim at once | One push wins. The other gets "session … claimed run 1 first" and stops. The record has one revision 2, and the goal continues normally. |
| The owner dies after claiming, before saving | Others stop while the claim is live: the run-time cap plus 15 minutes, the guard's window. After that the next session claims attempt 2 of the same run (at most 3 attempts). Two recoverers race for that attempt the same way, and one wins. |
| The owner dies with its run open | After the same window, the next session claims run *n*+1 and marks run *n* abandoned. |
| The old owner is alive but slow | It fences itself: before every push and save it stops if its run is older than the window minus 5 minutes, or if a later claim exists. So it stops writing before anyone may take over. |

`wake.duplicate.test.ts` runs these as processes: the real `wake.mjs` and `runner.ts`, real git against a local bare origin, and a git wrapper that can hold, lose the answer to, or kill the session after a claim push. `runner.test.ts` covers the same rules with a fake clock.

**What the claim does not cover:**
- Delivery is still at-least-once; the claim only makes duplicate sessions harmless.
- The takeover window is a lease, so it assumes session clocks agree to within the 5-minute margin.
- Sessions cannot delete branches through the proxy (refused for both `git push :ref` and the REST API). Claims stay until someone with delete rights removes them: at most `maxRuns × 3` per goal.
- A dead owner that leaves no event is handled by the recovery watchdog below, not by any event.
- Writes outside a run (`resolve-fork`, a person's edits) are not claimed, so a fork is still possible there.

**Recovery watchdog: the one scheduled part.** An owner can die after claiming a run and before producing any GitHub event: no push, no comment, nothing for the event triggers to see. The same workflow's `watchdog` job (`wake.mjs watchdog`) catches that.
- **Timing:** it runs on a cron every 15 minutes (`4,19,34,49 * * * *`). A dead owner's claim or run is stale after 40 minutes (25 + 15), so recovery starts 40–55 minutes after the death, plus GitHub's cron delay (not guaranteed, often a few minutes).
- **Cost:** $0, because GitHub-hosted runners are free on this public repository. Each pass is a few REST reads (well inside `GITHUB_TOKEN` rate limits), and it starts a routine session only for a proven stall. If the repository were made private, each pass would bill about one Actions minute: roughly 2,900 minutes a month at this interval.
- **GitHub caveats:** cron runs only from the default branch, and GitHub disables schedules in public repositories after 60 days without activity.

It wakes a goal only when all of these hold, read fresh from GitHub on every pass:
- the issue is open and labelled `auto-goal`;
- the trusted record exists, is not forked and has no outcome (so complete or blocked goals are never woken);
- every claim ref for the goal could be read, and none is ahead of the record;
- no run is open within its 40-minute window, and no claim for the next run is inside that window;
- nothing has been written recently: 15 minutes of quiet when a stale run or claim exists (its owner's lease has already run out), 40 minutes otherwise. Last activity is taken from GitHub's own comment times, so a missing field cannot make a goal look abandoned;
- no wake ticket is pending or fired without a run having started since.

**Goals parked at `wait-review` or `wait-ci`** are judged on GitHub's current state, read on that pass: the PR's head, Codex's comments and reviews on it, and the head's check runs.
- **A result is there but no run followed.** Codex answered after the round's request, or every required check completed (green or red), at least 10 minutes ago. That is a missed event, so the watchdog wakes once.
- **The result is genuinely pending.** It does nothing and posts nothing.
- **Codex passed `caps.reviewTimeoutMinutes` (90)** with no answer. It wakes once, and the runner records `blocked: Codex did not answer review round N within 90 min`. No new review is requested; `decide` never re-requests a round on the same head.
- **A required check passed `caps.ciTimeoutMinutes`** (new, default 60, counted from the push, which is when the review was requested) without finishing. It wakes once, and the runner records `blocked: Required check(s) … did not finish on <sha> within 60 min of the push`.
- **The PR's head moved, or GitHub could not be read.** It does nothing; the push's own event handles a moved head.

Only the runner can write the goal record, because only the trusted login's comments count, so the watchdog never records an outcome itself.
- Every wake it makes is a ticket comment on the goal issue, with a `Why:` line giving the reason.
- A stall it will not wake gets one `**Auto Goal … is stalled.**` notice on the issue: the recovery cap, three dead claims, or the routine unreachable after 4 calls.
- So no stall is visible only in the Action log.

**Bounds:**
- Each distinct stall gets one recovery ticket (`reason=recovery recovers=<stall>`). A stall is the record revision plus the stale claim or open run, so the same stall is never woken twice; a failed call is retried up to the usual 4 calls.
- A goal gets at most 3 recovery wakes in its life. A run gets at most 3 claim attempts.
- The woken session's caps are the runner's own: at the run cap or the 24-hour cap, `begin` records the goal blocked instead of working.
- The woken session still passes the guard (the recovery ticket must match the record's PR and head) and must win a fresh claim, which itself refuses while the old claim is live.

`wake.test.ts` covers each rule. `wake.duplicate.test.ts` runs it end to end:
1. a session dies right after claiming;
2. the watchdog skips while the claim is live;
3. once the claim is stale, it posts one recovery ticket and wakes the routine;
4. later passes skip, including after that ticket is old;
5. the recovered session wins attempt 2, commits and pushes, with no `resolve-fork` and no person involved;
6. a quiet but complete goal is never woken.

Limitations:
- The 90-minute Codex timeout, the 60-minute CI timeout and the 24-hour cap are recorded when the next event or watchdog wake starts the runner, up to one watchdog interval late.
- `github-actions[bot]` is the login of every workflow's `GITHUB_TOKEN`, so another workflow with `issues: write` could post a comment in the ticket format. That alone starts nothing: only a holder of the routine token can start a run, and this workflow sends only the ids of tickets it wrote itself. The ticket check is what keeps a real wake from running the wrong goal; it does not replace keeping the token secret.
- "No run has started since the ticket" compares GitHub's comment time with the session clock that stamped the run. A skew larger than the gap between a run's start and the next ticket could make the guard refuse a valid ticket, or miss that one was already taken. In the second case the open-run check and the record's stale-revision refusal still stop two runs from saving over each other.

One-time setup (account owner):
1. Create a routine at claude.ai/code/routines. Attach the `setupify-labz/Specsmith` repo, use the Default environment and no connectors, paste `ROUTINE_PROMPT.md`, add an API trigger, and generate its token.
2. Add the repo secrets `AUTO_GOAL_ROUTINE_FIRE_URL` (the trigger's `/fire` URL) and `AUTO_GOAL_ROUTINE_TOKEN`, the repo variable `AUTO_GOAL_TRUSTED_LOGIN`, and an `auto-goal` label.
3. Merge this directory and the workflow to `main`: these triggers only run from the default branch.
