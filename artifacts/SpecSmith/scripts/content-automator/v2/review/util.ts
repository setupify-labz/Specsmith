// Small shared helpers for the review: stable hashing, caption parsing, numbers in text.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { ComparePairing } from "../../leadsVsAverage/facts.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

/** JSON with sorted keys, so the same value always hashes the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as object).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sha256Text = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export const sha256Json = (value: unknown) => sha256Text(stableStringify(value));

/** Hash of a file's bytes, or null when it cannot be read. */
export function sha256File(path: string): string | null {
  try {
    return sha256Text(readFileSync(path));
  } catch {
    return null;
  }
}

/** The text the narration renderer reads, as productionPlan's voice task and the TTS adapters build it. */
export function narrationText(storyboard: PlatformScriptStoryboard): string {
  return storyboard.beats.map((beat) => beat.narration.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export interface ParsedCue { readonly startSecond: number; readonly endSecond: number; readonly text: string }

const assSeconds = (time: string) => {
  const [h, m, s] = time.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};

/** Caption cues as the burned-in ASS file actually holds them. */
export function parseAssCues(document: string): ParsedCue[] {
  const cues: ParsedCue[] = [];
  for (const line of document.split(/\r?\n/)) {
    if (!line.startsWith("Dialogue:")) continue;
    const fields = line.slice("Dialogue:".length).split(",");
    const text = fields.slice(9).join(",").replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, " ").replace(/\s+/g, " ").trim();
    cues.push({ startSecond: assSeconds(fields[1].trim()), endSecond: assSeconds(fields[2].trim()), text });
  }
  return cues;
}

export const normalizeText = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Text with spelled numbers written as digits ("twenty-three" -> "23"), for comparing figures. */
export function digitsFor(text: string): string {
  return text
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (_, tens: string, unit: string) => String(TENS[tens.toLowerCase()] + UNITS[unit.toLowerCase()]))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
      (word: string) => String(UNITS[word.toLowerCase()] ?? TENS[word.toLowerCase()]));
}

/** Every number in the text, spelled or written, excluding resolutions like 1440p and 4K. */
export function numbersIn(text: string): number[] {
  return [...digitsFor(text).replace(/\b\d+(p|k)\b/gi, " ").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

const FIGURE = /(\$\s*\d[\d,.]*)|(\b\d+(?:\.\d+)?\s*(?:fps|frames? per second|%|percent|games?|wins?|leads?)\b)|(\b\d+\s*(?:to|-|–|vs\.?|versus)\s*\d+\b)/gi;

/** Quantitative figures a viewer would read as a fact: FPS, percentages, prices, counts of games, scores. */
export function figuresIn(text: string): string[] {
  return [...digitsFor(text).matchAll(FIGURE)].map((match) => match[0].trim());
}

/** The Compare pairing a capture route shows, or null when the route is not a Compare state. */
export function pairingFromRoute(route: string): ComparePairing | null {
  let url: URL;
  try {
    url = new URL(route, "http://specsmith.local");
  } catch {
    return null;
  }
  if (url.pathname !== "/compare") return null;
  const get = (key: string) => url.searchParams.get(key);
  const [gpuA, cpuA, gpuB, cpuB, res, preset] = [get("gpuA"), get("cpuA"), get("gpuB"), get("cpuB"), get("res"), get("preset")];
  // Compare falls back silently on a missing setting, so a route without one
  // does not say which setting it showed.
  if (!gpuA || !cpuA || !gpuB || !cpuB || !res || !preset) return null;
  return { gpuA, cpuA, gpuB, cpuB, resolution: res as ComparePairing["resolution"], preset: preset as ComparePairing["preset"] };
}

export const describePairing = (pairing: ComparePairing) =>
  `${pairing.gpuA}+${pairing.cpuA} vs ${pairing.gpuB}+${pairing.cpuB} at ${pairing.resolution} ${pairing.preset}`;
