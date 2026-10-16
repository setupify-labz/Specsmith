# Catalog audit — October 2026 (issue #190)

Audit date: 2026-10-16.

- **Ledger:** `src/data/catalogAudit.json` records every part, with the reason for each state and the manufacturer sources.
- **Runtime eligibility list:** `src/data/catalogLifecycle.json` is regenerated with `node scripts/catalog/sync-lifecycle-exclusions.mjs`.
- **Enforcement:** `src/lib/catalogLifecycle.ts`, `src/hooks/useCatalogLifecycle.ts`, `src/lib/catalogLifecycle.test.ts` and `src/lib/retiredRoutes.test.ts`.

## The three states

Each part has three separate states:

- **Validity**
  - `valid`: reviewed, and no defect found. This is not a live retailer check, and it does not change `specsVerified`.
  - `corrected`: a defect was fixed and verified against the cited manufacturer sources.
  - `needs-review`: the record doesn't identify one exact variant.
  - `invalid`: not a real purchasable product as described.
- **Lifecycle**
  - `current`
  - `previous-generation`
  - `legacy`: two or more generations old. This is a **label only**.
- **Recommendation**
  - `eligible` or `ineligible`. A part is ineligible only for a recorded concrete reason: `invalid`, `needs-review`, or `unsuitable` (for example 8 GB of RAM, or a 75 Hz office monitor). **Age is never a reason.** Older parts stay eligible and show an "Older generation" label wherever they appear, including when they are picked as a recommendation.

**Fail closed:** the app treats only ids on the eligible list as recommendable. An unknown id, a retailer-listing id, or a new part with no ledger entry is ineligible until it has been audited. Tests also fail if any listed part is missing from the ledger.

## Inventory (all 12 builder categories)

| Category | Parts | Valid | Corrected | Needs review | Invalid | Current | Prev gen | Legacy | Eligible | Ineligible |
|---|---|---|---|---|---|---|---|---|---|---|
| cpu | 51 | 43 | 8 | 0 | 0 | 11 | 25 | 15 | 51 | 0 |
| gpu | 57 | 37 | 19 | 0 | 1 | 13 | 17 | 27 | 56 | 1 |
| motherboard | 24 | 22 | 1 | 1 | 0 | 12 | 10 | 2 | 23 | 1 |
| ram | 16 | 14 | 0 | 2 | 0 | 11 | 5 | 0 | 13 | 3 |
| storage | 12 | 12 | 0 | 0 | 0 | 11 | 1 | 0 | 12 | 0 |
| psu | 12 | 11 | 0 | 1 | 0 | 8 | 4 | 0 | 11 | 1 |
| case | 12 | 10 | 2 | 0 | 0 | 9 | 0 | 3 | 12 | 0 |
| cooler | 14 | 11 | 0 | 3 | 0 | 10 | 1 | 3 | 11 | 3 |
| monitor | 14 | 13 | 1 | 0 | 0 | 5 | 9 | 0 | 13 | 1 |
| keyboard | 12 | 6 | 3 | 3 | 0 | 7 | 4 | 1 | 9 | 3 |
| mouse | 12 | 8 | 4 | 0 | 0 | 12 | 0 | 0 | 12 | 0 |
| headset | 10 | 10 | 0 | 0 | 0 | 6 | 3 | 1 | 10 | 0 |
| **Total** | **246** | 197 | 38 | 10 | 1 | 115 | 79 | 52 | 233 | 13 |

**Ineligible parts and why:**
- `rtx4050`: invalid.
- `kf8ddr4` and `acer-sb220q`: unsuitable.
- The other 10 need review because no exact variant is recorded: X670E Crosshair, Ripjaws and Dominator kits, RM750x, Hyper 212, H100i/H150i Elite, G Pro X, Ducky One 3 and K616.

## Verification of the corrections

Every correction was checked against a manufacturer page, and each page's URL is stored on the entry. Two of the earlier corrections did not hold up and were changed:

- **Razer Basilisk V3 X:** Razer lists **7** programmable buttons, not 9. The record now says 7.
- **Lian Li PC-O11 Dynamic:** E-ATX support is confirmed, but Mini-ITX is not confirmed in Lian Li's spec text, so it was **not** added.

| Part | Fix | Source |
|---|---|---|
| Ryzen 7 7800X3D | base clock 4.5 → 4.2 GHz | amd.com product page |
| Ryzen 9 7950X3D | power 162 → 120 W default TDP | amd.com product page |
| RX 6000/7000 (19) | `RDNA2`/`RDNA3` → `RDNA 2`/`RDNA 3` (naming only) | AMD RDNA 3 launch release |
| Gigabyte B760M DS3H | name now says "DDR4" | gigabyte.com spec page |
| Lian Li PC-O11 Dynamic | adds E-ATX support | lian-li.com product page |
| Hyte Y60 | GPU clearance 400 → 375 mm | HYTE support article |
| LG 34GP63A-B | 3440x1440, VA panel | lg.com product page |
| Razer BlackWidow V4 Pro | wired (the V4 Pro 75% is a different, wireless model) | razer.com product and support pages |
| Keychron Q2 Pro | 65% layout | keychron.com product page |
| Corsair K100 | `Full-size` → `Full` (vocabulary only) | — |
| Razer DeathAdder V3 Pro | 63 g | razer.com product page |
| ASUS ROG Harpe Ace Extreme | 47 g, 2024 | ASUS product page and press release |
| Razer Basilisk V3 X HyperSpeed | 7 programmable buttons | Razer support spec sheet |
| Logitech MX Master 3S | released 2022 | Logitech announcement, 24 May 2022 |
| 6 CPUs (12400F, 13100F, 14100F, 285K, 265K, 245K) | power split into base and max turbo (see below) | intel.com spec pages |

Note on the i3-13100F: intel.com's production spec page lists 110 W maximum turbo, but a staging mirror lists 89 W. The production page is recorded, and the conflict is noted on the entry.

## CPU power (decision 2)

`tdp_watts` on CPUs was ambiguous: 45 records stored peak power, and 6 Intel records stored base power. It has been replaced by:

- `base_power_watts`: Intel Processor Base Power, or AMD Default TDP.
- `max_turbo_power_watts`: Intel Maximum Turbo Power. It is **`null` for AMD**, because AMD publishes no per-model figure. Its socket power limit (PPT) is set by the motherboard and appears only in forum reports, so it is not recorded as fact.
- `integrated_graphics`: the manufacturer's integrated-graphics name, or `null`.

The PSU and cooler checks use maximum turbo power where it is published, and the rated TDP otherwise. The warning text says which figure it used. For a selected CPU with no published figure, the check is skipped (fail closed). Every CPU cites its manufacturer spec page.

**Effect:** builds using the i5-12400F, i3-13100F, i3-14100F or Core Ultra 200S now size the PSU and cooler on the real peak draw. For example, a Core Ultra 9 285K is checked at 250 W, not 125 W.

## Office builds (decision 3)

The $250 GPU cap was reverted. The "Everyday Office" and "Power Multitasker" tiers now have **no discrete GPU** (`maxGpuPrice: null`) and choose only CPUs with integrated graphics. "Hybrid Work + Light Creative" keeps an entry-level card. The page copy and FAQ now explain this, and tell beginners to check that the motherboard has the video outputs they need.

## RTX 4050 retirement and SEO audit (decision 1)

**What was checked:**
- **Routes:** `/vs/rtx-4050-vs-arc-b570`, `/vs/rtx-5050-vs-rtx-4050` and `/upgrade/rtx-4050` were prerendered, listed in the sitemap, and linked internally from the `/vs` and `/upgrade` indexes and the related-page blocks.
- **Other public surfaces:** the GPU tier list, the budget tables, every low-end upgrade page's "faster GPUs" list, and the Compare picker.
- **Traffic:** no Search Console or analytics data is available in this environment, so the traffic and ranking impact of these three URLs is **unmeasured**.

**What changed:**
- The three routes are removed from the route list and the sitemap (376 → 373 URLs), and they now **301-redirect** (`public/_redirects`):
  - both matchups → `/vs/arc-b570-vs-rtx-5050`, which compares the real entry-level desktop card against the original rival;
  - the upgrade guide → `/upgrade`.
- The tier list and upgrade-target lists leave out invalid parts. Older cards stay.
- Budget tables and the Compare picker still list the record, labelled "Not a retail desktop part", and it is never a pick.
- The `rtx4050` record and its benchmark identity are kept.

**Follow-up after deploy:** resubmit the sitemap and check Search Console for the three redirected URLs. This needs founder access.

## Duplicates

- **Canonical catalog:** no duplicate ids or names. A test enforces this.
- **Newegg feed:** the Crucial MX500 1TB is listed twice by marketplace sellers, at $745.45 and $278.45. That has to be fixed in the feed generator (workstream #04), because the feed is regenerated daily.

## Performance

Builder initial JavaScript is 143.8 KB gzip against a 145 KB limit; `main` measured 142.6 KB. To keep it there, the Builder loads the eligibility list after the page opens. Until it arrives there are no accolade badges or recommended highlights, which is the fail-closed direction. Prerendered guide pages import the list directly.

## Open items for Aaron

1. AMD maximum power: adopt a published AMD document for socket power limits if one is found, or keep using rated TDP for AMD.
2. Approve the lifecycle labels and the two "unsuitable" exclusions.
3. Search Console follow-up for the three redirected URLs.
