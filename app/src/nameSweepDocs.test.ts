/**
 * Name sweep, docs half (wr-data-plugin-upgrade): the brand "Mockwave" must not appear in the
 * docs, package metadata or build config either. Package names (@mockwave/engine), the repo path
 * and CSS/storage identifiers stay lowercase and are not matched.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = ['Mock', 'wave'].join('');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|html|json|ts)$/.test(e)) out.push(p);
  }
  return out;
}

describe('name sweep: docs and metadata', () => {
  it('the old brand is absent from docs, root docs, package.json files or vite.config', () => {
    const files = [
      ...walk(join(root, 'docs')),
      join(root, 'README.md'),
      join(root, 'SCOPING-MEMO-mockwave.md'),
      join(root, 'package.json'),
      join(root, 'engine/package.json'),
      join(root, 'vite.config.ts'),
    ];
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes(BRAND));
    expect(hits).toEqual([]);
  });
});
