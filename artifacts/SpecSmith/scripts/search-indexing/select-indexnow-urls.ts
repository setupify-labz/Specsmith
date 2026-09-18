import fs from 'node:fs/promises';
import { parseSitemap, selectIndexNowUrls } from './core';

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[at + 1];
}

async function main() {
  const current = parseSitemap(await fs.readFile(arg('--current'), 'utf8'));
  const previousPath = arg('--previous');
  const previous = await fs.readFile(previousPath, 'utf8').then(parseSitemap).catch(() => []);
  const changedFiles = (await fs.readFile(arg('--changed-files'), 'utf8')).split(/\r?\n/).filter(Boolean);
  const urls = process.argv.includes('--all') ? current : selectIndexNowUrls(current, previous, changedFiles);
  await fs.writeFile(arg('--out'), urls.length ? `${urls.join('\n')}\n` : '');
  console.log(`[indexnow] selected ${urls.length}/${current.length} canonical URLs.`);
}

main().catch((error) => {
  console.error(`[indexnow] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
