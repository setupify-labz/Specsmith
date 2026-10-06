// Times the voiced cut to a real take: every beat and caption comes from the
// provider's character timestamps, so nothing on screen runs ahead of, or
// behind, what Liam says.
//
//   node voice/plan.mjs <take dir>   -> src/voiceplan.json
//
// The take must be the approved text (APPROVED below must match the take's
// manifest and fpsWinsPoc/liamTake.ts word for word) with timestamps that spell it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APPROVED =
  "The RTX forty-eighty Super leads all twenty games at fourteen-forty-p High: " +
  "Cyberpunk twenty-seventy-seven, Counter-Strike 2, Call of Duty: Warzone, Baldur's Gate 3. " +
  "Sounds like a blowout. " +
  "But the model estimates one-sixty-four versus one-sixty FPS. " +
  "That's only four FPS apart. " +
  "Model estimates, not measured benchmarks. " +
  "Would you have guessed four?";

/** Caption chunks: what is shown (verified digits) for each spoken stretch, in order. */
export const CHUNKS = [
  { show: "The RTX 4080 Super", say: "The RTX forty-eighty Super" },
  { show: "leads all 20 games", say: "leads all twenty games" },
  { show: "at 1440p High", say: "at fourteen-forty-p High:" },
  { show: "Cyberpunk 2077", say: "Cyberpunk twenty-seventy-seven,", spotlight: 0 },
  { show: "Counter-Strike 2", say: "Counter-Strike 2,", spotlight: 1 },
  { show: "Call of Duty: Warzone", say: "Call of Duty: Warzone,", spotlight: 2 },
  { show: "Baldur's Gate 3", say: "Baldur's Gate 3.", spotlight: 3 },
  { show: "Sounds like a blowout.", say: "Sounds like a blowout." },
  { show: "But the model estimates", say: "But the model estimates" },
  { show: "164 versus 160 FPS", say: "one-sixty-four versus one-sixty FPS." },
  { show: "That's only 4 FPS apart.", say: "That's only four FPS apart." },
  { show: "Model estimates, not measured benchmarks.", say: "Model estimates, not measured benchmarks." },
  { show: "Would you have guessed four?", say: "Would you have guessed four?" },
];

export const TIMING = Object.freeze({
  voiceAt: 0.08, // the first word starts here
  preRoll: 0.03, // audio kept before the first character
  dropSilence: 0.75, // at least this much silence before "But"
  landHold: 0.55, // the pause the 20/20 lands in, before "Sounds like a blowout"
  endHold: 1.3, // after the last word
  silenceDb: -40, // a stretch quieter than this, for 0.2 s or more, is a pause
  tail: 0.08, // audio kept after a word before a shortened pause
  head: 0.04, // audio kept before the next word
  // Pause targets by what ends the phrase: a list comma is quick, a sentence breathes.
  pauseAfter: (ch) => (ch === "," ? 0.14 : ch === ":" ? 0.2 : ch === "." ? 0.26 : ch === "?" ? 0.3 : 0.16),
  rollMin: 0.35, // the counter's last roll to 20
  captionMaxChars: 24,
});

/** Two balanced lines at most; never a single word alone on the last line. */
export function wrapCaption(text, maxChars = TIMING.captionMaxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    if (words.length - i < 2 && words.length >= 3) continue; // no stranded last word
    const score = Math.max(a.length, b.length);
    if (!best || score < best.score) best = { lines: [a, b], score };
  }
  return best.lines;
}

export function planFromTake(manifest, silences) {
  if (manifest.text !== APPROVED) throw new Error("The take is not the approved text.");
  const al = manifest.alignment;
  if (!al || al.characters.join("") !== APPROVED) throw new Error("The take's timestamps do not spell the approved text.");
  // The provider's timestamps can put a word edge inside a measured silence;
  // snap such edges to where the sound actually starts or stops.
  const quiet = (silences ?? []).filter(([a, b]) => b - a >= 0.2);
  const snap = (t, edge) => {
    for (const [a, b] of quiet) if (t > a && t < b) return edge === "start" ? b : a;
    return t;
  };
  const starts = al.character_start_times_seconds.map((t) => snap(t, "start"));
  const ends = al.character_end_times_seconds.map((t) => snap(t, "end"));

  // Where each chunk sits in the text.
  let cursor = 0;
  const spans = CHUNKS.map((chunk) => {
    const i = APPROVED.indexOf(chunk.say, cursor);
    if (i < 0) throw new Error(`"${chunk.say}" not found in order.`);
    cursor = i + chunk.say.length;
    return { ...chunk, from: i, to: i + chunk.say.length - 1 };
  });
  const firstChar = starts[0];
  const takeFrom = Math.max(0, firstChar - TIMING.preRoll);

  // Liam leaves long breaths between phrases. Each measured silence longer than
  // its target is cut down to the target (only silence is removed; the words
  // are never sped up); the pause before "But" becomes the drop, real silence.
  const blowout = spans[7], but = spans[8];
  const pieces = [{ takeStart: takeFrom, offset: TIMING.voiceAt - firstChar }];
  const gaps = silences ?? [];
  // A silence belongs to the word boundary (space) whose timing falls inside it.
  const boundaryIn = (s, e) => {
    let best = -1, bestDist = Infinity;
    for (let k = 1; k < APPROVED.length - 1; k++) {
      if (APPROVED[k] !== " ") continue;
      const mid = (ends[k - 1] + starts[k + 1]) / 2;
      const dist = mid < s ? s - mid : mid > e ? mid - e : 0;
      if (dist < bestDist) { best = k; bestDist = dist; }
    }
    return bestDist <= 0.15 ? best : -1;
  };
  let dropFound = false;
  for (const [s, e] of gaps) {
    if (s <= takeFrom + 0.05 || e >= ends[APPROVED.length - 1]) continue;
    const k = boundaryIn(s, e);
    if (k < 0) continue;
    const isDrop = k + 1 === but.from;
    const isLand = k === spans[6].to + 1; // after "Baldur's Gate 3.": the 20/20 lands here
    const target = isDrop ? TIMING.dropSilence : isLand ? TIMING.landHold : TIMING.pauseAfter(APPROVED[k - 1]);
    if (!isDrop && !isLand && e - s <= target + TIMING.tail + TIMING.head) continue;
    const cut = pieces[pieces.length - 1];
    cut.takeEnd = s + (isDrop ? 0.05 : TIMING.tail);
    const nextStart = e - (isDrop ? TIMING.preRoll : TIMING.head);
    pieces.push({ takeStart: nextStart, offset: s + cut.offset + target - e, isDrop });
    dropFound ||= isDrop;
  }
  if (!dropFound) throw new Error('No measured silence before "But" to make the drop from.');
  pieces[pieces.length - 1].takeEnd = ends[APPROVED.length - 1] + 0.25;
  const toVideo = (t) => {
    let piece = pieces[0];
    for (const p of pieces) if (t >= p.takeStart) piece = p;
    return t + piece.offset;
  };
  const at = (charIndex, which = "start") => Math.round(toVideo((which === "start" ? starts : ends)[charIndex]) * 1000) / 1000;

  const phraseStart = (phrase, from = 0) => {
    const i = APPROVED.indexOf(phrase, from);
    if (i < 0) throw new Error(`"${phrase}" missing`);
    return { i, t: at(i) };
  };
  const spots = spans.filter((s) => s.spotlight !== undefined).map((s) => at(s.from));
  const bg3End = at(spans[6].to, "end");
  const soundsStart = at(blowout.from);
  const land = Math.round(Math.min(bg3End + TIMING.rollMin, soundsStart - 0.1) * 1000) / 1000;
  const p164 = phraseStart("one-sixty-four");
  const p160 = phraseStart("one-sixty", p164.i + "one-sixty-four".length);
  const onlyFour = phraseStart("four FPS apart");
  const disclaimer = phraseStart("Model estimates, not");
  const question = phraseStart("Would you");
  const lastEnd = at(APPROVED.length - 1, "end");

  const captions = spans.map((s, k) => {
    const next = spans[k + 1];
    const start = at(s.from);
    // A caption stays until the next one starts, but never across the drop or long after its words.
    const spokenEnd = at(s.to, "end");
    const end = next ? Math.min(at(next.from), spokenEnd + 0.6) : lastEnd + TIMING.endHold;
    return { show: s.show, lines: wrapCaption(s.show), start, spokenEnd, end: Math.round(Math.max(end, spokenEnd) * 1000) / 1000, spotlight: s.spotlight ?? null };
  });

  return {
    take: { sha256: manifest.audio.sha256, voiceId: manifest.voiceId, voiceUsed: manifest.voiceUsed },
    voice: pieces.map((p) => ({
      takeStart: Math.round(p.takeStart * 1000) / 1000,
      takeEnd: Math.round(p.takeEnd * 1000) / 1000,
      at: Math.round((p.takeStart + p.offset) * 1000) / 1000,
    })),
    pausesCut: pieces.length - 1,
    events: {
      voiceStart: at(0), spots, rollTo20: bg3End, land, blowout: soundsStart,
      dropStart: at(blowout.to, "end"), reveal: at(but.from), n164: p164.t, n160: p160.t,
      apart: onlyFour.t, disclaimer: disclaimer.t, question: question.t, lastWord: lastEnd,
    },
    dropSilence: Math.round((at(but.from) - at(blowout.to, "end")) * 1000) / 1000,
    duration: Math.round((lastEnd + TIMING.endHold) * 1000) / 1000,
    captions,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = resolve(process.argv[2]);
  if (!dir) throw new Error("usage: node voice/plan.mjs <take dir>");
  const manifestFile = readFileSync(join(dir, "fps-20-wins-liam.json"), "utf8");
  const manifest = JSON.parse(manifestFile);
  const audio = readFileSync(join(dir, manifest.audio.file));
  if (createHash("sha256").update(audio).digest("hex") !== manifest.audio.sha256) throw new Error("The take audio is not the audio its manifest names.");
  // Silences measured in the take itself, so cuts land only where Liam is quiet.
  const run = spawnSync("ffmpeg", ["-hide_banner", "-i", join(dir, manifest.audio.file), "-af", `silencedetect=n=${TIMING.silenceDb}dB:d=0.2`, "-f", "null", "-"], { encoding: "utf8" });
  const silences = [];
  const text = run.stderr;
  for (const m of text.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) silences.push([Number(m[1]), Number(m[2])]);
  const plan = { ...planFromTake(manifest, silences), silences, takeDir: relative(root, dir) };
  writeFileSync(join(root, "src", "voiceplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`plan: ${plan.duration}s, voice at ${plan.events.voiceStart}s, land ${plan.events.land}s, drop ${plan.dropSilence}s, 164 at ${plan.events.n164}s, apart at ${plan.events.apart}s, question at ${plan.events.question}s`);
}
