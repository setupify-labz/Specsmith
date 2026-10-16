// Regenerates src/data/catalogLifecycle.json (the client-side exclusion list)
// from the annotated ledger src/data/catalogAudit.json. Run after editing the
// ledger: `node scripts/catalog/sync-lifecycle-exclusions.mjs`.
// catalogLifecycle.test.ts fails if the two drift apart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalogAudit.json'), 'utf8'));

const excluded = {};
for (const [id, entry] of Object.entries(ledger.entries)) {
  if (entry.validity === 'invalid') excluded[id] = 'invalid';
  else if (entry.lifecycle === 'legacy') excluded[id] = 'legacy';
  else if (entry.validity === 'needs-review') excluded[id] = 'needs-review';
}
fs.writeFileSync(path.join(dataDir, 'catalogLifecycle.json'), JSON.stringify(excluded, null, 2) + '\n');
console.log(`${Object.keys(excluded).length} of ${Object.keys(ledger.entries).length} parts excluded from recommendations.`);
