// MASTER #8 offline demonstrations. No real account, provider, person or
// network is involved; every simulated event is labelled SIMULATED in the
// ledger, the reports and this script's output.
//
//   pnpm content:publish:demo [outputDir]
//
// SUCCESS DEMO (a labelled simulation store)
//   reviewed media (MASTER #7 packet on a fixture cut rendered by ffmpeg)
//   -> machine-reviewed, human review pending
//   -> SIMULATED trusted approval at the boundary (recording every condition
//      that would refuse it in production)
//   -> SIMULATED provider: the first answer is lost after the post was made,
//      the boundary reconciles instead of resending, a retry returns the same
//      post, then the provider confirms publication
//   -> SIMULATED provider observations at 24 hours (plus one seeded peer video
//      differing in one recorded variable, so a comparison exists)
//   -> learning report -> next brief through fileWorkflow.buildCreativeBrief
//
// REFUSAL DEMO (an isolated production store)
//   the same path, stopping where review or approval is missing: a copied
//   packet, the legacy score-based qc-passed write, authorization with no
//   trusted mechanism, a send with no authorization, and simulated numbers.
//
// Both write their reports under the output directory (default
// render-output/master8-demo, which is gitignored).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_MISSION } from "./creativeFileWorkflowCli.ts";
import {
  advanceStoredPublicationLedger,
  createStoredPublicationLedger,
  initPublicationStore,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import { PublicationLedgerError, type PublicationLedger } from "./publishing.ts";
import type { CreativeFingerprint } from "./types.ts";
import { HUMAN_GATES } from "./v2/review/humanGates.ts";
import { buildReviewFixture } from "./v2/review/reviewFixture.ts";
import { reviewCreative } from "./v2/review/reviewCreative.ts";
import { sha256Json } from "./v2/review/util.ts";
import {
  authorizePublication,
  buildProviderRequest,
  confirmProviderState,
  createSimulatedApprovalVerifier,
  loadAuthorization,
  PublicationBoundaryError,
  reconcileSubmission,
  recordMachineReview,
  seedSimulatedLedger,
  submitAuthorizedPublication,
  type PublicationDestination,
} from "./v2/publication/boundary.ts";
import { createSimulatedProvider } from "./v2/publication/simulatedProvider.ts";
import { importProviderObservations, ObservationRefusedError } from "./v2/publication/observations.ts";
import { buildLearningReport, formatLearningReport } from "./v2/publication/learningReport.ts";
import { nextBriefForWorkflow } from "./v2/publication/nextBrief.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const DESTINATION: PublicationDestination = { provider: "metricool", accountId: "SIMULATED-account", platform: "youtube-shorts" };

function fingerprint(creativeId: string, overrides: Partial<CreativeFingerprint> = {}): CreativeFingerprint {
  // The fixture creative's recorded variables, written once when its ledger is created.
  return {
    version: "creative-fingerprint-v1", creativeId, packageId: "review-fixture", campaignId: "SIMULATED-demo", ideaId: "leads-vs-average",
    platform: "youtube-shorts", format: "comparison", feature: "compare", subjectIds: ["rtx5060ti", "rtx4060ti"], hookFamily: "tally-question",
    hookText: "Ten games to seven, plus three ties.", visualWorld: "specsmith-compare-ui", narrativeEngine: "tally-then-average",
    targetDurationSeconds: 6, beatCount: 3, plannedBeatChangesPer10Seconds: 5, editDensity: "medium", captionedBeatRatio: 1,
    captionDensity: "medium", firstVisualType: "deterministic-ui", voiceName: "placeholder tones (fixture)", sfxDensity: "low",
    ctaFamily: "compare-on-specsmithpc", ctaTimingBucket: "late", hashtagStrategy: "intent-balanced-v1", hashtags: [],
    experimentId: "none", experimentPrimaryMetric: "retention", changedVariable: "none", contentFreshness: "evergreen", ...overrides,
  } as CreativeFingerprint;
}

const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);

async function refusal<T>(log: string[], step: string, action: () => Promise<T>): Promise<{ step: string; refused: boolean; code: string; reason: string }> {
  try {
    await action();
    log.push(`${step}: NOT REFUSED`);
    return { step, refused: false, code: "", reason: "" };
  } catch (error) {
    const code = error instanceof PublicationBoundaryError || error instanceof ObservationRefusedError ? error.code
      : error instanceof PublicationLedgerError ? "ledger-refused" : (error as { code?: string }).code ?? "error";
    log.push(`${step}: refused [${code}] ${(error as Error).message}`);
    return { step, refused: true, code, reason: (error as Error).message };
  }
}

export async function runMaster8Demos(outputDir: string) {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const fixture = await buildReviewFixture(join(outputDir, "fixture"));
  const submission = fixture.submission();
  const packet = await reviewCreative(submission);
  const t0 = new Date(Date.parse(packet.reviewedAt) + 1_000);

  // ---------------------------------------------------------------- success
  const successDir = join(outputDir, "success");
  const store = join(successDir, "SIMULATION-store");
  mkdirSync(store, { recursive: true });
  await initPublicationStore(store, "simulation", "MASTER #8 offline success demo: simulated approval, provider and observations");
  const log: string[] = ["MASTER #8 SUCCESS DEMO — every approval, provider answer and number below is SIMULATED.", ""];
  await createStoredPublicationLedger(store, fingerprint(packet.creativeId), t0);
  log.push(`1. MASTER #7 packet ${packet.packetId}: ${packet.verdict} (${packet.summary})`);

  await recordMachineReview({ storeRoot: store, packet, submission, now: minutes(t0, 1) });
  log.push("2. Ledger: machine-reviewed -> human-review-pending. Nothing is approved; nothing can be sent.");

  const verifier = createSimulatedApprovalVerifier();
  const authorized = await authorizePublication({
    storeRoot: store, packet, submission, destination: DESTINATION, verifier, simulationAcknowledgesFinalApprovalBlockers: true, now: minutes(t0, 2),
    decisionClaim: {
      simulatedReviewer: "demo-editor", decisionId: "SIMULATED-decision-1", decidedAt: minutes(t0, 2).toISOString(), outcome: "approved",
      gates: Object.fromEntries(HUMAN_GATES.map((gate) => [gate.gate, "approved"])), mediaSha256: packet.media.sha256, variantId: packet.platformVariantId,
      destination: DESTINATION, reviewPacketId: packet.packetId, reviewBindingsSha256: sha256Json(packet.bindings),
    },
  });
  log.push(`3. SIMULATED trusted approval -> publication-authorized. ${authorized.events.at(-1)!.note}`);

  const authorization = (await loadAuthorization(store, packet.creativeId))!;
  const request = buildProviderRequest({ authorization, submission, mediaUrl: `https://media.simulated.invalid/${authorization.mediaSha256}.mp4`,
    schedule: { localDateTime: "2026-10-05T18:00:00", timezone: "America/New_York" } });
  log.push(`4. Draft request built (idempotency key ${request.idempotencyKey}); building it sent nothing.`);

  const provider = createSimulatedProvider();
  provider.queue("timeout-after-create");
  const first = await submitAuthorizedPublication({ storeRoot: store, request, mediaPath: fixture.videoPath, provider, now: minutes(t0, 3) });
  log.push(`5. SIMULATED provider: first send -> ${first.kind}${"reason" in first ? ` (${first.reason})` : ""}.`);
  const blind = await refusal(log, "   Blind resend", () => submitAuthorizedPublication({ storeRoot: store, request, mediaPath: fixture.videoPath, provider, now: minutes(t0, 4) }));
  const reconciled = await reconcileSubmission({ storeRoot: store, creativeId: packet.creativeId, provider, now: minutes(t0, 5) });
  log.push(`6. Reconciled by asking the provider: ${reconciled.reason}`);
  const retried = await submitAuthorizedPublication({ storeRoot: store, request, mediaPath: fixture.videoPath, provider, now: minutes(t0, 6) });
  log.push(`7. Retry -> ${retried.kind}; posts held by the provider: ${provider.posts.length}; submissions received: ${provider.submissions.length}.`);
  provider.advance(provider.posts[0].providerPostId, "published");
  const confirmed = await confirmProviderState({ storeRoot: store, creativeId: packet.creativeId, provider, now: minutes(t0, 60) });
  log.push(`8. Provider confirms: ${confirmed.reason} (${confirmed.ledger.events.at(-1)!.providerUrl})`);

  // One peer, seeded and labelled, differing in one recorded variable, so the report has something comparable.
  await createStoredPublicationLedger(store, fingerprint("SIMULATED-peer-result-first", { hookFamily: "result-first", hookText: "B averages 2 FPS more." }), t0);
  await seedSimulatedLedger({ storeRoot: store, creativeId: "SIMULATED-peer-result-first", through: "published", providerPostId: "SIM-PEER-1",
    at: minutes(t0, 60), mediaSha256: "b".repeat(64), variantId: packet.platformVariantId, destination: DESTINATION, title: "peer", description: "peer" });
  const collectedAt = minutes(t0, 60 + 24 * 60).toISOString();
  const later = minutes(t0, 3 * 24 * 60);
  for (const [postId, metrics, curve] of [
    [provider.posts[0].providerPostId, { views: 2400, stayedToWatchRate: 0.58, averagePercentageViewed: 0.71, saves: 19, shares: "unavailable" },
      { seconds: [0, 1, 2, 3, 4, 5, 6], shareWatching: [1, 0.9, 0.81, 0.62, 0.58, 0.55, 0.52] }],
    ["SIM-PEER-1", { views: 2600, stayedToWatchRate: 0.41, averagePercentageViewed: 0.66, saves: "unavailable" }, "unavailable"],
  ] as const) {
    await importProviderObservations({ storeRoot: store, now: later, batch: {
      kind: "PROVIDER_OBSERVATIONS", provider: "metricool", source: { adapter: "SIMULATED provider", simulated: true }, platform: "youtube-shorts",
      accountId: DESTINATION.accountId, providerPostId: postId, collectedAt, metrics, retentionCurve: curve as never, raw: { note: "SIMULATED numbers for an offline demo" },
    } });
  }
  log.push("9. SIMULATED observations imported at 24 hours for the demo post and one seeded peer.");

  const report = await buildLearningReport({ storeRoot: store, now: later });
  const handoff = nextBriefForWorkflow(report.nextBrief, DEMO_MISSION);
  log.push(`10. Learning report ${report.reportId}; next brief ${handoff.brief.briefHash.slice(0, 12)}… built by fileWorkflow.buildCreativeBrief with ${handoff.brief.memoryObservations.length} evidence line(s).`);
  const ledger: PublicationLedger = (await loadStoredPublicationLedger(store, packet.creativeId))!;
  writeFileSync(join(successDir, "ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(join(successDir, "learning-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(successDir, "learning-report.txt"), `${formatLearningReport(report)}\n`);
  writeFileSync(join(successDir, "next-brief.json"), `${JSON.stringify({ evidence: handoff.evidence, proposedChange: handoff.proposedChange, constraints: handoff.constraints, brief: handoff.brief }, null, 2)}\n`);
  log.push("", "Ledger events:", ...ledger.events.map((event) => `  ${event.at}  ${event.status}${event.simulated ? "  [SIMULATED]" : ""}${event.providerPostId ? `  post ${event.providerPostId}` : ""}`));
  writeFileSync(join(successDir, "demo-log.txt"), `${log.join("\n")}\n`);

  // ---------------------------------------------------------------- refusal
  const refusalDir = join(outputDir, "refusal");
  const prod = join(refusalDir, "isolated-production-store");
  mkdirSync(prod, { recursive: true });
  const rlog: string[] = ["MASTER #8 REFUSAL DEMO — an isolated, temporary production store. Nothing real is touched.", ""];
  await createStoredPublicationLedger(prod, fingerprint(packet.creativeId), t0);
  const steps = [
    await refusal(rlog, "A. Legacy score-based qc-passed write", () => advanceStoredPublicationLedger(prod, packet.creativeId, { status: "qc-passed", note: "Passed automated review at 9.4/10." })),
    await refusal(rlog, "B. Record a copied review packet", () => recordMachineReview({ storeRoot: prod, packet: JSON.parse(JSON.stringify(packet)), submission })),
    await refusal(rlog, "C. Authorize before any review is recorded (production store)", () => authorizePublication({ storeRoot: prod, packet, submission, destination: DESTINATION, verifier,
      decisionClaim: { simulatedReviewer: "demo-editor" } })),
  ];
  await recordMachineReview({ storeRoot: prod, packet, submission, now: minutes(t0, 1) });
  rlog.push("D. The real packet is recorded: machine-reviewed -> human-review-pending (a true fact in this isolated store).");
  steps.push(
    await refusal(rlog, "E. Authorize with the simulated verifier", () => authorizePublication({ storeRoot: prod, packet, submission, destination: DESTINATION, verifier,
      decisionClaim: { simulatedReviewer: "demo-editor" }, now: minutes(t0, 2) })),
    await refusal(rlog, "F. Send a draft without authorization", () => submitAuthorizedPublication({ storeRoot: prod, request, mediaPath: fixture.videoPath,
      provider: { ...createSimulatedProvider(), simulated: false }, now: minutes(t0, 3) })),
    await refusal(rlog, "G. Import simulated numbers into production analytics", () => importProviderObservations({ storeRoot: prod, now: later, batch: {
      kind: "PROVIDER_OBSERVATIONS", provider: "metricool", source: { adapter: "SIMULATED provider", simulated: true }, platform: "youtube-shorts",
      accountId: DESTINATION.accountId, providerPostId: "SIM-POST-1", collectedAt, metrics: { views: 1 }, raw: {} } })),
  );
  const prodLedger = (await loadStoredPublicationLedger(prod, packet.creativeId))!;
  const prodReport = await buildLearningReport({ storeRoot: prod, now: later });
  rlog.push("", `Ledger stops at: ${prodLedger.events.at(-1)!.status} (${prodLedger.events.map((event) => event.status).join(" -> ")})`);
  rlog.push(`Learning report: ${prodReport.unknowns[0]}`);
  writeFileSync(join(refusalDir, "refusal-report.json"), `${JSON.stringify({ steps, ledger: prodLedger, learningUnknowns: prodReport.unknowns }, null, 2)}\n`);
  writeFileSync(join(refusalDir, "refusal-report.txt"), `${rlog.join("\n")}\n`);

  return { log, rlog, report, handoff, steps, blind, ledger, prodLedger };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const outputDir = resolve(process.argv[2] ?? join(here, "..", "..", "render-output", "master8-demo"));
  runMaster8Demos(outputDir).then(({ log, rlog, steps }) => {
    console.log(log.join("\n"));
    console.log(`\n${rlog.join("\n")}`);
    console.log(`\nReports: ${outputDir}`);
    if (steps.some((step) => !step.refused)) process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
