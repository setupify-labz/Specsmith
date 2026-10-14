import { readFileSync } from 'node:fs';
import { validatePatch } from './validate-proposal.mjs';

export function recordChecked(patch, baseSha) {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error('Invalid tested base SHA');
  return { ...validatePatch(patch), baseSha };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [patchFile, baseSha] = process.argv.slice(2);
  if (!patchFile || !baseSha) throw new Error('usage: record-checked.mjs patch-file base-sha');
  process.stdout.write(`${JSON.stringify(recordChecked(readFileSync(patchFile), baseSha))}\n`);
}
