// Regenerates src/data/catalogLifecycle.json (the client-side eligibility
// list) from the annotated ledger src/data/catalogAudit.json. Run after
// editing the ledger: `node scripts/catalog/sync-lifecycle-exclusions.mjs`.
// catalogLifecycle.test.ts fails if the two drift apart.
//
// Output shape:
//   eligible — every id that may be recommended. Anything NOT listed (an
//              unaudited or unknown id) is ineligible: the list fails closed.
//   labels   — the one label the UI shows for a part: the ineligibility reason
//              when there is one, otherwise "legacy" for an eligible older part.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalogAudit.json'), 'utf8'));

const eligible = [];
const labels = {};
for (const [id, entry] of Object.entries(ledger.entries)) {
  if (entry.recommendation === 'eligible') eligible.push(id);
  if (entry.recommendation === 'ineligible') labels[id] = entry.ineligibleReason;
  else if (entry.lifecycle === 'legacy') labels[id] = 'legacy';
}
eligible.sort();
fs.writeFileSync(path.join(dataDir, 'catalogLifecycle.json'), JSON.stringify({ eligible, labels }) + '\n');
console.log(`${eligible.length} of ${Object.keys(ledger.entries).length} parts eligible for recommendations.`);
