import { readFileSync } from 'node:fs';
import { validatePatch } from './validate-proposal.mjs';

export function verifyChecked(patch, report) {
  const validated = validatePatch(patch);
  if (!report || report.sha256 !== validated.sha256 || JSON.stringify(report.paths) !== JSON.stringify(validated.paths)) {
    throw new Error('Proposed diff is not the diff that passed checks');
  }
  return validated;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [patchFile, reportFile] = process.argv.slice(2);
  if (!patchFile || !reportFile) throw new Error('usage: verify-checked.mjs patch-file checked-report-file');
  verifyChecked(readFileSync(patchFile, 'utf8'), JSON.parse(readFileSync(reportFile, 'utf8')));
}
