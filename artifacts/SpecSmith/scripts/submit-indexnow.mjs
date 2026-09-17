// Submits selected canonical URLs to IndexNow (api.indexnow.org),
// which fans out to every search engine that supports the protocol
// (Bing, Yandex, Seznam, and others — notably not Google, where SpecSmith
// relies on its sitemap plus selective manual requests in Search Console).
//
// The scheduled workflow supplies a bounded list of new or changed URLs. A
// manual all-sitemap submission is available for initial setup, but is not the
// default because repeatedly pinging unchanged pages is noisy and wasteful.
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
const valueAfter = (name) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const sitemapPath = path.resolve(valueAfter('--sitemap') ?? path.join(root, 'dist', 'public', 'sitemap.xml'));
const urlsFile = valueAfter('--urls-file');

const xml = await fs.readFile(sitemapPath, 'utf-8');
const sitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const requestedUrls = urlsFile
  ? (await fs.readFile(path.resolve(urlsFile), 'utf-8')).split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
  : sitemapUrls;
const canonical = new Set(sitemapUrls);
const urlList = [...new Set(requestedUrls)];

if (sitemapUrls.length === 0) {
  throw new Error(`No URLs found in ${sitemapPath} — did you run the build first?`);
}
if (urlList.length === 0) {
  console.log('[indexnow] no new or changed URLs selected; nothing submitted.');
  process.exit(0);
}
if (urlList.length > 10_000) throw new Error(`Refusing ${urlList.length} URLs; IndexNow accepts at most 10,000 per request.`);
for (const value of urlList) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== HOST || !canonical.has(value)) {
    throw new Error(`Refusing URL that is not canonical in the built sitemap: ${value}`);
  }
}

const keyFile = path.join(root, 'public', `${INDEXNOW_KEY}.txt`);
if ((await fs.readFile(keyFile, 'utf8')).trim() !== INDEXNOW_KEY) {
  throw new Error(`IndexNow verification file does not match the configured key: ${keyFile}`);
}

if (process.argv.includes('--dry-run')) {
  console.log(`[indexnow] dry run validated ${urlList.length} canonical URLs; no request sent.`);
  process.exit(0);
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

console.log(`[indexnow] requested crawl notification for ${urlList.length} URLs — status ${res.status} ${res.statusText}`);
if (!res.ok) {
  console.log(await res.text());
  process.exitCode = 1;
}
