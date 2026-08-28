import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { childNameCounts, KNOWN_ELEMENT_NAMES, describeField, main, renderShape } from './probe-response-shape';
import { parseProductSearchXml } from '../rakuten';
import { ACCESS_TOKEN_ENV_VAR } from '../rakuten/types';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rakuten', '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

const TOKEN = 'test-token-not-a-real-credential';
const env = { [ACCESS_TOKEN_ENV_VAR]: TOKEN } as NodeJS.ProcessEnv;

/** Runs the CLI end to end and returns EVERYTHING it emitted, both streams. */
async function runProbe(argv: string[], body: string): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const code = await main(argv, {
    env,
    log: (l) => lines.push(l),
    error: (l) => lines.push(l),
    fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch,
  });
  return { code, output: lines.join('\n') };
}

describe('the complete probe CLI output is closed-shape data only', () => {
  it('leaks nothing from a response full of product data, URLs and identifiers', async () => {
    const source = fixture('newegg-rtx5070-live-shape.xml');
    // Sanity: the fixture really does carry everything that must not appear.
    for (const present of ['click.linksynergy.com', 'N82E16814500545', '619.99', 'ZOTAC', '810012077712']) {
      expect(source).toContain(present);
    }

    // The WHOLE CLI, not just the renderer: endpoint line, keyword line,
    // shape block, every stream.
    const { code, output } = await runProbe(['--gpu', 'rtx5070'], source);
    expect(code).toBe(0);

    for (const forbidden of [
      TOKEN,
      'linksynergy',
      'N82E168',
      '619.99',
      'ZOTAC',
      'neweggimages',
      'REDACTED_SITE_ID',
      'offerid',
      '810012077712',
      'GDDR7',
    ]) {
      expect(output, `must not print ${forbidden}`).not.toContain(forbidden);
    }
    // No URL of any kind, and no query string.
    expect(output).not.toMatch(/https?:\/\//);
    expect(output).not.toContain('?');

    // It does print the schema, which is the entire point.
    expect(output).toContain('item element names');
    expect(output).toContain('productname');
  });

  it('reports an unrecognised element name as a count, never as text', async () => {
    // An element name is chosen by the far end; nothing stops one being built
    // out of data. Known names echo, unknown ones tally.
    const hostile =
      '<result><TotalMatches>0</TotalMatches><leaked-secret-abc123>x</leaked-secret-abc123><another_weird_tag/></result>';
    const { output } = await runProbe(['--gpu', 'rtx4090'], hostile);

    expect(output).not.toContain('leaked-secret-abc123');
    expect(output).not.toContain('another_weird_tag');
    expect(output).toContain('<unrecognised> x2');
    // ...and the shape is refused, because unknown children disqualify it.
    expect(output).toContain('unexpected-result-child');
  });

  it('prints no URL at all, not even the endpoint constant', async () => {
    // One endpoint, which the operator already knows. Printing it buys nothing
    // and costs the simplest possible rule: this tool's output has no URLs.
    const { output } = await runProbe(['--gpu', 'rtx4090'], fixture('newegg-empty-result-no-paging.xml'));
    expect(output).not.toMatch(/https?:\/\//);
    expect(output).not.toContain('linksynergy');
    expect(output).not.toContain('mid=');
    expect(output).toContain('keyword          NVIDIA GeForce RTX 4090 graphics card');
  });

  it('reports a CLI error as one clean line and exits 1', async () => {
    const { code, output } = await runProbe(['--gpu', 'rtx9999'], '<result/>');
    expect(code).toBe(1);
    expect(output).toBe('No catalog GPU with id "rtx9999".');
    expect(output).not.toContain('at ');
  });
});

describe('the probe names the shape without admitting it', () => {
  it('names the variant a body matches, and what is admitted today', async () => {
    for (const [name, variant] of [
      ['newegg-empty-result-all-zero.xml', 'all-paging-fields-zero'],
      ['newegg-empty-result-no-paging.xml', 'paging-omitted'],
    ] as const) {
      const { output } = await runProbe(['--gpu', 'rtx4090'], fixture(name));
      expect(output).toContain(`empty-shape      MATCHES variant: ${variant}`);
      // The probe recognises every variant so it can report what it sees; the
      // admitted line is what says which of them the walker will act on.
      expect(output).toContain('admitted now     all-paging-fields-zero');
    }
  });

  it('distinguishes the admitted fingerprint from a near miss', async () => {
    const nearMiss = '<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>1</PageNumber></result>';
    const { output } = await runProbe(['--gpu', 'rtx4090'], nearMiss);
    expect(output).toContain('empty-shape      MATCHES variant: partial-paging-zero');
    expect(output).toContain('admitted now     all-paging-fields-zero');
  });

  it('says a result-bearing page is subject to the strict rules', () => {
    expect(renderShape(fixture('newegg-rtx4070-page1.xml'), { gpuId: 'rtx4070', httpStatus: 200 })).toContain(
      'empty-shape      no (has-items)',
    );
  });

  it('names the reason a near-miss shape was refused', () => {
    expect(renderShape('<result><Errors><e>x</e></Errors></result>', { gpuId: 'x', httpStatus: 200 })).toContain(
      'no (unexpected-result-child)',
    );
  });
});

describe('field and name reporting', () => {
  it('reports paging fields as absent, integer, or unreadable — never quoting an unreadable value', () => {
    expect(describeField({ raw: null, value: null })).toBe('absent');
    expect(describeField({ raw: '0', value: 0 })).toBe('integer 0');
    // The one case where the text could be anything the far end sent.
    expect(describeField({ raw: 'secret-ish garbage', value: null })).toBe('present but not an integer (18 chars)');
    expect(describeField({ raw: 'secret-ish garbage', value: null })).not.toContain('secret');
  });

  it('counts known child element names and tallies the rest', () => {
    const root = parseProductSearchXml('<result><item/><item/><PageNumber/><mystery/></result>');
    expect(childNameCounts(root.children[0])).toEqual(['item x2', 'PageNumber', '<unrecognised> x1']);
  });

  it('the whitelist is the Product Search vocabulary the adapter parses', () => {
    for (const name of ['result', 'totalpages', 'item', 'productname', 'upccode', 'linkurl', 'saleprice']) {
      expect(KNOWN_ELEMENT_NAMES.has(name)).toBe(true);
    }
    expect(KNOWN_ELEMENT_NAMES.has('errors')).toBe(false);
  });
});
