// Local entrypoint for ingesting one concrete Meshy output file.
//
//   pnpm content:meshy:ingest <metadata.json> [--registry <path>]
//
// Exit codes:
//   0 approved
//   1 malformed input / hash verification failure; nothing written
//   2 held for review
//   3 blocked

import { createHash } from "node:crypto";
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

interface ParsedArgs {
  metadataPath: string;
  registryFile: string;
}

const REGISTRY_NOTE =
  "Quarantined Meshy assets. Entries are not publishable unless status is 'approved'. Each asset id is content-addressed by output SHA-256.";

function loadRegistry(file: string): RegistryFile {
  if (!fs.existsSync(file)) return { note: REGISTRY_NOTE, assets: {} };
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<RegistryFile>;
  if (parsed.assets !== undefined && (!parsed.assets || typeof parsed.assets !== "object" || Array.isArray(parsed.assets))) {
    throw new Error(`Registry ${file} has a malformed assets object.`);
  }
  return { note: REGISTRY_NOTE, assets: parsed.assets ?? {} };
}

/** Strict parsing: one positional metadata file and one optional --registry value. */
export function parseMeshyIngestArgs(argv: string[]): ParsedArgs {
  let metadataPath: string | undefined;
  let registryFile = DEFAULT_REGISTRY;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--registry requires a path value.");
      registryFile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    if (metadataPath) throw new Error(`Unexpected extra positional argument: ${arg}`);
    metadataPath = arg;
  }
  if (!metadataPath) throw new Error("Usage: pnpm content:meshy:ingest <metadata.json> [--registry <path>]");
  return { metadataPath, registryFile };
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyOneFileUri(uri: string, expectedSha256: string, label: string): void {
  if (!uri.startsWith("file:")) return;
  const file = fileURLToPath(uri);
  if (!fs.existsSync(file)) throw new MeshyIngestError("missing-local-file", `${label} does not exist: ${file}`);
  const actual = sha256File(file);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new MeshyIngestError(
      "local-hash-mismatch",
      `${label} hash mismatch: metadata says sha256:${expectedSha256.toLowerCase()}, actual file is sha256:${actual}.`,
    );
  }
}

/**
 * The pure ingestion module validates hashes syntactically and binds approvals
 * to them. The CLI additionally verifies local file:// bytes before registry
 * mutation, including local source references.
 */
export function verifyLocalMeshyHashes(request: MeshyIngestRequest): void {
  if (request.outputFile?.uri && request.outputFile?.sha256) {
    verifyOneFileUri(request.outputFile.uri, request.outputFile.sha256, "outputFile");
  }
  for (const [index, reference] of (request.sourceReferences ?? []).entries()) {
    if (reference?.uri && reference?.sha256) verifyOneFileUri(reference.uri, reference.sha256, `sourceReferences[${index}]`);
  }
}

/** Atomic replace: a crash cannot leave half-written JSON as the registry. */
export function persistMeshyResultAtomic(file: string, result: MeshyIngestResult): void {
  const registry = loadRegistry(file);
  registry.assets[result.assetId] = {
    assetId: result.assetId,
    status: result.registryStatus,
    decision: result.publicationDecision,
    geometryMode: result.geometryMode,
    role: result.registryRecord.role,
    productId: result.registryRecord.productId ?? null,
    uri: result.registryRecord.uri,
    mimeType: result.registryRecord.mimeType,
    sha256: result.registryRecord.sha256,
    createdAt: result.registryRecord.createdAt,
    provenance: result.provenance,
    reviewFindings: result.reviewFindings,
    rights: result.rightsManifest,
    reasons: result.reasons,
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ordered = Object.fromEntries(Object.entries(registry.assets).sort(([a], [b]) => a.localeCompare(b)));
  const payload = `${JSON.stringify({ note: registry.note, assets: ordered }, null, 2)}\n`;
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(temp, payload, { encoding: "utf-8", flag: "wx" });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Preserve the original error; best-effort temp cleanup only.
    }
    throw error;
  }
}

function exitCodeFor(result: MeshyIngestResult): number {
  if (result.publicationDecision === "allow") return 0;
  return result.publicationDecision === "hold" ? 2 : 3;
}

function readRequest(metadataPath: string): MeshyIngestRequest {
  const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Metadata JSON must contain one MeshyIngestRequest object.");
  return parsed as MeshyIngestRequest;
}

function main(argv: string[]): void {
  let args: ParsedArgs;
  try {
    args = parseMeshyIngestArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  let request: MeshyIngestRequest;
  try {
    request = readRequest(args.metadataPath);
    verifyLocalMeshyHashes(request);
  } catch (error) {
    console.error(`Could not verify Meshy metadata/output: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let result: MeshyIngestResult;
  try {
    result = ingestMeshyAsset(request);
  } catch (error) {
    const message = error instanceof MeshyIngestError ? `${error.code}: ${error.message}` : String(error);
    console.error(`Refused to ingest: ${message}`);
    process.exitCode = 1;
    return;
  }

  try {
    persistMeshyResultAtomic(args.registryFile, result);
  } catch (error) {
    console.error(`Could not atomically update registry ${args.registryFile}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const banner = result.publicationDecision === "allow" ? "APPROVED" : result.publicationDecision === "hold" ? "HELD" : "BLOCKED";
  console.log(`${banner}  ${result.assetId}`);
  console.log(`  status:      ${result.registryStatus}`);
  console.log(`  geometry:    ${result.geometryMode}`);
  console.log(`  role:        ${result.registryRecord.role}`);
  console.log(`  sha256:      ${result.registryRecord.sha256}`);
  console.log(`  registry:    ${args.registryFile}`);
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
