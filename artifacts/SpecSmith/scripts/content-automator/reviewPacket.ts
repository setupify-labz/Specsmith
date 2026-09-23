// What a human needs in front of them to judge a draft, in one folder.
//
// The quality gate in qualityReviewer.ts is SHA-bound: it passes only when a
// render's exact bytes match a committed record of a genuine prior
// inspection. That is the right design and it means a FRESH render can never
// pass — there is nothing yet to match it against. The gate's own message
// says so: "awaiting review and not publishable".
//
// So the missing piece was never a looser gate. It was the thing that makes
// the inspection possible: a packet that says what was claimed, what was
// rendered, which seconds are real product evidence, which are stand-ins,
// what could not be checked, and what the reviewer is being asked to decide.
//
// NOTHING HERE ASSERTS QUALITY. The packet records `status:
// "awaiting-human-review"` and carries the master's sha256 so that, once a
// person has actually watched it, that exact observation can be committed as
// the evidence record the gate demands. Writing the packet is not the
// inspection; it is the paperwork the inspection needs.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { StoryboardRenderResult } from "./storyboardRender.ts";
import { INTENDED_VOICE_NAME } from "./storyboardRender.ts";

export interface ReviewPacketBlocker {
  id: string;
  summary: string;
  /** What a person has to decide or supply. Never something code can do. */
  needsHuman: string;
}

export interface ReviewPacket {
  status: "awaiting-human-review";
  generatedAt: string;
  idea: { id: string; title: string; hook: string; route: string };
  storyboard: {
    platform: string;
    beats: number;
    targetSeconds: number;
    narrationSecondsNeeded: number;
    overrunRatio: number;
    timingScaleApplied: number;
  };
  master: {
    path: string;
    sha256: string;
    bytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
    captionsBurnedIn: boolean;
  };
  /** Per beat: what it claims, and where those seconds actually came from. */
  beats: {
    index: number;
    purpose: string;
    renderedWindow: string;
    onScreenText: string;
    narration: string;
    source: "real-specsmith-capture" | "fixture-stand-in";
    adapter: string;
  }[];
  narration: {
    intendedVoice: string;
    actualProvider: string;
    isPaidProvider: false;
    isFixture: true;
    fullText: string;
  };
  blockers: ReviewPacketBlocker[];
  /** The questions the reviewer is actually being asked. */
  decisions: string[];
}

const metadataNumber = (metadata: Record<string, unknown>, key: string): number => {
  const raw = metadata[key];
  return typeof raw === "number" ? raw : Number(raw ?? 0);
};

/**
 * Blockers that are true of ANY draft this pipeline can currently produce.
 *
 * Listed explicitly rather than left for a reader to infer from silence. Each
 * one names what a person must supply or decide — none of them is something
 * this code could have done and skipped.
 */
export function standingBlockers(result: StoryboardRenderResult): ReviewPacketBlocker[] {
  const blockers: ReviewPacketBlocker[] = [
    {
      id: "narration-is-a-stand-in",
      summary:
        `Narration is offline espeak-ng, not ${INTENDED_VOICE_NAME}. Reaching ${INTENDED_VOICE_NAME} is a paid `
        + "ElevenLabs call, and no ELEVENLABS_API_KEY exists in this environment to make one with.",
      needsHuman: `Approve the spend and supply ELEVENLABS_API_KEY plus the ${INTENDED_VOICE_NAME} ELEVENLABS_VOICE_ID.`,
    },
    {
      id: "music-bed-is-silence",
      summary:
        "The music-sfx task renders silence. A bed has to be licensed, attributed and cleared before it can ship, "
        + "and generating something music-shaped would invite a judgement on a track that could never be used.",
      needsHuman: "Choose a licensed track, or confirm the draft ships without music.",
    },
    {
      id: "hook-beat-is-a-card",
      summary:
        "The hook beat is assigned video-generation by productionPlan.ts and rendered as a plain typographic card. "
        + "The paid generation provider (Gemini Veo) was not called.",
      needsHuman:
        "Decide whether the hook should use a real UI capture instead, or approve spending on generated motion.",
    },
    {
      id: "no-quality-gate-passed",
      summary:
        "qualityReviewer.ts passes only when a render's sha256 matches a committed record of a prior human "
        + "inspection. This render is new, so no such record exists and it is correctly not publishable.",
      needsHuman: "Watch the master, then commit an observation record bound to its sha256 if it is acceptable.",
    },
  ];

  if (result.timing.overruns) {
    blockers.unshift({
      id: "storyboard-narration-overruns-its-own-clock",
      summary:
        `The storyboard allots ${result.timing.targetSeconds}s and writes narration needing `
        + `${result.timing.narrationSeconds.toFixed(1)}s at a natural 165 wpm (${result.timing.overrunRatio.toFixed(2)}x over). `
        + `${result.timing.beats.filter((b) => b.neededSeconds > b.windowSeconds).length} of ${result.timing.beats.length} beats `
        + `overrun individually. Every window was scaled by ${result.timingScale.toFixed(2)}x so the draft could be watched.`,
      needsHuman: "Shorten the narration copy in scriptStoryboard.ts, or raise the platform target duration.",
    });
  }

  return blockers;
}

/** Writes the packet beside the master and returns it. */
export async function writeReviewPacket(
  result: StoryboardRenderResult,
  options: { outputDir?: string; generatedAt?: Date } = {},
): Promise<{ packet: ReviewPacket; path: string }> {
  const outputDir = options.outputDir ?? join(result.outputDir, "review-packet");
  await mkdir(outputDir, { recursive: true });

  const masterPath = fileURLToPath(result.master.uri);
  const bytes = await readFile(masterPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = result.master.metadata as Record<string, unknown>;
  const script = result.storyboard.scripts.find((entry) => entry.platform === result.plan.platform);

  const packet: ReviewPacket = {
    status: "awaiting-human-review",
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    idea: {
      id: result.idea.id,
      title: result.idea.title,
      hook: result.idea.hook,
      route: result.idea.productConnection.route,
    },
    storyboard: {
      platform: result.plan.platform,
      beats: script?.beats.length ?? 0,
      targetSeconds: result.timing.targetSeconds,
      narrationSecondsNeeded: Number(result.timing.narrationSeconds.toFixed(2)),
      overrunRatio: Number(result.timing.overrunRatio.toFixed(3)),
      timingScaleApplied: Number(result.timingScale.toFixed(3)),
    },
    master: {
      path: basename(masterPath),
      sha256,
      bytes: bytes.byteLength,
      durationSeconds: metadataNumber(metadata, "durationSeconds"),
      width: metadataNumber(metadata, "width"),
      height: metadataNumber(metadata, "height"),
      videoCodec: String(metadata.videoCodec ?? ""),
      audioCodec: String(metadata.audioCodec ?? ""),
      captionsBurnedIn: metadata.captionsBurnedIn === true,
    },
    beats: result.beats.map((beat) => ({
      index: beat.beatIndex,
      purpose: beat.purpose,
      renderedWindow: `${beat.renderedStartSecond.toFixed(1)}-${beat.renderedEndSecond.toFixed(1)}s`,
      onScreenText: beat.onScreenText,
      narration: beat.narration,
      source: beat.isFixture ? "fixture-stand-in" : "real-specsmith-capture",
      adapter: beat.adapterName,
    })),
    narration: {
      intendedVoice: INTENDED_VOICE_NAME,
      actualProvider: "espeak-ng-offline-fixture",
      isPaidProvider: false,
      isFixture: true,
      fullText: (script?.beats ?? []).map((beat) => beat.narration).join(" "),
    },
    blockers: standingBlockers(result),
    decisions: [
      "Does the draft hold attention for its full runtime?",
      "Is every on-screen claim supported by what the capture actually shows?",
      "Should the hook stay a card, or become a real Compare capture?",
      `Is ${INTENDED_VOICE_NAME} worth the spend for this format?`,
      "Is the narration copy short enough to fix the timing overrun, or should the target duration rise?",
    ],
  };

  const path = join(outputDir, "review-packet.json");
  await writeFile(path, `${JSON.stringify(packet, null, 2)}\n`, "utf-8");
  return { packet, path };
}
