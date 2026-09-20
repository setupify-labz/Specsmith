import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname;
const read = (name: string) => fs.readFileSync(path.join(here, name), 'utf8');

describe('search indexing authority boundary', () => {
  it('never calls Google\'s restricted Indexing API', () => {
    const source = `${read('audit.ts')}\n${read('clients.ts')}`;
    expect(source).not.toContain('indexing.googleapis.com');
    expect(source).not.toContain('urlNotifications');
  });

  it('keeps the provider audit read-only', () => {
    const source = `${read('audit.ts')}\n${read('clients.ts')}`;
    expect(source).not.toContain('SubmitUrl');
    expect(source).not.toContain('SubmitFeed');
    expect(source).not.toContain('Request indexing');
  });
});
