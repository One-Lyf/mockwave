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

import type { MockConfig, MockValueSpan, MockImport } from './types';

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
  
  // Try to extract interface or type definition
  const interfaceMatch = /(interface|type)\s+(\w+)\s*[=:]\s*([\s\S]*?)(?=\n(?:export\s+)?(?:interface|type|class|function|const|let|var|}|;)|$)/.exec(src);
  if (!interfaceMatch) return null;
  
  const [, keyword, typeName, body] = interfaceMatch;
  const schemaType: SchemaType = keyword === 'interface' ? 'typescript-interface' : 'typescript-type';
  
  const { config, spans, recognized, unrecognized } = parseTypeScriptBody(body, typeName, []);
  
  return {
    config: {
      type: schemaType,
      name: typeName,
      root: config,
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
    
    const { config, spans, recognized, unrecognized } = parseJSONSchemaProperties(
      schema.properties,
      '',
      []
    );
    
    return {
      config: {
        type: 'json-schema',
        name: schema.title || 'Schema',
        root: {
          type: 'object',
          properties: config,
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
    
    const { config, spans } = buildMockConfigFromValue(data, '', []);
    
    return {
      config: {
        type: 'json',
        name: 'Data',
        root: config,
      },
      spans,
      source: src,
      schemaType: 'json',
      recognized: Object.keys(config.properties || {}),
      unrecognized: [],
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

function parseTypeScriptBody(body: string, parentPath: string, parentFields: string[]): {
  config: Record<string, unknown>;
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
} {
  const config: Record<string, unknown> = {};
  const spans: ValueSpan[] = [];
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  
  // Simple field parser: looks for `field: Type` or `field?: Type`
  const fieldRegex = /(\w+)\s*(\?)?\s*:\s*([^;,]+)/g;
  let match;
  
  while ((match = fieldRegex.exec(body)) !== null) {
    const [, fieldName, isOptional, typeDef] = match;
    const fullFieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    
    // Parse the type definition
    const { mockType, mockValue, spanStart, spanEnd, quote } = parseTypeScriptType(typeDef, match.index);
    
    if (mockType) {
      config[fieldName] = {
        type: mockType,
        optional: !!isOptional,
        // For now, store a placeholder value
        // TODO: Store the actual mock configuration
      };
      
      spans.push({
        fieldPath: fullFieldPath,
        mockKey: fullFieldPath,
        start: spanStart,
        end: spanEnd,
        quote,
      });
      
      recognized.push(fieldName);
    } else {
      unrecognized.push(fieldName);
    }
  }
  
  return { config, spans, recognized, unrecognized };
}

function parseTypeScriptType(typeDef: string, baseOffset: number): {
  mockType: string | null;
  mockValue: unknown;
  spanStart: number;
  spanEnd: number;
  quote: string;
} {
  const trimmed = typeDef.trim();
  
  // Handle array types: Type[]
  if (/^(\w+)\[\]$/.test(trimmed)) {
    const elementType = trimmed.slice(0, -2);
    return {
      mockType: 'array',
      mockValue: null,
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
      mockType: 'literal',
      mockValue: trimmed.slice(1, -1),
      spanStart: baseOffset,
      spanEnd: baseOffset + trimmed.length,
      quote: trimmed[0],
    };
  }
  
  // Primitive types
  const primitiveMap: Record<string, string> = {
    'string': 'string',
    'number': 'number',
    'boolean': 'boolean',
    'Date': 'date',
    'any': 'any',
    'unknown': 'any',
    'null': 'null',
    'undefined': 'null',
  };
  
  if (primitiveMap[trimmed]) {
    return {
      mockType: primitiveMap[trimmed],
      mockValue: getDefaultMockValue(primitiveMap[trimmed]),
      spanStart: baseOffset,
      spanEnd: baseOffset + trimmed.length,
      quote: '',
    };
  }
  
  // Custom type or unrecognized
  return {
    mockType: null,
    mockValue: null,
    spanStart: baseOffset,
    spanEnd: baseOffset + trimmed.length,
    quote: '',
  };
}

function parseJSONSchemaProperties(
  properties: Record<string, unknown>,
  parentPath: string,
  parentSpans: ValueSpan[]
): {
  config: Record<string, unknown>;
  spans: ValueSpan[];
  recognized: string[];
  unrecognized: string[];
} {
  const config: Record<string, unknown> = {};
  const spans: ValueSpan[] = [...parentSpans];
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  
  for (const [fieldName, schema] of Object.entries(properties)) {
    const schemaObj = schema as Record<string, unknown>;
    const type = schemaObj.type as string;
    const fullFieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    
    if (type) {
      config[fieldName] = {
        type,
        // TODO: Extract more schema properties (format, enum, etc.)
      };
      
      // For JSON Schema, we don't have source spans yet
      // This would need to be implemented by tracking positions in the original JSON
      
      recognized.push(fieldName);
    } else {
      unrecognized.push(fieldName);
    }
  }
  
  return { config, spans, recognized, unrecognized };
}

function buildMockConfigFromValue(
  value: unknown,
  parentPath: string,
  parentSpans: ValueSpan[]
): {
  config: Record<string, unknown>;
  spans: ValueSpan[];
} {
  const config: Record<string, unknown> = {};
  const spans: ValueSpan[] = [...parentSpans];
  
  if (Array.isArray(value)) {
    config.type = 'array';
    if (value.length > 0) {
      const { config: itemConfig } = buildMockConfigFromValue(value[0], '', []);
      config.itemType = itemConfig;
    }
  } else if (value && typeof value === 'object') {
    config.type = 'object';
    const properties: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const { config: propConfig } = buildMockConfigFromValue(val, '', []);
      properties[key] = propConfig;
    }
    config.properties = properties;
  } else {
    config.type = typeof value;
    config.default = value;
  }
  
  return { config, spans };
}

function getDefaultMockValue(type: string): unknown {
  switch (type) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'date': return '2026-01-01T00:00:00.000Z';
    case 'null': return null;
    case 'any': return null;
    default: return null;
  }
}

/**
 * Rewrite each recognized mock value in the ORIGINAL source with the current config's
 * value — patch-in-place, so unrecognized code is preserved verbatim. Spans are
 * applied right-to-left so earlier offsets stay valid as lengths change.
 */
export function patchCode(imp: SchemaImport, config: MockConfig): string {
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
