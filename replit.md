# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the FrameForge PC Builder + FPS Estimator web application.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (api-server, currently unused by FrameForge)
- **Database**: PostgreSQL + Drizzle ORM (unused by FrameForge — all data is local JSON)

## FrameForge Application

A complete PC Builder + FPS Estimator web application at `artifacts/frameforge/`.

### Tech Stack
- React 18 + React Router v6
- Vite + TypeScript
- Tailwind CSS v4 (via @tailwindcss/vite)
- Framer Motion for animations
- Recharts for comparison charts
- All data in local JSON files (no backend)

### Pages
- `/` — Home page with hero, stats, features, prebuilts preview
- `/builder` — PC Builder with FPS Estimator (main feature)
- `/prebuilts` — 5 curated builds with Load into Builder
- `/compare` — Side-by-side build comparison with Recharts bar chart
- `/about` — About page with FPS algorithm explanation

### Data Files (src/data/)
- `gpus.json` — 50 GPUs (NVIDIA RTX 30/40/50, AMD RX 6000/7000, Intel Arc)
- `cpus.json` — 50 CPUs (Intel 12th/13th/14th Gen, AMD Ryzen 3000/5000/7000/9000)
- `games.json` — 20 games with base FPS for all 12 resolution/preset combos
- `components.json` — Motherboards, RAM, Storage, PSU, Cases, Coolers
- `prebuilts.json` — 5 curated build configs

### Features
- FPS estimation algorithm: base_fps × (gpu_tier/10) × (0.85 + cpu_tier/10 × 0.30)
- Compatibility checking: socket, RAM type, PSU wattage
- Amazon affiliate links on all parts
- Ad slots (ad-header, ad-sidebar, ad-footer)
- Sponsored badges on featured parts

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/frameforge run dev` — run FrameForge locally
