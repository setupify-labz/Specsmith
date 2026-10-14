import { readFileSync } from 'node:fs';
import { validatePatch } from './validate-proposal.mjs';

export function verifyChecked(patch, report, baseSha) {
  const validated = validatePatch(patch);
  if (!/^[0-9a-f]{40}$/.test(baseSha ?? '') || report?.baseSha !== baseSha) throw new Error('Publisher base differs from checked base');
  if (!report || report.sha256 !== validated.sha256 || JSON.stringify(report.paths) !== JSON.stringify(validated.paths)) {
    throw new Error('Proposed diff is not the diff that passed checks');
  }
  return { ...validated, baseSha };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [patchFile, reportFile, baseSha] = process.argv.slice(2);
  if (!patchFile || !reportFile || !baseSha) throw new Error('usage: verify-checked.mjs patch-file checked-report-file base-sha');
  verifyChecked(readFileSync(patchFile), JSON.parse(readFileSync(reportFile, 'utf8')), baseSha);
}
