#!/usr/bin/env tsx
/**
 * The one paid Liam take of the RAM-fit pilot, pinned so it can be rendered
 * again without another ElevenLabs request.
 *
 * Run 37086531999 (approved, confirm=generate, script=ram-fit, on 430d03c) made
 * exactly one request and kept the take as an artifact. Everything that
 * identifies it is pinned here: the run, its commit and workflow, the job and
 * step that generated it, the artifact and its digest, the Liam voice id and
 * the audio's SHA-256. The render path checks the run against GitHub before it
 * downloads anything (this file's CLI), and the renderer refuses any take
 * whose audio is not these exact bytes (render.ts --saved-take).
 *
 * It reads run metadata with the job's own read-only token. It holds no
 * provider credential, makes no provider request, and publishes nothing.
 */

import { pathToFileURL } from "node:url";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import type { LoadedRamFitTake } from "./takeTiming.ts";

export const SAVED_RAM_FIT_TAKE = Object.freeze({
  repository: "setupify-labz/Specsmith",
  runId: 37086531999,
  headSha: "430d03cbc8338ce088f3f0d4d7394c1c0fde0d4b",
  workflowPath: ".github/workflows/elevenlabs-voice-sample.yml",
  event: "workflow_dispatch",
  job: "sample",
  step: "Generate one Liam take of the RAM-fit pilot",
  artifactId: 11259988966,
  artifactName: "specsmith-ram-fit-liam-take",
  artifactDigest: "sha256:8e20cf5453bb0f7d98bb52daeba58318d61eedf1a8942c944fad295e1d019249",
  voiceId: REVIEWED_LIAM_VOICE.voiceId,
  audioSha256: "ab54f7a9f57b3c6610d1a111fa3804d282f314be7f578318d5a033274ccdb871",
});

export class SavedTakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedTakeError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Refuses unless GitHub says the pinned run is the approved ram-fit generation:
 * the pinned commit and workflow, dispatched by hand, its `sample` job and RAM-fit
 * generation step successful, and the pinned artifact (by id, name, run and
 * digest) still there.
 */
export async function verifySavedTakeRun(options: { token: string | undefined; fetchImpl?: FetchLike; apiBase?: string }): Promise<string[]> {
  const pinned = SAVED_RAM_FIT_TAKE;
  if (!options.token) throw new SavedTakeError("No GitHub token to read the run with.");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const api = options.apiBase ?? "https://api.github.com";
  const get = async (path: string) => {
    const response = await fetchImpl(`${api}/repos/${pinned.repository}${path}`, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new SavedTakeError(`GitHub answered HTTP ${response.status} for ${path}.`);
    return (await response.json()) as Record<string, unknown>;
  };

  const run = await get(`/actions/runs/${pinned.runId}`);
  const checks: [string, unknown, unknown][] = [
    ["run id", run.id, pinned.runId],
    ["run commit", run.head_sha, pinned.headSha],
    ["run workflow", run.path, pinned.workflowPath],
    ["run event", run.event, pinned.event],
    ["run status", run.status, "completed"],
  ];
  for (const [what, actual, expected] of checks) {
    if (actual !== expected) throw new SavedTakeError(`The saved take's ${what} is ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}. Not rendered.`);
  }

  const jobs = ((await get(`/actions/runs/${pinned.runId}/jobs?per_page=50`)).jobs ?? []) as { name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[];
  const sample = jobs.find((job) => job.name === pinned.job);
  if (!sample || sample.conclusion !== "success") throw new SavedTakeError(`The run's ${pinned.job} job did not succeed. Not rendered.`);
  const step = sample.steps?.find((entry) => entry.name === pinned.step);
  if (!step || step.conclusion !== "success") throw new SavedTakeError(`The run did not generate the RAM-fit take ("${pinned.step}" did not succeed). Not rendered.`);

  const artifact = await get(`/actions/artifacts/${pinned.artifactId}`);
  const workflowRun = artifact.workflow_run as { id?: unknown } | undefined;
  if (artifact.name !== pinned.artifactName || workflowRun?.id !== pinned.runId) throw new SavedTakeError("The pinned artifact is not the RAM-fit take of the pinned run. Not rendered.");
  if (artifact.expired !== false) throw new SavedTakeError("The saved take has expired. It cannot be rendered, and no new take is generated.");
  if (artifact.digest !== pinned.artifactDigest) throw new SavedTakeError(`The saved take's digest is ${String(artifact.digest)}, not ${pinned.artifactDigest}. Not rendered.`);

  return [
    `run ${pinned.runId}: ${pinned.event} of ${pinned.workflowPath} at ${pinned.headSha}, completed`,
    `job ${pinned.job} and step "${pinned.step}": success`,
    `artifact ${pinned.artifactId} ${pinned.artifactName}: ${pinned.artifactDigest}`,
  ];
}

/** Refuses a loaded take unless it is the pinned audio in the pinned Liam voice. */
export function assertSavedTake(take: Pick<LoadedRamFitTake, "audioSha256" | "voiceId">): void {
  if (take.voiceId !== SAVED_RAM_FIT_TAKE.voiceId) throw new SavedTakeError("The take is not the pinned Liam voice. Not rendered.");
  if (take.audioSha256 !== SAVED_RAM_FIT_TAKE.audioSha256) throw new SavedTakeError(`The take's audio is ${take.audioSha256}, not the saved take ${SAVED_RAM_FIT_TAKE.audioSha256}. Not rendered.`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  verifySavedTakeRun({ token: process.env.GITHUB_TOKEN })
    .then((lines) => { for (const line of lines) console.log(`verified ${line}`); })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
