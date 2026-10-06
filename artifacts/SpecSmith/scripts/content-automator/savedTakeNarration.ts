// A "text-to-speech" render adapter that speaks with a take already made.
//
// A paid take is generated once, saved, and checked in. Every render after
// that, including a retry after a failed render, uses those exact bytes: this
// adapter re-hashes the file before every use and refuses anything that is not
// the audio the take's manifest names. It never calls a provider, so a render
// can never spend credits or quietly substitute another voice.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export interface SavedTake {
  readonly audioPath: string;
  readonly sha256: string;
  /** "local-fixture" only for a labelled dry run of the edit; never a take. */
  readonly provider: "elevenlabs" | "local-fixture";
  readonly voiceId: string;
  readonly voiceName: string;
  readonly modelId: string;
  /** SHA-256 of the exact text sent to the provider (figures spelled out for speech). */
  readonly providerTextSha256: string;
  /**
   * SHA-256 of the storyboard's narration (figures as digits) that the take
   * voices, line for line. Set only after each spoken line has been checked
   * against its beat's approved narration (liamTake.assertGpuUpgradeStory).
   */
  readonly scriptTextSha256: string;
}

export class SavedTakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedTakeError";
  }
}

export function createSavedTakeNarrationAdapter(options: { readonly outputDir: string; readonly take: SavedTake }): RenderAdapter {
  return {
    name: "saved-take-narration",
    capability: "text-to-speech",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const bytes = await readFile(options.take.audioPath).catch(() => { throw new SavedTakeError(`The saved take ${options.take.audioPath} is missing.`); });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== options.take.sha256) throw new SavedTakeError("The saved take is not the audio its manifest names; refusing to narrate with it.");
      await mkdir(options.outputDir, { recursive: true });
      const path = resolve(options.outputDir, `${context.task.taskId}__${basename(options.take.audioPath)}`);
      await copyFile(options.take.audioPath, path);
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-saved-take`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(path).toString(),
        mimeType: "audio/mpeg",
        metadata: {
          renderer: "saved-take-narration",
          provider: options.take.provider,
          voiceId: options.take.voiceId,
          voiceName: options.take.voiceName,
          modelId: options.take.modelId,
          // Which script this audio voices, in the storyboard's own form; the
          // provider text (figures spelled out) is kept beside it for audit.
          textSha256: options.take.scriptTextSha256,
          providerTextSha256: options.take.providerTextSha256,
          sha256,
          bytes: bytes.byteLength,
          isFixture: options.take.provider !== "elevenlabs",
          isSilent: false,
          providerCalledByRender: false,
        },
      }];
    },
  };
}
