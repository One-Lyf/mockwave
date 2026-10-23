/**
 * Shared field checks for the kit data blocks (SPEC-presets-and-kit 4.2).
 * Same rules as ReferenceTable and the kit store: name shape, reserved names, duplicates,
 * known types, enum values, and a non-empty ref target. Not re-exported from the store index.
 */

import { SYSTEM_FIELDS, type FieldDef, type FieldType } from '../store/schema';

export const FIELD_NAME = /^[a-z][a-zA-Z0-9]*$/;
const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum', 'ref'];

export interface CheckedFields {
  errors: string[];
  names: Set<string>;
  /** Fields that passed every rule, in list order. */
  usable: Map<string, FieldDef>;
}

/** Problems with a field list. An empty list is a valid list. A non-list is one problem. */
export function checkFieldList(fields: FieldDef[] | undefined): CheckedFields {
  if (!Array.isArray(fields)) {
    return { errors: ['fields must be a list'], names: new Set(), usable: new Map() };
  }
  const errors: string[] = [];
  const names = new Set<string>();
  const usable = new Map<string, FieldDef>();
  for (const f of fields) {
    const at = `field "${f?.name}"`;
    let ok = true;
    if (!f || typeof f.name !== 'string' || !FIELD_NAME.test(f.name)) {
      errors.push(`${at}: name must match ${FIELD_NAME}`);
      ok = false;
    }
    if (f && (SYSTEM_FIELDS as readonly string[]).includes(f.name)) {
      errors.push(`${at}: reserved name`);
      ok = false;
    }
    if (f && names.has(f.name)) {
      errors.push(`${at}: duplicate name`);
      ok = false;
    }
    if (f && typeof f.name === 'string') names.add(f.name);
    if (!f || !FIELD_TYPES.includes(f.type)) {
      errors.push(`${at}: unknown type "${f?.type}"`);
      ok = false;
    } else if (f.type === 'enum' && !f.enum?.length) {
      errors.push(`${at}: enum needs values`);
      ok = false;
    } else if (f.type === 'ref' && !(typeof f.to === 'string' && f.to.length > 0)) {
      errors.push(`${at}: ref needs a target in "to"`);
      ok = false;
    }
    if (ok && f) usable.set(f.name, f);
  }
  return { errors, names, usable };
}

/**
 * True for a column the kit store owns on every row (`id`, `createdAt`, and so on). A row read
 * from a KitStore entity carries these, so a block reading store rows does not call them undeclared.
 */
export function isSystemField(key: string): boolean {
  return (SYSTEM_FIELDS as readonly string[]).includes(key);
}
