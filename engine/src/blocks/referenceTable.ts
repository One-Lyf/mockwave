/**
 * ReferenceTable block (SPEC-presets-and-kit 4.2): `{rows[], fields[]}`, read-only data shipped with a
 * preset (e.g. Marble's MET table). Field types and value checks come from the kit store schema.
 * There is no create, update or delete: a preset ships the rows and the app only reads them.
 */

import { checkValue, SYSTEM_FIELDS, type FieldDef, type FieldType } from '../store/schema';

export type ReferenceRow = Record<string, unknown>;

export interface ReferenceTable {
  fields: FieldDef[];
  rows: ReferenceRow[];
}

/** The same name rule the kit schema applies to entities and fields. */
const NAME = /^[a-z][a-zA-Z0-9]*$/;
const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum', 'ref'];

/** Returns every problem found; an empty list means the table is usable. */
export function checkReferenceTable(table: ReferenceTable): string[] {
  const errors: string[] = [];
  const fields = table.fields ?? [];
  const rows = table.rows ?? [];
  const names = new Set<string>();
  const usable = new Map<string, FieldDef>();

  for (const f of fields) {
    const at = `field "${f.name}"`;
    let ok = true;
    if (typeof f.name !== 'string' || !NAME.test(f.name)) {
      errors.push(`${at}: name must match ${NAME}`);
      ok = false;
    }
    if ((SYSTEM_FIELDS as readonly string[]).includes(f.name)) {
      errors.push(`${at}: reserved name`);
      ok = false;
    }
    if (names.has(f.name)) {
      errors.push(`${at}: duplicate name`);
      ok = false;
    }
    names.add(f.name);
    if (!FIELD_TYPES.includes(f.type)) {
      errors.push(`${at}: unknown type "${f.type}"`);
      ok = false;
    } else if (f.type === 'enum' && !f.enum?.length) {
      errors.push(`${at}: enum needs values`);
      ok = false;
    } else if (f.type === 'ref' && !(typeof f.to === 'string' && f.to.length > 0)) {
      errors.push(`${at}: ref needs a target in "to"`);
      ok = false;
    }
    if (ok) usable.set(f.name, f);
  }

  rows.forEach((row, i) => {
    const at = `row ${i}`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const k of Object.keys(row)) {
      if (!names.has(k)) errors.push(`${at}: "${k}" is not a declared field`);
    }
    for (const f of fields) {
      const v = row[f.name];
      if (v === undefined) {
        if (!f.optional) errors.push(`${at}: missing required field "${f.name}"`);
        continue;
      }
      const def = usable.get(f.name);
      if (!def) continue;
      if (v === null && def.optional) continue;
      const err = checkValue(def, v);
      if (err) errors.push(`${at} field "${f.name}": ${err}`);
    }
  });

  return errors;
}

/**
 * Returns a copy of the shipped rows when the table checks clean, or null when it does not.
 * Changing the copy never changes the shipped rows.
 */
export function readReferenceTable(table: ReferenceTable): ReferenceRow[] | null {
  if (checkReferenceTable(table).length) return null;
  return structuredClone(table.rows ?? []);
}
