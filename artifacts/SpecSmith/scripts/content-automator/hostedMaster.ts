// The controlled upload step between a verified local master and Metricool.
//
// WHY. The publish gate re-hashes the LOCAL master, but Metricool fetches an
// HTTPS URL. A URL plus a digest supplied by the caller (or read from a
// registry the caller populated) proves nothing about the bytes that URL
// serves. So the only accepted media reference is one produced here:
//
//  1. the receipt must be a genuine compositor receipt, and the local master
//     is re-hashed and must still equal the receipt's master digest;
//  2. those exact bytes are handed to a MasterUploader, under a
//     content-addressed object name (`<sha256>.mp4`);
//  3. the returned URI must be https and must contain that digest;
//  4. the URI is then DOWNLOADED independently, with the `fetch` that was
//     global when this module loaded (not anything the uploader supplies),
//     with redirects refused, and the downloaded bytes must hash to the
//     receipt's master digest.
//
// Only then is a HostedMaster issued: frozen, registered in a module-private
// WeakSet, bound to the URI, the digest and the receipt digest. The builder
// accepts nothing else, and downloads the URI AGAIN immediately before it
// constructs the request (`reverifyHostedMaster`), so a host that changes its
// bytes after upload is refused too.
//
// NOT DEFENDED (see publishGate.ts): a host that serves different bytes to
// Metricool than to this process, bytes changed in the window between the
// final re-download and Metricool's own fetch, and code that replaces
// `globalThis.fetch` before this module loads. Content-addressed, immutable
// object storage is the operational mitigation for the window.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { isIssuedRenderReceipt, type RenderReceipt } from "./motionCompositor.ts";

export interface MasterUploadRequest {
  bytes: Uint8Array;
  sha256: string;
  contentType: "video/mp4";
  /** Content-addressed: `<sha256>.mp4`. The returned URI must contain the digest. */
  objectName: string;
}

/** A storage backend. Its claims are never trusted; its URI is re-downloaded. */
export interface MasterUploader {
  upload(request: MasterUploadRequest): Promise<{ uri: string }>;
}

export interface HostedMaster {
  readonly uri: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly receiptDigest: string;
  readonly verifiedAt: string;
}

export class HostedMasterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "HostedMasterError";
    this.code = code;
  }
}

const BUILTIN_FETCH: unknown = globalThis.fetch;
const ISSUED_HOSTED = new WeakSet<object>();
const DOWNLOAD_TIMEOUT_MS = 120_000;

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function checkUri(uri: unknown, sha256: string): URL {
  let url: URL;
  try {
    url = new URL(String(uri));
  } catch {
    throw new HostedMasterError("hosted-uri-invalid", `The uploader returned "${String(uri)}", which is not a URL.`);
  }
  if (url.protocol !== "https:") {
    throw new HostedMasterError("hosted-uri-invalid", `The hosted master must be https, not ${url.protocol}.`);
  }
  if (!url.pathname.includes(sha256)) {
    throw new HostedMasterError(
      "hosted-uri-invalid",
      `The hosted object ${url.pathname} is not content-addressed by the master digest ${sha256.slice(0, 16)}…`,
    );
  }
  return url;
}

/** Downloads a URL with the load-time fetch and returns the SHA-256 and length of the body. */
async function download(url: URL): Promise<{ sha256: string; bytes: number }> {
  if (typeof BUILTIN_FETCH !== "function") {
    throw new HostedMasterError("hosted-download-failed", "No built-in fetch is available to verify the hosted master.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (BUILTIN_FETCH as typeof fetch)(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new HostedMasterError(
      "hosted-download-failed",
      `Downloading ${url.href} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new HostedMasterError("hosted-download-failed", `Downloading ${url.href} returned HTTP ${response.status}.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  return { sha256: sha256Hex(body), bytes: body.byteLength };
}

/**
 * Uploads the receipt's verified local master and proves the hosted copy is
 * byte-identical. Throws on any failure; never returns unverified evidence.
 */
export async function uploadAndVerifyMaster(receipt: RenderReceipt, uploader: MasterUploader): Promise<HostedMaster> {
  if (!isIssuedRenderReceipt(receipt)) {
    throw new HostedMasterError("untrusted-receipt", "Only a compositor-issued receipt's master can be uploaded.");
  }
  const local = new Uint8Array(await readFile(receipt.masterPath));
  if (sha256Hex(local) !== receipt.masterSha256) {
    throw new HostedMasterError("master-changed", `The local master at ${receipt.masterPath} no longer matches its receipt.`);
  }
  const { uri } = await uploader.upload({
    bytes: local,
    sha256: receipt.masterSha256,
    contentType: "video/mp4",
    objectName: `${receipt.masterSha256}.mp4`,
  });
  const url = checkUri(uri, receipt.masterSha256);
  const hosted = await download(url);
  if (hosted.sha256 !== receipt.masterSha256 || hosted.bytes !== local.byteLength) {
    throw new HostedMasterError(
      "hosted-master-mismatch",
      `${url.href} serves ${hosted.bytes} bytes hashing to ${hosted.sha256.slice(0, 16)}…; the approved master is `
      + `${local.byteLength} bytes hashing to ${receipt.masterSha256.slice(0, 16)}….`,
    );
  }
  const evidence: HostedMaster = Object.freeze({
    uri: url.href,
    sha256: receipt.masterSha256,
    bytes: local.byteLength,
    receiptDigest: receipt.digest,
    verifiedAt: new Date().toISOString(),
  });
  ISSUED_HOSTED.add(evidence);
  return evidence;
}

/** Whether `value` is hosted-master evidence this module issued, unaltered. */
export function isVerifiedHostedMaster(value: unknown): value is HostedMaster {
  return value !== null && typeof value === "object" && ISSUED_HOSTED.has(value) && Object.isFrozen(value);
}

/**
 * Downloads an issued hosted master AGAIN and throws unless it still serves
 * the verified bytes. Called by the publishing builder immediately before it
 * constructs a request.
 */
export async function reverifyHostedMaster(hosted: HostedMaster): Promise<void> {
  if (!isVerifiedHostedMaster(hosted)) {
    throw new HostedMasterError("hosted-master-unverified", "The hosted master was not produced by uploadAndVerifyMaster.");
  }
  const now = await download(checkUri(hosted.uri, hosted.sha256));
  if (now.sha256 !== hosted.sha256 || now.bytes !== hosted.bytes) {
    throw new HostedMasterError(
      "hosted-master-mismatch",
      `${hosted.uri} now serves bytes hashing to ${now.sha256.slice(0, 16)}…, not the verified ${hosted.sha256.slice(0, 16)}….`,
    );
  }
}
