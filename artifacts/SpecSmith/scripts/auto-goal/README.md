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

Nothing polls. The workflow `.github/workflows/auto-goal-wake.yml` runs when:
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
- no `auto-goal/wake` status was posted since the last run started (within 45 minutes).

It writes that commit status before firing, so a redelivered or duplicate event does not start a second run, and a single concurrency group serialises decisions. A lost fire is retried by the next event after 45 minutes.

The workflow runs only from the default branch, checks out only the default branch, never runs PR code, and passes the routine token only to the fire request (which logs just the HTTP status). The fire text is fixed (`wake goal=… issue=… pr=… sha=… reason=…`) and contains no review text. The routine treats it as a hint: its fixed prompt (`ROUTINE_PROMPT.md`) finds the goal with `wake.mjs guard` and never creates triggers.

Limitation: with no polling, the 90-minute Codex timeout and the 24-hour cap are recorded only when the next event arrives.

One-time setup (account owner):
1. Create a routine at claude.ai/code/routines. Attach the `setupify-labz/Specsmith` repo, use the Default environment and no connectors, paste `ROUTINE_PROMPT.md`, add an API trigger, and generate its token.
2. Add the repo secrets `AUTO_GOAL_ROUTINE_FIRE_URL` (the trigger's `/fire` URL) and `AUTO_GOAL_ROUTINE_TOKEN`, the repo variable `AUTO_GOAL_TRUSTED_LOGIN`, and an `auto-goal` label.
3. Merge this directory and the workflow to `main`: these triggers only run from the default branch.
