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
