# Auto Goal Actions executor — inactive proposal

`auto-goal-actions.yml` is deliberately stored here, outside `.github/workflows`, and all three jobs also have `if: ${{ false }}`. GitHub cannot start it. No OAuth token, rule or live goal was added. This is a reviewable design, not a working unattended executor.

## Boundaries in the proposed design

- **Implement:** checks out trusted `main`, reads one open issue carrying the `auto-goal` label and passes its number, title and body as untrusted task data. It receives a Claude subscription token and a read-only GitHub token, and proposes edits. The intended Claude tool list has no shell or web tools. The hosted action, its project configuration and its dependencies have **not** been proven to honor that intended boundary.
- **Publish:** validates the proposed patch using trusted code, applies it to the fixed base commit and creates a draft branch. It does not execute proposed application code. Its write token is broader than one branch; a branch ruleset and independent approval remain necessary. The draft PR is never merged by this template.
- **Check:** starts after publish, checks out the exact draft commit by SHA in a fresh runner with `permissions: {}`, no explicitly passed secrets and `persist-credentials: false`. It then runs the tests and build. Proposed code can change its own working directory while tests run; this workflow cannot prove that every test executed the originally committed bytes. The result must be associated with the exact draft commit before any later automated decision. GitHub's `github.token` context still exists, so this is not proof of zero credentials or network isolation.

The patch validator accepts edits to existing `artifacts/SpecSmith/src/**/*.ts`, `.tsx` and `.css` files only. It refuses new or deleted files, mode changes, symlinks, renames and binary patches. This scope is enough for the proposed part-picker pilot, not for general overhauls. The published draft commit is immutable; the check job uses its SHA. There is no check report artifact for the publisher to trust and no automatic merge.

## Before installing or enabling

An independent security reviewer must check the exact pinned Claude action revision (the SHA is a tag target, not yet audited), trusted `main` checkout and project configuration, action setup behavior, job permissions, artifact provenance, branch rules, and the GitHub token available to each job. They must validate a hostile review comment and an altered build script in an isolated test repository. Those exercises were not performed here. Also test one normal goal end to end with no spending, deployment or automatic merge. A real executor must arrange reliable CI status on the published commit and bind subsequent review decisions to it; this disabled template has no wake loop.

The current #185 routine stays disabled. This template does not use its wake bridge or claim branches. Wiring those pieces into this design is separate work after the boundary is independently verified.

Run the ordinary local checks with `node --test docs/auto-goal-actions/validate-proposal.test.mjs`.
