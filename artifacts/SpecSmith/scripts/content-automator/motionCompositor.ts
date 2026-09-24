import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export interface CompositorBeat {
  visualTaskId: string;
  startSecond: number;
  endSecond: number;
}

export interface MotionCompositorState {
  durationSeconds: number;
  fps: number;
  visualTimeline: CompositorBeat[];
  voiceTaskId: string;
  captionTaskId?: string;
  musicTaskId?: string;
}

export interface MotionCompositorConfig {
  outputDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  width?: number;
  height?: number;
  crf?: number;
  preset?: string;
  timeoutMs?: number;
}

export class MotionCompositorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MotionCompositorError";
    this.code = code;
  }
}

interface SequenceFrame {
  index: number;
  label: string;
  file: string;
  atMs: number;
}

interface SequenceManifest {
  frames: SequenceFrame[];
}

interface ProbeResult {
  durationSeconds: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
}

// ---------------------------------------------------------------------------
// THE RENDER RECEIPT
//
// An account of exactly what this compositor consumed to make one master,
// produced BY the compositor while it consumed it. Nothing outside this file
// can make one.
//
// WHY IT LIVES HERE AND NOWHERE ELSE. Provenance used to be a list any caller
// could assemble and pass to `sealRenderManifest`, which hashed whatever it was
// given. The seal proved the list had not changed since it was sealed; it said
// nothing about whether the list was TRUE, because the caller wrote both. The
// only party that knows which files went into a master is the code that fed
// them to ffmpeg, so that is the only party allowed to write the record.
//
// WHAT MAKES ONE GENUINE. Two module-private objects:
//
//   ISSUED_RECEIPTS     every receipt this module has created
//   RECEIPT_BY_MASTER   the master artifact each was created for
//
// Neither is exported, and no function that adds to them is exported. A
// receipt-shaped object built anywhere else — by hand, by spreading a genuine
// receipt, by JSON round-trip — is not in ISSUED_RECEIPTS and is refused.
// Genuine receipts are deep-frozen, so they cannot be edited in place either.
//
// WHAT THIS IS NOT. It is an in-process runtime invariant, not a signature. See
// the trust model in publishGate.ts for what it does and does not defend.
// ---------------------------------------------------------------------------

/** The role an input played in the master. Assigned from compositorState, never guessed. */
export type ReceiptRole = "hook-visual" | "evidence-visual" | "narration" | "captions" | "music-bed";

export interface ReceiptTimelineUse {
  readonly index: number;
  readonly startSecond: number;
  readonly endSecond: number;
}

export interface ReceiptFrame {
  readonly resolvedPath: string;
  readonly sha256: string;
}

export interface RenderReceiptInput {
  readonly taskId: string;
  readonly role: ReceiptRole;
  /** realpath of the file ffmpeg read, so a symlink is recorded as its target. */
  readonly resolvedPath: string;
  /** SHA-256 of those bytes, taken before ffmpeg ran and re-checked after. */
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: string;
  readonly mimeType: string;
  /** Visuals only: every timeline slot this input filled. Empty otherwise. */
  readonly timeline: readonly ReceiptTimelineUse[];
  /** Sequence visuals only: the frame files ffmpeg actually read. */
  readonly frames: readonly ReceiptFrame[];
  /**
   * Provenance AS THE PRODUCING ADAPTER DECLARED IT, captured at consumption.
   *
   * Recorded, not authenticated. The receipt freezes these values so nothing
   * downstream can change them; it cannot prove the adapter told the truth.
   */
  readonly renderer: string;
  readonly provider: string;
  readonly declaredFixture: boolean;
  readonly voiceId: string;
}

export interface RenderReceiptParameters {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly crf: number;
  readonly preset: string;
  readonly plannedDurationSeconds: number;
  readonly finalDurationSeconds: number;
  readonly captionsBurnedIn: boolean;
  readonly musicIncluded: boolean;
  readonly voiceGain: number;
  readonly musicGain: number;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

export interface RenderReceipt {
  readonly version: 1;
  readonly packageId: string;
  readonly platform: string;
  readonly composeTaskId: string;
  readonly masterPath: string;
  readonly masterSha256: string;
  readonly masterBytes: number;
  readonly parameters: RenderReceiptParameters;
  readonly inputs: readonly RenderReceiptInput[];
  /** SHA-256 over the canonical form of every field above. */
  readonly digest: string;
}

const ISSUED_RECEIPTS = new WeakSet<object>();
const RECEIPT_BY_MASTER = new WeakMap<object, RenderReceipt>();

const VOICE_GAIN = 1.0;
const MUSIC_GAIN = 0.14;

const sha256Hex = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const buffer = await readFile(path);
  return { sha256: sha256Hex(buffer), bytes: buffer.length };
}

/**
 * The receipt's canonical form. Field and input order are fixed, so the same
 * render always digests identically however the object was assembled.
 */
function canonicalReceipt(receipt: Omit<RenderReceipt, "digest">): string {
  const inputs = [...receipt.inputs]
    .map((input) => ({
      taskId: input.taskId,
      role: input.role,
      resolvedPath: input.resolvedPath,
      sha256: input.sha256,
      bytes: input.bytes,
      kind: input.kind,
      mimeType: input.mimeType,
      timeline: input.timeline.map((use) => [use.index, use.startSecond, use.endSecond]),
      frames: input.frames.map((frame) => [frame.resolvedPath, frame.sha256]),
      renderer: input.renderer,
      provider: input.provider,
      declaredFixture: input.declaredFixture,
      voiceId: input.voiceId,
    }))
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  const p = receipt.parameters;
  return JSON.stringify({
    version: receipt.version,
    packageId: receipt.packageId,
    platform: receipt.platform,
    composeTaskId: receipt.composeTaskId,
    masterPath: receipt.masterPath,
    masterSha256: receipt.masterSha256,
    masterBytes: receipt.masterBytes,
    parameters: [
      p.width, p.height, p.fps, p.crf, p.preset, p.plannedDurationSeconds, p.finalDurationSeconds,
      p.captionsBurnedIn, p.musicIncluded, p.voiceGain, p.musicGain, p.ffmpegPath, p.ffprobePath,
    ],
    inputs,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Whether `value` is a receipt THIS MODULE issued, unaltered.
 *
 * Three checks, all required: it is in the private issued set; it is frozen;
 * and its digest still matches its own contents. The last is redundant while
 * freezing holds and is kept so that a future regression in freezing fails
 * closed instead of quietly trusting an edited receipt.
 */
export function isIssuedRenderReceipt(value: unknown): value is RenderReceipt {
  if (value === null || typeof value !== "object") return false;
  if (!ISSUED_RECEIPTS.has(value)) return false;
  if (!Object.isFrozen(value)) return false;
  const receipt = value as RenderReceipt;
  const { digest, ...rest } = receipt;
  return typeof digest === "string" && digest === sha256Hex(canonicalReceipt(rest));
}

/**
 * The receipt this compositor issued for a master artifact it returned, if any.
 *
 * Keyed on the artifact OBJECT the adapter returned. A copy of that artifact —
 * spread, cloned, parsed from JSON — has no receipt, by design.
 */
export function renderReceiptFor(master: RenderArtifact): RenderReceipt | undefined {
  if (master === null || typeof master !== "object") return undefined;
  return RECEIPT_BY_MASTER.get(master);
}

interface ConsumedPlan {
  artifact: RenderArtifact;
  role: ReceiptRole;
  path: string;
  timeline: ReceiptTimelineUse[];
}

function describeProvenance(artifact: RenderArtifact): Pick<RenderReceiptInput, "renderer" | "provider" | "declaredFixture" | "voiceId"> {
  const metadata = (artifact.metadata ?? {}) as Record<string, unknown>;
  const first = (...keys: string[]): string => {
    for (const key of keys) {
      const raw = metadata[key];
      if (typeof raw === "string" && raw.trim()) return raw.trim();
    }
    return "";
  };
  return {
    renderer: first("renderer", "provider"),
    provider: first("provider", "renderer"),
    declaredFixture: metadata.isFixture === true,
    voiceId: first("voiceId", "voice"),
  };
}

/**
 * Hashes every consumed input — and every frame a sequence input lists — as
 * the bytes stand right now. Called before ffmpeg runs and again after, so a
 * file changed DURING the render is caught rather than recorded.
 */
async function measureConsumed(plans: readonly ConsumedPlan[]): Promise<RenderReceiptInput[]> {
  const inputs: RenderReceiptInput[] = [];
  for (const plan of plans) {
    const resolvedPath = await realpath(plan.path).catch(() => {
      throw new MotionCompositorError("missing-input", `Consumed file does not exist: ${plan.path}`);
    });
    const { sha256, bytes } = await hashFile(resolvedPath);
    const frames: ReceiptFrame[] = [];
    if (plan.artifact.mimeType === "application/json") {
      const sequence = await readSequenceManifest(resolvedPath);
      for (const frame of sequence.frames) {
        const framePath = await realpath(frame.file).catch(() => {
          throw new MotionCompositorError("missing-frame", `Sequence frame does not exist: ${frame.file}`);
        });
        frames.push({ resolvedPath: framePath, sha256: (await hashFile(framePath)).sha256 });
      }
    }
    inputs.push({
      taskId: plan.artifact.taskId,
      role: plan.role,
      resolvedPath,
      sha256,
      bytes,
      kind: plan.artifact.kind,
      mimeType: plan.artifact.mimeType,
      timeline: plan.timeline,
      frames,
      ...describeProvenance(plan.artifact),
    });
  }
  return inputs;
}

const inputFingerprint = (inputs: readonly RenderReceiptInput[]): string =>
  JSON.stringify(inputs.map((input) => [input.taskId, input.resolvedPath, input.sha256, input.frames]));

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_TIMEOUT_MS = 120_000;

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MotionCompositorError("malformed-state", `${field} must be a finite number.`);
  }
  return value;
}

export function parseMotionCompositorState(input: unknown): MotionCompositorState {
  if (!input || typeof input !== "object") {
    throw new MotionCompositorError("malformed-state", "compositorState must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const durationSeconds = finiteNumber(raw.durationSeconds, "durationSeconds");
  const fps = raw.fps === undefined ? DEFAULT_FPS : finiteNumber(raw.fps, "fps");
  if (durationSeconds <= 0 || durationSeconds > 180) {
    throw new MotionCompositorError("malformed-state", `durationSeconds must be in (0, 180], got ${durationSeconds}.`);
  }
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) {
    throw new MotionCompositorError("malformed-state", `fps must be an integer in [12, 60], got ${fps}.`);
  }
  if (!Array.isArray(raw.visualTimeline) || raw.visualTimeline.length === 0) {
    throw new MotionCompositorError("malformed-state", "visualTimeline must contain at least one beat.");
  }
  const visualTimeline: CompositorBeat[] = raw.visualTimeline.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new MotionCompositorError("malformed-state", `visualTimeline[${index}] must be an object.`);
    }
    const beat = value as Record<string, unknown>;
    const visualTaskId = typeof beat.visualTaskId === "string" ? beat.visualTaskId.trim() : "";
    const startSecond = finiteNumber(beat.startSecond, `visualTimeline[${index}].startSecond`);
    const endSecond = finiteNumber(beat.endSecond, `visualTimeline[${index}].endSecond`);
    if (!visualTaskId) throw new MotionCompositorError("malformed-state", `visualTimeline[${index}].visualTaskId is required.`);
    if (startSecond < 0 || endSecond <= startSecond || endSecond > durationSeconds + 0.001) {
      throw new MotionCompositorError(
        "bad-timeline",
        `visualTimeline[${index}] has invalid timing ${startSecond}-${endSecond}s for ${durationSeconds}s.`,
      );
    }
    return { visualTaskId, startSecond, endSecond };
  }).sort((a, b) => a.startSecond - b.startSecond || a.endSecond - b.endSecond);

  if (Math.abs(visualTimeline[0].startSecond) > 0.001) {
    throw new MotionCompositorError("bad-timeline", "visual timeline must start at 0 seconds.");
  }
  for (let index = 1; index < visualTimeline.length; index += 1) {
    const gap = visualTimeline[index].startSecond - visualTimeline[index - 1].endSecond;
    if (Math.abs(gap) > 0.01) {
      throw new MotionCompositorError(
        "bad-timeline",
        `visual timeline must be contiguous; beat ${index - 1} ends at ${visualTimeline[index - 1].endSecond}s but beat ${index} starts at ${visualTimeline[index].startSecond}s.`,
      );
    }
  }
  if (Math.abs(visualTimeline[visualTimeline.length - 1].endSecond - durationSeconds) > 0.01) {
    throw new MotionCompositorError("bad-timeline", "visual timeline must end at durationSeconds.");
  }

  const voiceTaskId = typeof raw.voiceTaskId === "string" ? raw.voiceTaskId.trim() : "";
  const captionTaskId = typeof raw.captionTaskId === "string" && raw.captionTaskId.trim() ? raw.captionTaskId.trim() : undefined;
  const musicTaskId = typeof raw.musicTaskId === "string" && raw.musicTaskId.trim() ? raw.musicTaskId.trim() : undefined;
  if (!voiceTaskId) throw new MotionCompositorError("malformed-state", "voiceTaskId is required; narration will not be guessed.");

  return { durationSeconds, fps, visualTimeline, voiceTaskId, captionTaskId, musicTaskId };
}

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "video";
}

function filePathFromArtifact(artifact: RenderArtifact): string {
  if (artifact.uri.startsWith("dry-run://") || artifact.metadata?.dryRun === true) {
    throw new MotionCompositorError(
      "dry-run-input",
      `Compositor refuses dry-run artifact ${artifact.artifactId}; a real MP4 cannot be built from placeholders.`,
    );
  }
  let url: URL;
  try {
    url = new URL(artifact.uri);
  } catch {
    throw new MotionCompositorError("unsupported-uri", `Artifact ${artifact.artifactId} has invalid URI ${artifact.uri}.`);
  }
  if (url.protocol !== "file:") {
    throw new MotionCompositorError(
      "unsupported-uri",
      `Artifact ${artifact.artifactId} uses ${url.protocol}; V1 compositor accepts local file artifacts only.`,
    );
  }
  return fileURLToPath(url);
}

function artifactForTask(context: RenderTaskContext, taskId: string): RenderArtifact {
  const matches = context.dependencyArtifacts.filter((artifact) => artifact.taskId === taskId);
  if (matches.length === 0) {
    throw new MotionCompositorError("missing-artifact", `No dependency artifact exists for required task ${taskId}.`);
  }
  if (matches.length > 1) {
    // Adapters should normally return one final media artifact per task. Refuse
    // ambiguity instead of picking one based on incidental array order.
    throw new MotionCompositorError("ambiguous-artifact", `Task ${taskId} produced ${matches.length} artifacts; compositor needs exactly one.`);
  }
  return matches[0];
}

function quoteConcatPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function filterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new MotionCompositorError("process-launch", `Could not launch ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(new MotionCompositorError("process-timeout", `${command} timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new MotionCompositorError(
          "process-failed",
          `${command} exited ${code}. ${err.trim().slice(-1800) || out.trim().slice(-1800)}`,
        ));
        return;
      }
      resolvePromise(out);
    });
  });
}

async function probeMedia(ffprobePath: string, path: string, timeoutMs: number): Promise<ProbeResult> {
  const out = await runProcess(ffprobePath, [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    path,
  ], timeoutMs);
  const data = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
  };
}

function scaleFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
}

async function renderStaticImageSegment(options: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  crf: number;
  preset: string;
  timeoutMs: number;
}): Promise<void> {
  await runProcess(options.ffmpegPath, [
    "-y",
    "-loop", "1",
    "-framerate", String(options.fps),
    "-i", options.inputPath,
    "-t", options.durationSeconds.toFixed(3),
    "-vf", scaleFilter(options.width, options.height),
    "-an",
    "-r", String(options.fps),
    "-c:v", "libx264",
    "-preset", options.preset,
    "-crf", String(options.crf),
    "-pix_fmt", "yuv420p",
    options.outputPath,
  ], options.timeoutMs);
}

async function renderVideoSegment(options: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  crf: number;
  preset: string;
  timeoutMs: number;
}): Promise<void> {
  await runProcess(options.ffmpegPath, [
    "-y",
    "-stream_loop", "-1",
    "-i", options.inputPath,
    "-t", options.durationSeconds.toFixed(3),
    "-vf", scaleFilter(options.width, options.height),
    "-an",
    "-r", String(options.fps),
    "-c:v", "libx264",
    "-preset", options.preset,
    "-crf", String(options.crf),
    "-pix_fmt", "yuv420p",
    options.outputPath,
  ], options.timeoutMs);
}

async function readSequenceManifest(path: string): Promise<SequenceManifest> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<SequenceManifest>;
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new MotionCompositorError("bad-sequence", `Sequence manifest ${path} has no frames.`);
  }
  const frames = raw.frames.map((frame, index) => {
    if (!frame || typeof frame.file !== "string" || !Number.isFinite(frame.atMs)) {
      throw new MotionCompositorError("bad-sequence", `Sequence manifest ${path} has malformed frame ${index}.`);
    }
    return {
      index: Number.isInteger(frame.index) ? frame.index : index,
      label: typeof frame.label === "string" ? frame.label : `frame-${index}`,
      file: frame.file,
      atMs: frame.atMs,
    };
  });
  return { frames };
}

function frameWeights(frames: SequenceFrame[]): number[] {
  const weights = frames.map((frame, index) => {
    if (index === 0) return Math.max(1, frame.atMs);
    return Math.max(1, frame.atMs - frames[index - 1].atMs);
  });
  if (weights.length > 1) weights[weights.length - 1] = Math.max(weights[weights.length - 1], weights[weights.length - 2]);
  return weights;
}

async function renderSequenceSegment(options: {
  ffmpegPath: string;
  manifestPath: string;
  workDir: string;
  outputPath: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  crf: number;
  preset: string;
  timeoutMs: number;
}): Promise<void> {
  const manifest = await readSequenceManifest(options.manifestPath);
  const weights = frameWeights(manifest.frames);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const listPath = join(options.workDir, `${basename(options.outputPath)}.frames.txt`);
  const lines: string[] = [];
  for (const [index, frame] of manifest.frames.entries()) {
    await stat(frame.file).catch(() => {
      throw new MotionCompositorError("missing-frame", `Sequence frame does not exist: ${frame.file}`);
    });
    lines.push(`file ${quoteConcatPath(frame.file)}`);
    lines.push(`duration ${((weights[index] / weightTotal) * options.durationSeconds).toFixed(6)}`);
  }
  // concat demuxer needs the final still repeated for its duration to apply.
  lines.push(`file ${quoteConcatPath(manifest.frames[manifest.frames.length - 1].file)}`);
  await writeFile(listPath, `${lines.join("\n")}\n`, "utf8");
  await runProcess(options.ffmpegPath, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-t", options.durationSeconds.toFixed(3),
    "-vf", scaleFilter(options.width, options.height),
    "-an",
    "-r", String(options.fps),
    "-c:v", "libx264",
    "-preset", options.preset,
    "-crf", String(options.crf),
    "-pix_fmt", "yuv420p",
    options.outputPath,
  ], options.timeoutMs);
}

async function renderVisualSegment(options: {
  artifact: RenderArtifact;
  ffmpegPath: string;
  workDir: string;
  outputPath: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  crf: number;
  preset: string;
  timeoutMs: number;
}): Promise<void> {
  const inputPath = filePathFromArtifact(options.artifact);
  await stat(inputPath).catch(() => {
    throw new MotionCompositorError("missing-input", `Visual artifact file does not exist: ${inputPath}`);
  });
  const shared = {
    ffmpegPath: options.ffmpegPath,
    outputPath: options.outputPath,
    durationSeconds: options.durationSeconds,
    fps: options.fps,
    width: options.width,
    height: options.height,
    crf: options.crf,
    preset: options.preset,
    timeoutMs: options.timeoutMs,
  };
  if (options.artifact.mimeType === "application/json") {
    await renderSequenceSegment({ ...shared, manifestPath: inputPath, workDir: options.workDir });
  } else if (options.artifact.kind === "image") {
    await renderStaticImageSegment({ ...shared, inputPath });
  } else if (options.artifact.kind === "video") {
    await renderVideoSegment({ ...shared, inputPath });
  } else {
    throw new MotionCompositorError(
      "unsupported-visual",
      `Task ${options.artifact.taskId} produced ${options.artifact.kind}/${options.artifact.mimeType}, not a compositable visual.`,
    );
  }
}

async function concatSegments(options: {
  ffmpegPath: string;
  segments: string[];
  workDir: string;
  outputPath: string;
  timeoutMs: number;
}): Promise<void> {
  const concatPath = join(options.workDir, "segments.txt");
  await writeFile(concatPath, `${options.segments.map((path) => `file ${quoteConcatPath(path)}`).join("\n")}\n`, "utf8");
  await runProcess(options.ffmpegPath, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c", "copy",
    options.outputPath,
  ], options.timeoutMs);
}

async function muxFinal(options: {
  ffmpegPath: string;
  baseVideoPath: string;
  voicePath: string;
  captionPath?: string;
  musicPath?: string;
  outputPath: string;
  durationSeconds: number;
  crf: number;
  preset: string;
  timeoutMs: number;
}): Promise<void> {
  const args = ["-y", "-i", options.baseVideoPath, "-i", options.voicePath];
  if (options.musicPath) args.push("-stream_loop", "-1", "-i", options.musicPath);

  const filters: string[] = [];
  const videoMap = options.captionPath ? "[vout]" : "0:v:0";
  if (options.captionPath) filters.push(`[0:v]ass='${filterPath(options.captionPath)}'[vout]`);
  if (options.musicPath) {
    filters.push(`[1:a]volume=${VOICE_GAIN.toFixed(2)}[voice]`);
    filters.push(`[2:a]volume=${MUSIC_GAIN.toFixed(2)}[music]`);
    filters.push("[voice][music]amix=inputs=2:duration=first:normalize=0,apad[aout]");
  } else {
    filters.push("[1:a]apad[aout]");
  }
  args.push("-filter_complex", filters.join(";"));
  args.push(
    "-map", videoMap,
    "-map", "[aout]",
    "-t", options.durationSeconds.toFixed(3),
    "-r", "30",
    "-c:v", "libx264",
    "-preset", options.preset,
    "-crf", String(options.crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    options.outputPath,
  );
  await runProcess(options.ffmpegPath, args, options.timeoutMs);
}

export function createMotionCompositorAdapter(config: MotionCompositorConfig): RenderAdapter {
  const ffmpegPath = config.ffmpegPath?.trim() || process.env.SPECSMITH_FFMPEG_PATH?.trim() || "ffmpeg";
  const ffprobePath = config.ffprobePath?.trim() || process.env.SPECSMITH_FFPROBE_PATH?.trim() || "ffprobe";
  const width = config.width ?? DEFAULT_WIDTH;
  const height = config.height ?? DEFAULT_HEIGHT;
  const crf = config.crf ?? 20;
  const preset = config.preset ?? "veryfast";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "specsmith-ffmpeg-compositor",
    capability: "motion-compositor",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const rawState = (context.task as { compositorState?: unknown }).compositorState;
      if (rawState === undefined) {
        throw new MotionCompositorError(
          "missing-state",
          `Compositor task ${context.task.taskId} has no compositorState; beat timing will not be inferred from artifact order.`,
        );
      }
      const state = parseMotionCompositorState(rawState);
      await mkdir(config.outputDir, { recursive: true });

      const voiceArtifact = artifactForTask(context, state.voiceTaskId);
      if (voiceArtifact.kind !== "audio") {
        throw new MotionCompositorError("bad-voice", `Voice task ${state.voiceTaskId} did not produce an audio artifact.`);
      }
      const voicePath = filePathFromArtifact(voiceArtifact);
      const voiceProbe = await probeMedia(ffprobePath, voicePath, timeoutMs);
      if (voiceProbe.durationSeconds <= 0) {
        throw new MotionCompositorError("bad-voice", `Voice artifact ${voiceArtifact.artifactId} has no measurable duration.`);
      }

      const captionPath = state.captionTaskId
        ? filePathFromArtifact(artifactForTask(context, state.captionTaskId))
        : undefined;
      const musicPath = state.musicTaskId
        ? filePathFromArtifact(artifactForTask(context, state.musicTaskId))
        : undefined;

      // Never clip narration. If the generated voice runs slightly long, hold
      // the final visual instead. A large overrun is a TTS/planning failure and
      // should be regenerated rather than hidden by a very long freeze-frame.
      if (voiceProbe.durationSeconds > state.durationSeconds * 1.25 + 0.25) {
        throw new MotionCompositorError(
          "voice-overrun",
          `Narration is ${voiceProbe.durationSeconds.toFixed(2)}s for a ${state.durationSeconds.toFixed(2)}s plan (>25% over). Refusing to trim speech or hide the mismatch.`,
        );
      }
      const finalDuration = Math.max(state.durationSeconds, voiceProbe.durationSeconds + 0.05);
      const extension = finalDuration - state.durationSeconds;

      // THE CONSUMPTION PLAN. Exactly the files the ffmpeg calls below read,
      // with the role compositorState gives each one. The first timeline
      // visual is the hook; every other visual is evidence. A task asked to
      // play two roles is refused rather than recorded under either.
      const plans = new Map<string, ConsumedPlan>();
      const addPlan = (artifact: RenderArtifact, role: ReceiptRole, use?: ReceiptTimelineUse): void => {
        const existing = plans.get(artifact.taskId);
        if (existing) {
          if (existing.role !== role) {
            throw new MotionCompositorError(
              "role-conflict",
              `Task ${artifact.taskId} is used as both ${existing.role} and ${role}; one input cannot fill two roles.`,
            );
          }
          if (use) existing.timeline.push(use);
          return;
        }
        plans.set(artifact.taskId, { artifact, role, path: filePathFromArtifact(artifact), timeline: use ? [use] : [] });
      };
      const hookTaskId = state.visualTimeline[0]?.visualTaskId;
      for (const [index, beat] of state.visualTimeline.entries()) {
        addPlan(
          artifactForTask(context, beat.visualTaskId),
          beat.visualTaskId === hookTaskId ? "hook-visual" : "evidence-visual",
          { index, startSecond: beat.startSecond, endSecond: beat.endSecond },
        );
      }
      addPlan(voiceArtifact, "narration");
      if (state.captionTaskId) addPlan(artifactForTask(context, state.captionTaskId), "captions");
      if (state.musicTaskId) addPlan(artifactForTask(context, state.musicTaskId), "music-bed");
      const consumedPlans = [...plans.values()];
      const consumedBefore = await measureConsumed(consumedPlans);

      const workDir = await mkdtemp(join(resolve(config.outputDir), ".compose-"));
      try {
        const segments: string[] = [];
        for (const [index, beat] of state.visualTimeline.entries()) {
          const artifact = artifactForTask(context, beat.visualTaskId);
          const isLast = index === state.visualTimeline.length - 1;
          const durationSeconds = beat.endSecond - beat.startSecond + (isLast ? extension : 0);
          const segmentPath = join(workDir, `segment-${String(index).padStart(3, "0")}.mp4`);
          await renderVisualSegment({
            artifact,
            ffmpegPath,
            workDir,
            outputPath: segmentPath,
            durationSeconds,
            fps: state.fps,
            width,
            height,
            crf,
            preset,
            timeoutMs,
          });
          segments.push(segmentPath);
        }

        const baseVideoPath = join(workDir, "visual-master.mp4");
        await concatSegments({ ffmpegPath, segments, workDir, outputPath: baseVideoPath, timeoutMs });

        const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
        const outputPath = resolve(config.outputDir, `${filename}.mp4`);
        await muxFinal({
          ffmpegPath,
          baseVideoPath,
          voicePath,
          captionPath,
          musicPath,
          outputPath,
          durationSeconds: finalDuration,
          crf,
          preset,
          timeoutMs,
        });

        const probe = await probeMedia(ffprobePath, outputPath, timeoutMs);
        if (probe.width !== width || probe.height !== height) {
          throw new MotionCompositorError(
            "validation-failed",
            `Final MP4 is ${probe.width ?? "?"}x${probe.height ?? "?"}; expected ${width}x${height}.`,
          );
        }
        if (probe.videoCodec !== "h264") {
          throw new MotionCompositorError("validation-failed", `Final MP4 video codec is ${probe.videoCodec ?? "missing"}; expected h264.`);
        }
        if (!probe.audioCodec) {
          throw new MotionCompositorError("validation-failed", "Final MP4 has no audio stream.");
        }
        if (probe.durationSeconds <= 0 || Math.abs(probe.durationSeconds - finalDuration) > 0.6) {
          throw new MotionCompositorError(
            "validation-failed",
            `Final MP4 duration ${probe.durationSeconds.toFixed(2)}s does not match planned ${finalDuration.toFixed(2)}s.`,
          );
        }
        // Re-hash every input now that ffmpeg is done. If any byte changed
        // while it ran, the master is of unknown origin and is not receipted.
        const consumedAfter = await measureConsumed(consumedPlans);
        if (inputFingerprint(consumedAfter) !== inputFingerprint(consumedBefore)) {
          throw new MotionCompositorError(
            "input-changed-during-render",
            "A consumed input changed while the master was being rendered; refusing to issue a receipt for it.",
          );
        }
        const masterPath = await realpath(outputPath);
        const master = await hashFile(masterPath);
        const { size } = await stat(outputPath);
        const visualTaskIds = state.visualTimeline.map((beat) => beat.visualTaskId).join(",");
        const unsigned: Omit<RenderReceipt, "digest"> = {
          version: 1,
          packageId: context.packageId,
          platform: context.platform,
          composeTaskId: context.task.taskId,
          masterPath,
          masterSha256: master.sha256,
          masterBytes: master.bytes,
          parameters: {
            width,
            height,
            fps: state.fps,
            crf,
            preset,
            plannedDurationSeconds: state.durationSeconds,
            finalDurationSeconds: finalDuration,
            captionsBurnedIn: Boolean(captionPath),
            musicIncluded: Boolean(musicPath),
            voiceGain: VOICE_GAIN,
            musicGain: musicPath ? MUSIC_GAIN : 0,
            ffmpegPath,
            ffprobePath,
          },
          inputs: consumedBefore,
        };
        const receipt = deepFreeze({ ...unsigned, digest: sha256Hex(canonicalReceipt(unsigned)) }) as RenderReceipt;
        ISSUED_RECEIPTS.add(receipt);
        const masterArtifact: RenderArtifact = {
          artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-mp4`,
          taskId: context.task.taskId,
          kind: "video",
          uri: pathToFileURL(outputPath).toString(),
          mimeType: "video/mp4",
          metadata: {
            renderer: "specsmith-ffmpeg-compositor",
            width,
            height,
            fps: state.fps,
            durationSeconds: Number(probe.durationSeconds.toFixed(3)),
            videoCodec: probe.videoCodec,
            audioCodec: probe.audioCodec,
            bytes: size,
            voiceTaskId: state.voiceTaskId,
            captionTaskId: state.captionTaskId ?? "",
            musicTaskId: state.musicTaskId ?? "",
            visualTaskIds,
            captionsBurnedIn: Boolean(captionPath),
            musicIncluded: Boolean(musicPath),
            sha256: master.sha256,
            renderReceiptDigest: receipt.digest,
          },
        };
        RECEIPT_BY_MASTER.set(masterArtifact, receipt);
        return [masterArtifact];
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
