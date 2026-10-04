/**
 * Mockwave: GraphQL SDL import (deterministic, no AI).
 *
 * Reads `type` / `interface` / `input` definitions (plus `enum`, `union`, `scalar`
 * and `extend`) and maps the first object type to a mock configuration:
 * - Built-in scalars: String, ID (uuid), Int (integer), Float, Boolean
 * - Lists: [T], [[T!]!]!
 * - `!` marks a field required; anything else is optional
 * - Enums pick one of their values; custom scalars map by name (Date/Time -> date)
 * - References to other types in the same SDL become nested objects, with a cap
 *   for cycles (a type may re-enter its own path once) and for overall size. Types
 *   expand breadth-first, so the size budget is spent on the shallow levels first
 *   and one deep first field can't starve its siblings.
 *
 * Offsets stay aligned with the pasted source: comments and strings are blanked to
 * same-length whitespace before parsing, so spans index the original text.
 */

import type { MockDefinition, MockPrimitiveDefinition, MockPropertyDefinition } from './types';
import type { SchemaImport, ValueSpan } from './codeImport';
import { blankLiterals, nextOf, type LiteralKind } from './scan';

/** Keys never written into a config map (would hit Object.prototype's setter). */
const UNSAFE_KEY = '__proto__';
/** Max object nesting below the root type. */
const MAX_DEPTH = 4;
/** A type may appear at most this many times on one path (2 = one level of self-reference). */
const MAX_REPEAT = 2;
/** Total fields expanded per import, so wide, highly connected schemas stay small. */
const FIELD_BUDGET = 2000;
/** List wrappers kept per field (`[[[T]]]`); the generator stops nesting at 10 anyway. */
const MAX_LIST_NESTING = 8;

const BUILTIN_SCALARS: Record<string, MockPrimitiveDefinition> = {
  String: { type: 'string' },
  ID: { type: 'string', format: 'uuid' },
  Int: { type: 'number', integer: true },
  Float: { type: 'number', integer: false },
  Boolean: { type: 'boolean' },
};

/** Blank Markdown code-fence lines to spaces (same length). */
function blankFences(src: string): string {
  return src.replace(/^[ \t]*(?:```|~~~)[^\n`]*$/gm, (m) => ' '.repeat(m.length));
}

const ALL_LITERALS: ReadonlySet<LiteralKind> = new Set(['string', 'comment']);

/** Blank GraphQL comments and string / block-string literals (descriptions, directive
 *  arguments) to spaces, keeping newlines, so offsets match the source. */
function maskGraphQL(src: string): string {
  return blankLiterals(src, { triple: true, hash: true }, ALL_LITERALS);
}

/** Like maskGraphQL, but also blanks TypeScript strings/templates/comments: used for
 *  detection, where the input may be either language. */
function maskForDetection(src: string): string {
  return blankLiterals(src, { triple: true, single: true, template: true, hash: true, slash: true }, ALL_LITERALS);
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/**
 * Does this paste look like GraphQL SDL rather than TypeScript?
 *
 * GraphQL never uses `;`, `?:`, `=>`, angle brackets, `extends`, `export`/`const`, or
 * `type X = {`, so any of those means TypeScript. Otherwise SDL-only syntax (`input`,
 * `scalar`, `union X =`, `extend type`, `implements`, `schema {`, `directive @`, `"""`,
 * a bare `type X {` with no `=`) or more GraphQL field signals (`!` suffixes, `[T]` lists,
 * capitalized built-in scalars, field arguments) than TypeScript ones (lowercase
 * primitives, `T[]`) means GraphQL.
 */
export function looksLikeGraphQL(code: string): boolean {
  const raw = blankFences(code ?? '');
  const text = maskForDetection(raw);
  // Every pattern below is linear: none may scan past a line end per match, and
  // multi-line lookups ("the next `{`") read precomputed next-character tables.
  const nextBrace = nextOf(text, '{');
  const nextStop = nextOf(text, '{}=;');
  const nextBraceOrClose = nextOf(text, '{}');
  const nextParen = nextOf(text, ')');
  const headers = (re: RegExp) => [...text.matchAll(re)].map((m) => m.index! + m[0].length);

  // An object definition to mock is required: a header whose next `{}=;` is a `{`
  const objectHeaders = headers(/^[ \t]*(?:extend[ \t]+)?(?:type|interface|input)[ \t]+[A-Za-z_]\w*/gm);
  if (!objectHeaders.some((h) => text[nextStop[h]] === '{')) return false;

  const tsHard =
    /[;<>]|\?\s*:|=>|\bextends\b|\breadonly\s+\w/.test(text) ||
    /^[ \t]*(?:export|declare|const|let|var|import|abstract|class|function)\b/m.test(text) ||
    /\btype\s+\w+\s*=\s*\{/.test(text);
  if (tsHard) return false;

  const strong =
    /^[ \t]*"""/m.test(raw) ||
    /^[ \t]*(?:schema\s*\{|scalar[ \t]+[A-Za-z_]|directive[ \t]+@|extend[ \t]+(?:type|interface|input|enum|union|schema)\b|union[ \t]+[A-Za-z_][^=\n]*=)/m.test(text) ||
    headers(/^[ \t]*input[ \t]+[A-Za-z_]\w*/gm).some((h) => text[nextBraceOrClose[h]] === '{') ||
    /^[ \t]*(?:type|interface)[ \t]+[A-Za-z_]\w*[ \t]+implements\b/m.test(text);
  if (strong) return true;

  // `type X {` / `type X @dir(...) {` (no `=`) is not valid TypeScript
  const bareTypes = headers(/^[ \t]*type[ \t]+[A-Za-z_]\w*\s*/gm).filter((h) => text[h] === '{' || (text[h] === '@' && nextBrace[h] < text.length)).length;
  // Field arguments: `name(args):` (several headers can share one `)`, so each is checked once)
  const colonAfter = new Map<number, boolean>();
  const argFields = headers(/^[ \t]*\w+\s*\(/gm).filter((h) => {
    const close = nextParen[h];
    if (close >= text.length) return false;
    if (!colonAfter.has(close)) colonAfter.set(close, /\s*:/y.exec(text.slice(close + 1)) !== null);
    return colonAfter.get(close)!;
  }).length;
  const gql =
    bareTypes +
    count(text, /[\w\]][ \t]*!/g) +
    count(text, /:\s*\[/g) +
    count(text, /:\s*\[*\s*(?:String|Int|Float|Boolean|ID)\b/g) +
    argFields;
  const ts = count(text, /:\s*(?:string|number|boolean|any|unknown|undefined|null|bigint|object)\b/g) + count(text, /\w\[\]/g);
  return gql > ts;
}

/** A GraphQL type reference: `Name`, `Name!`, `[Ref]`, `[Ref]!`. */
type TypeRef =
  | { kind: 'named'; name: string; nonNull: boolean; start: number; end: number }
  | { kind: 'list'; of: TypeRef; nonNull: boolean };

type FieldDef = { name: string; ref: TypeRef | null; nameStart: number };

type ObjectDef = { kind: 'object'; keyword: string; fields: FieldDef[]; unparsed: string[] };
type Definition =
  | ObjectDef
  | { kind: 'enum'; values: string[] }
  | { kind: 'union'; members: string[] }
  | { kind: 'scalar' };

/** Skip spaces, newlines and (insignificant) commas. */
function skipWs(text: string, i: number, end: number): number {
  while (i < end && /[\s,]/.test(text[i])) i++;
  return i;
}

/** `text[i]` is an opener; return the index of its balanced closer before `end`, or -1. */
function matchClose(text: string, i: number, end: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < end; j++) {
    if (text[j] === open) depth++;
    else if (text[j] === close && --depth === 0) return j;
  }
  return -1;
}

/** For each `{`, the index of its matching `}` (or -1), in one stack pass. Same answer as
 *  matchClose(text, open, text.length, '{', '}'). */
function braceMatches(text: string): Int32Array {
  const out = new Int32Array(text.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(i);
    else if (text[i] === '}' && stack.length) out[stack.pop()!] = i;
  }
  return out;
}

/** Skip directives (`@name` or `@name(args)`) starting at `i`. */
function skipDirectives(text: string, i: number, end: number): number {
  for (;;) {
    const j = skipWs(text, i, end);
    const m = /@[A-Za-z_]\w*/y;
    m.lastIndex = j;
    if (j >= end || !m.exec(text)) return i;
    let k = m.lastIndex;
    const p = skipWs(text, k, end);
    if (text[p] === '(') {
      const c = matchClose(text, p, end, '(', ')');
      if (c < 0) return end;
      k = c + 1;
    }
    i = k;
  }
}

/** Parse a type reference at `i`; returns it and the index just past it, or null.
 *  Iterative (count the `[`s, read the name, then close each list), so a deeply
 *  nested `[[[...` can't overflow the stack. */
function parseTypeRef(text: string, i: number, end: number): { ref: TypeRef; end: number } | null {
  i = skipWs(text, i, end);
  let lists = 0;
  while (text[i] === '[') { lists++; i = skipWs(text, i + 1, end); }
  const m = /[A-Za-z_]\w*/y;
  m.lastIndex = i;
  const name = m.exec(text);
  if (!name) return null;
  const nameEnd = i + name[0].length;
  let bang = skipWs(text, nameEnd, end);
  let nonNull = text[bang] === '!';
  let ref: TypeRef = { kind: 'named', name: name[0], nonNull, start: i, end: nameEnd };
  let after = nonNull ? bang + 1 : nameEnd;
  for (let k = 0; k < lists; k++) {
    let j = skipWs(text, after, end);
    if (text[j] !== ']') return null;
    j++;
    bang = skipWs(text, j, end);
    nonNull = text[bang] === '!';
    ref = { kind: 'list', of: ref, nonNull };
    after = nonNull ? bang + 1 : j;
  }
  return { ref, end: after };
}

/** Parse the fields of an object body `text[from, to)`. */
function parseFields(text: string, from: number, to: number): { fields: FieldDef[]; unparsed: string[] } {
  const fields: FieldDef[] = [];
  const unparsed: string[] = [];
  let i = from;
  while (i < to) {
    i = skipWs(text, i, to);
    if (i >= to) break;
    const nm = /[A-Za-z_]\w*/y;
    nm.lastIndex = i;
    const name = nm.exec(text);
    const lineEnd = (() => { const n = text.indexOf('\n', i); return n < 0 || n > to ? to : n; })();
    if (!name) { i = Math.max(lineEnd, i + 1); continue; }
    let j = skipWs(text, i + name[0].length, to);
    if (text[j] === '(') {
      const c = matchClose(text, j, to, '(', ')');
      if (c < 0) { unparsed.push(name[0]); break; }
      j = skipWs(text, c + 1, to);
    }
    if (text[j] !== ':') { unparsed.push(name[0]); i = Math.max(lineEnd, i + name[0].length); continue; }
    const t = parseTypeRef(text, j + 1, to);
    if (!t) { fields.push({ name: name[0], ref: null, nameStart: i }); i = Math.max(lineEnd, j + 1); continue; }
    fields.push({ name: name[0], ref: t.ref, nameStart: i });
    // Skip directives and any default value (`= ...`, input types) to the next field
    let k = skipDirectives(text, t.end, to);
    k = skipWs(text, k, to);
    if (text[k] === '=') {
      // Default value: a list, an object, or a single token (strings are already blanked)
      k = skipWs(text, k + 1, to);
      if (text[k] === '[' || text[k] === '{') {
        const c = matchClose(text, k, to, text[k], text[k] === '[' ? ']' : '}');
        k = c < 0 ? to : c + 1;
      } else {
        const tok = /[-\w.]*/y;
        tok.lastIndex = k;
        tok.exec(text);
        k = tok.lastIndex;
      }
      k = skipDirectives(text, k, to);
    }
    i = Math.max(k, i + 1);
  }
  return { fields, unparsed };
}

/** Collect every definition in the (masked) SDL; returns them plus the root type name. */
function collectDefinitions(text: string): { defs: Map<string, Definition>; root: string | null } {
  const defs = new Map<string, Definition>();
  const order: Array<{ name: string; keyword: string }> = [];
  const re = /^[ \t]*(extend[ \t]+)?(type|interface|input|enum|union|scalar)[ \t]+([A-Za-z_]\w*)/gm;
  // Lookup tables built once, so no header rescans the rest of the text (linear overall):
  // the next `{` / `}`, each `{`'s matching `}`, and the line starts of definition keywords.
  const nextOpen = nextOf(text, '{');
  const nextClose = nextOf(text, '}');
  const closeOf = braceMatches(text);
  const keywordLines = [...text.matchAll(/\n[ \t]*(?:extend|type|interface|input|enum|union|scalar|schema|directive)\b/g)].map((k) => k.index!);
  /** Is there a definition keyword line starting in [from, to)? */
  const keywordBetween = (from: number, to: number) => {
    let lo = 0, hi = keywordLines.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keywordLines[mid] < from) lo = mid + 1; else hi = mid; }
    return lo < keywordLines.length && keywordLines[lo] < to;
  };
  const unionRe = /[^=\n{]*=\s*(?:\|\s*)?([A-Za-z_]\w*(?:\s*\|\s*[A-Za-z_]\w*)*)/y;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, extend, keyword, name] = m;
    const after = m.index + m[0].length;
    if (name === UNSAFE_KEY) continue;

    if (keyword === 'scalar') {
      if (!defs.has(name)) defs.set(name, { kind: 'scalar' });
      continue;
    }
    if (keyword === 'union') {
      unionRe.lastIndex = after;
      const eq = unionRe.exec(text);
      if (eq) defs.set(name, { kind: 'union', members: eq[1].split('|').map((s) => s.trim()) });
      continue;
    }

    // Object types and enums: find the `{` (after `implements ...` / directives)
    const open = nextOpen[after];
    if (open >= text.length || nextClose[after] < open || keywordBetween(after, open)) continue;
    const close = closeOf[open];
    if (close < 0) continue;
    re.lastIndex = close + 1;

    if (keyword === 'enum') {
      // `[^()]*`, not `[^)]*`: an unclosed `(` can't run to the body end (strings are masked)
      const body = text.slice(open + 1, close).replace(/@[A-Za-z_]\w*(?:\s*\([^()]*\))?/g, ' ');
      const values = body.match(/[A-Za-z_]\w*/g) ?? [];
      const prev = defs.get(name);
      defs.set(name, { kind: 'enum', values: [...(prev?.kind === 'enum' ? prev.values : []), ...values] });
      continue;
    }

    const { fields, unparsed } = parseFields(text, open + 1, close);
    const prev = defs.get(name);
    if (prev?.kind === 'object') {
      prev.fields.push(...fields);
      prev.unparsed.push(...unparsed);
    } else {
      defs.set(name, { kind: 'object', keyword, fields, unparsed });
    }
    if (!extend) order.push({ name, keyword });
  }
  const root = order.find((d) => d.keyword === 'type')?.name ?? order[0]?.name ?? null;
  return { defs, root };
}

/** An object type waiting to be expanded: its fields go into `out`. */
type Job = { typeName: string; def: ObjectDef; path: string[]; relPath: string; out: Record<string, MockPropertyDefinition> };

type Ctx = {
  defs: Map<string, Definition>;
  budget: number;
  spans: ValueSpan[];
  spanned: Set<string>;
  reported: Set<string>;
  root: string;
  /** Breadth-first: object types are expanded in the order they are reached. */
  queue: Job[];
  recognized: string[];
  unrecognized: string[];
};

type Resolved = { def: MockDefinition | null; capped?: boolean };

/** Custom scalars map by name. */
function customScalar(name: string): MockPrimitiveDefinition {
  if (/date|time/i.test(name)) return { type: 'date' };
  if (/json|object|any/i.test(name)) return { type: 'any' };
  if (/url|uri/i.test(name)) return { type: 'string', format: 'url' };
  if (/email/i.test(name)) return { type: 'string', format: 'email' };
  if (/uuid/i.test(name)) return { type: 'string', format: 'uuid' };
  return { type: 'string' };
}

/** Resolve a type reference to a mock definition. `path` lists the object types above. */
function resolveRef(ref: TypeRef, ctx: Ctx, path: string[], listName: string): Resolved {
  let lists = 0;
  let inner: TypeRef = ref;
  while (inner.kind === 'list') { lists++; inner = inner.of; }
  const r = resolveNamed(inner.name, ctx, path, listName, 0);
  if (lists === 0 || (!r.def && !r.capped)) return r;
  // A capped type inside a list: an empty list
  if (r.capped) return { def: { type: 'array', itemType: { type: 'null' }, length: 0 } };
  let def = r.def!;
  for (let k = 0; k < Math.min(lists, MAX_LIST_NESTING); k++) def = { type: 'array', itemType: def };
  return { def };
}

function resolveNamed(name: string, ctx: Ctx, path: string[], listName: string, hops: number): Resolved {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SCALARS, name)) return { def: { ...BUILTIN_SCALARS[name] } };
  const def = ctx.defs.get(name);
  if (!def) return { def: null };
  switch (def.kind) {
    case 'scalar':
      return { def: customScalar(name) };
    case 'enum':
      return { def: def.values.length ? { type: 'string', enum: [...def.values] } : { type: 'string' } };
    case 'union':
      // A union mocks as its first member type
      return hops < 8 && def.members.length ? resolveNamed(def.members[0], ctx, path, listName, hops + 1) : { def: null };
    case 'object': {
      if (path.length > MAX_DEPTH || path.filter((p) => p === name).length >= MAX_REPEAT || ctx.budget <= 0) {
        return { def: null, capped: true };
      }
      // Filled in when its turn in the queue comes
      const properties: Record<string, MockPropertyDefinition> = {};
      ctx.queue.push({ typeName: name, def, path: [...path, name], relPath: listName, out: properties });
      return { def: { type: 'object', name, properties } };
    }
  }
}

/** Expand one object type's fields into `job.out`. `relPath` prefixes the field lists. */
function buildObject(job: Job, ctx: Ctx): void {
  const { typeName, def, path, relPath, out } = job;
  // Unrecognized fields are reported once per SOURCE field (bare for the root type,
  // `Type.field` otherwise), not once per path a type is expanded on.
  const report = (field: string) => {
    const label = typeName === ctx.root ? field : `${typeName}.${field}`;
    if (!ctx.reported.has(label)) { ctx.reported.add(label); ctx.unrecognized.push(label); }
  };
  def.unparsed.forEach(report);

  for (const field of def.fields) {
    const listName = relPath ? `${relPath}.${field.name}` : field.name;
    if (field.name === UNSAFE_KEY || !field.ref) { report(field.name); continue; }
    ctx.budget--;
    const r = resolveRef(field.ref, ctx, path, listName);
    const mock: MockDefinition | null = r.capped ? { type: 'null' } : r.def;
    if (!mock) { report(field.name); continue; }
    out[field.name] = { mock, optional: !field.ref.nonNull };
    ctx.recognized.push(listName);

    // Span of the scalar type name, once per source field (patch target)
    let inner: TypeRef = field.ref;
    while (inner.kind === 'list') inner = inner.of;
    const key = `${typeName}.${field.name}@${inner.start}`;
    const leaf = ctx.defs.get(inner.name);
    const isLeaf = Object.prototype.hasOwnProperty.call(BUILTIN_SCALARS, inner.name) || leaf?.kind === 'scalar' || leaf?.kind === 'enum';
    if (isLeaf && !ctx.spanned.has(key)) {
      ctx.spanned.add(key);
      ctx.spans.push({ fieldPath: `${typeName}.${field.name}`, mockKey: `${typeName}.${field.name}`, start: inner.start, end: inner.end, quote: '' });
    }
  }
}

/**
 * Parse GraphQL SDL into a mock configuration + spans. Returns null unless the
 * paste looks like GraphQL (see looksLikeGraphQL) and defines an object type.
 */
export function parseGraphQLSchema(code: string): SchemaImport | null {
  const src = code ?? '';
  if (!looksLikeGraphQL(src)) return null;
  const text = maskGraphQL(blankFences(src));
  const { defs, root } = collectDefinitions(text);
  const rootDef = root ? defs.get(root) : undefined;
  if (!root || !rootDef || rootDef.kind !== 'object') return null;

  const properties: Record<string, MockPropertyDefinition> = {};
  const ctx: Ctx = {
    defs, budget: FIELD_BUDGET, spans: [], spanned: new Set(), reported: new Set(), root,
    queue: [{ typeName: root, def: rootDef, path: [root], relPath: '', out: properties }],
    recognized: [], unrecognized: [],
  };
  for (let q = 0; q < ctx.queue.length; q++) buildObject(ctx.queue[q], ctx);
  const { recognized, unrecognized } = ctx;

  return {
    config: { type: 'graphql-type', name: root, root: { type: 'object', properties } },
    spans: ctx.spans,
    source: src,
    schemaType: 'graphql-type',
    recognized,
    unrecognized,
  };
}
