#!/usr/bin/env tsx
// The final GPU-upgrade Short, from the SAVED Liam take, through the existing
// content pipeline. No provider is called here: a failed render is re-run from
// the same saved bytes, never re-generated.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/finalRender.ts [takeDir]
//
// WHAT RUNS
// 1. loadGpuUpgradeTake: the approved text, pinned Liam, the audio its
//    manifest hashes, and the provider's timestamps, or nothing renders.
// 2. retimeBeats + retimeConcept: each beat's picture and caption follow
//    Liam's actual delivery; the take itself is never edited.
// 3. The retimed concept is written as a batch and evaluated by the creative
//    workflow (MASTER #6 and #1's storyboard review, evidence, figure binding).
// 4. renderProposalOffline: the production plan and adapters, with the saved
//    take as narration and synthesized sound effects under it; the banded
//    frame check and its broken controls.
// 5. The mix is mastered in the compositor to FINAL_LOUDNESS (one constant
//    gain and a true-peak limiter), and measured: the encode's loudness and
//    true peak, and the voice-to-effects balance before and after mastering.
// 6. MASTER #7 reviews the exact MP4 and writes its review packet. Human gates
//    stay open; nothing is approved, scheduled or published.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderProposalOffline } from "../master6OfflineRender.ts";
import { masterChain, measureLoudness } from "../motionCompositor.ts";
import { evaluateAuthoredBatch } from "../v2/creative/fileWorkflowPass.ts";
import { buildCreativeProposalProductionPlan } from "../v2/creative/proposalPass.ts";
import { REQUIRED_USE, type AssetRightsRecord, type PresentedClaim, type RenderManifest, type ReviewSubmission } from "../v2/review/inputs.ts";
import { YOUTUBE_SHORTS_1080X1920_30 } from "../v2/review/platformVariants.ts";
import { formatReviewPacket, reviewCreative } from "../v2/review/reviewCreative.ts";
import { GPU_UPGRADE_PAIRING } from "./research.ts";
import { loadGpuUpgradeTake, narrationSegmentsFor, retimeBeats, retimeConcept, soundCuesFor, type LoadedGpuUpgradeTake } from "./takeTiming.ts";
import { gpuUpgradeMission, WORKFLOW_DIRECTORY } from "./workflowCli.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FINAL_CONCEPT = "boost-guess-the-game";
/** The saved take, checked in: the one paid generation, reused by every render. */
export const SAVED_TAKE_DIR = join(here, "take");
export const FINAL_DIR = resolve(here, "../../../render-output/gpu-upgrade-final");
/** The alternative with the composed background bed, kept beside the current cut for comparison. */
export const FINAL_MUSIC_DIR = resolve(here, "../../../render-output/gpu-upgrade-final-music");
/** The bed once mixed (before mastering): about 20 LU under the take's -24.1 LUFS, so comfortably beneath Liam. */
export const MUSIC_BED_LEVEL_LUFS_AS_MIXED = -44;
/** The beats the bed ducks under: the FPS figures and the percentage reveal. */
export const MUSIC_DUCK_BEATS = Object.freeze(["fps-aw", "fps-val", "percent"] as const);
const ffmpegPath = process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.SPECSMITH_FFPROBE_PATH ?? "ffprobe";

/** The authored batch, with Concept A retimed to the take and the other two unchanged. */
export function writeRetimedWorkflow(take: LoadedGpuUpgradeTake, outputDir: string) {
  const beats = retimeBeats(take.lineTimings);
  const source = join(WORKFLOW_DIRECTORY, "batches", "attempt-5");
  const target = join(outputDir, "workflow", "batches", "attempt-1");
  rmSync(join(outputDir, "workflow"), { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(source).sort()) {
    const concept = JSON.parse(readFileSync(join(source, file), "utf8"));
    writeFileSync(join(target, file), `${JSON.stringify(concept.conceptId === FINAL_CONCEPT ? retimeConcept(concept, beats) : concept, null, 2)}\n`);
  }
  return { beats, workflowDir: join(outputDir, "workflow") };
}

/** Loudness of a file (EBU R128 integrated, LUFS) and its sample peak (dBFS). */
export function loudness(path: string, filter = ""): { integratedLufs: number | null; peakDbfs: number | null } {
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-nostats", "-i", path, "-af", `${filter}${filter ? "," : ""}ebur128=peak=sample`, "-f", "null", "-"], { encoding: "utf8" });
  const text = `${result.stderr ?? ""}`;
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const integrated = summary.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/);
  const peak = summary.match(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/);
  const num = (match: RegExpMatchArray | null) => match && match[1] !== "-inf" ? Number(match[1]) : null;
  return { integratedLufs: num(integrated), peakDbfs: num(peak) };
}

/**
 * Every figure the cut presents, as the viewer meets it, for MASTER #7: the
 * FPS figures said and captioned, and the estimated percentages.
 */
export function presentedClaims(beats: readonly { readonly id: string }[]): PresentedClaim[] {
  const beatOf = (id: string) => beats.findIndex((beat) => beat.id === id);
  const fps = (beatIndex: number, where: PresentedClaim["where"], text: string, game: string, build: "A" | "B", value: number): PresentedClaim => ({
    claimId: `${where}-${game}-${build}-b${beatIndex}`, beatIndex, where, text, basis: "model-estimate",
    statement: { kind: "game-fps", pairing: GPU_UPGRADE_PAIRING, game, build, fps: value },
  });
  const percent = (beatIndex: number, where: PresentedClaim["where"], text: string, researchClaimId: string): PresentedClaim => ({
    claimId: `${where}-${researchClaimId}-b${beatIndex}`, beatIndex, where, text, basis: "research-claim", statement: { kind: "research", researchClaimId },
  });
  const aw = beatOf("fps-aw"), val = beatOf("fps-val"), pct = beatOf("percent");
  const claims: PresentedClaim[] = [
    // Each figure as the viewer meets it: "43 to 65" said, "43 → 65" captioned; one declaration per value.
    fps(aw, "narration", "43 to 65", "Alan Wake 2", "B", 43), fps(aw, "narration", "43 to 65", "Alan Wake 2", "A", 65),
    fps(aw, "caption", "43 → 65", "Alan Wake 2", "B", 43), fps(aw, "caption", "43 → 65", "Alan Wake 2", "A", 65),
    fps(val, "narration", "263 to 305", "Valorant", "B", 263), fps(val, "narration", "263 to 305", "Valorant", "A", 305),
    fps(val, "caption", "263 → 305", "Valorant", "B", 263), fps(val, "caption", "263 → 305", "Valorant", "A", 305),
    percent(pct, "narration", "estimated 51% boost", "gpu-upgrade-percent-gpu-heavy-game"),
    percent(pct, "narration", "16% for Valorant", "gpu-upgrade-percent-cpu-heavy-game"),
    percent(pct, "caption", "51%", "gpu-upgrade-percent-gpu-heavy-game"),
    percent(pct, "caption", "16%", "gpu-upgrade-percent-cpu-heavy-game"),
  ];
  return claims;
}

/** The final mix: about -16 LUFS integrated, true peak no higher than -1.5 dBTP, on the encode. */
export const FINAL_LOUDNESS = Object.freeze({ integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0.3 });

/**
 * How loud the bed is against the voice, measured on the files that were
 * mixed and through the same mastering chain: overall, and inside and outside
 * the duck windows (each measured on that stretch of the bed alone).
 */
export function musicMeasures(sfxDir: string, chain: string, voiceAfter: { integratedLufs: number | null }, ducks: readonly { startSecond: number; endSecond: number }[]) {
  const bedFile = readdirSync(sfxDir).find((file) => file.endsWith("__bed.wav"));
  if (!bedFile) throw new Error("No music bed was rendered.");
  const bedPath = join(sfxDir, bedFile);
  const asMixed = `volume=${SFX_MIX_GAIN},${chain}`;
  const whole = loudness(bedPath, asMixed);
  const firstDuck = ducks[0];
  const ducked = firstDuck ? loudness(bedPath, `atrim=${(firstDuck.startSecond + 0.5).toFixed(2)}:${(firstDuck.endSecond - 0.5).toFixed(2)},${asMixed}`) : null;
  const open = firstDuck ? loudness(bedPath, `atrim=1.6:${(firstDuck.startSecond - 0.5).toFixed(2)},${asMixed}`) : null;
  const under = (level: number | null | undefined) => voiceAfter.integratedLufs !== null && level !== null && level !== undefined ? Math.round((voiceAfter.integratedLufs - level) * 10) / 10 : null;
  return {
    bedFile, wholeAsMastered: whole,
    belowVoiceLu: under(whole.integratedLufs),
    openStretch: open, duckedStretch: ducked,
    duckDepthDb: open?.integratedLufs !== null && open?.integratedLufs !== undefined && ducked?.integratedLufs !== null && ducked?.integratedLufs !== undefined
      ? Math.round((open.integratedLufs - ducked.integratedLufs) * 10) / 10 : null,
  };
}

/** The compositor's fixed gain for the music-sfx track (motionCompositor.muxFinal). */
export const SFX_MIX_GAIN = 0.14;

/** The final cut from the saved take: loaded and verified, never generated. */
export async function renderFinal(takeDir = SAVED_TAKE_DIR, outputDir = FINAL_DIR, options: { readonly music?: boolean } = {}) {
  return renderFromLoadedTake(await loadGpuUpgradeTake(takeDir), outputDir, { music: options.music });
}

/**
 * The render itself, from a take that has already been loaded. `dryRun` is
 * only for proving the edit's mechanics before a take exists: its voice must
 * be a labelled local fixture, and every output says DRY RUN.
 */
export async function renderFromLoadedTake(take: LoadedGpuUpgradeTake, outputDir: string, options: { readonly dryRun?: boolean; readonly music?: boolean } = {}) {
  const dryRun = options.dryRun === true;
  if (dryRun !== (take.take.provider === "local-fixture")) throw new Error("A dry run uses a local fixture voice, and only a dry run may.");
  mkdirSync(outputDir, { recursive: true });
  const { beats, workflowDir } = writeRetimedWorkflow(take, outputDir);
  const soundEffects = soundCuesFor(beats);
  const musicBed = options.music ? {
    levelLufsAsMixed: MUSIC_BED_LEVEL_LUFS_AS_MIXED,
    ducks: beats.filter((beat) => (MUSIC_DUCK_BEATS as readonly string[]).includes(beat.id))
      .map((beat) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, reason: `${beat.id} figures on screen` })),
  } : undefined;
  const { mission, result } = gpuUpgradeMission();
  const renderDir = join(outputDir, "render");
  const { report, reportPath } = await renderProposalOffline(workflowDir, FINAL_CONCEPT, renderDir, {
    mission, narration: "saved-take", savedTake: take.take, narrationSegments: narrationSegmentsFor(beats), soundEffects, musicBed, loudness: FINAL_LOUDNESS,
  });

  // The mix. The compositor mastered it and recorded how (gain, limiter
  // ceiling); here the voice alone and the effects alone are put through that
  // same chain, so the balance between them is measured, not assumed: the
  // gain moves both equally, and the limiter, set well above the effects,
  // can only take a little off the voice's loudest peaks.
  const meta = report.video.metadata as Record<string, unknown>;
  const gainDb = Number(meta.masterGainDb), ceilingDbfs = Number(meta.limiterCeilingDbfs);
  if (!Number.isFinite(gainDb) || !Number.isFinite(ceilingDbfs)) throw new Error("The compositor recorded no mastering; refusing to call the mix mastered.");
  const chain = masterChain(gainDb, ceilingDbfs);
  const sfxFile = readdirSync(join(renderDir, "sfx")).find((file) => file.endsWith("__sfx.wav"));
  if (!sfxFile) throw new Error("No sound-effect track was rendered.");
  const sfxPath = join(renderDir, "sfx", sfxFile);
  const voiceBefore = loudness(take.take.audioPath), voiceAfter = loudness(take.take.audioPath, chain);
  const sfxBefore = loudness(sfxPath, `volume=${SFX_MIX_GAIN}`), sfxAfter = loudness(sfxPath, `volume=${SFX_MIX_GAIN},${chain}`);
  const gap = (voice: { integratedLufs: number | null; peakDbfs: number | null }, sfx: { peakDbfs: number | null }) => ({
    effectsPeakBelowVoicePeakDb: voice.peakDbfs !== null && sfx.peakDbfs !== null ? Math.round((voice.peakDbfs - sfx.peakDbfs) * 10) / 10 : null,
    effectsPeakAboveVoiceLoudnessDb: voice.integratedLufs !== null && sfx.peakDbfs !== null ? Math.round((sfx.peakDbfs - voice.integratedLufs) * 10) / 10 : null,
  });
  const final = await measureLoudness(process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg", report.video.path);
  const mix = {
    target: FINAL_LOUDNESS,
    final,
    meetsTarget: Math.abs(final.integratedLufs - FINAL_LOUDNESS.integratedLufs) <= FINAL_LOUDNESS.toleranceLu && final.truePeakDbtp <= FINAL_LOUDNESS.truePeakDbtp,
    mastering: Object.fromEntries(Object.entries(meta).filter(([key]) => /^(loudness|truePeak|mix|master|limiter|final|mastering)/.test(key))),
    before: { voice: voiceBefore, soundEffectsAsMixed: sfxBefore, ...gap(voiceBefore, sfxBefore) },
    after: { voice: voiceAfter, soundEffectsAsMixed: sfxAfter, ...gap(voiceAfter, sfxAfter) },
    cues: soundEffects,
    music: musicBed ? musicMeasures(join(renderDir, "sfx"), chain, voiceAfter, musicBed.ducks) : null,
  };

  // MASTER #7: review the exact MP4.
  const evaluation = await evaluateAuthoredBatch(workflowDir, mission);
  const proposal = evaluation.pass.result.proposals.find((entry) => entry.concept.conceptId === FINAL_CONCEPT)!;
  const plan = buildCreativeProposalProductionPlan({
    packageId: `master6-${FINAL_CONCEPT}`, ideaId: FINAL_CONCEPT, campaignId: mission.missionId,
    feature: "compare", route: mission.productDestination, subjectIds: [],
  }, proposal, { soundEffects, musicBed, loudness: FINAL_LOUDNESS }).platforms[0];
  const manifestPath = String(report.renderManifest);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RenderManifest;
  const storyboard = proposal.storyboard;
  const overlay = plan.tasks.find((task) => task.capability === "disclosure-overlay") as { disclosureOverlayState?: { lines: string[] } } | undefined;
  const claims = presentedClaims(beats);
  const repo = (assetId: string, kind: AssetRightsRecord["kind"], source: string, generator: string): AssetRightsRecord => ({
    assetId, kind, source,
    license: { kind: "repo-owned", evidence: "Rendered by this repository from its own data and code.", permittedUse: [REQUIRED_USE], attribution: null, expiresAt: null, scope: "SpecSmith" },
    generation: { generator, inputs: `retimed storyboard and production plan of ${FINAL_CONCEPT}` },
    transformations: ["placed into the banded layout by the ffmpeg compositor"],
    placeholder: { isPlaceholder: false, why: null },
  });
  const rights: AssetRightsRecord[] = manifest.assets.map((asset) => {
    switch (asset.role) {
      case "capture": return repo(asset.assetId, "repo-generated-graphic", "dataMotionGraphicRender.ts, values from the Compare model", "specsmith-data-motion-graphic (Chromium canvas)");
      case "disclosure-panel": return repo(asset.assetId, "disclosure-panel", "disclosureOverlay.ts, browser-measured", "disclosure-overlay (Chromium)");
      case "captions": return repo(asset.assetId, "caption-render", "captionRender.buildAssDocument", "caption-render (ASS)");
      case "sound-effect": return repo(asset.assetId, "sound-effect", "soundEffects.ts, synthesized from noise and sine tones", "ffmpeg lavfi");
      // The composed bed: how it was made is recorded; who owns it and whether
      // it is clear to publish is not decided by having synthesized it.
      case "music": return {
        assetId: asset.assetId, kind: "music",
        source: "Composed and synthesized in this repository: musicBed.ts (pad chords from sine partials, a soft eighth-note pulse, seeded filtered noise; no samples, no melody), mixed with the soundEffects.ts effects",
        license: { kind: "unknown", evidence: null, permittedUse: [], attribution: null, expiresAt: null, scope: null },
        generation: { generator: "musicBed.ts + soundEffects.ts (sample arithmetic and ffmpeg lavfi)", inputs: `generic progression ${String(asset.metadata.musicBed ?? "")}` },
        transformations: ["ducked under the figure beats, faded in and out", "mixed under the narration at the compositor's music gain", "mastered with the mix"],
        placeholder: { isPlaceholder: false, why: null },
      };
      case "narration": return {
        assetId: asset.assetId, kind: "narration",
        source: dryRun ? `DRY RUN fixture voice ${take.take.sha256}` : `ElevenLabs text-to-speech, voice Liam (${take.take.voiceId}), model ${take.take.modelId}; saved take ${take.take.sha256}`,
        // The commercial-use terms of the account are not recorded in this repository; a person confirms them.
        license: { kind: "unknown", evidence: null, permittedUse: [], attribution: null, expiresAt: null, scope: null },
        generation: { generator: dryRun ? "local fixture (dry run)" : "elevenlabs-text-to-speech-with-timestamps", inputs: `the approved script, provider text sha256 ${take.take.providerTextSha256}` },
        transformations: ["synthesized effects mixed under it at the compositor's music gain", "mastered with the effects to -16 LUFS: one constant gain and a true-peak limiter", "AAC encode"],
        placeholder: dryRun ? { isPlaceholder: true, why: "DRY RUN: a fixture voice stands in for the take to prove the edit's mechanics." } : { isPlaceholder: false, why: null },
      };
      default: throw new Error(`No rights record is written for ${asset.role} ${asset.assetId}; add one rather than letting it pass unrecorded.`);
    }
  });
  const submission: ReviewSubmission = {
    creativeId: `${mission.missionId}/${FINAL_CONCEPT}`,
    variant: YOUTUBE_SHORTS_1080X1920_30,
    research: { contract: mission.research, declaredKind: "production", evidenceSnapshotIds: result.snapshots.map((snapshot) => snapshot.snapshotId) },
    concept: { conceptId: FINAL_CONCEPT, body: proposal.concept },
    storyboard,
    title: storyboard.title,
    description: "One GPU upgrade, very different gains by game. Every figure is a SpecSmith model estimate. Check your own games at specsmithpc.com/compare.",
    approvedDestination: mission.productDestination,
    disclosureLines: overlay?.disclosureOverlayState?.lines ?? [],
    productionPlan: plan,
    claims,
    graphics: [],
    renderManifestPath: manifestPath,
    rights,
  };
  const packet = await reviewCreative(submission, { ffmpegPath, ffprobePath });
  const reviewDir = join(outputDir, "review");
  mkdirSync(reviewDir, { recursive: true });
  const packetJson = join(reviewDir, "review-packet.json");
  const packetText = join(reviewDir, "review-packet.txt");
  writeFileSync(packetJson, `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(packetText, `${formatReviewPacket(packet)}\n`);

  const finalMp4 = join(outputDir, "gpu-upgrade-final.mp4");
  copyFileSync(report.video.path, finalMp4);
  const summary = {
    label: dryRun
      ? "DRY RUN of the final edit with a FIXTURE voice. Not a take, not for review, not for publication."
      : musicBed
      ? "FINAL CUT, MUSIC ALTERNATIVE: the saved Liam take over a composed background bed. Reviewed by MASTER #7; human gates open. Not approved, not scheduled, not published."
      : "FINAL CUT, narrated by the saved Liam take. Reviewed by MASTER #7; human gates open. Not approved, not scheduled, not published.",
    video: { path: finalMp4, sha256: report.video.sha256, bytes: report.video.bytes },
    take: { manifest: take.manifestPath, audioSha256: take.take.sha256, providerTextSha256: take.take.providerTextSha256, scriptTextSha256: take.take.scriptTextSha256, providerReportedCharacterCost: take.providerReportedCharacterCost },
    beats: beats.map((beat) => ({ ...beat, caption: storyboard.beats[beat.index].onScreenText, narration: storyboard.beats[beat.index].narration })),
    mix,
    frameCheck: { ok: report.frameCheck.ok, samples: report.frameCheck.samples.length, failures: report.frameCheck.failures },
    controls: report.controls,
    reviewPacket: { json: packetJson, text: packetText, verdict: packet.verdict },
    renderReport: reportPath,
  };
  const summaryPath = join(outputDir, "final-report.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { summary, summaryPath, packet };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const music = process.argv.includes("--music");
  const takeArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  renderFinal(takeArg ? resolve(takeArg) : SAVED_TAKE_DIR, music ? FINAL_MUSIC_DIR : FINAL_DIR, { music }).then(({ summary, summaryPath }) => {
    console.log(summary.label);
    console.log(`video: ${summary.video.path}`);
    console.log(`sha256: ${summary.video.sha256}`);
    console.log(`frame check: ${summary.frameCheck.ok ? "passed" : "FAILED"} (${summary.frameCheck.samples} samples)`);
    for (const control of summary.controls) console.log(`control ${control.control}: ${control.refused ? "refused" : "NOT REFUSED"}`);
    console.log(`loudness: ${summary.mix.final.integratedLufs} LUFS, true peak ${summary.mix.final.truePeakDbtp} dBTP (target ${summary.mix.target.integratedLufs} LUFS, <= ${summary.mix.target.truePeakDbtp} dBTP): ${summary.mix.meetsTarget ? "met" : "NOT MET"}`);
    console.log(`balance: effects peak ${summary.mix.before.effectsPeakAboveVoiceLoudnessDb} dB vs voice loudness before, ${summary.mix.after.effectsPeakAboveVoiceLoudnessDb} dB after; effects peak ${summary.mix.before.effectsPeakBelowVoicePeakDb} / ${summary.mix.after.effectsPeakBelowVoicePeakDb} dB under the voice peak`);
    if (summary.mix.music) console.log(`music: ${JSON.stringify(summary.mix.music)}`);
    console.log(`review packet: ${summary.reviewPacket.verdict} (${summary.reviewPacket.text})`);
    console.log(`report: ${summaryPath}`);
    if (!summary.frameCheck.ok || summary.controls.some((control) => !control.refused) || !summary.mix.meetsTarget) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
