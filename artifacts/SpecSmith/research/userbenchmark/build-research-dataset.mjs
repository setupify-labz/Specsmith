// Research-only consolidation of locally parsed UserBenchmark game-page data.
// No network access. No production files are read or written.
//
// Inputs:
//   research/userbenchmark/parsed/*.json          (existing page parser)
//   research/userbenchmark/efps/parsed/*.json    (EFPS extractor)
//
// Outputs:
//   research/userbenchmark/dataset/records.jsonl
//   research/userbenchmark/dataset/coverage.json
//   research/userbenchmark/dataset/validation-report.md

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const parsedDir = path.join(root, 'parsed');
const efpsDir = path.join(root, 'efps', 'parsed');
const outDir = path.join(root, 'dataset');

async function readJsonFiles(dir) {
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && n !== 'index.json');
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      rows.push({ name, data: JSON.parse(await fs.readFile(file, 'utf8')) });
    } catch (error) {
      rows.push({ name, error: error.message });
    }
  }
  return rows;
}

function keyForGame(game) {
  return game?.gameId ? `id:${game.gameId}` : `slug:${game?.slug || 'unknown'}`;
}

function validateEfps(records) {
  const warnings = [];
  const ids = new Set();
  const duplicates = [];
  for (const record of records) {
    if (!record.url || !/^https:\/\/www\.userbenchmark\.com\/EFps\//i.test(record.url)) {
      warnings.push(`EFPS record has unexpected URL: ${record.url || '(missing)'}`);
    }
    if (!Number.isFinite(record.fps)) warnings.push(`EFPS record has non-numeric FPS: ${JSON.stringify(record)}`);
    const key = `${record.url}|${record.title}|${record.fps}`;
    if (ids.has(key)) duplicates.push(key);
    ids.add(key);
  }
  return { warnings, duplicates };
}

async function main() {
  const [pages, efps] = await Promise.all([readJsonFiles(parsedDir), readJsonFiles(efpsDir)]);
  const games = new Map();
  const errors = [];

  for (const entry of pages) {
    if (entry.error) {
      errors.push(`${entry.name}: ${entry.error}`);
      continue;
    }
    const game = entry.data?.game;
    if (!game) {
      errors.push(`${entry.name}: missing game identity`);
      continue;
    }
    const key = keyForGame(game);
    games.set(key, { game, page: entry.data, efps: null });
  }

  for (const entry of efps) {
    if (entry.error) {
      errors.push(`${entry.name}: ${entry.error}`);
      continue;
    }
    const game = entry.data?.game;
    const key = keyForGame(game);
    const target = games.get(key);
    if (target) target.efps = entry.data;
    else games.set(key, { game, page: null, efps: entry.data });
  }

  const records = [];
  let efpsRows = 0;
  let duplicateEfps = 0;
  const gameSummaries = [];
  for (const { game, page, efps: efpsData } of games.values()) {
    const efpsRecords = efpsData?.records ?? [];
    const efpsValidation = validateEfps(efpsRecords);
    efpsRows += efpsRecords.length;
    duplicateEfps += efpsValidation.duplicates.length;
    records.push({
      game,
      aggregate: page?.sampleSummary ?? null,
      fpsHistogram: page?.fpsHistogram ?? null,
      settingsDistribution: page?.settingsDistribution ?? null,
      resolutionDistribution: page?.resolutionDistribution ?? null,
      gpuTable: page?.gpuTable ?? [],
      cpuTable: page?.cpuTable ?? [],
      brandFilterUrls: page?.brandFilterUrls ?? [],
      relatedGamePages: page?.relatedGamePages?.games ?? [],
      efps: efpsRecords,
      warnings: [
        ...(page?._meta?.warnings ?? []),
        ...(efpsData?._meta?.warnings ?? []),
        ...efpsValidation.warnings,
      ],
      sources: {
        pageSourceFile: page?._meta?.sourceFile ?? null,
        efpsSourceFile: efpsData?._meta?.sourceFile ?? null,
      },
    });
    gameSummaries.push({
      gameId: game?.gameId ?? null,
      name: game?.name ?? null,
      pageParsed: Boolean(page),
      efpsParsed: Boolean(efpsData),
      efpsCount: efpsRecords.length,
      pageWarnings: page?._meta?.warnings?.length ?? 0,
      efpsWarnings: efpsData?._meta?.warnings?.length ?? 0,
    });
  }

  records.sort((a, b) => String(a.game?.name ?? '').localeCompare(String(b.game?.name ?? '')));
  const validationErrors = errors.length + duplicateEfps;

  await fs.mkdir(outDir, { recursive: true });
  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await fs.writeFile(path.join(outDir, 'records.jsonl'), jsonl);
  await fs.writeFile(path.join(outDir, 'coverage.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    games: records.length,
    pageSourceFiles: pages.length,
    efpsSourceFiles: efps.length,
    efpsRows,
    duplicateEfps,
    fileErrors: errors,
    gameSummaries,
  }, null, 2) + '\n');

  const report = [
    '# UserBenchmark research-dataset validation report',
    '',
    `- Parsed game records: **${records.length}**`,
    `- Page JSON inputs: **${pages.length}**`,
    `- EFPS JSON inputs: **${efps.length}**`,
    `- EFPS rows: **${efpsRows}**`,
    `- Duplicate EFPS rows: **${duplicateEfps}**`,
    `- File errors: **${errors.length}**`,
    '',
    '## Policy',
    '',
    '- This dataset is research-only and is built entirely from locally saved page sources.',
    '- Explicit EFPS `p` values are retained as source values; they are never reconstructed from Bench %, Value %, histograms, or sample counts.',
    '- EFPS URL/configuration segments are retained verbatim until their semantics are independently validated.',
    '- No record is written to production benchmark data by this command.',
    '',
    '## Warnings / errors',
    '',
    ...(errors.length ? errors.map((e) => `- ${e}`) : ['- None.']),
    '',
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'validation-report.md'), report);

  console.log(JSON.stringify({
    output: outDir,
    games: records.length,
    efpsRows,
    duplicateEfps,
    fileErrors: errors.length,
    validationErrors,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
