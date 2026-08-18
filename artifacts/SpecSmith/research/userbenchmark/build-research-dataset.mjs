// SUPERSEDED — do not run. Use `node research/userbenchmark/ingest.mjs`.
//
// This script consolidated parsed/*.json and efps/parsed/*.json into
// dataset/records.jsonl + dataset/coverage.json + dataset/validation-report.md.
// That job is now done by ingest.mjs, which additionally handles
// normalization with provenance, deterministic deduplication, conflict
// detection, validation severity, and per-game coverage.
//
// This file is kept as an explicit stub rather than deleted for one concrete
// reason: it wrote `dataset/coverage.json` and `dataset/validation-report.md`,
// which are the SAME paths ingest.mjs writes, using a different schema.
// Leaving it runnable meant whichever ran last silently overwrote the other's
// output with an incompatible shape — a real corruption path, not a
// theoretical one. Exiting loudly is safer than producing conflicting files.
//
// If you need something the old consolidator did that ingest.mjs does not,
// add it to ingest.mjs rather than reviving a second writer for the same
// output directory.

console.error(
  [
    'build-research-dataset.mjs is superseded and does nothing.',
    '',
    'Use the corpus pipeline instead:',
    '    node research/userbenchmark/ingest.mjs',
    '',
    'It writes the same dataset/ directory (plus efps.jsonl, efps-comparisons.jsonl,',
    'cpu/gpu-observations.jsonl, configurations.jsonl, distributions.jsonl,',
    'conflicts.jsonl, duplicates.jsonl, rejected-records.jsonl) with provenance,',
    'deduplication and validation. See research/userbenchmark/README.md.',
  ].join('\n'),
);
process.exitCode = 1;
