/**
 * Kit schema: the entities a Tier 0 kit app stores (SPEC-presets-and-kit 4.2, the Entity block).
 * One schema drives the store, the generated data and action surfaces, and preview mocks.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'ref';

export interface FieldDef {
  name: string;
  type: FieldType;
  /** Allowed values, required when `type` is 'enum'. */
  enum?: string[];
  /** Target entity name, required when `type` is 'ref'. */
  to?: string;
  /** A record may leave this field out. */
  optional?: boolean;
}

export interface EntityDef {
  /** Also the entity's data path and action prefix (`meal`, `meal.create`). */
  name: string;
  fields: FieldDef[];
  /** 'household' needs a sign-in provider other than none. */
  scope: 'user' | 'household';
  /** Delete marks the row (`deletedAt`) instead of removing it. */
  softDelete?: boolean;
}

export interface KitSchema {
  entities: EntityDef[];
}

/** Columns the store owns on every row; schema fields may not reuse them. */
export const SYSTEM_FIELDS = ['id', 'ownerId', 'createdAt', 'updatedAt', 'deletedAt'] as const;

const NAME = /^[a-z][a-zA-Z0-9]*$/;
const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum', 'ref'];

export interface SchemaCheckOptions {
  /** True when the app has a SignIn block with a provider other than none. */
  signedIn?: boolean;
}

/** Returns every problem found; an empty list means the schema is usable. */
export function validateSchema(schema: KitSchema, opts: SchemaCheckOptions = {}): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const e of schema.entities) {
    if (!NAME.test(e.name)) errors.push(`entity "${e.name}": name must match ${NAME}`);
    if (names.has(e.name)) errors.push(`entity "${e.name}": duplicate name`);
    names.add(e.name);
    if (e.scope === 'household' && !opts.signedIn) {
      errors.push(`entity "${e.name}": household scope needs sign-in`);
    }
  }
  for (const e of schema.entities) {
    const fields = new Set<string>();
    for (const f of e.fields) {
      const at = `entity "${e.name}" field "${f.name}"`;
      if (!NAME.test(f.name)) errors.push(`${at}: name must match ${NAME}`);
      if ((SYSTEM_FIELDS as readonly string[]).includes(f.name)) errors.push(`${at}: reserved name`);
      if (fields.has(f.name)) errors.push(`${at}: duplicate name`);
      fields.add(f.name);
      if (!FIELD_TYPES.includes(f.type)) errors.push(`${at}: unknown type "${f.type}"`);
      if (f.type === 'enum' && !f.enum?.length) errors.push(`${at}: enum needs values`);
      if (f.type === 'ref' && !(f.to && names.has(f.to))) errors.push(`${at}: ref to unknown entity "${f.to}"`);
    }
  }
  return errors;
}

/** Checks one field value against its definition; returns an error or null. Ref targets are checked by the store. */
export function checkValue(f: FieldDef, v: unknown): string | null {
  switch (f.type) {
    case 'string':
    case 'ref':
      return typeof v === 'string' ? null : 'must be a string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a finite number';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'date':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? null : 'must be an ISO date string';
    case 'enum':
      return f.enum!.includes(v as string) ? null : `must be one of ${f.enum!.join(', ')}`;
  }
}
