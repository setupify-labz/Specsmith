// Prints the STRUCTURE of a live Product Search response, and nothing else.
//
//   RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/coverage/probe-response-shape.ts --gpu rtx4090
//
// WHY THIS EXISTS
// ---------------
// A 57-GPU sweep failed 39 GPUs on `paging` with no HTTP errors, which says a
// no-match keyword returns something the walker will not accept — but not
// WHICH something. Guessing between "TotalPages is 0" and "the paging fields
// are absent" would mean writing a fixture for a shape nobody has seen, and a
// fixture that is a guess is worse than no fixture: it makes the guess look
// verified.
//
// So this reports the skeleton: element names, how many of each, and for the
// paging fields whether the value is a readable integer. It never prints a
// product name, a SKU, a URL, an image, a price, or the token — of the item
// subtree it prints CHILD ELEMENT NAMES ONLY, never their text. A test asserts
// the renderer produces none of those from a fixture that contains all of them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_EMPTY_RESULT_VARIANTS,
  classifyEmptyResult,
  OBSERVED_EMPTY_RESULT_VARIANTS,
  fetchProductSearchXml,
  findItems,
  loadGpuCatalog,
  parseProductSearchXml,
  readAccessToken,
  readPageInfo,
  type XmlElement,
} from '../rakuten';
import { keywordForGpu } from '../rakuten';
import { oneLineError } from './measure-coverage';

/** How a paging field presents itself, without quoting an unreadable value. */
export function describeField(field: { raw: string | null; value: number | null }): string {
  if (field.raw === null) return 'absent';
  if (field.value !== null) return `integer ${field.value}`;
  // Length only. An unreadable value is exactly the case where the text could
  // be anything the far end chose to send.
  return `present but not an integer (${field.raw.length} chars)`;
}

/**
 * Element names this probe is willing to REPEAT back to the terminal.
 *
 * An element name is chosen by the far end. It is normally schema, but nothing
 * stops a feed — or something injected into one — from carrying a name built
 * out of data. So names are matched against this list and anything unlisted is
 * reported as a COUNT ONLY, never printed. The vocabulary below is the
 * Product Search response as the adapter parses it.
 */
export const KNOWN_ELEMENT_NAMES: ReadonlySet<string> = new Set(
  [
    'result',
    'TotalMatches',
    'TotalPages',
    'PageNumber',
    'item',
    'mid',
    'merchantname',
    'linkid',
    'createdon',
    'sku',
    'productname',
    'category',
    'primary',
    'secondary',
    'price',
    'saleprice',
    'upccode',
    'description',
    'short',
    'long',
    'keywords',
    'linkurl',
    'imageurl',
  ].map((n) => n.toLowerCase()),
);

/**
 * Direct child element names with counts, whitelisted.
 *
 * Known names are printed as themselves; everything else is collapsed into a
 * single "unrecognised" tally. That tally is the signal — it says a shape
 * changed — without the probe becoming a channel for arbitrary text.
 */
export function childNameCounts(el: XmlElement): string[] {
  const known = new Map<string, number>();
  let unrecognised = 0;
  for (const c of el.children) {
    if (KNOWN_ELEMENT_NAMES.has(c.name.toLowerCase())) known.set(c.name, (known.get(c.name) ?? 0) + 1);
    else unrecognised += 1;
  }
  const out = [...known.entries()].map(([name, n]) => (n === 1 ? name : `${name} x${n}`));
  if (unrecognised > 0) out.push(`<unrecognised> x${unrecognised}`);
  return out;
}

/**
 * Renders the skeleton. Pure, so the redaction guarantee is testable.
 */
export function renderShape(xml: string, context: { gpuId: string; httpStatus: number }): string {
  const root = parseProductSearchXml(xml);
  const info = readPageInfo(root);
  const items = findItems(root);
  // Asked against ALL variants, not the observed list: the probe's job is to
  // report which shape the feed sends, which it could not do if it only
  // recognised the shapes already admitted.
  const empty = classifyEmptyResult(root, info, ALL_EMPTY_RESULT_VARIANTS);
  const resultEl = root.children.find((c) => c.name.toLowerCase() === 'result') ?? root;

  const lines = [
    `GPU              ${context.gpuId}`,
    `HTTP status      ${context.httpStatus}`,
    `body bytes       ${Buffer.byteLength(xml, 'utf-8')}`,
    `root children    ${childNameCounts(root).join(', ') || '(none)'}`,
    `result children  ${childNameCounts(resultEl).join(', ') || '(none)'}`,
    '',
    `TotalMatches     ${describeField(info.totalMatches)}`,
    `TotalPages       ${describeField(info.totalPages)}`,
    `PageNumber       ${describeField(info.pageNumber)}`,
    `<item> count     ${items.length}`,
    '',
    `empty-shape      ${empty.empty ? `MATCHES variant: ${empty.variant}` : `no (${empty.reason}${empty.variant ? `, would be: ${empty.variant}` : ''})`}`,
    `admitted now     ${OBSERVED_EMPTY_RESULT_VARIANTS.length === 0 ? 'none — no variant observed yet' : OBSERVED_EMPTY_RESULT_VARIANTS.join(', ')}`,
  ];

  if (items.length > 0) {
    // Names only. This is the schema of a listing, never its contents.
    lines.push('', `item element names  ${childNameCounts(items[0]).join(', ')}`);
  }
  return lines.join('\n');
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** Everything the CLI touches outside itself, injected so the WHOLE output is testable. */
export interface ProbeIo {
  log?: (line: string) => void;
  error?: (line: string) => void;
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}

async function run(argv: string[], io: ProbeIo): Promise<void> {
  const log = io.log ?? ((l: string) => console.log(l));
  const gpuId = flag(argv, 'gpu');
  if (!gpuId) throw new Error('Usage: probe-response-shape.ts --gpu <catalogId>');

  readAccessToken(io.env);
  const gpu = loadGpuCatalog().find((g) => g.id === gpuId);
  if (!gpu) throw new Error(`No catalog GPU with id ${JSON.stringify(gpuId)}.`);

  const keyword = keywordForGpu(gpu);
  // No URL is printed at all — not even the endpoint constant. There is one
  // endpoint and the operator knows it, so printing it buys nothing and costs
  // the simplest possible rule for this tool's output: it contains no URLs.
  // The keyword comes from the local catalog, never from the response.
  log(`keyword          ${keyword}`);

  const { xml } = await fetchProductSearchXml({ keyword, max: 100, pageNumber: 1 }, io);
  log(renderShape(xml, { gpuId, httpStatus: 200 }));
}

export async function main(argv: string[], io: ProbeIo = {}): Promise<number> {
  const error = io.error ?? ((l: string) => console.error(l));
  try {
    await run(argv, io);
    return 0;
  } catch (cause) {
    error(oneLineError(cause));
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
