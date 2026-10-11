// A Short as data: captions, a timeline of reusable scenes (library.ts), screen
// labels, sound cues and the sources its claims rest on. renderCut.ts turns a
// spec into frames, a silent MP4 and a sound-effects MP4; the daily job turns
// it into a template (dailyShortProposal/animations.ts). A new troubleshooting
// Short is a new spec file, not a new renderer.
//
// specProblems() refuses a spec before anything is rendered: captions must
// cover the whole cut with no gap, every frame must have a scene, labels must
// be readable (at most 20 characters a second over the span each is visible)
// and must not overlap in the same place, every cue must be inside the cut,
// the clearest cue must exist, every caption needs a beat, and no caption or
// label may make a forbidden claim (no guaranteed fix, universal result, FPS).

import { FORBIDDEN_CLAIMS } from "../nextVideoMonitorPort/storyboard.ts";
import { SCENE_NAMES, type SceneName } from "./library.ts";
import type { CueKind } from "./sound.ts";

export type Purpose = "hook" | "commitment" | "evidence" | "reversal" | "payoff" | "cta";
export interface SpecCaption { readonly from: number; readonly to: number; readonly text: string }
export interface SpecBeat { readonly storyBeat: string; readonly purpose: Purpose; readonly visualDirection: string }
export interface SpecShot { readonly scene: SceneName; readonly from: number; readonly to: number; readonly fadeIn?: number; readonly fadeOut?: number; readonly params?: Readonly<Record<string, unknown>> }
export interface SpecLabel { readonly text: string; readonly from: number; readonly to: number; readonly colour: "red" | "amber" | "purple" | "cyan" | "green"; readonly at: "head" | "foot"; readonly size?: number }
export interface SpecCue { readonly kind: CueKind; readonly at: number; readonly seconds: number; readonly reason: string }
export interface SpecSource { readonly publisher: string; readonly title: string; readonly url: string; readonly quote: string; readonly supports: string }

export interface CutSpec {
  readonly id: string;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly badge: string;
  readonly line: string;
  readonly captions: readonly SpecCaption[];
  /** One per caption, in order. */
  readonly beats: readonly SpecBeat[];
  readonly shots: readonly SpecShot[];
  readonly labels: readonly SpecLabel[];
  readonly cues: readonly SpecCue[];
  readonly clearestCue: CueKind;
  readonly sources: readonly SpecSource[];
  readonly sourcesChecked: { readonly on: string; readonly method: string };
}

export const MAX_LABEL_CHARS_PER_SECOND = 20;
const EPS = 1e-6;

export function specProblems(spec: CutSpec): string[] {
  const problems: string[] = [];
  const d = spec.durationSeconds;
  if (spec.captions[0]?.from !== 0) problems.push("captions must start at 0 s");
  spec.captions.forEach((c, i) => {
    if (i > 0 && Math.abs(c.from - spec.captions[i - 1].to) > EPS) problems.push(`caption ${i + 1} does not start where caption ${i} ends`);
    if (c.to <= c.from) problems.push(`caption ${i + 1} has no length`);
  });
  if (Math.abs((spec.captions.at(-1)?.to ?? 0) - d) > EPS) problems.push("captions must end at the cut's end");
  if (spec.beats.length !== spec.captions.length) problems.push(`${spec.beats.length} beats for ${spec.captions.length} captions`);
  for (const shot of spec.shots) {
    if (!SCENE_NAMES.includes(shot.scene)) problems.push(`unknown scene "${shot.scene}"`);
    if (shot.to <= shot.from) problems.push(`shot ${shot.scene} ${shot.from}-${shot.to} has no length`);
  }
  // Every frame needs at least one shot at full strength or mid-fade.
  const frames = Math.round(d * spec.fps);
  for (let f = 0; f < frames; f += 1) {
    const t = f / spec.fps;
    if (!spec.shots.some((s) => t >= s.from && t < s.to)) { problems.push(`no scene at ${t.toFixed(3)} s`); break; }
  }
  for (const label of spec.labels) {
    const cps = label.text.length / (label.to - label.from);
    if (cps > MAX_LABEL_CHARS_PER_SECOND) problems.push(`label "${label.text}" is on screen ${(label.to - label.from).toFixed(2)} s: ${cps.toFixed(1)} characters a second, at most ${MAX_LABEL_CHARS_PER_SECOND}`);
    if (label.from < 0 || label.to > d + EPS) problems.push(`label "${label.text}" is outside the cut`);
  }
  for (const at of ["head", "foot"] as const) {
    const same = spec.labels.filter((l) => l.at === at).sort((a, b) => a.from - b.from);
    for (let i = 1; i < same.length; i += 1) if (same[i].from < same[i - 1].to - EPS) problems.push(`labels "${same[i - 1].text}" and "${same[i].text}" overlap at the ${at}`);
  }
  for (const cue of spec.cues) if (cue.at < 0 || cue.at + cue.seconds > d) problems.push(`cue ${cue.kind} at ${cue.at} s is outside the cut`);
  if (!spec.cues.some((c) => c.kind === spec.clearestCue)) problems.push(`the clearest cue "${spec.clearestCue}" never sounds`);
  for (const text of [...spec.captions.map((c) => c.text), ...spec.labels.map((l) => l.text)]) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) problems.push(`"${text}": ${why}`);
  }
  if (spec.sources.length === 0) problems.push("no sources");
  return problems;
}
