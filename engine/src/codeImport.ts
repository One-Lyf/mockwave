/**
 * Mockwave: Deterministic Data Schema Import
 * 
 * The Mockwave hero, done deterministically (NO AI): bring your project's own
 * data schema/code into Mockwave, configure mocking rules, and get YOUR code
 * back with only the mock values changed — so a plain diff shows exactly your edits.
 *
 * This module parses a pasted data schema (TypeScript interface, JSON Schema, etc.)
 * into a mock configuration AND records the exact character span of every value
 * it recognized. On export, patchCode() rewrites those spans in the ORIGINAL text
 * in place (never a regeneration), so unrecognized code is preserved byte-for-byte
 * and the diff is just the mocked values.
 *
 * Pattern mirrors Rackwave's parseWebAudioSnippet -> patchCode -> unifiedDiff flow.
 */

import type { MockConfig, MockDefinition, MockPrimitiveDefinition, MockPropertyDefinition } from './types';
import { parseGraphQLSchema } from './graphqlImport';

/** A mockable value located in the pasted schema, with its exact text span so
 *  patchCode() can rewrite it in place. */
export interface ValueSpan {
  fieldPath: string;           // e.g., "User.name" or "[0].id"
  mockKey: string;            // The mock configuration key
  start: number;              // char offset of the literal in the original source
  end: number;                // exclusive
  quote: string;              // '' for unquoted, '"' or "'" for strings
}

/**
 * Supported schema types for deterministic parsing.
 * AI fallback handles anything not in this list.
 */
export type SchemaType = 
  | 'typescript-interface'
  | 'typescript-type'
  | 'json-schema'
  | 'json'
  | 'zod-schema'
  | 'yup-schema'
  | 'graphql-type';

/** Result of parsing a data schema. */
export interface SchemaImport {
  /** Mock configuration extracted from the schema. */
  config: MockConfig;
  /** Per-field source spans, for in-place patching on export. */
  spans: ValueSpan[];
  /** The original pasted text, verbatim (the patch baseline). */
  source: string;
  /** Schema type that was recognized. */
  schemaType: SchemaType;
  /** Fields successfully recognized and mapped. */
  recognized: string[];
  /** Fields/types that couldn't be mapped (will use AI fallback or defaults). */
  unrecognized: string[];
}

/**
 * Parse a TypeScript interface definition into a mock configuration + spans.
 * 
 * Recognizes:
 * - Primitive types: string, number, boolean, Date, etc.
 * - Array types: Type[], Array<T>, ReadonlyArray<T>
 * - Optional fields: field?: Type
 * - Nested objects: { nested: Type } (at any depth, also inside generics)
 * - Maps: Record<string, V> (a few generated keys) and Record<'a' | 'b', V> (exactly those keys)
 * - Union types: Type1 | Type2 (uses the first member)
 * - Literal types: "value", 42, true
 * - Multi-line headers: `interface Foo\n  extends Bar {`, `interface Foo // note\n{`
 * 
 * Does NOT recognize (reported in `unrecognized`, never leaked into other fields):
 * - Other generics: Partial<T>, Promise<T>, ...
 * - Custom/imported types not in built-in registry
 * - Intersections, tuples, function types, mapped and template literal types
 */
export function parseTypeScriptSchema(code: string): SchemaImport | null {
  const src = code ?? '';
  // Comments blanked to same-length whitespace, so offsets (spans) still index `src`.
  const clean = blankComments(blankFences(src));
  // String/template contents blanked too, for the header search only: a `type Foo {`
  // inside a string or template literal can never be mistaken for the declaration.
  const masked = blankStrings(clean);

  // `interface Name<G> extends A, B {` or `type Name<G> = {`, starting a line. The
  // header may wrap lines (prettier-wrapped `extends`, a comment before `{`), but only
  // generics / an extends clause may sit between the name and `{` (no quotes, `;` or
  // `=` in the extends clause), so a "type <word>" in prose can't hijack the match.
  const head = /^[ \t]*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:(interface)\s+(\w+)\s*(?:<[^{};"'`]*>)?(?:\s*\bextends\s[^{};="'`]*)?|(type)\s+(\w+)\s*(?:<[^{};"'`]*>)?\s*=?)\s*\{/m.exec(masked);
  if (!head) return null;

  const keyword = head[1] ?? head[3];
  const typeName = head[2] ?? head[4];
  const open = head.index + head[0].length;
  const close = matchBrace(clean, open);
  if (close < 0) return null;
  const schemaType: SchemaType = keyword === 'interface' ? 'typescript-interface' : 'typescript-type';

  const { properties, spans, recognized, unrecognized } = parseTypeScriptBody(clean, open, close, typeName, '', 0);
  
  return {
    config: {
      type: schemaType,
      name: typeName,
      root: { type: 'object', properties },
    },
    spans,
    source: src,
    schemaType,
    recognized,
    unrecognized,
  };
}

/**
 * Parse a JSON Schema definition into a mock configuration + spans.
 * 
 * Recognizes JSON Schema properties and their types.
 */
export function parseJSONSchema(code: string): SchemaImport | null {
  const src = code ?? '';
  
  try {
    const schema = JSON.parse(blankFences(src));
    if (!schema || typeof schema !== 'object' || !schema.properties) return null;
    
    const { properties, spans, recognized, unrecognized } = parseJSONSchemaProperties(
      schema.properties,
      Array.isArray(schema.required) ? schema.required : [],
      []
    );
    
    return {
      config: {
        type: 'json-schema',
        name: schema.title || 'Schema',
        root: {
          type: 'object',
          properties,
        },
      },
      spans,
      source: src,
      schemaType: 'json-schema',
      recognized,
      unrecognized,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a JSON object into a mock configuration.
 * Used for plain JSON data structures.
 */
export function parseJSONData(code: string): SchemaImport | null {
  const src = code ?? '';
  
  try {
    const data = JSON.parse(blankFences(src));
    if (!data || typeof data !== 'object') return null;
    
    const root = buildMockConfigFromValue(data);
    const spans: ValueSpan[] = [];
    
    return {
      config: {
        type: 'json',
        name: 'Data',
        root,
      },
      spans,
      source: src,
      schemaType: 'json',
      recognized: root.type === 'object' ? Object.keys(root.properties) : [],
      unrecognized: root.type === 'object' && Object.prototype.hasOwnProperty.call(data, UNSAFE_KEY) ? [UNSAFE_KEY] : [],
    };
  } catch {
    return null;
  }
}

/**
 * Main entry point: try deterministic parsers in order, fall back to AI.
 * 
 * Order: GraphQL SDL (only when it clearly looks like SDL, see looksLikeGraphQL)
 * -> TypeScript -> JSON Schema -> JSON -> (future: others)
 */
export function parseSchema(code: string): SchemaImport | null {
  // GraphQL first: `type X { name: String! }` would otherwise be read as a TS type
  const gqlResult = parseGraphQLSchema(code);
  if (gqlResult) return gqlResult;

  // Then TypeScript (most common for WaveRider users)
  const tsResult = parseTypeScriptSchema(code);
  if (tsResult) return tsResult;
  
  // Try JSON Schema
  const jsonSchemaResult = parseJSONSchema(code);
  if (jsonSchemaResult) return jsonSchemaResult;
  
  // Try plain JSON
  const jsonResult = parseJSONData(code);
  if (jsonResult) return jsonResult;
  
  // TODO: Add more parsers (Zod, Yup, etc.)
  
  // No deterministic parser matched — this would trigger AI fallback
  return null;
}

// -- Helper functions -------------------------------------------------------

/** Keys never written into a config map (would hit Object.prototype's setter). */
const UNSAFE_KEY = '__proto__';

/** Blank Markdown code-fence lines (```ts ... ```) to spaces, so a fenced paste parses
 *  like the bare code. Same length and offsets as the input. */
export function blankFences(src: string): string {
  return src.replace(/^[ \t]*(?:```|~~~)[^\n`]*$/gm, (m) => ' '.repeat(m.length));
}

/** Replace // and block comments with spaces (newlines kept), skipping string literals,
 *  so the result has the same length and offsets as the input. */
function blankComments(src: string): string {
  return src.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m: string, str?: string) => (str ? m : m.replace(/[^\n]/g, ' ')),
  );
}

/** Blank the contents of string and template literals (quotes and newlines kept). */
function blankStrings(src: string): string {
  return src.replace(
    /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    (m: string) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1],
  );
}

/** `text[i]` is a quote ('"`); return the index just past its closing quote. An
 *  unterminated quote (or a '/" string reaching a newline) is treated as a plain char. */
function skipString(text: string, i: number): number {
  const q = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === q) return j + 1;
    if (c === '\n' && q !== '`') break;
  }
  return i + 1;
}

const isQuote = (c: string) => c === '"' || c === "'" || c === '`';
const OPENERS = '{([<';
const CLOSERS = '})]>';

/** Given `open` just past a `{`, return the index of its matching `}` (or -1).
 *  String and template literals are skipped, so `s: "{"` can't unbalance it. */
function matchBrace(text: string, open: number): number {
  let depth = 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (isQuote(c)) { i = skipString(text, i) - 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `text[i]` is one of `{([<`; return the index of its balanced closer before `end`,
 *  tracking all four bracket kinds plus strings (and `=>` arrows), or -1. */
function matchBracket(text: string, i: number, end: number): number {
  const stack: string[] = [];
  for (let j = i; j < end; j++) {
    const c = text[j];
    if (isQuote(c)) { j = skipString(text, j) - 1; continue; }
    if (c === '=' && text[j + 1] === '>') { j++; continue; }
    const o = OPENERS.indexOf(c);
    if (o >= 0) { stack.push(CLOSERS[o]); continue; }
    if (CLOSERS.includes(c)) {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

/** End (exclusive) of the type expression starting at `i`: the first `;` or `,` at
 *  bracket depth 0, a closer with no opener, or a depth-0 newline that doesn't
 *  continue the type (a wrapped `|`/`&` union/intersection keeps going). */
function scanTypeEnd(text: string, i: number, end: number): number {
  let depth = 0;
  for (let j = i; j < end; j++) {
    const c = text[j];
    if (isQuote(c)) { j = skipString(text, j) - 1; continue; }
    if (c === '=' && text[j + 1] === '>') { j++; continue; }
    if (OPENERS.includes(c)) { depth++; continue; }
    if (CLOSERS.includes(c)) { if (depth === 0) return j; depth--; continue; }
    if (depth > 0) continue;
    if (c === ';' || c === ',') return j;
    if (c === '\n') {
      const sofar = text.slice(i, j).trim();
      if (!sofar || /[|&]$/.test(sofar)) continue;
      let k = j + 1;
      while (k < end && /\s/.test(text[k])) k++;
      if (k < end && (text[k] === '|' || text[k] === '&')) continue;
      return j;
    }
  }
  return end;
}

/** Split [s, e) on a separator char at bracket depth 0; returns [start, end) ranges. */
function splitTopLevel(text: string, s: number, e: number, sep: string): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let depth = 0, from = s;
  for (let j = s; j < e; j++) {
    const c = text[j];
    if (isQuote(c)) { j = skipString(text, j) - 1; continue; }
    if (c === '=' && text[j + 1] === '>') { j++; continue; }
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) { parts.push([from, j]); from = j + 1; }
  }
  parts.push([from, e]);
  return parts;
}

/** Index of the depth-0 opener whose balanced closer is `e - 1` (the last group), or -1. */
function lastGroupStart(text: string, s: number, e: number): number {
  for (let j = s; j < e; j++) {
    const c = text[j];
    if (isQuote(c)) { j = skipString(text, j) - 1; continue; }
    if (c === '=' && text[j + 1] === '>') { j++; continue; }
    if (OPENERS.includes(c)) {
      const k = matchBracket(text, j, e);
      if (k < 0) return -1;
      if (k === e - 1) return j;
      j = k;
    }
  }
  return -1;
}

type BodyResult = {
  properties: Record<string, MockPropertyDefinition>;
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
};

/** A parsed type expression: its mock (null = unrecognized), the span of the
 *  patchable value token (for primitives/literals), and any nested-field results. */
type TypeResult = {
  def: MockDefinition | null;
  span?: { start: number; end: number; quote: string };
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
};

const MAX_TYPE_DEPTH = 64;
const noType = (): TypeResult => ({ def: null, spans: [], recognized: [], unrecognized: [] });

/**
 * Parse the members of a brace body `text[from, to)` (offsets are absolute in the
 * source, so spans need no rebasing). `parentPath` is the dotted path including the
 * root type name (for spans); `relPath` is the path from the root type, used for the
 * recognized/unrecognized lists (top-level fields are bare names).
 */
function parseTypeScriptBody(text: string, from: number, to: number, parentPath: string, relPath: string, depth: number): BodyResult {
  const properties: Record<string, MockPropertyDefinition> = {};
  const spans: ValueSpan[] = [];
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  // `name: Type`, `name?: Type`, `readonly name: Type`, `"quoted-name": Type`
  const memberRe = /(?:readonly\s+)?(\w+|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')\s*(\?)?\s*:/y;

  let i = from;
  while (i < to) {
    while (i < to && /[\s;,]/.test(text[i])) i++;
    if (i >= to) break;
    memberRe.lastIndex = i;
    const m = memberRe.exec(text);
    if (!m || m.index + m[0].length > to) {
      // Not a `name: Type` member (method, index/call signature, ...): skip it whole.
      const stop = scanTypeEnd(text, i, to);
      const raw = text.slice(i, stop).trim();
      if (raw) {
        const name = raw.startsWith('[') ? '[index signature]' : (/^(?:readonly\s+)?(\w+)/.exec(raw)?.[1] ?? raw.slice(0, 24));
        unrecognized.push(relPath ? `${relPath}.${name}` : name);
      }
      i = Math.max(stop, i + 1);
      continue;
    }

    let fieldName = m[1];
    if (fieldName[0] === '"' || fieldName[0] === "'") fieldName = fieldName.slice(1, -1);
    const optional = !!m[2];
    const typeStart = i + m[0].length;
    const typeEnd = scanTypeEnd(text, typeStart, to);
    i = Math.max(typeEnd, typeStart + 1);
    const fullFieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    const listName = relPath ? `${relPath}.${fieldName}` : fieldName;

    if (fieldName === UNSAFE_KEY) { unrecognized.push(listName); continue; }

    const t = parseTypeExpr(text, typeStart, typeEnd, fullFieldPath, listName, depth + 1);
    if (!t.def) { unrecognized.push(listName); continue; }

    properties[fieldName] = { mock: t.def, optional };
    if (t.span) {
      spans.push({ fieldPath: fullFieldPath, mockKey: fullFieldPath, start: t.span.start, end: t.span.end, quote: t.span.quote });
    }
    spans.push(...t.spans);
    recognized.push(listName, ...t.recognized);
    unrecognized.push(...t.unrecognized);
  }

  return { properties, spans, recognized, unrecognized };
}

const PRIMITIVES: Record<string, MockPrimitiveDefinition['type']> = {
  'string': 'string',
  'number': 'number',
  'boolean': 'boolean',
  'Date': 'date',
  'any': 'any',
  'unknown': 'any',
  'null': 'null',
  'undefined': 'null',
};

/** Parse the type expression `text[s, e)` into a mock definition. */
function parseTypeExpr(text: string, s: number, e: number, fieldPath: string, listName: string, depth: number): TypeResult {
  if (depth > MAX_TYPE_DEPTH) return noType();
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e) return noType();
  // Leading `|` / `&` from a wrapped (one member per line) union or intersection
  if (text[s] === '|' || text[s] === '&') return parseTypeExpr(text, s + 1, e, fieldPath, listName, depth + 1);

  // Union: use the first member
  const members = splitTopLevel(text, s, e, '|');
  if (members.length > 1) return parseTypeExpr(text, members[0][0], members[0][1], fieldPath, listName, depth + 1);
  // Intersections are not mapped
  if (splitTopLevel(text, s, e, '&').length > 1) return noType();

  const last = text[e - 1];
  if (CLOSERS.includes(last)) {
    const g = lastGroupStart(text, s, e);
    if (g < 0) return noType();
    switch (last) {
      case ']': {
        // `T[]` (a non-empty `[...]` is a tuple or indexed access: not mapped)
        if (g === s || text.slice(g + 1, e - 1).trim()) return noType();
        const el = parseTypeExpr(text, s, g, fieldPath, listName, depth + 1);
        return { ...el, def: { type: 'array', itemType: el.def ?? { type: 'any' } } };
      }
      case ')':
        // `(T)`; anything else ending in `)` is a call/function shape
        return g === s ? parseTypeExpr(text, g + 1, e - 1, fieldPath, listName, depth + 1) : noType();
      case '}': {
        if (g !== s) return noType();
        const body = parseTypeScriptBody(text, g + 1, e - 1, fieldPath, listName, depth + 1);
        return { def: { type: 'object', properties: body.properties }, spans: body.spans, recognized: body.recognized, unrecognized: body.unrecognized };
      }
      case '>': {
        // Generic `Name<A, B>`: arguments are a balanced group, so nothing inside leaks.
        const name = text.slice(s, g).trim();
        const args = splitTopLevel(text, g + 1, e - 1, ',');
        if ((name === 'Array' || name === 'ReadonlyArray') && args.length === 1) {
          const el = parseTypeExpr(text, args[0][0], args[0][1], fieldPath, listName, depth + 1);
          return { ...el, def: { type: 'array', itemType: el.def ?? { type: 'any' } } };
        }
        if (name === 'Record' && args.length === 2) return parseRecord(text, args[0], args[1], fieldPath, listName, depth + 1);
        return noType();
      }
      default:
        return noType();
    }
  }

  const token = text.slice(s, e);
  const span = { start: s, end: e, quote: '' };

  // Literal types: "value", 'value', 42, true
  if (/^(['"])(?:\\.|(?!\1)[^\\\n])*\1$/.test(token)) {
    return { def: { type: 'string', default: token.slice(1, -1) }, span: { ...span, quote: token[0] }, spans: [], recognized: [], unrecognized: [] };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(token)) {
    return { def: { type: 'number', default: Number(token) }, span, spans: [], recognized: [], unrecognized: [] };
  }
  if (token === 'true' || token === 'false') {
    return { def: { type: 'boolean', default: token === 'true' }, span, spans: [], recognized: [], unrecognized: [] };
  }

  if (Object.prototype.hasOwnProperty.call(PRIMITIVES, token)) {
    return { def: { type: PRIMITIVES[token] }, span, spans: [], recognized: [], unrecognized: [] };
  }

  // Custom or unrecognized type (keeps its span so `Foo[]` still locates `Foo`)
  return { ...noType(), span: /^\w+$/.test(token) ? span : undefined };
}

/** `Record<K, V>`: literal keys become exactly those properties; any other key type
 *  becomes a map of a few generated keys. Values come from V (any if V is unknown). */
function parseRecord(text: string, keyRange: [number, number], valRange: [number, number], fieldPath: string, listName: string, depth: number): TypeResult {
  const val = parseTypeExpr(text, valRange[0], valRange[1], fieldPath, listName, depth + 1);
  const valueType: MockDefinition = val.def ?? { type: 'any' };
  const keys = splitTopLevel(text, keyRange[0], keyRange[1], '|')
    .map(([a, b]) => text.slice(a, b).trim())
    .filter(Boolean);
  const literals = keys.map((k) => /^(['"])(.*)\1$/.exec(k)?.[2] ?? (/^-?\d+$/.test(k) ? k : null));
  const base = { spans: val.spans, recognized: val.recognized, unrecognized: val.unrecognized };

  if (literals.length > 0 && literals.every((k): k is string => k !== null)) {
    const properties: Record<string, MockPropertyDefinition> = {};
    for (const key of literals) if (key !== UNSAFE_KEY) properties[key] = { mock: valueType };
    return { ...base, def: { type: 'object', properties } };
  }
  const keyType = keys.length > 0 && keys.every((k) => k === 'number') ? 'number' : 'string';
  return { ...base, def: { type: 'record', valueType, keyType } };
}

function parseJSONSchemaProperties(
  properties: Record<string, unknown>,
  required: string[],
  parentSpans: ValueSpan[]
): {
  properties: Record<string, MockPropertyDefinition>;
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
} {
  const out: Record<string, MockPropertyDefinition> = {};
  const spans: ValueSpan[] = [...parentSpans];
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  
  for (const [fieldName, schema] of Object.entries(properties)) {
    if (fieldName === UNSAFE_KEY) { unrecognized.push(fieldName); continue; }
    const definition = jsonSchemaToDefinition(schema);
    
    if (definition) {
      out[fieldName] = { mock: definition, optional: !required.includes(fieldName) };
      
      // For JSON Schema, we don't have source spans yet
      // This would need to be implemented by tracking positions in the original JSON
      
      recognized.push(fieldName);
    } else {
      unrecognized.push(fieldName);
    }
  }
  
  return { properties: out, spans, recognized, unrecognized };
}

/** Map one JSON Schema node to a mock definition, or null if it has no usable type. */
function jsonSchemaToDefinition(schema: unknown, depth = 0): MockDefinition | null {
  if (!schema || typeof schema !== 'object' || depth > 10) return null;
  const node = schema as Record<string, unknown>;
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') ?? node.type[0] : node.type;
  
  switch (type) {
    case 'object': {
      const props = node.properties && typeof node.properties === 'object'
        ? (node.properties as Record<string, unknown>)
        : {};
      const required = Array.isArray(node.required) ? (node.required as string[]) : [];
      const properties: Record<string, MockPropertyDefinition> = {};
      for (const [key, child] of Object.entries(props)) {
        if (key === UNSAFE_KEY) continue;
        const mock = jsonSchemaToDefinition(child, depth + 1);
        if (mock) properties[key] = { mock, optional: !required.includes(key) };
      }
      return { type: 'object', properties };
    }
    case 'array':
      return { type: 'array', itemType: jsonSchemaToDefinition(node.items, depth + 1) ?? { type: 'any' } };
    case 'string': {
      const def: MockPrimitiveDefinition = { type: node.format === 'date-time' || node.format === 'date' ? 'date' : 'string' };
      if (def.type === 'string' && typeof node.format === 'string') def.format = node.format;
      if (typeof node.minLength === 'number') def.minLength = node.minLength;
      if (typeof node.maxLength === 'number') def.maxLength = node.maxLength;
      if (typeof node.pattern === 'string') def.pattern = node.pattern;
      return def;
    }
    case 'number':
    case 'integer': {
      const def: MockPrimitiveDefinition = { type: 'number' };
      if (type === 'integer') def.integer = true;
      if (typeof node.minimum === 'number') def.minimum = node.minimum;
      if (typeof node.maximum === 'number') def.maximum = node.maximum;
      return def;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    default:
      return null;
  }
}

/** Infer a mock definition from a sample JSON value; primitives keep the sample as their default. */
function buildMockConfigFromValue(value: unknown, depth = 0): MockDefinition {
  if (depth > 10) return { type: 'any' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      itemType: value.length > 0 ? buildMockConfigFromValue(value[0], depth + 1) : { type: 'any' },
    };
  }
  if (value && typeof value === 'object') {
    const properties: Record<string, MockPropertyDefinition> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === UNSAFE_KEY) continue;
      properties[key] = { mock: buildMockConfigFromValue(val, depth + 1) };
    }
    return { type: 'object', properties };
  }
  if (value === null) return { type: 'null' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value as 'string' | 'number' | 'boolean', default: value };
  }
  return { type: 'any' };
}

/**
 * Rewrite each recognized mock value in the ORIGINAL source with the current config's
 * value — patch-in-place, so unrecognized code is preserved verbatim. Spans are
 * applied right-to-left so earlier offsets stay valid as lengths change.
 */
export function patchCode(imp: SchemaImport, _config: MockConfig): string {
  // TODO: Implement based on Rackwave's patchCode pattern
  // This will use the spans from the import to rewrite values in the original source
  
  // For now, just return the original source with a note
  return `${imp.source}\n\n// Mockwave: patchCode not yet implemented - see codeImport.ts`;
}

/**
 * A minimal unified diff (LCS over lines) — enough to show the mock edits.
 * Zero deps; runs in browser + node. Ported from Rackwave's implementation.
 */
export function unifiedDiff(a: string, b: string, context = 2): string {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  
  // LCS length table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  
  // Backtrack into a list of ops
  type Op = { t: ' ' | '-' | '+'; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: ' ', line: A[i], ai: i, bi: j }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ t: '-', line: A[i], ai: i, bi: j }); i++; }
    else { ops.push({ t: '+', line: B[j], ai: i, bi: j }); j++; }
  }
  while (i < n) ops.push({ t: '-', line: A[i], ai: i++, bi: j });
  while (j < m) ops.push({ t: '+', line: B[j], ai: i, bi: j++ });
  
  if (!ops.some((o) => o.t !== ' ')) return ''; // identical
  
  // Group changed ops into hunks
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => { if (o.t !== ' ') for (let d = -context; d <= context; d++) if (k + d >= 0 && k + d < ops.length) keep[k + d] = true; });
  
  const lines: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (!keep[k]) { k++; continue; }
    let e = k; while (e < ops.length && keep[e]) e++;
    const hunk = ops.slice(k, e);
    const aStart = hunk[0].ai + 1, bStart = hunk[0].bi + 1;
    const aLen = hunk.filter((o) => o.t !== '+').length;
    const bLen = hunk.filter((o) => o.t !== '-').length;
    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) lines.push(o.t + o.line);
    k = e;
  }
  return lines.join('\n');
}

/** A prompt the user hands to THEIR coding agent to extract the data schema in
 *  the exact shape parseSchema() understands (so the import is clean without
 *  Mockwave's own AI). */
export const IMPORT_PROMPT = [
  'Extract the data schema from my project as a self-contained snippet I can paste into Mockwave to generate mocks.',
  '',
  'Rules:',
  '- Output ONLY the data structure definition: TypeScript interfaces/types, JSON Schema, GraphQL SDL, or plain JSON.',
  '- One type/interface per snippet for best results.',
  '- Keep field names exactly as they appear in your code.',
  '- Use primitive types (string, number, boolean, Date) where possible.',
  '- Include nested objects and arrays — Mockwave will recursively generate mocks.',
  '- Optional fields (field?: Type) are supported and will generate optional mock values.',
  '- If you have custom types, include their definitions or use primitive types as fallbacks.',
].join('\n');

/** Plain description of the accepted format, for users pasting by hand (no AI). */
export const IMPORT_FORMAT_HELP = [
  'Paste your data schema. Mockwave reads:',
  '  • TypeScript interfaces: interface User { id: string; name: string; age: number; }',
  '  • TypeScript types: type User = { id: string; name: string; };',
  '  • JSON Schema: { "type": "object", "properties": { "id": { "type": "string" } } }',
  '  • Plain JSON data: { "id": "123", "name": "John" } (will infer schema)',
  '  • GraphQL SDL: type User { id: ID! name: String friends: [User!]! }',
  'Use standard primitive types. Custom types may need AI assistance for full mocking.',
].join('\n');
