// Submits every URL in the built sitemap to IndexNow (api.indexnow.org),
// which fans out to every search engine that supports the protocol
// (Bing, Yandex, Seznam, and others — notably not Google, which has its
// own separate submission path via Search Console).
//
// Run this after a build, whenever you want engines notified of new or
// changed pages faster than passive re-crawling would find them:
//   node scripts/submit-indexnow.mjs
//
// Key verification file lives at public/<key>.txt so it's served at
// https://specsmithpc.com/<key>.txt — IndexNow checks that file matches
// the key in the request to confirm domain ownership.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEXNOW_KEY = '3b2b270931b45edfe57324016c9aa24c';
const HOST = 'specsmithpc.com';
const SITE_URL = `https://${HOST}`;

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const sitemapPath = path.join(root, 'dist', 'public', 'sitemap.xml');

const xml = await fs.readFile(sitemapPath, 'utf-8');
const urlList = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

if (urlList.length === 0) {
  throw new Error(`No URLs found in ${sitemapPath} — did you run the build first?`);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
    urlList,
  }),
});

console.log(`[indexnow] submitted ${urlList.length} URLs — status ${res.status} ${res.statusText}`);
if (!res.ok) {
  console.log(await res.text());
  process.exitCode = 1;
}
