import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
const entriesByFile = new Map(Object.entries(manifest).map(([key, value]) => [value.file, { key, ...value }]));

const budgets = {
  'index.html': 82,
  'src/pages/Home.tsx': 95,
  'src/pages/Builder.tsx': 145,
  'src/pages/Compare.tsx': 105,
  'src/pages/BuildCrate.tsx': 160,
  'src/pages/ComponentGuidePage.tsx': 100,
};

function entryFor(key) {
  return manifest[key] ?? entriesByFile.get(key);
}

function initialJsFiles(routeKey) {
  const files = new Set();
  const seen = new Set();

  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = entryFor(key);
    if (!entry) throw new Error(`Performance budget entry is missing from the manifest: ${key}`);
    if (entry.file.endsWith('.js')) files.add(entry.file);
    for (const imported of entry.imports ?? []) visit(imported);
  }

  visit('index.html');
  if (routeKey !== 'index.html') visit(routeKey);
  return files;
}

let failed = false;
for (const [routeKey, limitKb] of Object.entries(budgets)) {
  const bytes = [...initialJsFiles(routeKey)].reduce((total, file) => {
    return total + gzipSync(fs.readFileSync(path.join(dist, file))).byteLength;
  }, 0);
  const sizeKb = bytes / 1024;
  const label = routeKey === 'index.html' ? 'shared shell' : routeKey.replace('src/pages/', '').replace('.tsx', '');
  console.log(`[performance] ${label}: ${sizeKb.toFixed(1)} KB gzip / ${limitKb} KB budget`);
  if (sizeKb > limitKb) failed = true;
}

if (failed) {
  throw new Error('Initial JavaScript exceeds a performance budget. Split or remove the regression before shipping.');
}
