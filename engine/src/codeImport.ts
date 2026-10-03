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
 * - Array types: Type[]
 * - Optional fields: field?: Type
 * - Nested objects: { nested: Type }
 * - Union types: Type1 | Type2 (uses first non-null type)
 * - Literal types: "value"
 * 
 * Does NOT recognize (left for AI fallback):
 * - Generic types: Array<T>, Record<K, V>
 * - Custom/imported types not in built-in registry
 * - Complex union types
 * - Template literal types
 * - Mapped types
 */
export function parseTypeScriptSchema(code: string): SchemaImport | null {
  const src = code ?? '';
  // Comments blanked to same-length whitespace, so offsets (spans) still index `src`.
  const clean = blankComments(src);

  // `interface Name {` or `type Name = {` (generics/extends allowed), declared at the
  // start of a line and on one line, so a "type foo" in prose or a JSON string can't match.
  const head = /^[ \t]*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(interface|type)\s+(\w+)[^{=;\n]*(?:=\s*)?\{/m.exec(clean);
  if (!head) return null;

  const [, keyword, typeName] = head;
  const open = head.index + head[0].length;
  const close = matchBrace(clean, open);
  if (close < 0) return null;
  const body = clean.slice(open, close);
  const schemaType: SchemaType = keyword === 'interface' ? 'typescript-interface' : 'typescript-type';

  const { properties, spans, recognized, unrecognized } = parseTypeScriptBody(body, typeName, open, '');
  
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
    const schema = JSON.parse(src);
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
    const data = JSON.parse(src);
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
 * Order: TypeScript -> JSON Schema -> JSON -> (future: others)
 */
export function parseSchema(code: string): SchemaImport | null {
  // Try TypeScript first (most common for WaveRider users)
  const tsResult = parseTypeScriptSchema(code);
  if (tsResult) return tsResult;
  
  // Try JSON Schema
  const jsonSchemaResult = parseJSONSchema(code);
  if (jsonSchemaResult) return jsonSchemaResult;
  
  // Try plain JSON
  const jsonResult = parseJSONData(code);
  if (jsonResult) return jsonResult;
  
  // TODO: Add more parsers (Zod, Yup, GraphQL, etc.)
  
  // No deterministic parser matched — this would trigger AI fallback
  return null;
}

// -- Helper functions -------------------------------------------------------

/** Keys never written into a config map (would hit Object.prototype's setter). */
const UNSAFE_KEY = '__proto__';

/** Replace // and block comments with spaces (newlines kept), skipping string literals,
 *  so the result has the same length and offsets as the input. */
function blankComments(src: string): string {
  return src.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m: string, str?: string) => (str ? m : m.replace(/[^\n]/g, ' ')),
  );
}

/** Given `open` just past a `{`, return the index of its matching `}` (or -1). */
function matchBrace(text: string, open: number): number {
  let depth = 1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Parse the fields of a brace body. `bodyOffset` is where `body` starts in the original
 * source (so spans are absolute); `relPath` is the dotted path from the root type, used
 * for the recognized/unrecognized lists (top-level fields are bare names).
 */
function parseTypeScriptBody(body: string, parentPath: string, bodyOffset: number, relPath: string): {
  properties: Record<string, MockPropertyDefinition>;
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
} {
  const properties: Record<string, MockPropertyDefinition> = {};
  const spans: ValueSpan[] = [];
  const recognized: string[] = [];
  const unrecognized: string[] = [];

  // Field parser: `field: Type` or `field?: Type`, or `field: {` opening a nested object type
  const fieldRegex = /(\w+)\s*(\?)?\s*:\s*([^;,\n{}]+|\{)/g;
  let match;

  while ((match = fieldRegex.exec(body)) !== null) {
    const [, fieldName, isOptional, typeDef] = match;
    const fullFieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    const listName = relPath ? `${relPath}.${fieldName}` : fieldName;
    const matchEnd = match.index + match[0].length;

    if (typeDef === '{' || body[matchEnd] === '{') {
      // Inline object type: brace-match it so its fields don't leak into this level.
      const open = matchEnd + (typeDef === '{' ? 0 : 1);
      const close = matchBrace(body, open);
      if (close < 0) { unrecognized.push(listName); break; }
      fieldRegex.lastIndex = close + 1;
      if (typeDef !== '{' || fieldName === UNSAFE_KEY) {
        // e.g. `x: Array<{ a: string }>`: a generic wrapping an object; skip it whole
        unrecognized.push(listName);
        continue;
      }
      const inner = parseTypeScriptBody(body.slice(open, close), fullFieldPath, bodyOffset + open, listName);
      let mock: MockDefinition = { type: 'object', properties: inner.properties };
      const arr = /^\s*\[\]/.exec(body.slice(close + 1));
      if (arr) {
        mock = { type: 'array', itemType: mock };
        fieldRegex.lastIndex = close + 1 + arr[0].length;
      }
      properties[fieldName] = { mock, optional: !!isOptional };
      spans.push(...inner.spans);
      recognized.push(listName, ...inner.recognized);
      unrecognized.push(...inner.unrecognized);
      continue;
    }

    if (fieldName === UNSAFE_KEY) { unrecognized.push(listName); continue; }

    // Parse the type definition (typeDef starts right after `:\s*`, so its offset is exact)
    const typeOffset = bodyOffset + matchEnd - typeDef.length;
    const { definition, spanStart, spanEnd, quote } = parseTypeScriptType(typeDef, typeOffset);

    if (definition) {
      properties[fieldName] = { mock: definition, optional: !!isOptional };
      
      spans.push({
        fieldPath: fullFieldPath,
        mockKey: fullFieldPath,
        start: spanStart,
        end: spanEnd,
        quote,
      });

      recognized.push(listName);
    } else {
      unrecognized.push(listName);
    }
  }
  
  return { properties, spans, recognized, unrecognized };
}

function parseTypeScriptType(typeDef: string, baseOffset: number): {
  definition: MockDefinition | null;
  spanStart: number;
  spanEnd: number;
  quote: string;
} {
  const trimmed = typeDef.trim();
  
  // Handle array types: Type[]
  if (/^(\w+)\[\]$/.test(trimmed)) {
    const elementType = trimmed.slice(0, -2);
    return {
      definition: {
        type: 'array',
        itemType: parseTypeScriptType(elementType, 0).definition ?? { type: 'any' },
      },
      spanStart: baseOffset + typeDef.indexOf(elementType),
      spanEnd: baseOffset + typeDef.indexOf('['),
      quote: '',
    };
  }
  
  // Handle union types: Type1 | Type2 | ...
  if (trimmed.includes('|')) {
    // For now, just take the first type
    const firstType = trimmed.split('|')[0].trim();
    return parseTypeScriptType(firstType, baseOffset);
  }
  
  // Handle literal types: "value"
  if (/^['"](.*)['"]$/.test(trimmed)) {
    return {
      definition: { type: 'string', default: trimmed.slice(1, -1) },
      spanStart: baseOffset,
      spanEnd: baseOffset + trimmed.length,
      quote: trimmed[0],
    };
  }
  
  // Primitive types
  const primitiveMap: Record<string, MockPrimitiveDefinition['type']> = {
    'string': 'string',
    'number': 'number',
    'boolean': 'boolean',
    'Date': 'date',
    'any': 'any',
    'unknown': 'any',
    'null': 'null',
    'undefined': 'null',
  };
  
  if (Object.prototype.hasOwnProperty.call(primitiveMap, trimmed)) {
    return {
      definition: { type: primitiveMap[trimmed] },
      spanStart: baseOffset,
      spanEnd: baseOffset + trimmed.length,
      quote: '',
    };
  }
  
  // Custom type or unrecognized
  return {
    definition: null,
    spanStart: baseOffset,
    spanEnd: baseOffset + trimmed.length,
    quote: '',
  };
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
  '- Output ONLY the data structure definition: TypeScript interfaces/types, JSON Schema, or plain JSON.',
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
  'Use standard primitive types. Custom types may need AI assistance for full mocking.',
].join('\n');
