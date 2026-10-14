import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const allowedPath = (name) => {
  if (!/^artifacts\/SpecSmith\/src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css)$/.test(name)) return false;
  const parts = name.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
};

export function validatePatch(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? '', 'utf8');
  let patch;
  try { patch = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Patch is not valid UTF-8'); }
  if (!patch || bytes.length > 256_000 || patch.includes('\0') || patch.includes('\r')) throw new Error('Patch is missing or exceeds the text-only size limit');
  const headers = [...patch.matchAll(/^diff --git (.+)$/gm)].map((match) => match[1]);
  if (headers.length < 1 || headers.length > 20) throw new Error('Expected 1–20 changed files');
  const seen = new Set();
  for (const header of headers) {
    const match = /^a\/(artifacts\/SpecSmith\/src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css)) b\/\1$/.exec(header);
    if (!match || !allowedPath(match[1]) || seen.has(match[1])) throw new Error(`Refused diff path: ${header}`);
    seen.add(match[1]);
  }
  const indexLines = [...patch.matchAll(/^index [^\n]+$/gm)].map((m) => m[0]);
  if (indexLines.length !== headers.length || indexLines.some((line) => !/^index [0-9a-f]+\.\.[0-9a-f]+ 100644$/.test(line))) throw new Error('Non-regular file mode or missing index refused');
  if (/^(?:new file mode|deleted file mode|old mode|new mode|similarity index|rename (?:from|to)|copy (?:from|to)|GIT binary patch|Binary files|Submodule |index [0-9a-f]+\.{2}[0-9a-f]+ 160000)\b/m.test(patch)) throw new Error('File creation, deletion, mode changes, links, renames and binary patches are refused');
  // Every file must have exactly one ordinary a/... to b/... pair; git apply --check remains required.
  const old = [...patch.matchAll(/^--- a\/(.+)$/gm)].map((m) => m[1]);
  const next = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  if (old.length !== headers.length || next.length !== headers.length || old.some((p, i) => p !== next[i] || !seen.has(p))) throw new Error('Patch paths do not match diff headers');
  return { sha256: createHash('sha256').update(bytes).digest('hex'), paths: [...seen].sort() };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [file, expected] = process.argv.slice(2);
  if (!file) throw new Error('usage: validate-proposal.mjs patch-file [expected-sha256]');
  const result = validatePatch(readFileSync(file));
  if (expected && result.sha256 !== expected) throw new Error('Published patch does not match checked patch');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
