// A sealed account of everything that went into a master.
//
// WHY THE CALLER MAY NOT AUTHOR THIS. The previous design took a
// caller-supplied array of provenance records. That is an honour system: the
// safest way past a gate that inspects a list is to hand it a shorter list.
// Drop the fixture hook and the silent bed from the array and every remaining
// entry is genuinely clean, so the gate passes a master those two artifacts
// are still inside.
//
// So the manifest is DERIVED from the render result, one entry per artifact
// that actually contributed, and SEALED with a digest over its own canonical
// form. Omitting, adding or editing an entry changes the seal, and the
// publishing path verifies the seal before it reads anything else. A caller
// can still lie, but it can no longer lie quietly.
//
// SHA-256 IS COMPUTED FROM THE BYTES, NOT READ FROM METADATA. An adapter that
// reports its own digest is reporting a claim; hashing the file it wrote is a
// fact. An artifact whose bytes cannot be read has no digest and is refused.
//
// ADAPTER METADATA IS INCONSISTENT AND THIS IS THE ONE PLACE THAT KNOWS IT.
// The adapters in this repository do not agree on field names:
//
//   elevenLabsTts          provider: "elevenlabs"          voiceId
//   localFixtureTts        renderer + provider             voice     isFixture
//   captionRender          renderer only
//   motionCompositor       renderer only
//   offlineBeatFixtures    renderer + provider                       isFixture
//   geminiVeoVideo         provider only
//   deterministicUiRender  renderer + provider
//
// An earlier version of the gate read `renderer` and `voice` only. Against a
// GENUINE ElevenLabs render that meant no renderer and no voice id — so it
// would have refused the real thing as an unidentifiable fixture. A gate that
// cannot be satisfied in production is not strict, it is broken, and it gets
// "fixed" by loosening it the first time someone needs to ship.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { RenderArtifact } from "./rendering.ts";

export type ArtifactRole =
  | "hook-visual"
  | "evidence-visual"
  | "narration"
  | "captions"
  | "music-bed"
  | "master";

export const ARTIFACT_ROLES: readonly ArtifactRole[] = [
  "hook-visual", "evidence-visual", "narration", "captions", "music-bed", "master",
];

/**
 * Roles a publishable master must contain, and how many of each.
 *
 * Stated as a requirement rather than inferred from what turned up, because
 * "whatever the render produced" is exactly the shape an omission attack
 * wants. A master missing its narration is not a master with one fewer
 * artifact; it is a different video.
 */
export const REQUIRED_ROLE_COUNTS: Readonly<Record<ArtifactRole, { min: number; max: number }>> = {
  "hook-visual": { min: 1, max: 1 },
  "evidence-visual": { min: 1, max: Number.POSITIVE_INFINITY },
  narration: { min: 1, max: 1 },
  captions: { min: 1, max: 1 },
  "music-bed": { min: 1, max: 1 },
  master: { min: 1, max: 1 },
};

/** Renderers and providers that are fixtures whatever else they declare. */
export const FIXTURE_SOURCES = new Set([
  "offline-card-video-fixture",
  "offline-silent-bed-fixture",
  "local-espeak-tts-fixture",
  "ffmpeg-offline-fixture",
  "espeak-ng-offline-fixture",
]);

/** The ElevenLabs provider string, as elevenLabsTts.ts emits it. */
export const ELEVENLABS_PROVIDER = "elevenlabs";

export interface ManifestEntry {
  /** Unique within a manifest. Duplicates are refused. */
  taskId: string;
  role: ArtifactRole;
  /** metadata.renderer, or metadata.provider when only that is recorded. */
  renderer: string;
  /** metadata.provider, or metadata.renderer when only that is recorded. */
  provider: string;
  isFixture: boolean;
  /** Lowercase hex digest of the artifact's ACTUAL bytes. */
  sha256: string;
  /** Whether this artifact is part of the master that would be published. */
  inMaster: boolean;
  /** Narration only: metadata.voiceId, or metadata.voice. */
  voiceId?: string;
}

export interface SealedRenderManifest {
  entries: readonly ManifestEntry[];
  masterSha256: string;
  /** Digest over the canonical form of `entries` + `masterSha256`. */
  seal: string;
}

const sha256Of = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

const readString = (metadata: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
};

/**
 * The manifest's canonical form.
 *
 * Field order and entry order are both fixed, so two manifests describing the
 * same render seal identically regardless of how they were assembled.
 */
export function canonicaliseManifest(
  entries: readonly ManifestEntry[],
  masterSha256: string,
): string {
  const rows = [...entries]
    .map((entry) => [
      entry.taskId, entry.role, entry.renderer, entry.provider,
      String(entry.isFixture), entry.sha256, String(entry.inMaster), entry.voiceId ?? "",
    ].join("\u001f"))
    .sort();
  return [masterSha256.toLowerCase(), ...rows].join("\u001e");
}

/** Seals a set of entries. The seal is a fact about the list's contents. */
export function sealRenderManifest(
  entries: readonly ManifestEntry[],
  masterSha256: string,
): SealedRenderManifest {
  return {
    entries: [...entries],
    masterSha256: masterSha256.toLowerCase(),
    seal: sha256Of(canonicaliseManifest(entries, masterSha256)),
  };
}

/** Whether a manifest's seal still matches the entries it carries. */
export function manifestSealIsIntact(manifest: SealedRenderManifest): boolean {
  if (typeof manifest?.seal !== "string" || manifest.seal.length !== 64) return false;
  return manifest.seal === sha256Of(canonicaliseManifest(manifest.entries ?? [], manifest.masterSha256 ?? ""));
}

/**
 * Reads one artifact's true origin out of whatever shape its adapter used.
 *
 * `isFixture` is absent on every real adapter, so its absence cannot mean
 * "fixture" — it means the adapter never claimed to be one, and the
 * known-fixture source list is what catches the ones that are.
 */
export function describeArtifact(
  artifact: RenderArtifact,
  role: ArtifactRole,
  sha256: string,
  inMaster: boolean,
): ManifestEntry {
  const metadata = (artifact.metadata ?? {}) as Record<string, unknown>;
  const renderer = readString(metadata, "renderer", "provider");
  const provider = readString(metadata, "provider", "renderer");
  const declaredFixture = metadata.isFixture === true;
  const entry: ManifestEntry = {
    taskId: artifact.taskId,
    role,
    renderer,
    provider,
    isFixture: declaredFixture || FIXTURE_SOURCES.has(renderer) || FIXTURE_SOURCES.has(provider),
    sha256,
    inMaster,
  };
  if (role === "narration") entry.voiceId = readString(metadata, "voiceId", "voice");
  return entry;
}

/** Hashes an artifact's bytes. Returns "" when they cannot be read. */
export async function hashArtifactBytes(artifact: RenderArtifact): Promise<string> {
  if (!artifact.uri.startsWith("file://")) return "";
  try {
    return sha256Of(await readFile(fileURLToPath(artifact.uri)));
  } catch {
    return "";
  }
}

export type ManifestProblem = string;

/**
 * Structural validation of a sealed manifest.
 *
 * Everything an omission, duplication or substitution would produce is a
 * problem here: a broken seal, a repeated task id, a missing required role,
 * a second master, an artifact that is not part of the master, an unhashed
 * artifact, or a role nobody declared.
 */
export function manifestProblems(manifest: SealedRenderManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];

  if (!manifestSealIsIntact(manifest)) {
    problems.push(
      "the manifest seal does not match its entries; an artifact was added, removed or edited after sealing",
    );
  }
  if (entries.length === 0) {
    problems.push("the manifest lists no artifacts");
    return problems;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const where = typeof entry?.taskId === "string" && entry.taskId.trim() ? entry.taskId : "(unnamed)";
    if (where === "(unnamed)") problems.push("an entry has no taskId");
    else if (seen.has(where)) problems.push(`${where} appears more than once`);
    seen.add(where);

    if (!ARTIFACT_ROLES.includes(entry?.role)) {
      problems.push(`${where} declares unknown role "${String(entry?.role)}"`);
    }
    if (typeof entry?.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
      problems.push(`${where} is unhashed; its bytes were never digested`);
    }
    if (entry?.inMaster !== true) {
      problems.push(`${where} is not part of the master, so it does not belong in this manifest`);
    }
    if (!readableSource(entry)) {
      problems.push(`${where} records neither a renderer nor a provider`);
    }
    if (typeof entry?.isFixture !== "boolean") {
      problems.push(`${where} does not state whether it is a fixture`);
    }
  }

  for (const role of ARTIFACT_ROLES) {
    const count = entries.filter((entry) => entry?.role === role).length;
    const { min, max } = REQUIRED_ROLE_COUNTS[role];
    if (count < min) problems.push(`no ${role} artifact is present; a master must have one`);
    if (count > max) problems.push(`${count} ${role} artifacts are present; at most ${max} is allowed`);
  }

  const master = entries.find((entry) => entry?.role === "master");
  if (master && master.sha256 && manifest.masterSha256
      && master.sha256.toLowerCase() !== manifest.masterSha256.toLowerCase()) {
    problems.push("the master entry's digest is not the manifest's master digest");
  }

  return problems;
}

const readableSource = (entry: ManifestEntry): boolean =>
  (typeof entry?.renderer === "string" && entry.renderer.trim().length > 0)
  || (typeof entry?.provider === "string" && entry.provider.trim().length > 0);
