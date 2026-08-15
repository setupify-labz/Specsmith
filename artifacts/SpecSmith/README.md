# SpecSmith

**Free PC builder + FPS estimator.** Pick real parts, see estimated FPS across 20 benchmarked games before you buy, and catch compatibility problems instantly — no account required.

🔗 **Live site:** [specsmithpc.com](https://specsmithpc.com)

## What it does

- **Builder** — assemble a full PC from a real, priced parts database and get live compatibility checks (socket mismatches, PSU wattage shortfalls, case/cooler clearance) as you go.
- **FPS Estimator** — estimated frame rates across 20 benchmarked games at 1080p/1440p/4K, for any GPU + CPU pairing in the dataset.
- **Compare & Matchups** — head-to-head GPU/CPU comparisons with FPS-per-dollar value breakdowns.
- **Tier Lists & Budget Guides** — every tracked GPU/CPU ranked by performance, or filtered to a price ceiling.
- **Upgrade Calculator** — tells you what to upgrade your current GPU/CPU to, with estimated resale value and real net cost.
- **Build Crate** — a gacha-style random build generator, for when you just want to see what you'd get.
- **Gallery** — browse and share community builds.

Every price and FPS number comes from a real, maintained dataset — 57 GPUs, 51 CPUs, and 20 games — refreshed monthly, not scraped or invented.

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (auth + saved builds)
- Hosted on Cloudflare Workers, with 350+ pages statically prerendered for SEO

## Status

Actively developed. This repo is private during active development.
