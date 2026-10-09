// Restrained sound effects for a short, synthesized here: a "music-sfx" render
// adapter with no samples, no music and no licensing question.
//
// WHY SYNTHESIZED
// The production plan has a music-sfx task, but this path had no licensed or
// offline sound source, so the task was dropped. A soft whoosh on a cut, a
// tick when a figure lands and a pop when a percentage appears can be made
// from noise and sine tones by ffmpeg itself, deterministically: the same cues
// give the same bytes (fixed noise seeds), and the repository owns them.
//
// WHAT "RESTRAINED" MEANS HERE
// Each effect is short (35-320 ms), one at a time, and the compositor mixes
// this whole track at its fixed music gain (0.14, about -17 dB) under the
// narration at full level. The gains below put each effect's peak, AS MIXED,
// at about -21 to -24 dBFS (SOUND_PEAKS_AS_MIXED_DBFS, checked by a test):
// roughly 18-21 dB under a speech peak near -3 dBFS, present but never
// competing with a word. The render report measures the real mix.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";
import { measureLoudness } from "./motionCompositor.ts";
import { composeBed, MUSIC_BED, PROGRESSION, renderBed, type DuckWindow } from "./musicBed.ts";

export type SoundCueKind = "whoosh" | "tick" | "pop" | "click" | "startup";

export interface SoundCue {
  readonly atSecond: number;
  readonly kind: SoundCueKind;
  /** Why it is there, for the report: "cut to beat 2", "+51% appears". */
  readonly reason: string;
}

/** Each effect's sound, as an ffmpeg lavfi source chain, and its length. */
export const SOUND_RECIPES: Readonly<Record<SoundCueKind, { readonly seconds: number; readonly chain: (seed: number) => string }>> = {
  // Band-limited pink noise swelling in and out: air moving, not an impact.
  whoosh: {
    seconds: 0.32,
    chain: (seed) => `anoisesrc=d=0.32:c=pink:r=48000:a=0.5:seed=${seed},highpass=f=500,lowpass=f=4000,` +
      "afade=t=in:st=0:d=0.16:curve=qsin,afade=t=out:st=0.16:d=0.16:curve=qsin,volume=12dB",
  },
  // A very short high click: a figure landing.
  tick: {
    seconds: 0.035,
    chain: () => "sine=f=2000:d=0.035:r=48000,afade=t=out:st=0.005:d=0.03,volume=11dB",
  },
  // A soft low blip with a fast decay: a percentage appearing.
  pop: {
    seconds: 0.12,
    chain: () => "sine=f=660:d=0.12:r=48000,afade=t=out:st=0.01:d=0.11:curve=exp,volume=14dB",
  },
  // A dry, band-limited noise snap: a rocker switch clicking over.
  click: {
    seconds: 0.05,
    chain: (seed) => `anoisesrc=d=0.05:c=white:r=48000:a=0.5:seed=${seed},highpass=f=1200,lowpass=f=6000,afade=t=out:st=0.004:d=0.046:curve=exp,volume=4.4dB`,
  },
  // A soft tone gliding up from 220 to 550 Hz, then settling and fading over
  // about a second: something powering on, not a jingle. Long enough to carry
  // a held final shot without another line.
  startup: {
    seconds: 1.4,
    chain: () => "aevalsrc=0.5*sin(2*PI*(220*t+330*min(t\\,0.5)*min(t\\,0.5)+330*max(t-0.5\\,0))):d=1.4:s=48000," +
      "afade=t=in:st=0:d=0.06,afade=t=out:st=0.45:d=0.95:curve=qsin,volume=0.1dB",
  },
};

/** The compositor's fixed gain for this track (motionCompositor.muxFinal). */
export const SOUND_MIX_GAIN = 0.14;
/** Each effect's intended sample peak once mixed at SOUND_MIX_GAIN, in dBFS. */
export const SOUND_PEAKS_AS_MIXED_DBFS: Readonly<Record<SoundCueKind, number>> = { whoosh: -22, tick: -24, pop: -21, click: -21, startup: -23 };

export class SoundEffectsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoundEffectsError";
  }
}

/** Refuses cues that would play outside the video or overlap one another. */
export function validateCues(cues: readonly SoundCue[], durationSeconds: number): void {
  const sorted = [...cues].sort((a, b) => a.atSecond - b.atSecond);
  for (const cue of sorted) {
    if (!(cue.kind in SOUND_RECIPES)) throw new SoundEffectsError(`Unknown sound "${cue.kind}".`);
    if (!Number.isFinite(cue.atSecond) || cue.atSecond < 0) throw new SoundEffectsError(`Cue "${cue.reason}" is at ${cue.atSecond}s.`);
    if (cue.atSecond + SOUND_RECIPES[cue.kind].seconds > durationSeconds) throw new SoundEffectsError(`Cue "${cue.reason}" runs past the end of the video.`);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    if (previous.atSecond + SOUND_RECIPES[previous.kind].seconds > sorted[i].atSecond) {
      throw new SoundEffectsError(`"${previous.reason}" and "${sorted[i].reason}" overlap; restrained means one sound at a time.`);
    }
  }
}

/** The ffmpeg arguments that write the whole track: every cue at its time, silence elsewhere. */
export function soundTrackArgs(cues: readonly SoundCue[], durationSeconds: number, outputPath: string): string[] {
  validateCues(cues, durationSeconds);
  const sorted = [...cues].sort((a, b) => a.atSecond - b.atSecond);
  const sources = [`anullsrc=r=48000:cl=mono,atrim=0:${durationSeconds.toFixed(3)}[bed]`];
  const labels = ["[bed]"];
  sorted.forEach((cue, index) => {
    const delayMs = Math.round(cue.atSecond * 1000);
    sources.push(`${SOUND_RECIPES[cue.kind].chain(101 + index)},adelay=${delayMs}:all=1[c${index}]`);
    labels.push(`[c${index}]`);
  });
  const graph = `${sources.join(";")};${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0,atrim=0:${durationSeconds.toFixed(3)}[out]`;
  return ["-v", "error", "-y", "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath];
}

/** A composed background bed under the effects (musicBed.ts): where to duck it, and how loud it sits once mixed. */
export interface MusicBedState {
  readonly ducks: readonly DuckWindow[];
  /** Integrated loudness of the unducked bed once mixed at SOUND_MIX_GAIN, LUFS (before the final mastering gain). */
  readonly levelLufsAsMixed: number;
}

const runFfmpeg = (ffmpegPath: string, args: string[]) => new Promise<void>((done, fail) => {
  const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  const err: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
  child.on("error", fail);
  child.on("close", (code) => code === 0 ? done() : fail(new SoundEffectsError(Buffer.concat(err).toString("utf8").slice(-600))));
});

export function createSoundEffectsAdapter(options: { readonly outputDir: string; readonly ffmpegPath?: string }): RenderAdapter {
  const ffmpegPath = options.ffmpegPath ?? process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";
  return {
    name: "specsmith-synth-sound-effects",
    capability: "music-sfx",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const state = (context.task as { soundEffectsState?: { cues?: SoundCue[]; musicBed?: MusicBedState } }).soundEffectsState;
      if (!state || !Array.isArray(state.cues)) throw new SoundEffectsError(`Task ${context.task.taskId} has no soundEffectsState; sounds are never guessed.`);
      const seconds = context.targetDurationSeconds;
      if (!Number.isFinite(seconds) || seconds <= 0) throw new SoundEffectsError("The sound track needs the planned duration.");
      await mkdir(options.outputDir, { recursive: true });
      const effectsPath = resolve(options.outputDir, `${context.task.taskId}__sfx.wav`);
      await runFfmpeg(ffmpegPath, soundTrackArgs(state.cues, seconds, effectsPath));
      const cueList = JSON.stringify(state.cues.map((cue) => ({ ...cue, seconds: SOUND_RECIPES[cue.kind].seconds })));

      if (!state.musicBed) {
        const sha256 = createHash("sha256").update(await readFile(effectsPath)).digest("hex");
        return [{
          artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-sfx`,
          taskId: context.task.taskId,
          kind: "audio",
          uri: pathToFileURL(effectsPath).toString(),
          mimeType: "audio/wav",
          metadata: {
            renderer: "specsmith-synth-sound-effects",
            generator: "ffmpeg lavfi (anoisesrc, sine)",
            cues: state.cues.length,
            // Each effect's window, so a review can tell a declared effect from stray sound.
            cueList,
            isMusic: false,
            isLicensedSample: false,
            sha256,
          },
        }];
      }

      // The bed: composed, measured at a constant level, scaled to its target
      // once mixed, then ducked and faded. The effects layer is untouched.
      const bed = state.musicBed;
      if (!Number.isFinite(bed.levelLufsAsMixed) || bed.levelLufsAsMixed > -30 || bed.levelLufsAsMixed < -70) {
        throw new SoundEffectsError("A music bed needs levelLufsAsMixed in [-70, -30]: a bed is background, never foreground.");
      }
      const rawPath = resolve(options.outputDir, `${context.task.taskId}__bed-raw.f32`);
      writeFileSync(rawPath, Buffer.from(composeBed(seconds).buffer));
      const levelPath = resolve(options.outputDir, `${context.task.taskId}__bed-level.wav`);
      await runFfmpeg(ffmpegPath, ["-v", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_BED.sampleRate), "-ac", "1", "-i", rawPath, "-c:a", "pcm_s24le", levelPath]);
      const composed = await measureLoudness(ffmpegPath, levelPath);
      const targetInFile = bed.levelLufsAsMixed - 20 * Math.log10(SOUND_MIX_GAIN);
      const gain = Math.pow(10, (targetInFile - composed.integratedLufs) / 20);
      const shaped = renderBed(seconds, bed.ducks, gain);
      writeFileSync(rawPath, Buffer.from(shaped.buffer));
      const bedPath = resolve(options.outputDir, `${context.task.taskId}__bed.wav`);
      await runFfmpeg(ffmpegPath, ["-v", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_BED.sampleRate), "-ac", "1", "-i", rawPath, "-c:a", "pcm_s24le", bedPath]);
      const path = resolve(options.outputDir, `${context.task.taskId}__music-and-sfx.wav`);
      await runFfmpeg(ffmpegPath, ["-v", "error", "-y", "-i", effectsPath, "-i", bedPath, "-filter_complex",
        `[0:a][1:a]amix=inputs=2:duration=first:normalize=0,atrim=0:${seconds.toFixed(3)}[out]`, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s24le", path]);
      const sha = (file: string) => readFile(file).then((bytes) => createHash("sha256").update(bytes).digest("hex"));
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-music-sfx`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(path).toString(),
        mimeType: "audio/wav",
        metadata: {
          renderer: "specsmith-synth-music-and-effects",
          generator: "musicBed.ts (sample arithmetic: sine partials, seeded noise, biquad high-pass) + ffmpeg lavfi effects",
          cues: state.cues.length,
          cueList,
          isMusic: true,
          isLicensedSample: false,
          // Where the bed plays, so a review knows silence cannot be measured under it.
          musicBed: JSON.stringify({
            progression: PROGRESSION.map((chord) => chord.name), bpm: MUSIC_BED.bpm, ducks: bed.ducks,
            levelLufsAsMixed: bed.levelLufsAsMixed, composedLufs: composed.integratedLufs, gainDb: Number((20 * Math.log10(gain)).toFixed(2)),
            playsFromSecond: 0, silentFromSecond: Number((seconds - MUSIC_BED.endSilence).toFixed(3)),
            fadeIn: MUSIC_BED.fadeIn, fadeOut: MUSIC_BED.fadeOut, duckGain: MUSIC_BED.duckGain,
          }),
          effectsSha256: await sha(effectsPath),
          bedSha256: await sha(bedPath),
          sha256: await sha(path),
        },
      }];
    },
  };
}
