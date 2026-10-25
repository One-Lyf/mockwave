/**
 * ChildList (SPEC-presets-and-kit 4.2): `{parent, fields[], position, sectionHeader?}`.
 * Ordered children of a parent entity. `position` is the required number field that sorts them.
 * `sectionHeader`, when set, names an optional string field: a row whose value is non-blank opens
 * a section and is not itself an item. Rows before the first header sit in a leading group.
 * A header row may omit other required fields, except `position` and a ref field to `parent`.
 * This block does not store rows.
 * The rows live in a KitStore entity: `childListEntity` gives that entity, and rows read back
 * from the store (with `id`, `createdAt` and the other store columns) check and order as-is.
 * One entity holds the children of every parent. Pass the parent id to `orderChildren` or
 * `groupChildren` so one parent's rows never mix with another's.
 */

import { checkValue, type EntityDef, type FieldDef } from '../store/schema';
import { checkFieldList, FIELD_NAME, isSystemField } from './fields';

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

/** Names of the fields that ref the parent entity. */
function parentRefFields(list: ChildList): string[] {
  if (!Array.isArray(list?.fields)) return [];
  return list.fields
    .filter((f) => !!f && typeof f === 'object' && f.type === 'ref' && f.to === list.parent && typeof f.name === 'string')
    .map((f) => f.name);
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
  const parentRefs = new Set(parentRefFields(list));
  rows.forEach((row, i) => {
    const at = `row ${i}`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(row)) {
      if (!fields.names.has(key) && !isSystemField(key)) errors.push(`${at}: "${key}" is not a declared field`);
    }
    const header = isHeader(row, headerField);
    for (const f of schema) {
      if (!f || typeof f !== 'object') continue;
      const v = row[f.name];
      if (v === undefined) {
        if (!f.optional && (!header || f.name === position || parentRefs.has(f.name))) errors.push(`${at}: missing required field "${f.name}"`);
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

function sortedCopy(list: ChildList, rows: ChildRow[], parentId?: string): ChildRow[] | null {
  if (checkChildList(list, rows).length) return null;
  const refs = parentRefFields(list);
  let mine = rows;
  if (parentId !== undefined) {
    if (typeof parentId !== 'string' || !refs.length) return null;
    mine = rows.filter((row) => refs.some((r) => row[r] === parentId));
  } else if (refs.length) {
    // Rows of two parents would interleave by position. Refuse instead of mixing them.
    const parents = new Set(rows.map((row) => refs.map((r) => String(row[r] ?? '')).join('\u0000')));
    if (parents.size > 1) return null;
  }
  return mine
    .map((row, index) => ({ row: structuredClone(row), index }))
    .sort((a, b) => (a.row[list.position] as number) - (b.row[list.position] as number) || a.index - b.index)
    .map((x) => x.row);
}

/**
 * A copy of the rows sorted by position. Ties keep input order. Null when the check fails.
 * With `parentId`, only rows whose ref field to `parent` equals it (null when the list has no such
 * field). Without it, null when the rows belong to more than one parent.
 */
export function orderChildren(list: ChildList, rows: ChildRow[], parentId?: string): ChildRow[] | null {
  return sortedCopy(list, rows, parentId);
}

/**
 * The ordered rows split into sections. A header row opens a section and is not an item.
 * With no `sectionHeader`, every row is one group under a null header.
 * `parentId` filters as in `orderChildren`; rows of two parents are never grouped together.
 * Null when the check fails. Changing a returned row does not change `rows`.
 */
export function groupChildren(list: ChildList, rows: ChildRow[], parentId?: string): ChildGroup[] | null {
  const ordered = sortedCopy(list, rows, parentId);
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

/**
 * The KitStore entity that holds this list's rows: the list's fields as its fields, with every
 * field optional except `position` and the ref fields to `parent`, so a header row that omits the
 * rest stores (the way `settingsEntity` loosens its fields). `checkChildList` still requires the
 * other fields on item rows when they are read back. Add it to the app's `KitSchema.entities`,
 * then pass `store.list(name)` and the parent id to `orderChildren` or `groupChildren`.
 * Null when the list fails its check. A ref field to `parent` is checked by `createStore`.
 */
export function childListEntity(
  name: string,
  list: ChildList,
  scope: EntityDef['scope'] = 'user',
): EntityDef | null {
  if (checkChildList(list).length) return null;
  const keep = new Set([list.position, ...parentRefFields(list)]);
  const fields = list.fields.map((f) => (keep.has(f.name) ? structuredClone(f) : { ...structuredClone(f), optional: true }));
  return { name, scope, fields };
}
