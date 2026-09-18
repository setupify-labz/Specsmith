import fs from 'node:fs/promises';
import { parseSitemap, selectHighestValueUrls, selectIndexNowUrls } from './core';

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[at + 1];
}

function optionalArg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  if (!process.argv[at + 1]) throw new Error(`Missing value for ${name}.`);
  return process.argv[at + 1];
}

async function main() {
  const current = parseSitemap(await fs.readFile(arg('--current'), 'utf8'));
  const previousPath = arg('--previous');
  const previous = await fs.readFile(previousPath, 'utf8').then(parseSitemap).catch(() => []);
  const changedFiles = (await fs.readFile(arg('--changed-files'), 'utf8')).split(/\r?\n/).filter(Boolean);
  const selectAll = process.argv.includes('--all');
  const priorityLimitValue = optionalArg('--priority-limit');
  if (selectAll && priorityLimitValue) throw new Error('--all and --priority-limit are mutually exclusive.');
  const priorityLimit = priorityLimitValue === undefined ? undefined : Number(priorityLimitValue);
  const urls = selectAll
    ? current
    : priorityLimit === undefined
      ? selectIndexNowUrls(current, previous, changedFiles)
      : selectHighestValueUrls(current, priorityLimit);
  await fs.writeFile(arg('--out'), urls.length ? `${urls.join('\n')}\n` : '');
  console.log(`[indexnow] selected ${urls.length}/${current.length} canonical URLs.`);
}

main().catch((error) => {
  console.error(`[indexnow] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
