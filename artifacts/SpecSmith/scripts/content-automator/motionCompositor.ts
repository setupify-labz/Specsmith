import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
    filters.push("[1:a]volume=1.0[voice]");
    filters.push("[2:a]volume=0.14[music]");
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
        const { size } = await stat(outputPath);
        const visualTaskIds = state.visualTimeline.map((beat) => beat.visualTaskId).join(",");
        return [{
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
          },
        }];
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
