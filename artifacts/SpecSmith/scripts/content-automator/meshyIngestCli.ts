// Local entrypoint for ingesting a Meshy asset.
//
//   pnpm content:meshy:ingest <metadata.json> [--registry <path>]
//
// Reads a Meshy metadata JSON (a MeshyIngestRequest), runs it through the
// rights pipeline, updates the quarantine registry file, and prints the
// decision with its reasons.
//
// Exit codes are meaningful so this can gate a shell pipeline:
//   0  approved
//   1  malformed input (nothing was written)
//   2  held for review
//   3  blocked
//
// Note that "held" and "blocked" are normal outcomes, not crashes: the point of
// the pipeline is that unsafe assets are recorded and quarantined rather than
// silently dropped or silently published.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ingestMeshyAsset,
  MeshyIngestError,
  type MeshyIngestRequest,
  type MeshyIngestResult,
} from "./meshyIngestion.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = path.join(here, "..", "..", "render-output", "asset-registry", "meshy-quarantine.json");

interface RegistryFile {
  note: string;
  assets: Record<string, unknown>;
}

const REGISTRY_NOTE =
  "Quarantined Meshy assets. Entries here are NOT publishable unless status is 'approved'. Written by scripts/content-automator/meshyIngestCli.ts.";

function loadRegistry(file: string): RegistryFile {
  if (!fs.existsSync(file)) return { note: REGISTRY_NOTE, assets: {} };
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<RegistryFile>;
  return { note: REGISTRY_NOTE, assets: parsed.assets ?? {} };
}

function persist(file: string, result: MeshyIngestResult): void {
  const registry = loadRegistry(file);
  // Keyed by assetId, which is derived from the provider id, so re-ingesting
  // the same Meshy output updates its entry rather than duplicating it.
  registry.assets[result.assetId] = {
    assetId: result.assetId,
    status: result.registryStatus,
    decision: result.publicationDecision,
    geometryMode: result.geometryMode,
    role: result.registryRecord.role,
    productId: result.registryRecord.productId ?? null,
    uri: result.registryRecord.uri,
    mimeType: result.registryRecord.mimeType,
    createdAt: result.registryRecord.createdAt,
    provenance: result.provenance,
    reviewFindings: result.reviewFindings,
    rights: result.rightsManifest,
    reasons: result.reasons,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ordered = Object.fromEntries(Object.entries(registry.assets).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(file, `${JSON.stringify({ note: registry.note, assets: ordered }, null, 2)}\n`);
}

function exitCodeFor(result: MeshyIngestResult): number {
  if (result.publicationDecision === "allow") return 0;
  return result.publicationDecision === "hold" ? 2 : 3;
}

function main(argv: string[]): void {
  const metadataPath = argv.find((arg) => !arg.startsWith("--"));
  if (!metadataPath) {
    console.error("Usage: pnpm content:meshy:ingest <metadata.json> [--registry <path>]");
    process.exitCode = 1;
    return;
  }
  const registryIndex = argv.indexOf("--registry");
  const registryFile = registryIndex >= 0 ? argv[registryIndex + 1] : DEFAULT_REGISTRY;

  let request: MeshyIngestRequest;
  try {
    request = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as MeshyIngestRequest;
  } catch (error) {
    console.error(`Could not read Meshy metadata at ${metadataPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let result: MeshyIngestResult;
  try {
    result = ingestMeshyAsset(request);
  } catch (error) {
    // A MeshyIngestError means the input cannot be described at all. Nothing is
    // written, because a half-described asset in the registry is worse than none.
    const message = error instanceof MeshyIngestError ? `${error.code}: ${error.message}` : String(error);
    console.error(`Refused to ingest: ${message}`);
    process.exitCode = 1;
    return;
  }

  persist(registryFile, result);

  const banner = result.publicationDecision === "allow" ? "APPROVED" : result.publicationDecision === "hold" ? "HELD" : "BLOCKED";
  console.log(`${banner}  ${result.assetId}`);
  console.log(`  status:    ${result.registryStatus}`);
  console.log(`  geometry:  ${result.geometryMode}`);
  console.log(`  role:      ${result.registryRecord.role}`);
  console.log(`  registry:  ${registryFile}`);
  console.log(`  publishable: ${result.publicationDecision === "allow" ? "yes" : "NO"}`);
  if (result.reasons.length) {
    console.log("  why:");
    for (const reason of result.reasons) console.log(`    - ${reason}`);
  }
  process.exitCode = exitCodeFor(result);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));

export { main as runMeshyIngestCli, DEFAULT_REGISTRY };
