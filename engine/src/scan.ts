/**
 * Mockwave: linear-time lexing helpers shared by the TypeScript and GraphQL importers.
 *
 * Masking comments and string literals with regexes like `\/\*[\s\S]*?\*\/` is
 * quadratic on hostile input: every unterminated `/*`, backtick or quote rescans to
 * the end of the text. `lex` walks the text once, and remembers when a literal kind
 * can no longer close (an unterminated `/*` means no later `/*` closes either), so
 * the whole pass stays linear while matching the regex semantics it replaces.
 */

export interface LexSyntax {
  /** `//` line and `/* *\/` block comments */
  slashComments?: boolean;
  /** `#` line comments (GraphQL) */
  hashComments?: boolean;
  /** `'...'` strings (single line) */
  singleQuotes?: boolean;
  /** `` `...` `` template literals (multi-line) */
  backticks?: boolean;
  /** `"""..."""` block strings (GraphQL) */
  blockStrings?: boolean;
}

export type LexKind = 'string' | 'comment';

/** Line terminators a `\` escape may not consume inside a '/" string (regex `.` semantics). */
const isLineEnd = (c: string) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

/**
 * Report every string literal / comment in `src`, left to right, as [start, end).
 * `"..."` strings are always recognized and end at their line. An unterminated
 * literal is not a literal: its opening character is treated as plain text.
 */
export function lex(src: string, syn: LexSyntax, on: (start: number, end: number, kind: LexKind) => void): void {
  const n = src.length;
  // A quote of this kind starting before these offsets cannot close (see closeQuote)
  let dqStop = -1;
  let sqStop = -1;
  let backtickDead = false;
  let blockDead = false;
  let tripleDead = false;

  /** End of the '/" string at `i`, or -(stop + 1) where it failed. Any same-kind quote
   *  inside (i, stop) was consumed as an escaped char, so it would fail at `stop` too. */
  const closeQuote = (i: number): number => {
    const q = src[i];
    for (let j = i + 1; j < n; j++) {
      const c = src[j];
      if (c === '\\') {
        if (j + 1 >= n || isLineEnd(src[j + 1])) return -(j + 1);
        j++;
        continue;
      }
      if (c === q) return j + 1;
      if (c === '\n') return -(j + 1);
    }
    return -(n + 1);
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || (c === "'" && syn.singleQuotes)) {
      if (c === '"' && syn.blockStrings && !tripleDead && src.startsWith('"""', i)) {
        const k = src.indexOf('"""', i + 3);
        if (k >= 0) { on(i, k + 3, 'string'); i = k + 3; continue; }
        tripleDead = true;
      }
      if (i >= (c === '"' ? dqStop : sqStop)) {
        const r = closeQuote(i);
        if (r > 0) { on(i, r, 'string'); i = r; continue; }
        if (c === '"') dqStop = -r - 1; else sqStop = -r - 1;
      }
      i++;
      continue;
    }
    if (c === '`' && syn.backticks) {
      if (!backtickDead) {
        let j = i + 1;
        for (; j < n; j++) {
          const d = src[j];
          if (d === '\\') { j++; continue; }
          if (d === '`') break;
        }
        if (j < n) { on(i, j + 1, 'string'); i = j + 1; continue; }
        backtickDead = true; // no later backtick closes either
      }
      i++;
      continue;
    }
    if (c === '/' && syn.slashComments) {
      const d = src[i + 1];
      if (d === '*' && !blockDead) {
        const k = src.indexOf('*/', i + 2);
        if (k >= 0) { on(i, k + 2, 'comment'); i = k + 2; continue; }
        blockDead = true;
      } else if (d === '/') {
        const k = src.indexOf('\n', i);
        const e = k < 0 ? n : k;
        on(i, e, 'comment');
        i = e;
        continue;
      }
      i++;
      continue;
    }
    if (c === '#' && syn.hashComments) {
      const k = src.indexOf('\n', i);
      const e = k < 0 ? n : k;
      on(i, e, 'comment');
      i = e;
      continue;
    }
    i++;
  }
}

/** Every non-newline char -> space. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * Rewrite the lexed regions of `src` in one pass (same length, same offsets).
 * `mode` decides per region: 'keep', 'all' (blank it whole), or 'inner' (blank
 * the contents but keep the delimiting quote characters).
 */
export function maskRegions(src: string, syn: LexSyntax, mode: (kind: LexKind) => 'keep' | 'all' | 'inner'): string {
  const out: string[] = [];
  let last = 0;
  lex(src, syn, (start, end, kind) => {
    const m = mode(kind);
    if (m === 'keep') return;
    out.push(src.slice(last, start));
    const text = src.slice(start, end);
    if (m === 'all') out.push(blank(text));
    else {
      // Keep the delimiters: 1 char for '/"/`, 3 for """
      const d = text.startsWith('"""') && text.length >= 6 ? 3 : 1;
      out.push(text.slice(0, d) + blank(text.slice(d, -d)) + text.slice(-d));
    }
    last = end;
  });
  out.push(src.slice(last));
  return out.join('');
}

/**
 * For each opener in `openers` (some of `{([<`), the index of its matching closer in
 * `text` (or -1), from one stack pass. `text` must already have its strings and
 * comments blanked. `=>` is not a closer. A closer that doesn't match the innermost
 * open bracket is ignored.
 */
export function bracketTable(text: string, openers = '{([<'): Int32Array {
  const match = new Int32Array(text.length).fill(-1);
  const stack: number[] = [];
  const closers = openers.split('').map((o) => '})]>'['{([<'.indexOf(o)]).join('');
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === '=' && text[j + 1] === '>') { j++; continue; }
    const o = openers.indexOf(c);
    if (o >= 0) { stack.push(j); continue; }
    const k = closers.indexOf(c);
    if (k >= 0 && stack.length > 0 && text[stack[stack.length - 1]] === openers[k]) match[stack.pop()!] = j;
  }
  return match;
}

/**
 * `next[i]` = the first index >= i whose char is in `chars`, or -1 (length n + 1).
 * Turns "scan forward to the next `{`" into an O(1) lookup, so checking every
 * header in a paste stays linear instead of rescanning to the end per header.
 */
export function nextIndexTable(text: string, chars: string): Int32Array {
  const next = new Int32Array(text.length + 1);
  next[text.length] = -1;
  for (let i = text.length - 1; i >= 0; i--) next[i] = chars.includes(text[i]) ? i : next[i + 1];
  return next;
}

/** `nextIndexTable` lookup that tolerates out-of-range offsets. */
export const nextAt = (table: Int32Array, i: number): number => (i < 0 ? table[0] : i >= table.length ? -1 : table[i]);
