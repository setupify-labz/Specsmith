# Part discovery (issue #192)

This job finds new and relevant parts on the Newegg feed (Rakuten LinkShare, the same authorized source as the daily price refresh) and writes a **staging file** for human review. It never publishes.

## What it does

1. **Searches.** It runs one search per category, using the published catalogue's own keyword and category-leaf pairs plus a new **fans** search (`discoveryConfig.ts`). The fans leaf has not yet been observed on the live feed. If it's wrong, the run report shows zero listings for fans.
2. **Admits.** It applies the same gates as the published catalogue: merchant, exact category leaf, new condition only, part kind, tracked-link shape, and title/destination identity conflict. Prices are deliberately not read: an observed feed price is not a verified offer (#194).
3. **Deduplicates exactly.** Listings merge only when they share a UPC (UPC-A and EAN-13 forms are treated as equal) and their titles don't state conflicting models or capacities. A shared UPC with conflicting titles goes to `ambiguous` and is never merged. A listing without a UPC is staged on its own, keyed by retailer SKU.
4. **Proposes a canonical match** only through the existing matchers: `verifyGpuModel` for GPUs and the reviewed CPU identity binding for CPUs. Otherwise the proposal is `none`.
5. **Orders the queue** current-generation first (`generation.ts`). Each tier names the rule that put the part there, and **nothing is dropped for age**.

## Run it

```sh
RAKUTEN_API_ACCESS_TOKEN=... pnpm exec tsx scripts/retail/discovery/discover-parts.ts --out /tmp/staged-parts.json
```

The output path must be outside the repository. In CI, `.github/workflows/discover-parts.yml` runs weekly:
- `contents: read` only;
- credentials confined to one step;
- the staging file uploaded as a 14-day artifact;
- a final check that the checkout is unmodified.

## Guarantees (tested)

- Every published catalogue file is byte-identical after a run (`discoverParts.test.ts`).
- Every staged record has `status: "staged"`, and the file is marked `publication: "staged-not-published"`.
- A failed search is reported and the run continues. Error text, which could carry a URL, is not stored.
- Staged parts cannot be recommended: recommendation eligibility fails closed on the audited ledger (#190).

Fixtures in `__fixtures__/` are **synthetic** and labelled as such. Promoting a staged part into `src/data` is a separate reviewed step and is not automated.
