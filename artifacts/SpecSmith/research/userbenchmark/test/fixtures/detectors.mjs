// Suspicion detectors for parsed game pages.
//
// These check EXTRACTION, not truth. None of them decides whether a published
// FPS number is correct — nothing local could — and none invents a value. Each
// asks a narrower question the local evidence can actually answer:
//
//     does this extraction look complete and self-consistent?
//
// They exist because the two real defects found in this parser so far (a price
// form that parsed as null, a component id in an unmatched URL shape) were both
// SILENT: output that looked entirely healthy while missing data. A parser that
// fails loudly is recoverable. One that quietly returns 19 of 20 rows is not,
// because nothing downstream can tell.
//
// Deliberately kept in the test layer. Promoting the strongest of these into
// lib/validate.mjs would make the whole pipeline enforce them, but that is a
// validation-policy change and is left as a recommendation rather than done
// unilaterally.
//
// Each detector returns an array of finding strings; empty means clean.

/** Every component row on the page carries a per-component filter link, and
 * those links can be counted straight out of the HTML. Counting them is
 * INDEPENDENT of the row regex, which is the point: a regex cannot report that
 * it failed to match something. A divergence means the table parsed short. */
export function componentRowsMatchLinkedComponents(parsed, html) {
  const findings = [];
  const gameId = parsed.game?.gameId;
  if (!gameId) return ['no game id — cannot cross-check component rows'];

  const countLinked = (pattern) =>
    new Set([...html.matchAll(pattern)].map((m) => m[1]).filter((x) => x !== '0')).size;

  const gpuLinked = countLinked(new RegExp(`FPS-Estimates-[^/"']+/${gameId}/(\\d+)\\.0\\.0\\.0\\.0`, 'g'));
  const cpuLinked = countLinked(new RegExp(`FPS-Estimates-[^/"']+/${gameId}/0\\.(\\d+)\\.0\\.0\\.0`, 'g'));

  if (parsed.gpuTable.length !== gpuLinked) {
    findings.push(`GPU table parsed ${parsed.gpuTable.length} row(s) but the page links ${gpuLinked} GPU component(s)`);
  }
  if (parsed.cpuTable.length !== cpuLinked) {
    findings.push(`CPU table parsed ${parsed.cpuTable.length} row(s) but the page links ${cpuLinked} CPU component(s)`);
  }
  return findings;
}

/** A chart whose labels and data disagree in length is not usable, and the
 * mismatch is a parse failure rather than a data gap: the page renders these
 * as pairs. Measured: an emptied dataset leaves labels intact and produces no
 * parser warning at all. */
export function chartLabelsMatchData(parsed) {
  const findings = [];
  for (const key of ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution']) {
    const c = parsed[key];
    const labels = c?.labels?.length ?? 0;
    const data = c?.data?.length ?? 0;
    if (labels === 0 && data === 0) {
      findings.push(`${key} is absent entirely`);
    } else if (labels !== data) {
      findings.push(`${key} has ${labels} label(s) but ${data} data point(s)`);
    }
  }
  return findings;
}

/** The strongest cross-check available locally.
 *
 * The settings and resolution distributions are SAMPLE COUNTS, not
 * percentages, and each sums exactly to the page's total sample count —
 * verified on all 19 captured pages, exactly, with no rounding slack. That
 * links two independently extracted regions: the header summary and the chart
 * scripts. If either drifts, the sums stop agreeing.
 *
 * The FPS histogram is deliberately NOT checked this way. Its totals bear no
 * fixed relationship to the sample count (16 distinct ratios across 19 pages),
 * so asserting one would be inventing an invariant rather than observing it. */
export function distributionSumsMatchTotalSamples(parsed) {
  const findings = [];
  const total = parsed.sampleSummary?.totalSamples;
  if (total == null) return ['no total sample count — cannot cross-check distributions'];

  for (const key of ['settingsDistribution', 'resolutionDistribution']) {
    const data = parsed[key]?.data ?? [];
    if (data.length === 0) continue; // absence is chartLabelsMatchData's finding, not this one
    const sum = data.reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum !== total) {
      findings.push(`${key} sums to ${sum} but the page reports ${total} total samples`);
    }
  }
  return findings;
}

/** A repeated component name in one table means the row regex matched the same
 * region twice or slipped a row boundary. Real tables list each part once. */
export function noDuplicateComponentNames(parsed) {
  const findings = [];
  for (const table of ['gpuTable', 'cpuTable']) {
    const names = (parsed[table] ?? []).map((r) => r.name);
    const seen = new Set();
    const dupes = new Set();
    for (const n of names) (seen.has(n) ? dupes : seen).add(n);
    if (dupes.size > 0) findings.push(`${table} lists ${[...dupes].join(', ')} more than once`);
  }
  return findings;
}

/** Fields without which an observation cannot be joined or interpreted. Price
 * and value% are excluded on purpose: both are legitimately absent on the page
 * (rendered as "-") and treating that as a defect would be wrong. */
export function everyRowHasJoinableFields(parsed) {
  const findings = [];
  for (const table of ['gpuTable', 'cpuTable']) {
    for (const r of parsed[table] ?? []) {
      if (!r.name) findings.push(`${table}: a row has no component name`);
      else if (r.samples == null) findings.push(`${table}/${r.name}: no sample count`);
      else if (r.benchPercent == null) findings.push(`${table}/${r.name}: no bench percent`);
      else if (!r.componentRatingId) findings.push(`${table}/${r.name}: no component id`);
    }
  }
  return findings;
}

/** Counts how many component rows the PAGE shows a price for, and compares it
 * to how many the parser actually read.
 *
 * This exists because the other detectors provably cannot catch a price
 * regression: a price the parser fails to read is indistinguishable from a
 * price the page genuinely does not list (rendered as "-"), so absence alone
 * proves nothing. Re-introducing the real historical bug — reading only the
 * linked `<a title="Live Amazon price">` form and silently dropping the plain
 * `<td>$120</td>` form — was caught by exactly one hand-written fixture test
 * and by none of the structural detectors. This closes that gap.
 *
 * Independence is the whole point, so the scan deliberately avoids the row
 * regex's anchors. It splits loosely on `<tr`, truncates each chunk at its
 * `</tr>` (without which the document's entire tail counts as one enormous
 * "row"), and identifies component rows by their per-component game-filter
 * link rather than by the `<td style="padding:0;…">` opening cell the parser
 * keys on. A promo block of popular CPUs elsewhere on the page carries bench
 * links and prices but no such filter link, and is correctly excluded.
 *
 * Verified: agrees exactly on all 19 captured pages. */
export function pricedRowCountMatchesHtml(parsed, html) {
  const gameId = parsed.game?.gameId;
  if (!gameId) return ['no game id — cannot cross-check priced rows'];

  const filterLink = new RegExp(
    `FPS-Estimates-[^/"']+/${gameId}/(?:[0-9]+\\.0\\.0\\.0\\.0|0\\.[0-9]+\\.0\\.0\\.0)`,
  );

  let shownInHtml = 0;
  for (const chunk of html.split(/<tr[\s>]/)) {
    const end = chunk.indexOf('</tr>');
    if (end < 0) continue;
    const row = chunk.slice(0, end);
    if (filterLink.test(row) && /\$[\d,.]+/.test(row)) shownInHtml += 1;
  }

  const readByParser = [...(parsed.gpuTable ?? []), ...(parsed.cpuTable ?? [])].filter((r) => r.priceUsd != null).length;

  return readByParser === shownInHtml
    ? []
    : [`the page shows a price on ${shownInHtml} component row(s) but the parser read ${readByParser}`];
}

/** Runs every detector. Returns { detector: findings[] } for non-clean ones. */
export function runAllDetectors(parsed, html) {
  const out = {};
  const add = (name, findings) => {
    if (findings.length > 0) out[name] = findings;
  };
  add('componentRowsMatchLinkedComponents', componentRowsMatchLinkedComponents(parsed, html));
  add('chartLabelsMatchData', chartLabelsMatchData(parsed));
  add('distributionSumsMatchTotalSamples', distributionSumsMatchTotalSamples(parsed));
  add('noDuplicateComponentNames', noDuplicateComponentNames(parsed));
  add('everyRowHasJoinableFields', everyRowHasJoinableFields(parsed));
  add('pricedRowCountMatchesHtml', pricedRowCountMatchesHtml(parsed, html));
  return out;
}
