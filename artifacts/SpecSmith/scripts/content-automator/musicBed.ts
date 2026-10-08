// A restrained electronic background bed, composed and synthesized here.
//
// HOW IT IS MADE
// Pure arithmetic on samples, no external audio: soft pad chords from
// detuned sine partials; a gentle eighth-note pulse of short, low-passed sine
// plucks on chord tones; and a faint filtered-noise "air" layer from a seeded
// generator, so the same inputs always give the same samples. Everything is
// high-passed at 110 Hz (no heavy bass). There is no melody: the pulse only
// repeats tones of the current chord.
//
// The harmony is a generic four-chord minor progression (Am(add9), Fmaj7,
// C(add9), G(sus2)), two bars each at 96 BPM, chosen because such
// progressions are common building blocks rather than anyone's composition.
//
// WHAT THIS DOES NOT ESTABLISH
// Making the audio here records how it was made. It does not by itself prove
// exclusive ownership or copyright clearance: a simple progression and pulse
// can resemble existing music by coincidence, and rights are a person's call.
// The rights record therefore marks its licence unknown until someone decides.

/** Frequencies, Hz, of each chord's pad voicing (mid register; nothing below A3 but the F3 and G3 roots). */
export const PROGRESSION = Object.freeze([
  { name: "Am(add9)", pad: [220.0, 261.63, 329.63, 493.88], pulse: [440.0, 329.63] },
  { name: "Fmaj7", pad: [174.61, 220.0, 261.63, 329.63], pulse: [349.23, 261.63] },
  { name: "C(add9)", pad: [261.63, 329.63, 392.0, 587.33], pulse: [523.25, 392.0] },
  { name: "G(sus2)", pad: [196.0, 293.66, 440.0, 493.88], pulse: [392.0, 293.66] },
]);

export const MUSIC_BED = Object.freeze({
  sampleRate: 48000,
  bpm: 96,
  /** Beats per chord: two bars of 4/4. */
  beatsPerChord: 8,
  /** Relative layer levels before loudness scaling. */
  padLevel: 1.0,
  pulseLevel: 0.32,
  airLevel: 0.05,
  /** Pulse pluck: attack and exponential decay, seconds; low-passed so it never clicks or beeps. */
  pulseAttack: 0.012,
  pulseDecay: 0.09,
  pulseLowpassHz: 1800,
  highpassHz: 110,
  /** Crossfade between chords, seconds. */
  chordCrossfade: 0.8,
  /** Ducking: gain in duck windows, and ramp time. */
  duckGain: 0.5,
  duckRamp: 0.4,
  fadeIn: 1.5,
  fadeOut: 2.0,
  /** Silence kept after the fade-out, so nothing is still playing in the last frames. */
  endSilence: 0.4,
});

/** Mulberry32: a tiny seeded generator, so the noise layer is the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bed before level, ducking and fades: pad, pulse and air, high-passed. Mono, MUSIC_BED.sampleRate. */
export function composeBed(durationSeconds: number, seed = 20261008): Float32Array {
  const M = MUSIC_BED, sr = M.sampleRate;
  const n = Math.round(durationSeconds * sr);
  const out = new Float32Array(n);
  const beat = 60 / M.bpm, chordSeconds = beat * M.beatsPerChord, eighth = beat / 2;
  const chordAt = (t: number) => PROGRESSION[Math.floor(t / chordSeconds) % PROGRESSION.length];
  const detune = [0.997, 1.0, 1.003];

  // Pad: each chord fades up over the crossfade as the previous one fades out (equal power).
  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const index = Math.floor(t / chordSeconds), into = t - index * chordSeconds;
    const blend = Math.min(1, into / M.chordCrossfade);
    const now = PROGRESSION[index % PROGRESSION.length], before = PROGRESSION[(index + PROGRESSION.length - 1) % PROGRESSION.length];
    const voice = (chord: (typeof PROGRESSION)[number]) => {
      let sum = 0;
      for (const f of chord.pad) for (const d of detune) sum += Math.sin(2 * Math.PI * f * d * t) + 0.15 * Math.sin(4 * Math.PI * f * d * t);
      return sum / (chord.pad.length * detune.length * 1.15);
    };
    const wNow = Math.sin(blend * Math.PI / 2), wBefore = index === 0 ? 0 : Math.cos(blend * Math.PI / 2);
    // A slow swell (0.1 Hz) keeps the texture breathing.
    out[i] = M.padLevel * (wNow * voice(now) + wBefore * voice(before)) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.1 * t));
  }

  // Pulse: soft plucks on eighth notes, alternating the chord's two pulse tones, downbeats a touch stronger.
  const pluckSamples = Math.round((M.pulseAttack + 6 * M.pulseDecay) * sr);
  for (let k = 0; k * eighth < durationSeconds; k += 1) {
    const start = k * eighth, chord = chordAt(start);
    const f = chord.pulse[k % 2], accent = k % 8 === 0 ? 1.0 : k % 2 === 0 ? 0.8 : 0.65;
    const s0 = Math.round(start * sr);
    let lp = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * M.pulseLowpassHz / sr);
    for (let j = 0; j < pluckSamples && s0 + j < n; j += 1) {
      const t = j / sr;
      const env = t < M.pulseAttack ? t / M.pulseAttack : Math.exp(-(t - M.pulseAttack) / M.pulseDecay);
      const raw = Math.sin(2 * Math.PI * f * t) * env;
      lp += alpha * (raw - lp);
      out[s0 + j] += M.pulseLevel * accent * lp;
    }
  }

  // Air: seeded white noise, band-limited by two one-pole filters (about 400 Hz to 3 kHz).
  const random = seeded(seed);
  let low = 0, high = 0;
  const aLow = 1 - Math.exp(-2 * Math.PI * 3000 / sr), aHigh = 1 - Math.exp(-2 * Math.PI * 400 / sr);
  for (let i = 0; i < n; i += 1) {
    low += aLow * ((random() * 2 - 1) - low);
    high += aHigh * (low - high);
    out[i] += M.airLevel * (low - high) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.07 * i / sr + 1));
  }

  // High-pass the whole bed (2nd-order Butterworth biquad): no heavy bass.
  const w0 = 2 * Math.PI * M.highpassHz / sr, q = Math.SQRT1_2, alphaQ = Math.sin(w0) / (2 * q), cos = Math.cos(w0);
  const a0 = 1 + alphaQ;
  const b = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0], a = [(-2 * cos) / a0, (1 - alphaQ) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x = out[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

export interface DuckWindow { readonly startSecond: number; readonly endSecond: number; readonly reason: string }

/** The bed's gain over time: fade in, duck in each window (with ramps), fade out, then silence. */
export function bedEnvelope(t: number, durationSeconds: number, ducks: readonly DuckWindow[]): number {
  const M = MUSIC_BED;
  const fadeOutEnd = durationSeconds - M.endSilence, fadeOutStart = fadeOutEnd - M.fadeOut;
  if (t >= fadeOutEnd) return 0;
  const fadeIn = t < M.fadeIn ? Math.sin((t / M.fadeIn) * Math.PI / 2) ** 2 : 1;
  const fadeOut = t > fadeOutStart ? Math.cos(((t - fadeOutStart) / M.fadeOut) * Math.PI / 2) ** 2 : 1;
  let duck = 1;
  for (const window of ducks) {
    const into = Math.min(1, Math.max(0, (t - (window.startSecond - M.duckRamp)) / M.duckRamp));
    const out = Math.min(1, Math.max(0, ((window.endSecond + M.duckRamp) - t) / M.duckRamp));
    const depth = Math.min(into, out);
    duck = Math.min(duck, 1 - (1 - M.duckGain) * depth);
  }
  return fadeIn * fadeOut * duck;
}

/** The finished bed: composed, scaled by `gain`, shaped by its envelope. */
export function renderBed(durationSeconds: number, ducks: readonly DuckWindow[], gain: number): Float32Array {
  const bed = composeBed(durationSeconds);
  for (let i = 0; i < bed.length; i += 1) bed[i] *= gain * bedEnvelope(i / MUSIC_BED.sampleRate, durationSeconds, ducks);
  return bed;
}
