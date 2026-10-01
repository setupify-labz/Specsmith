// Offline inspection of one rendered file with ffprobe and ffmpeg.
//
// Bounded: every process has a timeout, and nothing leaves the machine. If a
// tool is missing the inspection says so and the review blocks; it never
// reports a check it could not run as passed.
//
// WHAT THESE MEASUREMENTS ARE NOT
// -------------------------------
// Signal levels say the audio is present and not clipped; they say nothing
// about whether the voice sounds natural. A freeze detector finds unchanged
// pixels; it cannot tell a deliberate hold from a dull one. Those are human
// gates, and the packet says so.

import { spawn } from "node:child_process";

export class MediaToolMissingError extends Error {
  constructor(readonly tool: string, detail: string) {
    super(`${tool} is not available (${detail}). Media inspection cannot run, so nothing about the file is established.`);
    this.name = "MediaToolMissingError";
  }
}

export interface MediaTools {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly timeoutMs?: number;
}

async function run(tool: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new MediaToolMissingError(tool, "not found on PATH") : error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") reject(new Error(`${tool} timed out after ${timeoutMs}ms.`));
      else resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

/** Throws MediaToolMissingError when either tool cannot be launched. */
export async function assertMediaTools(tools: MediaTools): Promise<void> {
  for (const tool of [tools.ffprobePath, tools.ffmpegPath]) {
    const result = await run(tool, ["-version"], 15_000);
    if (result.code !== 0) throw new MediaToolMissingError(tool, `-version exited ${result.code}`);
  }
}

export interface ProbeResult {
  readonly durationSeconds: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly audioChannels: number | null;
  readonly videoStreams: number;
  readonly audioStreams: number;
}

export async function probe(tools: MediaTools, path: string): Promise<ProbeResult> {
  const result = await run(tools.ffprobePath, ["-v", "error", "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,channels:format=duration", "-of", "json", path], tools.timeoutMs ?? 60_000);
  if (result.code !== 0) throw new Error(`ffprobe could not read ${path}: ${result.stderr.trim().slice(-400)}`);
  const parsed = JSON.parse(result.stdout) as { streams?: Record<string, unknown>[]; format?: { duration?: string } };
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const rate = typeof video?.r_frame_rate === "string" ? video.r_frame_rate.split("/").map(Number) : null;
  return {
    durationSeconds: Number(parsed.format?.duration ?? NaN),
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    fps: rate && rate[1] ? Math.round((rate[0] / rate[1]) * 1000) / 1000 : null,
    videoCodec: typeof video?.codec_name === "string" ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
    audioChannels: typeof audio?.channels === "number" ? audio.channels : null,
    videoStreams: streams.filter((stream) => stream.codec_type === "video").length,
    audioStreams: streams.filter((stream) => stream.codec_type === "audio").length,
  };
}

/** Decode every packet; any decoder error is returned. */
export async function decodeErrors(tools: MediaTools, path: string): Promise<string[]> {
  const result = await run(tools.ffmpegPath, ["-v", "error", "-i", path, "-f", "null", "-"], tools.timeoutMs ?? 120_000);
  const lines = result.stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  if (result.code !== 0 && lines.length === 0) lines.push(`ffmpeg exited ${result.code} while decoding.`);
  return lines;
}

export interface Interval { readonly start: number; readonly end: number }

const intervals = (text: string, startKey: string, endKey: string, duration: number): Interval[] => {
  const starts = [...text.matchAll(new RegExp(`${startKey}[:=]\\s*(-?[\\d.]+)`, "g"))].map((match) => Number(match[1]));
  const ends = [...text.matchAll(new RegExp(`${endKey}[:=]\\s*(-?[\\d.]+)`, "g"))].map((match) => Number(match[1]));
  return starts.map((start, index) => ({ start: Math.max(0, start), end: ends[index] ?? duration }));
};

/** Stretches of (nearly) black picture of at least half a second. */
export async function blackIntervals(tools: MediaTools, path: string, duration: number): Promise<Interval[]> {
  const result = await run(tools.ffmpegPath, ["-v", "info", "-i", path, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"], tools.timeoutMs ?? 120_000);
  return intervals(result.stderr, "black_start", "black_end", duration);
}

/** Stretches where the whole frame does not change, of at least half a second. */
export async function freezeIntervals(tools: MediaTools, path: string, duration: number): Promise<Interval[]> {
  const result = await run(tools.ffmpegPath, ["-v", "info", "-i", path, "-vf", "freezedetect=n=0.001:d=0.5", "-an", "-f", "null", "-"], tools.timeoutMs ?? 120_000);
  return intervals(result.stderr, "lavfi.freezedetect.freeze_start", "lavfi.freezedetect.freeze_end", duration);
}

export interface AudioLevels { readonly maxVolumeDb: number; readonly meanVolumeDb: number }

export async function audioLevels(tools: MediaTools, path: string): Promise<AudioLevels> {
  const result = await run(tools.ffmpegPath, ["-v", "info", "-i", path, "-af", "volumedetect", "-vn", "-f", "null", "-"], tools.timeoutMs ?? 120_000);
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(result.stderr)?.[1];
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(result.stderr)?.[1];
  const value = (raw: string | undefined) => raw === undefined || raw === "-inf" ? -Infinity : Number(raw);
  return { maxVolumeDb: value(max), meanVolumeDb: value(mean) };
}

/** Where the audio is not silent (narration, in a voice-only mix). */
export async function soundIntervals(tools: MediaTools, path: string, duration: number): Promise<Interval[]> {
  const result = await run(tools.ffmpegPath, ["-v", "info", "-i", path, "-af", "silencedetect=noise=-40dB:d=0.25", "-vn", "-f", "null", "-"], tools.timeoutMs ?? 120_000);
  const silences = intervals(result.stderr, "silence_start", "silence_end", duration);
  const sound: Interval[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.start > cursor + 0.01) sound.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < duration - 0.01) sound.push({ start: cursor, end: duration });
  return sound;
}
