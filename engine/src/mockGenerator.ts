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
  const data = generateFromDefinition(config.root, ctx);

  return {
    data,
    config,
    generatedAt: new Date().toISOString(),
    source: config.root.type, // TODO: Store actual source
  };
}

/**
 * Generate a mock value from a definition.
 */
function generateFromDefinition(definition: MockDefinition, ctx: GenContext, depth: number = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return null;
  }

  switch (definition.type) {
    case 'object':
      return generateMockObject(definition as MockObjectDefinition, ctx, depth);
    case 'array':
      return generateMockArray(definition as MockArrayDefinition, ctx, depth);
    case 'record':
      return generateMockRecord(definition as MockRecordDefinition, ctx, depth);
    default:
      return generateMockPrimitive(definition as MockPrimitiveDefinition, ctx);
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

    // Generate from the mock definition
    const value = generateFromDefinition(propDef.mock, ctx, depth + 1);

    // Handle special field names
    let finalValue = value;

    // For 'id' fields, generate a UUID by default
    if (fieldName.toLowerCase().includes('id') && typeof finalValue === 'string' && !finalValue) {
      finalValue = generateUUID(ctx.rng);
    }

    // For 'createdAt', 'updatedAt', 'date', 'timestamp' fields, generate a date
    if (/created|updated|date|timestamp/i.test(fieldName) && (typeof finalValue === 'string' && !finalValue)) {
      finalValue = generateDate(ctx);
    }

    obj[fieldName] = finalValue;
  }

  return obj;
}

/**
 * Generate a mock array from its definition.
 */
function generateMockArray(definition: MockArrayDefinition, ctx: GenContext, depth: number): unknown[] {
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
    arr.push(generateFromDefinition(definition.itemType, ctx, depth + 1));
  }

  return arr;
}

/** Readable keys for generated maps (`Record<string, V>`). */
const RECORD_KEYS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];

/**
 * Generate a mock map: a few distinct keys, each with a generated value.
 */
function generateMockRecord(definition: MockRecordDefinition, ctx: GenContext, depth: number): Record<string, unknown> {
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
  for (const key of keys) obj[key] = generateFromDefinition(definition.valueType, ctx, depth + 1);
  return obj;
}

/**
 * Generate a mock primitive value from its definition.
 */
function generateMockPrimitive(definition: MockPrimitiveDefinition, ctx: GenContext): unknown {
  const { rng } = ctx;
  // Use custom default if specified
  if (definition.default !== undefined) {
    return definition.default;
  }

  // Enumerated values: pick one
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return pick(rng, definition.enum);
  }

  switch (definition.type) {
    case 'string':
      return generateMockString(definition, ctx);
    case 'number':
      return generateMockNumber(definition, ctx);
    case 'boolean':
      return rng() < 0.7; // 70% true
    case 'date':
      return generateDate(ctx);
    case 'null':
      return null;
    case 'any':
    default: {
      // Random primitive type
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
function generateMockString(definition: MockPrimitiveDefinition, ctx: GenContext): string {
  const { rng } = ctx;
  // Handle specific formats
  if (definition.format) {
    switch (definition.format) {
      case 'uuid':
        return generateUUID(rng);
      case 'email':
        return generateEmail(rng);
      case 'url':
      case 'uri':
        return generateUrl(rng);
      case 'phone':
        return generatePhone(rng);
      case 'address':
        return generateAddress(rng);
      case 'name':
        return generateName(rng);
      case 'sentence':
        return generateSentence(rng);
      case 'paragraph':
        return generateParagraph(rng);
      case 'word':
        return generateWord(rng);
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

  // Generic string based on constraints
  const minLength = definition.minLength || 5;
  const maxLength = Math.max(minLength, definition.maxLength || 20);

  return generateRandomString(minLength, maxLength, rng);
}

/**
 * Generate a mock number value.
 */
function generateMockNumber(definition: MockPrimitiveDefinition, ctx: GenContext): number {
  const { rng, options } = ctx;
  let value: number;

  if (definition.integer) {
    const min = definition.minimum !== undefined ? Math.ceil(definition.minimum) : 0;
    const max = definition.maximum !== undefined ? Math.floor(definition.maximum) : 1000;
    value = Math.floor(rng() * (max - min + 1)) + min;
  } else {
    const min = definition.minimum !== undefined ? definition.minimum : 0;
    const max = definition.maximum !== undefined ? definition.maximum : 1000;
    value = rng() * (max - min) + min;
  }

  // Round non-integers to the requested decimal places: per-field, else the
  // generation-wide numberOptions.precision, else 2. Clamped to [0, 15] (beyond 15
  // the factor overflows double precision; negatives/NaN would corrupt the value).
  if (!definition.integer) {
    const requested = definition.precision ?? options.numberOptions?.precision ?? 2;
    const places = Number.isFinite(requested) ? Math.min(15, Math.max(0, Math.round(requested))) : 2;
    const factor = 10 ** places;
    value = Math.round(value * factor) / factor;
  }

  return value;
}

/**
 * Generate a random UUID (v4 layout).
 */
function generateUUID(rng: Rng = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (rng() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a random email address.
 */
function generateEmail(rng: Rng = Math.random): string {
  const local = generateRandomString(5, 10, rng);
  const domain = generateRandomString(5, 8, rng);
  const tld = pick(rng, ['com', 'net', 'org', 'io', 'dev']);
  return `${local}@${domain}.${tld}`;
}

/**
 * Generate a random URL.
 */
function generateUrl(rng: Rng = Math.random): string {
  const protocol = pick(rng, ['https://', 'http://']);
  const domain = generateRandomString(5, 12, rng);
  const tld = pick(rng, ['com', 'net', 'org', 'io']);
  const path = `/${generateRandomString(3, 8, rng)}/${generateRandomString(3, 8, rng)}`;
  return `${protocol}${domain}.${tld}${path}`;
}

/**
 * Generate a random phone number.
 */
function generatePhone(rng: Rng = Math.random): string {
  const format = pick(rng, ['XXX-XXX-XXXX', '(XXX) XXX-XXXX', '+1-XXX-XXX-XXXX']);
  return format.replace(/X/g, () => Math.floor(rng() * 10).toString());
}

/**
 * Generate a random address.
 */
function generateAddress(rng: Rng = Math.random): string {
  const streets = ['Main St', 'Oak Ave', 'Pine Rd', 'Elm Blvd', 'Maple Ln'];
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Austin', 'Denver'];
  const states = ['CA', 'NY', 'TX', 'CO', 'IL'];
  const zip = Math.floor(10000 + rng() * 90000).toString();

  const streetNum = Math.floor(1 + rng() * 9999);
  const street = pick(rng, streets);
  const city = pick(rng, cities);
  const state = pick(rng, states);

  return `${streetNum} ${street}, ${city}, ${state} ${zip}`;
}

/**
 * Generate a random name.
 */
function generateName(rng: Rng = Math.random): string {
  const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
  return `${pick(rng, firstNames)} ${pick(rng, lastNames)}`;
}

/**
 * Generate a random sentence.
 */
function generateSentence(rng: Rng = Math.random): string {
  const subject = pick(rng, ['The user', 'A system', 'This application', 'Our service']);
  const verb = pick(rng, ['creates', 'manages', 'processes', 'stores']);
  const adjective = pick(rng, ['efficient', 'reliable', 'scalable', 'secure']);
  const object = pick(rng, ['data', 'requests', 'information', 'records']);

  return `${subject} ${verb} ${adjective} ${object}.`;
}

/**
 * Generate a random paragraph.
 */
function generateParagraph(rng: Rng = Math.random): string {
  const sentences = [];
  const count = Math.floor(3 + rng() * 3); // 3-5 sentences
  for (let i = 0; i < count; i++) {
    sentences.push(generateSentence(rng));
  }
  return sentences.join(' ');
}

/**
 * Generate a random word.
 */
function generateWord(rng: Rng = Math.random): string {
  return pick(rng, ['data', 'system', 'user', 'application', 'service', 'request', 'response', 'value']);
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

/**
 * Generate a date string, relative to the context's reference "now".
 */
function generateDate(ctx: GenContext): string {
  const { rng, options, now } = ctx;
  const year = new Date(now).getUTCFullYear();
  let time: number;

  if (options.dateRange) {
    const min = options.dateRange.min ? new Date(options.dateRange.min).getTime() : Date.UTC(year - 5, 0, 1);
    const max = options.dateRange.max ? new Date(options.dateRange.max).getTime() : Date.UTC(year + 1, 0, 1);
    time = min + rng() * (max - min);
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
export const generators = {
  uuid: generateUUID,
  email: generateEmail,
  url: generateUrl,
  phone: generatePhone,
  address: generateAddress,
  name: generateName,
  sentence: generateSentence,
  paragraph: generateParagraph,
  word: generateWord,
} as const;
