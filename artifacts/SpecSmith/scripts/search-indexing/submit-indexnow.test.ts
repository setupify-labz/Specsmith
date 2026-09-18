import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];
const script = path.resolve(import.meta.dirname, '..', 'submit-indexnow.mjs');

function fixture(sitemapUrls: string[], selectedUrls: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-indexnow-'));
  temporary.push(dir);
  const sitemap = path.join(dir, 'sitemap.xml');
  const selected = path.join(dir, 'urls.txt');
  fs.writeFileSync(sitemap, `<urlset>${sitemapUrls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`);
  fs.writeFileSync(selected, selectedUrls.join('\n'));
  return { sitemap, selected };
}

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('IndexNow submission boundary', () => {
  it('validates canonical selected URLs without making a request', () => {
    const { sitemap, selected } = fixture(
      ['https://specsmithpc.com/', 'https://specsmithpc.com/builder'],
      ['https://specsmithpc.com/builder'],
    );
    const output = execFileSync(process.execPath, [script, '--sitemap', sitemap, '--urls-file', selected, '--dry-run'], { encoding: 'utf8' });
    expect(output).toContain('validated 1 canonical URLs');
  });

  it('does nothing when no URL is selected', () => {
    const { sitemap, selected } = fixture(['https://specsmithpc.com/'], []);
    const output = execFileSync(process.execPath, [script, '--sitemap', sitemap, '--urls-file', selected], { encoding: 'utf8' });
    expect(output).toContain('nothing submitted');
  });

  it('refuses an off-site URL even when it appears in the supplied sitemap', () => {
    const { sitemap, selected } = fixture(['https://example.com/'], ['https://example.com/']);
    expect(() => execFileSync(process.execPath, [script, '--sitemap', sitemap, '--urls-file', selected, '--dry-run'], { stdio: 'pipe' }))
      .toThrow();
  });
});
