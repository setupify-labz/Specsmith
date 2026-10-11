#!/usr/bin/env tsx
// The daily Short proposal job. Run by hand, once a day:
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/dailyShortProposal/run.ts \
//     --snapshot scripts/content-automator/dailyShortProposal/snapshots/<date>.json [--out <dir>] [--max-age-hours 36]
//
// It reads one channel-metrics snapshot (collected through the Metricool and
// vidIQ connectors, see README.md), proposes ONE beginner PC troubleshooting
// Short, and writes everything a person needs to review it into one folder:
//   PROPOSAL.md       evidence, frame-one hook, script, storyboard, metrics that
//                     influenced the choice, unknowns, gate results, human gates
//   proposal.json     the same, machine-readable
//   preview-silent.mp4, preview-phone-sheet.png   the silent storyboard preview
//   run-report.json   stage timings, spend, exit status, snapshot hash
//
// It calls no paid provider, generates no voice, schedules nothing and
// publishes nothing: none of those modules is imported (a test checks).
// Exit codes: 0 proposal ready for human review; 2 written but a gate blocked
// it (revise the topic); 1 refused (missing or stale snapshot, unavailable
// source or renderer: nothing usable was produced).

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStoryboard, humanGatesUnresolved, PERSISTENT_DISCLOSURES, runGates } from "./proposal.ts";
import { renderPreview } from "./preview.ts";
import { selectTopic } from "./select.ts";
import { DailyProposalError, loadSnapshot } from "./snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_ROOT = resolve(here, "../../../render-output/daily-proposals");

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export interface RunResult { readonly exitCode: 0 | 1 | 2; readonly outDir?: string; readonly report: Record<string, unknown> }

export async function runDailyProposal(argv: readonly string[], now = new Date()): Promise<RunResult> {
  const started = performance.now();
  const stages: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    try { return await fn(); } finally { stages[name] = Math.round(performance.now() - t0); }
  };
  const spend = { elevenLabs: "not called", publishing: "not called", scheduling: "not called", metricool: "not called by the job (snapshot input)", vidiq: "not called by the job (snapshot input)" };
  try {
    const { snapshot, bytes } = await time("load-and-validate-snapshot", () => loadSnapshot(arg("--snapshot", argv), now, arg("--max-age-hours", argv) ? Number(arg("--max-age-hours", argv)) : undefined));
    const selection = await time("select-topic", () => selectTopic(snapshot, now));
    const storyboard = buildStoryboard(selection.topic, selection.targetSeconds);
    const gates = await time("run-gates", () => runGates(storyboard, selection.topic, now));
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const outDir = resolve(arg("--out", argv) ?? join(DEFAULT_OUT_ROOT, `${stamp}-${selection.topic.id}`));
    await mkdir(outDir, { recursive: true });
    const preview = await time("render-silent-preview", () => renderPreview(storyboard, PERSISTENT_DISCLOSURES, outDir));
    const status = gates.passed ? "ready-for-human-review" : "blocked-by-gate";
    const proposal = {
      kind: "daily-short-proposal", version: "daily-short-proposal-v1", generatedAt: now.toISOString(), status,
      notPublished: true, noVoiceGenerated: true, notScheduled: true,
      snapshot: { collectedAt: snapshot.collectedAt, collectedBy: snapshot.collectedBy, sha256: createHash("sha256").update(bytes).digest("hex"), cost: snapshot.cost ?? "unknown" },
      topic: { id: selection.topic.id, family: selection.topic.family, symptom: selection.topic.symptom, title: selection.topic.title },
      hook: { frameOne: selection.topic.hook },
      script: storyboard.beats.map((b) => b.narration).join(" "),
      storyboard,
      evidence: {
        channelSignals: selection.signals, themeSummary: selection.themeSummary,
        claims: selection.topic.claims, riskyClaimsBlocked: selection.topic.riskyClaims,
      },
      metricsThatInfluencedTheChoice: selection.influences,
      unknown: selection.unknowns,
      topicsExcluded: selection.excluded, ranking: selection.ranking,
      gates: { passed: gates.passed, findings: gates.findings },
      humanGates: humanGatesUnresolved(),
      preview: { file: "preview-silent.mp4", phoneSheet: "preview-phone-sheet.png", sha256: preview.sha256, minFontPx: preview.minFontPx, label: "STORYBOARD PREVIEW · NOT FINAL ART" },
    };
    await writeFile(join(outDir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`);
    await writeFile(join(outDir, "PROPOSAL.md"), proposalMarkdown(proposal));
    const report = { status, exitCode: gates.passed ? 0 : 2, outDir, totalMs: Math.round(performance.now() - started), stagesMs: stages, spend, snapshotCost: snapshot.cost ?? "unknown" };
    await writeFile(join(outDir, "run-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: gates.passed ? 0 : 2, outDir, report };
  } catch (error) {
    if (error instanceof DailyProposalError) {
      return { exitCode: 1, report: { status: "refused", code: error.code, reason: error.message, totalMs: Math.round(performance.now() - started), stagesMs: stages, spend } };
    }
    throw error;
  }
}

type Proposal = Record<string, any>;
function proposalMarkdown(p: Proposal): string {
  const sb = p.storyboard;
  const rows = (items: any[], cols: string[]) => items.map((it) => `| ${cols.map((c) => String(it[c] ?? "").replace(/\|/g, "/")).join(" | ")} |`).join("\n");
  return `# Daily Short proposal: ${p.topic.title}

**Status: ${p.status}.** Not published, not scheduled, no voice generated. Every human gate below is unresolved.

Generated ${p.generatedAt} from the snapshot collected ${p.snapshot.collectedAt} (sha256 \`${p.snapshot.sha256.slice(0, 16)}…\`).

## Frame-one hook
> **${p.hook.frameOne}**

## Proposed script (not voiced)
> ${p.script}

## Storyboard (${sb.targetDurationSeconds} s, YouTube Shorts)
| Beat | Time | On screen | Narration | Visual |
|---|---|---|---|---|
${sb.beats.map((b: any, i: number) => `| ${i + 1} ${b.purpose} | ${b.startSecond.toFixed(1)}–${b.endSecond.toFixed(1)} s | ${b.onScreenText} | ${b.narration} | ${b.visualDirection} |`).join("\n")}

Persistent disclosure on every frame: ${sb.persistentDisclosures.map((d: string) => `"${d}"`).join(", ")}. CTA: "${sb.finalCta}".

## Evidence
**Channel signals (YouTube):**

| Short | Theme | Views/day | Avg view % | Engaged share | Length |
|---|---|---|---|---|---|
${rows(p.evidence.channelSignals.map((s: any) => ({ ...s, title: s.title, durationSeconds: `${s.durationSeconds} s` })), ["title", "theme", "viewsPerDay", "averageViewPercentage", "engagedShare", "durationSeconds"])}

Theme medians: ${JSON.stringify(p.evidence.themeSummary)}

**Claims in the script** (editorial knowledge; to be fact-checked against a manual):
${p.evidence.claims.map((c: any) => `- ${c.proposition}. _${c.basis}_`).join("\n")}

**Claims the gates block:**
${p.evidence.riskyClaimsBlocked.map((c: any) => `- ${c.proposition}: ${c.why}`).join("\n")}

## Metrics that influenced the choice
| Metric | Source | Value | Used for |
|---|---|---|---|
${rows(p.metricsThatInfluencedTheChoice, ["metric", "source", "value", "usedFor"])}

Topic ranking: ${p.ranking.map((r: any) => `${r.topicId} (family match ${r.familyMatch ? "yes" : "no"}, editorial prior ${r.editorialPrior})`).join("; ")}.
Excluded as already covered: ${p.topicsExcluded.length ? p.topicsExcluded.map((e: any) => `${e.topicId} (${e.why})`).join("; ") : "none"}.

## Unknown
${p.unknown.length ? p.unknown.map((u: string) => `- ${u}`).join("\n") : "- nothing recorded as unknown"}

## Gates
**${p.gates.passed ? "All automated gates passed." : "Blocked: see the hard failures below."}**
${p.gates.findings.length ? p.gates.findings.map((f: any) => `- [${f.severity}] ${f.gate} · ${f.location}: ${f.message}`).join("\n") : "- no findings"}

## Human gates (unresolved)
${p.humanGates.mechanism.why}

${p.humanGates.gates.map((g: any) => `- **${g.gate}**: ${g.question}`).join("\n")}

## Silent preview
\`${p.preview.file}\` (sha256 \`${p.preview.sha256.slice(0, 16)}…\`), phone sheet \`${p.preview.phoneSheet}\`. Every frame is labelled "${p.preview.label}".
`;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runDailyProposal(process.argv.slice(2)).then((result) => {
    console.log(JSON.stringify(result.report, null, 2));
    if (result.exitCode === 1) console.error(`REFUSED: ${(result.report as { reason?: string }).reason}`);
    process.exitCode = result.exitCode;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
