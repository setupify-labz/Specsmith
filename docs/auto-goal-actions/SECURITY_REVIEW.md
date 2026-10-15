# Security audit of the inactive Auto Goal template

Reviewed the template in this document's commit against the pinned Claude action source, the repository's `.claude/settings.json`, and GitHub's Actions permission documentation. The template and review are in the same Git tree, including the cache removal. This is a preliminary review by the template author, **not** the independent security sign-off required before installation. No real credential, live workflow, or goal was used.

## What the template establishes

- It is outside `.github/workflows` and all jobs have a false condition.
- The publisher runs the trusted patch validator, accepts changes only to existing source files of limited types, commits a draft before executing proposed code, and never runs the changed application.
- The check job fetches the immutable draft commit by SHA on a fresh runner with `contents: read`, no declared write permission or explicitly passed secret. It has a 20-minute job limit. The dependency cache is disabled so code under test cannot write a cache restored by a later job.
- The workflow cannot merge, deploy, request Codex review, or resume a goal. Its check result is a job on the dispatch workflow; a later controller would need to bind that result to the draft SHA.

## What the no-git-auth test cannot prove

`no-git-auth.test.mjs` uses no credential.
- **What it checks:**
  - With the implement step's declared environment and a checkout like the job's, Git sends no credential to a local server that demands one, and `ls-remote` and `push --dry-run` fail.
  - A positive control shows the same Git does send a credential once checkout's persisted header is present.
  - Each known route is refused with a fixed category message. The guard never prints a variable name, config key, URL, path or value, and a mixed-case regression test checks that no copy of the placeholder appears in any letter case. Git lowercases config keys, and an earlier version leaked a credential through a lowercased URL rewrite key. The routes covered: token variables, injected Git config, extra headers, credential helpers, URLs with credentials, askpass, and credential files.
  - The workflow shape: no GitHub token, OIDC scope or hosted action in `implement`, and the issue read in its own job.
- **What it cannot show:**
  - **Hosted runner:** it does not run on a GitHub-hosted runner. Credential routes specific to the runner image or the Actions runtime (for example the runner's own files, or tokens provided to actions rather than steps) are not covered. GitHub still creates a `contents: read` token for the job; this test only shows it is not mapped into the step or Git.
  - **The CLI:** it does not run the Claude CLI. `restricted-cli.test.mjs` covers the CLI's tool restriction separately; see "Restricted CLI" below.
  - **Other routes:** it checks Git and the gh CLI configuration only, not other HTTP clients, network egress, or routes it does not know about. The check is a list of known paths, not proof that no other path exists.
  - **Hostile behaviour:** it does not exercise a hostile issue body or a modified build script.

## Restricted CLI

The implement job pins `@anthropic-ai/claude-code@2.1.292`, the npm `stable` tag on 2026-10-15, and runs it with `--restricted`. The official [CLI reference](https://code.claude.com/docs/en/cli-reference) says that mode requires v2.1.248 or later. It:

- removes the built-in tools that run commands or code, and WebFetch, unless `--tools` names them;
- loads only managed settings and `--settings`, ignoring user, project and local settings files;
- confines the built-in file tools to the working directories;
- refuses `bypassPermissions`;
- lets only a person or the configured permission handler approve writes to settings, Git and tool-configuration files.

The pinned CLI's `--help` describes the same behaviour. The [tools reference](https://code.claude.com/docs/en/tools-reference) lists no `MultiEdit` tool, so the old flag naming it was dropped.

### The invocation

- `--tools "Read,Edit,Glob,Grep"` is the only tool set. `--disallowedTools` also names the shell, web, Write, NotebookEdit, Agent and all MCP tools, as a second layer.
- `--allowedTools` pre-approves Read, Glob, Grep, and Edit on `artifacts/SpecSmith/src/**/*.{ts,tsx,css}` only, the validator's scope. With `--permission-mode default` and `--permission-prompts none`, anything else that needs approval is denied, because nobody can answer.
- Restricted mode also drops the project's `Read` deny rules for `.env`, secret, credential, `.pem` and `.key` files. The trusted workflow passes the same rules inline with `--settings`, along with `disableAllHooks` and `disableBypassPermissionsMode`. They are inline JSON, not a file in the checkout, so nothing in the checkout supplies them.
- `--strict-mcp-config` loads no MCP servers. `--no-session-persistence` writes no transcript.
- The job gates, the Git-auth guard, the step environment, the export check and the validator are unchanged.

### Credential-free evidence

Run `node --test docs/auto-goal-actions/*.test.mjs`. The static tests run everywhere. They parse the workflow's actual `claude` command and check the exact pin, the flag list, the tool lists, the inline settings against `.claude/settings.json`, and that every Edit rule maps onto paths the validator accepts.

To run the CLI tests, install the pin and point `AUTO_GOAL_CLAUDE_BIN` at it, for example `npm install --prefix /tmp/cli @anthropic-ai/claude-code@2.1.292`, then `AUTO_GOAL_CLAUDE_BIN=/tmp/cli/node_modules/.bin/claude`.

The CLI tests run that binary with the workflow's exact flags against a local mock of the Messages API in the test process. The mock plays the model by returning a fixed list of tool calls, and records the result the CLI sends back for each one. Each run has an empty HOME, a placeholder API key that only the mock accepts, and a proxy on a closed local port. The scratch checkout contains SpecSmith's real `.claude/settings.json` and `CLAUDE.md`. Results on 2026-10-15, Linux, pinned CLI:

| Scripted call | Result |
| :- | :- |
| Offered tools | Exactly Edit, Glob, Grep and Read, although the project settings allow Bash; no MCP servers. |
| Edit and Read of `artifacts/SpecSmith/src/lib/a.ts` | Succeed. The edit is applied. |
| Edit of `package.json`, `.claude/settings.json`, `.git/config`, a `.js` file under `src/`, a file outside the checkout, and an in-scope symlink to a file outside it | Refused. Every file is unchanged. |
| Read of `.env`, of a file outside the checkout, and of `/proc/self/environ` (with a canary variable set); Grep for the canary, inside and outside the checkout; Glob outside it | Refused or empty. No result contains the canary. |
| Bash, WebFetch and Write | Refused with "No such tool available". |

The positive controls check that these results come from the flags:

- Without `--restricted`, the same checkout's project settings are loaded (a project deny rule removes Read).
- Without the inline `--settings`, `.env` is read.
- With `acceptEdits` in place of the scoped rules, `package.json` is edited.

Mutation checks were run by hand, each against a temporary edit of the workflow. Removing `--restricted`, allowing `Edit` everywhere, or removing the inline deny rules each fails both a static test and a CLI test.

### What restricted mode still cannot protect

- **The OAuth token is still in the process.** `CLAUDE_CODE_OAUTH_TOKEN` is in the CLI's environment and memory, and is sent to Anthropic. The tests show that the offered tools cannot read `/proc/self/environ`. They do not show that no CLI defect, future tool, managed setting or dependency can expose the token. This is a tool policy inside one process running as the runner user, not an OS sandbox, container or separate account.
- **Network egress is not controlled.** The runner has normal outbound access. Restricted mode removes WebFetch and the command-running tools; it does not firewall the process. The tests block the proxy locally; a hosted run would not.
- **Anything the allowed tools can reach is exposed to the model.** It can read every file in the checkout that the deny patterns don't name, and those contents go into the conversation. The deny rules match file names; a secret stored under another name would be readable. The checkout is trusted `main`, which should hold no secret, but this design does not prove that.
- **Allowed edits can still be hostile.** The issue text and `CLAUDE.md` still reach the model as instructions. Prompt injection can steer any edit inside `artifacts/SpecSmith/src/**/*.{ts,tsx,css}`, including code that the check job later runs. The validator, the draft PR, CI and human review are the remaining controls.
- **Managed settings and `--settings` still apply.** A runner image with a managed settings file could add tools, hooks or permissions. GitHub-hosted runners are not known to ship one, but this was not verified on a hosted runner.
- **New files within scope.** Whether Edit can create a file in the allowed paths was not tested. Write is not offered, and the export step and validator refuse untracked and new files.
- **Coverage is limited to the scripted cases.** The tests cover one symlink case, absolute paths and the listed files. They do not cover hard links, symlinked directories, path-encoding tricks, races between check and use, or every tool input shape. A real model can only call offered tools, but the tests do not exhaust what those tools accept.
- **Local evidence only.** The CLI tests ran on one Linux machine against a mock, not on a GitHub-hosted runner with a real model. CLAUDE.md requires reproducible CI or approved hosted evidence for a large integration. The CLI tests skip unless the pinned binary is supplied, so the repository's CI does not run them today.
- **The version is pinned, not the bytes.** `npm install` pins the version but not a tarball checksum or lockfile, so a compromised registry or package is not covered. A later release could change these semantics; the pin and the version test keep that from happening silently.

## Blockers to enabling

1. **Implementer token boundary is not proven.**
   - **What changed:** Claude no longer receives a GitHub token, and Git in its checkout has no configured way to authenticate. The issue is read by a separate `read-issue` job (`issues: read`), and only its JSON reaches the implement step, through an environment variable. The implement job has `contents: read` only, no `issues` or `id-token` scope, and no GitHub token mapped into any step.
   - **Why the hosted action was dropped:** at the pinned SHA, `claude-code-action` either uses the `github_token` input or, without it, requests an OIDC token and exchanges it for a Claude GitHub App token with contents, pull-request and issue write. Either way, agent mode then writes that token into the checkout's Git configuration (`action.yml`, `src/github/token.ts` `setupGitHubToken`, `src/modes/agent/index.ts` `configureGitAuth`). So the job runs the pinned CLI directly instead.
   - **What remains open:** the step still holds `CLAUDE_CODE_OAUTH_TOKEN`. The CLI now runs in `--restricted` mode, so the repository's Bash allow rules are not loaded (see "Restricted CLI" below). That is a tool policy, not an OS sandbox. An independent reviewer must still inspect the CLI version and run a disposable-credential test before any real token is supplied.
2. **The test job is not a sealed sandbox.** GitHub creates a token for every job and exposes it through `github.token`, even if not explicitly passed to a step. The job has `contents: read`, needed to check out a private repository, but proposed code has normal network and filesystem access and may change its own workspace during tests. The draft commit fixes what is proposed for review; passing tests do not prove every instruction executed those original bytes.
3. **The publisher has repository-wide write permission.** Its trusted steps validate the patch and do not run proposed code, but the workflow token itself is not limited to `claude/` branches. Branch rules, Actions PR creation settings, and the exact pinned actions still require independent verification. GitHub may require approval for workflows on PRs created with `GITHUB_TOKEN`; the separate check job here does not constitute a PR-head status.
4. **This is a narrow pilot template, not the unattended loop.** Only existing `artifacts/SpecSmith/src/**/*.ts`, `.tsx` and `.css` edits are admitted. It does not handle tests, new files, most large goals, Codex handoffs, retries, or completion records. A successful dry run of this template alone would not establish the user's Auto Goal outcome.

## Evidence and remaining validation

- Local ordinary fixtures: `node --test docs/auto-goal-actions/*.test.mjs` (including the credential-free `no-git-auth.test.mjs`); YAML parse; `git diff --check`. These test path refusals and structural job permissions. They are not adversarial isolation tests.
- A disposable local Git repository test runs the publisher's actual validation shell from the template (`node --test docs/auto-goal-actions/local-boundary.test.mjs`). It confirms a regular edit commits the same patch bytes, while an out-of-scope path and both a symlink with a forged regular-file index and an index shifted between sections are refused before applying changes. The marker named `DISPOSABLE_SENTINEL` is plain test text, not an access credential. This checks the shell gate, not GitHub-hosted job or Claude action isolation.
- GitHub-hosted smoke test: [private disposable repo run #2](https://github.com/setupify-labz/specsmith-auto-goal-isolation-20261014/actions/runs/38623934396) completed all three benign jobs. The implement job exported a patch, the publisher verified its SHA-256 and pushed a draft branch, and the check job fetched that exact commit with `contents: read`, `persist-credentials: false`. Its `git push --dry-run` was refused with “could not read Username … terminal prompts disabled”; the test-only marker was absent in publish and check. [Run #1](https://github.com/setupify-labz/specsmith-auto-goal-isolation-20261014/actions/runs/38623735943) failed at private-repository checkout with `permissions: {}`, revealing that `contents: read` is required. Neither run supplied a real credential, ran the Claude action, or exercised hostile code. They verify only this benign hosted handoff, not the implementer token boundary or full isolation.
- [Private disposable repo run #3](https://github.com/setupify-labz/specsmith-auto-goal-isolation-20261014/actions/runs/38624477920) passed all three jobs with the nonfunctional `DISPOSABLE_SENTINEL` stored as a GitHub Actions repository secret and explicitly mapped into the implement step. The publish and check steps asserted that this environment variable was absent, and the check job again could not push. This shows the benign workflow did not inject that secret into those steps automatically. It does **not** show that malicious code in another job could never reference the repository's `secrets` context, nor test the Claude action or a usable credential. The disposable repository and its test-only secret remain for independent inspection and cleanup.
- Source inspected: [pinned Claude action](https://github.com/anthropics/claude-code-action/blob/34968b5981d5d170904281aa3df6f3c0d4a28855/action.yml), its [agent mode](https://github.com/anthropics/claude-code-action/blob/34968b5981d5d170904281aa3df6f3c0d4a28855/src/modes/agent/index.ts), [GitHub's job token documentation](https://docs.github.com/en/actions/concepts/security/github_token), and [GitHub's Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
- Still required: independent review of the pinned action and job permissions; verification of repository rules and Actions settings; an isolated test repository with disposable credentials and deliberately hostile issue content and build code; confirmation that the exact SHA is used through publication, checks and review. Do not turn on this workflow or add the real OAuth token before those pass.

**Verdict:** keep PR #187 disabled. It is suitable for design review, not for a live pilot.
