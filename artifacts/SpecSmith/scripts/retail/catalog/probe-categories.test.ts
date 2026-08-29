import { describe, expect, it } from 'vitest';

import { countCategories, parseArgs, resolveProbeOutputPath } from './probe-categories';

const xml = `
  <result>
    <item><category><primary>Computers</primary><secondary>Components~~Desktop Memory</secondary></category></item>
    <item><category><primary>Computers</primary><secondary>Components~~Desktop Memory</secondary></category></item>
    <item><category><primary>Computers</primary><secondary>Components~~Laptop Memory</secondary></category></item>
  </result>`;

describe('category discovery report', () => {
  it('contains only category paths and counts', () => {
    expect(countCategories(xml)).toEqual({
      itemsSeen: 3,
      categories: [
        { primary: 'Computers', secondary: 'Components~~Desktop Memory', leaf: 'Desktop Memory', count: 2 },
        { primary: 'Computers', secondary: 'Components~~Laptop Memory', leaf: 'Laptop Memory', count: 1 },
      ],
    });
  });

  it('requires one output path outside the repository', () => {
    expect(() => parseArgs([])).toThrow('argument-invalid');
    expect(() => resolveProbeOutputPath('/workspace/repo/report.json', '/workspace/repo')).toThrow('output-inside-repository');
    expect(resolveProbeOutputPath('/tmp/report.json', '/workspace/repo')).toBe('/tmp/report.json');
  });
});
