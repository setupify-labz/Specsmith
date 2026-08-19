import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// FIX 3: the collector runs through tsx, but tsx was present only as a
// transitive dependency of another workspace package. A fresh install could
// have left `pnpm collect:measured` failing with "command not found".
describe('collector toolchain is declared, not inherited by accident', () => {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('declares tsx as a direct devDependency of this package', () => {
    expect(pkg.devDependencies.tsx).toBeDefined();
  });

  // The workspace pins shared versions centrally; declaring a literal range
  // here would let this package drift from the rest of the monorepo.
  it('uses the workspace catalog rather than a private version range', () => {
    expect(pkg.devDependencies.tsx).toBe('catalog:');
  });

  it('the collect script actually invokes tsx', () => {
    expect(pkg.scripts['collect:measured']).toContain('tsx');
  });
});
