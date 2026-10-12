// The animated cuts the daily job can produce, and the checks it runs on what
// it rendered.
//
// A topic is producible only if an animation template is registered for it.
// The template is the single source of truth: the proposal's storyboard is built
// from the template's own captions, labels and timing, so what the proposal says
// and what the MP4 shows cannot drift apart. A topic without a template is never
// proposed (select.ts records it as "no animation template yet"); there is no
// text-card fallback.
//
// After rendering, verifyRender() checks the exported files themselves: the
// picture's size, length and frame count; one frame from the middle of every
// beat, distinct and in order, saved as a phone-size sheet; and, in the
// sound-effects version, a peak at every cue, silence between cues, and the
// template's clearest cue as the loudest.

import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BEATS as RAM_BEATS, COPY as RAM_COPY, FPS as RAM_FPS, LABEL_WINDOWS as RAM_LABELS, TIMING as RAM_TIMING } from "../nextVideoRamSeat/silentCut.ts";
import { cues as ramCues, renderWithSound as renderRam } from "../nextVideoRamSeat/soundMix.ts";
import { renderCut } from "../animationScenes/renderCut.ts";
import type { CutSpec } from "../animationScenes/spec.ts";
import { CPU_POWER_CUT } from "../nextVideoCpuPower/cut.ts";
import { DailyProposalError } from "./snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));

export type Purpose = "hook" | "commitment" | "evidence" | "reversal" | "payoff" | "cta";
export interface TemplateBeat { readonly from: number; readonly to: number; readonly storyBeat: string; readonly purpose: Purpose; readonly caption: string; readonly onScreenText: string; readonly visualDirection: string }
export interface TemplateLabel { readonly text: string; readonly from: number; readonly to: number }
export interface SoundCue { readonly kind: string; readonly at: number; readonly seconds: number; readonly reason: string }
export interface AnimationTemplate {
  readonly id: string;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly disclosures: readonly string[];
  readonly beats: readonly TemplateBeat[];
  /** Every on-screen label and the span it is visible, as drawn. */
  readonly labels: readonly TemplateLabel[];
  readonly cues: readonly SoundCue[];
  /** The cue that must be the loudest in the sound-effects mix. */
  readonly clearestCue: string;
  readonly sources: readonly string[];
  readonly render: (outputDir: string) => Promise<{ silentPath: string; sfxPath: string }>;
}

/** Each caption's span of the RAM cut: its story beat, the storyboard purpose, and what is seen. */
const RAM_VISUALS: readonly [string, Purpose, string][] = [
  ["problem", "hook", "The stylized PC powers on (fans light) beside a monitor that stays dark."],
  ["power-off", "commitment", "A second press shuts it down and the fans slow to a stop; at the back, the power cord comes out of the power supply."],
  ["location", "evidence", "The glass side panel slides off; the camera closes on the four memory slots; one stick is outlined: not fully in."],
  ["action", "payoff", "Side view of the slot: guides through the stick's notch and the slot's ridge turn green as they line up; the stick goes in."],
  ["action", "payoff", "Thumbs press the stick down; the clips at both ends snap shut; the stick sits level, outlined in green."],
  ["power-back", "cta", "Back on the board, all sticks level; the panel slides back on; at the back, the cord goes back in."],
  ["try-again", "cta", "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown."],
];
const ramLabels: TemplateLabel[] = RAM_LABELS.map((w) => ({ text: RAM_COPY.labels[w.key], from: w.from, to: w.to }));
/** The labels that first appear within a span, in order of appearance. */
const labelsIn = (labels: readonly TemplateLabel[], from: number, to: number) => labels.filter((l) => l.from >= from - 1e-6 && l.from < to - 1e-6).map((l) => l.text);

/**
 * Any spec-driven Short (animationScenes/spec.ts) as a template: its beats,
 * labels, cues and sources come straight from the spec, and it renders through
 * the one shared renderer. A new topic needs a spec, not code here.
 */
export function templateFromSpec(spec: CutSpec): AnimationTemplate {
  const labels: TemplateLabel[] = spec.labels.map((l) => ({ text: l.text, from: l.from, to: l.to }));
  return {
    id: spec.id,
    durationSeconds: spec.durationSeconds,
    fps: spec.fps,
    disclosures: [spec.badge, spec.line],
    beats: spec.captions.map((caption, i) => ({
      from: caption.from, to: caption.to, storyBeat: spec.beats[i].storyBeat, purpose: spec.beats[i].purpose, caption: caption.text,
      onScreenText: labelsIn(labels, caption.from, caption.to).join(" → ") || "(no label: caption only)",
      visualDirection: spec.beats[i].visualDirection,
    })),
    labels,
    cues: spec.cues,
    clearestCue: spec.clearestCue,
    sources: spec.sources.map((s) => `${s.publisher}, ${s.title}: ${s.url}`),
    render: async (outputDir) => { const r = await renderCut(spec, outputDir); return { silentPath: r.silentPath, sfxPath: r.sfxPath }; },
  };
}

export const TEMPLATES: Readonly<Record<string, AnimationTemplate>> = {
  // Spec-driven: the shared scene library and renderer.
  "cpu-power": templateFromSpec(CPU_POWER_CUT),
  // Hand-built before the scene library existed (nextVideoRamSeat/silentCut.ts); kept as reviewed.
  "ram-seat": {
    id: "ram-seat",
    durationSeconds: RAM_TIMING.durationSeconds,
    fps: RAM_FPS,
    disclosures: [RAM_COPY.badge, RAM_COPY.line],
    beats: RAM_COPY.captions.map((caption, i) => ({
      from: caption.from, to: caption.to, storyBeat: RAM_VISUALS[i][0], purpose: RAM_VISUALS[i][1], caption: caption.text,
      onScreenText: labelsIn(ramLabels, caption.from, caption.to).join(" → ") || "(no label: caption only)",
      visualDirection: RAM_VISUALS[i][2],
    })),
    labels: ramLabels,
    cues: ramCues(),
    clearestCue: "snap",
    sources: RAM_COPY.sources,
    // The RAM renderer's temporary folders ("work" frames, "sound-work") are removed on failure as well as success.
    render: async (outputDir) => {
      try { const r = await renderRam(outputDir); return { silentPath: r.silentPath, sfxPath: r.videoPath }; }
      finally { for (const dir of ["work", "sound-work"]) await rm(join(outputDir, dir), { recursive: true, force: true }); }
    },
  },
};
/** The RAM cut's story beats, for the record (problem, power-off, location, action, payoff, power-back, try-again). */
export const RAM_STORY_BEATS = RAM_BEATS;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c)); child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", fail);
    child.on("close", (code) => code === 0 ? done(Buffer.concat(out).toString("utf8") + Buffer.concat(err).toString("utf8")) : fail(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-400)}`)));
  });
}

/** Fails clearly if any part of the renderer is missing; no other renderer is substituted. */
export async function assertRendererAvailable(): Promise<void> {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try { await run(tool, ["-version"]); } catch (error) {
      throw new DailyProposalError("renderer-unavailable", `${tool} is not available (${(error as Error).message.split("\n")[0]}). Install ffmpeg; no other encoder is substituted.`);
    }
  }
  const fonts = resolve(here, "../nextVideoRefreshRate/fonts");
  for (const file of ["inter-latin-400-normal.woff2", "inter-latin-600-normal.woff2", "inter-latin-700-normal.woff2"]) {
    try { await access(join(fonts, file)); } catch { throw new DailyProposalError("renderer-unavailable", `The Inter font ${file} is missing from ${fonts}.`); }
  }
  const chromium = process.env.SPECSMITH_RENDER_CHROMIUM;
  if (chromium) { try { await access(chromium); } catch { throw new DailyProposalError("renderer-unavailable", `SPECSMITH_RENDER_CHROMIUM points to ${chromium}, which does not exist.`); } }
}

export async function renderTemplate(template: AnimationTemplate, outputDir: string) {
  await assertRendererAvailable();
  try {
    return await template.render(outputDir);
  } catch (error) {
    const message = (error as Error).message;
    if (/browserType\.launch|Executable doesn't exist|chromium/i.test(message)) throw new DailyProposalError("renderer-unavailable", `Chromium could not be launched (${message.split("\n")[0]}). Set SPECSMITH_RENDER_CHROMIUM or install Playwright's Chromium.`);
    throw error;
  }
}

export interface Verification {
  readonly passed: boolean;
  readonly checks: readonly { readonly check: string; readonly passed: boolean; readonly detail: string }[];
  readonly cuePeaks: readonly { readonly kind: string; readonly at: number; readonly peakDbfs: number; readonly measuredFrom: number; readonly measuredTo: number; readonly reason: string }[];
  readonly loudness: { readonly integratedLufs: number; readonly peakDbfs: number };
  readonly beatSheet: string;
  readonly phoneSheet: string;
}

async function probe(path: string) {
  const out = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames:format=duration", "-of", "json", path]);
  const json = JSON.parse(out.slice(out.indexOf("{")));
  return { width: json.streams[0].width as number, height: json.streams[0].height as number, frames: Number(json.streams[0].nb_read_frames), duration: Number(json.format.duration) };
}
async function peakIn(path: string, from: number, to: number): Promise<number> {
  const log = await run("ffmpeg", ["-hide_banner", "-ss", from.toFixed(3), "-to", to.toFixed(3), "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  const m = log.match(/max_volume: (-?[\d.]+|-inf) dB/);
  return !m || m[1] === "-inf" ? -Infinity : Number(m[1]);
}
/** One frame's region, decoded to raw pixels at a tenth of its size. */
function region(path: string, at: number, crop: { y: number; h: number }, format: "gray" | "rgb24"): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", ["-v", "error", "-ss", at.toFixed(3), "-i", path, "-frames:v", "1", "-vf", `crop=1080:${crop.h}:0:${crop.y},scale=108:${Math.round(crop.h / 10)},format=${format}`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.on("error", fail);
    child.on("close", (code) => {
      const pixels = Buffer.concat(out), expected = 108 * Math.round(crop.h / 10) * (format === "rgb24" ? 3 : 1);
      if (code !== 0 || pixels.length !== expected) fail(new Error(`No frame decoded at ${at}s (ffmpeg exit ${code}, ${pixels.length} of ${expected} bytes).`)); else done(pixels);
    });
  });
}
// The frame's layout bands: ILLUSTRATION band, the artwork between the head and foot labels, and the captions.
const BAND = { y: 0, h: 200 }, ART = { y: 340, h: 1090 }, CAPTIONS = { y: 1600, h: 320 };
const BACKGROUND_Y = 10;   // #0A0A0F in luma
const share = (pixels: Buffer, test: (v: number) => boolean) => { let n = 0; for (const v of pixels) if (test(v)) n += 1; return n / pixels.length; };
const meanAbsDiff = (a: Buffer, b: Buffer) => { let sum = 0; for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
export const MIN_ART_SHARE = 0.05;

/**
 * Renders the template and checks the exported files. Any failure after the renderer started (a text misfit,
 * an encoder error, a malformed MP4 the verifier cannot read) becomes a failed check, so the run still writes
 * its proposal and report as blocked-by-render-check; only a missing renderer is a refusal.
 */
export async function renderAndVerify(template: AnimationTemplate, outDir: string): Promise<{ files?: { silentPath: string; sfxPath: string }; verification: Verification }> {
  const failed = (stage: string, error: unknown): Verification => ({
    passed: false, checks: [{ check: `the cut ${stage}`, passed: false, detail: (error as Error).message.split("\n").slice(0, 3).join(" ") }],
    cuePeaks: [], loudness: { integratedLufs: Number.NaN, peakDbfs: Number.NaN }, beatSheet: "", phoneSheet: "",
  });
  let files: { silentPath: string; sfxPath: string };
  try {
    files = await renderTemplate(template, outDir);
  } catch (error) {
    if (error instanceof DailyProposalError) throw error;
    return { verification: failed("rendered", error) };
  }
  try {
    return { files, verification: await verifyRender(template, files, outDir) };
  } catch (error) {
    return { files, verification: failed("could be verified", error) };
  }
}

/** Checks the exported files, not the plan. */
export async function verifyRender(template: AnimationTemplate, files: { silentPath: string; sfxPath: string }, outputDir: string): Promise<Verification> {
  const checks: { check: string; passed: boolean; detail: string }[] = [];
  const add = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });
  for (const [name, path] of [["silent", files.silentPath], ["sound-effects", files.sfxPath]] as const) {
    const p = await probe(path);
    add(`${name} MP4 is 1080x1920`, p.width === 1080 && p.height === 1920, `${p.width}x${p.height}`);
    add(`${name} MP4 length`, Math.abs(p.duration - template.durationSeconds) < 0.05, `${p.duration.toFixed(3)} s (expected ${template.durationSeconds} s)`);
    add(`${name} MP4 frame count`, p.frames === Math.round(template.durationSeconds * template.fps), `${p.frames} frames (expected ${Math.round(template.durationSeconds * template.fps)})`);
  }
  // One frame from the middle of every beat. Uniqueness alone proves little (changing captions make every
  // frame unique), so each band is checked for what it must contain:
  //   artwork   the region between the head and foot labels is drawn (at least MIN_ART_SHARE of it is not
  //             background), and differs from beat to beat, so every beat shows its own picture;
  //   band      the ILLUSTRATION band is on every sampled frame, unchanged, with its amber badge;
  //   captions  every sampled frame carries caption text.
  const mids = template.beats.map((b) => (b.from + b.to) / 2);
  const samples = [0, ...mids, template.durationSeconds - 0.1];
  try {
    await contentChecks();
  } catch (error) {
    add("every sampled frame decodes", false, (error as Error).message);
  }
  async function contentChecks() {
    const art = await Promise.all(mids.map((t) => region(files.silentPath, t, ART, "gray")));
    const artShares = art.map((px) => share(px, (v) => Math.abs(v - BACKGROUND_Y) > 12));
    add("every beat's artwork is drawn", artShares.every((x) => x >= MIN_ART_SHARE), artShares.map((x, i) => `beat ${i + 1}: ${(x * 100).toFixed(1)}%`).join("; ") + ` of the art region not background (at least ${MIN_ART_SHARE * 100}%)`);
    let closest = Infinity, pair = "";
    for (let i = 0; i < art.length; i += 1) for (let j = i + 1; j < art.length; j += 1) { const d = meanAbsDiff(art[i], art[j]); if (d < closest) { closest = d; pair = `${i + 1} and ${j + 1}`; } }
    add("every beat's artwork differs from every other beat's", closest >= 2, `closest pair: beats ${pair}, mean difference ${closest.toFixed(1)} grey levels (at least 2)`);
    const bands = await Promise.all(samples.map((t) => region(files.silentPath, t, BAND, "rgb24")));
    const amber = bands.map((px) => { let n = 0; for (let i = 0; i < px.length; i += 3) if (px[i] > 200 && px[i + 1] > 140 && px[i + 2] < 90) n += 1; return n / (px.length / 3); });
    const bandDrift = Math.max(...bands.map((px) => meanAbsDiff(px, bands[0])));
    add("the ILLUSTRATION band is on every sampled frame", amber.every((x) => x > 0.01) && bandDrift < 3, `${samples.length} frames; amber badge ${(Math.min(...amber) * 100).toFixed(1)}%+ of the band; largest change ${bandDrift.toFixed(2)} levels`);
    const caps = await Promise.all(samples.map((t) => region(files.silentPath, t, CAPTIONS, "gray")));
    const capShares = caps.map((px) => share(px, (v) => v > 150));
    add("every sampled frame has caption text", capShares.every((x) => x > 0.01), `lowest ${(Math.min(...capShares) * 100).toFixed(1)}% of the caption band lit`);

  }
  const beatSheet = join(outputDir, "beats-phone.png");
  const select = mids.map((t) => `eq(n\\,${Math.round(t * template.fps)})`).join("+");
  await run("ffmpeg", ["-v", "error", "-y", "-i", files.silentPath, "-vf", `select='${select}',scale=360:640:flags=lanczos,tile=${mids.length}x1:padding=6:color=0x2A2A33`, "-frames:v", "1", beatSheet]);
  const phoneSheet = join(outputDir, "phone-every-0.25s.png");
  await run("ffmpeg", ["-v", "error", "-y", "-i", files.silentPath, "-vf", `fps=4,scale=180:320:flags=lanczos,tile=13x${Math.ceil(template.durationSeconds * 4 / 13)}:padding=4:color=0x2A2A33`, "-frames:v", "1", phoneSheet]);
  // Sound: a peak at every cue, silence between cues, the clearest cue the loudest; the silent MP4 silent.
  // Each cue is measured over the longest part of its window that no other cue's window touches, so a
  // long cue (the fan) is not credited with a click that happens during it.
  const windowOf = (c: SoundCue): [number, number] => [Math.max(0, c.at - 0.01), c.at + c.seconds + 0.06];
  const cuePeaks = [];
  for (const cue of template.cues) {
    let parts: [number, number][] = [windowOf(cue)];
    for (const other of template.cues) {
      if (other === cue || (other.kind === cue.kind && Math.abs(other.at - cue.at) < 0.1)) continue;
      const [oa, ob] = windowOf(other);
      parts = parts.flatMap(([a, b]): [number, number][] => ob <= a || oa >= b ? [[a, b]] : [[a, oa], [ob, b]].filter(([x, y]) => y - x > 0.02) as [number, number][]);
    }
    const [a, b] = parts.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0] ?? windowOf(cue);
    cuePeaks.push({ kind: cue.kind, at: cue.at, reason: cue.reason, measuredFrom: a, measuredTo: b, peakDbfs: await peakIn(files.sfxPath, a, b) });
  }
  add("every cue sounds", cuePeaks.every((c) => c.peakDbfs > -60), cuePeaks.map((c) => `${c.at.toFixed(2)}s ${c.kind} ${c.peakDbfs.toFixed(1)} dBFS`).join("; "));
  // A short cue must have its own onset: a rise of at least 6 dB in the 15 ms from its frame over the 15 ms
  // before it. Two clicks 35 ms apart each need their own; a cue that only catches the previous one's tail fails.
  const onsets = [];
  for (const cue of template.cues.filter((c) => c.seconds < 0.3)) {
    // A cue in the first 5 ms has no pre-roll to measure: the time before the cut starts counts as silence.
    const before = cue.at - 0.005 <= 0 ? -Infinity : await peakIn(files.sfxPath, Math.max(0, cue.at - 0.02), cue.at - 0.005);
    const at = await peakIn(files.sfxPath, Math.max(0, cue.at - 0.003), cue.at + 0.012);
    onsets.push({ cue, rise: at - before, at });
  }
  add("every short cue has its own onset", onsets.every((o) => o.rise >= 6 && o.at > -60), onsets.map((o) => `${o.cue.at.toFixed(3)}s ${o.cue.kind} +${Number.isFinite(o.rise) ? o.rise.toFixed(1) : "inf"} dB`).join("; "));
  const windows = [...template.cues].map((c) => [c.at - 0.01, c.at + c.seconds + 0.08]).sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of windows) { if (a - cursor > 0.15) gaps.push([cursor + 0.02, a - 0.02]); cursor = Math.max(cursor, b); }
  if (template.durationSeconds - cursor > 0.15) gaps.push([cursor + 0.02, template.durationSeconds - 0.02]);
  const gapPeaks = await Promise.all(gaps.map(([a, b]) => peakIn(files.sfxPath, a, b)));
  add("silence between cues (no stray sound, no boot sound at the end)", gapPeaks.every((p) => p < -60), gaps.map(([a, b], i) => `${a.toFixed(2)}-${b.toFixed(2)} s: ${Number.isFinite(gapPeaks[i]) ? gapPeaks[i].toFixed(1) : "-inf"} dBFS`).join("; "));
  const clearest = Math.max(...cuePeaks.filter((c) => c.kind === template.clearestCue).map((c) => c.peakDbfs));
  const rest = Math.max(...cuePeaks.filter((c) => c.kind !== template.clearestCue).map((c) => c.peakDbfs));
  add(`"${template.clearestCue}" is the clearest cue`, clearest > rest + 6, `${clearest.toFixed(1)} dBFS vs next ${rest.toFixed(1)} dBFS`);
  const silentPeak = await peakIn(files.silentPath, 0, template.durationSeconds);
  add("the silent MP4 is silent", silentPeak < -80, Number.isFinite(silentPeak) ? `${silentPeak.toFixed(1)} dBFS` : "-inf dBFS");
  const loud = await run("ffmpeg", ["-hide_banner", "-i", files.sfxPath, "-af", "ebur128=peak=sample", "-f", "null", "-"]);
  const integrated = Number(loud.match(/I:\s+(-?[\d.]+) LUFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0]);
  const peak = Number(loud.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0]);
  add("sound effects stay below a -16 LUFS narration", integrated < -24 && peak < -6, `${integrated} LUFS integrated, ${peak} dBFS peak`);
  return { passed: checks.every((c) => c.passed), checks, cuePeaks, loudness: { integratedLufs: integrated, peakDbfs: peak }, beatSheet, phoneSheet };
}
