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

function injectHead(html, meta) {
  const url = meta.canonicalOverride ?? `https://frameforge.app${meta.path === '/' ? '/' : meta.path}`;
  const image = meta.image ?? 'https://frameforge.app/opengraph.jpg';
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

  return result;
}

async function main() {
  const template = await fs.readFile(path.join(publicDir, 'index.html'), 'utf-8');

  await buildSsrBundle();

  const entryPath = path.join(ssrOutDir, 'entry-server.js');
  const { render, getRouteMeta, PRERENDER_ROUTES } = await import(`${entryPath}?t=${Date.now()}`);

  for (const routePath of PRERENDER_ROUTES) {
    let appHtml;
    try {
      appHtml = render(routePath);
    } catch (err) {
      console.error(`[prerender] Failed to render "${routePath}":`, err);
      continue;
    }

    const meta = getRouteMeta(routePath);
    const html = injectHead(template.replace('<!--app-html-->', appHtml), meta);

    const outFile =
      routePath === '/'
        ? path.join(publicDir, 'index.html')
        : path.join(publicDir, routePath.replace(/^\//, ''), 'index.html');

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, html, 'utf-8');
    console.log(`[prerender] Wrote ${path.relative(root, outFile)}`);
  }

  await fs.rm(ssrOutDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('[prerender] Failed:', err);
  process.exit(1);
});
