#!/usr/bin/env tsx
// The full visual draft of the recommended concept, through the production
// pipeline (master6OfflineRender.renderProposalOffline): the workflow's checks,
// the production plan, the production adapters (Compare capture, data motion
// graphics, disclosure panel, captions, compositor), the banded frame check and
// its broken controls. Narration is SILENT: the planned lines and timings are
// recorded beside a silent track. No voice of any kind, no spend, no publishing.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/draftRender.ts
//
// Needs the built app served at SPECSMITH_RENDER_BASE_URL (default
// http://localhost:5178) for the one Compare-capture beat.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderProposalOffline } from "../master6OfflineRender.ts";
import { gpuUpgradeMission, WORKFLOW_DIRECTORY } from "./workflowCli.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DRAFT_CONCEPT = "boost-guess-the-game";
export const DRAFT_DIR = resolve(here, "../../../render-output/next-video-gpu-upgrade-draft-2");

export async function renderDraft() {
  const { mission } = gpuUpgradeMission();
  return renderProposalOffline(WORKFLOW_DIRECTORY, DRAFT_CONCEPT, DRAFT_DIR, { mission, narration: "silent" });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderDraft().then(({ report, reportPath }) => {
    console.log(report.label);
    console.log(`video: ${report.video.path}`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`frame check: ${report.frameCheck.ok ? "passed" : "FAILED"} (${report.frameCheck.samples.length} samples)`);
    for (const failure of report.frameCheck.failures) console.log(`  - ${failure}`);
    for (const control of report.controls) console.log(`control ${control.control}: ${control.refused ? "refused" : "NOT REFUSED"}`);
    console.log(`report: ${join(reportPath)}`);
    if (!report.frameCheck.ok || report.controls.some((control) => !control.refused)) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
