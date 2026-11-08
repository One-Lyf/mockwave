import { describe, expect, it } from 'vitest';
import {
  COLUMN_TYPES,
  checkBasewaveTable,
  coerceValue,
  contractToTable,
  parseContract,
  parseTable,
  removeColumn,
  renameColumn,
  serializeTable,
  setCell,
  setColumnType,
  tableToContract,
  tableToDataSurface,
  type BasewaveTable,
} from './basewaveTable';
import { checkReferenceTable } from './referenceTable';
import { blankTable, getSampleTable, SAMPLE_TABLES } from './sampleData';

const allTypes: BasewaveTable = {
  name: 'items',
  columns: [
    { id: 'c0', name: 'label', type: 'text' },
    { id: 'c1', name: 'count', type: 'number' },
    { id: 'c2', name: 'active', type: 'boolean' },
    { id: 'c3', name: 'on', type: 'date' },
  ],
  // row values are keyed by the stable column id, never by the name
  rows: [
    { c0: 'One', c1: 1, c2: true, c3: '2026-11-01' },
    { c0: 'Two', c1: 2.5, c2: false, c3: '2026-11-02' },
    { c0: 'Blank cells allowed' }, // every column is optional in the contract
  ],
};

/** The contract rows, keyed by column name. */
const allTypesContractRows = [
  { label: 'One', count: 1, active: true, on: '2026-11-01' },
  { label: 'Two', count: 2.5, active: false, on: '2026-11-02' },
  { label: 'Blank cells allowed' },
];

describe('tableToContract', () => {
  it('carries the column schema (name + type) with the rows', () => {
    const contract = tableToContract(allTypes);
    expect(contract.name).toBe('items');
    expect(contract.fields).toEqual([
      { name: 'label', type: 'string', optional: true },
      { name: 'count', type: 'number', optional: true },
      { name: 'active', type: 'boolean', optional: true },
      { name: 'on', type: 'date', optional: true },
    ]);
    expect(contract.rows).toEqual(allTypesContractRows);
    // the contract is the ReferenceTable shape Fluxwave consumes as module data
    expect(checkReferenceTable(contract)).toEqual([]);
  });

  it('maps every editor column type to a contract field type', () => {
    const table: BasewaveTable = {
      name: 't',
      columns: COLUMN_TYPES.map((type, i) => ({ id: `c${i}`, name: `f${i}`, type })),
      rows: [],
    };
    expect(tableToContract(table).fields.map((f) => f.type)).toEqual(['string', 'number', 'boolean', 'date']);
  });

  it('returns a copy: editing the contract never reaches the table rows', () => {
    const contract = tableToContract(allTypes);
    (contract.rows[0] as Record<string, unknown>).label = 'Changed';
    expect(allTypes.rows[0].c0).toBe('One');
  });
});

describe('serialize + round trip', () => {
  it('serializes a Basewave table to the contract and round-trips', () => {
    const json = serializeTable(allTypes);
    const parsed = JSON.parse(json);
    // the serialized contract carries schema (name + type) with the rows
    expect(parsed.name).toBe('items');
    expect(parsed.fields.map((f: { name: string; type: string }) => [f.name, f.type])).toEqual([
      ['label', 'string'],
      ['count', 'number'],
      ['active', 'boolean'],
      ['on', 'date'],
    ]);
    expect(parsed.rows).toEqual(allTypesContractRows);
    expect(parseTable(json)).toEqual(allTypes);
  });

  it('round-trips through the contract in both directions', () => {
    const contract = tableToContract(allTypes);
    expect(contractToTable(contract.name, contract)).toEqual(allTypes);
    expect(parseTable(serializeTable(allTypes))).toEqual(contractToTable(contract.name, contract));
  });

  it('round-trips every built-in sample data set', () => {
    expect(SAMPLE_TABLES.length).toBe(3);
    for (const sample of SAMPLE_TABLES) {
      const table = getSampleTable(sample.id)!;
      expect(checkBasewaveTable(table)).toEqual([]);
      expect(parseTable(serializeTable(table))).toEqual(table);
      expect(checkReferenceTable(tableToContract(table))).toEqual([]);
    }
  });

  it('round-trips a blank table', () => {
    const table = blankTable();
    expect(parseTable(serializeTable(table))).toEqual(table);
  });

  it('rejects JSON that is not a contract', () => {
    expect(() => parseContract('not json')).toThrow();
    expect(() => parseContract('"just a string"')).toThrow();
    expect(() => parseContract('{"name":"Bad Name","fields":[],"rows":[]}')).toThrow();
    expect(() => parseContract('{"name":"ok","fields":[{"name":"a"}],"rows":[]}')).toThrow();
    expect(() => parseContract('{"name":"ok","fields":[],"rows":{}}')).toThrow();
  });

  it('refuses a contract with a field type the editor cannot represent', () => {
    const json = JSON.stringify({
      name: 't',
      fields: [{ name: 'level', type: 'enum', enum: ['a'] }],
      rows: [],
    });
    expect(() => parseTable(json)).toThrow(/cannot represent/);
  });
});

describe('checkBasewaveTable', () => {
  it('accepts a clean table', () => {
    expect(checkBasewaveTable(allTypes)).toEqual([]);
  });

  it('flags a bad table name, reserved/duplicate columns and mistyped cells', () => {
    const bad: BasewaveTable = {
      name: 'Bad Name',
      columns: [
        { id: 'c0', name: 'id', type: 'text' },
        { id: 'c1', name: 'label', type: 'text' },
        { id: 'c2', name: 'label', type: 'text' },
        { id: 'c3', name: 'count', type: 'number' },
      ],
      rows: [{ c1: 'x', c3: 'not a number' }],
    };
    const errors = checkBasewaveTable(bad).join('\n');
    expect(errors).toMatch(/table name must match/);
    expect(errors).toMatch(/field "id": reserved name/);
    expect(errors).toMatch(/field "label": duplicate name/);
    expect(errors).toMatch(/"count": must be a finite number/);
  });
});

describe('renameColumn: stable column ids keep the data', () => {
  it('clearing the title header and typing "name" keeps all 4 titles', () => {
    let table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    const id = table.columns[ci].id;
    // clear the header, then retype character by character, as the input fires per keystroke
    for (const draft of ['', 'n', 'na', 'nam', 'name']) {
      table = renameColumn(table, ci, draft);
    }
    expect(table.columns[ci].name).toBe('name');
    expect(table.rows.map((r) => r[id])).toEqual(['Chickpea Curry', 'Lemon Pasta', 'Beef Stir Fry', 'Tomato Soup']);
    // the values surface under the new name in the output, and the table checks clean
    expect(tableToContract(table).rows.map((r) => r.name)).toEqual([
      'Chickpea Curry',
      'Lemon Pasta',
      'Beef Stir Fry',
      'Tomato Soup',
    ]);
    expect(checkBasewaveTable(table)).toEqual([]);
  });

  it('an empty or partial rename flags the alert but never drops the values', () => {
    let table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    table = renameColumn(table, ci, '');
    expect(checkBasewaveTable(table).some((e) => e.includes('name must match'))).toBe(true);
    expect(table.rows.every((r) => r[table.columns[ci].id] !== undefined)).toBe(true);
  });

  it('renaming onto a duplicate name alerts and overwrites nothing; renaming away restores a clean table', () => {
    let table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    const pi = table.columns.findIndex((c) => c.name === 'prepMinutes');
    const servingsId = table.columns[si].id;
    const prepId = table.columns[pi].id;

    table = renameColumn(table, si, 'prepMinutes'); // duplicate of the existing column
    expect(checkBasewaveTable(table).some((e) => e.includes('duplicate name'))).toBe(true);
    // both columns kept their own values, keyed by their own ids
    expect(table.rows.map((r) => r[servingsId])).toEqual([4, 2, 3, 6]);
    expect(table.rows.map((r) => r[prepId])).toEqual([35, 20, 25, 40]);

    table = renameColumn(table, si, 'servingsX');
    expect(checkBasewaveTable(table)).toEqual([]);
    const rows = tableToContract(table).rows;
    expect(rows.map((r) => r.servingsX)).toEqual([4, 2, 3, 6]);
    // the original prepMinutes values are intact
    expect(rows.map((r) => r.prepMinutes)).toEqual([35, 20, 25, 40]);
  });
});

describe('setColumnType coerces the values instead of leaving stale ones', () => {
  it('text switched to Boolean blanks non-boolean values (no more "True" for text)', () => {
    const table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    const next = setColumnType(table, ci, 'boolean');
    expect(next.rows.every((r) => r[next.columns[ci].id] === undefined)).toBe(true);
    expect(checkBasewaveTable(next)).toEqual([]);
  });

  it('number switched to Text stringifies, Boolean keeps real booleans', () => {
    const table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    const vi = table.columns.findIndex((c) => c.name === 'vegetarian');
    let next = setColumnType(table, si, 'text');
    expect(next.rows.map((r) => r[next.columns[si].id])).toEqual(['4', '2', '3', '6']);
    next = setColumnType(next, vi, 'number');
    expect(next.rows.map((r) => r[next.columns[vi].id])).toEqual([1, 1, 0, 1]);
    expect(checkBasewaveTable(next)).toEqual([]);
  });
});

describe('cell and column helpers key by id', () => {
  it('setCell writes by column id and removeColumn drops only that column', () => {
    let table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    table = setCell(table, 0, si, 9);
    expect(table.rows[0][table.columns[si].id]).toBe(9);
    table = removeColumn(table, si);
    expect(table.columns.some((c) => c.name === 'servings')).toBe(false);
    expect(table.rows.every((r) => !('c1' in r))).toBe(true);
    expect(tableToContract(table).rows.map((r) => r.title)).toEqual([
      'Chickpea Curry',
      'Lemon Pasta',
      'Beef Stir Fry',
      'Tomato Soup',
    ]);
    expect(checkBasewaveTable(table)).toEqual([]);
  });

  it('coerceValue blanks what the type cannot represent', () => {
    expect(coerceValue('number', 'abc')).toBeUndefined();
    expect(coerceValue('number', '')).toBeUndefined();
    expect(coerceValue('number', '2.5')).toBe(2.5);
    expect(coerceValue('boolean', 'Chickpea Curry')).toBeUndefined();
    expect(coerceValue('boolean', 'true')).toBe(true);
    expect(coerceValue('date', 'not a date')).toBeUndefined();
    expect(coerceValue('date', '2026-11-01')).toBe('2026-11-01');
    expect(coerceValue('text', 4)).toBe('4');
  });
});

describe('tableToDataSurface', () => {
  it('feeds the table through the Fluxwave DataField-shaped surface', () => {
    const surface = tableToDataSurface(allTypes);
    expect(surface[0]).toEqual({ path: 'items', label: 'Items', kind: 'array', writable: true });
    expect(surface.slice(1)).toEqual([
      { path: 'items.label', label: 'Label', kind: 'string', writable: true },
      { path: 'items.count', label: 'Count', kind: 'number', writable: true },
      { path: 'items.active', label: 'Active', kind: 'boolean', writable: true },
      { path: 'items.on', label: 'On', kind: 'string', writable: true },
    ]);
  });
});
