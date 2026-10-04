/**
 * Mockwave: one-pass literal and comment scanner.
 *
 * Replaces the masking regexes, which went quadratic on adversarial pastes (many
 * unterminated `/*` or `"""`, each rescanning to the end). This walks the text once:
 * a closer that is not found is remembered, so later openers of the same kind are
 * skipped without searching again. Matches the old regexes' behavior: an unterminated
 * comment or string is left as plain text, and a `"` / `'` string ends at a newline.
 *
 * Why the memo is safe: if a string opened at `i` finds no closer before its limit, every
 * same-quote character after `i` (up to that limit) was consumed as an escaped `\q`, and
 * the scan state just past it is the same as starting fresh there. So a later opener of
 * that quote, before the same limit, cannot find a closer either.
 */

export interface Syntax {
  /** `"""block strings"""` (GraphQL) */
  triple?: boolean;
  /** `'single-quoted'` strings (TypeScript); `"double"` strings are always on */
  single?: boolean;
  /** `` `template` `` literals (TypeScript) */
  template?: boolean;
  /** `# line` comments (GraphQL) */
  hash?: boolean;
  /** `// line` and `/* block *\/` comments (TypeScript) */
  slash?: boolean;
}

export type LiteralKind = 'string' | 'comment';

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * Blank the literals of kinds in `kinds` to same-length whitespace (newlines kept), so
 * offsets still index `src`. Literals of other kinds are skipped but kept, so a `//`
 * inside a kept string is not mistaken for a comment. With `keepQuotes`, a blanked
 * string keeps its quote characters (only the contents become spaces).
 */
export function blankLiterals(src: string, syntax: Syntax, kinds: ReadonlySet<LiteralKind>, keepQuotes = false): string {
  const out: string[] = [];
  let from = 0; // start of the not-yet-copied text
  const n = src.length;
  // A closer already known to be missing past this index (-1 = unknown)
  let noTriple = -1;
  let noBlock = -1;
  let noTemplate = -1;
  // Per quote: no closer for an opener before this index (the line end a failed scan reached)
  const noLine: Record<string, number> = { '"': -1, "'": -1 };

  const emit = (start: number, end: number, kind: LiteralKind, quote = 0) => {
    if (!kinds.has(kind)) return;
    if (quote && keepQuotes) {
      out.push(src.slice(from, start + quote), blank(src.slice(start + quote, end - quote)));
      from = end - quote;
    } else {
      out.push(src.slice(from, start), blank(src.slice(start, end)));
      from = end;
    }
  };

  /** End of a `q`-quoted string starting at `i` (stops at a newline), or -1. */
  const lineString = (i: number, q: string): number => {
    if (i < noLine[q]) return -1;
    let j = i + 1;
    for (; j < n; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === q) return j + 1;
      if (c === '\n') break;
    }
    noLine[q] = j;
    return -1;
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    if (syntax.triple && c === '"' && src.startsWith('"""', i) && noTriple < 0) {
      const close = src.indexOf('"""', i + 3);
      if (close >= 0) { emit(i, close + 3, 'string', 3); i = close + 3; continue; }
      noTriple = i;
    }
    if (c === '"' || (syntax.single && c === "'")) {
      const end = lineString(i, c);
      if (end >= 0) { emit(i, end, 'string', 1); i = end; continue; }
      i++;
      continue;
    }
    if (syntax.template && c === '`' && noTemplate < 0) {
      let j = i + 1;
      for (; j < n; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '`') break;
      }
      if (j < n) { emit(i, j + 1, 'string', 1); i = j + 1; continue; }
      noTemplate = i;
      i++;
      continue;
    }
    if (syntax.hash && c === '#') {
      const nl = src.indexOf('\n', i);
      const end = nl < 0 ? n : nl;
      emit(i, end, 'comment');
      i = end;
      continue;
    }
    if (syntax.slash && c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl < 0 ? n : nl;
      emit(i, end, 'comment');
      i = end;
      continue;
    }
    if (syntax.slash && c === '/' && src[i + 1] === '*' && noBlock < 0) {
      const close = src.indexOf('*/', i + 2);
      if (close >= 0) { emit(i, close + 2, 'comment'); i = close + 2; continue; }
      noBlock = i;
    }
    i++;
  }
  out.push(src.slice(from));
  return out.join('');
}

/**
 * For each index, the index of the next character in `chars` at or after it (or
 * `src.length`). Lets header checks ("is the next `{`, `}`, `=` or `;` a `{`?") run in
 * linear time instead of rescanning the rest of the text per header.
 */
export function nextOf(src: string, chars: string): Int32Array {
  const next = new Int32Array(src.length + 1);
  next[src.length] = src.length;
  for (let i = src.length - 1; i >= 0; i--) next[i] = chars.includes(src[i]) ? i : next[i + 1];
  return next;
}
