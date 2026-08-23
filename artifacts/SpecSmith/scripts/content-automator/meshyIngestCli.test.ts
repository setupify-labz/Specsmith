import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { cleanRestrictedFeatureReview } from "./assetRights.ts";
import { ingestMeshyAsset, type MeshyIngestRequest } from "./meshyIngestion.ts";
import {
  parseMeshyIngestArgs,
  persistMeshyResultAtomic,
  verifyLocalMeshyHashes,
} from "./meshyIngestCli.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "specsmith-meshy-cli-"));
  dirs.push(dir);
  return dir;
}

function hash(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requestFor(file: string, bytes: string): MeshyIngestRequest {
  const digest = hash(bytes);
  return {
    providerAssetId: "provider-output-1",
    providerTaskId: "provider-task-1",
    assetKind: "preview-image",
    generationMode: "text-to-image",
    createdAt: "2026-08-23T20:00:00Z",
    outputFile: {
      uri: pathToFileURL(file).href,
      mimeType: "image/png",
      sha256: digest,
    },
    declaredGeometryMode: "generic-representative",
    observedFeatures: cleanRestrictedFeatureReview(),
    humanClearance: {
      reviewer: "reviewer",
      evidenceRef: "review-1",
      reviewedAt: "2026-08-23T20:05:00Z",
      assetSha256: digest,
    },
    intendedUse: "editorial-publication",
  };
}

describe("Meshy CLI argument parsing", () => {
  it("accepts one metadata path and an optional registry", () => {
    expect(parseMeshyIngestArgs(["asset.json"])).toMatchObject({ metadataPath: "asset.json" });
    expect(parseMeshyIngestArgs(["asset.json", "--registry", "registry.json"]))
      .toEqual({ metadataPath: "asset.json", registryFile: "registry.json" });
  });

  it("rejects unknown flags, missing flag values, and extra positional args", () => {
    expect(() => parseMeshyIngestArgs(["asset.json", "--wat"])).toThrow(/Unknown option/);
    expect(() => parseMeshyIngestArgs(["asset.json", "--registry"])).toThrow(/requires a path value/);
    expect(() => parseMeshyIngestArgs(["a.json", "b.json"])).toThrow(/extra positional/);
  });
});

describe("local hash verification", () => {
  it("verifies output bytes before ingestion", () => {
    const dir = tempDir();
    const file = path.join(dir, "preview.png");
    writeFileSync(file, "exact bytes");
    expect(() => verifyLocalMeshyHashes(requestFor(file, "exact bytes"))).not.toThrow();
  });

  it("rejects mutated output bytes even if metadata still carries an old approval hash", () => {
    const dir = tempDir();
    const file = path.join(dir, "preview.png");
    writeFileSync(file, "original bytes");
    const request = requestFor(file, "original bytes");
    writeFileSync(file, "changed bytes");
    expect(() => verifyLocalMeshyHashes(request)).toThrow(/local-hash-mismatch|hash mismatch/i);
  });

  it("verifies local reference inputs too", () => {
    const dir = tempDir();
    const output = path.join(dir, "model.glb");
    const source = path.join(dir, "reference.png");
    writeFileSync(output, "model bytes");
    writeFileSync(source, "reference bytes");
    const outputSha = hash("model bytes");
    const sourceSha = hash("reference bytes");
    const request: MeshyIngestRequest = {
      providerAssetId: "model-1",
      assetKind: "model",
      generationMode: "image-to-3d",
      createdAt: "2026-08-23T20:00:00Z",
      outputFile: { uri: pathToFileURL(output).href, mimeType: "model/gltf-binary", sha256: outputSha },
      sourceReferences: [{
        uri: pathToFileURL(source).href,
        sha256: sourceSha,
        sourceKind: "specsmith-owned",
        commercialUseAllowed: true,
        derivativeUseAllowed: true,
      }],
      declaredGeometryMode: "generic-representative",
      observedFeatures: cleanRestrictedFeatureReview(),
      humanClearance: { reviewer: "reviewer", evidenceRef: "review-2", reviewedAt: "2026-08-23T20:05:00Z", assetSha256: outputSha },
      intendedUse: "editorial-publication",
    };
    expect(() => verifyLocalMeshyHashes(request)).not.toThrow();
    writeFileSync(source, "mutated reference");
    expect(() => verifyLocalMeshyHashes(request)).toThrow(/sourceReferences\[0\] hash mismatch/);
  });
});

describe("atomic quarantine registry persistence", () => {
  it("writes valid JSON with the output hash and leaves no temp file behind", () => {
    const dir = tempDir();
    const file = path.join(dir, "preview.png");
    const registry = path.join(dir, "registry", "meshy.json");
    writeFileSync(file, "bytes");
    const request = requestFor(file, "bytes");
    const result = ingestMeshyAsset(request);
    persistMeshyResultAtomic(registry, result);

    const parsed = JSON.parse(readFileSync(registry, "utf-8")) as { assets: Record<string, { sha256: string }> };
    expect(parsed.assets[result.assetId].sha256).toBe(hash("bytes"));
    expect(readdirSync(path.dirname(registry)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("re-ingesting the same exact bytes updates the same content-addressed entry", () => {
    const dir = tempDir();
    const file = path.join(dir, "preview.png");
    const registry = path.join(dir, "meshy.json");
    writeFileSync(file, "same bytes");
    const result = ingestMeshyAsset(requestFor(file, "same bytes"));
    persistMeshyResultAtomic(registry, result);
    persistMeshyResultAtomic(registry, result);
    const parsed = JSON.parse(readFileSync(registry, "utf-8")) as { assets: Record<string, unknown> };
    expect(Object.keys(parsed.assets)).toEqual([result.assetId]);
  });

  it("changed bytes under the same provider id create a new asset instead of inheriting approval", () => {
    const dir = tempDir();
    const firstFile = path.join(dir, "first.png");
    const secondFile = path.join(dir, "second.png");
    const registry = path.join(dir, "meshy.json");
    writeFileSync(firstFile, "first bytes");
    writeFileSync(secondFile, "second bytes");

    const first = ingestMeshyAsset(requestFor(firstFile, "first bytes"));
    const second = ingestMeshyAsset(requestFor(secondFile, "second bytes"));
    persistMeshyResultAtomic(registry, first);
    persistMeshyResultAtomic(registry, second);

    const parsed = JSON.parse(readFileSync(registry, "utf-8")) as { assets: Record<string, unknown> };
    expect(first.assetId).not.toBe(second.assetId);
    expect(Object.keys(parsed.assets).sort()).toEqual([first.assetId, second.assetId].sort());
  });
});
