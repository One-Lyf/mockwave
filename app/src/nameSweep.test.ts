/**
 * Name sweep (wr-data-plugin-upgrade): every user-facing string says Basewave, never Mockwave.
 * Code identifiers and the repo name stay mockwave (lowercase), so this scans for the brand
 * capitalization "Mockwave" outside comments in all app and engine sources, plus the HTML
 * titles, and pins the rendered brand. Runs under vitest (Node), which can read the files.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SELF = 'nameSweep.test.ts';
const BRAND = ['Mock', 'wave'].join(''); // built so this file's own scan stays clean

function sourceFiles(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, exts, out);
    else if (exts.test(entry)) out.push(p);
  }
  return out;
}

/** Strip block and line comments so only code and string literals remain. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('name sweep: user-facing strings say Basewave, never Mockwave', () => {
  it('no non-comment source line carries the Mockwave brand', () => {
    const files = [
      ...sourceFiles(join(repoRoot, 'app'), /\.(tsx?|html|css)$/),
      ...sourceFiles(join(repoRoot, 'engine'), /\.tsx?$/),
    ].filter((f) => !f.endsWith(SELF));
    const hits: string[] = [];
    for (const file of files) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (line.includes(BRAND)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the HTML titles and the rendered header say Basewave', () => {
    const indexHtml = readFileSync(join(repoRoot, 'app/index.html'), 'utf8');
    expect(indexHtml).toContain('<title>Basewave</title>');
    const appTsx = stripComments(readFileSync(join(repoRoot, 'app/src/App.tsx'), 'utf8'));
    expect(appTsx).toContain('<h1>Basewave</h1>');
  });
});
