/**
 * Mockwave Type Definitions
 * 
 * The canonical types for Mockwave's data mocking system.
 * Mirrors the pattern from Rackwave (ChainState, DeviceState) and Fluxwave (UIDocument).
 */

/**
 * A mock configuration for a single schema/type.
 * Defines how to generate mock data for that type.
 */
export interface MockConfig {
  /** The source schema type (typescript-interface, json-schema, etc.) */
  type: string;
  /** The name of the type/schema (e.g., "User" from interface User) */
  name: string;
  /** The root mock definition */
  root: MockDefinition;
}

/**
 * A mock definition for a type (object, array, or primitive).
 */
export type MockDefinition =
  | MockObjectDefinition
  | MockArrayDefinition
  | MockRecordDefinition
  | MockPrimitiveDefinition;

/**
 * Definition for an object type (TypeScript interface, JSON Schema object, etc.)
 */
export interface MockObjectDefinition {
  type: 'object';
  /** The source type's name (`Address`), when it has one: field-name hints read it as context. */
  name?: string;
  /** Mock configuration for each property */
  properties: Record<string, MockPropertyDefinition>;
}

/**
 * Definition for an array type.
 */
export interface MockArrayDefinition {
  type: 'array';
  /** Mock configuration for array items */
  itemType: MockDefinition;
  /** Minimum array length */
  minLength?: number;
  /** Maximum array length */
  maxLength?: number;
  /** Exact array length (if specified) */
  length?: number;
}

/**
 * Definition for a map type (TypeScript `Record<string, V>`): an object with a few
 * generated keys, each holding a value generated from `valueType`.
 */
export interface MockRecordDefinition {
  type: 'record';
  /** Mock configuration for every value */
  valueType: MockDefinition;
  /** Shape of the generated keys (default 'string') */
  keyType?: 'string' | 'number';
  /** How many keys to generate (default 3, capped at 20) */
  keyCount?: number;
}

/**
 * Definition for a primitive type.
 */
export interface MockPrimitiveDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'null' | 'any';
  /** Default value for this primitive */
  default?: unknown;
  /** Allowed values (e.g. a GraphQL enum); one is picked per generated value */
  enum?: unknown[];
  /** For strings: format (uuid, email, url, etc.) */
  format?: string;
  /** For strings: min length */
  minLength?: number;
  /** For strings: max length */
  maxLength?: number;
  /** For strings: pattern (regex) */
  pattern?: string;
  /** For numbers: min value */
  minimum?: number;
  /** For numbers: max value */
  maximum?: number;
  /** For numbers: true = integers, false = decimals; unset = integers unless the field name suggests decimals (price, rating) */
  integer?: boolean;
  /** For non-integer numbers: decimal places to round to (default 2) */
  precision?: number;
  /**
   * A sample value from the source (e.g. sample JSON). It sizes generated numbers and
   * stands in for strings the field name says nothing about; it is never echoed for
   * names that suggest a value (id, email, price...).
   */
  example?: unknown;
}

/**
 * Definition for a single property/field in an object.
 */
export interface MockPropertyDefinition {
  /** The mock definition for this property */
  mock: MockDefinition;
  /** Whether this property is optional (field?: Type) */
  optional?: boolean;
  /** Custom mock value (overrides the type default) */
  value?: unknown;
  /** Probability this field appears (for optional fields, 0-1) */
  probability?: number;
}

/**
 * A span representing a value in the source code that was recognized and can be patched.
 * Mirrors Rackwave's ValueSpan pattern.
 */
export interface MockValueSpan {
  /** The path to the field in the schema (e.g., "User.address.city") */
  fieldPath: string;
  /** The mock configuration key that maps to this span */
  mockKey: string;
  /** Start character offset in the original source */
  start: number;
  /** End character offset (exclusive) */
  end: number;
  /** Quote character used (empty for unquoted) */
  quote: string;
}

/**
 * Complete import result with schema + spans.
 * Mirrors Rackwave's CodeImport pattern.
 */
export interface MockImport {
  /** The parsed mock configuration */
  config: MockConfig;
  /** Spans for in-place patching */
  spans: MockValueSpan[];
  /** Original source text (patch baseline) */
  source: string;
  /** Type of schema that was recognized */
  schemaType: string;
  /** Fields that were successfully recognized */
  recognized: string[];
  /** Fields that couldn't be mapped (need AI fallback) */
  unrecognized: string[];
}

/**
 * Generated mock data result.
 */
export interface GeneratedMock {
  /** The generated mock data */
  data: unknown;
  /** The mock configuration used */
  config: MockConfig;
  /** Timestamp of generation */
  generatedAt: string;
  /** The original source (for reference) */
  source: string;
}

/**
 * Options for mock generation.
 */
export interface MockOptions {
  /** Seed for reproducible randomness: the same seed yields identical data. Omit for random output. */
  seed?: string | number;
  /** Anchor for relative dates (default: now; a fixed 2026-01-01 UTC epoch when `seed` is set, so seeded output stays reproducible) */
  referenceDate?: string | Date;
  /** Number of items to generate (for arrays). One call generates at most 50,000 values;
   *  past that, lists come out empty and other values null. */
  count?: number;
  /** Whether to include null/undefined values */
  includeNulls?: boolean;
  /** Date range for date fields */
  dateRange?: {
    min?: string | Date;
    max?: string | Date;
  };
  /** String formatting options */
  stringOptions?: {
    locale?: string;
    timezone?: string;
  };
  /** Number formatting options */
  numberOptions?: {
    locale?: string;
    precision?: number;
    currency?: string;
  };
}
