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
 *   for cycles (a type may re-enter its own path once) and for overall size.
 *
 * Offsets stay aligned with the pasted source: comments and strings are blanked to
 * same-length whitespace before parsing, so spans index the original text.
 */

import type { MockDefinition, MockPrimitiveDefinition, MockPropertyDefinition } from './types';
import type { SchemaImport, ValueSpan } from './codeImport';

/** Keys never written into a config map (would hit Object.prototype's setter). */
const UNSAFE_KEY = '__proto__';
/** Max object nesting below the root type. */
const MAX_DEPTH = 4;
/** A type may appear at most this many times on one path (2 = one level of self-reference). */
const MAX_REPEAT = 2;
/** Total fields expanded per import, so wide, highly connected schemas stay small. */
const FIELD_BUDGET = 2000;

const BUILTIN_SCALARS: Record<string, MockPrimitiveDefinition> = {
  String: { type: 'string' },
  ID: { type: 'string', format: 'uuid' },
  Int: { type: 'number', integer: true },
  Float: { type: 'number' },
  Boolean: { type: 'boolean' },
};

/** Blank Markdown code-fence lines to spaces (same length). */
function blankFences(src: string): string {
  return src.replace(/^[ \t]*(?:```|~~~)[^\n`]*$/gm, (m) => ' '.repeat(m.length));
}

/** Blank GraphQL comments and string / block-string literals (descriptions, directive
 *  arguments) to spaces, keeping newlines, so offsets match the source. */
function maskGraphQL(src: string): string {
  return src.replace(/"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|#[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Like maskGraphQL, but also blanks TypeScript strings/templates/comments: used for
 *  detection, where the input may be either language. */
function maskForDetection(src: string): string {
  return src.replace(
    /"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (m) => m.replace(/[^\n]/g, ' '),
  );
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
  // An object definition to mock is required
  if (!/^[ \t]*(?:extend[ \t]+)?(?:type|interface|input)[ \t]+[A-Za-z_]\w*[^{}=;]*\{/m.test(text)) return false;

  const tsHard =
    /[;<>]|\?\s*:|=>|\bextends\b|\breadonly\s+\w/.test(text) ||
    /^[ \t]*(?:export|declare|const|let|var|import|abstract|class|function)\b/m.test(text) ||
    /\btype\s+\w+\s*=\s*\{/.test(text);
  if (tsHard) return false;

  const strong =
    /^[ \t]*"""/m.test(raw) ||
    /^[ \t]*(?:schema\s*\{|scalar[ \t]+[A-Za-z_]|directive[ \t]+@|extend[ \t]+(?:type|interface|input|enum|union|schema)\b|input[ \t]+[A-Za-z_]\w*[^{}]*\{|union[ \t]+[A-Za-z_]\w*[^=\n]*=)/m.test(text) ||
    /^[ \t]*(?:type|interface)[ \t]+[A-Za-z_]\w*[ \t]+implements\b/m.test(text);
  if (strong) return true;

  const gql =
    count(text, /^[ \t]*type[ \t]+[A-Za-z_]\w*\s*(?:@[^{]*)?\{/gm) + // `type X {` (no `=`) is not valid TypeScript
    count(text, /[\w\]][ \t]*!/g) +
    count(text, /:\s*\[/g) +
    count(text, /:\s*\[*\s*(?:String|Int|Float|Boolean|ID)\b/g) +
    count(text, /^[ \t]*\w+\s*\([^)]*\)\s*:/gm);
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

/** Parse a type reference at `i`; returns it and the index just past it, or null. */
function parseTypeRef(text: string, i: number, end: number): { ref: TypeRef; end: number } | null {
  i = skipWs(text, i, end);
  if (text[i] === '[') {
    const inner = parseTypeRef(text, i + 1, end);
    if (!inner) return null;
    let j = skipWs(text, inner.end, end);
    if (text[j] !== ']') return null;
    j++;
    const bang = skipWs(text, j, end);
    const nonNull = text[bang] === '!';
    return { ref: { kind: 'list', of: inner.ref, nonNull }, end: nonNull ? bang + 1 : j };
  }
  const m = /[A-Za-z_]\w*/y;
  m.lastIndex = i;
  const name = m.exec(text);
  if (!name) return null;
  const nameEnd = i + name[0].length;
  const bang = skipWs(text, nameEnd, end);
  const nonNull = text[bang] === '!';
  return { ref: { kind: 'named', name: name[0], nonNull, start: i, end: nameEnd }, end: nonNull ? bang + 1 : nameEnd };
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
      const eq = /^[^=\n{]*=\s*\|?\s*([A-Za-z_]\w*(?:\s*\|\s*[A-Za-z_]\w*)*)/.exec(text.slice(after));
      if (eq) defs.set(name, { kind: 'union', members: eq[1].split('|').map((s) => s.trim()) });
      continue;
    }

    // Object types and enums: find the `{` (after `implements ...` / directives)
    const open = text.indexOf('{', after);
    if (open < 0 || /[}]/.test(text.slice(after, open)) || /\n[ \t]*(?:extend|type|interface|input|enum|union|scalar|schema|directive)\b/.test(text.slice(after, open))) continue;
    const close = matchClose(text, open, text.length, '{', '}');
    if (close < 0) continue;
    re.lastIndex = close + 1;

    if (keyword === 'enum') {
      const body = text.slice(open + 1, close).replace(/@[A-Za-z_]\w*(?:\s*\([^)]*\))?/g, ' ');
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

type Ctx = {
  defs: Map<string, Definition>;
  budget: number;
  spans: ValueSpan[];
  spanned: Set<string>;
  reported: Set<string>;
  root: string;
};

type Resolved = { def: MockDefinition | null; capped?: boolean; recognized: string[]; unrecognized: string[] };

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
  if (ref.kind === 'list') {
    const inner = resolveRef(ref.of, ctx, path, listName);
    if (inner.capped) return { def: { type: 'array', itemType: { type: 'null' }, length: 0 }, recognized: [], unrecognized: [] };
    if (!inner.def) return inner;
    return { ...inner, def: { type: 'array', itemType: inner.def } };
  }
  return resolveNamed(ref.name, ctx, path, listName, 0);
}

function resolveNamed(name: string, ctx: Ctx, path: string[], listName: string, hops: number): Resolved {
  const none: Resolved = { def: null, recognized: [], unrecognized: [] };
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SCALARS, name)) return { def: { ...BUILTIN_SCALARS[name] }, recognized: [], unrecognized: [] };
  const def = ctx.defs.get(name);
  if (!def) return none;
  switch (def.kind) {
    case 'scalar':
      return { def: customScalar(name), recognized: [], unrecognized: [] };
    case 'enum':
      return { def: def.values.length ? { type: 'string', enum: [...def.values] } : { type: 'string' }, recognized: [], unrecognized: [] };
    case 'union':
      // A union mocks as its first member type
      return hops < 8 && def.members.length ? resolveNamed(def.members[0], ctx, path, listName, hops + 1) : none;
    case 'object': {
      if (path.length > MAX_DEPTH || path.filter((p) => p === name).length >= MAX_REPEAT || ctx.budget <= 0) {
        return { def: null, capped: true, recognized: [], unrecognized: [] };
      }
      const body = buildObject(name, def, ctx, [...path, name], listName);
      return { def: { type: 'object', properties: body.properties }, recognized: body.recognized, unrecognized: body.unrecognized };
    }
  }
}

/** Build the properties of object type `typeName`. `relPath` prefixes the field lists. */
function buildObject(typeName: string, def: ObjectDef, ctx: Ctx, path: string[], relPath: string): {
  properties: Record<string, MockPropertyDefinition>;
  recognized: string[];
  unrecognized: string[];
} {
  const properties: Record<string, MockPropertyDefinition> = {};
  const recognized: string[] = [];
  // Unrecognized fields are reported once per SOURCE field (bare for the root type,
  // `Type.field` otherwise), not once per path a type is expanded on.
  const unrecognized: string[] = [];
  const report = (field: string) => {
    const label = typeName === ctx.root ? field : `${typeName}.${field}`;
    if (!ctx.reported.has(label)) { ctx.reported.add(label); unrecognized.push(label); }
  };
  def.unparsed.forEach(report);

  for (const field of def.fields) {
    const listName = relPath ? `${relPath}.${field.name}` : field.name;
    if (field.name === UNSAFE_KEY || !field.ref) { report(field.name); continue; }
    ctx.budget--;
    const r = resolveRef(field.ref, ctx, path, listName);
    const mock: MockDefinition | null = r.capped ? { type: 'null' } : r.def;
    if (!mock) { report(field.name); continue; }
    properties[field.name] = { mock, optional: !field.ref.nonNull };
    recognized.push(listName, ...r.recognized);
    unrecognized.push(...r.unrecognized);

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
  return { properties, recognized, unrecognized };
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

  const ctx: Ctx = { defs, budget: FIELD_BUDGET, spans: [], spanned: new Set(), reported: new Set(), root };
  const { properties, recognized, unrecognized } = buildObject(root, rootDef, ctx, [root], '');

  return {
    config: { type: 'graphql-type', name: root, root: { type: 'object', properties } },
    spans: ctx.spans,
    source: src,
    schemaType: 'graphql-type',
    recognized,
    unrecognized,
  };
}
