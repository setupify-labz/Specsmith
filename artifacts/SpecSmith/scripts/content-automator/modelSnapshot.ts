// The identity of the model every SpecSmith FPS figure comes from.
//
// A capture, a caption or a narrated number is only as current as the model
// that produced it. This hashes the bytes of the files that decide an estimate,
// a Compare average and a tie, so a review can tell whether evidence was made
// from the model that ships now. It is a hash of source files, not a promise
// about the served app: what the served page showed is proved separately, by
// the capture's verified text.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Relative to the app root. Changing any of these can change a figure Compare shows. */
export const MODEL_SOURCE_FILES = [
  "src/data/gpus.json",
  "src/data/cpus.json",
  "src/data/games.json",
  "src/lib/fps.ts",
  "src/lib/compareValue.ts",
  "src/lib/compareTally.ts",
] as const;

export function modelSnapshotSha256(): string {
  const hash = createHash("sha256");
  for (const file of MODEL_SOURCE_FILES) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(`${root}${file}`));
  }
  return hash.digest("hex");
}
