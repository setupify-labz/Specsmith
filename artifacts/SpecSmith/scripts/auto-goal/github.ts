// The only code that talks to GitHub. It shells out to `gh api` (REST), which in a Claude Code
// session goes through the session's GitHub proxy and elsewhere uses the GitHub CLI's own login,
// so no token is read, stored or printed here. Tests substitute a fake GitHub.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GhIssueComment, GhReview, GhReviewComment } from "./codex.ts";
import { GoalError } from "./record.ts";

const run = promisify(execFile);

export interface GhCheckRun { readonly name: string; readonly status: string; readonly conclusion: string | null; readonly html_url: string }
export interface GhPull {
  readonly number: number; readonly state: string; readonly draft: boolean; readonly merged: boolean; readonly html_url: string;
  readonly head: { readonly sha: string; readonly ref: string; readonly repo: { readonly full_name: string } | null };
  readonly base: { readonly ref: string; readonly repo: { readonly full_name: string } };
}

/** The PR must come from the goal's own repository and branch and target the goal's base branch. */
export function pullMismatch(pull: GhPull, goal: { repo: string; branch: string; baseBranch: string }): string | null {
  if (pull.head.ref !== goal.branch) return `is from ${pull.head.ref}, not the goal branch ${goal.branch}`;
  if (pull.head.repo?.full_name !== goal.repo) return `is from ${pull.head.repo?.full_name ?? "a deleted fork"}, not ${goal.repo}`;
  if (pull.base.repo.full_name !== goal.repo || pull.base.ref !== goal.baseBranch) return `targets ${pull.base.repo.full_name}:${pull.base.ref}, not ${goal.repo}:${goal.baseBranch}`;
  return null;
}

export interface GitHub {
  /** The login this session acts as; only its comments can be goal records. */
  whoami(): Promise<string>;
  pull(repo: string, pr: number): Promise<GhPull>;
  checkRuns(repo: string, sha: string): Promise<GhCheckRun[]>;
  issueComments(repo: string, issue: number): Promise<GhIssueComment[]>;
  reviews(repo: string, pr: number): Promise<GhReview[]>;
  reviewComments(repo: string, pr: number): Promise<GhReviewComment[]>;
  createIssue(repo: string, title: string, body: string): Promise<{ number: number; html_url: string }>;
  createComment(repo: string, issue: number, body: string): Promise<GhIssueComment>;
  /** Open PRs whose head is `branch` in `repo` (to adopt one a lost response already created). */
  openPullsFor(repo: string, branch: string): Promise<GhPull[]>;
  /** Opens a draft PR (never ready for review, never merged here). */
  createDraftPull(repo: string, head: string, base: string, title: string, body: string): Promise<{ number: number; html_url: string }>;
}

/** Executor mode (contract §1A.4 change 4): the Actions and commit reads the coordinator binds results with. */
/**
 * A workflow run as GitHub's REST API and workflow_run webhook return it. `name` is the workflow's
 * name; a custom `run-name` arrives as `display_title`. `path` may carry a ref suffix
 * (".github/workflows/x.yml@main"). `workflow_id` identifies the workflow independently of both.
 */
export interface GhWorkflowRun {
  readonly id: number; readonly name: string; readonly display_title: string; readonly path: string; readonly workflow_id: number;
  readonly event: string; readonly head_branch: string; readonly head_sha: string;
  readonly status: string; readonly conclusion: string | null; readonly html_url: string; readonly created_at: string;
}
export interface GhJob { readonly id: number; readonly name: string; readonly status: string; readonly conclusion: string | null; readonly html_url: string }
export interface GhCommit { readonly sha: string; readonly parents: readonly { readonly sha: string }[]; readonly commit: { readonly message: string } }

export interface ExecutorGitHub extends GitHub {
  /** Starts the executor workflow, and only that workflow, on `ref` (GitHub returns no run id). */
  dispatchExecutor(repo: string, ref: string, inputs: { goal: string; issue: string; nonce: string }): Promise<void>;
  /** workflow_dispatch runs of the executor workflow created at or after `createdSince`. */
  executorRuns(repo: string, createdSince: string): Promise<GhWorkflowRun[]>;
  /** The executor workflow's id (GET .../actions/workflows/auto-goal-actions.yml), which every executor run must carry. */
  executorWorkflowId(repo: string): Promise<number>;
  run(repo: string, id: number): Promise<GhWorkflowRun>;
  runJobs(repo: string, id: number): Promise<GhJob[]>;
  /** File names changed between two commits (GET compare/base...head). */
  compareFiles(repo: string, base: string, head: string): Promise<string[]>;
  commit(repo: string, sha: string): Promise<GhCommit>;
  /** The branch's commit, or null when the branch does not exist. */
  branchHead(repo: string, branch: string): Promise<string | null>;
}

export function isExecutorGitHub(github: GitHub): github is ExecutorGitHub {
  const g = github as Partial<ExecutorGitHub>;
  return [g.dispatchExecutor, g.executorRuns, g.executorWorkflowId, g.run, g.runJobs, g.compareFiles, g.commit, g.branchHead].every((f) => typeof f === "function");
}

async function gh<T>(args: string[], input?: string): Promise<T> {
  try {
    const child = run("gh", ["api", ...args], { maxBuffer: 64 * 1024 * 1024 });
    if (input !== undefined) { child.child.stdin?.write(input); child.child.stdin?.end(); }
    const { stdout } = await child;
    // A 204 (the dispatch endpoint) has no body.
    return (stdout.trim() === "" ? undefined : JSON.parse(stdout)) as T;
  } catch (error) {
    const e = error as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") throw new GoalError("unavailable", "GitHub is unreachable: no `gh` command on this machine.");
    // stderr from gh carries GitHub's error message, never the credential.
    throw new GoalError("unavailable", `GitHub API call failed (gh api ${args.filter((a) => !a.startsWith("-")).slice(0, 1).join(" ")}): ${(e.stderr || e.message || "unknown error").trim().slice(0, 400)}`);
  }
}

/** Follows REST pagination until a short page. */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await gh<T[]>([`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`]);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export const ghCli: ExecutorGitHub = {
  whoami: async () => (await gh<{ login: string }>(["user"])).login,
  pull: (repo, pr) => gh([`repos/${repo}/pulls/${pr}`]),
  checkRuns: async (repo, sha) => (await gh<{ check_runs: GhCheckRun[] }>([`repos/${repo}/commits/${sha}/check-runs?per_page=100`])).check_runs,
  issueComments: (repo, issue) => all(`repos/${repo}/issues/${issue}/comments`),
  reviews: (repo, pr) => all(`repos/${repo}/pulls/${pr}/reviews`),
  reviewComments: (repo, pr) => all(`repos/${repo}/pulls/${pr}/comments`),
  createIssue: (repo, title, body) => gh(["-X", "POST", `repos/${repo}/issues`, "--input", "-"], JSON.stringify({ title, body })),
  createComment: (repo, issue, body) => gh(["-X", "POST", `repos/${repo}/issues/${issue}/comments`, "--input", "-"], JSON.stringify({ body })),
  openPullsFor: (repo, branch) => gh([`repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split("/")[0]}:${branch}`)}&per_page=10`]),
  createDraftPull: (repo, head, base, title, body) => gh(["-X", "POST", `repos/${repo}/pulls`, "--input", "-"], JSON.stringify({ head, base, title, body, draft: true })),
  // The one dispatch the coordinator can make: the executor workflow file is fixed here, not passed in.
  dispatchExecutor: async (repo, ref, inputs) => { await gh(["-X", "POST", `repos/${repo}/actions/workflows/auto-goal-actions.yml/dispatches`, "--input", "-"], JSON.stringify({ ref, inputs })); },
  executorRuns: async (repo, since) => (await gh<{ workflow_runs: GhWorkflowRun[] }>([`repos/${repo}/actions/workflows/auto-goal-actions.yml/runs?event=workflow_dispatch&created=${encodeURIComponent(`>=${since}`)}&per_page=100`])).workflow_runs,
  executorWorkflowId: async (repo) => (await gh<{ id: number }>([`repos/${repo}/actions/workflows/auto-goal-actions.yml`])).id,
  run: (repo, id) => gh([`repos/${repo}/actions/runs/${id}`]),
  runJobs: async (repo, id) => (await gh<{ jobs: GhJob[] }>([`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs,
  compareFiles: async (repo, base, head) => ((await gh<{ files?: { filename: string }[] }>([`repos/${repo}/compare/${base}...${head}`])).files ?? []).map((f) => f.filename),
  commit: (repo, sha) => gh([`repos/${repo}/commits/${sha}`]),
  branchHead: async (repo, branch) => {
    try { return (await gh<{ object: { sha: string } }>([`repos/${repo}/git/ref/heads/${branch}`])).object.sha; } catch (error) {
      if (error instanceof GoalError && /\b404\b|Not Found/.test(error.message)) return null;
      throw error;
    }
  },
};
