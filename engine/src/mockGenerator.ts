/**
 * Mockwave: Mock Data Generator
 *
 * Generates realistic mock data from a schema configuration.
 * All randomness flows from one seeded PRNG (mulberry32), so the same `seed`
 * always produces identical data; with no seed, the PRNG is seeded randomly.
 *
 * Pattern: Similar to how Rackwave generates audio node chains,
 * but for data structures instead of audio graphs.
 */

import type {
  MockConfig,
  MockDefinition,
  MockObjectDefinition,
  MockArrayDefinition,
  MockRecordDefinition,
  MockPrimitiveDefinition,
  MockOptions,
  GeneratedMock
} from './types';
import * as hints from './fieldHints';
import { classifyField, type FieldHint, type NumberHint, type DateHint } from './fieldHints';

/** A source of uniform randoms in [0, 1), like Math.random. */
export type Rng = () => number;

/** mulberry32: a tiny, fast, well-distributed 32-bit seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string/number seed to 32 bits (FNV-1a over its string form). */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** True when `seed` is a real seed (undefined, null and '' mean "no seed"). */
function hasSeed(seed: MockOptions['seed']): seed is string | number {
  return seed !== undefined && seed !== null && seed !== '';
}

/** A seeded PRNG for `seed`, or a randomly seeded one when no seed is given. */
export function createRng(seed?: string | number): Rng {
  return mulberry32(hasSeed(seed) ? hashSeed(seed) : (Math.random() * 4294967296) >>> 0);
}

/** Dates are anchored here when a seed is given (so seeded output never drifts with the clock). */
const SEEDED_EPOCH = Date.UTC(2026, 0, 1);

/** Everything a generation pass needs, threaded through every generator. */
interface GenContext {
  rng: Rng;
  options: MockOptions;
  /** Reference "now" in epoch ms for relative dates. */
  now: number;
}

/**
 * Generate mock data from a configuration.
 *
 * @param config - The mock configuration
 * @param options - Generation options (seed, count, etc.)
 * @returns Generated mock data
 */
export function generateMock(config: MockConfig, options: MockOptions = {}): GeneratedMock {
  const ref = options.referenceDate !== undefined ? new Date(options.referenceDate).getTime() : NaN;
  const ctx: GenContext = {
    rng: createRng(options.seed),
    options,
    now: Number.isFinite(ref) ? ref : hasSeed(options.seed) ? SEEDED_EPOCH : Date.now(),
  };
  const data = generateFromDefinition(config.root, ctx, 0);

  return {
    data,
    config,
    generatedAt: new Date().toISOString(),
    source: config.root.type, // TODO: Store actual source
  };
}

/**
 * Generate a mock value from a definition. `name` is the field (or list/map) name the
 * value lives under; it drives the field-name heuristics (see fieldHints.ts).
 */
function generateFromDefinition(definition: MockDefinition, ctx: GenContext, depth: number, name?: string): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return null;
  }

  switch (definition.type) {
    case 'object':
      return generateMockObject(definition as MockObjectDefinition, ctx, depth);
    case 'array':
      return generateMockArray(definition as MockArrayDefinition, ctx, depth, name);
    case 'record':
      return generateMockRecord(definition as MockRecordDefinition, ctx, depth, name);
    default:
      return generateMockPrimitive(definition as MockPrimitiveDefinition, ctx, name);
  }
}

/**
 * Generate a mock object from its definition.
 */
function generateMockObject(definition: MockObjectDefinition, ctx: GenContext, depth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  for (const [fieldName, propDef] of Object.entries(definition.properties)) {
    // Handle optional fields with probability
    const shouldInclude = propDef.optional
      ? (propDef.probability !== undefined
          ? ctx.rng() < propDef.probability
          : ctx.rng() < 0.8) // 80% chance to include optional fields
      : true;

    if (!shouldInclude) continue;

    // Use custom value if specified
    if (propDef.value !== undefined) {
      obj[fieldName] = propDef.value;
      continue;
    }

    obj[fieldName] = generateFromDefinition(propDef.mock, ctx, depth + 1, fieldName);
  }

  return obj;
}

/**
 * Generate a mock array from its definition. Items take the list's name, so
 * `emails: string[]` yields emails.
 */
function generateMockArray(definition: MockArrayDefinition, ctx: GenContext, depth: number, name?: string): unknown[] {
  const { options } = ctx;
  // Determine array length
  let length = 3; // Default

  if (definition.length !== undefined) {
    length = definition.length;
  } else if (options.count !== undefined) {
    length = options.count;
  } else if (definition.maxLength !== undefined) {
    length = Math.min(10, definition.maxLength);
  } else if (definition.minLength !== undefined) {
    length = Math.max(3, definition.minLength);
  }

  // Cap at 20 for safety
  length = Math.max(0, Math.min(length, 20));

  const arr: unknown[] = [];
  for (let i = 0; i < length; i++) {
    arr.push(generateFromDefinition(definition.itemType, ctx, depth + 1, name));
  }

  return arr;
}

/** Readable keys for generated maps (`Record<string, V>`). */
const RECORD_KEYS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];

/**
 * Generate a mock map: a few distinct keys, each with a generated value (named after the map).
 */
function generateMockRecord(definition: MockRecordDefinition, ctx: GenContext, depth: number, name?: string): Record<string, unknown> {
  const count = Math.max(0, Math.min(definition.keyCount ?? 3, 20));
  const keys: string[] = [];
  if (definition.keyType === 'number') {
    let next = Math.floor(ctx.rng() * 900) + 1;
    for (let i = 0; i < count; i++) keys.push(String(next += 1 + Math.floor(ctx.rng() * 50)));
  } else {
    const pool = [...RECORD_KEYS];
    for (let i = pool.length - 1; i > 0; i--) { // Fisher-Yates on the seeded stream
      const j = Math.floor(ctx.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < count; i++) keys.push(i < pool.length ? pool[i] : `key${i + 1}`);
  }
  const obj: Record<string, unknown> = {};
  for (const key of keys) obj[key] = generateFromDefinition(definition.valueType, ctx, depth + 1, name);
  return obj;
}

/**
 * Generate a mock primitive value from its definition. Precedence: an explicit
 * `default`, then `enum`, then the declared constraints (format, pattern, min/max),
 * then the field-name hint, then the source's example value, then a generic value.
 */
function generateMockPrimitive(definition: MockPrimitiveDefinition, ctx: GenContext, name?: string): unknown {
  const { rng } = ctx;
  // Use custom default if specified
  if (definition.default !== undefined) {
    return definition.default;
  }

  // Enumerated values: pick one
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return pick(rng, definition.enum);
  }

  const hint = name ? classifyField(name) : null;

  switch (definition.type) {
    case 'string':
      return generateMockString(definition, ctx, hint);
    case 'number':
      return generateMockNumber(definition, ctx, hint);
    case 'boolean':
      return rng() < 0.7; // 70% true
    case 'date':
      return generateDate(ctx, hint?.date);
    case 'null':
      return null;
    case 'any':
    default: {
      // Untyped: the name's natural type when it suggests one, else a random primitive
      if (hint) return generateMockPrimitive({ type: hint.natural }, ctx, name);
      const types = ['string', 'number', 'boolean'] as const;
      return generateMockPrimitive({ type: pick(rng, types) }, ctx);
    }
  }
}

/** Pick one element of a non-empty list. */
function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Generate a mock string value.
 */
function generateMockString(definition: MockPrimitiveDefinition, ctx: GenContext, hint: FieldHint | null = null): string {
  const { rng } = ctx;
  // Handle specific formats
  if (definition.format) {
    switch (definition.format) {
      case 'uuid':
        return hints.uuid(rng);
      case 'email':
        return hints.email(rng);
      case 'url':
      case 'uri':
        return hints.url(rng);
      case 'phone':
        return hints.phone(rng);
      case 'address':
        return hints.address(rng);
      case 'name':
        return hints.fullName(rng);
      case 'sentence':
        return hints.description(rng);
      case 'paragraph':
        return hints.paragraph(rng);
      case 'word':
        return hints.word(rng);
      case 'date':
        return generateDate(ctx, hint?.date).slice(0, 10);
      case 'date-time':
        return generateDate(ctx, hint?.date);
      default:
        // Unknown format, fall through to generic
        break;
    }
  }

  // Handle pattern
  if (definition.pattern) {
    try {
      return generateFromRegex(definition.pattern, ctx);
    } catch {
      // Invalid regex, fall through
    }
  }

  const fits = (s: string) =>
    (definition.minLength === undefined || s.length >= definition.minLength)
    && (definition.maxLength === undefined || s.length <= definition.maxLength);
  const example = typeof definition.example === 'string' ? definition.example : undefined;

  // Field-name hint (a weak one, like status/role, defers to the source's own example)
  if (hint) {
    let value: string | undefined;
    if (hint.date) value = generateDate(ctx, hint.date);
    else if (hint.string && !(hint.weak && example !== undefined)) value = hint.string(rng);
    else if (hint.number && !hint.string) value = String(generateMockNumber({ type: 'number' }, ctx, hint));
    if (value !== undefined && fits(value)) return value;
  }

  if (example !== undefined) return example;

  // Generic string: a few plain words, or random characters to meet length constraints
  const plain = hints.words(rng);
  if (fits(plain)) return plain;
  const maxLength = Math.max(definition.minLength ?? 0, definition.maxLength ?? 20);
  const minLength = Math.min(maxLength, definition.minLength ?? Math.min(5, maxLength));

  return generateRandomString(minLength, maxLength, rng);
}

/**
 * Generate a mock number value. Integers unless the definition says otherwise
 * (`integer: false`, a `precision`) or the field name suggests decimals (price,
 * rating, latitude); with no hint, a generation-wide `numberOptions.precision`
 * also asks for decimals.
 */
function generateMockNumber(definition: MockPrimitiveDefinition, ctx: GenContext, hint: FieldHint | null = null): number {
  const { rng, options } = ctx;
  const nh: NumberHint | undefined = hint?.number;

  // A date-ish name on a number field (createdAt: number): epoch milliseconds
  if (!nh && hint?.date && definition.minimum === undefined && definition.maximum === undefined) {
    return Date.parse(generateDate(ctx, hint.date));
  }

  const integer = definition.integer === true || (
    definition.integer === undefined
    && definition.precision === undefined
    && (nh ? nh.decimals === 0 : options.numberOptions?.precision === undefined)
  );

  // Range: declared bounds win, then the hint, then the example's magnitude, then 0-1000
  const example = typeof definition.example === 'number' && Number.isFinite(definition.example) ? definition.example : undefined;
  let lo: number;
  let hi: number;
  if (nh) {
    if (nh.yearsBack !== undefined) {
      hi = new Date(ctx.now).getUTCFullYear();
      lo = hi - nh.yearsBack;
    } else {
      lo = nh.min;
      hi = nh.max;
    }
  } else if (example !== undefined) {
    hi = Math.max(10, Math.abs(example) * 2);
    lo = example < 0 ? -hi : 0;
  } else {
    lo = 0;
    hi = 1000;
  }
  const width = Math.max(1, hi - lo);
  let min = definition.minimum ?? lo;
  let max = definition.maximum ?? hi;
  if (min > max) {
    if (definition.maximum === undefined) max = min + width;
    else if (definition.minimum === undefined) min = max - width;
    else [min, max] = [max, min];
  }

  if (integer) {
    const imin = Math.ceil(min);
    const imax = Math.floor(max);
    if (imin > imax) return imin;
    return Math.floor(rng() * (imax - imin + 1)) + imin;
  }

  // Decimal places: per-field, else generation-wide, else the hint's, else 2.
  // Clamped to [0, 15] (beyond 15 the factor overflows double precision; negatives/NaN would corrupt the value).
  const requested = definition.precision ?? options.numberOptions?.precision ?? nh?.decimals ?? 2;
  const places = Number.isFinite(requested) ? Math.min(15, Math.max(0, Math.round(requested))) : 2;
  const factor = 10 ** places;
  const value = Math.round((rng() * (max - min) + min) * factor) / factor;
  return Math.min(max, Math.max(min, value));
}

/**
 * Generate a random string of specified length.
 */
function generateRandomString(minLength: number, maxLength: number, rng: Rng = Math.random): string {
  const length = Math.floor(rng() * (maxLength - minLength + 1)) + minLength;
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(rng() * chars.length));
  }
  return result;
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Generate an ISO date string, relative to the context's reference "now": within the
 * last year by default, or in the hint's range (birthdays: 18-90 years back). An
 * explicit `dateRange` option wins over both.
 */
function generateDate(ctx: GenContext, hint?: DateHint): string {
  const { rng, options, now } = ctx;
  const year = new Date(now).getUTCFullYear();
  let time: number;

  if (options.dateRange) {
    const min = options.dateRange.min ? new Date(options.dateRange.min).getTime() : Date.UTC(year - 5, 0, 1);
    const max = options.dateRange.max ? new Date(options.dateRange.max).getTime() : Date.UTC(year + 1, 0, 1);
    time = min + rng() * (max - min);
  } else if (hint && (hint.minYearsAgo !== 0 || hint.maxYearsAgo !== 1)) {
    time = now - (hint.minYearsAgo + rng() * (hint.maxYearsAgo - hint.minYearsAgo)) * YEAR_MS;
  } else {
    // Random date in the year before the reference
    time = now - rng() * 365 * 24 * 60 * 60 * 1000;
  }

  return new Date(Math.floor(time)).toISOString();
}

/**
 * Generate a string from a regex pattern.
 */
function generateFromRegex(pattern: string, ctx: GenContext): string {
  // This is a simplified implementation
  // A full regex generator would be more complex

  // Handle common patterns
  if (/^\d+$/.test(pattern)) {
    return Math.floor(ctx.rng() * 10000).toString();
  }
  if (/^[a-zA-Z]+$/.test(pattern)) {
    return generateRandomString(1, 10, ctx.rng);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(pattern)) {
    // Date pattern
    return generateDate({ ...ctx, options: {} }).split('T')[0];
  }

  // Default: return a simple value
  return generateRandomString(5, 10, ctx.rng);
}

// Export for testing (each takes an optional Rng; default Math.random)
const withDefault = (make: (rng: Rng) => string) => (rng: Rng = Math.random) => make(rng);
export const generators = {
  uuid: withDefault(hints.uuid),
  email: withDefault(hints.email),
  url: withDefault(hints.url),
  phone: withDefault(hints.phone),
  address: withDefault(hints.address),
  name: withDefault(hints.fullName),
  sentence: withDefault(hints.description),
  paragraph: withDefault(hints.paragraph),
  word: withDefault(hints.word),
} as const;
