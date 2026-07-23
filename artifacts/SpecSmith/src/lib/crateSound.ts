import type { CrateRarity } from './buildCrate';

// Synthesized with the Web Audio API rather than shipped audio files — no
// external assets to license or fetch, and it's genuinely tiny. Only ever
// called from a click handler (opening a crate), so it's always inside a
// user-gesture context and isn't blocked by autoplay policy.
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

const MUTE_KEY = 'specsmith-crate-muted';

export function isCrateSoundMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setCrateSoundMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

function tone(ctx: AudioContext, freq: number, start: number, duration: number, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

// Ascending note runs, one note per rarity step — the higher the rarity,
// the longer and brighter the run, with Legendary getting a sustained
// shimmer chord tacked on the end.
const RARITY_NOTES: Record<CrateRarity, number[]> = {
  common: [392],
  uncommon: [392, 523],
  rare: [392, 523, 659],
  epic: [392, 523, 659, 784],
  legendary: [392, 523, 659, 784, 988, 1319],
};

export function playRaritySound(rarity: CrateRarity): void {
  if (isCrateSoundMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const notes = RARITY_NOTES[rarity];
    const noteDur = rarity === 'legendary' ? 0.2 : 0.15;
    const peak = rarity === 'legendary' ? 0.18 : rarity === 'epic' ? 0.15 : 0.12;
    notes.forEach((freq, i) => tone(ctx, freq, ctx.currentTime + i * noteDur * 0.8, noteDur, peak));
    if (rarity === 'legendary') {
      const chordStart = ctx.currentTime + notes.length * noteDur * 0.8;
      [988, 1245, 1568].forEach(freq => tone(ctx, freq, chordStart, 0.7, 0.07));
    }
  } catch { /* audio best-effort only */ }
}

export function playSpinWhoosh(): void {
  if (isCrateSoundMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* audio best-effort only */ }
}
