// Reads what the Codex GitHub connector actually posted on a PR. Formats observed on this
// repository (PRs #180 and #182, October 2026):
//
//   clean:     an issue comment "Codex Review: Didn't find any major issues. ... **Reviewed commit:** `929048af01`"
//   findings:  a PR review whose body has "### 💡 Codex Review ... **Reviewed commit:** `93755a7b76`",
//              with one review comment per finding: "**<sub><sub>![P2 Badge](...)</sub></sub>  Title**\n\nBody"
//   summary:   an issue comment starting "<!-- codex-pull-request-review-summary -->" (status table; not a verdict)
//
// Any other comment from the connector after a request (usage limits, missing environment, an
// error) is returned verbatim as "unavailable", so the goal stops with Codex's own words instead
// of waiting or guessing.

import type { Priority } from "./record.ts";

export const CODEX_LOGIN = "chatgpt-codex-connector[bot]";

export interface GhUser { readonly login: string }
export interface GhIssueComment { readonly id: number; readonly user: GhUser; readonly body: string; readonly created_at: string; readonly html_url: string }
export interface GhReview { readonly id: number; readonly user: GhUser; readonly body: string; readonly commit_id: string; readonly submitted_at: string; readonly html_url: string }
export interface GhReviewComment {
  readonly id: number; readonly user: GhUser; readonly body: string; readonly pull_request_review_id: number | null;
  readonly in_reply_to_id?: number | null; readonly path: string; readonly line: number | null; readonly html_url: string; readonly commit_id: string;
}

export interface CodexFinding { readonly id: string; readonly priority: Priority; readonly title: string; readonly path: string; readonly line: number | null; readonly url: string; readonly excerpt: string }
export type CodexVerdict =
  | { readonly kind: "clean"; readonly at: string; readonly reviewedPrefix: string; readonly url: string }
  | { readonly kind: "findings"; readonly at: string; readonly reviewedPrefix: string; readonly url: string; readonly findings: readonly CodexFinding[] }
  | { readonly kind: "unavailable"; readonly at: string; readonly text: string; readonly url: string };

const REVIEWED = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/;
const BADGE = /^\s*\*\*<sub><sub>!\[(P[0-3]) Badge\]\([^)]*\)<\/sub><\/sub>\s*(.+?)\*\*/;
const SUMMARY = "<!-- codex-pull-request-review-summary -->";

export function parseFinding(c: GhReviewComment): CodexFinding {
  const m = BADGE.exec(c.body);
  const rest = m ? c.body.slice(m[0].length) : c.body;
  const excerpt = rest.replace(/Useful\? React with .*$/s, "").trim().slice(0, 600);
  return {
    id: String(c.id), priority: (m?.[1] as Priority | undefined) ?? "unbadged",
    title: m ? m[2].trim() : c.body.split("\n")[0].replace(/\*/g, "").trim().slice(0, 140),
    path: c.path, line: c.line, url: c.html_url, excerpt,
  };
}

/** Every verdict Codex has posted on the PR, oldest first. */
export function codexVerdicts(issueComments: readonly GhIssueComment[], reviews: readonly GhReview[], reviewComments: readonly GhReviewComment[]): CodexVerdict[] {
  const out: CodexVerdict[] = [];
  for (const c of issueComments) {
    if (c.user.login !== CODEX_LOGIN) continue;
    if (c.body.startsWith(SUMMARY)) {
      // The status table is only a verdict when it reports a failure.
      if (/\b(Failed|Error)\b|❌/.test(c.body)) out.push({ kind: "unavailable", at: c.created_at, text: c.body.replace(SUMMARY, "").replace(/<details>.*$/s, "").trim().slice(0, 600), url: c.html_url });
      continue;
    }
    const reviewed = REVIEWED.exec(c.body);
    if (/Didn't find any major issues/i.test(c.body) && reviewed) out.push({ kind: "clean", at: c.created_at, reviewedPrefix: reviewed[1], url: c.html_url });
    else out.push({ kind: "unavailable", at: c.created_at, text: c.body.replace(/<details>.*$/s, "").trim().slice(0, 600), url: c.html_url });
  }
  for (const r of reviews) {
    if (r.user.login !== CODEX_LOGIN) continue;
    const reviewed = REVIEWED.exec(r.body);
    const findings = reviewComments.filter((c) => c.user.login === CODEX_LOGIN && c.pull_request_review_id === r.id && !c.in_reply_to_id).map(parseFinding);
    out.push({ kind: "findings", at: r.submitted_at, reviewedPrefix: reviewed?.[1] ?? r.commit_id, url: r.html_url, findings });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The first verdict posted at or after a request that concerns the requested commit (or cannot review at all). */
export function verdictFor(verdicts: readonly CodexVerdict[], requestedSha: string, requestedAt: string): CodexVerdict | null {
  const since = Date.parse(requestedAt);
  return verdicts.find((v) => Date.parse(v.at) >= since && (v.kind === "unavailable" || requestedSha.startsWith(v.reviewedPrefix))) ?? null;
}
