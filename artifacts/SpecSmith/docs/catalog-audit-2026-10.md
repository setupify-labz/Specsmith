# Catalog audit — October 2026

Audit date: 2026-10-16. Ledger: `src/data/catalogAudit.json` (every part, with the reason for its state). Runtime exclusion list: `src/data/catalogLifecycle.json`. Enforcement: `src/lib/catalogLifecycle.ts` and `src/lib/catalogLifecycle.test.ts`.

## What the states mean

**Validity**

- `valid`: reviewed by hand against manufacturer-published specs, and no defect found. This is **not** a live check against a retailer or manufacturer, and it does not change any part's `specsVerified` flag.
- `corrected`: a defect was found and fixed in this audit.
- `needs-review`: the variant is ambiguous or the record uses an inconsistent convention. Kept out of recommendations until someone resolves it.
- `invalid`: not a real retail product as described. Kept so existing ids still resolve, but never recommended.

**Lifecycle**

- `current`: current generation.
- `previous-generation`: superseded but still sold new. Can still be recommended.
- `legacy`: obsolete for new builds. Kept for benchmarks, upgrade comparisons and saved builds, but never auto-recommended.

A part is **recommendable** only when its validity is `valid` or `corrected` and its lifecycle is not `legacy`.

## Inventory (all 12 builder categories)

| Category | Parts | Valid | Corrected | Needs review | Invalid | Current | Previous gen | Legacy |
|---|---|---|---|---|---|---|---|---|
| cpu | 51 | 43 | 2 | 6 | 0 | 11 | 25 | 15 |
| gpu | 57 | 37 | 19 | 0 | 1 | 13 | 17 | 27 |
| motherboard | 24 | 22 | 1 | 1 | 0 | 12 | 10 | 2 |
| ram | 16 | 14 | 0 | 2 | 0 | 11 | 4 | 1 |
| storage | 12 | 12 | 0 | 0 | 0 | 11 | 1 | 0 |
| psu | 12 | 11 | 0 | 1 | 0 | 8 | 2 | 2 |
| case | 12 | 10 | 2 | 0 | 0 | 9 | 0 | 3 |
| cooler | 14 | 11 | 0 | 3 | 0 | 10 | 1 | 3 |
| monitor | 14 | 13 | 1 | 0 | 0 | 5 | 8 | 1 |
| keyboard | 12 | 6 | 3 | 3 | 0 | 7 | 4 | 1 |
| mouse | 12 | 8 | 4 | 0 | 0 | 12 | 0 | 0 |
| headset | 10 | 10 | 0 | 0 | 0 | 6 | 3 | 1 |
| **Total** | **246** | 197 | 32 | 16 | 1 | 115 | 75 | 56 |

## Duplicates

- **Canonical catalog:** no duplicate ids or product names. Near-matches are real, separate SKUs (for example RX 9060 XT 8GB/16GB, Arc A770 8GB/16GB, and Trident Z5 DDR5-6000 vs Trident Z5 RGB DDR5-6400). A test now blocks future duplicates.
- **Newegg feed (`public/data/retail-parts.json`):** one UPC appears twice. Both listings are Crucial MX500 1TB, sold by third-party marketplace sellers, at $745.45 and $278.45, for a drive that normally sells for under $100. The feed is regenerated every day, so editing the JSON would not last. The fix belongs in the generator, as part of the suspicious-price and duplicate-offer rejection in workstream 04.

## Corrections made

| Part | Fix |
|---|---|
| Ryzen 7 7800X3D | base clock 4.5 → 4.2 GHz |
| Ryzen 9 7950X3D | TDP 162 → 120 W (162 W is PPT; every other AMD record stores TDP) |
| RX 6000/7000 (19 GPUs) | architecture `RDNA2`/`RDNA3` → `RDNA 2`/`RDNA 3`, to match `RDNA 4` |
| Gigabyte B760M DS3H | renamed "… DDR4". The plain name is the DDR5 board, so the old name pointed shoppers at the wrong variant |
| Lian Li PC-O11 Dynamic | motherboard support adds E-ATX and ITX |
| Hyte Y60 | GPU clearance 400 → 375 mm |
| LG 34GP63A-B | resolution 1440p → 3440x1440p, panel IPS → VA |
| Razer BlackWidow V4 Pro | wireless → wired |
| Keychron Q2 Pro | 75% → 65% |
| Corsair K100 | form factor `Full-size` → `Full` |
| Razer DeathAdder V3 Pro | 88 g → 63 g |
| ASUS ROG Harpe Ace Extreme | 54 g → 47 g, 2023 → 2024 |
| Razer Basilisk V3 X HyperSpeed | 6 → 9 buttons |
| Logitech MX Master 3S | release year 2023 → 2022 |

Prices, benchmark scores and FPS multipliers were **not** changed.

## Invalid

- **`rtx4050`**: NVIDIA never released a desktop RTX 4050; it exists only as a laptop GPU. The record stays because `matchups.ts` (two pages) and `upgradePages.ts` (one page) reference it. It is labelled "Not a retail desktop part" and excluded from every recommendation. Whether to retire those three public pages is a decision for Aaron (see below).

## Needs review (excluded from recommendations)

- **Ambiguous variants:** ROG Crosshair X670E, Hyper 212, H100i/H150i Elite, RM750x, Logitech "G Pro X TKL" (the name and specs describe different products), Ducky One 3, Redragon K616, Corsair Dominator 32GB DDR5-5600, and G.Skill Ripjaws 32GB DDR4-3600.
- **Inconsistent CPU power convention:** i5-12400F, i3-13100F, i3-14100F and Core Ultra 9 285K / 7 265K / 5 245K store base power. Every other Intel record stores maximum turbo power. `tdp_watts` feeds PSU and cooler checks, so one convention has to be chosen before these values change.

## Where the lifecycle is enforced

Recommendations use only recommendable parts. That covers the quiz, the use-case builds, the budget-page picks and FAQ answer, the component-guide picks, the SFF builds, the Builder's "recommended" highlights, and its Best Value / Best Performance badges. Lists, tables, benchmarks, matchups and upgrade calculators still show every part, with non-recommended ones labelled.

One knock-on change: the "Everyday Office" use-case tier's GPU cap went from $200 to $250, because every GPU under $200 is now legacy.

## Open decisions for Aaron

1. Retire or redirect the RTX 4050 matchup and upgrade pages?
2. Which CPU power convention should `tdp_watts` use: base power or maximum turbo power?
3. Should office builds recommend no discrete GPU instead of the cheapest current card?
4. The lifecycle classifications are product judgements made as of 2026-10-16. Approve them or adjust them.
