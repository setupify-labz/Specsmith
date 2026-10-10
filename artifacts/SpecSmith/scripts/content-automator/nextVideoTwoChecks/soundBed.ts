// One restrained background layer for the voiced two-checks cut, synthesized
// by ffmpeg (no samples, no music):
//   - a soft sustained tone under the silent lit-PC/dark-monitor glimpse, so
//     the one voiceless beat is not dead air (220/330/440 Hz, filtered warm,
//     above the range phone speakers drop);
//   - a quiet fan, band-limited airflow (not hiss), that fades in only when the
//     PC lights up and runs to the end, so the powered PC sounds powered.
// The dead-PC opening gets nothing: the click and the voice only.
// Levels are set before the compositor's fixed SOUND_MIX_GAIN (0.14, -17 dB).

import type { ComboTiming } from "./comboDraft.ts";

export const BED = Object.freeze({
  /** The glimpse tone: fades in at the cut to the glimpse, out across the return to the dead PC. */
  tone: { fadeIn: 0.12, tail: 0.3, fadeOut: 0.35, gainDb: -15 },
  /** The fan: from the light-up to the end, with a slow fade in and out. */
  fan: { fadeIn: 0.8, fadeOut: 0.5, lowHz: 250, highHz: 900, gainDb: 0 },
});

/** The bed's spans on the cut's timeline. Nothing sounds before the glimpse or between the glimpse and the light-up. */
export function bedSpans(timing: ComboTiming) {
  const tone = { from: timing.glimpse[0], to: timing.glimpse[1] + BED.tone.tail };
  const fan = { from: timing.light, to: timing.durationSeconds };
  if (tone.to >= fan.from) throw new Error("The glimpse tone would run into the fan.");
  return { tone, fan };
}

/** The ffmpeg arguments that write the bed as one mono track of the cut's length. `tone: false` leaves only the fan (the music version). */
export function bedTrackArgs(timing: ComboTiming, outputPath: string, layers: { tone?: boolean } = {}): string[] {
  const d = timing.durationSeconds, { tone, fan } = bedSpans(timing);
  const toneLen = tone.to - tone.from, fanLen = fan.to - fan.from;
  const toneChain = `aevalsrc=0.5*sin(2*PI*220*t)+0.32*sin(2*PI*330*t)+0.18*sin(2*PI*440*t):d=${toneLen.toFixed(3)}:s=48000,` +
    `lowpass=f=1500,tremolo=f=3:d=0.15,afade=t=in:st=0:d=${BED.tone.fadeIn},afade=t=out:st=${(toneLen - BED.tone.fadeOut).toFixed(3)}:d=${BED.tone.fadeOut}:curve=qsin,` +
    `volume=${BED.tone.gainDb}dB,adelay=${Math.round(tone.from * 1000)}:all=1`;
  const fanChain = `anoisesrc=d=${fanLen.toFixed(3)}:c=brown:r=48000:a=0.5:seed=7,highpass=f=${BED.fan.lowHz},lowpass=f=${BED.fan.highHz},` +
    `afade=t=in:st=0:d=${BED.fan.fadeIn}:curve=qsin,afade=t=out:st=${(fanLen - BED.fan.fadeOut).toFixed(3)}:d=${BED.fan.fadeOut},` +
    `volume=${BED.fan.gainDb}dB,adelay=${Math.round(fan.from * 1000)}:all=1`;
  const withTone = layers.tone ?? true;
  const graph = `anullsrc=r=48000:cl=mono,atrim=0:${d.toFixed(3)}[base];${withTone ? `${toneChain}[tone];` : ""}${fanChain}[fan];` +
    `[base]${withTone ? "[tone]" : ""}[fan]amix=inputs=${withTone ? 3 : 2}:duration=first:normalize=0,atrim=0:${d.toFixed(3)}[out]`;
  return ["-v", "error", "-y", "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath];
}

/**
 * The calm music version: the composed, synthesized bed from musicBed.ts (pad chords and a soft pulse; no samples),
 * faded in and out by that module, dipped to half level under every spoken line, and set this far below the voice
 * once mixed (LUFS of the unducked bed at the compositor's fixed gain, before mastering).
 */
export const MUSIC_LEVEL_LUFS_AS_MIXED = -40;
