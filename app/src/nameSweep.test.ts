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

/**
 * Strip block and line comments so only code and string literals remain. A character scan,
 * not regexes: `//` or `/*` inside a string/template literal is kept (a brand in 'a//Mockwave'
 * must stay visible), while a real comment is dropped. A `//` right after a `:` is a URL
 * scheme (https://, url(...)), not a comment.
 */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  // Mode stack: 'code' at the bottom; string/template modes push on entry, pop on the closing
  // quote. Template `${ ... }` pushes a 'code' mode whose braces are tracked to pop back.
  const modes: Array<'code' | 'sq' | 'dq' | 'tpl'> = ['code'];
  const tplBraces: number[] = [];
  while (i < n) {
    const c = text[i];
    const next = i + 1 < n ? text[i + 1] : '';
    const mode = modes[modes.length - 1];
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      const quote = mode === 'sq' ? "'" : mode === 'dq' ? '"' : '`';
      out += c;
      if (c === '\\' && i + 1 < n) { out += text[i + 1]; i += 2; continue; }
      i++;
      if (c === quote) modes.pop();
      else if (mode === 'tpl' && c === '$' && next === '{') { out += next; i++; modes.push('code'); tplBraces.push(1); }
      continue;
    }
    // code mode
    if (c === "'") { modes.push('sq'); out += c; i++; continue; }
    if (c === '"') { modes.push('dq'); out += c; i++; continue; }
    if (c === '`') { modes.push('tpl'); out += c; i++; continue; }
    if (c === '/' && next === '/' && text[i - 1] !== ':') {
      while (i < n && text[i] !== '\n') i++; // drop the comment, keep the newline
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && i + 1 < n && text[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (c === '{' && tplBraces.length) { tplBraces[tplBraces.length - 1]++; out += c; i++; continue; }
    if (c === '}' && tplBraces.length) {
      tplBraces[tplBraces.length - 1]--;
      out += c;
      i++;
      if (tplBraces[tplBraces.length - 1] === 0) { tplBraces.pop(); modes.pop(); } // back to the template
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The sweep's per-line brand check over one source text, shared by the repo scan and the fixtures. */
function brandHits(text: string): string[] {
  return stripComments(text).split('\n').filter((line) => line.includes(BRAND));
}

describe('name sweep: user-facing strings say Basewave, never Mockwave', () => {
  it('no non-comment source line carries the Mockwave brand', () => {
    const files = [
      ...sourceFiles(join(repoRoot, 'app'), /\.(tsx?|html|css)$/),
      ...sourceFiles(join(repoRoot, 'engine'), /\.tsx?$/),
    ].filter((f) => !f.endsWith(SELF));
    const hits: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      stripped.split('\n').forEach((line, i) => {
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

describe('stripComments removes only real comments', () => {
  it('still catches the old brand in plain code', () => {
    expect(brandHits(`const brand = '${BRAND}';`)).toHaveLength(1);
  });

  it('catches the brand after // inside a string literal (fixture: a string ending in a slash pair)', () => {
    // A '//' inside a quoted string is not a line comment; stripping it hid the brand.
    expect(brandHits(`const s = 'a//${BRAND}';`)).toHaveLength(1);
    expect(brandHits(`const s = "a//${BRAND}";`)).toHaveLength(1);
    expect(brandHits(`const s = \`a//${BRAND}\`;`)).toHaveLength(1);
  });

  it('catches the brand inside a string that looks like a block comment', () => {
    expect(brandHits(`const s = '/* ${BRAND} */';`)).toHaveLength(1);
  });

  it('still strips a real line comment carrying the brand', () => {
    expect(brandHits(`const x = 1; // ${BRAND} in a comment`)).toHaveLength(0);
  });

  it('still strips a real block comment carrying the brand', () => {
    expect(brandHits(`/* ${BRAND} */\nconst x = 1;`)).toHaveLength(0);
  });

  it('keeps URLs: https:// in a string does not eat the rest of the line', () => {
    const out = brandHits(`const u = 'https://example.com/a'; const b = '${BRAND}';`);
    expect(out).toHaveLength(1); // the brand after the URL is still checked
    expect(stripComments(`const u = 'https://example.com/a';`)).toContain('https://example.com/a');
  });

  it('keeps an unquoted URL (css url / html attr) and still strips the comment after it', () => {
    const src = `background: url(https://example.com/x.png); // ${BRAND} hidden`;
    const stripped = stripComments(src);
    expect(stripped).toContain('url(https://example.com/x.png)');
    expect(brandHits(src)).toHaveLength(0);
  });
});
