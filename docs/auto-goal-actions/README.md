# Auto Goal Actions executor — inactive proposal

`auto-goal-actions.yml` is deliberately stored here, outside `.github/workflows`, and every job also has `if: ${{ false }}`. GitHub cannot start it. No OAuth token, rule or live goal was added. This is a reviewable design, not a working unattended executor.

## Version 1 pilot path (offline only)

The workflow now implements version 1 of [PILOT_HANDOFF_CONTRACT.md](PILOT_HANDOFF_CONTRACT.md) §1A. The Auto Goal runner dispatches it once per phase (reproduce, then implement) with `{goal, issue, nonce}`. Its six jobs are all gated off:

- **`read-dispatch`:** validates the dispatch against the goal record.
- **`implement`:** the restricted CLI on the dispatch base.
- **`publish`:** guard, then a compare-and-swap push to `claude/auto-goal-<goal>`, then a re-read and the draft PR.
- **`gate-checks`:** re-reads the record before any check job starts. Each `check` job reads it again in the step just before proposed code first runs (the proposal's `pnpm install`); that step alone gets a token, with `issues: read`.
- **`check`:** one job per trusted check, named `check <phase> <id> <sha>`.
- **`record-check`:** writes an informational status.

New trusted scripts:

- **`dispatch-guard.mjs`:** the record and branch checks of §1A.5. It validates every revision of the record with `record-guard.mjs` (the coordinator's `validateGoal` and revision pinning, in plain JavaScript) before it uses the record's branch or dispatch fields.
- **`run-check.mts`:** maps a check ID onto `checks.ts` and succeeds only when the phase's expectation is met.

`validate-proposal.mjs` takes `--phase` and `--criterion`.

The whole path is exercised offline in `artifacts/SpecSmith/scripts/auto-goal/executorPilot.test.ts`: fake GitHub, mock Claude, real git, and real checks on a fixture. Nothing here has run on GitHub.

The section below describes the design history up to `f68add4`; where it differs, the version 1 path above applies.

## Boundaries in the proposed design

- **Read issue:** a separate job with an `issues: read` token and no checkout or secrets. It reads one open issue carrying the `auto-goal` label and outputs only its number, title, body and labels as JSON.
- **Implement:** checks out trusted `main` with `persist-credentials: false`, under a `contents: read` job token. No GitHub token is mapped into any step, and the job has no `issues` or `id-token` scope.
  - It runs the pinned Claude Code CLI (`@anthropic-ai/claude-code@2.1.292`) directly, in `--restricted` mode, with the issue JSON passed as data through an environment variable. The hosted Claude action is no longer used: at the pinned SHA it always configures Git with a GitHub token, either the `github_token` input or an app token minted through OIDC.
  - `assert-no-git-auth.mjs` refuses to continue if any known Git authentication route is present. It runs in the same step, immediately before Claude starts, and again before the patch is exported.
  - Claude is offered only Read, Edit, Glob and Grep. Edit is pre-approved only on the validator's source paths, and every other permission request is denied. Restricted mode ignores the checkout's `.claude/settings.json`, so its Read deny rules are passed again inline with `--settings`.
  - `restricted-cli.test.mjs` checks this with the pinned CLI against a local mock of the Messages API: scripted tool calls, no model or credential. It is local evidence only, not a hosted run, and the limits are listed in SECURITY_REVIEW.md ("What restricted mode still cannot protect").
- **Publish:** validates the proposed patch using trusted code, applies it to the fixed base commit and creates a draft branch. It does not execute proposed application code. Its write token is broader than one branch; a branch ruleset and independent approval remain necessary. The draft PR is never merged by this template.
- **Check:** starts after publish, checks out the exact draft commit by SHA in a fresh runner with `contents: read`, no explicitly passed secrets and `persist-credentials: false`. Read access is required for private-repository checkout; no repository write scope is granted. It then runs the tests and build. Proposed code can change its own working directory while tests run; this workflow cannot prove that every test executed the originally committed bytes. The result must be associated with the exact draft commit before any later automated decision. GitHub's `github.token` context still exists, so this is not proof of zero credentials or network isolation.
- **Record check:** runs only after publish and check both succeed. It has `pull-requests: read` and `statuses: write`, and no checkout, action or proposed code. Its inline script reads the draft PR from GitHub again. It writes an `auto-goal/check` success status on the proposal SHA only if the PR is still an open draft, in this repository, from the proposal branch to `main`, with that exact head. Otherwise it fails without writing. Commit statuses belong to one SHA, so a later push starts with no `auto-goal/check` success. `record-check.test.mjs` exercises the script against a fake GitHub API.

The patch validator accepts edits to existing `artifacts/SpecSmith/src/**/*.ts`, `.tsx` and `.css` files only. It refuses new or deleted files, mode changes, symlinks, renames and binary patches. This scope is enough for the proposed part-picker pilot, not for general overhauls. The published draft commit is immutable; the check job uses its SHA. There is no check report artifact for the publisher to trust and no automatic merge.

## Before installing or enabling

An independent security reviewer must check the exact pinned Claude action revision (the SHA is a tag target, not yet audited), trusted `main` checkout and project configuration, action setup behavior, job permissions, artifact provenance, branch rules, and the GitHub token available to each job. They must validate a hostile review comment and an altered build script in an isolated test repository. Those exercises were not performed here. Also test one normal goal end to end with no spending, deployment or automatic merge. A real executor must arrange reliable CI status on the published commit and bind subsequent review decisions to it; this disabled template has no wake loop.

The preliminary findings and the specific blockers to enabling are in [SECURITY_REVIEW.md](./SECURITY_REVIEW.md).

The current #185 routine stays disabled. This template does not use its wake bridge or claim branches. Wiring those pieces into this design is separate work after the boundary is independently verified.

Run the ordinary local checks with `node --test docs/auto-goal-actions/*.test.mjs`.
