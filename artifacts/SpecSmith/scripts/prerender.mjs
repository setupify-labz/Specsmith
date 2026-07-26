import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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

function injectHead(html, meta, siteUrl, defaultOgImage, breadcrumbJsonLd) {
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

  return result;
}

// Sitemap is generated from PRERENDER_ROUTES so it can never drift from the
// pages that actually exist. /build is excluded (noindex, unbounded URLs).
function sitemapEntry(routePath) {
  if (routePath === '/build') return null;
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
      return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function main() {
  const template = await fs.readFile(path.join(publicDir, 'index.html'), 'utf-8');

  await buildSsrBundle();

  const entryPath = path.join(ssrOutDir, 'entry-server.js');
  const { render, getRouteMeta, getPrerenderMeta, breadcrumbJsonLd, PRERENDER_ROUTES, SITE_URL, DEFAULT_OG_IMAGE } = await import(`${entryPath}?t=${Date.now()}`);
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
    const html = injectHead(template.replace('<!--app-html-->', appHtml), meta, SITE_URL, DEFAULT_OG_IMAGE, breadcrumbJsonLd);

    const outFile =
      routePath === '/'
        ? path.join(publicDir, 'index.html')
        : path.join(publicDir, routePath.replace(/^\//, ''), 'index.html');

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, html, 'utf-8');
    console.log(`[prerender] Wrote ${path.relative(root, outFile)}`);
  }

  const sitemapFile = path.join(publicDir, 'sitemap.xml');
  await fs.writeFile(sitemapFile, generateSitemap(PRERENDER_ROUTES, SITE_URL), 'utf-8');
  console.log(`[prerender] Wrote ${path.relative(root, sitemapFile)} (${PRERENDER_ROUTES.length - 1} URLs)`);

  await fs.rm(ssrOutDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('[prerender] Failed:', err);
  process.exit(1);
});
