import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRICES_UPDATED } from '../src/lib/prices.ts';

// ISO date (YYYY-MM-DD) for every page's <lastmod> — deliberately the last
// real pricing-data refresh date, not "whenever this build happened to
// run". A lastmod that changes on every deploy regardless of whether
// content actually changed trains crawlers to distrust the signal; tying
// it to PRICES_UPDATED means it only moves when something real changed.
const SITEMAP_LASTMOD = new Date(PRICES_UPDATED).toISOString().slice(0, 10);

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const publicDir = path.join(root, 'dist', 'public');
const ssrOutDir = path.join(root, 'dist', 'server');

async function buildSsrBundle() {
  await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    build: {
      ssr: path.join(root, 'src', 'entry-server.tsx'),
      outDir: ssrOutDir,
      emptyOutDir: true,
      ssrEmitAssets: false,
      minify: false,
      rollupOptions: {
        output: { format: 'es' },
      },
    },
  });
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function injectHead(html, meta, siteUrl, defaultOgImage, breadcrumbJsonLd, siteJsonLdGraph) {
  const url = meta.canonicalOverride ?? `${siteUrl}${meta.path === '/' ? '/' : meta.path}`;
  const image = meta.image ?? defaultOgImage;
  const title = escapeAttr(meta.title);
  const description = escapeAttr(meta.description);

  let result = html
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta name="description" content=".*?" \/>/s, `<meta name="description" content="${description}" />`)
    .replace(/<link rel="canonical" href=".*?" \/>/s, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:title" content=".*?" \/>/s, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content=".*?" \/>/s, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content=".*?" \/>/s, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:image" content=".*?" \/>/s, `<meta property="og:image" content="${image}" />`)
    .replace(/<meta name="twitter:title" content=".*?" \/>/s, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content=".*?" \/>/s, `<meta name="twitter:description" content="${description}" />`)
    .replace(/<meta name="twitter:image" content=".*?" \/>/s, `<meta name="twitter:image" content="${image}" />`);

  if (meta.noindex) {
    result = result.replace(
      '</title>',
      '</title>\n    <meta name="robots" content="noindex, follow" />',
    );
  }

  const breadcrumb = breadcrumbJsonLd(meta);
  if (breadcrumb) {
    result = result.replace(
      '</head>',
      `    <script type="application/ld+json" id="breadcrumb-jsonld">${JSON.stringify(breadcrumb)}</script>\n  </head>`,
    );
  }

  if (meta.path === '/') {
    result = result.replace(
      '</head>',
      `    <script type="application/ld+json" id="site-jsonld">${JSON.stringify(siteJsonLdGraph())}</script>\n  </head>`,
    );
  }

  return result;
}

// Sitemap is generated from PRERENDER_ROUTES so it can never drift from the
// pages that actually exist. /build is excluded (noindex, unbounded URLs).
function sitemapEntry(routePath) {
  if (routePath === '/build') return null;
  if (routePath === '/404') return null;
  if (routePath === '/') return { changefreq: 'weekly', priority: '1.0' };
  if (routePath === '/builder') return { changefreq: 'weekly', priority: '0.9' };
  if (routePath === '/prebuilts') return { changefreq: 'weekly', priority: '0.8' };
  if (routePath.startsWith('/prebuilts/')) return { changefreq: 'weekly', priority: '0.7' };
  if (routePath === '/compare' || routePath === '/vs') return { changefreq: 'monthly', priority: '0.7' };
  if (routePath.startsWith('/vs/')) return { changefreq: 'monthly', priority: '0.6' };
  return { changefreq: 'monthly', priority: '0.5' };
}

function generateSitemap(routes, siteUrl) {
  const urls = routes
    .map((routePath) => {
      const entry = sitemapEntry(routePath);
      if (!entry) return null;
      const loc = routePath === '/' ? `${siteUrl}/` : `${siteUrl}${routePath}`;
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${SITEMAP_LASTMOD}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// The whole site is prerendered to static HTML, so the only thing standing
// between "bytes on the wire" and first paint is the render-blocking
// stylesheet <link> Vite's build emits — a full extra network round trip
// (DNS/TCP/TLS already paid for the HTML request, but the browser still
// can't discover and fetch the CSS until it parses into <head>, then can't
// paint until that response lands) that on throttled mobile alone accounted
// for a large chunk of a 4+ second FCP/LCP even though TBT and CLS were
// already perfect. Inlining the CSS directly into every prerendered page
// removes that round trip entirely, at the cost of the (small, ~19KB
// gzipped) stylesheet no longer being a separately cacheable resource
// across page loads — a clear win for this site's traffic pattern (cold
// single-page landings from search), since SPA navigation after the first
// load never re-fetches CSS anyway.
async function inlineStylesheet(template) {
  const match = template.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
  if (!match) return template;
  const [linkTag, href] = match;
  const cssPath = path.join(publicDir, href.replace(/^\//, ''));
  const css = await fs.readFile(cssPath, 'utf-8');
  return template.replace(linkTag, `<style>${css}</style>`);
}

async function main() {
  let template = await fs.readFile(path.join(publicDir, 'index.html'), 'utf-8');
  template = await inlineStylesheet(template);

  await buildSsrBundle();

  const entryPath = path.join(ssrOutDir, 'entry-server.js');
  const { render, getRouteMeta, getPrerenderMeta, breadcrumbJsonLd, siteJsonLdGraph, PRERENDER_ROUTES, SITE_URL, DEFAULT_OG_IMAGE } = await import(`${entryPath}?t=${Date.now()}`);
  const resolveMeta = getPrerenderMeta ?? getRouteMeta;

  for (const routePath of PRERENDER_ROUTES) {
    let appHtml;
    try {
      appHtml = render(routePath);
    } catch (err) {
      console.error(`[prerender] Failed to render "${routePath}":`, err);
      continue;
    }

    const meta = resolveMeta(routePath);
    const html = injectHead(template.replace('<!--app-html-->', appHtml), meta, SITE_URL, DEFAULT_OG_IMAGE, breadcrumbJsonLd, siteJsonLdGraph);

    // 404.html is written flat (not nested in a /404/ folder) because that's
    // the exact filename Cloudflare's not_found_handling: "404-page" looks
    // for at the assets root when a request matches no real file.
    const outFile =
      routePath === '/'
        ? path.join(publicDir, 'index.html')
        : routePath === '/404'
        ? path.join(publicDir, '404.html')
        : path.join(publicDir, routePath.replace(/^\//, ''), 'index.html');

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, html, 'utf-8');
    console.log(`[prerender] Wrote ${path.relative(root, outFile)}`);
  }

  const sitemapFile = path.join(publicDir, 'sitemap.xml');
  const sitemapUrlCount = PRERENDER_ROUTES.filter((r) => sitemapEntry(r) !== null).length;
  await fs.writeFile(sitemapFile, generateSitemap(PRERENDER_ROUTES, SITE_URL), 'utf-8');
  console.log(`[prerender] Wrote ${path.relative(root, sitemapFile)} (${sitemapUrlCount} URLs)`);

  await fs.rm(ssrOutDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('[prerender] Failed:', err);
  process.exit(1);
});
