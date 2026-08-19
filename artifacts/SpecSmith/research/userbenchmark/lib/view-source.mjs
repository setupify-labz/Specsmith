// Recovers the original page source from a browser's rendered "view-source" save.
//
// WHY THIS EXISTS
// ---------------
// §5b of efps/configuration-analysis.md establishes that a live-DOM save
// ("Save Page As") loses the EFPS block: by the time the DOM is serialized,
// select2 has re-seeded the compare widget with Counter-Strike's dataset, so
// the saved file carries CSGO's 200 records under the wrong game's name. Only
// a RAW SOURCE capture preserves the page's own EFPS records.
//
// The obvious way to get raw source in a browser is Ctrl+U then Ctrl+S. That
// does not save the source — it saves the browser's RENDERING of the source:
// a line-numbered table where the original markup is HTML-escaped and wrapped
// in syntax-highlighting spans.
//
//   <td class="line-number" value="4"></td>
//   <td class="line-content">	<span class="html-tag">&lt;link …&gt;</span></td>
//
// That file is not a game page and parses as nothing. But the original bytes
// are entirely present, just escaped — so this recovers them rather than
// asking for a different capture method that browsers do not really offer.
//
// This is a PRE-PARSE UNWRAPPER, not a parser variant. It reconstructs the
// source and hands it to the same canonical parser every other capture route
// goes through. There is still exactly one game-page parser.

/** True when `html` is a browser's rendered view-source page rather than a
 * saved web page. Keyed on the line-content cell structure, which is what the
 * recovery actually depends on — not on the filename or the saved-from URL
 * comment, which a normal save also carries. */
export function isViewSourceWrapper(html) {
  return /<td class="line-content">/.test(html);
}

/** Single-pass entity decode.
 *
 * Must be single-pass. The original source's own entities appear here
 * double-escaped (`&nbsp;` in the page becomes `&amp;nbsp;` in the wrapper),
 * so decoding `&amp;` in a separate pass from the others would turn that back
 * into a live `&nbsp;` and silently alter the recovered bytes. One pass over
 * the string decodes exactly one level, which is what restores the original. */
function decodeEntitiesOnce(s) {
  return s.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#\d+|#[xX][0-9a-fA-F]+);/g, (m) => {
    switch (m) {
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&amp;': return '&';
      case '&quot;': return '"';
      case '&apos;': return "'";
      case '&nbsp;': return ' ';
      default: {
        const body = m.slice(2, -1);
        const code = body[0] === 'x' || body[0] === 'X' ? parseInt(body.slice(1), 16) : parseInt(body, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
    }
  });
}

/** Reconstructs the original source from a rendered view-source page.
 *
 * Returns { html, lines } on success. Throws if the wrapper holds no line
 * cells — better to fail loudly than to hand the parser an empty string that
 * would be reported as "not a game page". */
export function unwrapViewSource(html) {
  const cells = [...html.matchAll(/<td class="line-content">([\s\S]*?)<\/td>/g)];
  if (cells.length === 0) throw new Error('view-source wrapper contained no line-content cells');

  const lines = cells.map((m) =>
    // The highlight spans are presentation the browser added; the escaped text
    // between them is the source. Tags are dropped BEFORE decoding so that a
    // decoded `<` can never be mistaken for markup to strip.
    decodeEntitiesOnce(m[1].replace(/<[^>]*>/g, '')),
  );
  return { html: lines.join('\n'), lines: lines.length };
}

/** Unwraps if wrapped, otherwise returns the input untouched. The single entry
 * point call sites use, so no reader has to know which capture route produced
 * a given file. */
export function unwrapIfViewSource(html) {
  return isViewSourceWrapper(html) ? unwrapViewSource(html).html : html;
}
