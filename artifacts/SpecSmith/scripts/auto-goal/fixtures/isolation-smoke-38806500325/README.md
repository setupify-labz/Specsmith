# Isolation-repo smoke test: one workflow_dispatch run with an Auto Goal run-name

Evidence from a credential-free smoke test in the disposable private repository
`setupify-labz/specsmith-auto-goal-isolation-20261014`, captured on 2026-10-15. No Claude token, no new
secret and no Auto Goal was involved. The two workflows were removed from that repository afterwards.

- Run: https://github.com/setupify-labz/specsmith-auto-goal-isolation-20261014/actions/runs/38806500325
  (`smoke-workflow.yml`, dispatched once on `main` with `goal=smoke-1`, `nonce=smoke-1.d1`; its only step
  printed a fixed line).
- Its `workflow_run` event was recorded by run 38806522939 (`capture-workflow.yml`), which printed the
  fields below to its job log.

Files:

- `rest-run.json`: `GET /repos/{repo}/actions/runs/38806500325`, verbatim except `head_commit.author.email`
  and `head_commit.committer.email`, replaced with `[redacted]` (a personal address; not used by any check).
- `rest-workflow.json`: `GET /repos/{repo}/actions/workflows/auto-goal-actions.yml`, verbatim.
- `workflow-run-webhook-fields.json`: the `workflow_run` webhook payload's fields as the capture job printed
  them with `jq` (a field selection, not the whole payload).
- `smoke-workflow.yml`, `capture-workflow.yml`: the two workflow files exactly as run (isolation commit `1f41a56`).

What was observed, for a `workflow_dispatch` run with a custom `run-name`:

- `name` and `display_title` both held the run-name, `Auto Goal smoke-1 smoke-1.d1`, in REST and in the
  webhook payload. The workflow's own name appeared only in the separate workflow object
  (`rest-workflow.json`, and `workflow` in the webhook).
- `path` was `.github/workflows/auto-goal-actions.yml`, with no ref suffix, in both.
- `workflow_id` (386000152) matched the workflow's id; `event` was `workflow_dispatch`; `head_branch` was
  `main`; `head_sha` was the dispatched commit; `pull_requests` was empty.
- A `workflow_run` event was delivered for a run dispatched with a user credential.

Not observed: a `path` with a ref suffix (documented by GitHub, accepted by the binding code, tested only
with constructed fixtures), and a dispatch on a ref other than the default branch.
