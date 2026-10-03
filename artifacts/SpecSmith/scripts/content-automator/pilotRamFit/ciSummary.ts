#!/usr/bin/env tsx
// Prints the final render's report as GitHub Actions notices, so the result
// can be read from the run's check annotations (artifact downloads are not
// always reachable). It prints only what the report already holds: timings,
// hashes, levels and checks. No credential is read or printed.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface Report {
  label: string;
  video: { sha256: string; bytes: number; durationSeconds: number };
  take: { voiceId: string; voiceUsed: string; modelId: string; audioSha256: string; providerReportedCharacterCost: number | null; lineTimings: { id: string; start: number; end: number }[] } | null;
  timing: { events: Record<string, number>; adjustments?: string[] };
  scenes: { id: string; startSecond: number; endSecond: number }[];
  captions: { text: string; start: number; end: number }[];
  builderCard: { route: string; shownText: string };
  master1StoryboardReview: { recommendedFixes: unknown[] };
  visualHonesty: { findings: unknown[] };
  renderChecks: { decodeErrors: string[]; black: unknown[]; frozen: unknown[]; mix: Record<string, unknown> & { findings?: string[] } };
}

/** One notice per line; GitHub keeps annotations short, so each stays focused. */
export function summaryLines(report: Report): string[] {
  const lines = [
    report.label,
    `video ${report.video.durationSeconds.toFixed(2)} s, ${report.video.bytes} bytes, sha256 ${report.video.sha256}`,
    report.take
      ? `take: ${report.take.voiceUsed} (${report.take.voiceId}), model ${report.take.modelId}, audio sha256 ${report.take.audioSha256}, provider charge ${report.take.providerReportedCharacterCost ?? "not reported"} characters`
      : "take: none (draft)",
    ...(report.take?.lineTimings ?? []).map((line) => `take line ${line.id}: ${line.start.toFixed(3)}-${line.end.toFixed(3)} s`),
    `events: ${JSON.stringify(report.timing.events)}`,
    ...(report.timing.adjustments ?? []).map((note) => `timing adjustment: ${note}`),
    `shots: ${report.scenes.map((scene) => `${scene.id} ${scene.startSecond.toFixed(2)}-${scene.endSecond.toFixed(2)}`).join(", ")}`,
    `captions: ${report.captions.map((cue) => `${cue.start.toFixed(2)} "${cue.text}"`).join(" | ")}`,
    `builder card (${report.builderCard.route}): ${report.builderCard.shownText}`,
    `checks: storyboard fixes ${report.master1StoryboardReview.recommendedFixes.length}, visual-honesty findings ${report.visualHonesty.findings.length}, decode errors ${report.renderChecks.decodeErrors.length}, black ${report.renderChecks.black.length}, frozen ${report.renderChecks.frozen.length}`,
    `mix: ${JSON.stringify({ ...report.renderChecks.mix, findings: undefined })}`,
    ...(report.renderChecks.mix.findings ?? []).map((finding) => `MIX FINDING: ${finding}`),
  ];
  // Annotations treat newlines and % specially; keep each notice one plain line.
  return lines.map((line) => line.replace(/%/g, "%25").replace(/\r?\n/g, " "));
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: ciSummary.ts <report.json>");
    process.exitCode = 1;
  } else {
    readFile(path, "utf8").then((raw) => {
      for (const line of summaryLines(JSON.parse(raw) as Report)) console.log(`::notice title=RAM-fit render::${line}`);
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
