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
  name: string;
  type: ColumnType;
}

export type BasewaveRow = Record<string, unknown>;

export interface BasewaveTable {
  /** Also the table's data path in the contract surface. */
  name: string;
  columns: BasewaveColumn[];
  rows: BasewaveRow[];
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

/** A contract field as an editor column, or null for types the editor cannot represent. */
export function fieldToColumn(field: FieldDef): BasewaveColumn | null {
  const type = FROM_FIELD[field.type];
  return type ? { name: field.name, type } : null;
}

/** Table -> contract: the column schema (name + type) with a copy of the rows. */
export function tableToContract(table: BasewaveTable): BasewaveContract {
  return {
    name: table.name,
    fields: table.columns.map(columnToField),
    rows: structuredClone(table.rows),
  };
}

/** Contract -> table. Returns null when a field type has no editor column (enum, ref). */
export function contractToTable(name: string, ref: ReferenceTable): BasewaveTable | null {
  const columns: BasewaveColumn[] = [];
  for (const f of ref.fields ?? []) {
    const c = fieldToColumn(f);
    if (!c) return null;
    columns.push(c);
  }
  return { name, columns, rows: structuredClone(ref.rows ?? []) };
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
    throw new Error(`contract name must match ${NAME}`);
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
    errors.push(`table name must match ${NAME}`);
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
