// The monitor-entry cut: a shorter narration edited from the saved Liam take
// (no new take, no time-stretch), and every visual beat timed to it.
//
//   node monitor/plan.mjs   -> src/monitorplan.json
//
// Each phrase is a whole stretch of the take between two measured silences, so
// no word is cut; only the pauses between phrases are set here. The take's
// silences and the provider's character timestamps both come from
// src/voiceplan.json (voice/plan.mjs), which was built from the same take.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED, wrapCaption } from "../voice/plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The edited narration: stretches of the take between measured silences, in order. */
export const PHRASES = [
  { key: "gpu", say: "The RTX forty-eighty" }, // Liam breathes here, before "Super"
  { key: "leads", say: "Super leads all twenty games at fourteen-forty-p High:" },
  { key: "blowout", say: "Sounds like a blowout." },
  { key: "model", say: "But the model estimates one-sixty-four versus one-sixty FPS." },
  { key: "apart", say: "That's only four FPS apart." },
  { key: "question", say: "Would you have guessed four?" },
];
/** Caption chunks: what is shown (verified digits) from where its words start in the take. */
export const CAPTIONS = [
  { from: "The RTX forty-eighty Super", show: "The RTX 4080 Super" },
  { from: "leads all twenty games", show: "leads all 20 games" },
  { from: "at fourteen-forty-p High:", show: "at 1440p High" },
  { from: "Sounds like a blowout.", show: "Sounds like a blowout." },
  { from: "But the model estimates", show: "But the model estimates" },
  { from: "one-sixty-four versus one-sixty FPS.", show: "164 versus 160 FPS" },
  { from: "That's only four FPS apart.", show: "That's only 4 FPS apart." },
  { from: "Would you have guessed four?", show: "Would you have guessed four?" },
];

export const MONITOR_TIMING = Object.freeze({
  voiceAt: 0.08,
  head: 0.04, // audio kept before a phrase's first sound
  tail: 0.08, // audio kept after a phrase's last sound
  // Silence between phrases on the timeline (the gap before each phrase).
  gapBefore: { leads: 0.22, model: 0.65, apart: 0.35, question: 0.8 }, // the payoff holds before the question
  entry: [0.2, 1.5], // the push into the monitor screen
  spotLen: 1.0, // each game title holds this long
  rollLen: 0.35, // the last segments fill to 20
  landToBlowout: 0.3, // the 20/20 lands, then "Sounds like a blowout."
  pullBack: 0.62, // the pullback starts this long before the question and settles as it is asked
  endHold: 0.75, // enough to read the question and the site line, no idle wait
});

const round = (x) => Math.round(x * 1000) / 1000;

export function planMonitorCut(manifest, silences) {
  if (manifest.text !== APPROVED) throw new Error("The take is not the approved text.");
  const al = manifest.alignment;
  if (al.characters.join("") !== APPROVED) throw new Error("The take's timestamps do not spell the approved text.");
  const T = MONITOR_TIMING;
  const starts = al.character_start_times_seconds, ends = al.character_end_times_seconds;
  // A phrase's sound starts where the measured silence before it ends, and stops where the next silence starts.
  const soundStart = (t) => silences.reduce((best, [a, b]) => (t >= a - 0.15 && t <= b + 0.05 ? b : best), t);
  const soundEnd = (t) => silences.reduce((best, [a, b]) => (t >= a - 0.05 && t <= b + 0.15 ? a : best), t);
  let cursor = 0;
  const phrases = PHRASES.map((p) => {
    const i = APPROVED.indexOf(p.say, cursor);
    if (i < 0) throw new Error(`"${p.say}" is not in the take, in order.`);
    cursor = i + p.say.length;
    const from = soundStart(starts[i]);
    const to = p.key === "question" ? ends[i + p.say.length - 1] : soundEnd(ends[i + p.say.length - 1]);
    // A phrase must be bounded by silence on both sides (or the take's start/end): no word is split.
    const bounded = (t, side) => t <= 0.05 || t >= ends[APPROVED.length - 1] - 0.05 || silences.some(([a, b]) => (side === "start" ? Math.abs(b - t) < 1e-6 : Math.abs(a - t) < 1e-6));
    if (!bounded(from, "start") || !bounded(to, "end")) throw new Error(`"${p.say}" is not bounded by measured silence; it would split a word.`);
    return { ...p, i, from, to };
  });

  // Lay the phrases on the timeline.
  const at = {};
  let clock = T.voiceAt;
  const voice = [];
  const placed = {};
  const place = (p, startAt) => {
    placed[p.key] = { start: startAt, end: startAt + (p.to - p.from), offset: startAt - p.from };
    voice.push({ takeStart: round(Math.max(0, p.from - T.head)), takeEnd: round(Math.min(p.to + T.tail, ends[APPROVED.length - 1] + 0.25)), at: round(startAt - (p.from - Math.max(0, p.from - T.head))) });
    return placed[p.key].end;
  };
  const byKey = Object.fromEntries(phrases.map((p) => [p.key, p]));
  const toVideo = (key, takeT) => round(takeT + placed[key].offset);
  clock = place(byKey.gpu, clock);
  clock = place(byKey.leads, clock + T.gapBefore.leads);
  // Inside the screen: the counter runs through the whole roster; four titles are shown on the way.
  const counterStart = toVideo("leads", starts[APPROVED.indexOf("leads all")]);
  const spots = [0, 1, 2, 3].map((k) => round(counterStart + 0.05 + k * T.spotLen));
  const rollTo20 = round(spots[3] + T.spotLen);
  const land = round(rollTo20 + T.rollLen);
  clock = place(byKey.blowout, land + T.landToBlowout);
  const dropStart = round(clock);
  clock = place(byKey.model, clock + T.gapBefore.model);
  clock = place(byKey.apart, clock + T.gapBefore.apart);
  clock = place(byKey.question, clock + T.gapBefore.question);
  const word = (key, text) => {
    const p = byKey[key];
    const j = APPROVED.indexOf(text, p.i);
    return toVideo(key, starts[j]);
  };

  const events = {
    voiceStart: round(placed.gpu.start),
    entry: T.entry,
    counterStart: round(counterStart),
    spots,
    rollTo20,
    land,
    blowout: round(placed.blowout.start),
    dropStart,
    reveal: round(placed.model.start), // "But"
    numbers: word("model", "one-sixty-four"), // both averages appear together here
    n160: word("model", "one-sixty FPS"),
    apart: word("apart", "only"),
    four: word("apart", "four FPS"),
    pullBack: round(placed.question.start - T.pullBack),
    question: round(placed.question.start),
    lastWord: round(placed.question.end),
  };
  // Captions: the edited narration, in short chunks, timed to the voice.
  const keyOfTake = (t) => phrases.reduce((k, p) => (t >= p.from - 0.2 ? p.key : k), phrases[0].key);
  let cc = 0;
  const captionStarts = CAPTIONS.map((c) => {
    const j = APPROVED.indexOf(c.from, cc);
    if (j < 0) throw new Error(`caption "${c.from}" not found in order`);
    cc = j + c.from.length;
    const t = starts[j];
    return { ...c, startTake: t, endTake: ends[j + c.from.length - 1] };
  });
  const captions = captionStarts.map((c, k) => {
    const start = toVideo(keyOfTake(c.startTake), c.startTake);
    // Timestamps can run into a silence; the phrase's measured end is where the sound stops.
    const phraseEnd = placed[keyOfTake(c.endTake)].end;
    const spokenEnd = Math.min(toVideo(keyOfTake(c.endTake), c.endTake), phraseEnd);
    const next = captionStarts[k + 1];
    const nextStart = next ? toVideo(keyOfTake(next.startTake), next.startTake) : Infinity;
    const end = Math.min(nextStart, spokenEnd + (next ? 0.3 : 0.4));
    return { show: c.show, lines: wrapCaption(c.show, 26), start: round(start), spokenEnd: round(spokenEnd), end: round(Math.max(end, spokenEnd)) };
  });
  // Phrase-level timing table (take time -> video time).
  const narration = phrases.map((p) => ({ key: p.key, say: p.say, takeFrom: round(p.from), takeTo: round(p.to), start: round(placed[p.key].start), end: round(placed[p.key].end) }));
  return {
    take: { sha256: manifest.audio.sha256, voiceId: manifest.voiceId, voiceUsed: manifest.voiceUsed },
    narration,
    voice,
    events,
    dropSilence: round(placed.model.start - placed.blowout.end),
    duration: round(placed.question.end + T.endHold),
    captions,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const vp = JSON.parse(readFileSync(join(root, "src", "voiceplan.json"), "utf8"));
  const takeDir = resolve(root, vp.takeDir);
  const manifest = JSON.parse(readFileSync(join(takeDir, "fps-20-wins-liam.json"), "utf8"));
  const audio = readFileSync(join(takeDir, manifest.audio.file));
  if (createHash("sha256").update(audio).digest("hex") !== manifest.audio.sha256) throw new Error("The take audio is not the audio its manifest names.");
  if (vp.take.sha256 !== manifest.audio.sha256) throw new Error("voiceplan.json was built from a different take.");
  const plan = { ...planMonitorCut(manifest, vp.silences), takeDir: vp.takeDir };
  writeFileSync(join(root, "src", "monitorplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  for (const n of plan.narration) console.log(`${n.start.toFixed(2)}-${n.end.toFixed(2)}  (take ${n.takeFrom.toFixed(2)}-${n.takeTo.toFixed(2)})  ${n.say}`);
  console.log(`duration ${plan.duration}s; land ${plan.events.land}; drop ${plan.dropSilence}s; numbers ${plan.events.numbers}; apart ${plan.events.apart}; question ${plan.events.question}`);
}
