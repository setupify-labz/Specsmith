/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// PORT only configures the local dev/preview server (server.port /
// preview.port below) — it has no effect on `vite build` — so it falls
// back to a default instead of failing builds that never set it.
const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH affects the build's asset URL prefix. Every deployment of
// this site serves from the domain root, so default to "/" rather than
// failing builds in environments (e.g. Cloudflare Pages preview) where
// it wasn't explicitly configured.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  test: {
    // research/ holds research-only tooling that is not part of the shipped
    // app. Its suites use a self-contained zero-dependency harness and are run
    // by `node research/userbenchmark/test/run-tests.mjs`, not by Vitest.
    // Vitest's default glob picks up their *.test.mjs files, finds no Vitest
    // suite in them, and fails — which made `pnpm test` exit 1 even though all
    // 94 application tests passed. Excluding the directory keeps one runner per
    // suite instead of having Vitest half-adopt files it cannot execute.
    exclude: ["**/node_modules/**", "**/dist/**", "research/**"],
  },
});
