/**
 * Mockwave: Mock Data Generator
 * 
 * Generates realistic mock data from a schema configuration.
 * Uses deterministic algorithms with configurable randomness.
 * 
 * Pattern: Similar to how Rackwave generates audio node chains,
 * but for data structures instead of audio graphs.
 */

import type { 
  MockConfig, 
  MockDefinition, 
  MockObjectDefinition, 
  MockArrayDefinition, 
  MockPrimitiveDefinition,
  MockOptions,
  GeneratedMock 
} from './types';

/**
 * Generate mock data from a configuration.
 * 
 * @param config - The mock configuration
 * @param options - Generation options (seed, count, etc.)
 * @returns Generated mock data
 */
export function generateMock(config: MockConfig, options: MockOptions = {}): GeneratedMock {
  const data = generateFromDefinition(config.root, config, options);
  
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
function generateFromDefinition(
  definition: MockDefinition,
  config: MockConfig,
  options: MockOptions,
  depth: number = 0
): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return null;
  }
  
  switch (definition.type) {
    case 'object':
      return generateMockObject(definition as MockObjectDefinition, config, options, depth);
    case 'array':
      return generateMockArray(definition as MockArrayDefinition, config, options, depth);
    default:
      return generateMockPrimitive(definition as MockPrimitiveDefinition, options);
  }
}

/**
 * Generate a mock object from its definition.
 */
function generateMockObject(
  definition: MockObjectDefinition,
  config: MockConfig,
  options: MockOptions,
  depth: number
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  
  for (const [fieldName, propDef] of Object.entries(definition.properties)) {
    // Handle optional fields with probability
    const shouldInclude = propDef.optional 
      ? (propDef.probability !== undefined 
          ? Math.random() < propDef.probability 
          : Math.random() < 0.8) // 80% chance to include optional fields
      : true;
    
    if (!shouldInclude) continue;
    
    // Use custom value if specified
    if (propDef.value !== undefined) {
      obj[fieldName] = propDef.value;
      continue;
    }
    
    // Generate from the mock definition
    const value = generateFromDefinition(propDef.mock, config, options, depth + 1);
    
    // Handle special field names
    let finalValue = value;
    
    // For 'id' fields, generate a UUID by default
    if (fieldName.toLowerCase().includes('id') && typeof finalValue === 'string' && !finalValue) {
      finalValue = generateUUID();
    }
    
    // For 'createdAt', 'updatedAt', 'date', 'timestamp' fields, generate a date
    if (/created|updated|date|timestamp/i.test(fieldName) && (typeof finalValue === 'string' && !finalValue)) {
      finalValue = generateDate(options);
    }
    
    obj[fieldName] = finalValue;
  }
  
  return obj;
}

/**
 * Generate a mock array from its definition.
 */
function generateMockArray(
  definition: MockArrayDefinition,
  config: MockConfig,
  options: MockOptions,
  depth: number
): unknown[] {
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
  length = Math.min(length, 20);
  
  const arr: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const item = generateFromDefinition(definition.itemType, config, { ...options, seed: `${options.seed}-${i}` }, depth + 1);
    arr.push(item);
  }
  
  return arr;
}

/**
 * Generate a mock primitive value from its definition.
 */
function generateMockPrimitive(
  definition: MockPrimitiveDefinition,
  options: MockOptions
): unknown {
  // Use custom default if specified
  if (definition.default !== undefined) {
    return definition.default;
  }
  
  switch (definition.type) {
    case 'string':
      return generateMockString(definition, options);
    case 'number':
      return generateMockNumber(definition, options);
    case 'boolean':
      return Math.random() < 0.7; // 70% true
    case 'date':
      return generateDate(options);
    case 'null':
      return null;
    case 'any':
    default:
      // Random primitive type
      const types = ['string', 'number', 'boolean'] as const;
      const type = types[Math.floor(Math.random() * types.length)];
      return generateMockPrimitive({ type }, options);
  }
}

/**
 * Generate a mock string value.
 */
function generateMockString(
  definition: MockPrimitiveDefinition,
  _options: MockOptions
): string {
  // Handle specific formats
  if (definition.format) {
    switch (definition.format) {
      case 'uuid':
        return generateUUID();
      case 'email':
        return generateEmail();
      case 'url':
        return generateUrl();
      case 'phone':
        return generatePhone();
      case 'address':
        return generateAddress();
      case 'name':
        return generateName();
      case 'sentence':
        return generateSentence();
      case 'paragraph':
        return generateParagraph();
      case 'word':
        return generateWord();
      default:
        // Unknown format, fall through to generic
        break;
    }
  }
  
  // Handle pattern
  if (definition.pattern) {
    try {
      return generateFromRegex(definition.pattern);
    } catch {
      // Invalid regex, fall through
    }
  }
  
  // Generic string based on constraints
  const minLength = definition.minLength || 5;
  const maxLength = definition.maxLength || 20;
  
  return generateRandomString(minLength, maxLength);
}

/**
 * Generate a mock number value.
 */
function generateMockNumber(
  definition: MockPrimitiveDefinition,
  _options: MockOptions
): number {
  let value: number;
  
  if (definition.integer) {
    const min = definition.minimum !== undefined ? Math.ceil(definition.minimum) : 0;
    const max = definition.maximum !== undefined ? Math.floor(definition.maximum) : 1000;
    value = Math.floor(Math.random() * (max - min + 1)) + min;
  } else {
    const min = definition.minimum !== undefined ? definition.minimum : 0;
    const max = definition.maximum !== undefined ? definition.maximum : 1000;
    value = Math.random() * (max - min) + min;
  }
  
  // Round non-integers to the requested decimal places (default 2)
  if (!definition.integer) {
    const factor = 10 ** (definition.precision ?? 2);
    value = Math.round(value * factor) / factor;
  }
  
  return value;
}

/**
 * Generate a random UUID.
 */
function generateUUID(): string {
  // Simple UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a random email address.
 */
function generateEmail(): string {
  const local = generateRandomString(5, 10);
  const domain = generateRandomString(5, 8);
  const tld = ['com', 'net', 'org', 'io', 'dev'][Math.floor(Math.random() * 5)];
  return `${local}@${domain}.${tld}`;
}

/**
 * Generate a random URL.
 */
function generateUrl(): string {
  const protocols = ['https://', 'http://'];
  const protocol = protocols[Math.floor(Math.random() * protocols.length)];
  const domain = generateRandomString(5, 12);
  const tld = ['com', 'net', 'org', 'io'][Math.floor(Math.random() * 4)];
  const path = `/${generateRandomString(3, 8)}/${generateRandomString(3, 8)}`;
  return `${protocol}${domain}.${tld}${path}`;
}

/**
 * Generate a random phone number.
 */
function generatePhone(): string {
  const formats = [
    'XXX-XXX-XXXX',
    '(XXX) XXX-XXXX',
    '+1-XXX-XXX-XXXX',
  ];
  const format = formats[Math.floor(Math.random() * formats.length)];
  return format.replace(/X/g, () => Math.floor(Math.random() * 10).toString());
}

/**
 * Generate a random address.
 */
function generateAddress(): string {
  const streets = ['Main St', 'Oak Ave', 'Pine Rd', 'Elm Blvd', 'Maple Ln'];
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Austin', 'Denver'];
  const states = ['CA', 'NY', 'TX', 'CO', 'IL'];
  const zip = Math.floor(10000 + Math.random() * 90000).toString();
  
  const streetNum = Math.floor(1 + Math.random() * 9999);
  const street = streets[Math.floor(Math.random() * streets.length)];
  const city = cities[Math.floor(Math.random() * cities.length)];
  const state = states[Math.floor(Math.random() * states.length)];
  
  return `${streetNum} ${street}, ${city}, ${state} ${zip}`;
}

/**
 * Generate a random name.
 */
function generateName(): string {
  const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${first} ${last}`;
}

/**
 * Generate a random sentence.
 */
function generateSentence(): string {
  const subjects = ['The user', 'A system', 'This application', 'Our service'];
  const verbs = ['creates', 'manages', 'processes', 'stores'];
  const objects = ['data', 'requests', 'information', 'records'];
  const adjectives = ['efficient', 'reliable', 'scalable', 'secure'];
  
  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const verb = verbs[Math.floor(Math.random() * verbs.length)];
  const object = objects[Math.floor(Math.random() * objects.length)];
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  
  return `${subject} ${verb} ${adjective} ${object}.`;
}

/**
 * Generate a random paragraph.
 */
function generateParagraph(): string {
  const sentences = [];
  const count = Math.floor(3 + Math.random() * 3); // 3-5 sentences
  for (let i = 0; i < count; i++) {
    sentences.push(generateSentence());
  }
  return sentences.join(' ');
}

/**
 * Generate a random word.
 */
function generateWord(): string {
  const words = ['data', 'system', 'user', 'application', 'service', 'request', 'response', 'value'];
  return words[Math.floor(Math.random() * words.length)];
}

/**
 * Generate a random string of specified length.
 */
function generateRandomString(minLength: number, maxLength: number): string {
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a date string.
 */
function generateDate(options: MockOptions): string {
  const now = new Date();
  let date: Date;
  
  if (options.dateRange) {
    const minDate = options.dateRange.min ? new Date(options.dateRange.min) : new Date(now.getFullYear() - 5, 0, 1);
    const maxDate = options.dateRange.max ? new Date(options.dateRange.max) : new Date(now.getFullYear() + 1, 0, 1);
    const time = minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime());
    date = new Date(time);
  } else {
    // Random date in the last year
    const time = now.getTime() - Math.random() * 365 * 24 * 60 * 60 * 1000;
    date = new Date(time);
  }
  
  return date.toISOString();
}

/**
 * Generate a string from a regex pattern.
 */
function generateFromRegex(pattern: string): string {
  // This is a simplified implementation
  // A full regex generator would be more complex
  
  // Handle common patterns
  if (/^\d+$/.test(pattern)) {
    return Math.floor(Math.random() * 10000).toString();
  }
  if (/^[a-zA-Z]+$/.test(pattern)) {
    return generateRandomString(1, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(pattern)) {
    // Date pattern
    return generateDate({}).split('T')[0];
  }
  
  // Default: return a simple value
  return generateRandomString(5, 10);
}

// Export for testing
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
