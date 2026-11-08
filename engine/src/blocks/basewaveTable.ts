/**
 * Basewave table (wr-data-plugin-upgrade): the editable data module behind the Basewave
 * first screen. A table is columns (name + type) plus rows.
 *
 * A table serializes to the kit ReferenceTable contract — `{ fields, rows }` — which is
 * the plain-data shape Fluxwave consumes as module data (SPEC-modular-apps: "Mockwave
 * supplies module data mocks"), so a Basewave table feeds Fluxwave through the contract
 * with no extra glue. The contract output carries the column schema (name + type) with
 * the rows.
 */

import { checkReferenceTable, type ReferenceRow, type ReferenceTable } from './referenceTable';
import { SYSTEM_FIELDS, type FieldDef, type FieldType } from '../store/schema';
import type { SurfaceField } from '../store/store';

/** Column types the table editor offers. */
export type ColumnType = 'text' | 'number' | 'boolean' | 'date';

export interface BasewaveColumn {
  /** Stable internal key. Row values are keyed by this id, never by the name, so renaming
   *  a column (even to an empty or duplicate name mid-edit) never moves or drops data. */
  id: string;
  /** The user-facing label. Mapped to the contract field name only when generating output. */
  name: string;
  type: ColumnType;
}

export type BasewaveRow = Record<string, unknown>;

export interface BasewaveTable {
  /** Also the table's data path in the contract surface. */
  name: string;
  columns: BasewaveColumn[];
  rows: BasewaveRow[];
  /** Monotonic source of column ids, so a fresh id is never re-issued after a remove + add.
   *  Not part of the contract; derived from the columns when absent (e.g. after a round trip). */
  idSeq?: number;
}

/** The contract a Basewave table serializes to: column schema (name + type) with the rows. */
export interface BasewaveContract {
  name: string;
  fields: FieldDef[];
  rows: ReferenceRow[];
}

export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'boolean', 'date'];

export const COLUMN_LABELS: Record<ColumnType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
};

/** The same name rule the kit schema applies to entities and fields. */
const NAME = /^[a-z][a-zA-Z0-9]*$/;

/** The name rule in plain words, for user-facing messages (never show the raw regex). */
const NAME_WORDS = 'a lowercase letter, then letters or numbers only';

/** Editor column type -> contract field type. */
const TO_FIELD: Record<ColumnType, FieldType> = {
  text: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
};

/** Contract field type -> editor column type. Enum and ref have no editor column. */
const FROM_FIELD: Partial<Record<FieldType, ColumnType>> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
};

/** A column as a contract field. Every column is optional: the editor allows a blank cell. */
export function columnToField(col: BasewaveColumn): FieldDef {
  return { name: col.name, type: TO_FIELD[col.type], optional: true };
}

/** A contract field as an editor column (without the id, which the caller assigns), or null
 *  for types the editor cannot represent. */
export function fieldToColumn(field: FieldDef): Omit<BasewaveColumn, 'id'> | null {
  const type = FROM_FIELD[field.type];
  return type ? { name: field.name, type } : null;
}

/** The next never-before-used `c<n>` id, so a column keeps its id across renames and a fresh
 *  column never re-uses an id a removed column had (add/remove/add stays unique). */
export function newColumnId(table: BasewaveTable): string {
  const used = new Set(table.columns.map((c) => c.id));
  let n = table.idSeq ?? 0;
  while (used.has(`c${n}`)) n++;
  return `c${n}`;
}

/** Add a column with a fresh stable id; existing row values are untouched. */
export function addColumn(table: BasewaveTable, name?: string, type: ColumnType = 'text'): BasewaveTable {
  let n = table.columns.length + 1;
  while (table.columns.some((c) => c.name === `column${n}`)) n++;
  const id = newColumnId(table);
  return {
    ...table,
    idSeq: Math.max(table.idSeq ?? 0, Number(id.slice(1)) + 1),
    columns: [...table.columns, { id, name: name ?? `column${n}`, type }],
  };
}

/**
 * Rename a column's label only. Row values stay keyed by the column id, so clearing the
 * name to retype it, or typing a duplicate, never remaps, overwrites or drops a value.
 */
export function renameColumn(table: BasewaveTable, ci: number, name: string): BasewaveTable {
  return { ...table, columns: table.columns.map((c, i) => (i === ci ? { ...c, name } : c)) };
}

/** Coerce a value to a column type; undefined when the value cannot be represented. */
export function coerceValue(type: ColumnType, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (type === 'text') return String(value);
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }
  // date: keep ISO date strings, blank anything else
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** True for an absent or whitespace-only value: a blank cell, never an invalid one. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** True when a present value does not fit the column's current type. The raw value is kept in
 *  the row (flagged invalid by checkBasewaveTable, so the banner counts it and Copy is disabled),
 *  which is what makes switching the type back restore it exactly. */
export function isInvalidCell(value: unknown, type: ColumnType): boolean {
  return !isBlank(value) && coerceValue(type, value) === undefined;
}

/** Change a column's type. Values that convert are converted; values that do not convert stay
 *  as the original raw value flagged invalid. No value is ever deleted by a type change, so
 *  switching back to the original type restores every value exactly. */
export function setColumnType(table: BasewaveTable, ci: number, type: ColumnType): BasewaveTable {
  const col = table.columns[ci];
  if (!col || col.type === type) return table;
  return {
    ...table,
    columns: table.columns.map((c, i) => (i === ci ? { ...c, type } : c)),
    rows: table.rows.map((row) => {
      if (!(col.id in row)) return row;
      const raw = row[col.id];
      const v = coerceValue(type, raw);
      const next = { ...row };
      if (v !== undefined) next[col.id] = v;
      else if (isBlank(raw)) delete next[col.id]; // a blank stays blank
      // else: keep the raw value; it is flagged invalid until the type is switched back
      return next;
    }),
  };
}

/** Remove a column and only its own values (keyed by its id). */
export function removeColumn(table: BasewaveTable, ci: number): BasewaveTable {
  const col = table.columns[ci];
  if (!col) return table;
  return {
    ...table,
    columns: table.columns.filter((_, i) => i !== ci),
    rows: table.rows.map((row) => {
      if (!(col.id in row)) return row;
      const { [col.id]: _v, ...rest } = row;
      return rest;
    }),
  };
}

/** Set one cell, keyed by the column's stable id. */
export function setCell(table: BasewaveTable, ri: number, ci: number, value: unknown): BasewaveTable {
  const col = table.columns[ci];
  if (!col) return table;
  return {
    ...table,
    rows: table.rows.map((row, i) => {
      if (i !== ri) return row;
      const next = { ...row };
      if (value === undefined) delete next[col.id];
      else next[col.id] = value;
      return next;
    }),
  };
}

/** Table -> contract: the column schema (name + type) with the rows, keyed by column name. */
export function tableToContract(table: BasewaveTable): BasewaveContract {
  return {
    name: table.name,
    fields: table.columns.map(columnToField),
    rows: table.rows.map((row) => {
      const out: ReferenceRow = {};
      for (const col of table.columns) {
        const v = row[col.id];
        if (v !== undefined) out[col.name] = v;
      }
      return out;
    }),
  };
}

/** Contract -> table. Returns null when a field type has no editor column (enum, ref). */
export function contractToTable(name: string, ref: ReferenceTable): BasewaveTable | null {
  const fields = ref.fields ?? [];
  const columns: BasewaveColumn[] = [];
  for (const [i, f] of fields.entries()) {
    const c = fieldToColumn(f);
    if (!c) return null;
    columns.push({ id: `c${i}`, ...c });
  }
  const rows = (ref.rows ?? []).map((row) => {
    const out: BasewaveRow = {};
    fields.forEach((f, i) => {
      const v = row[f.name];
      if (v !== undefined) out[`c${i}`] = v;
    });
    return out;
  });
  return { name, columns, rows };
}

/** The contract as JSON — the copy-as-code output for a table. */
export function serializeContract(contract: BasewaveContract): string {
  return JSON.stringify(contract, null, 2);
}

/** JSON -> contract. Throws on anything that is not a contract-shaped value. */
export function parseContract(json: string): BasewaveContract {
  const parsed = JSON.parse(json) as Partial<BasewaveContract>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('contract must be an object');
  }
  if (typeof parsed.name !== 'string' || !NAME.test(parsed.name)) {
    throw new Error(`contract name must match ${NAME_WORDS}`);
  }
  if (!Array.isArray(parsed.fields) || !Array.isArray(parsed.rows)) {
    throw new Error('contract needs "fields" and "rows" lists');
  }
  for (const f of parsed.fields) {
    if (!f || typeof f.name !== 'string' || typeof f.type !== 'string') {
      throw new Error('every contract field needs a name and a type');
    }
  }
  return parsed as BasewaveContract;
}

/** Table -> contract JSON. */
export function serializeTable(table: BasewaveTable): string {
  return serializeContract(tableToContract(table));
}

/** Contract JSON -> table (the round trip). Throws on an unrepresentable field type. */
export function parseTable(json: string): BasewaveTable {
  const contract = parseContract(json);
  const table = contractToTable(contract.name, { fields: contract.fields, rows: contract.rows });
  if (!table) throw new Error('contract has a field type the table editor cannot represent');
  return table;
}

/** Returns every problem found; an empty list means the table serializes to a clean contract. */
export function checkBasewaveTable(table: BasewaveTable): string[] {
  const errors: string[] = [];
  if (!table || typeof table.name !== 'string' || !NAME.test(table.name)) {
    errors.push(`table name must match ${NAME_WORDS}`);
  }
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    errors.push('table needs "columns" and "rows" lists');
    return errors;
  }
  const contract = tableToContract(table);
  errors.push(...checkReferenceTable({ fields: contract.fields, rows: contract.rows }));
  return errors;
}

/** True for a column name the contract reserves (`id`, `createdAt`, and so on). */
export function isReservedColumn(name: string): boolean {
  return (SYSTEM_FIELDS as readonly string[]).includes(name);
}

const labelOf = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');

/**
 * The Fluxwave data surface a table feeds: the rows live at the table's own path, and
 * each column is a typed, writable field. Same shape as fluxwave's `DataField`.
 */
export function tableToDataSurface(table: BasewaveTable): SurfaceField[] {
  const kind: Record<ColumnType, SurfaceField['kind']> = {
    text: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
  };
  return [
    { path: table.name, label: labelOf(table.name), kind: 'array', writable: true },
    ...table.columns.map((c) => ({
      path: `${table.name}.${c.name}`,
      label: labelOf(c.name),
      kind: kind[c.type],
      writable: true,
    })),
  ];
}
