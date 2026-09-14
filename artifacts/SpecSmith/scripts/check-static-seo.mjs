import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'public');
const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const errors = [];
const titles = new Map();
const descriptions = new Map();

function record(index, value, pathname) {
  const paths = index.get(value) ?? [];
  paths.push(pathname);
  index.set(value, paths);
}

for (const url of urls) {
  const { pathname } = new URL(url);
  const file = pathname === '/'
    ? path.join(dist, 'index.html')
    : path.join(dist, pathname.replace(/^\//, ''), 'index.html');

  if (!fs.existsSync(file)) {
    errors.push(`${pathname}: missing prerendered HTML`);
    continue;
  }

  const html = fs.readFileSync(file, 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;

  if (!title) errors.push(`${pathname}: missing title`);
  else record(titles, title, pathname);
  if (!description) errors.push(`${pathname}: missing meta description`);
  else record(descriptions, description, pathname);
  if (canonical !== url) errors.push(`${pathname}: canonical must be ${url}`);
  if (h1Count !== 1) errors.push(`${pathname}: expected one h1, found ${h1Count}`);
  if (/name="robots"[^>]*content="[^"]*noindex/i.test(html)) {
    errors.push(`${pathname}: sitemap page is marked noindex`);
  }
}

for (const [title, paths] of titles) {
  if (paths.length > 1) errors.push(`duplicate title "${title}": ${paths.join(', ')}`);
}
for (const [description, paths] of descriptions) {
  if (paths.length > 1) errors.push(`duplicate description "${description}": ${paths.join(', ')}`);
}

if (errors.length > 0) {
  throw new Error(`Static SEO validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}

console.log(`[seo] ${urls.length} indexed routes have unique titles and descriptions, exact canonicals, and one h1`);
