/**
 * Mockwave: Field-Name Heuristics
 *
 * Realistic values from a field's NAME, shared by every import format (TypeScript,
 * JSON Schema, sample JSON, GraphQL). `classifyField('createdAt')` says "an ISO
 * date"; `classifyField('price')` says "money with 2 decimals". The generator then
 * fits the hint to the field's declared type (a `string` id gets a uuid, a `number`
 * id an integer). Everything draws from the caller's seeded Rng, so seeded output
 * stays identical. Word lists are small and built in (no runtime dependency); the
 * people names are common first and last names only, and every email, URL, phone
 * and IP uses reserved example/documentation ranges.
 */

import type { Rng } from './mockGenerator';

/** A number range; `decimals` 0 means integers. `yearsBack` makes it a year range ending at the reference year. */
export interface NumberHint {
  min: number;
  max: number;
  decimals: number;
  yearsBack?: number;
}

/** A date range in years before the reference date (default: within the last year; negative = ahead of it). */
export interface DateHint {
  minYearsAgo: number;
  maxYearsAgo: number;
}

/** What a field name suggests. The generator uses the form matching the declared type. */
export interface FieldHint {
  /** The value's natural type, used when the declared type doesn't say (`any`, `unknown`, a JSON scalar). */
  natural: 'string' | 'number' | 'boolean' | 'date';
  /** A string value for `string` fields. */
  string?: (rng: Rng) => string;
  /** A numeric range for `number` fields (and the natural form of numeric hints). */
  number?: NumberHint;
  /** A date range: ISO strings for `string`/`date` fields, epoch ms for `number` fields. */
  date?: DateHint;
  /** A guess at a domain value (status, role, category): a sample value from the source wins over it. */
  weak?: boolean;
}

// -- Word lists -------------------------------------------------------------

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth',
  'William', 'Susan', 'Daniel', 'Sarah', 'Maria', 'Carlos', 'Wei', 'Aisha', 'Priya', 'Omar', 'Sofia', 'Lucas',
];
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Lopez', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson', 'Lee', 'Patel', 'Nguyen', 'Kim', 'Clark', 'Hall',
];
const CITIES = ['Austin', 'Denver', 'Portland', 'Chicago', 'Boston', 'Seattle', 'Atlanta', 'Nashville', 'Madison', 'Toronto', 'Dublin', 'Lisbon', 'Melbourne', 'Osaka'];
const COUNTRIES: Array<[string, string]> = [
  ['United States', 'US'], ['Canada', 'CA'], ['Mexico', 'MX'], ['United Kingdom', 'GB'], ['Ireland', 'IE'], ['Germany', 'DE'],
  ['France', 'FR'], ['Spain', 'ES'], ['Portugal', 'PT'], ['Japan', 'JP'], ['Australia', 'AU'], ['Brazil', 'BR'], ['India', 'IN'],
];
const STATES = ['CA', 'NY', 'TX', 'CO', 'IL', 'WA', 'OR', 'MA', 'GA', 'IA'];
const STREETS = ['Main St', 'Oak Ave', 'Pine Rd', 'Elm St', 'Maple Ln', 'Cedar Dr', 'Lakeview Rd', 'Park Ave', 'River Rd', 'Hill St'];
const COMPANY_HEADS = ['Northwind', 'Bluebird', 'Summit', 'Cedar', 'Harborline', 'Brightline', 'Ironwood', 'Lumen', 'Granite', 'Willow', 'Riverstone', 'Silverleaf'];
const COMPANY_TAILS = ['Labs', 'Studio', 'Co.', 'Systems', 'Partners', 'Works', 'Group', 'Collective'];
const TITLE_ADJECTIVES = ['Quiet', 'Bright', 'Golden', 'Hidden', 'Simple', 'Modern', 'Wild', 'Gentle', 'Bold', 'Early', 'Open', 'Silver'];
const TITLE_NOUNS = ['Harbor', 'Garden', 'Journey', 'Signal', 'Morning', 'Field', 'Bridge', 'Pattern', 'Window', 'River', 'Season', 'Kitchen'];
const TITLE_TAILS = ['', '', ' Guide', ' Notes', ' Handbook', ' Report'];
const DESCRIPTIONS = [
  'A lightweight option for everyday use.',
  'Designed to be simple, durable, and easy to maintain.',
  'Perfect for small teams getting started.',
  'Includes everything you need to get going.',
  'Updated regularly with new features and fixes.',
  'Built for speed without the clutter.',
  'A reliable choice that works out of the box.',
  'Thoughtfully made with recycled materials.',
];
const BIOS = [
  'Coffee lover and weekend hiker.',
  'Builds small tools that make work easier.',
  'Writes about design, food, and travel.',
  'Lifelong learner with a soft spot for maps.',
  'Runs on tea, music, and good questions.',
  'Plays guitar badly and cooks well.',
  'Gardener, reader, and occasional baker.',
];
const WORDS = [
  'amber', 'birch', 'cobalt', 'delta', 'ember', 'falcon', 'granite', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen',
  'meadow', 'nova', 'onyx', 'prairie', 'quartz', 'river', 'sable', 'tundra', 'umber', 'violet', 'willow', 'zephyr',
];
const STATUSES = ['active', 'pending', 'inactive', 'archived'];
const ROLES = ['admin', 'editor', 'viewer', 'member'];
const CATEGORIES = ['general', 'travel', 'food', 'design', 'finance', 'health', 'outdoors'];
const TAGS = ['featured', 'new', 'popular', 'sale', 'seasonal', 'limited', 'classic'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD'];
const LOCALES = ['en-US', 'en-GB', 'es-MX', 'fr-FR', 'de-DE', 'ja-JP'];
const LANGUAGES = ['en', 'es', 'fr', 'de', 'ja', 'pt'];
const TIMEZONES = ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'];
const FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'csv', 'txt', 'docx'];
const AREA_CODES = ['312', '415', '512', '617', '720', '206', '319'];
const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];

// -- Value makers (all draw from the given Rng) -------------------------------

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => int(rng, 0, 9)).join('');
const hex = (rng: Rng, n: number) => Array.from({ length: n }, () => int(rng, 0, 15).toString(16)).join('');

export const firstName = (rng: Rng) => pick(rng, FIRST_NAMES);
export const lastName = (rng: Rng) => pick(rng, LAST_NAMES);
export const fullName = (rng: Rng) => `${firstName(rng)} ${lastName(rng)}`;
export const username = (rng: Rng) => `${firstName(rng)[0]}${lastName(rng)}${int(rng, 1, 99)}`.toLowerCase();
export const email = (rng: Rng) => `${firstName(rng)}.${lastName(rng)}@${pick(rng, EMAIL_DOMAINS)}`.toLowerCase();
export const phone = (rng: Rng) => `+1-${pick(rng, AREA_CODES)}-555-01${digits(rng, 2)}`; // 555-01xx: reserved for fiction
export const url = (rng: Rng) => `https://www.example.com/${pick(rng, WORDS)}/${pick(rng, WORDS)}`;
export const website = (rng: Rng) => `https://${pick(rng, WORDS)}.example.com`;
export const imageUrl = (rng: Rng) => `https://images.example.com/${hex(rng, 12)}.jpg`;
export const avatarUrl = (rng: Rng) => `https://images.example.com/avatars/${hex(rng, 12)}.png`;
export const city = (rng: Rng) => pick(rng, CITIES);
export const country = (rng: Rng) => pick(rng, COUNTRIES)[0];
export const countryCode = (rng: Rng) => pick(rng, COUNTRIES)[1];
export const stateCode = (rng: Rng) => pick(rng, STATES);
export const zip = (rng: Rng) => digits(rng, 5).replace(/^0/, '1');
export const streetAddress = (rng: Rng) => `${int(rng, 1, 9999)} ${pick(rng, STREETS)}`;
export const address = (rng: Rng) => `${streetAddress(rng)}, ${city(rng)}, ${stateCode(rng)} ${zip(rng)}`;
export const company = (rng: Rng) => `${pick(rng, COMPANY_HEADS)} ${pick(rng, COMPANY_TAILS)}`;
export const title = (rng: Rng) => `${pick(rng, TITLE_ADJECTIVES)} ${pick(rng, TITLE_NOUNS)}${pick(rng, TITLE_TAILS)}`;
export const description = (rng: Rng) => pick(rng, DESCRIPTIONS);
export const bio = (rng: Rng) => pick(rng, BIOS);
export const paragraph = (rng: Rng) => {
  const pool = [...DESCRIPTIONS];
  return Array.from({ length: int(rng, 2, 3) }, () => pool.splice(Math.floor(rng() * pool.length), 1)[0]).join(' ');
};
export const word = (rng: Rng) => pick(rng, WORDS);
export const words = (rng: Rng) => Array.from({ length: int(rng, 1, 3) }, () => pick(rng, WORDS)).join(' ');
export const slug = (rng: Rng) => Array.from({ length: 3 }, () => pick(rng, WORDS)).join('-');
export const ipAddress = (rng: Rng) => `${pick(rng, ['192.0.2', '198.51.100', '203.0.113'])}.${int(rng, 1, 254)}`; // documentation ranges
export const color = (rng: Rng) => `#${hex(rng, 6)}`;
export const fileName = (rng: Rng) => `${pick(rng, WORDS)}-${pick(rng, WORDS)}.${pick(rng, FILE_EXTENSIONS)}`;
export const password = (rng: Rng) => {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  return Array.from({ length: int(rng, 12, 16) }, () => chars[Math.floor(rng() * chars.length)]).join('');
};
export const token = (rng: Rng) => hex(rng, 32);
export const version = (rng: Rng) => `${int(rng, 1, 3)}.${int(rng, 0, 9)}.${int(rng, 0, 20)}`;
export const sku = (rng: Rng) => `SKU-${digits(rng, 5)}`;

// -- Classification -----------------------------------------------------------

/** Split a field name into lowercase words: `createdAt` -> created, at; `user_ID` -> user, id. */
export function fieldTokens(name: string): string[] {
  return (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((t) => t.toLowerCase());
}

/** Naive singular, enough for field names (emails -> email, cities -> city, addresses -> address). */
const SHORT_PLURALS: Record<string, string> = { ids: 'id', ips: 'ip', urls: 'url', uris: 'uri', tags: 'tag' };

function singular(t: string): string {
  if (SHORT_PLURALS[t]) return SHORT_PLURALS[t];
  if (t.length <= 3) return t;
  if (t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(t)) return t;
  if (/(sses|uses|xes|ches|shes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

const str = (make: (rng: Rng) => string, weak = false): FieldHint => ({ natural: 'string', string: make, ...(weak ? { weak } : {}) });
const num = (min: number, max: number, decimals = 0, extra: Partial<NumberHint> = {}): FieldHint => ({ natural: 'number', number: { min, max, decimals, ...extra } });
const listOf = (list: readonly string[]) => (rng: Rng) => pick(rng, list);

const BOOLEAN_PREFIXES = new Set(['is', 'has', 'can', 'should', 'was', 'did', 'will', 'allow', 'allows', 'needs', 'show', 'enable']);
const BOOLEAN_WORDS = new Set(['active', 'enabled', 'disabled', 'verified', 'deleted', 'archived', 'visible', 'hidden', 'confirmed', 'completed', 'done']);
const TIME_STARTS = new Set(['start', 'end', 'begin', 'finish', 'arrival', 'departure', 'pickup', 'delivery', 'open', 'close', 'due', 'last', 'login', 'logout', 'event']);
/** Dates that lie ahead (expiresAt, dueDate, renewalDate): within the next year. */
const FUTURE_WORDS = new Set(['expire', 'expires', 'expiry', 'expiration', 'due', 'renewal', 'renews', 'deadline', 'scheduled', 'upcoming', 'next']);
const PERSON_NAME_PREFIXES = new Set(['full', 'display', 'contact', 'author', 'customer', 'person', 'owner', 'legal', 'real', 'nick']);
const IMAGE_WORDS = ['avatar', 'image', 'photo', 'picture', 'thumbnail', 'logo', 'icon', 'banner', 'img'];
const PHONE_WORDS = ['phone', 'mobile', 'tel', 'telephone', 'fax', 'cell'];
const COMPANY_WORDS = ['company', 'organization', 'organisation', 'employer', 'business', 'vendor', 'publisher', 'brand'];
const PLACE_CONTEXT = ['home', 'billing', 'shipping', 'mailing', 'address', 'province', 'region'];
const MONEY = new Set(['price', 'amount', 'cost', 'fee', 'balance', 'subtotal', 'tax', 'discount', 'payment', 'charge', 'refund', 'tip']);
const BIG_MONEY = new Set(['salary', 'income', 'revenue', 'budget', 'wage']);
const SMALL_COUNTS = new Set(['count', 'quantity', 'qty', 'total']);
const BIG_COUNTS = new Set(['view', 'like', 'follower', 'click', 'download', 'visit', 'share', 'subscriber']);
const ORDINALS = new Set(['level', 'rank', 'priority', 'position', 'order', 'index', 'step', 'page', 'sequence']);

/**
 * What a field name suggests, or null when it suggests nothing in particular.
 * Matching is word-based (camelCase/snake_case/kebab-case, plurals folded, trailing
 * digits ignored) and mostly keys on the LAST word, so `paid`/`valid` never look like
 * ids, `ipAddress` is an IP rather than a street, and `commentCount` is a count.
 */
export function classifyField(name: string): FieldHint | null {
  let tokens = fieldTokens(name).map(singular);
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  if (words.length > 0) tokens = words;
  if (tokens.length === 0) return null;
  const has = (...w: string[]) => w.some((x) => tokens.includes(x));
  const head = tokens[tokens.length - 1];
  const prev = tokens.length > 1 ? tokens[tokens.length - 2] : '';
  const first = tokens[0];
  const lone = tokens.length === 1;
  const isHead = (...w: string[]) => w.includes(head);

  // Booleans: isX, hasX, canX, ... (and a few bare adjectives)
  if (!lone && BOOLEAN_PREFIXES.has(first)) return { natural: 'boolean' };
  if (lone && BOOLEAN_WORDS.has(head)) return { natural: 'boolean' };

  // Dates: birthdays 18-90 years back; createdAt, *At, *Date, *Timestamp, createdOn, startTime
  if (isHead('dob', 'birthday', 'birthdate') || (has('birth') && isHead('birth', 'date', 'day'))) {
    return { natural: 'date', date: { minYearsAgo: 18, maxYearsAgo: 90 } };
  }
  if (
    isHead('at', 'date', 'timestamp', 'datetime')
    || (head === 'on' && prev.endsWith('ed'))
    || (head === 'time' && (prev.endsWith('ed') || TIME_STARTS.has(prev)))
  ) {
    const future = tokens.some((t) => FUTURE_WORDS.has(t));
    return { natural: 'date', date: future ? { minYearsAgo: -1, maxYearsAgo: 0 } : { minYearsAgo: 0, maxYearsAgo: 1 } };
  }
  if (head === 'deadline') return { natural: 'date', date: { minYearsAgo: -1, maxYearsAgo: 0 } };
  if (head === 'timezone' || (head === 'zone' && prev === 'time')) return str(listOf(TIMEZONES));

  // Identifiers: id, uuid, guid, *Id, *_id
  if (isHead('id', 'uuid', 'guid')) return { natural: 'string', string: uuid, number: { min: 1, max: 99999, decimals: 0 } };

  // Contact + web
  if (has('email') && isHead('email', 'address')) return str(email);
  if (has(...PHONE_WORDS) && isHead(...PHONE_WORDS, 'number')) return str(phone);
  if (has(...IMAGE_WORDS) && isHead(...IMAGE_WORDS, 'url', 'uri', 'src', 'link', 'href')) return str(has('avatar') ? avatarUrl : imageUrl);
  if (isHead('website', 'homepage', 'site')) return str(website);
  if (isHead('url', 'uri', 'link', 'href')) return str(url);
  if (head === 'ip' || (has('ip') && head === 'address')) return str(ipAddress);

  // People
  if (head === 'username' || (head === 'name' && first === 'user') || isHead('handle', 'login', 'nickname')) return str(username);
  if (head === 'firstname' || (head === 'name' && has('first', 'given', 'middle'))) return str(firstName);
  if (isHead('lastname', 'surname') || (head === 'name' && has('last', 'family', 'sur'))) return str(lastName);
  if (head === 'fullname') return str(fullName);

  // Places
  if (isHead('zip', 'zipcode', 'postcode') || (has('postal', 'zip') && head === 'code')) {
    return { natural: 'string', string: zip, number: { min: 10000, max: 99999, decimals: 0 } };
  }
  if (isHead('lat', 'latitude')) return num(-90, 90, 6);
  if (isHead('lng', 'lon', 'longitude')) return num(-180, 180, 6);
  if (has('country') && isHead('code', 'iso')) return str(countryCode);
  if (has('country') && isHead('country', 'name')) return str(country);
  if (isHead('city', 'town') || (has('city') && head === 'name')) return str(city);
  if (isHead('province', 'region') || (head === 'state' && has(...PLACE_CONTEXT))) return str(stateCode);
  if (head === 'street' || (has('address', 'street') && head === 'line')) return str(streetAddress);
  if (head === 'address') return str(address);

  // Organizations
  if (isHead(...COMPANY_WORDS) || (has(...COMPANY_WORDS) && head === 'name') || (lone && head === 'org')) return str(company);

  // Names (after places/companies, so cityName/companyName land above)
  if (head === 'name') {
    if (lone || PERSON_NAME_PREFIXES.has(first)) return str(fullName);
    if (has('file')) return str(fileName);
    return str(title);
  }
  if (isHead('author', 'assignee', 'recipient', 'sender')) return str(fullName);

  // Text
  if (isHead('title', 'headline', 'subject', 'heading', 'caption', 'label')) return str(title);
  if (isHead('bio', 'about', 'tagline')) return str(bio);
  if (isHead('description', 'summary', 'excerpt', 'overview', 'message', 'comment', 'note', 'reason')) return str(description);
  if (isHead('body', 'content', 'text')) return str(paragraph);
  if (head === 'slug') return str(slug);

  // Misc strings
  if (isHead('color', 'colour')) return str(color);
  if (head === 'currency') return str(listOf(CURRENCIES));
  if (head === 'locale') return str(listOf(LOCALES));
  if (isHead('language', 'lang')) return str(listOf(LANGUAGES));
  if (isHead('password', 'passcode')) return str(password);
  if (isHead('token', 'secret', 'hash', 'apikey', 'checksum') || (head === 'key' && has('api'))) return str(token);
  if (head === 'sku') return str(sku);
  if (isHead('filename', 'file', 'path') ) return str(fileName);
  if (head === 'version') return { natural: 'string', string: version, number: { min: 1, max: 12, decimals: 0 } };
  if (isHead('status', 'state')) return str(listOf(STATUSES), true);
  if (head === 'role') return str(listOf(ROLES), true);
  if (isHead('category', 'genre')) return str(listOf(CATEGORIES), true);
  if (isHead('tag', 'keyword')) return str(listOf(TAGS), true);

  // Numbers (integers unless the name suggests decimals)
  if (head === 'age') return num(18, 90);
  if (BIG_MONEY.has(head)) return num(25000, 250000, 2);
  if (MONEY.has(head)) return num(1, 500, 2);
  if (isHead('rating', 'star')) return num(1, 5, 1);
  if (SMALL_COUNTS.has(head) || (first === 'num' && !lone) || (first === 'number' && has('of'))) return num(0, 50);
  if (BIG_COUNTS.has(head)) return num(0, 10000);
  if (head === 'score') return num(0, 100);
  if (isHead('percent', 'percentage', 'pct')) return num(0, 100, 1);
  if (isHead('rate', 'ratio')) return num(0, 1, 2);
  if (head === 'weight') return num(0.5, 120, 1);
  if (isHead('temperature', 'temp')) return num(-10, 40, 1);
  if (head === 'distance') return num(0.1, 500, 1);
  if (isHead('height', 'width', 'length', 'depth', 'size')) return num(1, 500);
  if (head === 'year') return num(0, 30, 0, { yearsBack: 30 });
  if (head === 'month') return num(1, 12);
  if (head === 'day') return num(1, 28);
  if (head === 'hour') return num(0, 23);
  if (isHead('minute', 'second')) return num(0, 59);
  if (head === 'duration') return num(1, 3600);
  if (ORDINALS.has(head)) return num(1, 10);
  if (isHead('stock', 'inventory')) return num(0, 500);
  if (head === 'port') return num(1024, 65535);

  return null;
}

/** A v4-layout UUID from the given Rng. */
export function uuid(rng: Rng): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (rng() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
