// Markup mutations for parser-generalization testing.
//
// The corpus is 19 real pages, but they are 19 samples of ONE server template
// captured within days of each other. Measured: every one uses double-quoted
// attributes, the same tag order, and the same class names. So "19 pages" is
// far less parser coverage than it sounds — it is close to one structural
// sample, and a regex tuned to it can look fully exercised while resting on
// incidental formatting.
//
// Real generalization cannot be tested without pages we do not have and cannot
// legitimately fetch. What CAN be tested is the property that actually protects
// the dataset:
//
//     the parser must never silently produce wrong or partial data
//
// Each mutation below perturbs a REAL captured page in a way a server, a
// template change, or a different save route could plausibly produce. None of
// them invents benchmark values: they rearrange or damage existing markup, and
// the assertions are about extraction behaviour, never about a number's truth.
//
// Mutations are split by intent:
//   TOLERANCE — cosmetic; the parser should extract identical data
//   DAMAGE    — destructive; the parser must FAIL LOUDLY, not guess

/** TOLERANCE: attribute quoting. The parser's own comments claim view-source
 * saves carry single-quoted attributes, but no artifact in this repo actually
 * does — including the genuine raw server response for Battlefield 6. So the
 * quote-agnostic handling is defensive and, before this mutation, entirely
 * unexercised for identity extraction. */
export function singleQuoteAttrs(html) {
  return html.replace(/<(\w[\w-]*)\s+([^<>]*?)>/g, (tag, name, attrs) => {
    if (attrs.includes("'")) return tag; // don't create nested-quote nonsense
    return `<${name} ${attrs.replace(/="([^"<>]*)"/g, "='$1'")}>`;
  });
}

/** TOLERANCE: a template that breaks long tags across lines. */
export function newlinesInsideTags(html) {
  return html.replace(/<(link|meta|h1|td|a)\s+/g, '<$1\n    ');
}

/** TOLERANCE: added instrumentation attributes, as a redesign might introduce. */
export function extraAttributes(html) {
  return html
    .replace(/<h1 class="pg-head-title"/g, '<h1 data-qa="title" class="pg-head-title"')
    .replace(/<link rel="canonical"/g, '<link data-seo="1" rel="canonical"');
}

/** TOLERANCE: non-breaking spaces as raw characters rather than entities.
 * Both forms are already known to occur across capture routes. */
export function nbspEntityToRaw(html) {
  return html.replace(/&nbsp;/g, ' ');
}

/** DAMAGE: one component row's opening cell is altered so the row regex skips
 * it, while the row's per-component filter link survives elsewhere on the page.
 * This is the silent-short-table failure — the table still parses, just with
 * fewer rows, and nothing about the output looks wrong on its own. */
export function dropOneComponentRow(html) {
  return html.replace('<td style="padding:0;text-align:left">', '<td style="padding:0; text-align:left">');
}

/** DAMAGE: the average-FPS / sample-count block is removed entirely. */
export function removeSampleSummary(html) {
  return html.replace(/Average Fps:/, 'Average FPS-REMOVED:');
}

/** DEGRADED-BUT-HANDLED: the canonical link is removed, forcing identity to be
 * established by corroborated self-link inference instead.
 *
 * Deliberately NOT classed as damage. Four captured pages genuinely ship
 * without a canonical link, the pipeline handles them by design, and it
 * discloses the weaker evidence in the record rather than hiding it. The
 * property to assert here is that the page still parses AND that the fallback
 * is disclosed — not that something was caught. */
export function removeCanonical(html) {
  return html.replace(/<link rel="canonical"[^>]*>/, '');
}

/** DAMAGE: a chart's dataset is emptied while its labels remain. */
export function emptyOneChartDataset(html) {
  return html.replace(/data\s*:\s*\[[^\]]*\]/, 'data: []');
}

export const TOLERANCE_MUTATIONS = {
  singleQuoteAttrs,
  newlinesInsideTags,
  extraAttributes,
  nbspEntityToRaw,
};

/** DAMAGE: a single value in a distribution chart is altered by one.
 *
 * The subtlest failure modelled here. Output stays structurally perfect — every
 * row present, every chart the right shape, every number plausible — and only
 * the cross-check against the page's own total sample count reveals it. Takes
 * the distribution's parsed values so it can locate that exact array rather
 * than guessing which `data: [...]` belongs to which chart. */
export function skewDistributionValue(html, distributionData) {
  const verbatim = JSON.stringify(distributionData).slice(1, -1);
  const at = html.indexOf(verbatim);
  if (at < 0) throw new Error('could not locate the distribution array in the page source');
  const skewed = verbatim.replace(/^(\d+)/, (_, d) => String(Number(d) + 1));
  return html.slice(0, at) + skewed + html.slice(at + verbatim.length);
}

export const DAMAGE_MUTATIONS = {
  dropOneComponentRow,
  removeSampleSummary,
  emptyOneChartDataset,
};

export const DEGRADED_BUT_HANDLED_MUTATIONS = {
  removeCanonical,
};
