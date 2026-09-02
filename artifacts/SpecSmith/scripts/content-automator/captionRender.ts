import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export interface CaptionCue {
  startSecond: number;
  endSecond: number;
  text: string;
}

export interface CaptionRenderState {
  durationSeconds: number;
  cues: CaptionCue[];
}

export class CaptionRenderStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CaptionRenderStateError";
    this.code = code;
  }
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CaptionRenderStateError("malformed", `${field} must be a finite number.`);
  }
  return value;
}

export function parseCaptionRenderState(input: unknown): CaptionRenderState {
  if (!input || typeof input !== "object") {
    throw new CaptionRenderStateError("malformed", "captionRenderState must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const durationSeconds = finiteNumber(raw.durationSeconds, "durationSeconds");
  if (durationSeconds <= 0 || durationSeconds > 180) {
    throw new CaptionRenderStateError("malformed", `durationSeconds must be in (0, 180], got ${durationSeconds}.`);
  }
  if (!Array.isArray(raw.cues)) {
    throw new CaptionRenderStateError("malformed", "captionRenderState.cues must be an array.");
  }

  const cues: CaptionCue[] = raw.cues.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new CaptionRenderStateError("malformed", `cue ${index} must be an object.`);
    }
    const cue = value as Record<string, unknown>;
    const startSecond = finiteNumber(cue.startSecond, `cue ${index}.startSecond`);
    const endSecond = finiteNumber(cue.endSecond, `cue ${index}.endSecond`);
    const text = typeof cue.text === "string" ? cue.text.trim() : "";
    if (!text) throw new CaptionRenderStateError("malformed", `cue ${index}.text must not be empty.`);
    if (startSecond < 0 || endSecond <= startSecond || endSecond > durationSeconds + 0.001) {
      throw new CaptionRenderStateError(
        "bad-timing",
        `cue ${index} has invalid timing ${startSecond}-${endSecond}s for a ${durationSeconds}s video.`,
      );
    }
    return { startSecond, endSecond, text };
  }).sort((a, b) => a.startSecond - b.startSecond || a.endSecond - b.endSecond);

  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startSecond < cues[index - 1].endSecond - 0.001) {
      throw new CaptionRenderStateError(
        "overlap",
        `caption cues ${index - 1} and ${index} overlap; explicit timing must be unambiguous.`,
      );
    }
  }
  return { durationSeconds, cues };
}

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "captions";
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function wrapCaption(text: string, maxChars = 28): string {
  const cleaned = text
    .replace(/\\/g, "/")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const words = cleaned.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  // Short-form captions should not become a paragraph. Two lines keeps the UI visible.
  if (lines.length <= 2) return lines.join("\\N");
  return `${lines[0]}\\N${lines.slice(1).join(" ")}`;
}

export function buildAssDocument(state: CaptionRenderState): string {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: SpecSmith,Arial,72,&H00FFFFFF,&H00FFFFFF,&HC0000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,90,90,290,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = state.cues.map((cue) =>
    `Dialogue: 0,${assTime(cue.startSecond)},${assTime(cue.endSecond)},SpecSmith,,0,0,0,,${wrapCaption(cue.text)}`,
  );
  return `${header}${events.join("\n")}\n`;
}

export function createCaptionRenderAdapter(options: { outputDir: string }): RenderAdapter {
  return {
    name: "specsmith-ass-captions",
    capability: "caption-render",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const rawState = (context.task as { captionRenderState?: unknown }).captionRenderState;
      if (rawState === undefined) {
        throw new CaptionRenderStateError(
          "missing-state",
          `Caption task ${context.task.taskId} has no captionRenderState; timing will not be guessed from prose.`,
        );
      }
      const state = parseCaptionRenderState(rawState);
      const document = buildAssDocument(state);
      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId].map(safeFilePart).join("-");
      const outputPath = resolve(options.outputDir, `${filename}.ass`);
      await writeFile(outputPath, document, "utf8");
      const bytes = Buffer.byteLength(document, "utf8");
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-ass`,
        taskId: context.task.taskId,
        kind: "captions",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "text/x-ass",
        metadata: {
          renderer: "specsmith-ass-captions",
          cueCount: state.cues.length,
          durationSeconds: state.durationSeconds,
          bytes,
          width: 1080,
          height: 1920,
        },
      }];
    },
  };
}
