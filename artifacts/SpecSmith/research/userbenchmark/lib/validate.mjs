// Validation rules over normalized dataset records.
//
// RESEARCH-ONLY. Pure functions, no I/O.
//
// Severity model — the distinction the brief calls for:
//
//   ERROR   — the pipeline produced something structurally impossible or
//             self-contradictory. This is a TOOLING failure and should be
//             fixed in code.
//   WARNING — the SOURCE DATA is incomplete, odd, or unresolved. This is an
//             ordinary research finding, NOT a tooling failure, and must not
//             fail the run. (e.g. an undocumented URL field, a missing chart
//             on a page that genuinely doesn't have one.)
//
// A run's exit status keys off ERRORs only.

export const SEVERITY = Object.freeze({ ERROR: 'error', WARNING: 'warning' });

function issue(severity, rule, message, context = {}) {
  return { severity, rule, message, ...context };
}

const GAME_ID_RE = /^\d+$/;
// Plausibility bound. Deliberately generous — this catches parser corruption
// (a sample count read as an FPS, a concatenated number), not "unusual but
// real" hardware results.
const MAX_PLAUSIBLE_FPS = 2000;

export function validateGames(games) {
  const issues = [];
  for (const g of games) {
    const ctx = { gameId: g.gameId, sourceFile: g.provenance?.sourceFile };
    if (!g.gameId || !GAME_ID_RE.test(String(g.gameId))) {
      issues.push(issue(SEVERITY.ERROR, 'game.id-invalid', `Game id "${g.gameId}" is missing or not numeric.`, ctx));
    }
    if (!g.name) issues.push(issue(SEVERITY.ERROR, 'game.name-missing', 'Game has no name.', ctx));
    if (!g.canonicalUrl) issues.push(issue(SEVERITY.ERROR, 'game.url-missing', 'Game has no canonical URL.', ctx));
    if (g.averageFps == null) {
      issues.push(issue(SEVERITY.WARNING, 'game.avg-fps-missing', 'No average FPS on this page.', ctx));
    } else if (!(g.averageFps > 0)) {
      issues.push(issue(SEVERITY.ERROR, 'game.avg-fps-non-positive', `Average FPS is ${g.averageFps}.`, ctx));
    } else if (g.averageFps > MAX_PLAUSIBLE_FPS) {
      issues.push(issue(SEVERITY.ERROR, 'game.avg-fps-implausible', `Average FPS ${g.averageFps} exceeds ${MAX_PLAUSIBLE_FPS}; likely a parse error.`, ctx));
    }
    if (g.totalSamples != null && g.totalSamples < 0) {
      issues.push(issue(SEVERITY.ERROR, 'game.samples-negative', `Total samples is ${g.totalSamples}.`, ctx));
    }
    if (!g.hasFpsHistogram) issues.push(issue(SEVERITY.WARNING, 'game.histogram-missing', 'No usable FPS histogram (absent, or labels/data lengths differ).', ctx));
    if (!g.hasSettingsDistribution) issues.push(issue(SEVERITY.WARNING, 'game.settings-missing', 'No settings distribution on this page.', ctx));
    if (!g.hasResolutionDistribution) issues.push(issue(SEVERITY.WARNING, 'game.resolution-missing', 'No resolution distribution on this page.', ctx));
    if (g.gpuRowCount === 0) issues.push(issue(SEVERITY.WARNING, 'game.gpu-table-empty', 'GPU table produced no rows.', ctx));
    if (g.cpuRowCount === 0) issues.push(issue(SEVERITY.WARNING, 'game.cpu-table-empty', 'CPU table produced no rows.', ctx));
  }
  return issues;
}

export function validateComponentObservations(rows, kind) {
  const issues = [];
  for (const r of rows) {
    const ctx = { gameId: r.gameId, component: r.componentName, sourceFile: r.provenance?.sourceFile };
    if (!r.componentName || !r.componentName.trim()) {
      issues.push(issue(SEVERITY.ERROR, `${kind}.name-missing`, 'Component row has no name.', ctx));
    }
    if (!r.componentPageUrl) {
      issues.push(issue(SEVERITY.WARNING, `${kind}.page-url-missing`, 'No dedicated component page URL on this row.', ctx));
    } else {
      const expected = kind === 'gpu' ? 'gpu.userbenchmark.com' : 'cpu.userbenchmark.com';
      if (!r.componentPageUrl.includes(expected)) {
        issues.push(issue(SEVERITY.ERROR, `${kind}.domain-mismatch`, `Row classified as ${kind} but its page URL is not on ${expected}: ${r.componentPageUrl}`, ctx));
      }
    }
    if (r.samples != null && r.samples < 0) {
      issues.push(issue(SEVERITY.ERROR, `${kind}.samples-negative`, `Sample count is ${r.samples}.`, ctx));
    }
    if (r.samples == null) issues.push(issue(SEVERITY.WARNING, `${kind}.samples-missing`, 'Row has no sample count.', ctx));
    for (const [field, v] of [['benchPercent', r.benchPercent], ['valuePercent', r.valuePercent]]) {
      if (v != null && v < 0) issues.push(issue(SEVERITY.ERROR, `${kind}.${field}-negative`, `${field} is ${v}.`, ctx));
    }
    if (r.unresolvedFilterPositions?.length > 0) {
      issues.push(issue(SEVERITY.WARNING, `${kind}.filter-position-unresolved`, `Filter path uses undocumented position(s): ${JSON.stringify(r.unresolvedFilterPositions)}.`, ctx));
    }
  }
  return issues;
}

export function validateEfpsDirect(records) {
  const issues = [];
  const byUrl = new Map();
  for (const r of records) {
    const ctx = { gameId: r.gameId, title: r.exactTitle, sourceFile: r.provenance?.sourceFile };
    if (r.fps == null) {
      issues.push(issue(SEVERITY.ERROR, 'efps.fps-missing', 'Accepted direct EFPS record has no FPS value.', ctx));
    } else if (!(r.fps > 0)) {
      issues.push(issue(SEVERITY.ERROR, 'efps.fps-non-positive', `FPS is ${r.fps}.`, ctx));
    } else if (r.fps > MAX_PLAUSIBLE_FPS) {
      issues.push(issue(SEVERITY.ERROR, 'efps.fps-implausible', `FPS ${r.fps} exceeds ${MAX_PLAUSIBLE_FPS}.`, ctx));
    }
    if (!r.gpu) issues.push(issue(SEVERITY.WARNING, 'efps.gpu-missing', 'Direct EFPS record has no GPU token.', ctx));
    if (!r.cpu) issues.push(issue(SEVERITY.WARNING, 'efps.cpu-missing', 'Direct EFPS record has no CPU token.', ctx));
    if (r.unresolvedFields?.length > 0) {
      issues.push(issue(SEVERITY.WARNING, 'efps.unresolved-field', `EFPS URL populates the undocumented field 3: ${JSON.stringify(r.unresolvedFields)}.`, ctx));
    }
    if (r.efpsUrl) {
      const prev = byUrl.get(r.efpsUrl);
      if (prev && prev.fps !== r.fps) {
        issues.push(issue(SEVERITY.ERROR, 'efps.same-url-different-fps', `EFPS URL appears twice with different FPS (${prev.fps} vs ${r.fps}).`, ctx));
      }
      byUrl.set(r.efpsUrl, r);
    }
    for (const w of r.warnings ?? []) issues.push(issue(SEVERITY.WARNING, 'efps.record-warning', w, ctx));
  }
  return issues;
}

export function validateEfpsComparisons(records) {
  const issues = [];
  for (const r of records) {
    const ctx = { gameId: r.gameId, title: r.exactTitle, sourceFile: r.provenance?.sourceFile };
    if (!Array.isArray(r.sides) || r.sides.length !== 2) {
      issues.push(issue(SEVERITY.ERROR, 'efps-cmp.side-count', `Comparison has ${r.sides?.length ?? 0} sides, expected 2.`, ctx));
      continue;
    }
    for (const s of r.sides) {
      if (s.fps == null || !(s.fps > 0)) {
        issues.push(issue(SEVERITY.ERROR, 'efps-cmp.side-fps-invalid', `Side "${s.label}" has FPS ${s.fps}.`, ctx));
      } else if (s.fps > MAX_PLAUSIBLE_FPS) {
        issues.push(issue(SEVERITY.ERROR, 'efps-cmp.side-fps-implausible', `Side "${s.label}" FPS ${s.fps} exceeds ${MAX_PLAUSIBLE_FPS}.`, ctx));
      }
      if (!s.label) issues.push(issue(SEVERITY.WARNING, 'efps-cmp.side-label-missing', 'Comparison side has no label.', ctx));
      if (!s.variantResolvedByTokenMatch) {
        issues.push(issue(SEVERITY.WARNING, 'efps-cmp.variant-unresolved', `Side "${s.label}" could not be matched to a URL variant group by token.`, ctx));
      }
    }
    if (r.sides[0]?.resolvedVariant && r.sides[0].resolvedVariant === r.sides[1]?.resolvedVariant) {
      issues.push(issue(SEVERITY.ERROR, 'efps-cmp.same-variant-both-sides', 'Both comparison sides resolved to the same URL variant group.', ctx));
    }
    for (const w of r.warnings ?? []) issues.push(issue(SEVERITY.WARNING, 'efps-cmp.record-warning', w, ctx));
  }
  return issues;
}

/** Cross-check: a comparison side describing the same (game, GPU, CPU) as a
 * direct record must carry the same FPS. A mismatch means the title/value
 * pairing or the variant resolution is wrong — a genuine tooling ERROR. */
export function crossValidateEfps(direct, comparisons) {
  const issues = [];
  const byConfig = new Map();
  for (const d of direct) byConfig.set([d.gameId, d.gpu, d.cpu].join('|'), d);
  let checked = 0;
  let agreed = 0;
  for (const c of comparisons) {
    for (const s of c.sides ?? []) {
      const key = [c.gameId, s.gpu, s.cpu].join('|');
      const d = byConfig.get(key);
      if (!d) continue;
      checked++;
      if (d.fps === s.fps) agreed++;
      else {
        issues.push(
          issue(SEVERITY.ERROR, 'efps.cross-check-mismatch', `Comparison side "${s.label}" reports ${s.fps} FPS but the direct record for the same (GPU=${s.gpu}, CPU=${s.cpu}) reports ${d.fps}.`, {
            gameId: c.gameId,
            title: c.exactTitle,
          }),
        );
      }
    }
  }
  return { issues, stats: { checked, agreed, mismatched: checked - agreed } };
}

export function validateDistributions(dists) {
  const issues = [];
  for (const d of dists) {
    const ctx = { gameId: d.gameId, distribution: d.distribution, sourceFile: d.provenance?.sourceFile };
    if (d.labelCount === 0 && d.dataCount === 0) {
      issues.push(issue(SEVERITY.WARNING, 'dist.empty', `Distribution "${d.distribution}" is empty on this page.`, ctx));
      continue;
    }
    if (!d.lengthsMatch) {
      issues.push(issue(SEVERITY.ERROR, 'dist.length-mismatch', `Distribution "${d.distribution}" has ${d.labelCount} labels but ${d.dataCount} data points.`, ctx));
    }
    for (const v of d.data ?? []) {
      if (typeof v === 'number' && v < 0) {
        issues.push(issue(SEVERITY.ERROR, 'dist.negative-value', `Distribution "${d.distribution}" contains a negative value (${v}).`, ctx));
      }
    }
  }
  return issues;
}

export function validateConfigurations(configs) {
  const issues = [];
  for (const c of configs) {
    const ctx = { gameId: c.gameId, rawFilterPath: c.rawFilterPath, sourceFile: c.provenance?.sourceFile };
    if (!Array.isArray(c.positions) || c.positions.length !== 5) {
      issues.push(issue(SEVERITY.ERROR, 'config.arity', `Filter path "${c.rawFilterPath}" has ${c.positions?.length ?? 0} positions, expected 5.`, ctx));
    }
    if (c.unresolvedPositions?.length > 0) {
      issues.push(issue(SEVERITY.WARNING, 'config.unresolved-position', `Filter path populates undocumented position(s) ${c.unresolvedPositions.map((p) => p.index).join(',')} — meaning not proven, value preserved raw.`, ctx));
    }
  }
  return issues;
}

/** Source-level checks that don't belong to any single record. */
export function validateSources(parsedPages, duplicateSourcePages) {
  const issues = [];
  for (const p of parsedPages) {
    if (!p._meta.parsedSuccessfully) {
      issues.push(issue(SEVERITY.WARNING, 'source.not-a-game-page', `"${p._meta.sourceFile}" is not an FPS-Estimates game page (detected: ${p._meta.sourceKind?.kind}) — skipped.`, { sourceFile: p._meta.sourceFile }));
      continue;
    }
    if (p._meta.sourceKind && p._meta.sourceKind.confident === false) {
      issues.push(issue(SEVERITY.WARNING, 'source.low-confidence', `"${p._meta.sourceFile}" matched a game page only weakly: ${p._meta.sourceKind.note}`, { sourceFile: p._meta.sourceFile }));
    }
    if ((p.unclassifiedTableRows?.length ?? 0) > 0) {
      issues.push(issue(SEVERITY.WARNING, 'source.unclassified-rows', `${p.unclassifiedTableRows.length} table row(s) in "${p._meta.sourceFile}" could not be classified as GPU or CPU.`, { sourceFile: p._meta.sourceFile }));
    }
  }
  for (const d of duplicateSourcePages) {
    issues.push(issue(SEVERITY.WARNING, 'source.duplicate-game', `Game ${d.gameId} is covered by more than one saved source: ${d.files.join(', ')}.`, { gameId: d.gameId }));
  }
  return issues;
}

export function summarize(issues) {
  const byRule = new Map();
  for (const i of issues) {
    const k = `${i.severity}:${i.rule}`;
    byRule.set(k, (byRule.get(k) ?? 0) + 1);
  }
  return {
    total: issues.length,
    errors: issues.filter((i) => i.severity === SEVERITY.ERROR).length,
    warnings: issues.filter((i) => i.severity === SEVERITY.WARNING).length,
    byRule: Object.fromEntries([...byRule.entries()].sort((a, b) => b[1] - a[1])),
  };
}
