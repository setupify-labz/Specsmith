// MASTER #8: the already-published Shorts, walked through the learning loop.
//
//   pnpm exec tsx scripts/content-automator/publishedPostsCli.ts \
//     [--store <dir>] [--out <dir>] [--corrections <file.json>] [--dashboard <file.json>]
//
// post -> published-post report -> creative memory -> next brief. Uses a fresh
// temporary store unless --store is given; never touches a publication ledger,
// never publishes, never calls a provider.
//
//   --corrections  a JSON array of { platform, nativePostId, field, next, reason, suppliedBy }:
//                  completes or corrects a fact, keeping its history.
//   --dashboard    a JSON array of { suppliedBy, evidence: { platform, nativePostId, dashboard,
//                  readAt, sourceReference, values: [{ label, value, unit?, window? }] } }:
//                  numbers read off a dashboard, kept as EXPLORATORY, unverified context.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_MISSION } from "./creativeFileWorkflowCli.ts";
import { CreativeMemoryStore } from "./v2/creative/memoryStore.ts";
import {
  correctExternalPost,
  externalPostReport,
  formatExternalPostReport,
  recordDashboardEvidence,
  recordExternalPost,
} from "./v2/publication/externalPosts.ts";
import { nextBriefForWorkflow } from "./v2/publication/nextBrief.ts";
import { ACCESS_FINDINGS, OPENING_CHANGE, OPENING_MEASUREMENTS, PUBLISHED_POSTS } from "./v2/publication/publishedPosts.ts";

type CorrectionInput = Omit<Parameters<typeof correctExternalPost>[0], "storeRoot" | "now">;
type DashboardInput = Omit<Parameters<typeof recordDashboardEvidence>[0], "storeRoot" | "now">;

export async function runPublishedPosts(options: {
  readonly storeRoot: string;
  readonly outDir: string;
  readonly now: Date;
  readonly corrections?: readonly CorrectionInput[];
  readonly dashboard?: readonly DashboardInput[];
}) {
  const records = [];
  for (const post of PUBLISHED_POSTS) records.push(await recordExternalPost({ storeRoot: options.storeRoot, post, now: options.now }));
  for (const correction of options.corrections ?? []) await correctExternalPost({ ...correction, storeRoot: options.storeRoot, now: options.now });
  for (const entry of options.dashboard ?? []) await recordDashboardEvidence({ ...entry, storeRoot: options.storeRoot, now: options.now });

  // Creative memory: what each video did at its opening, with the outcome unknown.
  const memory = new CreativeMemoryStore(options.storeRoot);
  const entries = [
    memory.append({
      entryId: "published-ram-fit-opening-v1", conceptId: "ram-fit@saved-take-pr172",
      decision: { kind: "hook-form", value: "claim caption on frame one over a full-frame part close-up" },
      outcome: { state: "unknown", reason: "No trusted metric is stored for any of the RAM-fit Short's three posts." },
      evidenceStrength: "insufficient", synthetic: false, now: options.now,
      note: "Published via Metricool (status PUBLISHED, connector-reported): YouTube cSDhjFC-CI8, TikTok 7693352089078058271, Instagram DeIi5pZDWew. Opening measured from the uploaded copy.",
    }),
    memory.append({
      entryId: "published-fps-20-wins-opening-v1", conceptId: "fps-20-wins@ce47598",
      decision: { kind: "hook-form", value: "claim on a miniature desk monitor, caption from 0.08 s, 1.3 s push into the screen" },
      outcome: { state: "unknown", reason: "No trusted metric is stored for any of the FPS Short's three posts." },
      evidenceStrength: "insufficient", synthetic: false, now: options.now,
      note: "Published via Metricool (status PUBLISHED, connector-reported): YouTube 648FsZLefnc, TikTok 7693587971584429343, Instagram DeKLo_0kw7C. Opening measured from the uploaded copy.",
    }),
  ];

  const report = await externalPostReport({
    storeRoot: options.storeRoot, now: options.now,
    measurements: OPENING_MEASUREMENTS, recommendation: OPENING_CHANGE, accessFindings: ACCESS_FINDINGS,
  });
  // The next brief enters the normal creative workflow through the same door as
  // the learning report. DEMO_MISSION is the engineering mission; a production
  // brief needs MASTER #2 research for the next topic.
  const handoff = nextBriefForWorkflow(report.nextBrief, DEMO_MISSION);

  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, "published-posts-report.txt"), `${formatExternalPostReport(report)}\n`);
  writeFileSync(join(options.outDir, "published-posts-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(options.outDir, "published-posts-next-brief.json"), `${JSON.stringify({
    note: "Built by nextBriefForWorkflow from the published-post report. The mission is the engineering fixture; the evidence lines are real.",
    evidence: handoff.evidence, constraints: handoff.constraints, memoryObservations: handoff.brief.memoryObservations,
    briefHash: handoff.brief.briefHash, missionId: handoff.brief.missionId,
  }, null, 2)}\n`);
  return { records, entries, report, handoff };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  const json = (name: string) => { const file = arg(name); return file ? JSON.parse(readFileSync(file, "utf8")) : undefined; };
  const storeRoot = arg("--store") ?? mkdtempSync(join(tmpdir(), "published-posts-"));
  const outDir = arg("--out") ?? join(fileURLToPath(new URL(".", import.meta.url)), "v2", "publication", "examples");
  const { report, handoff } = await runPublishedPosts({ storeRoot, outDir, now: new Date(), corrections: json("--corrections"), dashboard: json("--dashboard") });
  console.log(formatExternalPostReport(report));
  console.log(`\nNext brief ${handoff.brief.briefHash.slice(0, 12)}… with ${handoff.brief.memoryObservations.length} evidence line(s). Store: ${storeRoot}. Outputs: ${outDir}`);
}
