# Auto Goal Actions executor — inactive proposal

`auto-goal-actions.yml` is deliberately stored here, outside `.github/workflows`, and all three jobs also have `if: ${{ false }}`. GitHub cannot start it. No OAuth token, rule or live goal was added. This is a reviewable design, not a working unattended executor.

## Boundaries in the proposed design

- **Implement:** checks out trusted `main`, reads one open issue carrying the `auto-goal` label and passes its number, title and body as untrusted task data. It receives a Claude subscription token and a read-only GitHub token, and proposes edits. The intended Claude tool list has no shell or web tools. The hosted action, its project configuration and its dependencies have **not** been proven to honor that intended boundary.
- **Check:** a fresh runner with `permissions: {}`, no explicitly passed secrets and `persist-credentials: false`. It validates a small text patch, then executes the changed code. After the checks, it compares the checkout's diff byte for byte with a freshly downloaded proposal before recording success. That detects persistent changes made by tests and builds, but not code that alters itself only while being tested and then restores itself. GitHub's `github.token` context still exists, so this is not proof of zero credentials or network isolation.
- **Publish:** starts only after the check job succeeds, downloads the original patch and the check report, compares SHA-256 and paths, and runs only trusted code before pushing a draft branch. The workflow's write token is broader than one branch; a branch ruleset and an independent approval remain necessary. The draft PR is never merged by this template.

The patch validator accepts edits to existing `artifacts/SpecSmith/src/**/*.ts`, `.tsx` and `.css` files only. It refuses new or deleted files, mode changes, symlinks, renames and binary patches. This scope is enough for the proposed part-picker pilot, not for general overhauls. The raw patch bytes and exact base commit are bound to the check report. A SHA-256 match establishes byte identity between the checked and published patch; it does not establish that the code is safe or that the test job is immune to compromise.

## Before installing or enabling

An independent security reviewer must check the exact pinned Claude action revision (the SHA is a tag target, not yet audited), trusted `main` checkout and project configuration, action setup behavior, job permissions, artifact provenance, the ability of proposed code to affect later jobs, branch rules, and the GitHub token available to each job. They must validate a hostile review comment and an altered build script in an isolated test repository. Those exercises were not performed here. Also test one normal goal end to end with no spending, deployment or automatic merge.

The current #185 routine stays disabled. This template does not use its wake bridge or claim branches. Wiring those pieces into this design is separate work after the boundary is independently verified.

Run the ordinary local checks with `node --test docs/auto-goal-actions/validate-proposal.test.mjs`.
