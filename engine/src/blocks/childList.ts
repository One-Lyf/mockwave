/**
 * ChildList (SPEC-presets-and-kit 4.2): `{parent, fields[], position, sectionHeader?}`.
 * Ordered children of a parent entity. `position` is the required number field that sorts them.
 * `sectionHeader`, when set, names an optional string field: a row whose value is non-blank opens
 * a section and is not itself an item. Rows before the first header sit in a leading group.
 * A header row may omit other required fields. This block does not store rows.
 */

import { checkValue, type FieldDef } from '../store/schema';
import { checkFieldList, FIELD_NAME } from './fields';

export interface ChildList {
  parent: string;
  fields: FieldDef[];
  /** Name of the required number field that orders the children. */
  position: string;
  /** Name of an optional string field. A non-blank value opens a section. */
  sectionHeader?: string;
}

export type ChildRow = Record<string, unknown>;

export interface ChildGroup {
  header: string | null;
  items: ChildRow[];
}

function isHeader(row: ChildRow, field: string | undefined): boolean {
  if (!field) return false;
  const v = row[field];
  return typeof v === 'string' && v.trim() !== '';
}

/** Problems with the block and, when `rows` is passed, each row. An empty list means usable. */
export function checkChildList(list: ChildList, rows?: ChildRow[]): string[] {
  const errors: string[] = [];
  if (typeof list?.parent !== 'string' || !FIELD_NAME.test(list.parent)) {
    errors.push(`parent must match ${FIELD_NAME}`);
  }
  const fields = checkFieldList(list?.fields);
  errors.push(...fields.errors);

  const position = list?.position;
  const pos = typeof position === 'string' ? fields.usable.get(position) : undefined;
  if (typeof position !== 'string' || !fields.names.has(position) || !pos || pos.type !== 'number' || pos.optional) {
    errors.push(`position "${position}" must be a required number field`);
  }

  const headerName = list?.sectionHeader;
  if (headerName != null && headerName !== undefined) {
    if (headerName === '') errors.push('sectionHeader needs a field name');
    else if (headerName === position) errors.push('sectionHeader cannot be the position field');
    else {
      const header = fields.usable.get(headerName);
      if (!fields.names.has(headerName) || !header || header.type !== 'string' || !header.optional) {
        errors.push(`sectionHeader "${headerName}" must be an optional string field`);
      }
    }
  }

  if (rows === undefined) return errors;
  if (!Array.isArray(rows)) return [...errors, 'rows must be a list'];

  const headerDef = typeof headerName === 'string' ? fields.usable.get(headerName) : undefined;
  const headerField = headerDef?.type === 'string' && headerDef.optional ? headerName : undefined;
  const schema = Array.isArray(list?.fields) ? list.fields : [];
  rows.forEach((row, i) => {
    const at = `row ${i}`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(row)) {
      if (!fields.names.has(key)) errors.push(`${at}: "${key}" is not a declared field`);
    }
    const header = isHeader(row, headerField);
    for (const f of schema) {
      if (!f || typeof f !== 'object') continue;
      const v = row[f.name];
      if (v === undefined) {
        if (!f.optional && (!header || f.name === position)) errors.push(`${at}: missing required field "${f.name}"`);
        continue;
      }
      const def = fields.usable.get(f.name);
      if (!def) continue;
      if (v === null && def.optional) continue;
      const err = checkValue(def, v);
      if (err) errors.push(`${at} field "${f.name}": ${err}`);
    }
  });
  return errors;
}

function sortedCopy(list: ChildList, rows: ChildRow[]): ChildRow[] | null {
  if (checkChildList(list, rows).length) return null;
  return rows
    .map((row, index) => ({ row: structuredClone(row), index }))
    .sort((a, b) => (a.row[list.position] as number) - (b.row[list.position] as number) || a.index - b.index)
    .map((x) => x.row);
}

/** A copy of the rows sorted by position. Ties keep input order. Null when the check fails. */
export function orderChildren(list: ChildList, rows: ChildRow[]): ChildRow[] | null {
  return sortedCopy(list, rows);
}

/**
 * The ordered rows split into sections. A header row opens a section and is not an item.
 * With no `sectionHeader`, every row is one group under a null header.
 * Null when the check fails. Changing a returned row does not change `rows`.
 */
export function groupChildren(list: ChildList, rows: ChildRow[]): ChildGroup[] | null {
  const ordered = sortedCopy(list, rows);
  if (!ordered) return null;
  const headerField = list.sectionHeader || undefined;
  if (!headerField) return [{ header: null, items: ordered }];
  const groups: ChildGroup[] = [];
  let current: ChildGroup | null = null;
  for (const row of ordered) {
    if (isHeader(row, headerField)) {
      current = { header: (row[headerField] as string).trim(), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { header: null, items: [] };
      groups.push(current);
    }
    current.items.push(row);
  }
  return groups;
}
