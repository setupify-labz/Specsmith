#!/usr/bin/env tsx
// The daily Short proposal job. Run by hand, once a day:
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/dailyShortProposal/run.ts \
//     --snapshot scripts/content-automator/dailyShortProposal/snapshots/<date>.json [--out <dir>] [--max-age-hours 36]
//     [--topic <topic id>]   an operator's choice instead of the data's pick (recorded as such)
//
// It reads one channel-metrics snapshot (collected through the Metricool and
// vidIQ connectors, see README.md), proposes ONE beginner PC troubleshooting
// Short that it can render, renders that Short's animated cut from the
// proposal's template, checks the exported files, and writes everything a
// person needs to review into one folder:
//   PROPOSAL.md       evidence, frame-one hook, script, storyboard, metrics that
//                     influenced the choice, unknowns, gate results, render
//                     verification, human gates
//   proposal.json     the same, machine-readable
//   <id>-silent.mp4   the finished animated cut, silent (the deliverable)
//   <id>-sfx.mp4      the same picture with its synced sound effects (no voice)
//   beats-phone.png, phone-every-0.25s.png   exported frames at phone size
//   verification.json checks on the exported files: size, length, frame count,
//                     distinct beats, every sound cue, silence between cues
//   run-report.json   stage timings, spend, exit status, snapshot hash
//
// It calls no paid provider, generates no voice, schedules nothing and
// publishes nothing: none of those modules is imported (a test checks).
// Exit codes: 0 proposal and cut rendered, awaiting fact-check and human review
// (status "awaiting-fact-check": nothing here can verify a source); 2 written but an
// automated gate or a render check blocked it (nothing is rendered when a gate
// blocks); 1 refused (missing or stale snapshot, unavailable source or
// renderer, no producible topic left: nothing usable was produced).

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRendererAvailable, renderAndVerify, TEMPLATES, type Verification } from "./animations.ts";
import { buildStoryboard, humanGatesUnresolved, runGates } from "./proposal.ts";
import { selectTopic } from "./select.ts";
import { DailyProposalError, loadSnapshot } from "./snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_ROOT = resolve(here, "../../../render-output/daily-proposals");

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export const RUN_LOCK = ".daily-proposal.lock";
/**
 * The run folder must be new or empty. Nothing is ever deleted: a file's name does not prove this job wrote
 * it, so a reused folder is refused rather than cleared (no earlier MP4 can sit beside a new proposal). The
 * folder is then claimed with an exclusively created lock file, so two runs that both found it empty cannot
 * both render into it; the loser is refused. Returns the lock's path, removed when the run ends.
 */
export async function prepareOutDir(outDir: string): Promise<string> {
  let entries: string[] = [];
  try { entries = await readdir(outDir); } catch { /* does not exist yet */ }
  if (entries.length) throw new DailyProposalError("output-not-empty", `${outDir} is not empty (${entries.slice(0, 5).join(", ")}${entries.length > 5 ? ", …" : ""}); choose a new or empty --out folder. Nothing was deleted.`);
  await mkdir(outDir, { recursive: true });
  const lock = join(outDir, RUN_LOCK);
  try {
    await writeFile(lock, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DailyProposalError("output-not-empty", `Another run has claimed ${outDir}; choose a new --out folder. Nothing was deleted.`);
    throw error;
  }
  const after = (await readdir(outDir)).filter((name) => name !== RUN_LOCK);
  if (after.length) { await rm(lock, { force: true }); throw new DailyProposalError("output-not-empty", `${outDir} filled while it was being claimed (${after.slice(0, 5).join(", ")}); choose a new --out folder. Nothing was deleted.`); }
  return lock;
}

export interface RunResult { readonly exitCode: 0 | 1 | 2; readonly outDir?: string; readonly report: Record<string, unknown> }

export async function runDailyProposal(argv: readonly string[], now = new Date()): Promise<RunResult> {
  const started = performance.now();
  const stages: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    try { return await fn(); } finally { stages[name] = Math.round(performance.now() - t0); }
  };
  const spend = { elevenLabs: "not called (no voice)", publishing: "not called", scheduling: "not called", metricool: "not called by the job (snapshot input)", vidiq: "not called by the job (snapshot input)" };
  let lock: string | undefined;
  try {
    const maxAgeArg = arg("--max-age-hours", argv);
    const maxAgeHours = maxAgeArg === undefined ? undefined : Number(maxAgeArg);
    // A typo must not switch off the stale-snapshot check: NaN or Infinity would never compare as too old.
    if (maxAgeHours !== undefined && !(Number.isFinite(maxAgeHours) && maxAgeHours >= 0)) throw new DailyProposalError("bad-argument", `--max-age-hours must be a finite number of hours, 0 or more (got "${maxAgeArg}").`);
    const { snapshot, bytes } = await time("load-and-validate-snapshot", () => loadSnapshot(arg("--snapshot", argv), now, maxAgeHours));
    await time("check-renderer", () => assertRendererAvailable());
    const selection = await time("select-topic", () => selectTopic(snapshot, { topicId: arg("--topic", argv) }));
    const template = TEMPLATES[selection.topic.animation!];
    const storyboard = buildStoryboard(selection.topic, selection.targetSeconds);
    const gates = await time("run-gates", () => runGates(storyboard, selection.topic, now));
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const outDir = resolve(arg("--out", argv) ?? join(DEFAULT_OUT_ROOT, `${stamp}-${selection.topic.id}`));
    lock = await prepareOutDir(outDir);
    let cut: { silent: string; sfx: string; silentSha256: string; sfxSha256: string } | undefined;
    let verification: Verification | undefined;
    if (gates.passed) {
      const result = await time("render-and-verify", () => renderAndVerify(template, outDir));
      verification = result.verification;
      if (result.files) {
        // Name the outputs after the template, so a folder never holds two cuts' files under one name.
        const silent = join(outDir, `${template.id}-silent.mp4`), sfx = join(outDir, `${template.id}-sfx.mp4`);
        if (result.files.silentPath !== silent) await rename(result.files.silentPath, silent);
        if (result.files.sfxPath !== sfx) await rename(result.files.sfxPath, sfx);
        const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
        cut = { silent: basename(silent), sfx: basename(sfx), silentSha256: await sha(silent), sfxSha256: await sha(sfx) };
      }
      await writeFile(join(outDir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
    }
    const passed = gates.passed && verification?.passed === true;
    // Never "ready": no claim is verified until a person reads its source, so a clean run is a draft awaiting that.
    const status = !gates.passed ? "blocked-by-gate" : passed ? "awaiting-fact-check" : "blocked-by-render-check";
    const proposal = {
      kind: "daily-short-proposal", version: "daily-short-proposal-v2", generatedAt: now.toISOString(), status,
      notPublished: true, noVoiceGenerated: true, notScheduled: true,
      snapshot: { brand: snapshot.brand, youtubeChannelId: snapshot.sources.youtube.channelId, collectedAt: snapshot.collectedAt, collectedBy: snapshot.collectedBy, sha256: createHash("sha256").update(bytes).digest("hex"), cost: snapshot.cost ?? "unknown" },
      topic: { id: selection.topic.id, family: selection.topic.family, symptom: selection.topic.symptom, title: selection.topic.title, animation: template.id, chosenBy: selection.chosenBy, dataPick: selection.dataPick },
      hook: { frameOne: selection.topic.hook },
      script: storyboard.beats.map((b) => b.narration).join(" "),
      storyboard,
      storyBeats: template.beats.map((b) => ({ storyBeat: b.storyBeat, from: b.from, to: b.to })),
      onScreenLabels: template.labels,
      soundCues: template.cues,
      evidence: {
        channelSignals: selection.signals, themeSummary: selection.themeSummary,
        claims: selection.topic.claims, riskyClaimsBlocked: selection.topic.riskyClaims, sources: template.sources,
      },
      metricsThatInfluencedTheChoice: selection.influences,
      unknown: selection.unknowns,
      topicsExcluded: selection.excluded, ranking: selection.ranking,
      gates: { passed: gates.passed, findings: gates.findings },
      factCheckRequired: gates.factCheck,
      // Only a cut that passed every render check is presented as one; anything else is labelled unverified.
      animatedCut: cut && verification?.passed ? { ...cut, durationSeconds: template.durationSeconds, fps: template.fps, disclosures: template.disclosures }
        : { notRendered: !gates.passed ? "an automated gate blocked the proposal" : cut ? `the render check failed: ${cut.silent} and ${cut.sfx} are unverified and are not a finished cut (see verification)` : "the render failed (see verification)" },
      verification: verification ?? null,
      humanGates: humanGatesUnresolved(),
    };
    await writeFile(join(outDir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`);
    await writeFile(join(outDir, "PROPOSAL.md"), proposalMarkdown(proposal));
    // The files actually in the folder (the report and proposal are added below), not a list of what should be there.
    const files = [...(await readdir(outDir)).filter((name) => name !== RUN_LOCK), "run-report.json"].sort();
    const report = { status, exitCode: passed ? 0 : 2, outDir, files, totalMs: Math.round(performance.now() - started), stagesMs: stages, spend, snapshotCost: snapshot.cost ?? "unknown" };
    await writeFile(join(outDir, "run-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: passed ? 0 : 2, outDir, report };
  } catch (error) {
    if (error instanceof DailyProposalError) {
      return { exitCode: 1, report: { status: "refused", code: error.code, reason: error.message, totalMs: Math.round(performance.now() - started), stagesMs: stages, spend } };
    }
    throw error;
  } finally {
    if (lock) await rm(lock, { force: true });
  }
}

type Proposal = Record<string, any>;
function proposalMarkdown(p: Proposal): string {
  const sb = p.storyboard;
  const rows = (items: any[], cols: string[]) => items.map((it) => `| ${cols.map((c) => String(it[c] ?? "").replace(/\|/g, "/")).join(" | ")} |`).join("\n");
  return `# Daily Short proposal: ${p.topic.title}

**Status: ${p.status}.** Not published, not scheduled, no voice generated. Every human gate below is unresolved, and no claim is verified until a person reads its source.

Topic chosen by **${p.topic.chosenBy === "operator" ? `the operator (--topic), not the data; the data's own pick was ${p.topic.dataPick}` : "the data"}**. Animation template: \`${p.topic.animation}\`. The storyboard below is the cut's own beats, captions and labels at its exact timing.

Generated ${p.generatedAt} from the snapshot of **${p.snapshot.brand}** (YouTube channel \`${p.snapshot.youtubeChannelId}\`) collected ${p.snapshot.collectedAt} (sha256 \`${p.snapshot.sha256.slice(0, 16)}…\`).

## Frame-one hook
> **${p.hook.frameOne}**

## Script (burned-in captions; not voiced)
> ${p.script}

## Storyboard (${sb.targetDurationSeconds} s, YouTube Shorts)
| Beat | Time | On screen | Narration | Visual |
|---|---|---|---|---|
${sb.beats.map((b: any, i: number) => `| ${i + 1} ${b.purpose} | ${b.startSecond.toFixed(2)}–${b.endSecond.toFixed(2)} s | ${b.onScreenText} | ${b.narration} | ${b.visualDirection} |`).join("\n")}

Persistent disclosure on every frame: ${sb.persistentDisclosures.map((d: string) => `"${d}"`).join(", ")}. CTA: "${sb.finalCta}".

## Evidence
**Channel signals (YouTube):**

| Short | Theme | Views/day | Avg view % | Engaged share | Length |
|---|---|---|---|---|---|
${rows(p.evidence.channelSignals.map((s: any) => ({ ...s, title: s.title, durationSeconds: `${s.durationSeconds} s` })), ["title", "theme", "viewsPerDay", "averageViewPercentage", "engagedShare", "durationSeconds"])}

Theme medians: ${JSON.stringify(p.evidence.themeSummary)}

**Claims in the script** (each with its basis; the factual-takeaway gate re-checks them):
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
**${p.gates.passed ? "No blocking findings (risky claims, slop, forbidden claims, reading speed). This does not verify any claim: see the fact-check list." : "Blocked: see the hard failures below."}**
${p.gates.findings.length ? p.gates.findings.map((f: any) => `- [${f.severity}] ${f.gate} · ${f.location}: ${f.message}`).join("\n") : "- no findings"}

## Fact check required (no claim is verified yet)
Each line below rests on a claim no person has yet read against its source. The cut is a draft until they do.

${p.factCheckRequired.length ? p.factCheckRequired.map((f: any) => `- **${f.location}** "${f.line}": ${f.claimIds.join(", ") || "(claim not matched)"}\n${f.bases.map((b: string) => `  - ${b}`).join("\n")}`).join("\n") : "- No line matched a listed claim. The claims below still need checking."}

## Animated cut
${p.animatedCut.notRendered ? `Not rendered: ${p.animatedCut.notRendered}.` : `- **\`${p.animatedCut.silent}\`**: the finished cut, silent (sha256 \`${p.animatedCut.silentSha256.slice(0, 16)}…\`).
- \`${p.animatedCut.sfx}\`: the same picture with synced sound effects, no voice (sha256 \`${p.animatedCut.sfxSha256.slice(0, 16)}…\`).
- \`beats-phone.png\`: the middle frame of every beat at phone size; \`phone-every-0.25s.png\`: every quarter second.
- ${p.animatedCut.durationSeconds} s at ${p.animatedCut.fps} fps, 1080x1920. Every frame carries ${p.animatedCut.disclosures.map((d: string) => `"${d}"`).join(" / ")}.`}

**On-screen labels, as drawn:** ${p.onScreenLabels.map((l: any) => `${l.text} (${l.from.toFixed(2)}–${l.to.toFixed(2)} s)`).join("; ")}.

**Sound cues:** ${p.soundCues.map((c: any) => `${c.at.toFixed(2)} s ${c.kind}: ${c.reason}`).join("; ")}.

**Sources:** ${p.evidence.sources.join("; ")}.

## Render verification (checks on the exported files)
${p.verification ? `**${p.verification.passed ? "All checks passed." : "FAILED: see below."}**

| Check | Result | Detail |
|---|---|---|
${p.verification.checks.map((c: any) => `| ${c.check} | ${c.passed ? "pass" : "FAIL"} | ${String(c.detail).replace(/\|/g, "/")} |`).join("\n")}

| Cue | At | Measured peak |
|---|---|---|
${p.verification.cuePeaks.map((c: any) => `| ${c.kind} | ${c.at.toFixed(2)} s | ${c.peakDbfs.toFixed(1)} dBFS |`).join("\n")}

Measured peaks are after the AAC encode; they are not loudness-normalized, so a narration mastered to -16 LUFS sits above them.` : "Not run: nothing was rendered."}

## Human gates (unresolved)
${p.humanGates.mechanism.why}

${p.humanGates.gates.map((g: any) => `- **${g.gate}**: ${g.question}`).join("\n")}
`;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runDailyProposal(process.argv.slice(2)).then((result) => {
    console.log(JSON.stringify(result.report, null, 2));
    if (result.exitCode === 1) console.error(`REFUSED: ${(result.report as { reason?: string }).reason}`);
    process.exitCode = result.exitCode;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
