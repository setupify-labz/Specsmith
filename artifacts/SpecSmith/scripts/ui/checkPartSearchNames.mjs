#!/usr/bin/env node
// Browser check: on the built site, every part-search box has an accessible name that says what it
// searches, and no two boxes on a page share a name. Reads Chromium's own accessibility tree.
//
//   pnpm build && node scripts/ui/checkPartSearchNames.mjs
//
// Serves dist/public the way the production Cloudflare assets config does (html_handling =
// "drop-trailing-slash": /compare serves compare/index.html), so each page hydrates its own
// prerendered HTML. Set SPECSMITH_RENDER_CHROMIUM to use a specific Chromium binary.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'public');
const PAGES = ['/builder', '/compare', '/upgrade-calculator', '/upgrade-calculator-cpu'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`No build at ${root}; run pnpm build first.`);
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const c of [path.join(root, p), path.join(root, p, 'index.html')]) {
    if (c.startsWith(root) && fs.existsSync(c) && fs.statSync(c).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(c)] ?? 'application/octet-stream' });
      return fs.createReadStream(c).pipe(res);
    }
  }
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(root, '404.html')).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.SPECSMITH_RENDER_CHROMIUM ? { executablePath: process.env.SPECSMITH_RENDER_CHROMIUM } : {});
const failures = [];
try {
  const page = await browser.newPage();
  for (const route of PAGES) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    const boxes = page.locator('[data-part-section] input[type="text"]');
    const count = await boxes.count();
    if (count === 0) { failures.push(`${route}: no open part-search box to check`); continue; }
    const names = [];
    for (let i = 0; i < count; i += 1) {
      const snapshot = await boxes.nth(i).ariaSnapshot();
      names.push(/textbox "([^"]*)"/.exec(snapshot)?.[1] ?? '');
    }
    console.log(`${route}: ${names.map((n) => JSON.stringify(n)).join(', ')}`);
    for (const name of names) if (!/^Search \S/.test(name)) failures.push(`${route}: a search box is announced as ${JSON.stringify(name)}, which does not say what it searches`);
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    if (repeated.length) failures.push(`${route}: search boxes share a name: ${[...new Set(repeated)].join(', ')}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error(`FAIL\n${failures.join('\n')}`); process.exit(1); }
console.log('PASS: every part-search box is named after what it searches, uniquely per page.');
