/**
 * Name sweep (wr-data-plugin-upgrade): every user-facing string says Basewave, never Mockwave.
 * Code identifiers and the repo name stay mockwave (lowercase), so this scans for the brand
 * capitalization "Mockwave" outside comments in all app and engine sources, plus the HTML
 * titles, and pins the rendered brand. Runs under vitest (Node), which can read the files.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
 * Comment stripping for html and css only, where there is no TypeScript scanner to ask. A character
 * scan: `//` or `/*` inside a quoted string is kept, a real comment is dropped, and a `//` right
 * after a `:` is a URL scheme (https://, url(...)), not a comment. It does not understand JSX text
 * or regex literals, so it is never used on .ts or .tsx (see stripTsComments). `open` reports a scan
 * that ended inside a string, which means the strip is not to be trusted for that file.
 */
function stripLooseComments(text: string): { text: string; open: boolean } {
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
  return { text: out, open: modes.length > 1 };
}

/**
 * Comment stripping for .ts and .tsx, done by the TypeScript compiler itself so JSX text apostrophes
 * (`<h3>Today's Meals</h3>`), regex literals (`/'/`), templates and `//` inside strings are all read
 * the way the language reads them. The file is parsed, every token is visited, and the trivia in front
 * of each token is scanned with ts.createScanner (JSX variant for .tsx) to find the real comments.
 * JSX text is skipped: a `//` there is text, not a comment. Comments are blanked (newlines kept), so
 * line numbers still match the file. `open` is true when the parse reports any error, which is how an
 * unterminated string, template, regex or comment shows up.
 */
function stripTsComments(text: string, tsx: boolean): { text: string; open: boolean } {
  const sf = ts.createSourceFile(tsx ? 'x.tsx' : 'x.ts', text, ts.ScriptTarget.Latest, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, tsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  const ranges: Array<[number, number]> = [];
  let open = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.length > 0;
  const trivia = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText) return;
    const start = node.getStart(sf, false);
    scanner.setTextPos(node.pos);
    for (;;) {
      const kind = scanner.scan();
      if (scanner.getTokenPos() >= start || kind === ts.SyntaxKind.EndOfFileToken) break;
      if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        ranges.push([scanner.getTokenPos(), scanner.getTextPos()]);
        if (scanner.isUnterminated()) open = true;
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return; // inside a comment already
    const kids = node.getChildren(sf);
    if (kids.length === 0) trivia(node);
    else kids.forEach(visit);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) {
    if (from < at) continue;
    out += text.slice(at, from) + text.slice(from, to).replace(/[^\n]/g, ' ');
    at = to;
  }
  return { text: out + text.slice(at), open };
}

/** Strip comments from one file's text by kind: the compiler for .ts/.tsx, the loose scan for html/css. */
function strip(text: string, file: string): { text: string; open: boolean } {
  if (/\.tsx$/.test(file)) return stripTsComments(text, true);
  if (/\.ts$/.test(file)) return stripTsComments(text, false);
  return stripLooseComments(text);
}

/** Back-compat for the fixtures: the stripped text only. */
function stripComments(text: string, file = 'fixture.ts'): string {
  return strip(text, file).text;
}

/** The sweep's per-line brand check over one source text, shared by the repo scan and the fixtures. */
function brandHits(text: string, file = 'fixture.ts'): string[] {
  return stripComments(text, file).split('\n').filter((line) => line.includes(BRAND));
}

describe('name sweep: user-facing strings say Basewave, never Mockwave', () => {
  it('no non-comment source line carries the Mockwave brand', () => {
    const files = [
      ...sourceFiles(join(repoRoot, 'app'), /\.(tsx?|html|css)$/),
      ...sourceFiles(join(repoRoot, 'engine'), /\.tsx?$/),
    ].filter((f) => !f.endsWith(SELF));
    const hits: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'), file);
      stripped.split('\n').forEach((line, i) => {
        if (line.includes(BRAND)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the HTML titles and the rendered header say Basewave', () => {
    const indexHtml = readFileSync(join(repoRoot, 'app/index.html'), 'utf8');
    expect(indexHtml).toContain('<title>Basewave</title>');
    const appTsx = stripComments(readFileSync(join(repoRoot, 'app/src/App.tsx'), 'utf8'), 'App.tsx');
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
    const stripped = stripComments(src, 'fixture.css');
    expect(stripped).toContain('url(https://example.com/x.png)');
    expect(brandHits(src, 'fixture.css')).toHaveLength(0);
  });
});

describe('stripComments reads TypeScript the way the compiler does (mockwave#25 KJ repros)', () => {
  it('a JSX text apostrophe does not open a string: a brand in a later string literal is still caught', () => {
    const src = `export const A = () => (\n  <div>\n    <h3>Today's Meals</h3>\n    <p>{'a//${BRAND}'}</p>\n  </div>\n);\n`;
    expect(brandHits(src, 'fixture.tsx')).toHaveLength(1);
  });

  it('a regex literal containing a quote does not open a string', () => {
    const src = `const re = /'/;\nconst s = 'a//${BRAND}';\n`;
    expect(brandHits(src, 'fixture.ts')).toHaveLength(1);
  });

  it('a real comment after JSX text with an apostrophe is stripped (no false positive)', () => {
    const src = `export const A = () => <h3>Today's Meals</h3>;\n// ${BRAND} legacy note\n`;
    expect(brandHits(src, 'fixture.tsx')).toHaveLength(0);
  });

  it('JSX text that looks like a comment is text, so a brand there is a hit', () => {
    expect(brandHits(`const A = () => <p>// ${BRAND}</p>;\n`, 'fixture.tsx')).toHaveLength(1);
  });

  it('a JSX comment expression and a template with ${} are handled', () => {
    expect(brandHits(`const A = () => <p>{/* ${BRAND} */}x</p>;\n`, 'fixture.tsx')).toHaveLength(0);
    expect(brandHits('const t = `a ${1 + 2} // ' + BRAND + '`;\n'.replace('BRAND', JSON.stringify(BRAND)), 'fixture.ts')).toHaveLength(1);
  });

  it('keeps line numbers: a multi-line block comment is blanked, not collapsed', () => {
    const out = stripComments(`/*\n${BRAND}\n*/\nconst x = '${BRAND}';\n`);
    expect(out.split('\n').findIndex((l) => l.includes(BRAND))).toBe(3);
  });

  it('every real .ts/.tsx source parses cleanly, and every html/css scan ends outside a string', () => {
    const files = [
      ...sourceFiles(join(repoRoot, 'app'), /\.(tsx?|html|css)$/),
      ...sourceFiles(join(repoRoot, 'engine'), /\.tsx?$/),
    ];
    expect(files.length).toBeGreaterThan(30);
    const open = files.filter((f) => strip(readFileSync(f, 'utf8'), f).open);
    expect(open).toEqual([]);
  });
});
