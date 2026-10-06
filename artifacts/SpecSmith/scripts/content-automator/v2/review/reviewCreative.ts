// MASTER #7: review one exact creative in one exact platform cut.
//
// reviewCreative is the only way to obtain a ReviewPacket. Packets are frozen
// and issued through a module-private WeakSet, so a packet built by hand,
// spread, or read back from JSON is not a packet: requestFinalApproval and
// revalidateReviewPacket refuse it. The JSON written for editors is a report of
// a packet, not a credential.
//
// WHAT RUNS (and what each step reuses)
// -------------------------------------
//   research.provenance  #2 contractDeclaresSynthetic: synthetic stays synthetic
//   claims.research      #2 checkScriptAgainstResearchStrict (the fail-closed gate) on the storyboard
//   storyboard.quality   #1 reviewCreativeQuality: any recommended fix blocks; the score is not used
//   media.*              #166 verifyRenderedMedia, then ffprobe/ffmpeg on those bytes
//   frames.bands         #168 checkBandedFrames, fed from the render manifest
//   captures.current     #169 Compare averages and tie count, recomputed from today's model
//   claims.* graphics.*  new: every figure recomputed from the model and checked against its screen
//   rights.*             new: every asset in the manifest
//   human gates          recorded, never closed (no trusted approval record exists)
//
// Every input the packet depends on is hashed into `bindings`. A change to one
// of them invalidates exactly the checks and gates that depend on it
// (planRechecks), and nothing else.

import { readFileSync } from "node:fs";

import { captionCuesForScript } from "../../productionPlan.ts";
import { checkBandedFrames, type BandedFrameExpectation, type BandedFrameReport } from "../../bandedFrameCheck.ts";
import { MIN_DISCLOSURE_CONTRAST, MIN_DISCLOSURE_FONT_PX } from "../../uiRender/disclosureOverlay.ts";
import { modelSnapshotSha256 } from "../../modelSnapshot.ts";
import { reviewCreativeQuality } from "../creativeQualityReview.ts";
import { isVerifiedMedia, MediaVerificationError, recheckMedia, verifyRenderedMedia, type VerifiedMedia } from "../mediaVerification.ts";
import { contractDeclaresSynthetic } from "../research/creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "../research/strictEvidenceGate.ts";
import { checkCapturesCurrent, checkClaims, checkGraphics, type BeatCapture } from "./claimChecks.ts";
import { APPROVAL_MECHANISM, evaluateHumanGates, HUMAN_GATES } from "./humanGates.ts";
import { RENDER_MANIFEST_VERSION, type RenderManifest, type ReviewSubmission } from "./inputs.ts";
import {
  assertMediaTools, audioLevels, blackIntervals, decodeErrors, freezeIntervals, MediaToolMissingError, probe, soundIntervals,
  type MediaTools, type ProbeResult,
} from "./mediaInspection.ts";
import { checkRights, placeholderEvidence } from "./rightsChecks.ts";
import {
  CHECK_USES, CHECKS, REVIEW_PACKET_VERSION,
  type BindingKey, type CheckId, type CheckRecord, type FindingSeverity, type HumanGateId, type HumanGateRecord,
  type ReviewFinding, type ReviewPacket, type ReviewVerdict,
} from "./types.ts";
import { narrationText, normalizeText, pairingFromRoute, parseAssCues, sha256File, sha256Json, sha256Text, type ParsedCue } from "./util.ts";

/** The shortest silence mediaInspection.soundIntervals detects (silencedetect d=0.25). */
const SILENCE_MIN_SECONDS = 0.25;

/**
 * Placed narration lines as the silence detector can see them. silencedetect
 * resolves silences of SILENCE_MIN_SECONDS or longer (plus 0.2 s of tolerance
 * either side), so two lines closer than that cannot show a measurable gap and
 * are one span; a sound outside every span is still refused.
 */
export function narrationSpans(segments: readonly { readonly startSecond: number; readonly endSecond: number }[]): { startSecond: number; endSecond: number }[] {
  const spans: { startSecond: number; endSecond: number }[] = [];
  for (const segment of [...segments].sort((a, b) => a.startSecond - b.startSecond)) {
    const last = spans.at(-1);
    if (last && segment.startSecond - last.endSecond <= SILENCE_MIN_SECONDS + 0.4) last.endSecond = Math.max(last.endSecond, segment.endSecond);
    else spans.push({ startSecond: segment.startSecond, endSecond: segment.endSecond });
  }
  return spans;
}

/** A production plan's caption cues, when it carries a caption task with structured cues. */
export function plannedCaptionCues(plan: unknown): { startSecond: number; endSecond: number; text: string }[] | null {
  const platforms = (plan as { platforms?: unknown[] } | null)?.platforms;
  const platform = (Array.isArray(platforms) ? platforms[0] : plan) as { tasks?: { capability?: string; captionRenderState?: { cues?: unknown } }[] } | null;
  const cues = platform?.tasks?.find((task) => task.capability === "caption-render")?.captionRenderState?.cues;
  if (!Array.isArray(cues)) return null;
  return cues.every((cue) => cue && typeof cue.text === "string" && Number.isFinite(cue.startSecond) && Number.isFinite(cue.endSecond)) ? cues : null;
}

export class ReviewPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPacketError";
  }
}

const ISSUED = new WeakSet<object>();
interface PacketState {
  readonly media: VerifiedMedia | null;
  /** What the review measured from files, so bindings can be recomputed for a changed submission. */
  readonly observed: ObservedInputs;
  readonly manifestPath: string;
  readonly manifestSha256: string | null;
  readonly files: readonly { readonly assetId: string; readonly role: string; readonly path: string; readonly sha256: string | null }[];
}
const STATE = new WeakMap<object, PacketState>();

const SEVERITY_ORDER: Record<FindingSeverity, number> = { "blocking": 0, "needs-person": 1, "blocks-final-approval": 2, "advisory": 3 };

export const VERDICT_MEANING: Record<ReviewVerdict, string> = {
  "blocked": "Not ready. Fix every blocking finding, then review the new cut; nothing here has been approved.",
  "awaiting-human-review": "No machine-found defect in this exact cut. People must still decide every open gate; this is not an approval, and the cut may not be published or scheduled.",
  "eligible-to-request-final-approval": "Every check and human gate passed for these exact bytes. Someone may ask for final approval; it is not approved, scheduled or publishable until that happens.",
};

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

/**
 * The verdict, from findings and gates alone. A score never enters it.
 *
 * Eligibility needs every gate closed by a trusted decision; a gate record can
 * only be "open" or "rejected" here, because no trusted approval exists.
 */
export function verdictFor(findings: readonly ReviewFinding[], gates: readonly HumanGateRecord[]): ReviewVerdict {
  if (findings.some((entry) => entry.severity === "blocking") || gates.some((gate) => gate.status === "rejected")) return "blocked";
  const gatesClosed = gates.length === HUMAN_GATES.length && gates.every((gate) => (gate.status as string) === "closed-by-trusted-decision");
  if (!gatesClosed || findings.some((entry) => entry.severity === "needs-person" || entry.severity === "blocks-final-approval")) {
    return "awaiting-human-review";
  }
  return "eligible-to-request-final-approval";
}

function summaryFor(verdict: ReviewVerdict, findings: readonly ReviewFinding[], gates: readonly HumanGateRecord[]): string {
  const count = (severity: FindingSeverity) => findings.filter((entry) => entry.severity === severity).length;
  const owners = [...new Set(findings.filter((entry) => entry.severity === "blocking").map((entry) => entry.owner))];
  const open = gates.filter((gate) => gate.status === "open").length;
  if (verdict === "blocked") {
    const first = findings.find((entry) => entry.severity === "blocking") ?? findings[0];
    return `BLOCKED: ${count("blocking")} defect(s) to fix (owners: ${owners.join(", ") || "human-review"}). First: ${first ? `${first.location}: ${first.message}` : "a person rejected the cut."}`;
  }
  if (verdict === "awaiting-human-review") {
    const conditions = [...new Set(findings.filter((entry) => entry.severity === "blocks-final-approval").map((entry) => entry.code))];
    return `AWAITING HUMAN REVIEW (not approved): no machine-found defect; ${open} human gate(s) open, ${count("needs-person")} question(s) only a person can answer` +
      (conditions.length ? `; final approval is impossible until these are resolved: ${conditions.join(", ")}.` : ".");
  }
  return "ELIGIBLE TO REQUEST FINAL APPROVAL (not approved, not scheduled, not publishable yet).";
}

/** What the review read from files. Everything else in the bindings comes from the submission. */
interface ObservedInputs {
  readonly mediaKey: string;
  readonly encode: unknown;
  readonly captionsSha256: string;
  readonly panelSha256: string | null;
  readonly assets: readonly { readonly assetId: string; readonly sha256: string | null }[];
}

type ManifestKey = Extract<BindingKey, `manifest.${string}`>;

/**
 * The render manifest, split into the parts the checks read. Each part is
 * hashed from the parsed manifest, so reformatting the file changes nothing,
 * and a change to one part invalidates only the checks that read that part.
 */
export function manifestBindings(manifest: RenderManifest | null): Record<ManifestKey, string> {
  if (manifest === null) {
    return {
      "manifest.target": "unreadable", "manifest.layout": "unreadable", "manifest.timeline": "unreadable", "manifest.captures": "unreadable",
      "manifest.disclosurePanel": "unreadable", "manifest.captions": "unreadable", "manifest.narration": "unreadable", "manifest.otherAssets": "unreadable",
    };
  }
  const assetRecord = (id: string | null) => manifest.assets.find((asset) => asset.assetId === id) ?? null;
  const pointed = new Set([manifest.disclosurePanelAssetId, manifest.captionsAssetId, manifest.narrationAssetId]);
  return {
    "manifest.target": sha256Json({
      version: manifest.version, variantId: manifest.variantId, output: manifest.output,
      storyboardSha256: manifest.storyboardSha256, productionPlanSha256: manifest.productionPlanSha256,
    }),
    "manifest.layout": sha256Json(manifest.layout),
    "manifest.timeline": sha256Json(manifest.beats),
    "manifest.captures": sha256Json(manifest.assets.filter((asset) => asset.role === "capture")),
    "manifest.disclosurePanel": sha256Json({ id: manifest.disclosurePanelAssetId, record: assetRecord(manifest.disclosurePanelAssetId) }),
    "manifest.captions": sha256Json({ id: manifest.captionsAssetId, record: assetRecord(manifest.captionsAssetId) }),
    "manifest.narration": sha256Json({ id: manifest.narrationAssetId, record: assetRecord(manifest.narrationAssetId), segments: manifest.narrationSegments }),
    "manifest.otherAssets": sha256Json(manifest.assets.filter((asset) => asset.role !== "capture" && !pointed.has(asset.assetId))),
  };
}

/** Read and parse a render manifest, or null when it cannot be. */
function readManifest(path: string): RenderManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RenderManifest;
    return parsed.version === RENDER_MANIFEST_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** The input identities a packet is bound to. One function, so issuing and revalidating cannot disagree. */
function bindingsFor(submission: ReviewSubmission, observed: ObservedInputs, modelSha: string, manifest: RenderManifest | null): Record<BindingKey, string> {
  const contractSha256 = sha256Json(submission.research.contract);
  return {
    ...manifestBindings(manifest),
    productionPlan: sha256Json(submission.productionPlan),
    media: observed.mediaKey,
    platformCut: sha256Json({ variant: submission.variant, encode: observed.encode }),
    script: sha256Json(submission.storyboard),
    captions: observed.captionsSha256,
    disclosure: sha256Json({ lines: submission.disclosureLines, panel: observed.panelSha256 }),
    claims: sha256Json(submission.claims),
    evidence: sha256Json({ contractSha256, modelSha }),
    research: sha256Json({ contractSha256, declaredKind: submission.research.declaredKind, snapshots: submission.research.evidenceSnapshotIds }),
    graphics: sha256Json(submission.graphics),
    assets: sha256Json(observed.assets),
    rights: sha256Json(submission.rights),
    decisions: sha256Json(submission.humanDecisions ?? []),
    title: sha256Text(submission.title),
    description: sha256Text(submission.description),
    ctaDestination: sha256Text(submission.approvedDestination),
  };
}

/**
 * MASTER #2's strict gate over everything a viewer reads: the storyboard, and
 * the published title and description, which are not part of it.
 */
function researchFindings(submission: ReviewSubmission) {
  const { storyboard, research } = submission;
  const findings = checkScriptAgainstResearchStrict(storyboard, research.contract);
  for (const [location, text] of [["title", submission.title], ["description", submission.description]] as const) {
    if (!text.trim()) continue;
    // Scanned as a storyboard whose only line is this text; other lines are blank and skipped.
    const alone = { ...storyboard, title: text, finalCta: "", beats: [] };
    for (const entry of checkScriptAgainstResearchStrict(alone, research.contract)) {
      if (entry.location === "title") findings.push({ ...entry, location });
    }
  }
  return findings;
}

export interface ReviewOptions {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly now?: Date;
}

export async function reviewCreative(submission: ReviewSubmission, options: ReviewOptions = {}): Promise<ReviewPacket> {
  const now = options.now ?? new Date();
  const tools: MediaTools = { ffmpegPath: options.ffmpegPath ?? "ffmpeg", ffprobePath: options.ffprobePath ?? "ffprobe" };
  const findings: ReviewFinding[] = [];
  const ran = new Set<CheckId>();
  const unavailable = new Map<CheckId, string>();
  const notApplicable = new Map<CheckId, string>();
  const details = new Map<CheckId, string>();
  const add = (entry: ReviewFinding) => findings.push(entry);
  const block = (check: CheckId, code: string, location: string, evidence: string, message: string, owner: ReviewFinding["owner"],
    recheck: ReviewFinding["recheck"] = [check], severity: FindingSeverity = "blocking") =>
    add({ code, severity, check, location, evidence, message, owner, recheck });
  const needsPerson = (check: CheckId, code: string, gate: HumanGateId, location: string, evidence: string, message: string, owner: ReviewFinding["owner"]) =>
    add({ code, severity: "needs-person", check, location, evidence, message, owner, recheck: [check, gate], gate });
  const { storyboard, variant } = submission;

  // --- research: identity, and synthetic stays synthetic --------------------
  const contractSha256 = sha256Json(submission.research.contract);
  const synthetic = contractDeclaresSynthetic(submission.research.contract) ||
    submission.research.evidenceSnapshotIds.some((id) => /SYNTHETIC[ _-]ENGINEERING[ _-]FIXTURE/i.test(id));
  ran.add("research.provenance");
  if (synthetic && submission.research.declaredKind === "production") {
    block("research.provenance", "synthetic-relabelled-production", "research", submission.research.contract.questionId,
      "The research is declared production, but the contract marks itself as synthetic engineering fixture data. A label cannot turn a fixture into research.", "research");
  } else if (synthetic) {
    block("research.provenance", "synthetic-research", "research", submission.research.contract.questionId,
      "The research is a synthetic engineering fixture. The cut can be reviewed for craft, never published.", "research", ["research.provenance"], "blocks-final-approval");
  }
  const cited = new Set(submission.research.contract.safeClaims.flatMap((claim) => claim.supportingSnapshotIds));
  for (const id of cited) {
    if (!submission.research.evidenceSnapshotIds.includes(id)) {
      block("research.provenance", "evidence-snapshot-missing", "research", id, `The contract cites evidence snapshot ${id}, which this submission does not carry.`, "research");
    }
  }

  // --- MASTER #2 against the script --------------------------------------------
  ran.add("claims.research");
  for (const entry of researchFindings(submission)) {
    add({ code: entry.code, severity: entry.severity === "hard-fail" ? "blocking" : "advisory", check: "claims.research", location: entry.location,
      evidence: entry.evidence, message: entry.message, owner: "script", recheck: ["claims.research"] });
  }

  // --- the render manifest: read from disk, then checked --------------------
  let manifest: RenderManifest | null = null;
  let manifestSha256: string | null = null;
  try {
    const bytes = readFileSync(submission.renderManifestPath);
    manifestSha256 = sha256Text(bytes);
    const parsed = JSON.parse(bytes.toString("utf8")) as RenderManifest;
    if (parsed.version !== RENDER_MANIFEST_VERSION) throw new Error(`version ${String(parsed.version)}`);
    manifest = parsed;
  } catch (error) {
    block("media.bytes", "render-manifest-unreadable", "render manifest", submission.renderManifestPath,
      `The render manifest cannot be read (${error instanceof Error ? error.message : String(error)}); nothing ties a video to this creative.`, "render");
  }
  const storyboardSha256 = sha256Json(storyboard);
  const productionPlanSha256 = sha256Json(submission.productionPlan);
  if (manifest) {
    if (manifest.variantId !== variant.variantId) {
      block("media.format", "manifest-for-other-cut", "render manifest", manifest.variantId, `The render is of platform cut ${manifest.variantId}, not ${variant.variantId}.`, "platform-cut");
    }
    if (manifest.storyboardSha256 !== storyboardSha256) {
      block("media.bytes", "render-of-other-script", "render manifest", manifest.storyboardSha256,
        "The video was rendered from a different storyboard than the one under review; script, captions and claims may not match what is on screen.", "render", ["media.bytes", "frames.bands", "claims.screen"]);
    }
    if (manifest.productionPlanSha256 !== productionPlanSha256) {
      block("media.bytes", "render-of-other-plan", "render manifest", manifest.productionPlanSha256, "The video was rendered from a different production plan.", "render");
    }
  }

  // Every file the manifest names, hashed again.
  const files: { assetId: string; role: string; path: string; sha256: string | null }[] = [];
  const assetOk = new Map<string, boolean>();
  for (const asset of manifest?.assets ?? []) {
    const actual = sha256File(asset.path);
    files.push({ assetId: asset.assetId, role: asset.role, path: asset.path, sha256: actual });
    if (actual === null) {
      block("rights.assets", "asset-missing", `asset ${asset.assetId}`, asset.path, "The file the render manifest names does not exist; its contribution cannot be checked.", "render", ["rights.assets", "frames.bands"]);
    } else if (actual !== asset.sha256) {
      block("rights.assets", "asset-changed", `asset ${asset.assetId}`, `${actual.slice(0, 12)}… (manifest ${asset.sha256.slice(0, 12)}…)`,
        "The asset's bytes differ from what the renderer recorded: it changed after the render, or the manifest is not about this render.", "render", ["rights.assets", "frames.bands"]);
    }
    assetOk.set(asset.assetId, actual !== null && actual === asset.sha256);
  }
  const assetById = (id: string | null) => manifest?.assets.find((asset) => asset.assetId === id) ?? null;

  // --- media bytes ---------------------------------------------------------------
  let media: VerifiedMedia | null = null;
  if (manifest) {
    ran.add("media.bytes");
    try {
      media = verifyRenderedMedia(manifest.output.path, now);
      if (media.sha256 !== manifest.output.sha256) {
        block("media.bytes", "media-differs-from-manifest", "video", `${media.sha256.slice(0, 12)}… (manifest ${manifest.output.sha256.slice(0, 12)}…)`,
          "The video's bytes are not the bytes the renderer recorded: it was modified or replaced after the render.", "render", ["media.bytes", "frames.bands", ...HUMAN_GATES.map((gate) => gate.gate)]);
      }
    } catch (error) {
      if (!(error instanceof MediaVerificationError)) throw error;
      block("media.bytes", "media-missing", "video", `${manifest.output.path} (claimed ${manifest.output.sha256.slice(0, 12)}…)`,
        `${error.message} A plausible hash is not a file.`, "render");
    }
  }

  // --- media inspection ----------------------------------------------------------
  const mediaChecks: CheckId[] = ["media.decode", "media.format", "media.blank-frozen", "media.audio-levels", "media.ending", "frames.bands", "narration.timing", "disclosure.coverage"];
  let toolsOk = true;
  try {
    await assertMediaTools(tools);
  } catch (error) {
    if (!(error instanceof MediaToolMissingError)) throw error;
    toolsOk = false;
    for (const check of mediaChecks) unavailable.set(check, error.message);
    block("media.decode", "media-tool-missing", "review environment", error.tool, error.message, "render", mediaChecks);
  }
  let probed: ProbeResult | null = null;
  let frames: BandedFrameReport | null = null;
  let cues: ParsedCue[] = [];
  const captionsAsset = manifest ? assetById(manifest.captionsAssetId) : null;
  if (captionsAsset && assetOk.get(captionsAsset.assetId)) {
    try { cues = parseAssCues(readFileSync(captionsAsset.path, "utf8")); } catch { cues = []; }
  }
  const lastBeatEnd = storyboard.beats.at(-1)?.endSecond ?? 0;

  if (manifest && media && toolsOk) {
    probed = await probe(tools, media.path);
    ran.add("media.format");
    const encode = manifest.output.encode;
    if (probed.width !== variant.width || probed.height !== variant.height) {
      block("media.format", "wrong-resolution", "video", `${probed.width}x${probed.height}`, `The cut must be ${variant.width}x${variant.height}.`, "platform-cut");
    }
    if (probed.fps === null || Math.abs(probed.fps - variant.fps) > 0.01) {
      block("media.format", "wrong-frame-rate", "video", String(probed.fps), `The cut must be ${variant.fps} fps.`, "platform-cut");
    }
    if (!(probed.durationSeconds >= variant.minDurationSeconds && probed.durationSeconds <= variant.maxDurationSeconds)) {
      block("media.format", "duration-outside-cut", "video", `${probed.durationSeconds}s`, `${variant.variantId} takes ${variant.minDurationSeconds}-${variant.maxDurationSeconds}s.`, "platform-cut");
    }
    if (variant.requiresAudio && probed.audioStreams === 0) block("media.format", "no-audio-stream", "video", "0 audio streams", "This cut needs an audio track.", "render");
    if (probed.width !== encode.width || probed.height !== encode.height || probed.fps !== encode.fps || probed.videoCodec !== encode.videoCodec || probed.audioCodec !== encode.audioCodec) {
      block("media.format", "encode-differs-from-render", "video",
        `${probed.width}x${probed.height} ${probed.fps}fps ${probed.videoCodec}/${probed.audioCodec}; manifest ${encode.width}x${encode.height} ${encode.fps}fps ${encode.videoCodec}/${encode.audioCodec}`,
        "This file is a different encode from the one rendered. A new encode is a new cut and needs its own render manifest and review.", "platform-cut");
    }
    details.set("media.format", `${probed.width}x${probed.height}, ${probed.fps} fps, ${probed.durationSeconds}s, ${probed.videoCodec}/${probed.audioCodec ?? "no audio"}`);

    ran.add("media.decode");
    const errors = await decodeErrors(tools, media.path);
    if (errors.length) block("media.decode", "decode-errors", "video", errors.slice(0, 3).join(" | "), "The file does not decode cleanly.", "render");

    ran.add("media.blank-frozen");
    const duration = probed.durationSeconds;
    for (const black of await blackIntervals(tools, media.path, duration)) {
      block("media.blank-frozen", "blank-section", `${black.start.toFixed(2)}-${black.end.toFixed(2)}s`, "blackdetect", "The picture is blank for at least half a second.", "render");
    }
    const freezes = await freezeIntervals(tools, media.path, duration);
    for (const freeze of freezes) {
      for (const beat of manifest.beats.slice(1)) {
        if (freeze.start < beat.startSecond - 0.25 && freeze.end > beat.startSecond + 0.25) {
          block("media.blank-frozen", "frozen-across-cut", `${beat.startSecond}s`, `frozen ${freeze.start.toFixed(2)}-${freeze.end.toFixed(2)}s`,
            `Nothing on screen changes across the planned cut into beat ${beat.beatIndex + 1}.`, "render");
        }
      }
      for (const beat of manifest.beats.filter((entry) => entry.motion)) {
        const overlap = Math.min(freeze.end, beat.endSecond) - Math.max(freeze.start, beat.startSecond);
        if (overlap > 0.5) block("media.blank-frozen", "frozen-motion", `beat ${beat.beatIndex + 1}`, `frozen ${overlap.toFixed(2)}s`, "A beat planned to move is frozen.", "render");
      }
    }
    details.set("media.blank-frozen", `${freezes.length} still hold(s) found; holds inside a static capture beat are intended`);

    ran.add("media.audio-levels");
    if (probed.audioStreams > 0) {
      const levels = await audioLevels(tools, media.path);
      if (levels.maxVolumeDb >= -0.1) block("media.audio-levels", "audio-clipping", "audio", `max ${levels.maxVolumeDb} dBFS`, "The audio reaches full scale; it is likely clipped.", "narration");
      if (levels.meanVolumeDb < -45) block("media.audio-levels", "audio-near-silent", "audio", `mean ${levels.meanVolumeDb} dBFS`, "The audio is almost silent.", "narration");
      details.set("media.audio-levels", `max ${levels.maxVolumeDb} dBFS, mean ${levels.meanVolumeDb} dBFS. Levels describe the signal, not whether the voice sounds natural.`);
    } else {
      details.set("media.audio-levels", "no audio stream");
    }

    ran.add("media.ending");
    const sound = probed.audioStreams > 0 ? await soundIntervals(tools, media.path, duration) : [];
    if (duration < lastBeatEnd - 0.1) {
      block("media.ending", "missing-ending", "video", `${duration}s of ${lastBeatEnd}s`, "The video stops before its planned end; the last beat is cut short.", "render");
    }
    if (duration > lastBeatEnd + 1) {
      block("media.ending", "overlong-tail", "video", `${duration}s of ${lastBeatEnd}s`, "The video runs more than a second past its last beat.", "render");
    }
    const lastSound = sound.at(-1);
    if (lastSound && lastSound.end >= duration - 0.05 && duration > 0.5) {
      block("media.ending", "narration-cut-off", `${lastSound.start.toFixed(2)}s-end`, "sound continues into the last frame", "The narration is still going when the video ends.", "narration");
    }

    // Narration timing against beats, only where the renderer recorded it.
    ran.add("narration.timing");
    if (manifest.narrationSegments === null) {
      ran.delete("narration.timing");
      unavailable.set("narration.timing", "The narration renderer read the script as one continuous take and recorded no per-beat timing; without ASR, which line is spoken over which screen cannot be measured.");
      needsPerson("narration.timing", "narration-timing-unknown", "pacing", "narration", "beatTiming: none",
        "Nothing measures whether each line is spoken over its own beat's screen. A person must check during a full watch that every figure is heard over the screen it describes.", "narration");
    } else {
      for (const segment of manifest.narrationSegments) {
        const beat = storyboard.beats[segment.beatIndex];
        if (!beat) continue;
        if (segment.startSecond < beat.startSecond - 0.15 || segment.endSecond > beat.endSecond + 0.15) {
          block("narration.timing", "narration-outside-beat", `beat ${segment.beatIndex + 1}`, `${segment.startSecond}-${segment.endSecond}s, beat ${beat.startSecond}-${beat.endSecond}s`,
            "This beat's line is placed partly over another beat's screen.", "narration", ["narration.timing", "claims.screen", "pacing"]);
        }
        if (beat.narration.trim() && !sound.some((interval) => interval.end > segment.startSecond && interval.start < segment.endSecond)) {
          block("narration.timing", "narration-missing-in-beat", `beat ${segment.beatIndex + 1}`, `${segment.startSecond}-${segment.endSecond}s`, "No sound where this beat's line is placed.", "narration");
        }
      }
      const spans = narrationSpans(manifest.narrationSegments);
      for (const interval of sound) {
        const inside = spans.some((segment) => interval.start >= segment.startSecond - 0.2 && interval.end <= segment.endSecond + 0.2);
        if (!inside) {
          block("narration.timing", "sound-outside-segments", `${interval.start.toFixed(2)}-${interval.end.toFixed(2)}s`, "silencedetect",
            "Audio plays where no narration segment was placed; a line may be running over the next screen.", "narration", ["narration.timing", "claims.screen"]);
        }
      }
    }

    // Sampled frames against their sources.
    const panel = assetById(manifest.disclosurePanelAssetId);
    const beatsWithCaptures = manifest.beats.map((beat) => ({ ...beat, sources: beat.captureAssetIds.map((id) => assetById(id)?.path ?? "") }));
    // A motion graphic is a clip, compared with itself at the same moment, not a still.
    const clipOf = (beat: (typeof beatsWithCaptures)[number]) => {
      const assets = beat.captureAssetIds.map((id) => assetById(id));
      return assets.length === 1 && assets[0]?.metadata.renderer === "specsmith-data-motion-graphic" ? assets[0].path : null;
    };
    const missingSources = beatsWithCaptures.some((beat) => beat.sources.length === 0 || beat.sources.some((path) => !path)) ||
      manifest.beats.some((beat) => beat.captureAssetIds.some((id) => !assetOk.get(id))) || !panel || !assetOk.get(panel.assetId);
    if (missingSources) {
      unavailable.set("frames.bands", "A capture or the disclosure panel the frames must be compared with is missing or changed, so sampled frames have nothing trustworthy to match.");
      unavailable.set("disclosure.coverage", "The disclosure panel to compare frames with is missing or changed.");
      block("frames.bands", "frame-sources-unavailable", "render manifest", "missing or changed source assets",
        "Sampled frames cannot be compared with their sources; the picture is unverified.", "render", ["frames.bands", "disclosure.coverage"]);
    } else {
      ran.add("frames.bands");
      ran.add("disclosure.coverage");
      const expectation: BandedFrameExpectation = {
        videoPath: media.path,
        layout: manifest.layout,
        disclosurePanelPath: panel!.path,
        beats: beatsWithCaptures.map((beat) => {
          const clip = clipOf(beat);
          return clip ? { startSecond: beat.startSecond, endSecond: beat.endSecond, sources: [], clip } : { startSecond: beat.startSecond, endSecond: beat.endSecond, sources: beat.sources };
        }),
        captionCues: cues.map((cue) => ({ startSecond: cue.startSecond, endSecond: cue.endSecond })),
        durationSeconds: probed.durationSeconds,
      };
      frames = await checkBandedFrames(expectation, { ffmpegPath: tools.ffmpegPath });
      // One finding per kind of failure, listing every sampled moment it was seen,
      // so an editor reads "gone from 3.20s" once rather than nine times.
      const kinds = [
        { test: /disclosure band/, check: "disclosure.coverage" as const, code: "disclosure-not-on-screen", owner: "disclosure" as const,
          message: "The verified disclosure is missing, changed or obscured at these moments; it must be on screen whenever a claim is.",
          recheck: ["disclosure.coverage", "frames.bands", "disclosures-in-context"] as ReviewFinding["recheck"] },
        { test: /story band/, check: "frames.bands" as const, code: "story-band-mismatch", owner: "render" as const,
          message: "The story band does not show the beat's verified capture: something is drawn over it, or it shows other pictures.",
          recheck: ["frames.bands", "claims.screen"] as ReviewFinding["recheck"] },
        { test: /caption band is empty/, check: "frames.bands" as const, code: "caption-missing", owner: "captions" as const,
          message: "A caption should be on screen and is not.", recheck: ["frames.bands"] as ReviewFinding["recheck"] },
        { test: /same picture/, check: "frames.bands" as const, code: "repeated-picture", owner: "capture" as const,
          message: "Consecutive beats show the same picture.", recheck: ["frames.bands"] as ReviewFinding["recheck"] },
      ];
      for (const kind of kinds) {
        const hits = frames.failures.filter((failure) => kind.test.test(failure));
        if (!hits.length) continue;
        const moments = hits.map((failure) => /^At ([\d.]+)s/.exec(failure)?.[1]).filter(Boolean).map((at) => `${at}s`);
        block(kind.check, kind.code, moments.length ? moments.join(", ") : "across cuts",
          hits.length > 1 ? `${hits[0]} (and ${hits.length - 1} more sampled moment(s))` : hits[0], kind.message, kind.owner, kind.recheck);
      }
      for (const failure of frames.failures.filter((entry) => !kinds.some((kind) => kind.test.test(entry)))) {
        block("frames.bands", "frame-check-failed", "frames", failure, failure, "render");
      }
      details.set("frames.bands", `${frames.samples.length} sampled frames, including the first and last`);
    }
  } else if (manifest && !media) {
    for (const check of mediaChecks) if (!unavailable.has(check)) unavailable.set(check, "No verified media: there are no bytes to inspect.");
  }

  // --- captions: the burned-in file against the script ---------------------------
  const captionsByBeat: (string | null)[] = storyboard.beats.map(() => null);
  if (captionsAsset && assetOk.get(captionsAsset.assetId)) {
    ran.add("captions.rendered-text");
    // The planned set is the production plan's own caption cues, when it has
    // them (the plan is bound to this render by its hash): a beat whose line its
    // motion graphic draws carries no caption cue. Otherwise, one per beat.
    const planned = plannedCaptionCues(submission.productionPlan) ?? captionCuesForScript(storyboard);
    for (const cue of cues) {
      const middle = (cue.startSecond + cue.endSecond) / 2;
      const index = storyboard.beats.findIndex((beat) => middle >= beat.startSecond && middle < beat.endSecond);
      if (index >= 0) captionsByBeat[index] = captionsByBeat[index] ? `${captionsByBeat[index]} ${cue.text}` : cue.text;
    }
    if (planned.length !== cues.length) {
      block("captions.rendered-text", "caption-count-differs", "captions", `${cues.length} burned, ${planned.length} planned`, "The burned-in captions are not the planned set.", "captions");
    }
    planned.forEach((plan, index) => {
      const cue = cues[index];
      if (!cue) return;
      if (normalizeText(cue.text) !== normalizeText(plan.text)) {
        block("captions.rendered-text", "caption-differs-from-script", `caption ${index + 1}`, cue.text, `The burned-in caption reads "${cue.text}"; the storyboard says "${plan.text}".`, "captions", ["captions.rendered-text", "claims.model", "readable-at-size"]);
      }
      if (Math.abs(cue.startSecond - plan.startSecond) > 0.05 || Math.abs(cue.endSecond - plan.endSecond) > 0.05) {
        block("captions.rendered-text", "caption-outside-window", `caption ${index + 1}`, `${cue.startSecond}-${cue.endSecond}s`, `Planned for ${plan.startSecond}-${plan.endSecond}s.`, "captions");
      }
    });
  } else if (manifest) {
    unavailable.set("captions.rendered-text", "The burned-in caption file is missing or changed.");
    for (let index = 0; index < storyboard.beats.length; index += 1) captionsByBeat[index] = null;
  }

  // --- narration bound to this script --------------------------------------------
  const narrationAsset = manifest ? assetById(manifest.narrationAssetId) : null;
  const narrationSha256 = sha256Text(narrationText(storyboard));
  if (manifest && narrationAsset) {
    ran.add("narration.binding");
    const recorded = narrationAsset.metadata.textSha256;
    if (typeof recorded !== "string") {
      block("narration.binding", "narration-unbound", `asset ${narrationAsset.assetId}`, "(no textSha256)", "The narration audio does not record which text it was made from; it may be another script's audio.", "narration");
    } else if (recorded !== narrationSha256) {
      block("narration.binding", "narration-of-other-script", `asset ${narrationAsset.assetId}`, recorded.slice(0, 12), "The narration audio was synthesised from different text than this storyboard's narration.", "narration", ["narration.binding", "voice-and-mix"]);
    }
  } else if (manifest && storyboard.beats.some((beat) => beat.narration.trim())) {
    block("narration.binding", "narration-missing", "render manifest", "(no narration asset)", "The storyboard has narration, and the render has none.", "narration");
  }

  // --- disclosure: the panel is the planned text, legible -----------------------
  const panel = manifest ? assetById(manifest.disclosurePanelAssetId) : null;
  const disclosuresSha256 = sha256Text(submission.disclosureLines.join("\n"));
  if (panel) {
    ran.add("disclosure.content");
    const meta = panel.metadata;
    if (meta.textSha256 !== disclosuresSha256) {
      block("disclosure.content", "disclosure-text-differs", `asset ${panel.assetId}`, String(meta.textSha256 ?? "(none)").slice(0, 12),
        "The rendered disclosure panel does not carry the planned disclosure lines verbatim.", "disclosure", ["disclosure.content", "frames.bands", "disclosures-in-context"]);
    }
    if (typeof meta.fontPx !== "number" || meta.fontPx < MIN_DISCLOSURE_FONT_PX) {
      block("disclosure.content", "disclosure-too-small", `asset ${panel.assetId}`, String(meta.fontPx ?? "(unmeasured)"), `Disclosure type must be at least ${MIN_DISCLOSURE_FONT_PX}px in the final frame.`, "disclosure");
    }
    if (typeof meta.contrastRatio !== "number" || meta.contrastRatio < MIN_DISCLOSURE_CONTRAST) {
      block("disclosure.content", "disclosure-low-contrast", `asset ${panel.assetId}`, String(meta.contrastRatio ?? "(unmeasured)"), `Disclosure contrast must be at least ${MIN_DISCLOSURE_CONTRAST}:1.`, "disclosure");
    }
  } else if (manifest) {
    block("disclosure.content", "disclosure-panel-missing", "render manifest", "(none)", "The render has no disclosure panel.", "disclosure", ["disclosure.content", "disclosure.coverage"]);
  }

  // Safe areas, only from a sourced spec.
  if (manifest) {
    if (variant.safeArea === null) {
      unavailable.set("disclosure.safe-area", `No verified safe-area insets are recorded for ${variant.platform}; guessed numbers are not used.`);
      needsPerson("disclosure.safe-area", "safe-area-unverified", "readable-at-size", "platform cut", variant.variantId,
        "Whether the platform's own interface covers the disclosure or captions is unknown; check on a real phone in the app.", "platform-cut");
    } else {
      ran.add("disclosure.safe-area");
      const { top, bottom } = variant.safeArea;
      const bands = [["disclosure", manifest.layout.disclosure], ["captions", manifest.layout.captions]] as const;
      for (const [name, band] of bands) {
        if (band.y < top || band.y + band.height > variant.height - bottom) {
          block("disclosure.safe-area", "outside-safe-area", `${name} band`, `y ${band.y}-${band.y + band.height}; safe ${top}-${variant.height - bottom} (${variant.safeArea.source})`,
            `The ${name} band extends into the area the platform's interface covers.`, "disclosure");
        }
      }
    }
  }

  // --- figures, captures, graphics ---------------------------------------------------
  const graphicTextByBeat = storyboard.beats.map((_, index) => {
    const beat = manifest?.beats.find((entry) => entry.beatIndex === index);
    return (beat?.captureAssetIds ?? []).map((id) => assetById(id))
      .filter((asset) => asset?.metadata.renderer === "specsmith-data-motion-graphic" && typeof asset.metadata.onScreenText === "string" && assetOk.get(asset.assetId))
      .map((asset) => String(asset!.metadata.onScreenText)).join(" \n ");
  });
  const capturesByBeat: BeatCapture[][] = storyboard.beats.map((_, index) => {
    const beat = manifest?.beats.find((entry) => entry.beatIndex === index);
    return (beat?.captureAssetIds ?? []).map((id) => assetById(id)).filter((asset) => asset !== null && asset.role === "capture")
      .map((asset) => ({ assetId: asset!.assetId, pairing: pairingFromRoute(String(asset!.metadata.route ?? "")), metadata: asset!.metadata }));
  });
  ran.add("claims.model"); ran.add("claims.presentation"); ran.add("claims.screen"); ran.add("claims.undeclared");
  const disclosureVerifiedOnScreen = frames !== null && !findings.some((entry) => entry.code === "disclosure-not-on-screen" || entry.code === "disclosure-text-differs");
  findings.push(...checkClaims({
    storyboard, title: submission.title, description: submission.description, captionsByBeat, graphicTextByBeat, capturesByBeat,
    claims: submission.claims, graphics: submission.graphics, disclosureLines: submission.disclosureLines,
    disclosureVerifiedOnScreen, contract: submission.research.contract,
  }));
  const captures = checkCapturesCurrent(capturesByBeat);
  if (captures.checked > 0 || captures.findings.length > 0) ran.add("captures.current");
  else notApplicable.set("captures.current", "No Compare capture in this cut.");
  findings.push(...captures.findings);
  if (submission.graphics.length) { ran.add("graphics.integrity"); findings.push(...checkGraphics(submission.graphics, capturesByBeat)); }
  else notApplicable.set("graphics.integrity", "No editorial graphics declared.");

  // --- MASTER #1 storyboard review: a fix outstanding blocks, a score does not help --
  ran.add("storyboard.quality");
  const quality = reviewCreativeQuality({
    creativeId: submission.creativeId, packageId: submission.concept.conceptId, storyboard,
    captionCues: captionCuesForScript(storyboard), ctaRoute: submission.approvedDestination,
    mediaSha256: media?.sha256 ?? null, now,
  });
  for (const fix of quality.recommendedFixes) {
    block("storyboard.quality", "storyboard-fix-outstanding", fix.beats.length ? `beat ${fix.beats.map((beat) => beat + 1).join(", ")}` : "storyboard",
      fix.issue, `${fix.dimension}: ${fix.issue}${fix.fix ? ` Fix: ${fix.fix}` : ""}`, "script", ["storyboard.quality"]);
  }
  for (const failure of quality.slop.hardFailures) {
    block("storyboard.quality", failure.code, failure.location, failure.evidence, failure.message, "script");
  }
  details.set("storyboard.quality", `${quality.recommendedFixes.length} recommended fix(es). The aggregate production score is not used by this verdict.`);

  // --- CTA ------------------------------------------------------------------------------
  ran.add("cta.destination");
  const last = storyboard.beats.at(-1);
  const ctaText = `${last?.narration ?? ""} ${captionsByBeat.at(-1) ?? last?.onScreenText ?? ""} ${storyboard.finalCta}`;
  const spoken = submission.approvedDestination.replace(/\//g, " slash ").trim();
  if (!normalizeText(ctaText).includes(normalizeText(submission.approvedDestination)) && !normalizeText(ctaText).includes(normalizeText(spoken))) {
    block("cta.destination", "cta-missing", `beat ${storyboard.beats.length}`, ctaText.trim(), `The ending does not send the viewer to the approved destination ${submission.approvedDestination}.`, "script");
  }
  for (const route of `${ctaText} ${submission.description}`.match(/(?<![\w.])\/[a-z][\w/-]*/gi) ?? []) {
    if (route !== submission.approvedDestination) {
      block("cta.destination", "cta-wrong-destination", "call to action", route, `The call to action names ${route}; the approved destination is ${submission.approvedDestination}.`, "script");
    }
  }

  // --- rights -------------------------------------------------------------------------
  ran.add("rights.assets"); ran.add("rights.placeholders");
  findings.push(...checkRights({ assets: manifest?.assets ?? [], records: submission.rights, now }));

  // --- what no machine here can do ---------------------------------------------------
  unavailable.set("text.ocr", "No OCR engine is part of this pipeline. Caption and disclosure wording is checked in the files that were burned in, and their presence in pixels, but not read back from the frames.");
  unavailable.set("audio.asr", "No speech recogniser is part of this pipeline. The audio is bound to its script by hash; what is actually said is not transcribed.");
  needsPerson("text.ocr", "rendered-text-unread", "readable-at-size", "on-screen text", "no OCR",
    "Read every caption, number and game name on a phone at real size.", "human-review");
  needsPerson("audio.asr", "spoken-words-unheard", "voice-and-mix", "narration", "no ASR",
    "Listen to the full narration: every number and name must be pronounced as written.", "human-review");

  // --- human gates ----------------------------------------------------------------------
  ran.add("decisions.binding");
  const human = evaluateHumanGates({ decisions: submission.humanDecisions ?? [], mediaSha256: media?.sha256 ?? null, variantId: variant.variantId, now });
  findings.push(...human.findings);

  // --- the packet --------------------------------------------------------------------------
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const checkRecords: CheckRecord[] = (Object.keys(CHECKS) as CheckId[]).map((check) => {
    if (unavailable.has(check)) return { check, status: "unavailable", detail: unavailable.get(check)! };
    if (notApplicable.has(check)) return { check, status: "not-applicable", detail: notApplicable.get(check)! };
    if (!ran.has(check)) return { check, status: "unavailable", detail: "Not run: an input it needs (the render manifest or the media) could not be established." };
    const failing = findings.filter((entry) => entry.check === check && entry.severity === "blocking");
    return {
      check,
      status: failing.length ? "failed" : "passed",
      detail: failing.length ? `${failing.length} blocking finding(s)` : details.get(check) ?? CHECKS[check].title,
    };
  });

  const observed: ObservedInputs = {
    mediaKey: media?.sha256 ?? `unverified:${manifest?.output.sha256 ?? "none"}`,
    encode: probed ? { width: probed.width, height: probed.height, fps: probed.fps, videoCodec: probed.videoCodec, audioCodec: probed.audioCodec } : manifest?.output.encode ?? null,
    captionsSha256: captionsAsset ? sha256File(captionsAsset.path) ?? "missing" : "none",
    panelSha256: panel ? sha256File(panel.path) : null,
    assets: files.map((file) => ({ assetId: file.assetId, sha256: file.sha256 })),
  };
  const modelSha = modelSnapshotSha256();
  const bindings = bindingsFor(submission, observed, modelSha, manifest);
  const captionsSha256 = observed.captionsSha256;

  const verdict = verdictFor(findings, human.gates);
  const packet: ReviewPacket = deepFreeze({
    version: REVIEW_PACKET_VERSION,
    packetId: sha256Json({ creativeId: submission.creativeId, variant: variant.variantId, bindings, reviewedAt: now.toISOString() }).slice(0, 24),
    reviewedAt: now.toISOString(),
    creativeId: submission.creativeId,
    platformVariantId: variant.variantId,
    verdict,
    summary: summaryFor(verdict, findings, human.gates),
    verdictMeaning: VERDICT_MEANING[verdict],
    identities: {
      researchContractSha256: contractSha256,
      researchQuestionId: submission.research.contract.questionId,
      researchKind: synthetic ? "synthetic-fixture" : submission.research.declaredKind,
      evidenceSnapshotIds: [...submission.research.evidenceSnapshotIds],
      modelSnapshotSha256: modelSha,
      conceptId: submission.concept.conceptId,
      conceptSha256: sha256Json(submission.concept.body),
      storyboardSha256,
      narrationSha256,
      captionsSha256,
      disclosuresSha256,
      claimsSha256: bindings.claims,
      graphicsSha256: bindings.graphics,
      productionPlanSha256,
      titleSha256: bindings.title,
      descriptionSha256: bindings.description,
      approvedDestination: submission.approvedDestination,
      renderManifestSha256: manifestSha256 ?? "unreadable",
      assetsSha256: bindings.assets,
      rightsManifestSha256: bindings.rights,
      platformCutSha256: bindings.platformCut,
    },
    media: {
      path: media?.path ?? manifest?.output.path ?? "(none)",
      sha256: media?.sha256 ?? null,
      bytes: media?.bytes ?? null,
      durationSeconds: probed?.durationSeconds ?? null,
      width: probed?.width ?? null,
      height: probed?.height ?? null,
      fps: probed?.fps ?? null,
      videoCodec: probed?.videoCodec ?? null,
      audioCodec: probed?.audioCodec ?? null,
      audioChannels: probed?.audioChannels ?? null,
    },
    assets: (manifest?.assets ?? []).map((asset) => {
      const record = submission.rights.find((entry) => entry.assetId === asset.assetId);
      const placeholder = placeholderEvidence(asset);
      return {
        assetId: asset.assetId,
        role: asset.role,
        sha256: files.find((file) => file.assetId === asset.assetId)?.sha256 ?? null,
        kind: record?.kind ?? "unknown",
        rights: record ? `${record.license.kind}${placeholder || record.placeholder.isPlaceholder ? " (PLACEHOLDER)" : ""}` : "unknown",
      };
    }),
    findings,
    checksCompleted: checkRecords.filter((record) => record.status === "passed" || record.status === "failed"),
    checksUnavailable: checkRecords.filter((record) => record.status === "unavailable" || record.status === "not-applicable"),
    humanGates: human.gates,
    approvalMechanism: APPROVAL_MECHANISM,
    bindings,
  } satisfies ReviewPacket);
  ISSUED.add(packet);
  STATE.set(packet, { media, observed, manifestPath: submission.renderManifestPath, manifestSha256, files });
  return packet;
}

export function isIssuedReviewPacket(value: unknown): value is ReviewPacket {
  return typeof value === "object" && value !== null && ISSUED.has(value);
}

export interface RecheckPlan {
  readonly changed: readonly BindingKey[];
  readonly checksToRepeat: readonly CheckId[];
  readonly gatesToRepeat: readonly HumanGateId[];
  readonly stillValidChecks: readonly CheckId[];
  readonly stillValidGates: readonly HumanGateId[];
}

/** Which checks and human gates a change of inputs invalidates, and only those. */
export function planRechecks(previous: Readonly<Record<BindingKey, string>>, next: Readonly<Record<BindingKey, string>>): RecheckPlan {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<BindingKey>;
  const changed = [...keys].filter((key) => previous[key] !== next[key]);
  const touches = (bindsTo: readonly string[]) => bindsTo.some((key) => changed.includes(key as BindingKey));
  const checks = Object.keys(CHECKS) as CheckId[];
  // A check that consumes another check's result repeats whenever that one does.
  const repeat = new Set(checks.filter((check) => touches(CHECKS[check].bindsTo)));
  for (let grew = true; grew;) {
    grew = false;
    for (const check of checks) {
      if (!repeat.has(check) && (CHECK_USES[check] ?? []).some((used) => repeat.has(used))) { repeat.add(check); grew = true; }
    }
  }
  return {
    changed,
    checksToRepeat: checks.filter((check) => repeat.has(check)),
    gatesToRepeat: HUMAN_GATES.filter((gate) => touches(gate.bindsTo)).map((gate) => gate.gate),
    stillValidChecks: checks.filter((check) => !repeat.has(check)),
    stillValidGates: HUMAN_GATES.filter((gate) => !touches(gate.bindsTo)).map((gate) => gate.gate),
  };
}

/** Plain names for binding keys, for the reasons a revalidation gives. */
const BINDING_LABELS: Record<BindingKey, string> = {
  media: "the media", platformCut: "the platform cut", script: "the storyboard (script and narration)", captions: "the captions",
  disclosure: "the disclosures", claims: "the declared claims", evidence: "the research contract or the model",
  research: "the research identity", graphics: "the graphics", assets: "the assets", rights: "the rights records",
  decisions: "the recorded human decisions", title: "the title", description: "the description",
  ctaDestination: "the approved call-to-action destination", productionPlan: "the production plan",
  "manifest.target": "the render manifest's record of what was rendered (cut, encode, script and plan, output)",
  "manifest.layout": "the render manifest's band layout", "manifest.timeline": "the render manifest's beat timeline",
  "manifest.captures": "the render manifest's capture records", "manifest.disclosurePanel": "the render manifest's disclosure panel record",
  "manifest.captions": "the render manifest's captions record", "manifest.narration": "the render manifest's narration record and timing",
  "manifest.otherAssets": "the render manifest's other asset records",
};

/**
 * Check that a packet still describes its inputs.
 *
 * Always re-reads the files it was made from. Given the submission as it
 * stands now, it also recomputes every input binding from it (title,
 * description, destination, script, claims, rights, research and the rest),
 * so an edit made after the packet was issued invalidates exactly the checks
 * and gates that depend on what changed.
 */
export function revalidateReviewPacket(packet: ReviewPacket, current?: ReviewSubmission): { valid: boolean; reasons: string[]; plan: RecheckPlan | null } {
  if (!isIssuedReviewPacket(packet)) {
    return { valid: false, reasons: ["This packet was not issued by reviewCreative (it was built by hand, copied, or read from JSON); it proves nothing."], plan: null };
  }
  const state = STATE.get(packet)!;
  const reasons: string[] = [];
  const next: Record<BindingKey, string> = { ...packet.bindings };
  if (state.media && isVerifiedMedia(state.media)) {
    const recheck = recheckMedia(state.media);
    if (!recheck.ok) {
      reasons.push(recheck.reason);
      next.media = sha256File(state.media.path) ?? "missing";
    }
  } else {
    reasons.push("The packet has no verified media.");
  }
  // The manifest is re-read and compared part by part, so an edit invalidates
  // only the checks that read the part it touched.
  if (sha256File(state.manifestPath) !== state.manifestSha256) {
    const reread = readManifest(state.manifestPath);
    if (reread === null) {
      reasons.push("The render manifest is now missing or unreadable.");
      next.media = `${next.media}:manifest-unreadable`;
    }
    const parts = manifestBindings(reread);
    for (const key of Object.keys(parts) as ManifestKey[]) {
      if (parts[key] !== packet.bindings[key]) {
        reasons.push(`${BINDING_LABELS[key][0].toUpperCase()}${BINDING_LABELS[key].slice(1)} changed after review.`);
        next[key] = parts[key];
      }
    }
  }
  const changedFiles = state.files.filter((file) => sha256File(file.path) !== file.sha256);
  for (const file of changedFiles) {
    reasons.push(`Asset ${file.assetId} (${file.role}) changed after review.`);
    next.assets = `${packet.bindings.assets}:changed`;
    if (file.role === "captions") next.captions = `${packet.bindings.captions}:changed`;
    if (file.role === "disclosure-panel") next.disclosure = `${packet.bindings.disclosure}:changed`;
  }
  if (current) {
    if (current.creativeId !== packet.creativeId || current.variant.variantId !== packet.platformVariantId) {
      reasons.push(`The submission is for ${current.creativeId} / ${current.variant.variantId}, not this packet's ${packet.creativeId} / ${packet.platformVariantId}.`);
      next.platformCut = `${next.platformCut}:other-creative-or-cut`;
    }
    if (current.renderManifestPath !== state.manifestPath) {
      reasons.push("The submission names a different render manifest: it is about another render.");
      next.media = `${next.media}:other-render`;
    }
    const recomputed = bindingsFor(current, state.observed, modelSnapshotSha256(), null);
    for (const key of Object.keys(recomputed) as BindingKey[]) {
      // Media, captions, assets and the manifest come from files, checked above.
      if (key === "media" || key === "captions" || key === "assets" || key.startsWith("manifest.")) continue;
      if (recomputed[key] !== packet.bindings[key]) {
        reasons.push(`${BINDING_LABELS[key][0].toUpperCase()}${BINDING_LABELS[key].slice(1)} changed after review.`);
        next[key] = recomputed[key];
      }
    }
  }
  return { valid: reasons.length === 0, reasons, plan: reasons.length ? planRechecks(packet.bindings, next) : null };
}

/**
 * The only door to final approval, and it is shut.
 *
 * It refuses a packet it did not issue, a packet that is not eligible, and a
 * packet whose files, or (given the current submission) whose inputs, changed. Even an eligible, unchanged packet is refused:
 * final approval needs a trusted, authenticated decision, and this repository
 * has no mechanism to record one. Approval itself is not MASTER #7's to grant.
 */
export function requestFinalApproval(packet: unknown, current?: ReviewSubmission): { granted: false; reasons: string[] } {
  if (!isIssuedReviewPacket(packet)) return { granted: false, reasons: ["Not a packet issued by reviewCreative."] };
  const reasons: string[] = [];
  if (packet.verdict !== "eligible-to-request-final-approval") reasons.push(`The packet's verdict is ${packet.verdict}.`);
  const revalidation = revalidateReviewPacket(packet, current);
  reasons.push(...revalidation.reasons);
  reasons.push(APPROVAL_MECHANISM.why);
  return { granted: false, reasons };
}

/** The packet for an editor: verdict first, then what to fix, then what a person must decide. */
export function formatReviewPacket(packet: ReviewPacket): string {
  const lines: string[] = [];
  lines.push(`QUALITY AND INTEGRITY REVIEW — ${packet.creativeId} / ${packet.platformVariantId}`);
  lines.push(`Verdict: ${packet.verdict}`);
  lines.push(`  ${packet.summary}`);
  lines.push(`  What this means: ${packet.verdictMeaning}`);
  lines.push(`Media: ${packet.media.path}`);
  lines.push(`  sha256 ${packet.media.sha256 ?? "(not verified)"} · ${packet.media.width ?? "?"}x${packet.media.height ?? "?"} · ${packet.media.fps ?? "?"} fps · ${packet.media.durationSeconds ?? "?"}s · ${packet.media.videoCodec ?? "?"}/${packet.media.audioCodec ?? "no audio"}`);
  lines.push(`Research: ${packet.identities.researchQuestionId} (${packet.identities.researchKind})`);
  const groups: [FindingSeverity, string][] = [
    ["blocking", "Fix before anything else"],
    ["needs-person", "Only a person can decide"],
    ["blocks-final-approval", "Forbids final approval regardless of review"],
    ["advisory", "Worth a look"],
  ];
  for (const [severity, heading] of groups) {
    const entries = packet.findings.filter((entry) => entry.severity === severity);
    if (!entries.length) continue;
    lines.push(`${heading} (${entries.length}):`);
    for (const entry of entries) {
      lines.push(`  - [${entry.code}] ${entry.location} — ${entry.message}`);
      lines.push(`      evidence: ${entry.evidence.slice(0, 160)}`);
      lines.push(`      owner: ${entry.owner}; recheck: ${entry.recheck.join(", ")}`);
    }
  }
  lines.push(`Checks completed: ${packet.checksCompleted.map((record) => `${record.check} ${record.status}`).join("; ")}`);
  lines.push("Checks not available:");
  for (const record of packet.checksUnavailable) lines.push(`  - ${record.check} (${record.status}): ${record.detail}`);
  lines.push("Human gates (none can close here):");
  for (const gate of packet.humanGates) {
    lines.push(`  - ${gate.gate} [${gate.status}] ${gate.question}`);
    for (const decision of gate.recordedDecisions) lines.push(`      recorded ${decision.outcome} by ${decision.by || "(unnamed)"}: ${decision.note}`);
  }
  lines.push(`Approval mechanism: ${packet.approvalMechanism.why}`);
  return lines.join("\n");
}
